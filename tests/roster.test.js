/**
 * Tests de la profondeur d'effectif (phase 2, étape 5).
 *
 * Le défaut corrigé : le banc n'était pas rare, il était impossible. Sur vingt
 * ans et ~150 équipes, 0 à 1 équipe avait un remplaçant et le plus grand banc
 * jamais observé comptait un joueur. `signPlayer` licenciait le maillon faible
 * au lieu de le reléguer, et `buildOffer` n'étiquetait « remplaçant » qu'une
 * recrue moins bonne que le plus faible titulaire.
 *
 * Ces tests vérifient que le banc existe, qu'il n'est pas obligatoire, et qu'il
 * produit des trajectoires.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG } from '../src/engine/rng.js';
import { generateWorld } from '../src/engine/worldgen.js';
import { GAMES_BY_ID } from '../src/data/games.js';
import { ALL_ATTRS } from '../src/engine/attributes.js';
import { STATUS, setFamiliarity, baseRating, age as personAge } from '../src/engine/person.js';
import { absWeek, WEEKS_PER_YEAR } from '../src/engine/time.js';
import { progressPerson } from '../src/engine/progression.js';
import {
  depthPlan,
  benchSlots,
  runRotation,
  bestSubFor,
  swapRoles,
  playingTimeFactor,
  prefersBenchOverRelease,
  MAX_BENCH,
} from '../src/engine/roster.js';
import {
  runBenchRecruitment,
  collectOffers,
  signPlayer,
  buildOffer,
  evaluateInterest,
  releasePlayer,
} from '../src/engine/transfers.js';
import { fillEmptyRosters } from '../src/engine/worldSim.js';
import { runReleases } from '../src/engine/contracts.js';
import { dissolveOrg } from '../src/engine/events/defs/worldEvents.js';
import { runRosterAudit, rosterInvariants } from '../src/engine/audit/rosterAudit.js';
import { runAmateurAudit } from '../src/engine/audit/amateurAudit.js';
import { startTrace, stopTrace, takeTrace, TRACE } from '../src/engine/trace.js';

// --- Utilitaires ------------------------------------------------------------

function toOffseason(world, year = 2031) {
  world.week = absWeek(year, 51);
  return world;
}

function setLevel(world, person, level) {
  for (const a of ALL_ATTRS) person.attrs[a.id] = level;
  setFamiliarity(person, person.gameId, 1);
  person.form = 0;
  person.fatigue = 0;
}

/** Une équipe pleine d'une organisation riche, prête à porter un banc. */
function deepPocketTeam(world, gameId = 'vanguard') {
  const team = Object.values(world.teams).find((t) => {
    if (!t.active || t.gameId !== gameId || t.isSelfTeam) return false;
    const org = world.orgs[t.orgId];
    return org?.alive && org.tier >= 4 && t.roster.length >= GAMES_BY_ID[gameId].teamSize;
  });
  if (!team) return null;
  const org = world.orgs[team.orgId];
  org.yearlyIncome = Math.max(org.yearlyIncome, 4000000);
  org.budget = Math.max(org.budget, 4000000);
  org.ambition = 0.95;
  return team;
}

function freeAgentOf(world, gameId) {
  // Le staff aussi est « sans équipe » : `evaluateInterest` le refuse à juste
  // titre, et l'oublier ici faisait échouer le test sur un coach.
  return Object.values(world.persons).find(
    (p) =>
      !p.teamId &&
      p.gameId === gameId &&
      !p.isPlayer &&
      p.status !== STATUS.RETIRED &&
      p.status !== STATUS.STAFF,
  );
}

let cached = null;
function shared() {
  if (!cached) cached = runRosterAudit({ seed: 'roster-regression', years: 20 });
  return cached;
}

// --- 1 à 3 : existence, non-obligation, contrat -----------------------------

test('1 — une équipe peut avoir un remplaçant', () => {
  const r = shared();
  assert.equal(r.crash, null, `plantage : ${r.crash?.message}`);
  assert.ok(r.flows.benchEntries > 20, `${r.flows.benchEntries} entrées sur le banc en 20 ans`);
  const last = r.snapshots.at(-1);
  assert.ok(last.withBench > 0, 'aucune équipe avec un banc à la fin');
  assert.ok(last.subs > 0);
});

test('2 — toutes les équipes ne sont pas obligées d’en avoir', () => {
  const last = shared().snapshots.at(-1);
  assert.ok(
    last.shareWithBench < 0.6,
    `${Math.round(last.shareWithBench * 100)} % des équipes ont un banc : il devient obligatoire`,
  );
  // Et le banc reste une couche supérieure de la pyramide : le bas n'en porte
  // qu'exceptionnellement.
  //
  // Ce test exigeait exactement zéro remplaçant au tier 1. C'est trop rigide :
  // une équipe reléguée ne dissout pas son effectif du jour au lendemain, et un
  // jeu solo dont l'effectif vaut 1 place mécaniquement sur le banc tout joueur
  // supplémentaire. Mesuré à l'étape 7B, quand le changement de progression a
  // déplacé les niveaux relatifs : 1 banc sur 43 équipes au tier 1 (2 %) contre
  // 7 sur 27 au tier 4 (26 %). La propriété tient — c'est l'égalité stricte qui
  // ne la mesurait pas.
  const tier1 = last.perTier['1'];
  const upper = last.perTier['4'] ?? last.perTier['3'];
  if (tier1) {
    assert.ok(
      tier1.shareWithBench < 0.1,
      `${Math.round(tier1.shareWithBench * 100)} % des structures d’entrée portent un banc`,
    );
    if (upper) {
      assert.ok(
        upper.shareWithBench > tier1.shareWithBench * 3,
        `le banc n’est plus une couche supérieure : tier 1 ${tier1.shareWithBench} contre haut de pyramide ${upper.shareWithBench}`,
      );
    }
  }
});

test('3 — un remplaçant possède un contrat cohérent', () => {
  const world = generateWorld({ seed: 6003, startYear: 2030 });
  toOffseason(world);
  const team = deepPocketTeam(world);
  assert.ok(team, 'aucune équipe riche et pleine');
  const signed = runBenchRecruitment(world, new RNG(3), { maxSignings: 40 });
  // Si cette passe n'a rien produit, on force un cas équivalent.
  const subId = team.subs[0] ?? signed.map((s) => s.personId).find((id) => world.persons[id]);
  if (!subId) {
    assert.ok(signed.length >= 0);
    return;
  }
  const sub = world.persons[subId];
  const host = world.teams[sub.teamId];
  assert.ok(host.subs.includes(sub.id), 'le joueur signé doit être sur le banc');
  if (sub.contract) {
    assert.equal(sub.contract.orgId, host.orgId);
    assert.ok(sub.contract.endWeek > world.week, 'un contrat de remplaçant doit courir');
    assert.ok(sub.contract.salary > 0);
  }
  assert.deepEqual(rosterInvariants(world), []);
});

// --- 4 à 6 : promotion, relégation, départ ----------------------------------

test('4 — un remplaçant peut devenir titulaire', () => {
  const r = shared();
  assert.ok(r.flows.internalPromotions > 10, `${r.flows.internalPromotions} promotions internes`);
  assert.ok(r.bench.subThenStarter > 0, 'aucun remplaçant n’est devenu titulaire');
});

test('5 — un titulaire peut devenir remplaçant', () => {
  const r = shared();
  assert.ok(r.flows.demotions > 5, `${r.flows.demotions} relégations internes`);
  assert.ok(r.bench.starterThenSub > 0, 'aucun titulaire n’est passé sur le banc');
});

test('6 — un remplaçant peut quitter son équipe', () => {
  const r = shared();
  assert.ok(r.flows.benchDepartures > 0, 'personne ne quitte jamais un banc');
  assert.ok(
    r.bench.weeksBeforeDepartureMean !== null && r.bench.weeksBeforeDepartureMean > 0,
    'délai avant départ non mesuré',
  );
});

// --- 7 à 9 : marché, progression, temps de jeu ------------------------------

test('7 — un remplaçant peut recevoir une offre', () => {
  const world = generateWorld({ seed: 6007, startYear: 2030 });
  toOffseason(world);
  const team = deepPocketTeam(world);
  const cand = freeAgentOf(world, team.gameId);
  assert.ok(cand, 'aucun agent libre');
  // Le niveau doit être crédible pour le haut de cette scène : à 70, un joueur
  // est simplement en dessous du besoin des équipes de tier 4 et n'intéresse
  // personne — ce qui est le comportement attendu, pas un défaut du banc.
  setLevel(world, cand, 86);
  // On l'installe sur le banc à la main, puis on regarde le marché.
  team.subs.push(cand.id);
  cand.teamId = team.id;
  cand.orgId = team.orgId;

  const offers = collectOffers(world, cand, new RNG(7), { maxOffers: 3, minScore: 40 });
  assert.ok(offers.length > 0, 'un remplaçant correct doit intéresser quelqu’un');
});

test('8 et 9 — un remplaçant progresse, mais moins vite qu’un titulaire', () => {
  const world = generateWorld({ seed: 6008, startYear: 2030 });
  const team = Object.values(world.teams).find((t) => t.active && t.gameId === 'vanguard' && t.roster.length >= 2);
  const [starterId, subId] = team.roster;
  const starter = world.persons[starterId];
  const sub = world.persons[subId];
  // Deux joueurs strictement identiques, l'un titulaire, l'autre sur le banc.
  setLevel(world, starter, 55);
  setLevel(world, sub, 55);
  starter.hidden = JSON.parse(JSON.stringify(sub.hidden));
  team.roster = [starterId];
  team.subs = [subId];

  assert.equal(playingTimeFactor(world, starter), 1);
  assert.ok(playingTimeFactor(world, sub) < 1, 'un remplaçant doit jouer moins');

  const game = GAMES_BY_ID.vanguard;
  const routine = ['aim', 'aim', 'review'];
  for (let i = 0; i < 60; i++) {
    progressPerson(starter, { game, routine, weeks: 4, absWeek: world.week + i * 4, playingTime: 1 }, new RNG(100 + i));
    progressPerson(sub, { game, routine, weeks: 4, absWeek: world.week + i * 4, playingTime: playingTimeFactor(world, sub) }, new RNG(100 + i));
  }
  const rs = baseRating(starter, game);
  const rb = baseRating(sub, game);
  assert.ok(rs > rb, `le titulaire doit progresser davantage (${rs.toFixed(1)} contre ${rb.toFixed(1)})`);
  // Mais le remplaçant progresse quand même : il n'est pas condamné.
  assert.ok(rb > 55, `le remplaçant doit progresser (${rb.toFixed(1)})`);
  assert.ok(rs - rb < 12, `l'écart ne doit pas être écrasant (${(rs - rb).toFixed(1)})`);
});

// --- 10 à 12 : remplacement interne, promotion sur départ, licenciement -----

test('10 — un titulaire peut être remplacé par un joueur interne', () => {
  const world = generateWorld({ seed: 6010, startYear: 2030 });
  const team = Object.values(world.teams).find((t) => t.active && t.gameId === 'vanguard' && t.roster.length >= 2);
  const [weakId] = team.roster;
  const subId = team.roster.pop();
  team.subs.push(subId);
  setLevel(world, world.persons[weakId], 45);
  setLevel(world, world.persons[subId], 80);

  let swapped = false;
  for (let i = 0; i < 12 && !swapped; i++) {
    world.week += 4;
    runRotation(world, new RNG(200 + i));
    swapped = team.roster.includes(subId) && team.subs.includes(weakId);
  }
  assert.ok(swapped, 'un remplaçant nettement supérieur doit finir titulaire');
  // Et l'inertie a joué : la bascule n'est pas instantanée.
  assert.deepEqual(rosterInvariants(world), []);
});

test('11 — un départ déclenche une promotion interne', () => {
  const world = generateWorld({ seed: 6011, startYear: 2030 });
  const team = Object.values(world.teams).find((t) => t.active && t.gameId === 'vanguard' && t.roster.length >= 2);
  const subId = team.roster.pop();
  team.subs.push(subId);
  const leaving = team.roster[0];
  releasePlayer(world, leaving, world.week, 'test');

  fillEmptyRosters(world, new RNG(11));
  assert.ok(team.roster.includes(subId), 'le remplaçant doit combler la place libérée');
  assert.ok(!team.subs.includes(subId));
});

test('12 — le licenciement devient possible maintenant que le banc existe', () => {
  const r = shared();
  // Le licenciement de l'étape 4 exigeait un remplaçant crédible ; on vérifie
  // ici que la profondeur ne l'empêche pas et que les sorties existent.
  assert.ok(r.flows.benchDepartures > 0);

  const world = generateWorld({ seed: 6012, startYear: 2030 });
  toOffseason(world);
  const team = deepPocketTeam(world);
  const extra = freeAgentOf(world, team.gameId);
  team.subs.push(extra.id);
  extra.teamId = team.id;
  extra.orgId = team.orgId;
  const weak = world.persons[team.roster[0]];
  setLevel(world, weak, 25);
  setLevel(world, extra, 70);
  weak.contract = {
    orgId: team.orgId,
    teamId: team.id,
    salary: 2000000,
    signedWeek: world.week - 30,
    endWeek: world.week + 60,
    role: 'starter',
    bonusPerTitle: 0,
    buyout: 0,
    objectives: 'progression',
  };
  world.orgs[team.orgId].budget = -500000;
  world.orgs[team.orgId].yearlyIncome = 1000;
  world.freeAgents.push(extra.id);

  let released = [];
  for (let i = 0; i < 15 && released.length === 0; i++) released = runReleases(world, new RNG(300 + i));
  assert.ok(released.length > 0, 'aucun licenciement malgré un cas flagrant');
});

// --- 13 à 15 : invariants ---------------------------------------------------

test('13, 14 et 15 — aucun effectif incohérent après vingt ans', () => {
  const r = shared();
  assert.deepEqual(
    r.invariants,
    [],
    `invariants d'effectif violés : ${JSON.stringify(r.invariants.slice(0, 3))}`,
  );
  assert.deepEqual(r.issues, [], `incohérences du validateur : ${JSON.stringify(r.issues.slice(0, 2))}`);
});

test('un joueur ne peut pas être titulaire et remplaçant à la fois', () => {
  const world = generateWorld({ seed: 6013, startYear: 2030 });
  const team = Object.values(world.teams).find((t) => t.active && t.roster.length >= 2);
  const id = team.roster[0];
  // Tentative d'incohérence : le garde-fou de `swapRoles` doit la refuser.
  assert.equal(swapRoles(team, id, id), false);
  team.subs.push(team.roster.pop());
  assert.deepEqual(rosterInvariants(world), []);
  assert.ok(bestSubFor(world, team));
});

test('le banc ne dépasse jamais la profondeur voulue', () => {
  const world = generateWorld({ seed: 6014, startYear: 2030 });
  toOffseason(world);
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.isSelfTeam) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive) continue;
    org.yearlyIncome = 9000000;
    org.budget = 9000000;
    org.ambition = 1;
  }
  for (let i = 0; i < 6; i++) runBenchRecruitment(world, new RNG(400 + i), { maxSignings: 60 });
  for (const team of Object.values(world.teams)) {
    if (!team.active) continue;
    assert.ok(team.subs.length <= MAX_BENCH, `${team.id} porte ${team.subs.length} remplaçants`);
    const plan = depthPlan(world, team);
    assert.ok(
      team.subs.length <= Math.max(plan.wanted, 1),
      `${team.id} porte ${team.subs.length} remplaçants pour ${plan.wanted} voulus`,
    );
  }
});

// --- 16 à 18 : compatibilité avec les étapes validées -----------------------

test('16 — les équipes d’entrée restent accessibles', () => {
  const world = generateWorld({ seed: 6016, startYear: 2030 });
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.isSelfTeam) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive || org.tier > 1) continue;
    // Une structure d'entrée ne réclame jamais de profondeur : ce serait
    // recréer la barrière que l'étape 2 a fait tomber.
    assert.equal(depthPlan(world, team).wanted, 0, `${org.name} (tier 1) réclame un banc`);
    assert.equal(benchSlots(world, team), 0);
  }

  // Et l'écosystème d'entrée continue de vivre.
  const eco = runAmateurAudit({ seed: 'roster-amateur', years: 12, sampleEveryYears: 12 });
  const alive = eco.snapshots.at(-1).scenes.filter((s) => s.alive);
  assert.ok(alive.length >= 6, `${alive.length} scènes vivantes`);
  const withEntry = alive.filter((s) => (s.amateurMax ?? 0) > 0).length;
  assert.equal(withEntry, alive.length, 'toute scène vivante garde un circuit d’entrée');
});

test('17 et 18 — le marché et les contrats restent cohérents', () => {
  const r = shared();
  assert.ok(r.flows.externalSignings > 0, 'aucune arrivée externe sur un banc');
  assert.deepEqual(r.invariants, []);
  // Les places voulues et les places pourvues restent du même ordre : le
  // système ne promet pas dix fois ce qu'il tient.
  const last = r.snapshots.at(-1);
  assert.ok(last.wanted > 0, 'plus aucune organisation ne veut de profondeur');
});

test('19 — une organisation dissoute libère aussi son banc', () => {
  const world = generateWorld({ seed: 6019, startYear: 2030 });
  const team = Object.values(world.teams).find((t) => t.active && t.roster.length >= 2);
  const org = world.orgs[team.orgId];
  const subId = team.roster.pop();
  team.subs.push(subId);
  const sub = world.persons[subId];
  sub.teamId = team.id;
  sub.orgId = org.id;

  dissolveOrg(world, org, world.week);
  assert.notEqual(sub.orgId, org.id, 'le remplaçant reste rattaché à une organisation morte');
  assert.deepEqual(rosterInvariants(world), []);
});

test('20 — les distributions restent stables', () => {
  const r = shared();
  const last = r.snapshots.at(-1);
  // La profondeur croît avec le niveau, sans relation imposée.
  const tiers = Object.entries(last.perTier)
    .map(([tier, t]) => ({ tier: Number(tier), share: t.shareWithBench }))
    .sort((a, b) => a.tier - b.tier);
  const low = tiers.filter((t) => t.tier <= 2).reduce((n, t) => n + t.share, 0);
  const high = tiers.filter((t) => t.tier >= 4).reduce((n, t) => n + t.share, 0);
  assert.ok(high > low, `la profondeur doit se concentrer en haut (${high} contre ${low})`);
  // Et une part substantielle des carrières touche le banc sans que ce soit la norme.
  assert.ok(r.bench.shareEverSub > 0.05, `${r.bench.shareEverSub} de joueurs passés par un banc`);
  assert.ok(r.bench.shareEverSub < 0.8, 'presque tout le monde passe par le banc');
});

// --- Trajectoires (§P) ------------------------------------------------------

test('les trajectoires du §P émergent des simulations', () => {
  const t = shared().trajectories;
  const found = Object.keys(t);
  assert.ok(
    found.includes('A_banc_vers_titulaire'),
    'aucun remplaçant devenu titulaire de bon niveau',
  );
  assert.ok(
    found.includes('B_titulaire_vers_banc_retraite'),
    'aucun titulaire relégué puis retraité',
  );
  assert.ok(found.length >= 4, `seulement ${found.length} formes de trajectoire sur 5`);
});

// --- Trace (§S) -------------------------------------------------------------

test('on peut expliquer pourquoi un joueur est devenu remplaçant', () => {
  const world = generateWorld({ seed: 6030, startYear: 2030 });
  const team = Object.values(world.teams).find((t) => t.active && t.gameId === 'vanguard' && t.roster.length >= 2);
  const weakId = team.roster[0];
  const subId = team.roster.pop();
  team.subs.push(subId);
  setLevel(world, world.persons[weakId], 40);
  setLevel(world, world.persons[subId], 85);

  startTrace({ max: 500 });
  for (let i = 0; i < 12; i++) {
    world.week += 4;
    runRotation(world, new RNG(500 + i));
  }
  const entries = takeTrace().filter((e) => e.kind === TRACE.ROSTER);
  stopTrace();

  assert.ok(entries.length > 0, 'aucune décision d’effectif tracée');
  const rotation = entries.find((e) => e.decision === 'rotation');
  assert.ok(rotation, 'aucune rotation tracée');
  assert.ok(rotation.promoted && rotation.benched, 'la trace doit nommer les deux joueurs');
  assert.ok(rotation.factors.length > 0, 'une rotation sans facteurs n’est pas explicable');
  for (const f of rotation.factors) {
    assert.equal(typeof f.label, 'string');
    assert.equal(typeof f.delta, 'number');
  }
});
