/**
 * Modèle de personnage.
 *
 * Le joueur et les 600 autres personnes du monde utilisent EXACTEMENT la
 * même structure. C'est la condition du §3 : si les PNJ avaient un modèle
 * simplifié, ils ne pourraient pas avoir de vraie carrière, et le monde
 * cesserait d'exister dès qu'on ne le regarde plus.
 */

import { clamp, norm } from './rng.js';
import {
  createAttributes,
  createCeilings,
  groupAverages,
  ratingForGame,
  GROUP_IDS,
  toStars,
} from './attributes.js';
import { TRAITS, traitsCompatible, traitMods } from '../data/traits.js';
import { generatePersonName, generateNickname } from './names.js';
import { REGIONS_BY_ID } from '../data/regions.js';
import { ageAt, WEEKS_PER_YEAR } from './time.js';
import { createLoadState } from './load.js';

export const STATUS = {
  AMATEUR: 'amateur',
  SEMIPRO: 'semipro',
  PRO: 'pro',
  INACTIVE: 'inactive',
  RETIRED: 'retired',
  STAFF: 'staff',
};

export const STATUS_LABELS = {
  amateur: 'Amateur',
  semipro: 'Semi-pro',
  pro: 'Professionnel',
  inactive: 'Sans équipe',
  retired: 'Retraité',
  staff: 'Staff',
};

/** Étapes de carrière (§11). Indicatives : rien n'oblige à les suivre. */
export const CAREER_PHASES = [
  { id: 'discovery', label: 'Découverte', min: 0 },
  { id: 'passion', label: 'Passion', min: 1 },
  { id: 'amateur', label: 'Compétition amateur', min: 2 },
  { id: 'results', label: 'Premiers résultats', min: 3 },
  { id: 'amateur_team', label: 'Équipe amateur', min: 4 },
  { id: 'semipro', label: 'Semi-pro', min: 5 },
  { id: 'pro', label: 'Professionnel', min: 6 },
  { id: 'elite', label: 'Haut niveau', min: 7 },
  { id: 'superstar', label: 'Superstar', min: 8 },
  { id: 'legend', label: 'Légende', min: 9 },
];

let personCounter = 0;
export function resetPersonCounter() {
  personCounter = 0;
}

/**
 * La marge de progression qu'il reste à un âge donné (étape 9O).
 *
 * Le monde la calcule à partir de l'âge : à 18 ans il reste beaucoup à
 * prendre, à 28 presque plus. Le terme de tier dit qu'un joueur déjà installé
 * haut a plus de marge qu'un joueur de circuit amateur du même âge.
 *
 * Cette fonction existe pour qu'il n'y ait qu'UNE formule. Le joueur avait la
 * sienne, plus sévère, sans raison documentée : `clamp(23 - âge, 0, 8)`, soit 5
 * à 18 ans là où le monde donne 11,8, et 0 dès 23 ans. Le plafond d'un
 * personnage valant son niveau actuel plus cette marge, le joueur était
 * doublement pénalisé — ancrage plus bas ET marge plus courte.
 *
 * Mesuré à la création sur 30 mondes, avant que rien n'ait été joué :
 * potentiel médian 76,8 pour le joueur contre 88,4 pour les PNJ de moins de
 * 20 ans, et aucun joueur sur trente ne pouvait naître dans le dernier décile
 * de sa propre génération.
 */
export function remainingPotential(age, tier = 3) {
  return clamp(28 - age * 0.9 + (tier - 3) * 2, -8, 16);
}

export function createPerson(rng, opts = {}) {
  const {
    regionId = 'weu',
    age = 18,
    baseLevel = 45,
    spread = 9,
    attrBias = {},
    potentialBias = 0,
    isPlayer = false,
    absWeek: nowWeek = 0,
    takenNicks = new Set(),
    traitCount = 3,
    forcedTraits = [],
    identity = null,
    gameId = null,
    familiarity = 0,
  } = opts;

  const name = identity ?? generatePersonName(rng, regionId);
  const attrs = createAttributes(rng, {
    base: baseLevel,
    spread,
    groupBias: attrBias,
  });
  const ceilings = createCeilings(rng, attrs, { potentialBias });

  const traits = pickTraits(rng, traitCount, forcedTraits);

  const birthWeek = Math.round(nowWeek - age * WEEKS_PER_YEAR);

  const person = {
    id: `p${++personCounter}`,
    firstName: name.firstName,
    lastName: name.lastName,
    nick: identity?.nick ?? generateNickname(rng, takenNicks),
    country: name.country ?? REGIONS_BY_ID[regionId].countries[0],
    regionId,
    birthWeek,
    isPlayer,

    attrs,
    hidden: {
      ceilings,
      // Vitesse d'apprentissage brute. Deux joueurs identiques à 17 ans
      // n'ont pas la même carrière à 22 à cause de ce seul nombre.
      growth: rng.gaussClamped(1, 0.24, 0.45, 1.75),
      // Capacité à encaisser un changement de jeu ou de méta (§10, §24).
      adaptability: rng.gaussClamped(0.55, 0.2, 0.05, 1),
      // Vieillissement : certains tiennent jusqu'à 32 ans, d'autres non (§70).
      longevity: rng.gaussClamped(0.5, 0.22, 0.05, 1),
      mediaPotential: rng.gaussClamped(0.45, 0.25, 0.02, 1),
      leadershipPotential: rng.gaussClamped(0.45, 0.25, 0.02, 1),
      // Écart entre le mental affiché et le mental réel en finale.
      pressureCore: rng.gaussClamped(0, 8, -20, 20),
      burnoutFloor: rng.gaussClamped(0.5, 0.2, 0.05, 1),
    },
    traits,

    gameId,
    roleId: null,
    familiarity: gameId ? { [gameId]: familiarity } : {},

    form: rng.gaussClamped(0, 6, -18, 18),
    morale: rng.gaussClamped(62, 12, 20, 95),
    fatigue: rng.gaussClamped(15, 8, 0, 45),
    stress: rng.gaussClamped(20, 10, 0, 55),

    status: STATUS.AMATEUR,
    phase: 'discovery',
    teamId: null,
    contract: null,
    orgId: null,

    reputation: {
      pros: 5,
      public: 2,
      community: 5,
      media: 2,
      toxicity: 0,
    },
    followers: 0,

    // Charge accumulée (étape 7B). Distincte de la fatigue instantanée : c'est
    // elle qui garde la mémoire des semaines chargées et porte les sept états.
    load: createLoadState(),

    // Historique agrégé. Alimenté par le moteur, jamais réécrit.
    stats: {
      matches: 0,
      wins: 0,
      losses: 0,
      mvps: 0,
      titles: 0,
      // Victoires du circuit d'entrée : réelles, mais pas un palmarès.
      minorTitles: 0,
      finals: 0,
      minorFinals: 0,
      // Statut le plus élevé jamais atteint : il ne recule jamais, même quand
      // l'organisation descend (étape 3, §9).
      highestStatus: null,
      earnings: 0,
      seasonsPro: 0,
      peakRating: 0,
      peakWeek: null,
      peakFollowers: 0,
      internationalTitles: 0,
    },

    teamHistory: [],
    retiredWeek: null,
    retirementReason: null,
    generation: 0,
    // Trace d'observation : plus un joueur est vu, plus l'estimation de son
    // potentiel est fiable (§7).
    observations: 0,
  };

  return person;
}

function pickTraits(rng, count, forced = []) {
  const traits = [...forced];
  const pool = TRAITS.map((t) => t.id).filter((id) => !traits.includes(id));
  let guard = 0;
  while (traits.length < count && guard++ < 200) {
    const candidate = rng.pick(pool);
    if (!candidate) break;
    if (traits.every((t) => traitsCompatible(t, candidate))) {
      traits.push(candidate);
    }
    pool.splice(pool.indexOf(candidate), 1);
  }
  return traits;
}

export function fullName(p) {
  return `${p.firstName} "${p.nick}" ${p.lastName}`;
}

export function displayName(p) {
  return p.nick;
}

export function age(p, absWeek) {
  return ageAt(p.birthWeek, absWeek);
}

export function ageInt(p, absWeek) {
  return Math.floor(age(p, absWeek));
}

export function getFamiliarity(p, gameId) {
  return p.familiarity[gameId] ?? 0;
}

export function setFamiliarity(p, gameId, v) {
  p.familiarity[gameId] = clamp(v, 0, 1);
}

/**
 * Note de performance attendue, tout compris.
 *
 * C'est la valeur utilisée par le simulateur de match : elle intègre le
 * profil, la familiarité, la forme, la fatigue et le moral. Elle n'est
 * jamais stockée — elle se recalcule, donc elle bouge avec le contexte.
 */
/**
 * Le détail de la note du jour : d'où vient l'écart entre ce qu'on vaut et ce
 * qu'on vaut AUJOURD'HUI (étape 9H).
 *
 * Cette décomposition est la seule définition de la note effective —
 * `effectiveRating` l'appelle. Écrire la formule à deux endroits, c'est
 * garantir qu'un jour l'écran affichera un détail qui ne fait pas la somme
 * annoncée.
 *
 * Les trois termes portent leur signe : la forme peut aider comme nuire, la
 * fatigue ne fait que coûter, et le moral rapporte au-dessus de 60.
 */
export function ratingBreakdown(p, game) {
  const base = ratingForGame(p.attrs, game, {
    familiarity: getFamiliarity(p, game.id),
    roleId: p.roleId,
  });
  // `+ 0` normalise le zéro négatif : `-Math.max(0, 0) * 0.16` vaut `-0`, que
  // l'écran afficherait « -0 » et qu'une comparaison stricte distingue de 0.
  const forme = p.form + 0;
  const fatigue = -Math.max(0, p.fatigue - 45) * 0.16 + 0;
  const moral = -(60 - clamp(p.morale, 0, 100)) * 0.05 + 0;
  return { base, forme, fatigue, moral, effectif: clamp(base + forme + fatigue + moral, 1, 99) };
}

export function effectiveRating(p, game, { includeCondition = true } = {}) {
  const d = ratingBreakdown(p, game);
  return includeCondition ? d.effectif : d.base;
}

/** Note « propre », sans forme ni fatigue : sert au scouting et aux classements. */
export function baseRating(p, game) {
  return ratingForGame(p.attrs, game, {
    familiarity: getFamiliarity(p, game.id),
    roleId: p.roleId,
  });
}

export function mods(p) {
  return traitMods(p.traits);
}

/**
 * Estimation visible du potentiel (§7) : jamais le chiffre réel.
 * Le bruit décroît avec le nombre d'observations (matchs joués, saisons).
 */
export function estimatedPotential(p, game, seedNoise = 0) {
  const ceil = game
    ? weightedCeiling(p, game)
    : GROUP_IDS.reduce((s, g) => s + p.hidden.ceilings[g], 0) / GROUP_IDS.length;
  const confidence = clamp01Local(p.observations / 40);
  const noiseAmplitude = (1 - confidence) * 14;
  const noise = ((seedNoise % 200) / 100 - 1) * noiseAmplitude;
  return {
    stars: toStars(clamp(ceil + noise, 1, 99)),
    confidence,
  };
}

function clamp01Local(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function weightedCeiling(p, game) {
  let s = 0;
  let w = 0;
  for (const g of GROUP_IDS) {
    const weight = game.weights[g] ?? 0;
    s += p.hidden.ceilings[g] * weight;
    w += weight;
  }
  return w > 0 ? s / w : 0;
}

/** Profil résumé pour l'affichage : moyennes par famille. */
export function profile(p) {
  return groupAverages(p.attrs);
}

/** Le joueur est-il disponible pour jouer / signer ? Utilisé par le validateur. */
export function isActive(p) {
  return p.status !== STATUS.RETIRED && p.status !== STATUS.STAFF;
}

export function isCompetitive(p) {
  return p.status === STATUS.PRO || p.status === STATUS.SEMIPRO || p.status === STATUS.AMATEUR;
}

/** Réputation globale pondérée : sert aux offres et à la notoriété. */
export function overallReputation(p) {
  const r = p.reputation;
  return clamp(r.pros * 0.45 + r.public * 0.3 + r.community * 0.15 + r.media * 0.1 - r.toxicity * 0.25, 0, 100);
}

export function marketValue(p, game, absWeek) {
  if (!game) return 0;
  const rating = baseRating(p, game);
  const a = age(p, absWeek);
  // Le marché paie le niveau, mais surtout la projection : un joueur de 18
  // ans à 78 vaut plus qu'un joueur de 29 ans à 80.
  const youth = clamp(norm(28 - a, 0, 12), 0, 1);
  const rep = overallReputation(p) / 100;
  const potential = weightedCeiling(p, game);
  const projection = clamp(potential - rating, 0, 30) / 30;
  const base = Math.pow(clamp(rating - 40, 1, 60) / 60, 2.2) * 260000;
  return Math.round(
    base * game.prizeScale * (0.55 + youth * 0.35 + rep * 0.35 + projection * 0.3),
  );
}
