/**
 * Tests de non-régression du cycle de vie des scènes (phase 2, étape 1).
 *
 * Le bug corrigé : l'ancienne formule de popularité avait pour équilibre
 * `potentiel - 87,5`, négatif pour tous les jeux. Chaque scène mourait donc
 * mécaniquement, et le monde se vidait. Ces tests verrouillent la propriété
 * inverse : une scène mature doit pouvoir vivre des décennies, une scène en
 * déclin doit pouvoir se redresser, et la mort doit rester possible mais
 * conditionnée à un effondrement réel.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG } from '../src/engine/rng.js';
import { generateWorld } from '../src/engine/worldgen.js';
import { simulateGames } from '../src/engine/worldSim.js';
import { createSession, advanceWorldOnly } from '../src/engine/simulation.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { validateWorld } from '../src/engine/validator.js';
import { STATUS } from '../src/engine/person.js';
import { GAMES, GAMES_BY_ID } from '../src/data/games.js';
import {
  SCENE_PHASES,
  updateSceneLifecycle,
  updatePopularityFromVitality,
  recordMatchDrama,
  initSceneLifecycle,
} from '../src/engine/scene.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';

function worldOnlySession(seed) {
  const session = createSession({
    seed,
    startYear: 2030,
    difficulty: 'standard',
    player: randomPlayerConfig(new RNG(1)),
  });
  session.career.retired = true;
  session.world.persons[session.career.personId].status = STATUS.RETIRED;
  return session;
}

test('une scène mature ne meurt plus mécaniquement de vieillesse', () => {
  const world = generateWorld({ seed: 99, startYear: 2030 });
  const rng = new RNG(7);
  for (let i = 0; i < WEEKS_PER_YEAR * 40; i++) {
    world.week++;
    simulateGames(world, rng);
  }
  const alive = Object.values(world.gameStates).filter((g) => g.alive);
  assert.ok(
    alive.length >= 7,
    `après 40 ans, ${alive.length}/9 scènes vivantes (l'ancien moteur en laissait 3 après 30 ans)`,
  );
  // Et elles ne sont pas juste « vivantes » à 2 de popularité.
  const viable = alive.filter((g) => g.popularity > 12);
  assert.ok(viable.length >= 6, `seulement ${viable.length} scènes au-dessus de 12 de popularité`);
});

test('la popularité se stabilise au lieu de décroître sans fin', () => {
  const world = generateWorld({ seed: 21, startYear: 2030 });
  const rng = new RNG(3);
  const run = (years) => {
    for (let i = 0; i < WEEKS_PER_YEAR * years; i++) {
      world.week++;
      simulateGames(world, rng);
    }
    return Object.values(world.gameStates)
      .filter((g) => g.alive)
      .reduce((a, g) => a + g.popularity, 0);
  };
  const at12 = run(12);
  const at24 = run(12);
  const at36 = run(12);

  // Le point qui compte : après la phase d'ajustement initiale, le total ne
  // s'érode plus que marginalement. L'ancien moteur perdait au contraire
  // l'essentiel de sa popularité sur cette même fenêtre.
  assert.ok(
    at36 > at12 * 0.8,
    `popularité totale ${at12.toFixed(0)} → ${at36.toFixed(0)} : érosion trop forte`,
  );
  const alive = Object.values(world.gameStates).filter((g) => g.alive).length;
  assert.equal(alive, 9, `${9 - alive} scène(s) morte(s) sans effondrement réel`);
});

test('la vitalité réagit aux faits simulés, pas au calendrier', () => {
  const world = generateWorld({ seed: 5, startYear: 2030 });
  const gs = world.gameStates.vanguard;
  const rng = new RNG(11);

  // Deux scènes identiques, l'une nourrie de matchs mémorables.
  world.week += 20;
  const before = gs.vitality;
  for (let i = 0; i < 30; i++) {
    recordMatchDrama(world, { gameId: 'vanguard', stakes: 0.9, upset: true, comeback: false, close: false });
  }
  updateSceneLifecycle(world, gs, rng);
  const withDrama = gs.vitalityInputs.dramaScore;

  gs.drama = { highStakes: 0, memorable: 0 };
  world.week += 20;
  for (let i = 0; i < 30; i++) {
    recordMatchDrama(world, { gameId: 'vanguard', stakes: 0.9, upset: false, comeback: false, close: false });
  }
  updateSceneLifecycle(world, gs, rng);
  const withoutDrama = gs.vitalityInputs.dramaScore;

  assert.ok(
    withDrama > withoutDrama,
    `une saison pleine d'upsets doit valoir plus qu'une saison sans surprise (${withDrama} vs ${withoutDrama})`,
  );
  assert.ok(typeof before === 'number');
});

test('une scène peut mourir, mais seulement en cas d’effondrement réel', () => {
  const world = generateWorld({ seed: 8, startYear: 2030 });
  const gs = world.gameStates.dominion;
  const rng = new RNG(4);

  // Effondrement total, imposé : plus de vitalité, plus d'audience, plus
  // d'équipes. La scène doit finir par fermer.
  gs.vitality = 0.05;
  gs.popularity = 3;
  gs.vitalityInputs = { teams: 0 };
  let died = false;
  for (let i = 0; i < WEEKS_PER_YEAR * 12 && !died; i++) {
    world.week++;
    // On maintient l'effondrement : sinon la scène se redresserait.
    gs.vitality = 0.05;
    gs.vitalityInputs = { teams: 0 };
    updatePopularityFromVitality(world, gs, rng, 1);
    died = !gs.alive;
  }
  assert.ok(died, 'une scène totalement effondrée doit pouvoir fermer');
});

test('une scène en déclin peut se redresser si les conditions reviennent', () => {
  const world = generateWorld({ seed: 12, startYear: 2030 });
  const gs = world.gameStates.arcanum;
  const rng = new RNG(6);

  gs.vitality = 0.18;
  gs.popularity = 12;
  const low = gs.popularity;

  // On rétablit des conditions favorables — comme le ferait l'arrivée d'une
  // génération et d'investisseurs — et on laisse tourner.
  gs.vitality = 0.8;
  for (let i = 0; i < WEEKS_PER_YEAR * 8; i++) {
    world.week++;
    gs.vitality = Math.min(1, gs.vitality + 0.0004);
    updatePopularityFromVitality(world, gs, rng, 1);
  }
  assert.ok(
    gs.popularity > low + 10,
    `la scène doit remonter quand la vitalité revient (${low.toFixed(1)} → ${gs.popularity.toFixed(1)})`,
  );
  assert.ok(gs.alive);
});

test('le monde reste peuplé et compétitif après 25 ans sans joueur', () => {
  const session = worldOnlySession(4242);
  for (let i = 0; i < WEEKS_PER_YEAR * 25; i++) advanceWorldOnly(session);

  const world = session.world;
  const active = Object.values(world.persons).filter(
    (p) => p.status !== STATUS.RETIRED && p.status !== STATUS.STAFF,
  );
  const teams = Object.values(world.teams).filter((t) => t.active);
  const scenes = Object.values(world.gameStates).filter((g) => g.alive);
  const incomplete = teams.filter(
    (t) => t.roster.length < (GAMES_BY_ID[t.gameId]?.teamSize ?? 1),
  );

  assert.ok(active.length > 250, `seulement ${active.length} joueurs actifs après 25 ans`);
  assert.ok(teams.length > 70, `seulement ${teams.length} équipes actives après 25 ans`);
  assert.ok(scenes.length >= 7, `seulement ${scenes.length}/9 scènes vivantes après 25 ans`);
  assert.ok(incomplete.length <= 3, `${incomplete.length} équipes incomplètes`);
  assert.deepEqual(validateWorld(world), []);
});

test('les nouvelles générations continuent d’arriver sur toute la durée', () => {
  const session = worldOnlySession(31);
  const initial = new Set(Object.keys(session.world.persons));
  for (let i = 0; i < WEEKS_PER_YEAR * 20; i++) advanceWorldOnly(session);

  const newcomers = Object.keys(session.world.persons).filter((id) => !initial.has(id));
  assert.ok(newcomers.length > 250, `seulement ${newcomers.length} nouveaux joueurs en 20 ans`);

  // Et ils arrivent sur des scènes variées, pas sur une seule.
  const scenes = new Set(newcomers.map((id) => session.world.persons[id].gameId));
  assert.ok(scenes.size >= 6, `les nouveaux venus ne couvrent que ${scenes.size} scènes`);
});

test('chaque scène vivante conserve un écosystème mesurable', () => {
  const session = worldOnlySession(77);
  for (let i = 0; i < WEEKS_PER_YEAR * 20; i++) advanceWorldOnly(session);
  const world = session.world;

  for (const gs of Object.values(world.gameStates)) {
    if (!gs.alive) continue;
    const teams = Object.values(world.teams).filter((t) => t.active && t.gameId === gs.gameId);
    assert.ok(
      teams.length >= 4,
      `la scène ${gs.gameId} est déclarée vivante avec seulement ${teams.length} équipes`,
    );
    assert.ok(gs.vitality > 0, `vitalité non initialisée pour ${gs.gameId}`);
    assert.ok(
      Object.values(SCENE_PHASES).includes(gs.phase),
      `phase inconnue pour ${gs.gameId} : ${gs.phase}`,
    );
  }
});

test('l’initialisation du cycle de vie est cohérente pour tous les jeux', () => {
  const world = generateWorld({ seed: 2, startYear: 2030 });
  for (const game of GAMES) {
    const gs = world.gameStates[game.id];
    assert.ok(gs.vitality > 0 && gs.vitality <= 1, `${game.id} : vitalité ${gs.vitality}`);
    assert.ok(gs.peakPopularity >= gs.popularity);
    assert.ok(gs.drama && typeof gs.drama.highStakes === 'number');
  }
  // Deux mondes de même seed produisent les mêmes vitalités.
  const other = generateWorld({ seed: 2, startYear: 2030 });
  for (const game of GAMES) {
    assert.equal(world.gameStates[game.id].vitality, other.gameStates[game.id].vitality);
  }
});
