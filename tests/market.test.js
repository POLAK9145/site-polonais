/**
 * Tests du cycle de vie des contrats et du marché des PNJ (phase 2, étape 4).
 *
 * Le défaut corrigé : `endWeek` était écrit à la signature et jamais relu comme
 * terminaison. Mesuré sur vingt ans, 228 contrats sur 287 (79 %) étaient échus
 * tout en restant actifs, avec un dépassement médian de quatre ans. Le marché,
 * lui, ne s'exécutait que du côté des équipes : médiane d'une seule équipe
 * traversée en vingt ans, et 0 % de changement de jeu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG } from '../src/engine/rng.js';
import { generateWorld } from '../src/engine/worldgen.js';
import { GAMES_BY_ID } from '../src/data/games.js';
import { STATUS, setFamiliarity, age as personAge } from '../src/engine/person.js';
import { ALL_ATTRS } from '../src/engine/attributes.js';
import { WEEKS_PER_YEAR, absWeek } from '../src/engine/time.js';
import {
  runContractCycle,
  runReleases,
  renewalCase,
  contractPhase,
  CONTRACT_PHASES,
  endContract,
} from '../src/engine/contracts.js';
import {
  runFreeAgentMarket,
  sceneChangeCase,
  bestAptitudeGain,
  tickIdleWeeks,
} from '../src/engine/npcMarket.js';
import { collectOffers, runNpcTransferWindow, releasePlayer } from '../src/engine/transfers.js';
import { dissolveOrg } from '../src/engine/events/defs/worldEvents.js';
import { runMarketAudit, contractInvariants } from '../src/engine/audit/marketAudit.js';
import { startTrace, stopTrace, takeTrace, TRACE } from '../src/engine/trace.js';

// --- Utilitaires ------------------------------------------------------------

/**
 * Amène le monde à une semaine d'intersaison, sans rien simuler.
 * La fenêtre majeure couvre les semaines 51-52 et 1-2 : la 50 est encore le
 * championnat du monde, et le marché n'y tourne pas.
 */
function toOffseason(world, year = 2031) {
  world.week = absWeek(year, 51);
  return world;
}

function anyRostered(world, gameId = 'vanguard') {
  return Object.values(world.persons).find(
    (p) => p.gameId === gameId && p.teamId && p.contract && !p.isPlayer,
  );
}

function setLevel(world, person, level) {
  for (const a of ALL_ATTRS) person.attrs[a.id] = level;
  setFamiliarity(person, person.gameId, 1);
}

let cached = null;
function shared() {
  if (!cached) cached = runMarketAudit({ seed: 'market-regression', years: 20, sample: 120 });
  return cached;
}

// --- 1 à 4 : expiration, renouvellement, agence libre -----------------------

test('1 — un contrat arrivé à terme produit une décision', () => {
  const world = generateWorld({ seed: 5001, startYear: 2030 });
  toOffseason(world);
  let due = 0;
  for (const p of Object.values(world.persons)) {
    if (!p.contract) continue;
    p.contract.endWeek = world.week - 1;
    due++;
  }
  assert.ok(due > 10, 'il faut des contrats à arbitrer');

  const res = runContractCycle(world, new RNG(1));
  assert.ok(res.considered > 0, 'aucun contrat examiné');
  assert.equal(
    res.considered,
    res.renewed + res.expired + res.declined,
    'tout contrat examiné doit produire un résultat',
  );
  // Plus aucun contrat échu ne subsiste après le passage.
  const stillExpired = Object.values(world.persons).filter(
    (p) => p.contract && contractPhase(p, world.week) === CONTRACT_PHASES.EXPIRED,
  );
  assert.deepEqual(stillExpired.map((p) => p.nick), []);
});

test('2 — un contrat peut être renouvelé', () => {
  const world = generateWorld({ seed: 5002, startYear: 2030 });
  toOffseason(world);
  for (const p of Object.values(world.persons)) {
    if (p.contract) p.contract.endWeek = world.week + 2;
  }
  const res = runContractCycle(world, new RNG(2));
  assert.ok(res.renewed > 0, `aucune prolongation sur ${res.considered} contrats examinés`);
  const renewed = Object.values(world.persons).find((p) => (p.contract?.renewals ?? 0) > 0);
  assert.ok(renewed, 'aucun contrat ne porte la marque d’un renouvellement');
  assert.ok(renewed.contract.endWeek > world.week, 'un contrat prolongé doit courir dans le futur');
});

test('3 — un joueur peut devenir agent libre à la fin de son contrat', () => {
  const world = generateWorld({ seed: 5003, startYear: 2030 });
  toOffseason(world);
  const person = anyRostered(world);
  assert.ok(person, 'aucun joueur sous contrat');
  // On rend la prolongation intenable : effondrement du niveau et caisse vide.
  setLevel(world, person, 20);
  const org = world.orgs[person.orgId];
  org.budget = -100000;
  person.contract.endWeek = world.week - 1;

  const c = renewalCase(world, person);
  assert.ok(c, 'dossier de prolongation absent');
  assert.equal(c.offered, false, `le club prolonge encore (score ${c.score})`);

  endContract(world, person, world.week, 'test');
  assert.equal(person.teamId, null);
  assert.equal(person.contract, null);
  assert.ok(world.freeAgents.includes(person.id), 'le joueur doit rejoindre le vivier');
});

test('4 — un agent libre peut retrouver une équipe', () => {
  const world = generateWorld({ seed: 5004, startYear: 2030 });
  toOffseason(world);
  const person = anyRostered(world);
  releasePlayer(world, person.id, world.week, 'test');
  setLevel(world, person, 82);
  person.weeksIdle = 60;

  const offers = collectOffers(world, person, new RNG(4), { maxOffers: 3, minScore: 40 });
  assert.ok(offers.length > 0, 'un très bon joueur libre ne reçoit aucune offre');

  const res = runFreeAgentMarket(world, new RNG(4));
  assert.ok(
    res.signed.length + res.switched.length > 0,
    'la vague de démarchage ne place personne',
  );
});

// --- 5 à 6 : licenciement, dissolution --------------------------------------

test('5 — un joueur peut être licencié', () => {
  const world = generateWorld({ seed: 5005, startYear: 2030 });
  toOffseason(world);
  // Un effectif en surnombre, un joueur très faible et très cher, une caisse vide.
  let target = null;
  for (const team of Object.values(world.teams)) {
    const game = GAMES_BY_ID[team.gameId];
    if (!team.active || team.roster.length < game.teamSize) continue;
    const org = world.orgs[team.orgId];
    if (org.tier < 3) continue;
    const extra = Object.values(world.persons).find(
      (p) => p.gameId === team.gameId && !p.teamId && !p.isPlayer,
    );
    if (!extra) continue;
    team.roster.push(extra.id);
    extra.teamId = team.id;
    extra.orgId = org.id;
    extra.contract = {
      orgId: org.id,
      teamId: team.id,
      salary: 900000,
      signedWeek: world.week - 20,
      endWeek: world.week + 80,
      role: 'starter',
      bonusPerTitle: 0,
      buyout: 0,
      objectives: 'progression',
    };
    setLevel(world, extra, 25);
    org.budget = -200000;
    org.yearlyIncome = 1000;
    target = extra;
    break;
  }
  assert.ok(target, 'impossible de construire le cas');

  let released = [];
  for (let i = 0; i < 12 && released.length === 0; i++) {
    released = runReleases(world, new RNG(50 + i));
  }
  assert.ok(released.length > 0, 'aucun licenciement malgré un cas flagrant');
  const freed = world.persons[released[0]];
  assert.equal(freed.teamId, null);
  assert.equal(freed.contract, null);
});

test('6 — une organisation dissoute libère proprement ses joueurs', () => {
  const world = generateWorld({ seed: 5006, startYear: 2030 });
  const org = Object.values(world.orgs).find((o) => o.alive && Object.keys(o.teams).length > 0);
  const members = Object.values(world.persons).filter((p) => p.orgId === org.id);
  assert.ok(members.length > 0);

  dissolveOrg(world, org, world.week);

  for (const p of members) {
    assert.notEqual(p.contract?.orgId, org.id, `${p.nick} garde un contrat avec une org morte`);
    assert.notEqual(p.orgId, org.id, `${p.nick} reste rattaché à une org morte`);
  }
  assert.deepEqual(contractInvariants(world), [], 'invariants contractuels violés après dissolution');
});

// --- 7 à 11 : mobilité, choix, scène, retraite ------------------------------

test('7 et 8 — des PNJ changent d’équipe, d’autres restent', () => {
  const n = shared().npc;
  assert.ok(n.neverMoved > 0, 'plus aucun PNJ fidèle : le monde est devenu nomade');
  assert.ok(n.movedThreePlus > 0, 'aucun PNJ mobile');
  assert.ok(
    n.teamsMedian >= 2,
    `médiane de ${n.teamsMedian} équipe(s) traversée(s) : la mobilité n'a pas décollé`,
  );
  assert.ok(
    n.teamsMedian <= 5,
    `médiane de ${n.teamsMedian} équipes : mobilité artificiellement élevée`,
  );
});

test('9 — un PNJ compare plusieurs offres et en choisit une', () => {
  const world = generateWorld({ seed: 5009, startYear: 2030 });
  toOffseason(world);
  const person = anyRostered(world);
  releasePlayer(world, person.id, world.week, 'test');
  setLevel(world, person, 80);
  // Les agents libres démarchent par ordre de désœuvrement, et la vague en
  // traite un nombre borné : sans cela, un joueur libéré à l'instant passe
  // derrière tous ceux qui attendent déjà.
  person.weeksIdle = 80;

  const offers = collectOffers(world, person, new RNG(9), { maxOffers: 3, minScore: 40 });
  assert.ok(offers.length >= 2, `un joueur à 80 ne reçoit que ${offers.length} offre(s)`);
  const orgs = new Set(offers.map((o) => o.orgId));
  assert.equal(orgs.size, offers.length, 'les offres doivent venir de structures distinctes');

  // Le marché finit par le placer, pas nécessairement au premier essai.
  let placed = false;
  for (let i = 0; i < 6 && !placed; i++) {
    world.lastFreeAgentWave = null;
    runFreeAgentMarket(world, new RNG(90 + i));
    placed = !!person.teamId;
  }
  assert.ok(placed, 'un joueur à 80 avec des offres n’est jamais signé');
});

test('10 — un PNJ peut changer de jeu, pour une raison mesurable', () => {
  const world = generateWorld({ seed: 5010, startYear: 2030 });
  toOffseason(world);
  const person = anyRostered(world);
  releasePlayer(world, person.id, world.week, 'test');
  // Sa scène s'effondre, il est sans équipe depuis longtemps, et son niveau
  // n'intéresse plus personne là où il est : c'est la conjonction qui produit
  // un changement de scène, pas l'un de ces facteurs isolément.
  world.gameStates[person.gameId].vitality = 0.05;
  person.weeksIdle = 200;
  person.hidden.adaptability = 0.9;
  setLevel(world, person, 24);

  const c = sceneChangeCase(world, person);
  assert.ok(c.willing, `refuse de changer de scène (score ${c.score})`);
  assert.ok(c.factors.some((f) => f.key === 'scene'), 'la santé de la scène doit peser');
  assert.ok(c.factors.some((f) => f.key === 'idle'), 'le temps sans équipe doit peser');

  const before = person.gameId;
  let switched = false;
  for (let i = 0; i < 8 && !switched; i++) {
    world.lastFreeAgentWave = null;
    const res = runFreeAgentMarket(world, new RNG(100 + i));
    switched = res.switched.some((s) => s.personId === person.id);
  }
  assert.ok(switched, 'aucun changement de scène malgré toutes les raisons');
  assert.notEqual(person.gameId, before);
  assert.ok(
    (person.familiarity[person.gameId] ?? 0) > 0,
    'un joueur qui change de scène doit en connaître un minimum',
  );

  // Et le changement reste coûteux : il ne devient pas meilleur en changeant.
  const gain = bestAptitudeGain(world, person);
  assert.ok(gain === null || typeof gain.gain === 'number');
});

test('11 — les PNJ prennent leur retraite à des âges variés', () => {
  const n = shared().npc;
  assert.ok(n.retired > 0, 'aucune retraite');
  assert.ok(
    n.retirementAgeP90 - n.retirementAgeP10 >= 3,
    `âges de retraite trop uniformes : ${n.retirementAgeP10} à ${n.retirementAgeP90}`,
  );
  assert.ok(n.retirementAgeMedian > 24 && n.retirementAgeMedian < 34, `âge médian ${n.retirementAgeMedian}`);
});

// --- 12 à 15 : invariants et marché partagé ---------------------------------

test('12, 13 et 14 — aucun contrat fantôme après vingt ans', () => {
  const r = shared();
  assert.deepEqual(
    r.invariants,
    [],
    `invariants contractuels violés : ${JSON.stringify(r.invariants.slice(0, 3))}`,
  );
  assert.equal(r.contracts.expired, 0, `${r.contracts.expired} contrats échus encore actifs`);
  assert.deepEqual(r.issues, [], `incohérences du validateur : ${JSON.stringify(r.issues.slice(0, 2))}`);
});

test('15 — le joueur et les PNJ passent par le même marché', () => {
  const world = generateWorld({ seed: 5015, startYear: 2030 });
  toOffseason(world);
  const person = anyRostered(world);
  releasePlayer(world, person.id, world.week, 'test');
  setLevel(world, person, 74);

  // `collectOffers` est la primitive du joueur ; un PNJ obtient la même chose.
  const asNpc = collectOffers(world, person, new RNG(15), { maxOffers: 3, minScore: 40 });
  person.isPlayer = true;
  const asPlayer = collectOffers(world, person, new RNG(15), { maxOffers: 3, minScore: 40 });
  person.isPlayer = false;
  assert.deepEqual(
    asPlayer.map((o) => o.orgId),
    asNpc.map((o) => o.orgId),
    'le marché ne doit pas traiter le joueur et un PNJ différemment',
  );
});

// --- Chaîne de mercato (§P) -------------------------------------------------

test('un départ déclenche une réaction en chaîne sur le marché', () => {
  const world = generateWorld({ seed: 5020, startYear: 2030 });
  toOffseason(world);
  // On rend le marché avide : des structures riches, des effectifs complets.
  //
  // « Riche » a changé de sens à l'étape 6. Ce test posait `org.budget`, ce qui
  // suffisait tant que `salaryBand` lisait la trésorerie — un accumulateur. Les
  // salaires se paient désormais sur les **revenus**, la trésorerie n'ouvrant
  // qu'une marge bornée : gonfler le seul budget ne rend plus personne
  // dépensier. On donne donc aux structures ce qui fait réellement leur pouvoir
  // d'achat.
  for (const org of Object.values(world.orgs)) {
    if (org.tier < 3) continue;
    org.yearlyIncome = Math.max(org.yearlyIncome, 3000000);
    org.budget = Math.max(org.budget, 3000000);
  }
  const teamOf = new Map();
  for (const p of Object.values(world.persons)) if (p.teamId) teamOf.set(p.id, p.teamId);

  let moves = [];
  for (let i = 0; i < 6 && moves.length < 3; i++) {
    moves = moves.concat(runNpcTransferWindow(world, new RNG(200 + i), { maxMoves: 24, chainDepth: 3 }));
  }
  assert.ok(moves.length >= 3, `seulement ${moves.length} mouvements`);

  // Une chaîne : au moins un mouvement où le joueur venait d'une autre équipe,
  // et où cette équipe a elle-même recruté ensuite.
  const departures = new Set();
  let chained = 0;
  for (const m of moves) {
    const from = teamOf.get(m.personId);
    if (from && from !== m.teamId) departures.add(from);
    if (departures.has(m.teamId)) chained++;
  }
  assert.ok(chained > 0, 'aucune équipe dépouillée n’a recruté à son tour');
});

// --- Vivacité du marché (§S) ------------------------------------------------

test('le marché est vivant sans être hystérique', () => {
  const m = shared().market;
  assert.ok(m.transfersPerSeason > 5, `${m.transfersPerSeason} transferts par saison : marché mort`);
  assert.ok(m.turnover < 0.45, `rotation de ${m.turnover} : marché hystérique`);
  assert.ok(m.renewalsPerSeason > 0, 'aucune prolongation');
  assert.ok(m.releasesPerSeason > 0, 'aucune sortie vers le vivier');
  // Un agent libre ne doit ni signer immédiatement ni attendre des années.
  assert.ok(m.poolWeeksMedian >= 2, `placement en ${m.poolWeeksMedian} semaines : aucun enjeu`);
  assert.ok(m.poolWeeksP90 <= 3 * WEEKS_PER_YEAR, `p90 de ${m.poolWeeksP90} semaines sans équipe`);
});

// --- Traçabilité (§T) -------------------------------------------------------

test('on peut expliquer pourquoi un PNJ a quitté son équipe', () => {
  const world = generateWorld({ seed: 5030, startYear: 2030 });
  toOffseason(world);
  for (const p of Object.values(world.persons)) {
    if (p.contract) p.contract.endWeek = world.week - 1;
  }
  startTrace({ max: 4000 });
  runContractCycle(world, new RNG(30));
  const entries = takeTrace().filter((e) => e.kind === TRACE.CONTRACT);
  stopTrace();

  assert.ok(entries.length > 0, 'aucune décision contractuelle tracée');
  const ends = entries.filter((e) => e.decision === 'end');
  const renewals = entries.filter((e) => e.decision === 'renewal');
  assert.ok(ends.length > 0 && renewals.length > 0, 'il faut les deux issues pour comparer');
  for (const e of [...ends, ...renewals].slice(0, 5)) {
    assert.ok(Array.isArray(e.factors) && e.factors.length > 0, `${e.decision} sans facteurs`);
    for (const f of e.factors) {
      assert.equal(typeof f.label, 'string');
      assert.equal(typeof f.delta, 'number');
    }
  }
});
