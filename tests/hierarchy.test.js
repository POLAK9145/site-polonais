/**
 * Tests de la hiérarchie (phase 2, étape 3).
 *
 * Le système corrigé : montée et descente étaient soudées dans un seul `if`
 * (79 montées pour exactement 79 descentes en 30 ans), une seule paire était
 * examinée par région, et la décision reposait sur une comparaison de puissance
 * instantanée qui expliquait 315 des 320 refus.
 *
 * Ces tests ne cherchent pas à prouver qu'une équipe montera : ils prouvent que
 * le système le lui **permet réellement**, et que l'inverse est vrai aussi.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG } from '../src/engine/rng.js';
import { generateWorld } from '../src/engine/worldgen.js';
import { ALL_ATTRS } from '../src/engine/attributes.js';
import { GAMES_BY_ID } from '../src/data/games.js';
import { STATUS, setFamiliarity } from '../src/engine/person.js';
import { teamStrength } from '../src/engine/team.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import {
  applyHierarchyChanges,
  promotionCase,
  relegationCase,
  sceneReference,
  refreshStatuses,
  statusForTier,
  recordHighestStatus,
  MAX_TIER,
} from '../src/engine/hierarchy.js';
import { runHierarchyAudit, hierarchyInvariants } from '../src/engine/audit/hierarchyAudit.js';
import { startTrace, stopTrace, takeTrace, TRACE } from '../src/engine/trace.js';

// --- Utilitaires de scénario -----------------------------------------------

function scene(world, gameId = 'vanguard') {
  return Object.values(world.teams).filter((t) => {
    if (!t.active || t.gameId !== gameId) return false;
    return world.orgs[t.orgId]?.alive;
  });
}

function teamsAtTier(world, gameId, tier) {
  return scene(world, gameId).filter((t) => world.orgs[t.orgId].tier === tier);
}

/** Impose un niveau à tout un effectif, pour construire un cas limite. */
function setRosterLevel(world, team, level) {
  for (const id of team.roster) {
    const p = world.persons[id];
    if (!p) continue;
    for (const a of ALL_ATTRS) p.attrs[a.id] = level;
    // `familiarity` est une table par jeu : l'écraser par un nombre ramenait
    // le facteur de familiarité à 0,45 et un effectif à 88 d'attributs
    // n'atteignait que 39,6 de niveau.
    setFamiliarity(p, team.gameId, 1);
    p.form = 0;
    p.fatigue = 0;
    p.morale = 70;
  }
  team.synergy = 70;
}

/** Écrit une saison plausible dans le carnet de l'équipe. */
function giveSeason(world, team, { played, wins, points, oppStrength, rank = 1, entrants = 8, tierLevel = 3 }) {
  team.season = {
    wins,
    losses: played - wins,
    points,
    played,
    mapWins: wins * 2,
    mapLosses: (played - wins) * 2,
    oppStrengthSum: oppStrength * played,
    placements: [{ rank, entrants, tierId: 'national', tierLevel }],
  };
  const gameId = team.gameId;
  world.seasonPoints ??= {};
  world.seasonPoints[gameId] ??= {};
  world.seasonPoints[gameId][team.id] = points;
}

function fund(world, team, { budget, income }) {
  const org = world.orgs[team.orgId];
  org.budget = budget;
  org.yearlyIncome = income;
}

// --- Cas A à E --------------------------------------------------------------

test('cas A — une équipe très forte en division inférieure peut monter', () => {
  const world = generateWorld({ seed: 4001, startYear: 2030 });
  const team = teamsAtTier(world, 'vanguard', 1)[0];
  assert.ok(team, 'aucune équipe de tier 1 dans la scène de test');

  setRosterLevel(world, team, 88);
  fund(world, team, { budget: 200000, income: 150000 });
  giveSeason(world, team, { played: 20, wins: 18, points: 340, oppStrength: 70, rank: 1, entrants: 8 });

  const ref = sceneReference(world, 'vanguard');
  const c = promotionCase(world, team, ref);
  assert.deepEqual(c.blockers, [], `bloquée par : ${c.blockers.join(', ')}`);
  assert.ok(c.eligible, `dossier refusé (score ${c.score})`);
  // Et le dossier est explicable, pas un score opaque.
  assert.ok(c.factors.length >= 4, 'dossier sans facteurs détaillés');
  assert.ok(c.factors.some((f) => f.key === 'target'), 'le niveau visé doit apparaître dans le dossier');
});

test('cas B — une équipe très faible en division supérieure peut descendre', () => {
  const world = generateWorld({ seed: 4002, startYear: 2030 });
  const team = teamsAtTier(world, 'vanguard', 4)[0] ?? teamsAtTier(world, 'vanguard', 3)[0];
  assert.ok(team, 'aucune équipe de haut de tableau dans la scène de test');

  setRosterLevel(world, team, 42);
  fund(world, team, { budget: -50000, income: 20000 });
  giveSeason(world, team, { played: 20, wins: 1, points: 8, oppStrength: 78, rank: 8, entrants: 8 });

  const ref = sceneReference(world, 'vanguard');
  const c = relegationCase(world, team, ref);
  assert.deepEqual(c.protections, [], `protégée par : ${c.protections.join(', ')}`);
  assert.ok(c.eligible, `dossier de relégation rejeté (score ${c.score})`);
});

test('cas C — à niveau proche, c’est la saison qui départage', () => {
  const world = generateWorld({ seed: 4003, startYear: 2030 });
  const tier1 = teamsAtTier(world, 'vanguard', 1);
  assert.ok(tier1.length >= 2, 'il faut deux équipes comparables');
  const [a, b] = tier1;

  // Même niveau, mêmes moyens : seule la saison diffère.
  setRosterLevel(world, a, 70);
  setRosterLevel(world, b, 70);
  fund(world, a, { budget: 80000, income: 60000 });
  fund(world, b, { budget: 80000, income: 60000 });
  giveSeason(world, a, { played: 18, wins: 15, points: 300, oppStrength: 66, rank: 1, entrants: 8 });
  giveSeason(world, b, { played: 18, wins: 5, points: 60, oppStrength: 66, rank: 6, entrants: 8 });

  const ref = sceneReference(world, 'vanguard');
  const ca = promotionCase(world, a, ref);
  const cb = promotionCase(world, b, ref);
  assert.ok(ca.score > cb.score + 15, `saisons non départagées : ${ca.score} contre ${cb.score}`);
});

test('cas D — une équipe puissante mais en mauvaise saison n’est pas intouchable', () => {
  const world = generateWorld({ seed: 4004, startYear: 2030 });
  const teams = teamsAtTier(world, 'vanguard', 4).length >= 2
    ? teamsAtTier(world, 'vanguard', 4)
    : teamsAtTier(world, 'vanguard', 3);
  assert.ok(teams.length >= 2, 'il faut deux équipes du même palier');
  const [strong, ordinary] = teams;

  // La puissante est nettement au-dessus… mais sa saison est ratée.
  setRosterLevel(world, strong, 86);
  setRosterLevel(world, ordinary, 78);
  fund(world, strong, { budget: 500000, income: 400000 });
  fund(world, ordinary, { budget: 500000, income: 400000 });
  giveSeason(world, strong, { played: 20, wins: 3, points: 20, oppStrength: 80, rank: 8, entrants: 8 });
  giveSeason(world, ordinary, { played: 20, wins: 13, points: 220, oppStrength: 80, rank: 2, entrants: 8 });

  const ref = sceneReference(world, 'vanguard');
  const cs = relegationCase(world, strong, ref);
  const co = relegationCase(world, ordinary, ref);
  assert.ok(
    cs.score > co.score,
    `la puissance protège encore : ${cs.score} contre ${co.score}`,
  );
  assert.ok(cs.score > 0, 'une saison ratée doit produire un dossier de relégation non nul');
});

test('cas E — une petite équipe avec une saison exceptionnelle peut créer une ascension', () => {
  // On répète le tirage : le test prouve que le système le permet, pas qu'il
  // le garantisse (§12).
  let promotions = 0;
  for (let seed = 0; seed < 12; seed++) {
    const world = generateWorld({ seed: 4100 + seed, startYear: 2030 });
    const team = teamsAtTier(world, 'vanguard', 1)[0];
    if (!team) continue;
    setRosterLevel(world, team, 80);
    fund(world, team, { budget: 120000, income: 90000 });
    giveSeason(world, team, { played: 22, wins: 19, points: 380, oppStrength: 68, rank: 1, entrants: 8 });
    const before = world.orgs[team.orgId].tier;
    const moves = applyHierarchyChanges(world, new RNG(seed + 1), { leagueTarget: 8 });
    if (world.orgs[team.orgId].tier > before) promotions++;
    assert.ok(Array.isArray(moves.promoted));
  }
  assert.ok(promotions > 0, 'aucune ascension possible en douze tirages');
  assert.ok(promotions < 12, 'la montée ne doit pas être garantie');
});

// --- Découplage -------------------------------------------------------------

test('montée et descente sont des décisions indépendantes', () => {
  const r = shared();
  const seasons = r.perSeason;
  const differing = seasons.filter((s) => s.promotions !== s.relegations).length;
  assert.ok(
    differing > seasons.length * 0.5,
    `${differing}/${seasons.length} saisons seulement où les deux nombres diffèrent — le couplage persiste`,
  );
  assert.ok(
    seasons.some((s) => s.promotions === 0 && s.relegations > 0) ||
      seasons.some((s) => s.relegations === 0 && s.promotions > 0),
    'aucune saison avec un mouvement dans un seul sens',
  );
});

// --- Mobilité, stabilité, ascension, déclin ---------------------------------

let cachedAudit = null;
function shared() {
  if (!cachedAudit) cachedAudit = runHierarchyAudit({ seed: 'hierarchy-regression', years: 30 });
  return cachedAudit;
}

test('la hiérarchie est mobile sans être chaotique', () => {
  const r = shared();
  assert.equal(r.crash, null, `plantage : ${r.crash?.message}`);
  assert.ok(r.mobility.promotionsPerSeason > 0.5, `${r.mobility.promotionsPerSeason} montées par saison`);
  assert.ok(r.mobility.relegationsPerSeason > 0.5, `${r.mobility.relegationsPerSeason} descentes par saison`);
  // Chaotique voudrait dire : tout le monde bouge, tout le temps.
  assert.ok(
    r.mobility.changesMedian <= 2,
    `changement médian de ${r.mobility.changesMedian} paliers — trop instable`,
  );
  assert.ok(r.mobility.neverMoved > 0, 'aucune organisation stable');
});

test('la stabilité reste possible : des organisations tiennent un palier des années', () => {
  const r = shared();
  assert.ok(
    r.stability.tenureMedianYears >= 3,
    `durée médiane de ${r.stability.tenureMedianYears} ans à un palier`,
  );
  assert.ok(
    r.stability.tenureMaxYears >= 15,
    `aucune dynastie : la plus longue tenure est de ${r.stability.tenureMaxYears} ans`,
  );
});

test('des ascensions et des déclins se produisent réellement', () => {
  const r = shared();
  assert.ok(r.ascension.climbers > 0, 'aucune organisation ne progresse');
  assert.ok(r.ascension.reachedTop > 0, 'aucune organisation n’atteint le sommet');
  assert.ok(r.decline.leftTop > 0, 'aucune organisation ne quitte le sommet');
  // Une ascension prend du temps : ce n'est pas un ascenseur express.
  assert.ok(
    r.ascension.climbYearsMedian >= 2,
    `montée au sommet en ${r.ascension.climbYearsMedian} ans en médiane`,
  );
});

test('l’ascenseur existe sans devenir la trajectoire dominante', () => {
  const r = shared();
  const total = r.mobility.orgsTracked;
  assert.ok(r.mobility.movedFiveOrMore > 0, 'aucune équipe ascenseur');
  assert.ok(
    r.mobility.movedFiveOrMore < total * 0.3,
    `${r.mobility.movedFiveOrMore}/${total} organisations font l'ascenseur`,
  );
});

// --- Invariants (§18) -------------------------------------------------------

test('les invariants de hiérarchie tiennent après trente saisons', () => {
  const r = shared();
  assert.deepEqual(
    r.invariants,
    [],
    `invariants violés : ${JSON.stringify(r.invariants.slice(0, 3))}`,
  );
  assert.deepEqual(r.issues, [], `incohérences du validateur : ${JSON.stringify(r.issues.slice(0, 2))}`);
});

test('le statut suit le niveau de l’organisation, le maximum atteint ne recule jamais', () => {
  const world = generateWorld({ seed: 4201, startYear: 2030 });
  const team = teamsAtTier(world, 'vanguard', 4)[0] ?? teamsAtTier(world, 'vanguard', 3)[0];
  const org = world.orgs[team.orgId];
  refreshStatuses(world);

  const player = world.persons[team.roster[0]];
  assert.equal(player.status, statusForTier(org.tier));
  const peak = player.stats.highestStatus;
  assert.equal(peak, statusForTier(org.tier), 'le maximum atteint doit être enregistré');

  // L'organisation s'effondre jusqu'au bas de la pyramide.
  org.tier = 1;
  refreshStatuses(world);
  assert.equal(player.status, STATUS.AMATEUR, 'le statut courant doit suivre la descente');
  assert.equal(
    player.stats.highestStatus,
    peak,
    'le statut maximal atteint ne doit jamais reculer',
  );

  // Et il ne recule pas non plus si on le réaffirme plus bas.
  recordHighestStatus(player, STATUS.AMATEUR);
  assert.equal(player.stats.highestStatus, peak);
});

test('un changement de palier ne casse ni les contrats ni les effectifs', () => {
  const world = generateWorld({ seed: 4202, startYear: 2030 });
  const team = teamsAtTier(world, 'vanguard', 3)[0];
  const org = world.orgs[team.orgId];
  const before = team.roster.map((id) => ({
    id,
    salary: world.persons[id].contract?.salary ?? null,
    orgId: world.persons[id].contract?.orgId ?? null,
  }));

  org.tier = 4;
  refreshStatuses(world);
  const issues = hierarchyInvariants(world);
  assert.deepEqual(issues, [], `invariants violés : ${JSON.stringify(issues.slice(0, 3))}`);

  // Une montée ne réécrit pas les contrats en cours.
  for (const b of before) {
    const p = world.persons[b.id];
    assert.equal(p.contract?.salary ?? null, b.salary, `${p.nick} : salaire modifié par la montée`);
    assert.equal(p.contract?.orgId ?? null, b.orgId, `${p.nick} : organisation du contrat modifiée`);
    assert.equal(p.teamId, team.id, `${p.nick} : sorti de son équipe par la montée`);
  }
});

// --- Traçabilité (§19) ------------------------------------------------------

test('une montée et une descente sont explicables', () => {
  const world = generateWorld({ seed: 4301, startYear: 2030 });
  const climber = teamsAtTier(world, 'vanguard', 1)[0];
  setRosterLevel(world, climber, 82);
  fund(world, climber, { budget: 150000, income: 120000 });
  giveSeason(world, climber, { played: 22, wins: 20, points: 400, oppStrength: 70, rank: 1, entrants: 8 });

  const faller = teamsAtTier(world, 'vanguard', 4)[0] ?? teamsAtTier(world, 'vanguard', 3)[0];
  setRosterLevel(world, faller, 40);
  fund(world, faller, { budget: -80000, income: 15000 });
  giveSeason(world, faller, { played: 20, wins: 0, points: 4, oppStrength: 80, rank: 8, entrants: 8 });

  startTrace({ max: 500 });
  // Plusieurs tirages : on veut au moins un mouvement à expliquer.
  for (let i = 0; i < 8; i++) applyHierarchyChanges(world, new RNG(700 + i), { leagueTarget: 8 });
  const entries = takeTrace().filter((e) => e.kind === TRACE.HIERARCHY);
  stopTrace();

  assert.ok(entries.length > 0, 'aucun mouvement tracé');
  const entry = entries[0];
  assert.ok(entry.decision === 'promotion' || entry.decision === 'relegation');
  assert.ok(entry.factors.length > 0, 'un mouvement sans facteurs n’est pas explicable');
  for (const f of entry.factors) {
    assert.equal(typeof f.label, 'string');
    assert.equal(typeof f.delta, 'number');
  }
});

// --- Compatibilité avec l'étape 2 ------------------------------------------

test('une équipe reléguée au plus bas rejoint l’écosystème amateur sans être détruite', () => {
  const world = generateWorld({ seed: 4401, startYear: 2030 });
  const team = teamsAtTier(world, 'vanguard', 2)[0];
  assert.ok(team, 'aucune équipe de tier 2');
  const org = world.orgs[team.orgId];
  const rosterBefore = [...team.roster];

  setRosterLevel(world, team, 38);
  fund(world, team, { budget: -60000, income: 10000 });
  giveSeason(world, team, { played: 18, wins: 0, points: 2, oppStrength: 70, rank: 8, entrants: 8 });
  for (let i = 0; i < 10; i++) applyHierarchyChanges(world, new RNG(900 + i), { leagueTarget: 8 });

  assert.ok(org.tier >= 1, 'le tier ne descend jamais sous 1');
  assert.ok(org.alive, 'la relégation ne doit pas détruire l’organisation');
  assert.ok(team.active, 'la relégation ne doit pas désactiver l’équipe');
  assert.deepEqual(team.roster, rosterBefore, 'la relégation ne doit pas vider l’effectif');
});
