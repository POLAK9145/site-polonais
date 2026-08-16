/**
 * Tests de l'économie, de la réputation et de l'audience (phase 2, étape 6, §W).
 *
 * Trois défauts corrigés, trois familles de tests.
 *
 * 1. Les revenus étaient un accumulateur (`yearlyIncome *= ...`) face à des
 *    dépenses nominales fixes : sur trente ans le budget total passait de 104 M
 *    à 117 173 M tandis que la médiane stagnait. Les tests 1 à 10 vérifient que
 *    les revenus sont une **fonction de l'état**, que les charges suivent
 *    l'échelle réelle, et que de l'argent peut sortir.
 *
 * 2. La réputation ne décroissait nulle part et saturait à 100. Les tests 11 à
 *    16 vérifient l'oubli contextuel, la mémoire du palmarès et la portée.
 *
 * 3. L'audience n'existait que pour le joueur, et `fx.followers` ignorait le
 *    plafond. Les tests 17 à 23 vérifient qu'elle existe pour tout le monde, que
 *    le plafond tient sur **tous** les chemins, et qu'elle peut décliner.
 *
 * Les tests 24 à 27 portent sur les politiques : le streaming ne doit pas être
 * une stratégie dominante, et l'argent ne doit pas être une garantie.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG } from '../src/engine/rng.js';
import { generateWorld } from '../src/engine/worldgen.js';
import { GAMES_BY_ID } from '../src/data/games.js';
import { ORG_TIERS_BY_TIER } from '../src/data/orgs.js';
import { STATUS } from '../src/engine/person.js';
import { salaryBand } from '../src/engine/org.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import {
  payroll,
  operatingCost,
  incomeTarget,
  updateOrgIncome,
  sceneEconomy,
  tierReferenceIncome,
  economySnapshot,
} from '../src/engine/economy.js';
import {
  SCOPE,
  titleScope,
  reputationFloor,
  standingSupport,
  settleReputation,
  audienceCeiling,
  gainFollowers,
  settleAudience,
  npcAudienceGrowth,
  decayOrgReputation,
  runVisibilityCycle,
} from '../src/engine/reputation.js';
import { runEconomyAudit, economyInvariants, topShare } from '../src/engine/audit/economyAudit.js';
import { createEffects } from '../src/engine/events/effects.js';
import { createCareer } from '../src/engine/career.js';
import { startTrace, stopTrace, takeTrace, TRACE } from '../src/engine/trace.js';

// --- Utilitaires ------------------------------------------------------------

function world0(seed = 6100) {
  return generateWorld({ seed, startYear: 2030 });
}

function anyOrg(world, tier) {
  return Object.values(world.orgs).find((o) => o.alive && !o.isSelfOrg && o.tier === tier);
}

function anyPro(world, gameId = 'vanguard') {
  return Object.values(world.persons).find(
    (p) => p.gameId === gameId && p.teamId && p.status !== STATUS.STAFF && !p.isPlayer,
  );
}

let cached = null;
function shared() {
  if (!cached) cached = runEconomyAudit({ seed: 'economy-regression', years: 20 });
  return cached;
}

// --- 1 à 10 : l'économie ----------------------------------------------------

test('1 — les revenus sont une fonction de l’état, pas de leur propre passé', () => {
  const world = world0();
  const org = anyOrg(world, 4);
  const rng = new RNG(1);
  // Deux organisations identiques dont l'une part d'un revenu absurde doivent
  // converger vers la même cible : c'est la définition d'une fonction de l'état.
  const twin = { ...org, id: 'twin', yearlyIncome: org.yearlyIncome * 40 };
  const target = incomeTarget(world, org).target;
  assert.equal(incomeTarget(world, twin).target, target, 'la cible dépend du passé');
  for (let i = 0; i < 25; i++) {
    updateOrgIncome(world, org, rng);
    updateOrgIncome(world, twin, rng);
  }
  const gap = Math.abs(org.yearlyIncome - twin.yearlyIncome) / Math.max(1, target);
  assert.ok(gap < 0.35, `écart résiduel de ${Math.round(gap * 100)} % après 25 ans`);
});

test('2 — la cible de revenus se décompose en facteurs nommés', () => {
  const world = world0();
  const org = anyOrg(world, 3);
  const { factors, target } = incomeTarget(world, org);
  const keys = factors.map((f) => f.key);
  for (const k of ['tier', 'scene', 'reputation', 'results', 'audience']) {
    assert.ok(keys.includes(k), `facteur « ${k} » absent : on ne peut pas expliquer la richesse`);
  }
  assert.ok(target > 0);
});

test('3 — le niveau ordonne les revenus attendus', () => {
  const world = world0();
  let previous = 0;
  for (const tier of [1, 2, 3, 4, 5]) {
    const ref = tierReferenceIncome(tier);
    assert.ok(ref > previous, `tier ${tier} n’attend pas plus que le précédent`);
    previous = ref;
  }
});

test('4 — les charges suivent l’échelle réelle de la structure', () => {
  const world = world0();
  const small = anyOrg(world, 2);
  const big = anyOrg(world, 5);
  const ratioSmall = operatingCost(world, small) / Math.max(1, payroll(world, small) + 1);
  const ratioBig = operatingCost(world, big) / Math.max(1, payroll(world, big) + 1);
  // Le forfait nominal précédent (1200 × tier) donnait un rapport qui s'écrasait
  // à zéro dès que la masse salariale grossissait : la charge cessait d'exister.
  assert.ok(operatingCost(world, big) > operatingCost(world, small) * 5, 'les charges ne suivent pas l’échelle');
  assert.ok(ratioBig > 0.15, `charges du tier 5 négligeables (${ratioBig.toFixed(2)} × la masse salariale)`);
  assert.ok(ratioSmall > 0.15);
});

test('5 — un niveau d’entrée n’est pas insolvable par construction', () => {
  const world = world0();
  // Le défaut mesuré : le forfait de fonctionnement d'un tier 1 (14 400) dépassait
  // le maximum que ce niveau peut gagner (9 000 × 0,9 = 8 100). 25 organisations
  // sur 42 avaient un budget négatif.
  for (const tier of [1, 2, 3, 4, 5]) {
    const bare = { id: 'bare', tier, teams: {}, budget: 0, yearlyIncome: 0, reputation: 5, history: [] };
    const cost = operatingCost(world, bare);
    assert.ok(
      cost < tierReferenceIncome(tier),
      `tier ${tier} : ${cost} de charges pour ${tierReferenceIncome(tier)} de revenus possibles`,
    );
  }
});

test('6 — les salaires se paient sur les revenus, pas sur la trésorerie', () => {
  const game = GAMES_BY_ID.vanguard;
  const lean = { tier: 3, budget: 300000, yearlyIncome: 300000 };
  const hoarder = { tier: 3, budget: 8000000, yearlyIncome: 300000 };
  const rich = { tier: 3, budget: 8000000, yearlyIncome: 3000000 };
  const b = (o) => salaryBand(o, game).typical;
  // La trésorerie donne un avantage — mais borné.
  assert.ok(b(hoarder) > b(lean), 'la trésorerie ne donne aucun avantage');
  assert.ok(b(hoarder) < b(lean) * 1.7, `la trésorerie vaut un revenu (×${(b(hoarder) / b(lean)).toFixed(2)})`);
  // Et les revenus restent le facteur dominant.
  assert.ok(b(rich) > b(hoarder) * 2, 'les revenus ne dominent pas la trésorerie');
});

test('7 — la santé de la scène change ce qu’on peut y gagner', () => {
  const world = world0();
  const ids = Object.keys(world.gameStates);
  const before = ids.map((id) => sceneEconomy(world, id));
  assert.ok(Math.max(...before) > Math.min(...before) * 1.3, 'toutes les scènes valent la même chose');
  const gs = world.gameStates[ids[0]];
  const healthy = sceneEconomy(world, ids[0]);
  gs.popularity = 5;
  gs.vitality = 0.05;
  assert.ok(sceneEconomy(world, ids[0]) < healthy * 0.5, 'une scène moribonde nourrit autant qu’une scène vivante');
});

test('8 — de l’argent peut sortir du système', () => {
  const r = shared();
  assert.equal(r.crash, null, `plantage : ${r.crash?.message}`);
  const results = r.samples.map((s) => s.flow?.result ?? 0);
  assert.ok(results.some((v) => v < 0), 'aucune année déficitaire en vingt ans : l’argent ne sort jamais');
});

test('9 — la richesse totale ne diverge pas', () => {
  const r = shared();
  const late = r.samples.filter((s) => s.year >= 10);
  const first = late[0].wealth.total;
  const last = late.at(-1).wealth.total;
  // La version précédente multipliait le total par 120 entre l'année 10 et
  // l'année 30. Une croissance lente est légitime ; une exponentielle non.
  assert.ok(last < first * 4, `richesse totale ×${(last / first).toFixed(1)} entre l’an 10 et la fin`);
  // Et la médiane doit croître avec le sommet : sinon c'est une divergence.
  assert.ok(late.at(-1).wealth.median > late[0].wealth.median * 0.5, 'la médiane décroche du total');
});

test('10 — la richesse est ordonnée par niveau et l’économie reste valide', () => {
  const r = shared();
  const last = r.samples.at(-1).wealth;
  const medians = [1, 2, 3, 4, 5].map((t) => last.perTier[String(t)]?.median ?? null).filter((v) => v !== null);
  for (let i = 1; i < medians.length; i++) {
    assert.ok(medians[i] > medians[i - 1], `niveaux non ordonnés : ${medians.join(' < ')}`);
  }
  assert.deepEqual([...new Set(r.invariants)], [], `invariants violés : ${r.invariantDetails?.map((i) => i.detail).join(' | ')}`);
});

// --- 11 à 16 : la réputation ------------------------------------------------

test('11 — la réputation décroît contextuellement, pas d’un point par an', () => {
  const world = world0();
  const p = anyPro(world);
  p.reputation.pros = 90;
  p.stats.titles = 0;
  p.stats.internationalTitles = 0;
  const before = p.reputation.pros;
  settleReputation(world, p);
  const drop1 = before - p.reputation.pros;
  const second = p.reputation.pros;
  settleReputation(world, p);
  const drop2 = second - p.reputation.pros;
  assert.ok(drop1 > 0, 'la réputation ne décroît pas');
  // Une soustraction constante donnerait drop1 === drop2. Un retour vers une
  // cible donne des pas décroissants.
  assert.ok(drop2 < drop1 * 0.95, `décroissance linéaire (${drop1.toFixed(2)} puis ${drop2.toFixed(2)})`);
});

test('12 — le palmarès fabrique une mémoire longue', () => {
  const world = world0();
  const legend = anyPro(world);
  legend.stats.titles = 6;
  legend.stats.internationalTitles = 3;
  legend.reputation.pros = 95;
  const nobody = { ...legend, stats: { ...legend.stats, titles: 0, internationalTitles: 0, finals: 0 } };
  assert.ok(reputationFloor(legend).pros > 40, 'un triple champion du monde n’a aucun plancher de mémoire');
  assert.ok(reputationFloor(nobody).pros < 5, 'un anonyme a un plancher de mémoire');

  // Vingt ans sans équipe : la légende reste connue, l'anonyme est oublié.
  legend.teamId = null;
  legend.status = STATUS.RETIRED;
  const forgotten = { ...legend, id: 'x', stats: { ...legend.stats, titles: 0, internationalTitles: 0, finals: 0 }, reputation: { ...legend.reputation } };
  for (let y = 0; y < 20; y++) {
    settleReputation(world, legend);
    settleReputation(world, forgotten);
  }
  assert.ok(legend.reputation.pros > 40, `la légende est tombée à ${legend.reputation.pros}`);
  assert.ok(forgotten.reputation.pros < 3, `l’anonyme reste à ${forgotten.reputation.pros}`);
});

test('13 — jouer à un niveau finit par vous y faire connaître', () => {
  const world = world0();
  const p = anyPro(world);
  p.reputation.pros = 2;
  p.stats.titles = 0;
  const support = standingSupport(world, p);
  assert.ok(support > 5, 'un titulaire n’a aucun soutien de situation');
  for (let y = 0; y < 15; y++) settleReputation(world, p);
  assert.ok(p.reputation.pros > support * 0.8, `resté à ${p.reputation.pros} pour un soutien de ${support}`);
  // Mais le niveau seul ne suffit pas à saturer l'échelle.
  assert.ok(p.reputation.pros < 80, 'le niveau seul suffit à devenir une idole');
});

test('14 — le niveau réel ordonne la reconnaissance', () => {
  const r = shared();
  const last = r.samples.at(-1);
  assert.ok(last.reputation.median > 5, `réputation médiane de ${last.reputation.median} : personne n’est connu`);
  assert.ok(last.reputation.saturated < last.reputation.n * 0.05, `${last.reputation.saturated} joueurs saturés à 100`);
});

test('15 — la portée d’un titre dépend du niveau de la compétition', () => {
  assert.equal(titleScope(1), SCOPE.LOCAL);
  assert.equal(titleScope(2), SCOPE.LOCAL);
  assert.equal(titleScope(3), SCOPE.NATIONAL);
  assert.equal(titleScope(4), SCOPE.NATIONAL);
  assert.equal(titleScope(6), SCOPE.GLOBAL);
});

test('16 — la réputation d’organisation s’oublie aussi', () => {
  const world = world0();
  const org = anyOrg(world, 3);
  org.reputation = 100;
  org.titles = 0;
  const before = org.reputation;
  decayOrgReputation(world, org);
  assert.ok(org.reputation < before, 'la réputation d’organisation ne décroît pas');
  // Mais un palmarès la protège.
  const titled = { ...org, reputation: 100, titles: 12 };
  decayOrgReputation(world, titled);
  assert.ok(titled.reputation > org.reputation, 'le palmarès ne protège pas la notoriété');
});

// --- 17 à 23 : l'audience ---------------------------------------------------

test('17 — l’audience existe pour tout le monde, pas seulement pour le joueur', () => {
  const r = shared();
  const last = r.samples.at(-1);
  // Mesure du défaut : l'audience médiane des professionnels tombait à 0 dès
  // l'année 20, et le maximum à 0,00 M.
  assert.ok(last.audience.median > 1000, `audience médiane de ${last.audience.median}`);
  assert.ok(last.audience.max > 50000, `audience maximale de ${last.audience.max}`);
});

test('18 — l’audience ne s’effondre pas au fil des générations', () => {
  const r = shared();
  const early = r.samples.find((s) => s.year >= 5);
  const late = r.samples.at(-1);
  assert.ok(late.audience.median > early.audience.median * 0.4, 'l’audience s’érode de génération en génération');
  assert.ok(late.audience.total > 0);
});

test('19 — le plafond tient sur le chemin des événements', () => {
  const world = world0();
  const p = anyPro(world);
  p.reputation.public = 3;
  p.reputation.community = 3;
  p.stats.titles = 0;
  p.stats.internationalTitles = 0;
  p.followers = 0;
  const career = createCareer(world, p);
  const fx = createEffects({ world, career, person: p, difficulty: { progression: 1, consequence: 1 } });
  // `fx.followers` écrivait directement dans le champ : un seul événement
  // pouvait porter un inconnu à un million de suiveurs.
  fx.followers(5000000);
  assert.ok(p.followers < audienceCeiling(p) * 1.05, `${p.followers} suiveurs pour un plafond de ${Math.round(audienceCeiling(p))}`);
});

test('20 — le plafond tient sur le chemin de la génération du monde', () => {
  const world = world0();
  let over = 0;
  for (const p of Object.values(world.persons)) {
    if ((p.followers ?? 0) > audienceCeiling(p) * 1.05) over++;
  }
  assert.equal(over, 0, `${over} personnes au-dessus de leur plafond dès la génération`);
});

test('21 — les rendements sont décroissants', () => {
  const world = world0();
  const p = anyPro(world);
  p.reputation.public = 40;
  p.reputation.community = 30;
  p.followers = 0;
  // Une même dépense d'effort, trois fois de suite : ce qu'elle rapporte doit
  // diminuer à mesure qu'on approche du plafond.
  const effort = audienceCeiling(p) * 0.3;
  const first = gainFollowers(world, p, effort, 'test');
  const second = gainFollowers(world, p, effort, 'test');
  const third = gainFollowers(world, p, effort, 'test');
  assert.ok(first > second && second > third, `gains ${first} / ${second} / ${third}`);
  assert.ok(third < first * 0.6, `rendement quasi constant : ${first} puis ${third}`);
});

test('22 — l’audience peut décliner, et pour une raison', () => {
  const world = world0();
  const p = anyPro(world);
  p.reputation.public = 70;
  p.reputation.community = 50;
  p.stats.titles = 4;
  p.followers = Math.round(audienceCeiling(p) * 0.95);
  const peak = p.followers;
  // Le joueur perd tout ce qui justifiait son audience : le plafond descend,
  // l'audience redescend avec lui. Le déclin n'est pas une règle ajoutée.
  p.reputation.public = 5;
  p.reputation.community = 5;
  p.stats.titles = 0;
  const lost = settleAudience(world, p);
  assert.ok(lost > 0, 'aucune perte alors que le plafond a chuté');
  assert.ok(p.followers < peak * 0.9);
  for (let y = 0; y < 20; y++) settleAudience(world, p);
  assert.ok(p.followers < peak * 0.2, `${p.followers} suiveurs conservés sur ${peak}`);
});

test('23 — les vedettes sont rares et combinent plusieurs dimensions', () => {
  const r = shared();
  const stars = r.peaks.filter((f) => f > 1000000).length;
  assert.ok(stars > 0, 'aucune vedette en vingt ans');
  assert.ok(stars < r.peaks.length * 0.04, `${stars} vedettes sur ${r.peaks.length} : elles ne sont pas rares`);
  // L'audience n'est pas concentrée sur trois personnes non plus.
  const last = r.samples.at(-1);
  assert.ok(last.concentration.audience < 0.25, `top-3 = ${last.concentration.audience} de l’audience`);
  // « Combiner plusieurs dimensions » se vérifie : le sommet de l'audience doit
  // avoir gagné, pas seulement joué haut. Une audience qui ne dépendrait que du
  // niveau donnerait le même palmarès en haut qu'au milieu.
  const world = r.world;
  const ranked = Object.values(world.persons)
    .filter((p) => p.status === STATUS.PRO || p.status === STATUS.SEMIPRO)
    .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));
  const decile = Math.max(3, Math.floor(ranked.length / 10));
  const topTitles = ranked.slice(0, decile).reduce((s, p) => s + p.stats.internationalTitles, 0) / decile;
  const midTitles =
    ranked.slice(decile, decile * 5).reduce((s, p) => s + p.stats.internationalTitles, 0) /
    Math.max(1, decile * 4);
  assert.ok(
    topTitles > midTitles * 2,
    `le décile le plus suivi n’a pas plus de titres mondiaux que le milieu (${topTitles.toFixed(2)} vs ${midTitles.toFixed(2)})`,
  );
});

// --- 24 à 27 : politiques et interactions -----------------------------------

test('24 — l’audience ne remplace pas le niveau : le plafond exige une raison de suivre', () => {
  const world = world0();
  const streamer = anyPro(world);
  streamer.reputation.public = 4;
  streamer.reputation.community = 8;
  streamer.stats.titles = 0;
  streamer.stats.internationalTitles = 0;
  streamer.followers = 0;
  // Vingt ans à ne faire que du contenu, sans jamais rien gagner.
  for (let y = 0; y < 20; y++) gainFollowers(world, streamer, 400000, 'streaming intensif');
  const champion = { ...streamer, followers: 0, reputation: { ...streamer.reputation, public: 80, community: 60 }, stats: { ...streamer.stats, titles: 8, internationalTitles: 3 } };
  assert.ok(
    audienceCeiling(champion) > audienceCeiling(streamer) * 8,
    'le palmarès ne change presque rien au plafond : streamer est aussi payant que gagner',
  );
});

test('25 — l’argent donne un avantage, pas une garantie', () => {
  const r = shared();
  const last = r.samples.at(-1);
  // Si l'argent garantissait la victoire, les revenus seraient concentrés sur
  // une poignée de structures qui gagnent tout.
  assert.ok(last.concentration.revenue < 0.35, `top-3 = ${last.concentration.revenue} des revenus`);
  assert.ok(last.concentration.wealth < 0.35, `top-3 = ${last.concentration.wealth} de la richesse`);
  // Et des structures riches doivent pouvoir perdre de l'argent.
  assert.ok(r.samples.some((s) => (s.flow?.result ?? 1) < 0), 'personne ne perd jamais d’argent');
});

test('26 — l’économie interagit avec la hiérarchie et avec le banc', () => {
  const world = world0();
  const t2 = anyOrg(world, 2);
  const t5 = anyOrg(world, 5);
  // Le niveau change ce qu'on peut payer, donc la profondeur qu'on peut porter.
  assert.ok(
    salaryBand(t5, GAMES_BY_ID.vanguard).typical > salaryBand(t2, GAMES_BY_ID.vanguard).typical * 3,
    'le niveau ne change pas la capacité salariale',
  );
  // Et la masse salariale compte réellement les remplaçants : un banc coûte.
  const team = Object.values(world.teams).find((t) => t.active && t.subs.length > 0);
  if (team) {
    const org = world.orgs[team.orgId];
    const withBench = payroll(world, org);
    const sub = world.persons[team.subs[0]];
    const salary = sub?.contract?.salary ?? 0;
    if (salary > 0) assert.ok(withBench >= salary, 'le banc n’est pas compté dans la masse salariale');
  }
});

test('27 — la trace explique pourquoi une organisation est riche et pourquoi une audience monte', () => {
  const world = world0();
  const org = anyOrg(world, 4);
  const p = anyPro(world);
  p.followers = 0;
  startTrace({ max: 500 });
  updateOrgIncome(world, org, new RNG(7));
  gainFollowers(world, p, 50000, 'test de trace');
  const entries = takeTrace().filter((e) => e.kind === TRACE.ECONOMY);
  stopTrace();

  const income = entries.find((e) => e.decision === 'income');
  assert.ok(income, 'aucune trace de revenus');
  assert.ok(income.factors.length >= 5, 'la trace de revenus n’expose pas ses facteurs');
  assert.ok(income.before !== undefined && income.target !== undefined);
  // Les facteurs doivent être nommés, pas un score opaque.
  for (const f of income.factors) assert.ok(f.label && f.key, 'facteur sans nom');

  const followers = entries.find((e) => e.decision === 'followers');
  assert.ok(followers, 'aucune trace d’audience');
  assert.ok(followers.ceiling > 0 && followers.room !== undefined, 'la trace n’explique pas le plafond');
  assert.ok(followers.reason, 'la trace ne dit pas pourquoi l’audience monte');
});
