/**
 * Caractéristiques des personnages (§5, §6, §7).
 *
 * Il n'existe volontairement PAS de « note globale » stockée. Un joueur est
 * un profil : 34 attributs répartis en 6 familles. Toute note affichée est
 * une projection contextuelle (voir ratingForGame) — deux joueurs à 85
 * peuvent être des personnages totalement différents.
 */

import { clamp, norm } from './rng.js';

export const ATTRIBUTE_GROUPS = [
  {
    id: 'mechanical',
    label: 'Mécanique',
    short: 'MEC',
    attrs: [
      { id: 'precision', label: 'Précision' },
      { id: 'reflexes', label: 'Réflexes' },
      { id: 'execution', label: "Vitesse d'exécution" },
      { id: 'coordination', label: 'Coordination' },
      { id: 'consistency', label: 'Régularité' },
      { id: 'technique', label: 'Maîtrise technique' },
    ],
  },
  {
    id: 'gameSense',
    label: 'Intelligence de jeu',
    short: 'IQ',
    attrs: [
      { id: 'reading', label: 'Lecture du jeu' },
      { id: 'anticipation', label: 'Anticipation' },
      { id: 'adaptation', label: 'Adaptation' },
      { id: 'decision', label: 'Prise de décision' },
      { id: 'metaSense', label: 'Compréhension de la méta' },
      { id: 'creativity', label: 'Créativité' },
      { id: 'riskControl', label: 'Gestion du risque' },
    ],
  },
  {
    id: 'social',
    label: 'Social',
    short: 'SOC',
    attrs: [
      { id: 'communication', label: 'Communication' },
      { id: 'leadership', label: 'Leadership' },
      { id: 'teamwork', label: "Travail d'équipe" },
      { id: 'conflict', label: 'Gestion des conflits' },
      { id: 'trustBuilding', label: 'Confiance accordée' },
      { id: 'motivation', label: 'Capacité à motiver' },
    ],
  },
  {
    id: 'mental',
    label: 'Mental',
    short: 'MEN',
    attrs: [
      { id: 'composure', label: 'Sang-froid' },
      { id: 'pressure', label: 'Gestion de la pression' },
      { id: 'resilience', label: 'Résilience' },
      { id: 'selfConfidence', label: 'Confiance en soi' },
      { id: 'focus', label: 'Concentration' },
      { id: 'clutch', label: 'Régularité sous pression' },
    ],
  },
  {
    id: 'professional',
    label: 'Professionnalisme',
    short: 'PRO',
    attrs: [
      { id: 'discipline', label: 'Discipline' },
      { id: 'punctuality', label: 'Ponctualité' },
      { id: 'workCapacity', label: "Capacité d'entraînement" },
      { id: 'timeManagement', label: 'Gestion du temps' },
      { id: 'professionalism', label: 'Professionnalisme' },
      { id: 'learning', label: 'Capacité à apprendre' },
    ],
  },
  {
    id: 'media',
    label: 'Médiatique',
    short: 'MED',
    attrs: [
      { id: 'charisma', label: 'Charisme' },
      { id: 'camera', label: 'Présence caméra' },
      { id: 'storytelling', label: 'Sens du récit' },
      { id: 'community', label: 'Lien communautaire' },
      { id: 'imageControl', label: 'Maîtrise de son image' },
      { id: 'entertainment', label: 'Divertissement' },
    ],
  },
];

export const GROUP_IDS = ATTRIBUTE_GROUPS.map((g) => g.id);

export const ALL_ATTRS = ATTRIBUTE_GROUPS.flatMap((g) =>
  g.attrs.map((a) => ({ ...a, group: g.id })),
);

const ATTR_INDEX = new Map(ALL_ATTRS.map((a) => [a.id, a]));

export function attrMeta(id) {
  return ATTR_INDEX.get(id);
}

export function groupMeta(id) {
  return ATTRIBUTE_GROUPS.find((g) => g.id === id);
}

export function attrsOfGroup(groupId) {
  return groupMeta(groupId).attrs.map((a) => a.id);
}

/** Moyenne des attributs d'une famille. */
export function groupAverage(attrs, groupId) {
  const ids = attrsOfGroup(groupId);
  let sum = 0;
  for (const id of ids) sum += attrs[id] ?? 0;
  return sum / ids.length;
}

export function groupAverages(attrs) {
  const out = {};
  for (const g of GROUP_IDS) out[g] = groupAverage(attrs, g);
  return out;
}

/**
 * Génère un jeu d'attributs cohérent.
 *
 * Le tirage n'est pas 34 nombres indépendants : on tire d'abord un niveau
 * par famille, puis on disperse les attributs autour. Sans cela, tous les
 * personnages convergeraient vers le même profil moyen et le §6 serait mort.
 */
export function createAttributes(rng, { base = 40, spread = 10, groupBias = {} } = {}) {
  const attrs = {};
  for (const g of ATTRIBUTE_GROUPS) {
    const groupLevel = rng.gaussClamped(base + (groupBias[g.id] ?? 0), spread, 1, 99);
    for (const a of g.attrs) {
      attrs[a.id] = Math.round(rng.gaussClamped(groupLevel, spread * 0.55, 1, 99));
    }
  }
  return attrs;
}

/**
 * Plafonds cachés, par famille (§7). Un joueur peut avoir un plafond
 * mécanique de 96 et un plafond social de 55 : c'est ce qui produit des
 * trajectoires très différentes à profil de départ comparable.
 */
export function createCeilings(rng, attrs, { potentialBias = 0 } = {}) {
  const ceilings = {};
  // Le talent brut est tiré UNE fois pour le personnage, puis décliné par
  // famille. Sans ce facteur commun, on obtiendrait des profils absurdes
  // (plafond mécanique 40 et plafond stratégique 89 chez le même joueur) et
  // la plupart des carrières seraient condamnées par un seul mauvais tirage.
  const globalTalent = rng.gaussClamped(23 + potentialBias, 11, -6, 52);
  for (const g of GROUP_IDS) {
    const current = groupAverage(attrs, g);
    const headroom = clamp(globalTalent + rng.gauss(0, 8.5), -8, 62);
    ceilings[g] = clamp(Math.round(current + headroom), 25, 99);
  }
  return ceilings;
}

/** Moyenne des plafonds — la « valeur brute » d'un talent, jamais affichée. */
export function potentialScore(ceilings, weights = null) {
  if (!weights) {
    let s = 0;
    for (const g of GROUP_IDS) s += ceilings[g];
    return s / GROUP_IDS.length;
  }
  let s = 0;
  let w = 0;
  for (const g of GROUP_IDS) {
    s += ceilings[g] * (weights[g] ?? 0);
    w += weights[g] ?? 0;
  }
  return w > 0 ? s / w : 0;
}

/**
 * Note contextuelle d'un joueur POUR UN JEU donné.
 *
 * C'est le cœur du §10 : les attributs sont transférables, la familiarité
 * ne l'est pas. Un ace de FPS qui bascule sur un MOBA garde ses réflexes
 * mais repart avec une familiarité proche de zéro.
 */
export function ratingForGame(attrs, game, { familiarity = 1, roleId = null } = {}) {
  const gAvg = groupAverages(attrs);
  let raw = 0;
  let totalW = 0;
  for (const g of GROUP_IDS) {
    const w = game.weights[g] ?? 0;
    raw += gAvg[g] * w;
    totalW += w;
  }
  raw = totalW > 0 ? raw / totalW : 0;

  // Attributs clés : un jeu récompense spécifiquement certaines qualités.
  if (game.keyAttrs?.length) {
    let keySum = 0;
    for (const id of game.keyAttrs) keySum += attrs[id] ?? 0;
    const keyAvg = keySum / game.keyAttrs.length;
    raw = raw * 0.78 + keyAvg * 0.22;
  }

  // Bonus de rôle : jouer à son poste vaut quelques points.
  if (roleId && game.roles) {
    const role = game.roles.find((r) => r.id === roleId);
    if (role?.attrs?.length) {
      let s = 0;
      for (const id of role.attrs) s += attrs[id] ?? 0;
      raw = raw * 0.9 + (s / role.attrs.length) * 0.1;
    }
  }

  // La familiarité pénalise fortement en dessous de 0.5 puis s'estompe.
  const famFactor = 0.45 + 0.55 * Math.sqrt(Math.max(0, Math.min(1, familiarity)));
  return clamp(raw * famFactor, 1, 99);
}

/** Conversion valeur -> étoiles (affichage d'une estimation, §7). */
export function toStars(value, max = 99) {
  const t = norm(value, 0, max);
  return clamp(Math.round(t * 10) / 2, 0.5, 5);
}

export function starString(stars) {
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}
