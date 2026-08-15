/**
 * État de carrière du joueur (§32).
 *
 * Tout ce que le moteur écrit ici est un FAIT daté. La page Legacy et le
 * récit final (§72) ne font que relire cette structure : ils n'inventent
 * jamais un événement qui n'a pas eu lieu.
 */

import { clamp } from './rng.js';
import { createEventState } from './events/engine.js';
import { DEFAULT_ROUTINE } from '../data/training.js';
import { formatDate, yearOf } from './time.js';

export const DIFFICULTIES = {
  story: {
    id: 'story',
    label: 'Récit',
    desc: 'Les opportunités viennent plus facilement. Pour découvrir le jeu.',
    opportunity: 1.35,
    progression: 1.15,
    consequence: 0.7,
    demand: 0.85,
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    desc: 'L’équilibre prévu par le jeu.',
    opportunity: 1,
    progression: 1,
    consequence: 1,
    demand: 1,
  },
  hard: {
    id: 'hard',
    label: 'Exigeant',
    desc: 'Moins d’occasions, des structures plus dures, des erreurs qui coûtent.',
    opportunity: 0.7,
    progression: 0.88,
    consequence: 1.35,
    demand: 1.2,
  },
  brutal: {
    id: 'brutal',
    label: 'Impitoyable',
    desc: 'La plupart des carrières n’aboutissent pas. C’est le propos.',
    opportunity: 0.45,
    progression: 0.78,
    consequence: 1.7,
    demand: 1.45,
  },
};

export const LIFESTYLES = {
  frugal: { id: 'frugal', label: 'Frugal', cost: 380, moraleWeekly: -0.35, stress: 0.2 },
  normal: { id: 'normal', label: 'Normal', cost: 900, moraleWeekly: 0, stress: 0 },
  comfortable: { id: 'comfortable', label: 'Confortable', cost: 1900, moraleWeekly: 0.5, stress: -0.3 },
  lavish: { id: 'lavish', label: 'Train de vie élevé', cost: 4200, moraleWeekly: 0.9, stress: -0.4 },
};

export function createCareer(world, person, opts = {}) {
  const {
    difficulty = 'standard',
    originId = null,
    familyId = null,
    money = 500,
    seed = world.seed,
    scenarioId = null,
  } = opts;

  return {
    personId: person.id,
    seed,
    difficulty,
    scenarioId,
    originId,
    familyId,
    startWeek: world.week,

    routine: [...DEFAULT_ROUTINE],
    lifestyle: 'normal',
    money,
    monthlyDebt: 0,

    eventState: createEventState(),
    timeline: [],
    memories: [],
    achievements: [],
    goals: [],
    hiddenGoals: [],
    flags: {},

    rivalId: null,
    mentorId: null,
    learningGameId: null,

    offers: [],
    pendingDecision: null,

    retired: false,
    retiredWeek: null,
    retirementPath: null,

    counters: {
      weeks: 0,
      decisions: 0,
      gamesPlayed: [],
      orgsPlayed: [],
      seasonsCompeted: 0,
      lowestPoint: null,
      highestRating: 0,
      timesReleased: 0,
      titlesByTier: {},
    },
  };
}

/** Ajoute un fait daté à la timeline. C'est la matière première du récit. */
export function logTimeline(career, world, text, { kind = 'info', important = false, data = null } = {}) {
  career.timeline.push({
    week: world.week,
    year: yearOf(world.week),
    kind,
    text,
    important,
    data,
  });
  return career.timeline[career.timeline.length - 1];
}

/** Moment marquant (§28) : conservé même quand la timeline est résumée. */
export function addMemory(career, world, { kind, title, text, data = null }) {
  career.memories.push({ week: world.week, year: yearOf(world.week), kind, title, text, data });
  return career.memories[career.memories.length - 1];
}

export function addAchievement(career, world, achievementId) {
  if (career.achievements.some((a) => a.id === achievementId)) return false;
  career.achievements.push({ id: achievementId, week: world.week, year: yearOf(world.week) });
  return true;
}

export function hasAchievement(career, id) {
  return career.achievements.some((a) => a.id === id);
}

export function setFlag(career, name, value = true) {
  career.flags[name] = value;
}

export function getFlag(career, name) {
  return career.flags[name];
}

export function difficultyOf(career) {
  return DIFFICULTIES[career.difficulty] ?? DIFFICULTIES.standard;
}

export function lifestyleOf(career) {
  return LIFESTYLES[career.lifestyle] ?? LIFESTYLES.normal;
}

/** Timeline condensée par année, pour la page Carrière (§65). */
export function timelineByYear(career) {
  const byYear = new Map();
  for (const entry of career.timeline) {
    if (!byYear.has(entry.year)) byYear.set(entry.year, []);
    byYear.get(entry.year).push(entry);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, entries]) => ({ year, entries }));
}

export function formatTimelineEntry(entry) {
  return `${formatDate(entry.week)} — ${entry.text}`;
}

export function trackGamePlayed(career, gameId) {
  if (gameId && !career.counters.gamesPlayed.includes(gameId)) {
    career.counters.gamesPlayed.push(gameId);
  }
}

export function trackOrg(career, orgId) {
  if (orgId && !career.counters.orgsPlayed.includes(orgId)) {
    career.counters.orgsPlayed.push(orgId);
  }
}

export function spend(career, amount) {
  career.money -= amount;
  if (career.money < 0) {
    career.monthlyDebt += -career.money;
    career.money = 0;
    return false;
  }
  return true;
}

export function earn(career, amount) {
  career.money += Math.max(0, amount);
}

export function netWorth(career) {
  return clamp(career.money - career.monthlyDebt, -1e9, 1e9);
}
