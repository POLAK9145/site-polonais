/**
 * Calendrier du monde.
 *
 * Le tick atomique est la SEMAINE : assez fin pour que les choix
 * d'entraînement comptent, assez large pour traverser 15 ans de carrière
 * sans que la partie devienne interminable.
 *
 * Une année = 52 semaines, découpée en phases partagées par toutes les
 * scènes. Chaque jeu place ses compétitions dans ces fenêtres, ce qui crée
 * naturellement des mercatos communs et des saisons lisibles.
 */

export const WEEKS_PER_YEAR = 52;

export const PHASES = {
  PRESEASON: 'preseason',
  SPLIT_1: 'split1',
  PLAYOFFS_1: 'playoffs1',
  INTERNATIONAL: 'international',
  SPLIT_2: 'split2',
  PLAYOFFS_2: 'playoffs2',
  WORLDS: 'worlds',
  OFFSEASON: 'offseason',
};

export const PHASE_LABELS = {
  preseason: 'Présaison',
  split1: 'Saison régulière — Split 1',
  playoffs1: 'Playoffs — Split 1',
  international: 'Tournoi international',
  split2: 'Saison régulière — Split 2',
  playoffs2: 'Playoffs — Split 2',
  worlds: 'Championnat du monde',
  offseason: 'Intersaison',
};

/** [début, fin] inclus, en semaines 1-indexées. */
const PHASE_RANGES = [
  [1, 2, PHASES.PRESEASON],
  [3, 18, PHASES.SPLIT_1],
  [19, 22, PHASES.PLAYOFFS_1],
  [23, 26, PHASES.INTERNATIONAL],
  [27, 42, PHASES.SPLIT_2],
  [43, 46, PHASES.PLAYOFFS_2],
  [47, 50, PHASES.WORLDS],
  [51, 52, PHASES.OFFSEASON],
];

export function phaseOfWeek(week) {
  const w = weekOfYear(week);
  for (const [start, end, phase] of PHASE_RANGES) {
    if (w >= start && w <= end) return phase;
  }
  return PHASES.OFFSEASON;
}

/** Semaine absolue -> année. */
export function yearOf(absWeek) {
  return Math.floor(absWeek / WEEKS_PER_YEAR);
}

/** Semaine absolue -> semaine dans l'année (1..52). */
export function weekOfYear(absWeek) {
  return (((absWeek % WEEKS_PER_YEAR) + WEEKS_PER_YEAR) % WEEKS_PER_YEAR) + 1;
}

export function absWeek(year, week) {
  return year * WEEKS_PER_YEAR + (week - 1);
}

/**
 * Le mercato n'est ouvert qu'en intersaison et en présaison (fenêtre
 * principale) ou autour du tournoi international (fenêtre courte).
 * Sans cette contrainte, les transferts deviendraient du bruit permanent.
 */
export function isTransferWindow(absW) {
  const p = phaseOfWeek(absW);
  return p === PHASES.OFFSEASON || p === PHASES.PRESEASON || p === PHASES.INTERNATIONAL;
}

export function isMajorTransferWindow(absW) {
  const p = phaseOfWeek(absW);
  return p === PHASES.OFFSEASON || p === PHASES.PRESEASON;
}

/** Âge en années (float) à partir d'une date de naissance en semaines. */
export function ageAt(birthWeek, absW) {
  return (absW - birthWeek) / WEEKS_PER_YEAR;
}

export function ageYears(birthWeek, absW) {
  return Math.floor(ageAt(birthWeek, absW));
}

export function formatDate(absW) {
  return `S${weekOfYear(absW)} ${yearOf(absW)}`;
}

export function formatPhase(absW) {
  return PHASE_LABELS[phaseOfWeek(absW)];
}
