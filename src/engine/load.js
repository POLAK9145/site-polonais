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
const HEAVY_WEEK = 9;

/**
 * Intensité qu'une semaine de professionnel absorbe sans rien accumuler.
 *
 * En dessous, la charge redescend. C'est ce seuil qui crée l'écart entre les
 * routines : les intensités mesurées vont de 9,2 (prudent) à 15,3 (grinder),
 * un rapport de 1,7 seulement, alors que les états visés vont de « frais » à
 * « épuisé ». Retrancher un socle amplifie l'écart là où il compte.
 */
const SUSTAINABLE = 3;

/** Conversion intensité excédentaire → charge. */
const ACCUMULATION = 1;

/**
 * Décroissance **proportionnelle** à la charge, et sur-linéaire.
 *
 * La version précédente ralentissait la récupération quand la charge montait,
 * ce qui produit une boucle positive : tout le monde convergeait vers le
 * plafond — mesuré, 86 à 97 de charge pour les quatre politiques, soit
 * exactement la saturation dégénérée que ce modèle devait supprimer. Une
 * décroissance proportionnelle garantit un équilibre borné et croissant avec
 * l'intensité, sans jamais épingler la valeur.
 */
const DECAY = 0.06;

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
  const matches = add('matches', 'compétitions', (ctx.matchLoad ?? 0) * 1.5);

  // 3. Pression du contexte : niveau de la structure, statut de titulaire,
  //    attentes, résultats récents. Modérée volontairement — elle doit nuancer
  //    la charge selon la situation, pas dominer le volume choisi.
  const pressure = add('pressure', 'pression du contexte', (ctx.pressure ?? 0) * 0.6);

  // 4. Sensibilité personnelle (traits).
  const sensitivity = 0.75 + (ctx.sensitivity ?? 1) * 0.35;
  add('sensitivity', `sensibilité ×${Math.round(sensitivity * 100) / 100}`, 0);

  // 5. Le repos ne se soustrait pas de l'intensité — il aide à la digérer.
  //    Un créneau de repos allège d'un tiers ce que la semaine laisse derrière
  //    elle, sans effacer le travail fourni.
  const restSlots = ctx.restSlots ?? 0;
  const digest = 1 + restSlots * 0.35;
  if (restSlots) add('rest', `${restSlots} créneau(x) de récupération (÷${Math.round(digest * 100) / 100})`, 0);

  const raw = (Math.max(0, volume + matches + pressure) * sensitivity) / digest;
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
  // Une série longue amplifie ce que coûte chaque semaine supplémentaire :
  // c'est l'inertie. Une grosse semaine laisse une trace, trois mois sans
  // respirer coûtent bien davantage que trois fois une semaine.
  const streakAmp = 1 + clamp(load.heavyStreak / 26, 0, 0.45);

  // Ce que la semaine ajoute, au-delà de ce qu'un professionnel absorbe.
  const excess = Math.max(0, raw - SUSTAINABLE) * ACCUMULATION * streakAmp;
  // Et ce que l'organisme évacue : proportionnel à la charge, et sur-linéaire,
  // donc l'équilibre est borné quelle que soit l'intensité.
  const resilience = 0.8 + (1 - (person.hidden?.burnoutFloor ?? 0.5)) * 0.45;
  const drain = DECAY * load.value * (1 + load.value / 100) * resilience;

  load.value = clamp(load.value + (excess - drain) * weeks, 0, 100);
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
      excess: Math.round(excess * 10) / 10,
      drain: Math.round(drain * 10) / 10,
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
 * Volume hebdomadaire de la routine par défaut — celle d'une session neuve,
 * `['mechanics', 'strategy', 'review', 'rest']`. Sert de référence à
 * `effortBonus` : un joueur qui ne touche pas à sa routine n'est ni récompensé
 * ni pénalisé, et l'écart mesuré vient bien de son choix.
 */
const REFERENCE_VOLUME = 6.9;

/**
 * Récompense immédiate du travail fourni cette semaine — **relative**.
 *
 * C'est le premier des deux termes qui remplacent le malus plat. Il ne dépend
 * que de l'effort de la semaine : travailler beaucoup paie **tout de suite**,
 * quel que soit l'état de charge.
 *
 * Deux erreurs de conception successives, toutes deux corrigées ici :
 *
 *  1. Une première version faisait dépendre la récompense de la charge
 *     elle-même — une cloche culminant à charge moyenne. Il fallait donc être
 *     déjà usé pour progresser vite, et mesuré, aucune politique n'atteignait
 *     la moitié montante de la courbe. La récompense doit venir de ce qu'on
 *     fait, le coût de ce qu'on accumule.
 *
 *  2. La deuxième version, `1 + volume/11 × 0,46`, ne descendait jamais sous 1.
 *     Comparé au code d'étape 6, l'effet réel n'était pas un arbitrage mais une
 *     prime générale : le malus qu'elle remplaçait (`1 - max(0, fatigue-55)/75`)
 *     valait exactement 1 pour six politiques d'audit sur neuf et ne mordait que
 *     sur le grinder et le saboteur, tandis que la prime valait en moyenne
 *     ×1,298 pour tout le monde. Retirer un malus payé par deux et distribuer un
 *     bonus à neuf gonflait le pic médian de 54,3 à 64,7 (+19 %) et faisait
 *     gagner la routine prudente à tous les horizons — l'inverse de l'arbitrage
 *     recherché.
 *
 * D'où la forme actuelle : centrée sur `REFERENCE_VOLUME`, donc en dessous de 1
 * pour une routine légère et au-dessus pour une routine lourde. Moyennée sur les
 * neuf politiques d'audit, elle vaut ×1,01 — elle redistribue au lieu d'ajouter.
 */
export function effortBonus(volume = REFERENCE_VOLUME) {
  return clamp(1 + (volume - REFERENCE_VOLUME) * 0.05, 0.86, 1.26);
}

/**
 * Coût différé de la charge accumulée — le second terme.
 *
 * Rien en dessous de « sous pression » : accumuler un peu ne coûte pas. Au-delà,
 * la note tombe, et elle tombe d'autant plus que l'état est haut. C'est ici que
 * se paie ce que `effortBonus` a avancé.
 */
export function loadProgressionFactor(person) {
  const load = person.load;
  if (!load) return 1;
  if (load.state === LOAD_STATES.BURNOUT) return 0.35;
  if (load.state === LOAD_STATES.RECOVERING) return 0.82;
  // La note ne tombe qu'à partir de « surmené ». En dessous, accumuler ne coûte
  // rien : c'est ce qui laisse au grind le temps de rapporter avant de payer.
  //
  // Un seuil à 46 faisait payer dès « sous pression », donc dès les premières
  // saisons : mesuré, le grinder était derrière la routine prudente aux années
  // 2, 3 et 5, et son pic moyen tombait de 61,3 à 54,9. Plus de risque pour
  // moins de récompense — l'inverse de l'arbitrage recherché.
  //
  // La pente est **convexe**, et non linéaire, pour une raison mesurée. Avec une
  // pente linéaire, la charge du grinder s'équilibrait vers 70 dès la première
  // saison — soit un facteur de 0,82 en permanence. Relevé semaine par semaine :
  //
  //     grinder  : facteur moyen 0,726 | 74 % des semaines sous 0,99 | 32 % sous 0,60
  //     prudent  : facteur moyen 1,000 |  0 % des semaines sous 0,99
  //
  // Le produit effort × charge valait alors 0,761 pour le grinder contre 0,920
  // pour le prudent : le grind coûtait plus qu'il ne rapportait **à tous les
  // horizons**, faute de phase où il rapporte encore. Le coût marginal de la
  // surcharge doit s'accélérer, pas frapper d'emblée à pleine force : être
  // simplement fatigué coûte peu, être détruit coûte cher.
  const v = load.value;
  if (v <= 58) return 1;
  return clamp(1 - ((v - 58) / 42) ** 1.6 * 0.62, 0.38, 1);
}

/**
 * Ce que la charge impose au moral.
 *
 * La fatigue et le stress, eux, ne passent plus par un terme de couplage : ils
 * **dérivent** de la charge (voir `applyConditionEffects`). Un terme additif
 * ajouté à des dynamiques par ailleurs indépendantes ne suffisait pas — chaque
 * variable convergeait vers son propre point fixe, et « épuisé mais serein »
 * restait atteignable.
 *
 * Le moral garde une dynamique propre parce qu'il dépend aussi des résultats,
 * des relations et des événements : la charge l'érode, elle ne le détermine pas.
 */
export function loadCoupling(person) {
  const load = person.load;
  if (!load) return { morale: 0 };
  const p = clamp((load.value - 32) / 68, 0, 1);
  const chronic = clamp(load.weeksInState / 30, 0, 1) * (isHigh(load.state) ? 1 : 0);
  return { morale: -(p * 2.1 + chronic * 1.5) };
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
