/**
 * Charge, états de surcharge et récupération (étape 7B).
 *
 * PROBLÈME CORRIGÉ
 * ----------------
 * Il n'y avait pas de modèle de charge. Trois mesures l'ont établi :
 *
 *  1. `burnoutPressure()` était exportée avec le commentaire « sert aux
 *     retraites (§48) » et **n'était appelée nulle part**. `maybeRetire` ne
 *     lisait ni la fatigue ni le stress : la longévité ne dépendait que de
 *     l'âge — mesuré, 14 carrières sur 14 en politique prudente s'arrêtaient au
 *     plafond de 34 ans.
 *
 *  2. Les variations hebdomadaires de fatigue, stress et moral sont
 *     **constantes pour une routine donnée**. Chacune converge donc vers un
 *     point fixe en quelques semaines et n'en bouge plus : le résultat est
 *     déterminé au moment où la routine est choisie, pas par l'histoire du
 *     joueur. Mesuré sur 10 carrières par politique :
 *
 *       prudent   : fatigue  1,2 | stress  0,2 | moral 98,4 | 0 % de semaines chargées
 *       grinder   : fatigue 70,9 | stress 57,3 | moral 21,6 | 68,6 %
 *       saboteur  : fatigue 97,8 | stress  2,0 | moral 98,3 | 96,9 %, série de 936 semaines
 *
 *  3. Fatigue et stress étant indépendants, l'état « épuisé mais serein » est
 *     stable : le saboteur tenait dix-huit ans à 97,8 de fatigue avec 2,0 de
 *     stress et 98,3 de moral.
 *
 * Et la pénalité était un **malus plat** : `1 - max(0, fatigue-55)/75`, soit
 * jusqu'à −55 % de progression en continu. Travailler dur ne comportait donc
 * aucun risque à assumer — seulement un coût certain, ce qui n'est pas un
 * arbitrage.
 *
 * MODÈLE RETENU
 * -------------
 * Une grandeur propre, `load`, distincte de la fatigue instantanée : elle
 * mémorise l'accumulation. Elle monte avec le volume, la densité de
 * compétitions et la pression du contexte, elle est amplifiée par les
 * **semaines chargées consécutives**, et elle redescend d'autant plus
 * lentement qu'elle est haute — c'est l'inertie : une grosse semaine laisse
 * une trace, elle ne condamne pas.
 *
 * Sept états, avec des seuils de montée et de descente distincts (hystérésis)
 * pour qu'un joueur à la frontière ne clignote pas d'un état à l'autre.
 *
 * La charge **couple** les trois variables : haute et durable, elle pousse la
 * fatigue et le stress et érode le moral. « Épuisé mais serein » cesse d'être
 * un état atteignable.
 *
 * Enfin le risque remplace le malus : une charge moyenne **améliore** la
 * progression — pousser paie à court terme — et ce sont les états hauts qui
 * coûtent, en progression comme en probabilité d'incident.
 */

import { clamp } from './rng.js';
import { isTracing, trace, TRACE } from './trace.js';

/** Les sept états de charge (§2). */
export const LOAD_STATES = {
  FRESH: 'frais',
  TIRED: 'fatigué',
  PRESSURED: 'sous pression',
  OVERLOADED: 'surmené',
  DRAINED: 'épuisé',
  BURNOUT: 'burnout',
  RECOVERING: 'récupération',
};

/**
 * Échelle des états. `up` est le seuil de montée, `down` celui de descente :
 * les deux diffèrent volontairement, sans quoi un joueur stabilisé juste à la
 * limite oscillerait chaque semaine entre deux états.
 */
const LADDER = [
  { state: LOAD_STATES.FRESH, up: -Infinity, down: -Infinity },
  { state: LOAD_STATES.TIRED, up: 26, down: 19 },
  { state: LOAD_STATES.PRESSURED, up: 46, down: 37 },
  { state: LOAD_STATES.OVERLOADED, up: 63, down: 53 },
  { state: LOAD_STATES.DRAINED, up: 79, down: 67 },
];

/** Au-delà, la rupture — mais elle n'est jamais automatique (voir `crashRisk`). */
const BURNOUT_ENTRY = 93;

/** Charge en dessous de laquelle un burnout laisse place à la récupération. */
const RECOVERY_EXIT = 42;

/** Intensité hebdomadaire au-delà de laquelle une semaine compte comme chargée. */
const HEAVY_WEEK = 7;

/** État de charge neuf. */
export function createLoadState() {
  return {
    value: 0,
    state: LOAD_STATES.FRESH,
    weeksInState: 0,
    // Semaines chargées consécutives : c'est cette mémoire qui distingue
    // « une grosse semaine » de « trois mois sans respirer ».
    heavyStreak: 0,
    longestStreak: 0,
    peak: 0,
    episodes: 0,
    lastEpisodeWeek: null,
    // Semaines cumulées passées dans les états hauts, pour l'audit.
    weeksHigh: 0,
  };
}

export function ensureLoad(person) {
  if (!person.load) person.load = createLoadState();
  return person.load;
}

/**
 * Intensité brute de la semaine, avant accumulation.
 *
 * Quatre sources, comme demandé : le volume d'entraînement, la densité de
 * compétitions, la pression du contexte, et la sensibilité propre du joueur.
 * La pression contextuelle est ce qui fait que la charge dépend de la
 * **situation réelle** et non seulement de la routine choisie : jouer titulaire
 * dans une grosse structure après une défaite ne coûte pas la même chose que
 * s'entraîner tranquillement en amateur.
 */
export function weeklyIntensity(person, ctx = {}) {
  const factors = [];
  const add = (key, label, value) => {
    if (value) factors.push({ key, label, delta: Math.round(value * 100) / 100 });
    return value;
  };

  // 1. Volume : le coût de fatigue des activités sert de mesure d'intensité.
  const volume = add('volume', 'volume d’entraînement', ctx.rawFatigue ?? 0);

  // 2. Densité de compétition.
  const matches = add('matches', 'compétitions', (ctx.matchLoad ?? 0) * 2.2);

  // 3. Pression du contexte : niveau de la structure, statut de titulaire,
  //    attentes, résultats récents.
  const pressure = add('pressure', 'pression du contexte', ctx.pressure ?? 0);

  // 4. Sensibilité personnelle (traits) et plancher de récupération.
  const sensitivity = 0.75 + (ctx.sensitivity ?? 1) * 0.35;
  const raw = Math.max(0, volume + matches + pressure) * sensitivity;
  add('sensitivity', `sensibilité ×${Math.round(sensitivity * 100) / 100}`, 0);

  return { raw, factors };
}

/**
 * Pression contextuelle : ce que la situation exige du joueur, indépendamment
 * de ce qu'il choisit de faire.
 */
export function contextPressure(world, person, { team = null, org = null, career = null } = {}) {
  if (!team || !org) return 0;
  let p = 0;
  // Le niveau attendu : une organisation internationale ne pardonne pas.
  p += (org.tier ?? 1) * 0.42;
  // Être titulaire expose ; le banc protège.
  const starter = team.roster?.includes(person.id);
  p += starter ? 0.9 : 0.2;
  // Les attentes de la structure.
  p += (org.pressure ?? 0) * 1.6;
  // Une mauvaise passe pèse : les défaites récentes coûtent plus que les
  // victoires ne soulagent.
  const season = team.season;
  if (season?.played > 3) {
    const winRatio = season.wins / Math.max(1, season.played);
    p += clamp((0.5 - winRatio) * 2.4, -0.5, 1.4);
  }
  // La notoriété appelle des sollicitations.
  p += clamp((person.reputation?.public ?? 0) / 100, 0, 1) * 0.7;
  // Et la durée passée au plus haut niveau finit par compter.
  const seasonsPro = person.stats?.seasonsPro ?? 0;
  p += clamp(seasonsPro / 14, 0, 1) * 0.6;
  return Math.max(0, p);
}

/**
 * Fait vivre la charge d'une semaine (ou d'un lot de semaines).
 *
 * Retourne l'état après mise à jour. Ne déclenche rien : c'est
 * `crashRisk` qui décide d'un incident, et l'appelant qui en fait un
 * événement.
 */
export function updateLoad(person, ctx = {}, weeks = 1) {
  const load = ensureLoad(person);
  const before = load.value;
  const beforeState = load.state;

  const { raw, factors } = weeklyIntensity(person, ctx);

  // Semaines chargées consécutives : la mémoire qui manquait.
  if (raw >= HEAVY_WEEK) {
    load.heavyStreak += weeks;
    load.longestStreak = Math.max(load.longestStreak, load.heavyStreak);
  } else {
    // On ne remet pas à zéro d'un coup : sortir d'une période chargée prend
    // du temps, sinon une semaine calme effacerait trois mois de surcharge.
    load.heavyStreak = Math.max(0, load.heavyStreak - weeks * 2);
  }
  // Une série longue amplifie ce que coûte chaque semaine supplémentaire.
  const streakAmp = 1 + clamp(load.heavyStreak / 18, 0, 0.7);

  // Récupération : d'autant plus lente que la charge est haute — l'inertie.
  const baseRecovery = 4.2 + (1 - (person.hidden?.burnoutFloor ?? 0.5)) * 2.4;
  const drag = 1 - clamp(load.value / 160, 0, 0.55);
  const recovery = baseRecovery * drag * (ctx.restBonus ?? 1);

  const gain = raw * streakAmp;
  load.value = clamp(load.value + (gain - recovery) * weeks, 0, 100);
  load.peak = Math.max(load.peak, load.value);

  const next = nextState(load, load.value);
  if (next !== load.state) {
    load.state = next;
    load.weeksInState = 0;
  } else {
    load.weeksInState += weeks;
  }
  if (isHigh(load.state)) load.weeksHigh += weeks;

  if (isTracing() && (next !== beforeState || Math.abs(load.value - before) > 6)) {
    trace(TRACE.LOAD, ctx.week ?? 0, {
      decision: 'load',
      personId: person.id,
      before: Math.round(before),
      after: Math.round(load.value),
      state: load.state,
      previousState: beforeState,
      intensity: Math.round(raw * 10) / 10,
      heavyStreak: load.heavyStreak,
      streakAmp: Math.round(streakAmp * 100) / 100,
      recovery: Math.round(recovery * 10) / 10,
      factors,
    });
  }
  return load;
}

/** Les états qui comptent comme surcharge, pour les mesures et les risques. */
export function isHigh(state) {
  return (
    state === LOAD_STATES.OVERLOADED ||
    state === LOAD_STATES.DRAINED ||
    state === LOAD_STATES.BURNOUT
  );
}

/**
 * Transition d'état, avec hystérésis.
 *
 * Le burnout et la récupération sont des états à part : on n'entre pas en
 * burnout par simple franchissement — `markBurnout` le fait, après un incident
 * — et on n'en sort que par la récupération, laquelle se termine quand la
 * charge est réellement redescendue.
 */
function nextState(load, value) {
  if (load.state === LOAD_STATES.BURNOUT) {
    return value <= RECOVERY_EXIT + 18 ? LOAD_STATES.RECOVERING : LOAD_STATES.BURNOUT;
  }
  if (load.state === LOAD_STATES.RECOVERING) {
    // On ne quitte la récupération que descendu, ou si tout remonte en flèche.
    if (value >= BURNOUT_ENTRY) return LOAD_STATES.BURNOUT;
    return value <= RECOVERY_EXIT ? LOAD_STATES.FRESH : LOAD_STATES.RECOVERING;
  }

  const currentIndex = LADDER.findIndex((l) => l.state === load.state);
  const index = currentIndex < 0 ? 0 : currentIndex;

  // Montée : il faut franchir le seuil `up` du palier suivant.
  for (let i = LADDER.length - 1; i > index; i--) {
    if (value >= LADDER[i].up) return LADDER[i].state;
  }
  // Descente : il faut repasser sous le seuil `down` du palier courant.
  for (let i = index; i > 0; i--) {
    if (value < LADDER[i].down) continue;
    return LADDER[i].state;
  }
  return LOAD_STATES.FRESH;
}

/**
 * Probabilité d'un incident cette semaine.
 *
 * C'est ici que le grind devient un pari plutôt qu'une punition : la charge
 * moyenne ne risque rien, les états hauts risquent beaucoup, et la série de
 * semaines chargées compte autant que le niveau atteint.
 */
export function crashRisk(person) {
  const load = person.load;
  if (!load) return 0;
  if (load.state === LOAD_STATES.BURNOUT || load.state === LOAD_STATES.RECOVERING) return 0;
  if (!isHigh(load.state)) return 0;
  const overshoot = clamp((load.value - 60) / 40, 0, 1);
  const streak = clamp(load.heavyStreak / 40, 0, 1);
  const fragility = 1 - (person.hidden?.burnoutFloor ?? 0.5) * 0.5;
  // Un joueur déjà passé par là est plus vulnérable la fois suivante.
  const scar = 1 + clamp((load.episodes ?? 0) * 0.25, 0, 0.75);
  return clamp(overshoot * 0.028 * (0.5 + streak) * fragility * scar, 0, 0.09);
}

/** Enregistre un épisode de rupture. Appelé par l'événement, pas par la charge. */
export function markBurnout(person, week) {
  const load = ensureLoad(person);
  load.state = LOAD_STATES.BURNOUT;
  load.weeksInState = 0;
  load.episodes = (load.episodes ?? 0) + 1;
  load.lastEpisodeWeek = week;
  load.heavyStreak = 0;
  return load;
}

/** Allège la charge : repos choisi, semaine allégée par le staff, pause. */
export function relieveLoad(person, amount, { week = 0, reason = 'repos' } = {}) {
  const load = ensureLoad(person);
  const before = load.value;
  load.value = clamp(load.value - Math.abs(amount), 0, 100);
  load.heavyStreak = Math.max(0, load.heavyStreak - Math.round(Math.abs(amount) / 3));
  const next = nextState(load, load.value);
  if (next !== load.state) {
    load.state = next;
    load.weeksInState = 0;
  }
  if (isTracing()) {
    trace(TRACE.LOAD, week, {
      decision: 'relief',
      personId: person.id,
      reason,
      before: Math.round(before),
      after: Math.round(load.value),
      state: load.state,
    });
  }
  return load;
}

/**
 * Effet de la charge sur la progression : **une cloche, pas une pente**.
 *
 * Pousser paie à court terme — jusqu'à +24 % autour d'une charge moyenne —
 * puis le rendement s'inverse et les états hauts coûtent cher. C'est ce qui
 * remplace le malus plat `1 - max(0, fatigue-55)/75`, lequel faisait du travail
 * intensif un coût certain sans contrepartie.
 */
export function loadProgressionFactor(person) {
  const load = person.load;
  if (!load) return 1;
  const v = load.value;
  if (v <= 50) return 1 + (v / 50) * 0.24;
  if (load.state === LOAD_STATES.BURNOUT) return 0.35;
  if (load.state === LOAD_STATES.RECOVERING) return 0.8;
  return clamp(1.24 - ((v - 50) / 50) * 0.82, 0.42, 1.24);
}

/**
 * Ce que la charge impose aux trois autres variables.
 *
 * Sans ce couplage, « fatigue 98 + stress 2 + moral 98 » est un état stable —
 * il l'était, et le saboteur y a passé dix-huit ans.
 */
export function loadCoupling(person) {
  const load = person.load;
  if (!load) return { fatigue: 0, stress: 0, morale: 0 };
  // Rien en dessous de « sous pression » : la charge ordinaire ne pèse pas.
  const p = clamp((load.value - 40) / 60, 0, 1);
  const chronic = clamp(load.weeksInState / 30, 0, 1) * (isHigh(load.state) ? 1 : 0);
  return {
    fatigue: p * 3.4 + chronic * 1.2,
    stress: p * 3.1 + chronic * 1.6,
    morale: -(p * 1.9 + chronic * 1.5),
  };
}

/** Photographie de charge, pour l'audit. */
export function loadSnapshot(person) {
  const l = person.load ?? createLoadState();
  return {
    value: Math.round(l.value * 10) / 10,
    state: l.state,
    weeksInState: l.weeksInState,
    heavyStreak: l.heavyStreak,
    longestStreak: l.longestStreak,
    peak: Math.round(l.peak * 10) / 10,
    episodes: l.episodes ?? 0,
    weeksHigh: l.weeksHigh ?? 0,
  };
}

/** Explication lisible d'une trace de charge (§12). */
export function explainLoad(entry) {
  if (entry.decision === 'relief') {
    return `S${entry.week} — charge allégée (${entry.reason}) : ${entry.before} → ${entry.after} (${entry.state})`;
  }
  const lines = [
    `S${entry.week} — charge ${entry.before} → ${entry.after}` +
      (entry.previousState !== entry.state ? ` : ${entry.previousState} → ${entry.state}` : ` (${entry.state})`),
  ];
  lines.push(`    intensité ${entry.intensity} × amplification de série ${entry.streakAmp} (${entry.heavyStreak} semaines chargées)`);
  lines.push(`    récupération ${entry.recovery}`);
  for (const f of entry.factors ?? []) lines.push(`    ${f.label} : ${f.delta}`);
  return lines.join('\n');
}
