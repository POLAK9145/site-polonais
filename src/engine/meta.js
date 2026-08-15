/**
 * Vie des jeux : patches, métas, popularité (§9, §24).
 *
 * Un jeu n'est pas un décor figé. Il change, et ces changements doivent
 * pouvoir RUINER ou LANCER une carrière sans que le joueur ait rien fait de
 * différent. C'est l'une des principales sources de tournants (§9).
 */

import { clamp, norm } from './rng.js';
import { GAMES_BY_ID } from '../data/games.js';
import { ALL_ATTRS } from './attributes.js';
import { WEEKS_PER_YEAR, yearOf } from './time.js';
import { initSceneLifecycle, updatePopularityFromVitality } from './scene.js';

/** Attributs que peut privilégier une méta, par famille de jeu. */
const META_ATTR_POOL = [
  'precision', 'reflexes', 'execution', 'consistency', 'technique', 'coordination',
  'reading', 'anticipation', 'adaptation', 'decision', 'metaSense', 'creativity', 'riskControl',
  'communication', 'teamwork', 'composure', 'focus',
];

export function createGameState(rng, game, absWeek) {
  const state = {
    gameId: game.id,
    popularity: game.popularity,
    esportHealth: clamp(game.esportPotential + rng.gauss(0, 6), 10, 100),
    patchMajor: Math.max(1, Math.round(game.releasedYearsAgo * 1.4)),
    patchMinor: rng.int(0, 6),
    sceneAgeYears: game.releasedYearsAgo,
    meta: null,
    lastPatchWeek: absWeek,
    lastMajorPatchWeek: absWeek,
    prizeMultiplier: 1,
    alive: true,
    deathWeek: null,
    history: [],
  };
  state.meta = rollMeta(rng, game, absWeek, null);
  initSceneLifecycle(state, game);
  return state;
}

/** Tire une nouvelle méta : un axe dominant + 3 attributs valorisés. */
function rollMeta(rng, game, absWeek, previous) {
  let axis = rng.pick(game.metaAxes);
  let guard = 0;
  while (previous && axis === previous.axis && game.metaAxes.length > 1 && guard++ < 8) {
    axis = rng.pick(game.metaAxes);
  }
  const pool = [...new Set([...game.keyAttrs, ...META_ATTR_POOL])];
  const emphasized = rng.sample(pool, 3);
  return {
    axis,
    emphasized,
    since: absWeek,
    strength: rng.float(0.6, 1.4),
  };
}

/**
 * Décide si un patch tombe cette semaine.
 * Les patches mineurs sont fréquents et sans effet structurel ; les patches
 * majeurs redistribuent la méta et infligent un choc d'adaptation.
 */
export function maybePatch(world, gameState, rng) {
  const game = GAMES_BY_ID[gameState.gameId];
  if (!gameState.alive) return null;

  const weeksSinceMajor = world.week - gameState.lastMajorPatchWeek;
  // Volatilité élevée = refonte tous les ~4 mois ; faible = tous les ~2 ans.
  const expected = 18 + (1 - game.metaVolatility) * 80;
  const chance = clamp((weeksSinceMajor - expected * 0.45) / (expected * 1.6), 0, 0.28);

  if (rng.chance(chance)) {
    gameState.patchMajor += 1;
    gameState.patchMinor = 0;
    gameState.lastPatchWeek = world.week;
    gameState.lastMajorPatchWeek = world.week;
    const previous = gameState.meta;
    gameState.meta = rollMeta(rng, game, world.week, previous);
    const patch = {
      week: world.week,
      version: `${gameState.patchMajor}.0`,
      major: true,
      axis: gameState.meta.axis,
      emphasized: gameState.meta.emphasized,
      previousAxis: previous?.axis ?? null,
    };
    gameState.history.push(patch);
    applyMetaShock(world, gameState, rng);
    return patch;
  }

  if (rng.chance(0.05 + game.metaVolatility * 0.05)) {
    gameState.patchMinor += 1;
    gameState.lastPatchWeek = world.week;
    // Un patch mineur infléchit la méta sans la renverser.
    gameState.meta.strength = clamp(gameState.meta.strength + rng.gauss(0, 0.12), 0.4, 1.6);
    return {
      week: world.week,
      version: `${gameState.patchMajor}.${gameState.patchMinor}`,
      major: false,
      axis: gameState.meta.axis,
      emphasized: gameState.meta.emphasized,
    };
  }
  return null;
}

/**
 * Choc d'adaptation : tous les joueurs de ce jeu encaissent une pénalité
 * temporaire, d'autant plus faible qu'ils sont adaptables. Un joueur rigide
 * peut mettre six mois à retrouver son niveau — parfois trop tard (§9).
 */
function applyMetaShock(world, gameState, rng) {
  for (const p of Object.values(world.persons)) {
    if (p.gameId !== gameState.gameId) continue;
    if (p.status === 'retired' || p.status === 'staff') continue;
    const resistance =
      p.hidden.adaptability * 0.55 + (p.attrs.adaptation / 100) * 0.3 + (p.attrs.metaSense / 100) * 0.15;
    const shock = clamp(rng.float(2, 7.5) * (1.25 - resistance), 0, 9);
    p.metaShock = (p.metaShock ?? 0) + shock;
  }
}

/** Le choc s'estompe à mesure que le joueur réapprend. */
export function decayMetaShock(person, weeks = 1) {
  if (!person.metaShock) return;
  const rate = 0.1 + person.hidden.adaptability * 0.16 + (person.attrs.learning / 100) * 0.1;
  person.metaShock = Math.max(0, person.metaShock * Math.pow(1 - rate, weeks));
  if (person.metaShock < 0.05) person.metaShock = 0;
}

/**
 * Affinité d'un joueur avec la méta en cours : ±6 points de niveau réel.
 * C'est ce qui fait qu'un joueur peut être « le meilleur du monde » sur un
 * patch et redevenir ordinaire sur le suivant, sans avoir rien perdu.
 */
export function metaFit(person, gameState) {
  if (!gameState?.meta) return 0;
  const { emphasized, strength } = gameState.meta;
  let emphasizedAvg = 0;
  for (const id of emphasized) emphasizedAvg += person.attrs[id] ?? 50;
  emphasizedAvg /= emphasized.length;

  let overall = 0;
  for (const a of ALL_ATTRS) overall += person.attrs[a.id];
  overall /= ALL_ATTRS.length;

  return clamp((emphasizedAvg - overall) * 0.14 * strength, -7, 7);
}

/**
 * Popularité d'une scène.
 *
 * Déléguée au cycle de vie (scene.js) : l'ancienne formule contenait une
 * pression d'âge dont l'équilibre était `potentiel - 87,5`, c'est-à-dire
 * négatif pour tous les jeux. Toutes les scènes mouraient nécessairement.
 */
export function updatePopularity(world, gameState, rng, weeks = 1) {
  updatePopularityFromVitality(world, gameState, rng, weeks);
}

export function metaLabel(gameState) {
  if (!gameState?.meta) return '—';
  return gameState.meta.axis;
}

export function patchLabel(gameState) {
  return `${gameState.patchMajor}.${gameState.patchMinor}`;
}

export function popularityTrend(gameState, sinceYears = 1) {
  const target = GAMES_BY_ID[gameState.gameId].esportPotential;
  return gameState.popularity < target ? 'hausse' : 'baisse';
}

export function yearsSince(world, week) {
  return yearOf(world.week) - yearOf(week);
}
