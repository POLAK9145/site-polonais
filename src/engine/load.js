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
 * En dessous, la charge redescend. C'est ce socle qui amplifie l'écart entre les
 * routines : les volumes hebdomadaires vont de 4,9 à 10,1 selon la politique
 * d'audit, un rapport de 2,1 seulement, alors que les états visés vont de
 * « frais » à « épuisé ». Retrancher un socle creuse cet écart là où il compte —
 * ce qui reste après soustraction va, pour ces deux volumes, de 1,9 à 7,1, soit
 * un rapport de 3,7. (L'intensité réelle ajoute encore la densité de compétition
 * et la pression du contexte, et divise par les créneaux de repos.)
 *
 * Une version précédente de ce commentaire annonçait des intensités mesurées de
 * 9,2 à 15,3. Ces chiffres sont incompatibles avec les charges effectivement
 * relevées — la routine prudente s'équilibre vers 20, ce qui correspond à une
 * intensité de l'ordre de 4 — et je n'ai pas pu les reproduire. Ils sont retirés
 * plutôt que remplacés par une autre estimation non vérifiée : la table
 * d'équilibre sur `DECAY` est, elle, relevée dans le moteur.
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
 * décroissance proportionnelle donne un équilibre croissant avec l'intensité.
 *
 * Le terme quadratique et la disparition de l'amplification de série (voir
 * `updateLoad`) corrigent une bistabilité mesurée. Table d'équilibre relevée en
 * faisant tourner `updateLoad` jusqu'à stabilisation, à intensité imposée :
 *
 *     intensité   avant     après
 *          8       53,1      48,0
 *        8,5       57,0      50,6
 *          9       79,0      53,0     ← le saut de 22 points a disparu
 *         10       87,9      57,3
 *         12      100,0      64,8     ← plus aucun équilibre avant
 *         16      100,0      76,6
 *         20      100,0      85,9
 *
 * Avant, deux régimes seulement : « je tiens sans rien payer » sous le seuil de
 * pénalité de 58, ou « je finis régulièrement à 100 ». Le grinder oscillait
 * entre les deux — p50 50,8, p75 96, 23 % de ses semaines au plafond. Après,
 * l'équilibre progresse de deux à cinq points par point d'intensité sur toute la
 * plage utile, et les trois régimes attendus apparaissent : récupération nette
 * en dessous de 4, charge élevée mais stable de 10 à 16 avec un coût progressif,
 * et franchement les états de surcharge au-delà de 18.
 */
const DECAY = 0.06;

/** Capacité d'évacuation propre au joueur. */
function resilienceOf(person) {
  return 0.8 + (1 - (person.hidden?.burnoutFloor ?? 0.5)) * 0.45;
}

/**
 * Ce que l'organisme évacue à une charge donnée.
 *
 * Extrait de `updateLoad` pour que l'inversion ci-dessous porte sur la MÊME
 * formule que la simulation. Réécrire cette expression ailleurs reviendrait à
 * prédire au joueur une trajectoire que le moteur ne suit pas.
 */
function drainAt(value, resilience) {
  return DECAY * value * (1 + (value / 100) ** 2 * 3) * resilience;
}

/**
 * Où cette intensité, tenue indéfiniment, finit par stabiliser la charge.
 *
 * C'est l'inverse de la loi d'accumulation : on cherche la charge v telle que
 * ce que la semaine ajoute égale ce que l'organisme évacue,
 *
 *     (intensité − SUSTAINABLE) × ACCUMULATION  =  drainAt(v, résilience)
 *
 * L'évacuation étant strictement croissante en v, la solution est unique et se
 * trouve par dichotomie. On ne devine pas, on n'approxime pas une courbe :
 * on résout l'équation du moteur.
 *
 * C'est la seule information de charge réellement actionnable pour le joueur.
 * Un chiffre du jour ne dit pas si la routine choisie est tenable ; celui-ci
 * répond exactement à la question « et si je continue comme ça ? ».
 */
export function equilibriumLoad(person, intensity) {
  const excess = Math.max(0, intensity - SUSTAINABLE) * ACCUMULATION;
  if (excess <= 0) return 0;
  const resilience = resilienceOf(person);
  // La charge est bornée à 100 : au-delà de ce que l'évacuation peut compenser,
  // il n'y a pas d'équilibre et la réponse honnête est « ça ne tient pas ».
  if (excess >= drainAt(100, resilience)) return 100;
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (drainAt(mid, resilience) < excess) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

/** L'état correspondant à une charge donnée, en montée. */
export function stateAt(value) {
  let state = LOAD_STATES.FRESH;
  for (const step of LADDER) {
    if (value >= step.up) state = step.state;
  }
  return state;
}

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
    lastIntensity: 0,
    lastMatchLoad: 0,
    lastPressure: 0,
    lastVolume: 0,
    lastRestSlots: 0,
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
  // Intensité réellement appliquée cette semaine. C'est un FAIT, pas une
  // formule : l'interface le lit au lieu de le recalculer, et ne peut donc pas
  // afficher une charge que le moteur n'a pas subie (étape 8A).
  load.lastIntensity = Math.round(raw * 100) / 100;
  load.lastMatchLoad = ctx.matchLoad ?? 0;
  // La pression du contexte telle qu'elle a été appliquée. Enregistrée plutôt
  // que recalculée par l'interface : elle dépend des résultats de la saison et
  // de la réputation, qui bougent PENDANT la semaine. Recalculée après coup,
  // elle donnait une intensité différente de celle réellement subie une
  // semaine sur trente — un écart invisible, donc un mensonge tranquille.
  load.lastPressure = Math.round((ctx.pressure ?? 0) * 1000) / 1000;
  // Idem pour le volume et les créneaux de récupération : la routine effective
  // dépend de l'équipe, et l'équipe peut changer au cours de la semaine.
  // Reconstitués après coup, ils décrivaient parfois une autre semaine que
  // celle qui a réellement eu lieu.
  load.lastVolume = Math.round((ctx.rawFatigue ?? 0) * 100) / 100;
  load.lastRestSlots = ctx.restSlots ?? 0;

  // Semaines chargées consécutives. Cette mémoire ne pèse plus sur la charge
  // elle-même mais sur le **risque de rupture** (`crashRisk`), et le compteur
  // garde donc son sens de nombre de semaines.
  if (raw >= HEAVY_WEEK) {
    load.heavyStreak += weeks;
    load.longestStreak = Math.max(load.longestStreak, load.heavyStreak);
  } else {
    // On ne remet pas à zéro d'un coup : sortir d'une période chargée prend
    // du temps, sinon une semaine calme effacerait trois mois de surcharge.
    load.heavyStreak = Math.max(0, load.heavyStreak - weeks * 2);
  }

  // Ce que la semaine ajoute, au-delà de ce qu'un professionnel absorbe.
  //
  // L'excédent est **strictement croissant et continu en l'intensité**, et c'est
  // ce qui rend la charge d'équilibre continue elle aussi. Une version
  // antérieure le multipliait par une amplification de série,
  // `1 + clamp(heavyStreak/26, 0, 0.45)`, au nom de l'inertie. C'était un double
  // comptage — la charge étant une intégrale, la persistance d'une période
  // lourde y est déjà inscrite — et cela introduisait une discontinuité, parce
  // que la série ne croissait qu'au-delà du seuil `HEAVY_WEEK`. Une intensité de
  // 8,9 laissait l'amplification à 1 et l'équilibre à 54 ; une intensité de 9,1
  // la portait à 1,45 et l'équilibre à 80. Un point d'intensité déplaçait donc
  // l'équilibre de 26 points, et le régime « pousse fort mais tient » n'existait
  // pas. L'inertie de la série est conservée, mais là où elle décrit un fait
  // réel : une longue période sans respirer fait **craquer**, elle ne rend pas
  // mécaniquement chaque semaine plus lourde.
  const excess = Math.max(0, raw - SUSTAINABLE) * ACCUMULATION;

  // Et ce que l'organisme évacue. La décroissance est proportionnelle à la
  // charge et **franchement** sur-linéaire : c'est elle qui garantit un équilibre
  // pour toute intensité, y compris extrême. Avec le terme précédent,
  // `1 + v/100`, l'évacuation plafonnait à 12 par semaine ; tout excédent
  // au-delà — le grinder est à 10, hors charge de match et pression — n'avait
  // plus d'équilibre du tout et la charge montait jusqu'au plafond. Le terme
  // quadratique porte ce plafond à 24, hors de portée des intensités atteignables.
  const drain = drainAt(load.value, resilienceOf(person));

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
  // La pente reste **linéaire**. Une variante convexe (exposant 1,6) a été
  // essayée et mesurée, sur l'idée qu'être fatigué devait coûter peu et qu'être
  // détruit devait coûter cher. Elle adoucissait bien la note dans la bande
  // 60–85 — 0,916 au lieu de 0,823 à charge 70 — mais le résultat mesuré allait
  // dans l'autre sens :
  //
  //     grinder, pente linéaire : 32,8 % des semaines en rupture | série 122 | corrélation 0,896
  //     grinder, pente convexe  : 45,9 % des semaines en rupture | série 176 | corrélation 0,758
  //
  // La raison n'est pas dans ce facteur, mais dans la zone où il est évalué :
  // le grinder ne fait que la traverser. Distribution de sa charge, relevée
  // semaine par semaine sur trois carrières de seize ans :
  //
  //     p25 45,6 · p50 50,8 · p75 96,0 · p90 100 · 23 % des semaines à 100
  //
  // Sa médiane est **sous** le seuil de 58 — la moitié de ses semaines ne
  // coûtent donc rien — et près d'un quart sont au plafond, où elles coûtent le
  // maximum. Entre les deux, presque personne. Voir la note sur l'équilibre
  // accumulation / décroissance dans `updateLoad` : le seuil de 58 tombe dans le
  // vide qui sépare les deux régimes, d'où un coût tout ou rien qu'aucun réglage
  // de cette pente ne peut rendre progressif.
  const v = load.value;
  if (v <= 58) return 1;
  return clamp(1 - ((v - 58) / 42) * 0.62, 0.38, 1);
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
    lastIntensity: l.lastIntensity ?? 0,
    lastMatchLoad: l.lastMatchLoad ?? 0,
    lastPressure: l.lastPressure ?? 0,
    lastVolume: l.lastVolume ?? 0,
    lastRestSlots: l.lastRestSlots ?? 0,
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
  lines.push(`    intensité ${entry.intensity} → accumulation ${entry.excess} (${entry.heavyStreak} semaines chargées d’affilée)`);
  lines.push(`    récupération ${entry.drain}`);
  for (const f of entry.factors ?? []) lines.push(`    ${f.label} : ${f.delta}`);
  return lines.join('\n');
}
