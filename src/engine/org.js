/**
 * Organisations (§13).
 *
 * Une organisation vit indépendamment du joueur : elle gagne et perd de
 * l'argent, monte ou descend de tier, ouvre ou ferme des sections, et peut
 * disparaître. Les équipes (rosters) appartiennent à une organisation ET à
 * un jeu — une org peut être une puissance sur AETHERIS et une blague sur
 * VANGUARD.
 */

import { clamp } from './rng.js';
import { ORG_TIERS_BY_TIER, PHILOSOPHIES, SPONSOR_TYPES } from '../data/orgs.js';
import { generateOrgName, orgTag } from './names.js';

let orgCounter = 0;
let teamCounter = 0;

export function resetOrgCounters() {
  orgCounter = 0;
  teamCounter = 0;
}

export function createOrg(rng, { regionId, tier, takenNames, takenTags, absWeek = 0 }) {
  const tierDef = ORG_TIERS_BY_TIER[tier];
  const name = generateOrgName(rng, takenNames);
  const philosophy = rng.pick(PHILOSOPHIES).id;
  const sponsorCount = tier <= 1 ? rng.int(0, 1) : rng.int(1, Math.min(4, tier));
  const sponsors = rng.sample(SPONSOR_TYPES, sponsorCount).map((s) => ({
    typeId: s.id,
    label: s.label,
    since: absWeek,
    value: Math.round(tierDef.budget[1] * 0.12 * s.value * rng.float(0.7, 1.3)),
  }));

  return {
    id: `o${++orgCounter}`,
    name,
    tag: orgTag(name, takenTags),
    regionId,
    tier,
    philosophy,
    founded: absWeek,
    budget: Math.round(rng.float(tierDef.budget[0], tierDef.budget[1])),
    yearlyIncome: Math.round(rng.float(tierDef.budget[0], tierDef.budget[1]) * 0.9),
    reputation: Math.round(rng.float(tierDef.reputation[0], tierDef.reputation[1])),
    ambition: rng.gaussClamped(0.5 + tier * 0.08, 0.18, 0.05, 1),
    pressure: tierDef.pressure,
    fanbase: Math.round(Math.pow(tier, 3.1) * rng.float(900, 4200)),
    sponsors,
    teams: {}, // gameId -> teamId
    alive: true,
    disbandedWeek: null,
    history: [],
    titles: 0,
    minorTitles: 0,
  };
}

export function orgLabel(org) {
  return org ? `${org.name}` : 'Sans organisation';
}

export function createTeam(rng, { org, gameId, absWeek = 0, tierOverride = null }) {
  const team = {
    id: `t${++teamCounter}`,
    orgId: org.id,
    gameId,
    tier: tierOverride ?? org.tier,
    roster: [], // personIds titulaires
    subs: [],
    coachId: null,
    managerId: null,
    synergy: rng.float(30, 55),
    sharedWeeks: 0,
    created: absWeek,
    active: true,
    // Une équipe appartient au circuit d'entrée jusqu'à ce qu'une présaison la
    // place ailleurs : ce champ ne doit jamais être indéfini, un invariant de
    // hiérarchie le vérifie.
    division: 'amateur',
    // Résultats de la saison en cours ; archivés à chaque fin de saison.
    season: emptySeasonRecord(),
    history: [],
    titles: 0,
    minorTitles: 0,
    rivalries: {},
  };
  org.teams[gameId] = team.id;
  return team;
}

export function emptySeasonRecord() {
  return {
    wins: 0,
    losses: 0,
    points: 0,
    played: 0,
    mapWins: 0,
    mapLosses: 0,
    // Force cumulée des adversaires rencontrés : c'est elle qui distingue
    // « domine son niveau » de « peut tenir au niveau supérieur » (étape 3).
    oppStrengthSum: 0,
    placements: [],
  };
}

/** Salaire annuel de référence pour un poste dans cette organisation. */
export function salaryBand(org, game) {
  // Les salaires se paient sur les **revenus**, pas sur la trésorerie.
  //
  // La version précédente lisait `org.budget` — un accumulateur. Mesuré à
  // l'année 10 : une structure de tier 2 descendue avec 1,64 M en caisse pour
  // 455 k de revenus payait 882 k de salaires, soit près du double de ce
  // qu'elle gagnait, et le faisait pendant toute la durée des contrats. Les
  // niveaux intermédiaires étaient structurellement déficitaires.
  //
  // La trésorerie garde un rôle : elle ouvre une marge de manœuvre — une
  // organisation riche peut surpayer un temps — mais plafonnée, et
  // proportionnelle à son excédent réel. C'est un avantage, pas une capacité
  // permanente.
  const flow = Math.max(org.yearlyIncome / 0.9, 0);
  const surplus = Math.max(0, org.budget - org.yearlyIncome);
  const capacity = flow + Math.min(flow * 0.5, surplus * 0.2);
  // Plancher volontaire : une structure sans budget recrute quand même —
  // gratuitement. Sans ce plancher, `salaryBand` renvoyait 0 et rendait tout
  // recrutement amateur mathématiquement impossible.
  const base = Math.max(capacity * 0.16, 2600) * (game?.prizeScale ?? 1);
  return {
    min: Math.round(base * 0.35),
    typical: Math.round(base * 0.6),
    max: Math.round(base * 1.1),
  };
}

/**
 * Santé financière. Une org qui perd de l'argent plusieurs saisons finit
 * par fermer une section, descendre de tier, ou disparaître (§3).
 */
export function orgFinancialHealth(org) {
  return clamp(org.budget / Math.max(1, org.yearlyIncome * 0.35), 0, 3);
}

export function addSponsor(org, sponsorType, absWeek, rng) {
  const tierDef = ORG_TIERS_BY_TIER[org.tier];
  const sponsor = {
    typeId: sponsorType.id,
    label: sponsorType.label,
    since: absWeek,
    value: Math.round(tierDef.budget[1] * 0.12 * sponsorType.value * rng.float(0.7, 1.3)),
  };
  org.sponsors.push(sponsor);
  org.yearlyIncome += sponsor.value;
  return sponsor;
}

export function removeSponsor(org, index) {
  const [gone] = org.sponsors.splice(index, 1);
  if (gone) org.yearlyIncome = Math.max(0, org.yearlyIncome - gone.value);
  return gone;
}
