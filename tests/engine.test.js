/**
 * Tests du moteur (§60, §84).
 *
 * Ces tests ne vérifient pas « le code compile » : ils jouent réellement des
 * carrières entières, dans des situations extrêmes, et vérifient que le monde
 * ne produit jamais d'état impossible.
 *
 *   node --test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG } from '../src/engine/rng.js';
import { generateWorld, worldSummary } from '../src/engine/worldgen.js';
import { validateWorld, validateCareer, validateTimeline } from '../src/engine/validator.js';
import {
  createSession,
  advanceWeek,
  resolveDecision,
  acceptOffer,
  seekTeam,
  canSeekTeam,
  foundTeam,
  canFoundTeam,
  retireCareer,
} from '../src/engine/simulation.js';
import { computeLegacy, buildNarrative, buildShareCard } from '../src/engine/legacy.js';
import { serializeSession, deserializeSession } from '../src/engine/save.js';
import {
  STATUS,
  baseRating,
  createPerson,
  resetPersonCounter,
  age as personAge,
} from '../src/engine/person.js';
import { GAMES, GAMES_BY_ID } from '../src/data/games.js';
import { ALL_ATTRS } from '../src/engine/attributes.js';
import { simulateMatch, winProbability } from '../src/engine/match.js';
import { dissolveOrg } from '../src/engine/events/defs/worldEvents.js';
import { initEvents, allEvents } from '../src/engine/events/index.js';
import { getEvent } from '../src/engine/events/engine.js';
import { teamStrength, computeSynergyTarget } from '../src/engine/team.js';

const BASE_PLAYER = {
  firstName: 'Léo',
  lastName: 'Martin',
  nick: 'Testeur',
  regionId: 'weu',
  country: 'France',
  age: 17,
  gameId: 'vanguard',
  familiarity: 0.35,
  baseLevel: 46,
  originId: 'child_competitor',
  familyId: 'supportive',
};

function newSession(overrides = {}) {
  return createSession({
    seed: 1234,
    startYear: 2030,
    difficulty: 'standard',
    ...overrides,
    player: { ...BASE_PLAYER, ...(overrides.player ?? {}) },
  });
}

/**
 * Joue une carrière complète avec un « joueur automatique ».
 * `strategy` décide des choix, ce qui permet de tester des trajectoires
 * radicalement différentes à partir du même moteur.
 */
function playCareer(session, { maxYears = 20, strategy = 'first', act = true } = {}) {
  let weeks = 0;
  let decisions = 0;
  while (!session.career.retired && weeks < 52 * maxYears) {
    const report = advanceWeek(session);
    weeks++;
    if (report.decision && !report.decision.resolved) {
      const choices = report.decision.choices;
      let index = 0;
      if (strategy === 'last') index = choices.length - 1;
      else if (strategy === 'random') index = (weeks * 7 + decisions * 3) % choices.length;
      resolveDecision(session, choices[index].id);
      decisions++;
    }
    if (session.career.offers?.length) acceptOffer(session, 0);
    if (!act) continue;
    const person = session.world.persons[session.career.personId];
    const hasReal = person.teamId && !session.world.teams[person.teamId]?.isSelfTeam;
    if (!hasReal && canSeekTeam(session).ok) {
      const res = seekTeam(session);
      if (res.offers?.length) acceptOffer(session, 0);
      else if (canFoundTeam(session).ok) foundTeam(session);
    }
  }
  return { weeks, decisions };
}

// --------------------------------------------------------------------------
// Déterminisme et génération du monde
// --------------------------------------------------------------------------

test('le RNG est déterministe et reproductible', () => {
  const a = new RNG(42);
  const b = new RNG(42);
  const seqA = Array.from({ length: 200 }, () => a.next());
  const seqB = Array.from({ length: 200 }, () => b.next());
  assert.deepEqual(seqA, seqB);

  const c = new RNG(43);
  assert.notEqual(c.next(), new RNG(42).next());
});

test('une même seed produit exactement le même monde', () => {
  const w1 = generateWorld({ seed: 999, startYear: 2030 });
  const w2 = generateWorld({ seed: 999, startYear: 2030 });
  assert.deepEqual(worldSummary(w1), worldSummary(w2));
  const nicks1 = Object.values(w1.persons).map((p) => p.nick).sort();
  const nicks2 = Object.values(w2.persons).map((p) => p.nick).sort();
  assert.deepEqual(nicks1, nicks2);
});

test('deux seeds différentes produisent des mondes différents', () => {
  const w1 = generateWorld({ seed: 1, startYear: 2030 });
  const w2 = generateWorld({ seed: 2, startYear: 2030 });
  const names1 = new Set(Object.values(w1.orgs).map((o) => o.name));
  const names2 = Object.values(w2.orgs).map((o) => o.name);
  const overlap = names2.filter((n) => names1.has(n)).length;
  assert.ok(overlap < names2.length * 0.6, 'les mondes doivent réellement diverger');
});

test('le monde généré est cohérent dès le départ', () => {
  const world = generateWorld({ seed: 7, startYear: 2030 });
  assert.deepEqual(validateWorld(world), []);
  const summary = worldSummary(world);
  assert.ok(summary.persons > 200, 'le monde doit être peuplé');
  assert.ok(summary.orgs > 40);
  assert.ok(summary.freeAgents > 10, 'un marché sans agents libres est mort');
});

test('les pseudos sont uniques', () => {
  const world = generateWorld({ seed: 55, startYear: 2030 });
  const nicks = Object.values(world.persons).map((p) => p.nick.toLowerCase());
  assert.equal(new Set(nicks).size, nicks.length);
});

// --------------------------------------------------------------------------
// Simulation de match
// --------------------------------------------------------------------------

test('le meilleur gagne le plus souvent, sans certitude', () => {
  assert.ok(winProbability(80, 70) > 0.75, 'un écart de 10 doit dominer');
  assert.ok(winProbability(80, 70) < 0.95, 'mais jamais être une certitude');
  assert.ok(Math.abs(winProbability(70, 70) - 0.5) < 0.01);
  assert.ok(winProbability(95, 55) > 0.99, 'un écart énorme reste écrasant');
});

test('la synergie peut renverser un déficit de niveau individuel (§14)', () => {
  const world = generateWorld({ seed: 3, startYear: 2030 });
  const teams = Object.values(world.teams).filter((t) => t.gameId === 'vanguard' && t.active);
  const team = teams[0];
  const base = teamStrength(world, team, { forMatch: false }).strength;
  team.synergy = 95;
  const soudee = teamStrength(world, team, { forMatch: false }).strength;
  team.synergy = 15;
  const brisee = teamStrength(world, team, { forMatch: false }).strength;
  assert.ok(soudee - brisee > 12, 'la cohésion doit peser lourd');
  assert.ok(soudee > base && brisee < base);
});

test('un roster incomplet est lourdement pénalisé', () => {
  const world = generateWorld({ seed: 3, startYear: 2030 });
  const team = Object.values(world.teams).find((t) => t.gameId === 'vanguard' && t.active);
  const full = teamStrength(world, team, { forMatch: false }).strength;
  team.roster.pop();
  const short = teamStrength(world, team, { forMatch: false }).strength;
  assert.ok(full - short > 5, 'jouer en infériorité doit coûter');
});

test('un match met à jour les statistiques des deux équipes', () => {
  const world = generateWorld({ seed: 11, startYear: 2030 });
  const rng = new RNG(5);
  const teams = Object.values(world.teams).filter((t) => t.gameId === 'aetheris' && t.active);
  const [a, b] = teams;
  const before = world.persons[a.roster[0]].stats.matches;
  const result = simulateMatch(world, {
    teamA: a,
    teamB: b,
    gameState: world.gameStates.aetheris,
    format: 3,
    stakes: 0.5,
  }, rng);
  assert.ok(result.winnerId === a.id || result.winnerId === b.id);
  assert.equal(Math.max(result.scoreA, result.scoreB), 2);
  assert.equal(world.persons[a.roster[0]].stats.matches, before + 1);
  assert.ok(result.perfs.length === a.roster.length + b.roster.length);
  assert.ok(result.mvpId, 'un MVP doit être désigné');
});

// --------------------------------------------------------------------------
// Carrières complètes
// --------------------------------------------------------------------------

test('une carrière complète se joue de bout en bout sans incohérence', () => {
  const session = newSession();
  const { weeks } = playCareer(session, { maxYears: 20 });
  assert.ok(weeks > 52 * 3, 'la carrière doit durer plus de trois ans');

  const person = session.world.persons[session.career.personId];
  assert.deepEqual(validateCareer(session.world, session.career), []);
  assert.deepEqual(validateWorld(session.world), []);
  assert.deepEqual(validateTimeline(session.career), []);
  assert.ok(session.career.timeline.length > 5, 'la carrière doit laisser une trace');
  assert.ok(person.stats.matches > 0, 'le joueur doit avoir joué');
});

test('trois stratégies de jeu produisent trois carrières différentes (§81.2)', () => {
  const results = ['first', 'last', 'random'].map((strategy) => {
    const session = newSession();
    playCareer(session, { maxYears: 18, strategy });
    const person = session.world.persons[session.career.personId];
    return {
      strategy,
      peak: Math.round(person.stats.peakRating),
      titles: person.stats.titles,
      years: Math.round((session.world.week - session.career.startWeek) / 52),
      orgs: session.career.counters.orgsPlayed.length,
      timeline: session.career.timeline.length,
    };
  });
  const signatures = results.map((r) => `${r.peak}|${r.titles}|${r.years}|${r.timeline}`);
  assert.equal(new Set(signatures).size, 3, `les carrières doivent diverger : ${JSON.stringify(results)}`);
});

test('dix carrières sur dix seeds restent toutes cohérentes', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const gameId = GAMES[seed % GAMES.length].id;
    const session = newSession({ seed, player: { gameId, nick: `Seed${seed}` } });
    playCareer(session, { maxYears: 14, strategy: 'random' });
    const issues = validateWorld(session.world);
    assert.deepEqual(issues, [], `seed ${seed} : ${JSON.stringify(issues.slice(0, 3))}`);
    assert.deepEqual(validateCareer(session.world, session.career), []);
  }
});

test('une carrière catastrophique reste jouable et racontable', () => {
  // Joueur âgé, sans talent, sans soutien, en difficulté maximale.
  const session = newSession({
    seed: 4242,
    difficulty: 'brutal',
    player: {
      nick: 'Rate',
      age: 24,
      baseLevel: 30,
      originId: 'late_bloomer',
      familyId: 'precarious',
      familiarity: 0.1,
    },
  });
  playCareer(session, { maxYears: 15, strategy: 'random' });
  const person = session.world.persons[session.career.personId];
  const legacy = computeLegacy(session.world, session.career);

  assert.deepEqual(validateWorld(session.world), []);
  assert.ok(legacy.global >= 0 && legacy.global <= 100);
  assert.ok(legacy.archetype.label.length > 0, 'même un échec reçoit un archétype');
  const narrative = buildNarrative(session.world, session.career, legacy);
  assert.ok(narrative.length >= 4, 'le récit doit exister même sans succès');
  assert.ok(person.status === STATUS.RETIRED || session.career.retired === false);
});

test('une carrière exceptionnelle atteint le haut niveau', () => {
  // Talent maximal, entraînement ciblé, difficulté douce.
  const session = newSession({
    seed: 88,
    difficulty: 'story',
    player: { nick: 'Prodige', age: 15, baseLevel: 62, potentialBias: 26, familiarity: 0.6 },
  });
  // Routine ambitieuse mais tenable : c'est ce qu'un joueur avisé ferait.
  session.career.routine = ['mechanics', 'strategy', 'scrim', 'rest'];
  playCareer(session, { maxYears: 16, strategy: 'first' });
  const person = session.world.persons[session.career.personId];
  assert.ok(
    person.stats.peakRating > 72,
    `un prodige entraîné doit atteindre le haut niveau (obtenu ${person.stats.peakRating.toFixed(1)})`,
  );
  assert.deepEqual(validateWorld(session.world), []);
});

test('la retraite laisse le monde et la carrière cohérents', () => {
  const session = newSession({ seed: 21 });
  playCareer(session, { maxYears: 6 });
  if (!session.career.retired) retireCareer(session, 'test');

  const person = session.world.persons[session.career.personId];
  assert.equal(person.status, STATUS.RETIRED);
  assert.equal(person.teamId, null);
  assert.equal(person.contract, null);
  assert.deepEqual(validateWorld(session.world), []);

  // §60 : un joueur retraité ne doit figurer dans aucun effectif.
  for (const team of Object.values(session.world.teams)) {
    assert.ok(!team.roster.includes(person.id));
    assert.ok(!team.subs.includes(person.id));
  }
  // Ni dans une compétition à venir.
  for (const comp of Object.values(session.world.competitions)) {
    if (!comp || comp.status === 'done') continue;
    assert.ok(!comp.teamIds.includes(person.teamId));
  }
});

test('une retraite précoce produit tout de même un bilan complet', () => {
  const session = newSession({ seed: 31 });
  playCareer(session, { maxYears: 2 });
  retireCareer(session, 'arrêt précoce');
  const legacy = computeLegacy(session.world, session.career);
  const narrative = buildNarrative(session.world, session.career, legacy);
  const card = buildShareCard(session.world, session.career, legacy);
  assert.ok(narrative.every((p) => typeof p === 'string' && p.length > 0));
  assert.ok(card.length > 3);
  assert.ok(legacy.careerYears <= 3);
});

// --------------------------------------------------------------------------
// Invariants du monde (§60)
// --------------------------------------------------------------------------

test('une organisation dissoute libère tout le monde et ne recrute plus', () => {
  const session = newSession({ seed: 77 });
  playCareer(session, { maxYears: 3 });
  const world = session.world;
  const org = Object.values(world.orgs).find((o) => o.alive && !o.isSelfOrg && o.tier >= 3);
  const teamIds = Object.values(org.teams);
  const memberIds = teamIds.flatMap((id) => [...(world.teams[id]?.roster ?? []), ...(world.teams[id]?.subs ?? [])]);
  assert.ok(memberIds.length > 0);

  dissolveOrg(world, org, world.week);

  assert.equal(org.alive, false);
  for (const id of memberIds) {
    const p = world.persons[id];
    assert.equal(p.teamId, null, `${p.nick} devrait être libre`);
    assert.equal(p.contract, null);
  }
  for (const teamId of teamIds) assert.equal(world.teams[teamId].active, false);
  assert.deepEqual(validateWorld(world), []);

  // Le monde continue de tourner après la disparition.
  for (let i = 0; i < 60; i++) advanceWeek(session);
  assert.deepEqual(validateWorld(world), []);
});

test('personne ne peut appartenir à deux équipes', () => {
  const session = newSession({ seed: 5 });
  playCareer(session, { maxYears: 12, strategy: 'random' });
  const seen = new Map();
  for (const team of Object.values(session.world.teams)) {
    for (const id of [...team.roster, ...team.subs]) {
      assert.ok(!seen.has(id), `${id} apparaît dans ${seen.get(id)} et ${team.id}`);
      seen.set(id, team.id);
    }
  }
});

test('les jeux, métas et popularités évoluent réellement (§8, §9)', () => {
  const session = newSession({ seed: 61 });
  const before = Object.fromEntries(
    Object.entries(session.world.gameStates).map(([id, g]) => [id, { pop: g.popularity, patch: g.patchMajor, axis: g.meta.axis }]),
  );
  playCareer(session, { maxYears: 8, strategy: 'random' });
  // Le monde doit être observé sur une durée fixe, indépendamment de la
  // longueur de la carrière du joueur.
  while (session.world.week - session.career.startWeek < 52 * 8) advanceWeek(session);
  const after = session.world.gameStates;

  const patched = Object.keys(before).filter((id) => after[id].patchMajor > before[id].patch);
  assert.ok(patched.length >= 3, 'les jeux doivent recevoir des patches majeurs');
  const metaChanged = Object.keys(before).filter((id) => after[id].meta.axis !== before[id].axis);
  assert.ok(metaChanged.length >= 2, 'les métas doivent basculer');
  const popChanged = Object.keys(before).filter((id) => Math.abs(after[id].popularity - before[id].pop) > 3);
  assert.ok(popChanged.length >= 3, 'les popularités doivent bouger');
});

test('le monde évolue sans le joueur : transferts, retraites, générations (§3, §41)', () => {
  const session = newSession({ seed: 91 });
  const world = session.world;
  const initialIds = new Set(Object.keys(world.persons));
  const initialTeams = new Map(
    Object.values(world.teams).map((t) => [t.id, t.roster.join(',')]),
  );

  playCareer(session, { maxYears: 8, strategy: 'random' });
  while (world.week - session.career.startWeek < 52 * 8) advanceWeek(session);

  const newcomers = Object.keys(world.persons).filter((id) => !initialIds.has(id));
  assert.ok(newcomers.length > 30, 'de nouvelles générations doivent arriver');

  const retired = Object.values(world.persons).filter(
    (p) => !p.isPlayer && (p.status === STATUS.RETIRED || p.status === STATUS.STAFF),
  );
  assert.ok(retired.length > 10, 'des joueurs doivent prendre leur retraite');

  let changedRosters = 0;
  for (const team of Object.values(world.teams)) {
    if (!initialTeams.has(team.id)) continue;
    if (initialTeams.get(team.id) !== team.roster.join(',')) changedRosters++;
  }
  assert.ok(changedRosters > 10, 'les rosters doivent bouger sans le joueur');
});

test('les PNJ vivent leur propre carrière (progression et déclin)', () => {
  const session = newSession({ seed: 12 });
  const world = session.world;
  // On échantillonne des deux côtés du pic de carrière : les jeunes doivent
  // progresser, les vétérans doivent décliner (§70).
  const young = Object.values(world.persons)
    .filter((p) => !p.isPlayer && p.status !== STATUS.STAFF && personAge(p, world.week) < 21)
    .slice(0, 30);
  const veterans = Object.values(world.persons)
    .filter((p) => !p.isPlayer && p.status !== STATUS.STAFF && personAge(p, world.week) >= 25)
    .slice(0, 30);
  const sample = [...young, ...veterans].map((p) => ({
    id: p.id,
    rating: baseRating(p, GAMES_BY_ID[p.gameId]),
    veteran: personAge(p, world.week) >= 25,
  }));

  playCareer(session, { maxYears: 6, strategy: 'random' });
  while (world.week - session.career.startWeek < 52 * 6) advanceWeek(session);

  let improved = 0;
  let declined = 0;
  for (const entry of sample) {
    const p = world.persons[entry.id];
    if (!p) continue;
    const now = baseRating(p, GAMES_BY_ID[p.gameId]);
    if (!entry.veteran && now > entry.rating + 2) improved++;
    if (entry.veteran && now < entry.rating - 2) declined++;
  }
  assert.ok(improved > 3, `les jeunes PNJ doivent progresser (${improved})`);
  assert.ok(declined > 2, `les vétérans doivent décliner (${declined})`);
});

// --------------------------------------------------------------------------
// Événements
// --------------------------------------------------------------------------

test('le catalogue d’événements est valide', () => {
  initEvents();
  const events = allEvents();
  assert.ok(events.length >= 25, 'le catalogue doit être fourni');
  const ids = events.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'pas de doublon d’identifiant');
  for (const e of events) {
    assert.ok(typeof e.condition === 'function');
    assert.ok(typeof e.weight === 'function');
    assert.ok(e.title, `${e.id} doit avoir un titre`);
    // Un événement doit soit proposer des choix, soit se résoudre seul.
    assert.ok(e.choices?.length > 0 || typeof e.auto === 'function', `${e.id} n'a ni choix ni résolution`);
    if (e.choices) {
      for (const c of e.choices) {
        assert.ok(c.id && c.label, `${e.id} : choix incomplet`);
      }
    }
  }
});

test('l’anti-répétition évite d’enchaîner deux fois le même événement', () => {
  const session = newSession({ seed: 314 });
  const fired = [];
  for (let i = 0; i < 52 * 8; i++) {
    const report = advanceWeek(session);
    if (report.decision) {
      fired.push({ id: report.decision.id, week: session.world.week });
      if (!report.decision.resolved) resolveDecision(session, report.decision.choices[0].id);
    }
    if (session.career.offers?.length) acceptOffer(session, 0);
    if (session.career.retired) break;
  }
  assert.ok(fired.length > 10, 'des événements doivent se produire');

  // Aucune répétition d'un même événement à l'intérieur de son cooldown.
  const lastSeen = new Map();
  for (const { id, week } of fired) {
    const def = getEvent(id);
    const previous = lastSeen.get(id);
    if (previous !== undefined && def?.cooldown) {
      assert.ok(
        week - previous >= def.cooldown,
        `${id} rejoué après ${week - previous} semaines (cooldown ${def.cooldown})`,
      );
    }
    lastSeen.set(id, week);
  }

  // Et une vraie diversité thématique.
  const unique = new Set(fired.map((f) => f.id));
  assert.ok(unique.size >= 8, `la variété doit être réelle (${unique.size} types)`);
});

test('les conséquences différées s’appliquent plus tard, jamais immédiatement', () => {
  const session = newSession({ seed: 202 });
  playCareer(session, { maxYears: 6, strategy: 'random' });
  // Toute conséquence encore en attente doit être datée dans le futur.
  for (const eff of session.career.eventState.scheduledEffects) {
    assert.ok(eff.dueWeek > session.world.week, 'un effet en attente ne peut pas être en retard');
    assert.ok(typeof eff.type === 'string');
  }
});

// --------------------------------------------------------------------------
// Sauvegarde
// --------------------------------------------------------------------------

test('sauvegarder puis recharger restitue exactement l’état', () => {
  const session = newSession({ seed: 606 });
  playCareer(session, { maxYears: 5, strategy: 'random' });

  const json = serializeSession(session);
  const restored = deserializeSession(json);
  const before = session.world.persons[session.career.personId];
  const after = restored.world.persons[restored.career.personId];

  assert.equal(restored.world.week, session.world.week);
  assert.equal(after.nick, before.nick);
  assert.equal(after.teamId, before.teamId);
  assert.equal(Math.round(after.stats.peakRating), Math.round(before.stats.peakRating));
  // Les 34 attributs survivent à la sérialisation compacte.
  for (const attr of ALL_ATTRS) {
    assert.ok(
      Math.abs(after.attrs[attr.id] - before.attrs[attr.id]) < 0.01,
      `attribut ${attr.id} altéré par la sauvegarde`,
    );
  }
  assert.deepEqual(Object.keys(after.hidden.ceilings).sort(), Object.keys(before.hidden.ceilings).sort());
  assert.deepEqual(validateWorld(restored.world), []);
});

test('recharger une sauvegarde ne permet pas de re-tirer un résultat (§79)', () => {
  const session = newSession({ seed: 707 });
  playCareer(session, { maxYears: 3, strategy: 'random' });
  const json = serializeSession(session);

  const runA = deserializeSession(json);
  const runB = deserializeSession(json);
  for (let i = 0; i < 40; i++) {
    advanceWeek(runA);
    if (runA.pendingDecision) resolveDecision(runA, runA.pendingDecision.presented.choices[0].id);
    advanceWeek(runB);
    if (runB.pendingDecision) resolveDecision(runB, runB.pendingDecision.presented.choices[0].id);
  }
  const a = runA.world.persons[runA.career.personId];
  const b = runB.world.persons[runB.career.personId];
  assert.equal(a.stats.matches, b.stats.matches);
  assert.equal(a.stats.wins, b.stats.wins);
  assert.equal(Math.round(a.form * 100), Math.round(b.form * 100));
});

test('la sauvegarde reste d’une taille raisonnable après une longue carrière', () => {
  const session = newSession({ seed: 808 });
  playCareer(session, { maxYears: 15, strategy: 'random' });
  const kb = serializeSession(session).length / 1024;
  assert.ok(kb < 2600, `sauvegarde trop volumineuse : ${Math.round(kb)} Ko`);
});

// --------------------------------------------------------------------------
// Bilan de carrière
// --------------------------------------------------------------------------

test('le récit final ne mentionne que des faits réellement survenus (§72)', () => {
  const session = newSession({ seed: 909 });
  playCareer(session, { maxYears: 12, strategy: 'random' });
  retireCareer(session, 'test');
  const legacy = computeLegacy(session.world, session.career);
  const narrative = buildNarrative(session.world, session.career, legacy).join(' ');
  const person = session.world.persons[session.career.personId];

  if (person.stats.titles === 0) {
    assert.ok(
      narrative.includes('jamais remporté'),
      'une carrière sans titre ne doit pas prétendre le contraire',
    );
  }
  if (!person.contract && session.career.counters.orgsPlayed.length === 0) {
    assert.ok(narrative.includes('jamais signé') || narrative.includes('contrat'));
  }
  // Le rival cité doit exister.
  if (session.career.rivalId) {
    assert.ok(session.world.persons[session.career.rivalId], 'le rival cité doit exister dans le monde');
  }
});

test('le score de carrière est multidimensionnel et borné', () => {
  const session = newSession({ seed: 1010 });
  playCareer(session, { maxYears: 10, strategy: 'random' });
  const legacy = computeLegacy(session.world, session.career);
  const dims = Object.values(legacy.dimensions);
  assert.equal(dims.length, 7);
  for (const [key, value] of Object.entries(legacy.dimensions)) {
    assert.ok(value >= 0 && value <= 100, `${key} hors bornes : ${value}`);
    assert.ok(Number.isFinite(value));
  }
  assert.ok(legacy.global >= 0 && legacy.global <= 100);
});

// --------------------------------------------------------------------------
// Changement de jeu (§10)
// --------------------------------------------------------------------------

test('changer de jeu coûte réellement du niveau', () => {
  resetPersonCounter();
  const rng = new RNG(2);
  const person = createPerson(rng, {
    regionId: 'weu',
    age: 22,
    baseLevel: 80,
    gameId: 'vanguard',
    familiarity: 1,
    absWeek: 2030 * 52,
  });
  const fpsRating = baseRating(person, GAMES_BY_ID.vanguard);
  person.gameId = 'aetheris';
  person.familiarity.aetheris = 0.15;
  const mobaRating = baseRating(person, GAMES_BY_ID.aetheris);
  assert.ok(fpsRating - mobaRating > 15, 'la familiarité doit peser lourdement');

  person.familiarity.aetheris = 1;
  const adapted = baseRating(person, GAMES_BY_ID.aetheris);
  assert.ok(adapted > mobaRating + 15, 'apprendre le jeu doit récupérer l’essentiel');
});

// --------------------------------------------------------------------------
// Difficulté
// --------------------------------------------------------------------------

test('la difficulté change réellement la trajectoire', () => {
  const easy = newSession({ seed: 3030, difficulty: 'story' });
  const hard = newSession({ seed: 3030, difficulty: 'brutal' });
  playCareer(easy, { maxYears: 10, strategy: 'first' });
  playCareer(hard, { maxYears: 10, strategy: 'first' });
  const a = easy.world.persons[easy.career.personId];
  const b = hard.world.persons[hard.career.personId];
  assert.notEqual(
    `${Math.round(a.stats.peakRating)}|${a.stats.titles}`,
    `${Math.round(b.stats.peakRating)}|${b.stats.titles}`,
  );
});
