/**
 * Cycle de vie d'une scène compétitive.
 *
 * PROBLÈME CORRIGÉ
 * ----------------
 * L'ancienne formule de popularité opposait une pression d'âge monotone à un
 * rappel vers le potentiel du jeu :
 *
 *     agePressure   = -0,14/semaine dès 22 ans d'existence (plafonné, jamais
 *                     décroissant)
 *     potentialPull = (potentiel - popularité) × 0,0016/semaine
 *
 * L'équilibre de cette équation vaut `potentiel - 87,5`. Autrement dit :
 * AUCUNE scène ne possédait d'équilibre positif une fois mature. Les neuf
 * scènes mouraient donc systématiquement, la seule variable étant le délai.
 * Mesuré : 9 scènes vivantes à l'an 0, 3 à l'an 30, et les survivantes en
 * chute libre.
 *
 * MODÈLE RETENU
 * -------------
 * On sépare deux notions qui étaient confondues :
 *
 *   - `popularity` : l'audience du moment, volatile ;
 *   - `vitality`   : la santé structurelle de la scène (0..1), lente.
 *
 * La popularité tend vers un niveau soutenable dicté par la vitalité. La
 * vitalité, elle, n'est pas une horloge : elle est recalculée chaque saison à
 * partir de faits réellement simulés —
 *
 *   1. l'arrivée d'une génération de talents,
 *   2. l'intensité compétitive de la saison écoulée (upsets, comebacks,
 *      finales serrées réellement jouées),
 *   3. l'argent investi par les organisations présentes,
 *   4. la capacité de la scène à digérer ses patches,
 *   5. sa taille installée.
 *
 * L'âge continue de peser, mais comme une usure institutionnelle légère
 * (§ « ne supprime pas simplement cette variable »), pas comme une
 * condamnation. Une scène mature se stabilise ; une scène en déclin peut
 * repartir si les talents reviennent ou si un investisseur arrive. Aucune
 * renaissance n'est programmée : elle est la conséquence d'un état.
 */

import { clamp } from './rng.js';
import { GAMES_BY_ID } from '../data/games.js';
import { STATUS, age as personAge, weightedCeiling } from './person.js';
import { WEEKS_PER_YEAR } from './time.js';

/** Une saison de mesure. Assez long pour lisser, assez court pour réagir. */
export const SCENE_REVIEW_WEEKS = 13;

export const SCENE_PHASES = {
  EMERGING: 'emergente',
  GROWTH: 'croissance',
  MATURE: 'mature',
  DECLINING: 'declin',
  REVIVAL: 'renaissance',
  DYING: 'agonie',
};

/** Initialise l'état de cycle de vie d'une scène. */
export function initSceneLifecycle(gameState, game) {
  const potential = Math.max(1, game.esportPotential);
  gameState.vitality = clamp(gameState.popularity / potential, 0.2, 1);
  gameState.vitalityHistory = [gameState.vitality];
  gameState.peakPopularity = gameState.popularity;
  gameState.phase = SCENE_PHASES.MATURE;
  gameState.lastReviewWeek = 0;
  // Compteurs de « drame compétitif » remplis par les matchs réellement joués.
  gameState.drama = { highStakes: 0, memorable: 0 };
  gameState.vitalityInputs = null;
  return gameState;
}

/**
 * Enregistre l'intérêt sportif d'un match qui vient d'être joué.
 * Appelé depuis le simulateur de match : ce sont de vrais résultats, pas une
 * estimation.
 */
export function recordMatchDrama(world, result) {
  const gs = world.gameStates?.[result.gameId];
  if (!gs || result.stakes < 0.5) return;
  if (!gs.drama) gs.drama = { highStakes: 0, memorable: 0 };
  gs.drama.highStakes++;
  if (result.upset || result.comeback || result.close) gs.drama.memorable++;
}

/**
 * Mesure l'état réel d'une scène. O(personnes + équipes), appelé une fois par
 * trimestre et par jeu : négligeable.
 */
function measureScene(world, gameId) {
  const game = GAMES_BY_ID[gameId];
  let players = 0;
  let youngTalent = 0;
  let shockSum = 0;
  let veterans = 0;
  for (const p of Object.values(world.persons)) {
    if (p.gameId !== gameId) continue;
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    players++;
    shockSum += p.metaShock ?? 0;
    const a = personAge(p, world.week);
    if (a < 21 && weightedCeiling(p, game) > 80) youngTalent++;
    if (a >= 24) veterans++;
  }

  let teams = 0;
  let budget = 0;
  let topTier = 0;
  for (const t of Object.values(world.teams)) {
    if (t.gameId !== gameId || !t.active) continue;
    const org = world.orgs[t.orgId];
    if (!org?.alive || org.isSelfOrg) continue;
    teams++;
    budget += Math.max(0, org.budget);
    if (org.tier >= 4) topTier++;
  }

  return {
    players,
    youngTalent,
    veterans,
    teams,
    topTier,
    budget,
    avgShock: players > 0 ? shockSum / players : 0,
  };
}

/**
 * Recalcule la vitalité d'une scène à partir de son état réel.
 * Retourne un événement de changement de phase s'il y a lieu.
 */
export function updateSceneLifecycle(world, gameState, rng) {
  if (!gameState.alive) return null;
  if (gameState.vitality === undefined) {
    initSceneLifecycle(gameState, GAMES_BY_ID[gameState.gameId]);
  }
  if (world.week - (gameState.lastReviewWeek ?? 0) < SCENE_REVIEW_WEEKS) return null;
  gameState.lastReviewWeek = world.week;

  const game = GAMES_BY_ID[gameState.gameId];
  const m = measureScene(world, gameState.gameId);

  // 1. Relève. Une scène sans jeunes talents n'a pas d'avenir ; une scène qui
  //    en produit régulièrement se renouvelle d'elle-même.
  const expectedTalent = Math.max(2.5, m.players * 0.07);
  const talentScore = clamp(m.youngTalent / expectedTalent, 0, 1.2) / 1.2;

  // 2. Intérêt sportif de la saison écoulée, mesuré sur les matchs joués.
  const drama = gameState.drama ?? { highStakes: 0, memorable: 0 };
  const dramaRatio = drama.highStakes >= 4 ? drama.memorable / drama.highStakes : 0.3;
  const dramaScore = clamp(dramaRatio / 0.4, 0, 1);
  gameState.drama = { highStakes: 0, memorable: 0 };

  // 3. Argent réellement présent dans la scène.
  const referenceBudget = Math.max(1, m.teams) * 260000;
  const investScore = clamp(m.budget / referenceBudget, 0, 1);

  // 4. Capacité à digérer les patches : une scène dont tout le monde reste
  //    perdu après une refonte perd son public.
  const metaScore = clamp(1 - m.avgShock / 6, 0, 1);

  // 5. Taille installée : l'inertie d'un écosystème établi.
  const sizeScore = clamp(m.teams / 9, 0, 1);

  const target = clamp(
    0.1 +
      0.3 * talentScore +
      0.17 * dramaScore +
      0.2 * investScore +
      0.11 * metaScore +
      0.12 * sizeScore,
    0.05,
    1,
  );

  // Usure institutionnelle : l'âge pèse toujours, mais il coûte quelques
  // centièmes par saison au lieu de condamner la scène.
  const ageYears = gameState.sceneAgeYears ?? 0;
  const fatigue = 0.009 * (1 + ageYears / 45);

  const previous = gameState.vitality;
  gameState.vitality = clamp(
    previous + (target - previous) * 0.18 - fatigue + rng.gauss(0, 0.012),
    0.02,
    1,
  );

  const history = (gameState.vitalityHistory ??= []);
  history.push(Math.round(gameState.vitality * 1000) / 1000);
  if (history.length > 12) history.shift();

  gameState.vitalityInputs = {
    talentScore: r3(talentScore),
    dramaScore: r3(dramaScore),
    investScore: r3(investScore),
    metaScore: r3(metaScore),
    sizeScore: r3(sizeScore),
    target: r3(target),
    ...m,
  };

  const before = gameState.phase;
  gameState.phase = derivePhase(gameState, game);
  return before !== gameState.phase ? { from: before, to: gameState.phase, gameId: game.id } : null;
}

/** La phase est une LECTURE de l'état, jamais un programme. */
function derivePhase(gameState, game) {
  const v = gameState.vitality;
  const history = gameState.vitalityHistory ?? [];
  const trend =
    history.length >= 4 ? v - history[Math.max(0, history.length - 4)] : 0;
  const popRatio = gameState.popularity / Math.max(1, gameState.peakPopularity ?? 1);

  if (v < 0.12) return SCENE_PHASES.DYING;
  if (trend > 0.05 && popRatio < 0.75) return SCENE_PHASES.REVIVAL;
  if (trend > 0.04) return SCENE_PHASES.GROWTH;
  if (trend < -0.045) return SCENE_PHASES.DECLINING;
  if ((gameState.sceneAgeYears ?? 0) < 4) return SCENE_PHASES.EMERGING;
  return SCENE_PHASES.MATURE;
}

/**
 * Nouvelle dynamique de popularité : elle suit un niveau soutenable dicté par
 * la vitalité, au lieu de fuir une pression d'âge inexorable.
 */
export function updatePopularityFromVitality(world, gameState, rng, weeks = 1) {
  const game = GAMES_BY_ID[gameState.gameId];
  if (!gameState.alive) return;
  if (gameState.vitality === undefined) initSceneLifecycle(gameState, game);

  gameState.sceneAgeYears = (gameState.sceneAgeYears ?? 0) + weeks / WEEKS_PER_YEAR;

  // Une scène ne dépasse pas durablement ce que sa vitalité justifie, et ne
  // tombe pas non plus à zéro tant qu'elle conserve une structure.
  const sustainable = game.esportPotential * (0.15 + 0.85 * gameState.vitality);
  const pull = (sustainable - gameState.popularity) * 0.012;
  const noise = rng.gauss(0, 0.35);

  gameState.popularity = clamp(
    gameState.popularity + pull * weeks + noise * Math.sqrt(weeks),
    1,
    100,
  );
  gameState.peakPopularity = Math.max(gameState.peakPopularity ?? 0, gameState.popularity);

  gameState.esportHealth = clamp(
    gameState.esportHealth + (gameState.popularity - gameState.esportHealth) * 0.01 * weeks,
    2,
    100,
  );
  gameState.prizeMultiplier = clamp(0.35 + (gameState.popularity / 100) * 1.35, 0.2, 1.7);

  // La mort reste possible, mais elle demande un effondrement complet ET
  // durable : plus de vitalité, plus d'audience, plus d'écosystème. Elle est
  // probabiliste, pas mécanique.
  const inputs = gameState.vitalityInputs;
  const collapsed =
    gameState.vitality < 0.12 &&
    gameState.popularity < 7 &&
    (inputs ? inputs.teams < 3 : false);
  if (collapsed) {
    gameState.collapseWeeks = (gameState.collapseWeeks ?? 0) + weeks;
    if (gameState.collapseWeeks > SCENE_REVIEW_WEEKS * 2 && rng.chance(0.02 * weeks)) {
      gameState.alive = false;
      gameState.deathWeek = world.week;
    }
  } else {
    gameState.collapseWeeks = 0;
  }
}

export function scenePhaseLabel(gameState) {
  return gameState?.phase ?? SCENE_PHASES.MATURE;
}

/** Explication lisible de la santé d'une scène (mode debug, page Monde). */
export function explainScene(gameState) {
  const i = gameState.vitalityInputs;
  if (!i) return `vitalité ${r3(gameState.vitality ?? 0)} (pas encore mesurée)`;
  return (
    `vitalité ${r3(gameState.vitality)} → cible ${i.target} | ` +
    `relève ${i.talentScore} · intensité ${i.dramaScore} · argent ${i.investScore} · ` +
    `méta ${i.metaScore} · taille ${i.sizeScore} | ` +
    `${i.teams} équipes, ${i.players} joueurs, ${i.youngTalent} jeunes talents`
  );
}

function r3(v) {
  return Math.round(v * 1000) / 1000;
}
