/**
 * Audit de la charge et de ses conséquences (étape 7B).
 *
 * Produit les grandeurs demandées pour le rapport comparatif : durées, pics,
 * progression à court et à long terme, états de surcharge, ruptures et
 * récupérations, retraites liées à la charge, talents gâchés, corrélation
 * potentiel → pic, diversité des signatures et archétypes.
 *
 * Deux principes, appris à mes dépens dans les étapes précédentes :
 *
 *  1. **Ne jamais réimplémenter une formule du moteur pour la mesurer.** Une
 *     version antérieure de l'instrument recalculait à la main l'ancien facteur
 *     de fatigue, supprimé depuis : la colonne ne mesurait donc plus rien. Tout
 *     ce qui est calculé ici est lu dans le moteur.
 *
 *  2. **Relever à des horizons distincts, pas en moyenne.** Une moyenne de
 *     carrière mélange la phase où le grind rapporte et celle où il coûte, et ne
 *     peut donc pas répondre à « avantageux à court terme, risqué à long
 *     terme ». Les relevés annuels sont conservés séparément.
 */

import { RNG, normalizeSeed } from '../rng.js';
import {
  createSession,
  advanceWeek,
  resolveDecision,
  acceptOffer,
  seekTeam,
  canSeekTeam,
  foundTeam,
  canFoundTeam,
  setRoutine,
} from '../simulation.js';
import { createPolicyState, pickChoice, POLICY_IDS } from './policies.js';
import { randomPlayerConfig } from './runner.js';
import { baseRating, weightedCeiling } from '../person.js';
import { GAMES_BY_ID } from '../../data/games.js';
import { WEEKS_PER_YEAR } from '../time.js';
import { LOAD_STATES, isHigh, loadSnapshot } from '../load.js';
import { burnoutPressure } from '../progression.js';
import { computeLegacy } from '../legacy.js';

/** Horizons de relevé : c'est leur écart qui porte l'information. */
export const HORIZONS = [1, 2, 3, 5, 8, 12, 16, 20];

function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function quantile(values, q) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return round(s[lo] + (s[hi] - s[lo]) * (i - lo));
}

const mean = (a) => (a.length ? round(a.reduce((x, y) => x + y, 0) / a.length) : 0);

/** Coefficient de corrélation de Pearson, pour « potentiel → pic ». */
export function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return round(num / Math.sqrt(dx * dy), 3);
}

/**
 * Joue une carrière sous une politique et relève tout ce qui nous intéresse.
 * Un seul passage : relancer la même carrière pour chaque métrique coûterait
 * autant de fois le temps de simulation.
 */
function playOne({ seed, policyId, years }) {
  const configRng = new RNG(normalizeSeed(`${seed}:config`));
  const player = randomPlayerConfig(configRng);
  const policyState = createPolicyState(policyId, normalizeSeed(`${seed}:policy`));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  if (policyState.policy.routine) setRoutine(session, policyState.policy.routine);
  const person = session.world.persons[session.career.personId];

  const ratingAt = {};
  const stateWeeks = {};
  const condition = { fatigue: [], stress: [], morale: [], load: [] };
  let weeks = 0;
  let recoveries = 0;
  let previousState = person.load?.state ?? LOAD_STATES.FRESH;

  while (weeks < years * WEEKS_PER_YEAR) {
    if (session.career.retired) break;
    const report = advanceWeek(session);
    weeks++;
    if (report.decision && !report.decision.resolved) {
      const choice = pickChoice(policyState, report.decision.choices);
      if (choice) resolveDecision(session, choice.id);
    }
    if (session.career.offers?.length) acceptOffer(session, 0);
    const hasReal = person.teamId && !session.world.teams[person.teamId]?.isSelfTeam;
    if (!hasReal && canSeekTeam(session).ok) {
      const res = seekTeam(session);
      if (res.offers?.length) acceptOffer(session, 0);
      else if (canFoundTeam(session).ok && policyState.rng.chance(0.7)) foundTeam(session);
    }

    const state = person.load?.state ?? LOAD_STATES.FRESH;
    stateWeeks[state] = (stateWeeks[state] ?? 0) + 1;
    // Une récupération achevée : on quitte l'état de récupération vers le bas.
    if (previousState === LOAD_STATES.RECOVERING && state !== LOAD_STATES.RECOVERING) recoveries++;
    previousState = state;

    condition.fatigue.push(person.fatigue);
    condition.stress.push(person.stress);
    condition.morale.push(person.morale);
    condition.load.push(person.load?.value ?? 0);

    if (weeks % WEEKS_PER_YEAR === 0) {
      const y = weeks / WEEKS_PER_YEAR;
      if (HORIZONS.includes(y)) ratingAt[y] = baseRating(person, GAMES_BY_ID[person.gameId]);
    }
  }

  const legacy = computeLegacy(session.world, session.career);
  const game = GAMES_BY_ID[person.gameId];
  const ceiling = weightedCeiling(person, game);
  const load = loadSnapshot(person);

  return {
    seed,
    policyId,
    years: round(weeks / WEEKS_PER_YEAR),
    retiredPath: session.career.retirementPath ?? null,
    peak: round(person.stats.peakRating),
    ceiling: round(ceiling),
    // « Talent gâché » : un plafond élevé jamais approché.
    wasted: ceiling > 78 && person.stats.peakRating < ceiling - 16,
    ratingAt,
    stateWeeks,
    weeksHigh: Object.entries(stateWeeks)
      .filter(([s]) => isHigh(s))
      .reduce((s, [, n]) => s + n, 0),
    totalWeeks: weeks,
    episodes: load.episodes,
    recoveries,
    longestStreak: load.longestStreak,
    finalPressure: round(burnoutPressure(person)),
    condition: {
      fatigue: mean(condition.fatigue),
      stress: mean(condition.stress),
      morale: mean(condition.morale),
      load: mean(condition.load),
    },
    archetype: legacy.archetype.id,
    legacy: legacy.global,
    titles: person.stats.titles,
    // Signature de trajectoire, pour la diversité.
    signature: [
      person.stats.titles,
      person.stats.internationalTitles,
      Math.round(person.stats.peakRating / 4),
      Math.round(weeks / WEEKS_PER_YEAR / 2),
      load.episodes,
      legacy.archetype.id,
      session.career.retirementPath ?? '—',
    ].join('|'),
  };
}

/**
 * Fait tourner `perPolicy` carrières pour chaque politique et agrège.
 */
export function runLoadAudit({ perPolicy = 12, years = 20, policies = POLICY_IDS, seedRoot = 'load-audit' } = {}) {
  const rows = [];
  let crashes = 0;
  for (const policyId of policies) {
    for (let i = 0; i < perPolicy; i++) {
      try {
        rows.push(playOne({ seed: `${seedRoot}:${i}`, policyId, years }));
      } catch (err) {
        crashes++;
      }
    }
  }

  const byPolicy = {};
  for (const policyId of policies) {
    const own = rows.filter((r) => r.policyId === policyId);
    if (!own.length) continue;
    const states = {};
    let totalWeeks = 0;
    for (const r of own) {
      totalWeeks += r.totalWeeks;
      for (const [s, n] of Object.entries(r.stateWeeks)) states[s] = (states[s] ?? 0) + n;
    }
    byPolicy[policyId] = {
      n: own.length,
      years: { mean: mean(own.map((r) => r.years)), median: quantile(own.map((r) => r.years), 0.5) },
      peak: { mean: mean(own.map((r) => r.peak)), median: quantile(own.map((r) => r.peak), 0.5), max: Math.max(...own.map((r) => r.peak)) },
      legacy: mean(own.map((r) => r.legacy)),
      titles: mean(own.map((r) => r.titles)),
      condition: {
        fatigue: mean(own.map((r) => r.condition.fatigue)),
        stress: mean(own.map((r) => r.condition.stress)),
        morale: mean(own.map((r) => r.condition.morale)),
        load: mean(own.map((r) => r.condition.load)),
      },
      // Progression aux horizons : c'est l'écart entre eux qui dit si pousser
      // paie tôt et coûte tard.
      ratingAt: Object.fromEntries(
        HORIZONS.map((y) => {
          const vals = own.map((r) => r.ratingAt[y]).filter((v) => v !== undefined);
          return [y, vals.length ? mean(vals) : null];
        }),
      ),
      // Part des semaines passée dans chaque état.
      states: Object.fromEntries(
        Object.entries(states)
          .sort((a, b) => b[1] - a[1])
          .map(([s, n]) => [s, round((100 * n) / Math.max(1, totalWeeks), 1)]),
      ),
      shareHigh: round(own.reduce((s, r) => s + r.weeksHigh, 0) / Math.max(1, totalWeeks), 3),
      episodes: mean(own.map((r) => r.episodes)),
      shareWithEpisode: round(own.filter((r) => r.episodes > 0).length / own.length, 3),
      recoveries: mean(own.map((r) => r.recoveries)),
      longestStreak: mean(own.map((r) => r.longestStreak)),
      wasted: round(own.filter((r) => r.wasted).length / own.length, 3),
      loadRetirements: own.filter((r) => r.retiredPath === 'charge accumulée').length,
      retirementPaths: own.reduce((acc, r) => {
        const k = r.retiredPath ?? '(en activité)';
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
      potentialToPeak: correlation(own.map((r) => r.ceiling), own.map((r) => r.peak)),
    };
  }

  const signatures = new Set(rows.map((r) => r.signature));
  const archetypes = {};
  for (const r of rows) archetypes[r.archetype] = (archetypes[r.archetype] ?? 0) + 1;

  return {
    careers: rows.length,
    crashes,
    byPolicy,
    global: {
      years: { mean: mean(rows.map((r) => r.years)), median: quantile(rows.map((r) => r.years), 0.5) },
      peak: { mean: mean(rows.map((r) => r.peak)), median: quantile(rows.map((r) => r.peak), 0.5) },
      wasted: round(rows.filter((r) => r.wasted).length / rows.length, 3),
      potentialToPeak: correlation(rows.map((r) => r.ceiling), rows.map((r) => r.peak)),
      uniqueSignatures: signatures.size,
      signatureShare: round(signatures.size / rows.length, 3),
      archetypes: Object.fromEntries(
        Object.entries(archetypes)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => [k, round(n / rows.length, 3)]),
      ),
      loadRetirements: rows.filter((r) => r.retiredPath === 'charge accumulée').length,
      shareWithEpisode: round(rows.filter((r) => r.episodes > 0).length / rows.length, 3),
    },
    rows,
  };
}
