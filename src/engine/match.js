/**
 * Simulation de match (§26, §27, §28).
 *
 * Le joueur ne joue pas : il subit ou récolte. Le résultat est une fonction
 * du niveau, de la forme, de la synergie, de la méta, de la fatigue, de la
 * préparation et de l'enjeu — le hasard n'intervient que pour trancher
 * entre des issues déjà plausibles.
 *
 * Réglage clé : `LOGISTIC_K`. Plus il est petit, plus le meilleur gagne.
 * À 6.5, un écart de 10 points de force donne ~82 % par carte : les upsets
 * existent, mais un roster à 60 ne bat pas un roster à 90.
 */

import { clamp } from './rng.js';
import { teamStrength, rosterPersons, teamGame, coachQuality } from './team.js';
import { mods, effectiveRating } from './person.js';
import { metaFit } from './meta.js';
import { recordMatchDrama } from './scene.js';

const LOGISTIC_K = 6.5;

export function winProbability(strengthA, strengthB) {
  return 1 / (1 + Math.exp(-(strengthA - strengthB) / LOGISTIC_K));
}

/**
 * Force d'une équipe pour CE match précis : on part de la force structurelle
 * puis on ajoute ce qui dépend du contexte (méta, enjeu, préparation).
 */
export function contextualStrength(world, team, { gameState, stakes = 0.3, prepared = 0 }) {
  const base = teamStrength(world, team);
  const players = rosterPersons(world, team);
  if (players.length === 0) return { ...base, total: 15, factors: [] };

  let metaSum = 0;
  let pressureSum = 0;
  let shockSum = 0;
  for (const p of players) {
    metaSum += metaFit(p, gameState);
    shockSum += p.metaShock ?? 0;
    const m = mods(p);
    // Le mental ne compte vraiment que quand l'enjeu est réel (§27).
    const mentalCore = (p.attrs.pressure + p.attrs.composure + p.attrs.clutch) / 3;
    pressureSum += ((mentalCore - 55) * 0.11 + p.hidden.pressureCore * 0.06 + m.clutchDelta * 0.35) * stakes;
  }
  const n = players.length;
  const metaMod = metaSum / n;
  const shockMod = -(shockSum / n);
  const pressureMod = pressureSum / n;
  const prepMod = prepared * (2.5 + coachQuality(world, team) * 3.5);

  const total = clamp(base.strength + metaMod + shockMod + pressureMod + prepMod, 1, 99);

  return {
    ...base,
    total,
    metaMod,
    shockMod,
    pressureMod,
    prepMod,
    factors: [
      { label: 'Niveau individuel', value: base.individual },
      { label: 'Synergie', value: base.synergyMod },
      { label: 'Coaching', value: base.coachMod },
      { label: 'Méta', value: metaMod },
      { label: 'Adaptation au patch', value: shockMod },
      { label: 'Gestion de l’enjeu', value: pressureMod },
      { label: 'Préparation', value: prepMod },
    ],
  };
}

/**
 * Joue un match.
 * `format` : 1 (BO1), 3 (BO3), 5 (BO5).
 * `stakes` : 0..1, de la poule anonyme à la finale mondiale.
 */
export function simulateMatch(world, opts, rng) {
  const {
    teamA,
    teamB,
    gameState,
    format = 3,
    stakes = 0.3,
    preparedA = 0,
    preparedB = 0,
    label = 'Match',
    competitionId = null,
    round = null,
  } = opts;

  const sA = contextualStrength(world, teamA, { gameState, stakes, prepared: preparedA });
  const sB = contextualStrength(world, teamB, { gameState, stakes, prepared: preparedB });

  const needed = Math.ceil(format / 2);
  let scoreA = 0;
  let scoreB = 0;
  const maps = [];

  while (scoreA < needed && scoreB < needed) {
    // La force varie légèrement d'une carte à l'autre : personne n'est
    // constant sur trois heures de jeu.
    const jitterA = rng.gauss(0, 2.1);
    const jitterB = rng.gauss(0, 2.1);
    // Momentum : mener use l'adversaire, mais un dos au mur peut se raidir.
    const momentum = (scoreA - scoreB) * 0.9;
    const p = winProbability(sA.total + jitterA + momentum * 0.5, sB.total + jitterB);
    const aWins = rng.chance(p);
    if (aWins) scoreA++;
    else scoreB++;
    maps.push({ winner: aWins ? 'A' : 'B', probA: p });
  }

  const winner = scoreA > scoreB ? teamA : teamB;
  const loser = scoreA > scoreB ? teamB : teamA;
  const winnerStrength = scoreA > scoreB ? sA : sB;
  const loserStrength = scoreA > scoreB ? sB : sA;

  const gap = winnerStrength.total - loserStrength.total;
  const upset = gap < -5;
  const close = Math.abs(scoreA - scoreB) === 1 && format > 1;
  // Renversement : mené 0-2 en BO5 puis victoire.
  const comeback = detectComeback(maps, needed);

  const perfs = [
    ...playerPerformances(world, teamA, sA, sB, scoreA > scoreB, stakes, close, rng),
    ...playerPerformances(world, teamB, sB, sA, scoreB > scoreA, stakes, close, rng),
  ];

  const mvp = pickMvp(perfs, winner.id);

  const result = {
    week: world.week,
    gameId: teamA.gameId,
    competitionId,
    round,
    label,
    teamAId: teamA.id,
    teamBId: teamB.id,
    scoreA,
    scoreB,
    winnerId: winner.id,
    loserId: loser.id,
    format,
    stakes,
    upset,
    comeback,
    close,
    mvpId: mvp?.personId ?? null,
    perfs,
    strengthA: sA.total,
    strengthB: sB.total,
    maps,
  };

  applyMatchOutcome(world, result, teamA, teamB, rng);
  // Alimente la vitalité de la scène : upsets, comebacks et finales serrées
  // sont ce qui garde un public (§scene.js).
  recordMatchDrama(world, result);
  return result;
}

function detectComeback(maps, needed) {
  if (needed < 3) return false;
  let a = 0;
  let b = 0;
  let aWasDown = false;
  let bWasDown = false;
  for (const m of maps) {
    if (m.winner === 'A') a++;
    else b++;
    if (b >= needed - 1 && a === 0) aWasDown = true;
    if (a >= needed - 1 && b === 0) bWasDown = true;
  }
  return (a > b && aWasDown) || (b > a && bWasDown);
}

/**
 * Performance individuelle. Un joueur régulier joue proche de son niveau ;
 * un joueur instable peut porter son équipe ou la couler.
 */
function playerPerformances(world, team, own, opp, won, stakes, close, rng) {
  const game = teamGame(team);
  const players = rosterPersons(world, team);
  const out = [];
  for (const p of players) {
    const m = mods(p);
    const level = effectiveRating(p, game);
    const variance = 13 * (1.4 - p.attrs.consistency / 100) * m.formVolatility;
    const clutchBonus = close ? (p.attrs.clutch - 55) * 0.09 * stakes + m.clutchDelta * 0.4 : 0;
    const raw = level - opp.individual + rng.gauss(0, variance) + clutchBonus + (won ? 2.5 : -2.5);
    // Note de match sur 10, centrée sur 6.
    const score = clamp(6 + raw / 9, 0.5, 10);
    out.push({ personId: p.id, teamId: team.id, score, won, raw });
  }
  return out;
}

function pickMvp(perfs, winnerTeamId) {
  const winners = perfs.filter((p) => p.teamId === winnerTeamId);
  if (winners.length === 0) return null;
  return winners.reduce((best, p) => (p.score > best.score ? p : best), winners[0]);
}

/** Conséquences immédiates : stats, forme, moral, fatigue, réputation. */
function applyMatchOutcome(world, result, teamA, teamB, rng) {
  for (const perf of result.perfs) {
    const p = world.persons[perf.personId];
    if (!p) continue;
    p.stats.matches++;
    p.observations++;
    if (perf.won) p.stats.wins++;
    else p.stats.losses++;
    if (result.mvpId === p.id) p.stats.mvps++;

    // La forme suit la performance, pas seulement le résultat.
    const delta = (perf.score - 6) * 0.9 + (perf.won ? 0.8 : -0.8);
    p.form = clamp(p.form + delta * 0.45, -20, 20);
    p.morale = clamp(p.morale + (perf.won ? 1.6 : -1.9) + (perf.score - 6) * 0.5, 0, 100);
    p.fatigue = clamp(p.fatigue + 1.6 + result.stakes * 2.4, 0, 100);
    p.stress = clamp(p.stress + (perf.won ? -0.8 : 1.4) + result.stakes * 1.2, 0, 100);

    // Réputation : les pros regardent les performances, le public les résultats.
    const repGain = (perf.score - 6) * 0.16 * (0.4 + result.stakes);
    p.reputation.pros = clamp(p.reputation.pros + repGain, 0, 100);
    if (result.stakes > 0.5) {
      p.reputation.public = clamp(
        p.reputation.public + (perf.won ? 0.5 : 0.1) * result.stakes * 2 + repGain * 0.5,
        0,
        100,
      );
    }
  }

  for (const [team, won] of [
    [teamA, result.winnerId === teamA.id],
    [teamB, result.winnerId === teamB.id],
  ]) {
    team.season.played++;
    team.season.mapWins += team.id === teamA.id ? result.scoreA : result.scoreB;
    team.season.mapLosses += team.id === teamA.id ? result.scoreB : result.scoreA;
    if (won) {
      team.season.wins++;
      team.season.points += 3;
    } else {
      team.season.losses++;
    }
  }
}

/**
 * Moments notables d'un match (§28). Générés à partir de ce qui s'est
 * réellement passé dans la simulation — jamais décoratifs.
 */
export function matchHighlights(world, result) {
  const out = [];
  const mvp = result.mvpId ? world.persons[result.mvpId] : null;
  if (result.comeback) {
    out.push({
      kind: 'comeback',
      text: `Renversement complet : mené au bord de l'élimination, le vainqueur arrache la victoire ${Math.max(result.scoreA, result.scoreB)}-${Math.min(result.scoreA, result.scoreB)}.`,
    });
  }
  if (result.upset) {
    out.push({
      kind: 'upset',
      text: `Surprise majeure : l'outsider renverse la hiérarchie.`,
    });
  }
  if (mvp) {
    const perf = result.perfs.find((p) => p.personId === mvp.id);
    if (perf && perf.score > 8.6) {
      out.push({
        kind: 'carry',
        text: `${mvp.nick} sort un match de très haut niveau (${perf.score.toFixed(1)}/10).`,
      });
    }
  }
  const collapse = result.perfs.filter((p) => p.score < 3.2);
  for (const c of collapse) {
    const p = world.persons[c.personId];
    if (p) out.push({ kind: 'collapse', text: `${p.nick} passe complètement à côté (${c.score.toFixed(1)}/10).` });
  }
  return out;
}
