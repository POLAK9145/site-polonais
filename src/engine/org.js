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
  return { wins: 0, losses: 0, points: 0, played: 0, mapWins: 0, mapLosses: 0, placements: [] };
}

/** Salaire annuel de référence pour un poste dans cette organisation. */
export function salaryBand(org, game) {
  // Plancher volontaire : une structure sans budget recrute quand même —
  // gratuitement. Sans ce plancher, `salaryBand` renvoyait 0 et rendait tout
  // recrutement amateur mathématiquement impossible.
  const base = Math.max(org.budget * 0.16, 2600) * (game?.prizeScale ?? 1);
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
