/**
 * Hiérarchie perméable : montées et descentes (étape 3).
 *
 * PROBLÈME CORRIGÉ
 * ----------------
 * L'ancienne `applyPromotionRelegation` n'était pas une hiérarchie mais un
 * échange. Mesuré sur 30 ans :
 *
 *  - montée et descente étaient soudées dans un seul `if` : 79 montées pour
 *    exactement 79 descentes, aucune ne pouvant survenir seule ;
 *  - une seule paire était examinée par région et par saison — la pire de
 *    ligue contre la meilleure amateur — et 98 régions sur 412 ne pouvaient
 *    même pas en former une ;
 *  - la décision reposait sur `bestPower > worstPower * 0.97`, une comparaison
 *    de puissance *instantanée* : elle expliquait 315 des 320 refus, tandis que
 *    le seuil `pts > 20` n'en expliquait que 5 (points médians du meilleur
 *    amateur : 61). Rien ne regardait la saison ;
 *  - les conséquences étaient une formule fixe (`budget × 1,8 + 40 000`),
 *    identique pour toutes les organisations : aucune ne pouvait échouer à
 *    s'adapter ;
 *  - `person.status` n'était jamais revisité après un changement de tier :
 *    30 joueurs portaient un statut incohérent avec leur organisation.
 *
 * MODÈLE RETENU
 * -------------
 * Deux décisions **indépendantes**, prises à l'échelle de la scène, sur des
 * **composantes séparées et traçables** — pas un score unique opaque. Chaque
 * facteur porte son libellé et sa contribution, exactement comme les facteurs
 * d'intérêt du marché (§59) : on doit pouvoir répondre à « pourquoi cette
 * équipe est-elle montée ? ».
 *
 * Distinction essentielle (§3) : **dominer son niveau** n'est pas **pouvoir
 * survivre au niveau supérieur**. Un ratio de victoires écrasant contre des
 * adversaires faibles pèse donc moins qu'un ratio honorable contre des
 * adversaires du niveau visé — ce que mesure la force moyenne réellement
 * affrontée pendant la saison.
 *
 * La puissance instantanée reste une information secondaire : elle module le
 * risque d'échec après la montée, elle ne décide plus.
 */

import { clamp } from './rng.js';
import { GAMES_BY_ID } from '../data/games.js';
import { teamStrength } from './team.js';
import { STATUS } from './person.js';
import { LEAGUE_CAPABLE_TIER, canSustainLeague } from './amateur.js';
import { isTracing, trace, TRACE } from './trace.js';
import { WEEKS_PER_YEAR } from './time.js';

/** Tier le plus haut atteignable par une organisation. */
export const MAX_TIER = 5;

/** Coût annuel d'exploitation d'une équipe à un tier donné (hors salaires). */
export function tierOperatingCost(tier) {
  // Aligné sur `simulateOrgEconomy`, qui prélève 1200 × tier par mois.
  return 1200 * tier * 12;
}

/** Ordre des statuts, pour ne jamais faire reculer le maximum atteint. */
const STATUS_RANK = { [STATUS.AMATEUR]: 1, [STATUS.SEMIPRO]: 2, [STATUS.PRO]: 3 };

/** Statut correspondant au niveau actuel d'une organisation. */
export function statusForTier(tier) {
  if (tier >= 3) return STATUS.PRO;
  if (tier === LEAGUE_CAPABLE_TIER) return STATUS.SEMIPRO;
  return STATUS.AMATEUR;
}

/**
 * Bilan de saison d'une équipe. Grandeurs brutes, séparées, sans pondération —
 * la pondération appartient aux décisions, pas à la mesure.
 */
export function seasonAssessment(world, team) {
  const org = world.orgs[team.orgId];
  const game = GAMES_BY_ID[team.gameId];
  const s = team.season ?? {};
  const played = s.played ?? 0;
  const wins = s.wins ?? 0;
  const placements = s.placements ?? [];

  // Niveau réellement affronté : c'est lui qui distingue une domination de
  // circuit d'entrée d'une saison passée face à des équipes de ligue.
  const meanOpponent = played > 0 ? (s.oppStrengthSum ?? 0) / played : null;

  // Classement : on retient la meilleure place obtenue, rapportée au nombre
  // d'engagés — finir 3e sur 8 n'est pas finir 3e sur 4.
  let bestRankShare = null;
  let podiums = 0;
  let wonSomething = 0;
  let levelSum = 0;
  for (const p of placements) {
    const share = p.entrants > 1 ? (p.entrants - p.rank) / (p.entrants - 1) : 0;
    if (bestRankShare === null || share > bestRankShare) bestRankShare = share;
    if (p.rank <= 3) podiums++;
    if (p.rank === 1) wonSomething++;
    levelSum += p.tierLevel ?? 1;
  }
  const meanCompetitionLevel = placements.length > 0 ? levelSum / placements.length : null;

  const salaryLoad = rosterSalaryLoad(world, team);
  const rosterComplete = game ? team.roster.length >= game.teamSize : false;

  return {
    teamId: team.id,
    orgId: org?.id ?? null,
    tier: org?.tier ?? 1,
    played,
    wins,
    winRatio: played > 0 ? wins / played : null,
    points: s.points ?? 0,
    mapDiff: (s.mapWins ?? 0) - (s.mapLosses ?? 0),
    meanOpponent,
    meanCompetitionLevel,
    bestRankShare,
    podiums,
    titles: wonSomething,
    competitions: placements.length,
    rosterComplete,
    rosterSize: team.roster.length,
    budget: org?.budget ?? 0,
    yearlyIncome: org?.yearlyIncome ?? 0,
    salaryLoad,
    // Information secondaire, jamais décisive à elle seule.
    power: teamStrength(world, team, { forMatch: false }).strength,
  };
}

function rosterSalaryLoad(world, team) {
  let total = 0;
  for (const id of [...team.roster, ...team.subs]) {
    const p = world.persons[id];
    if (p?.contract?.salary) total += p.contract.salary;
  }
  return total;
}

/**
 * Référence de la scène : à quoi ressemble réellement une équipe de chaque
 * niveau, mesuré sur la scène et non fixé par une constante.
 *
 * C'est cette référence qui fournit la barre d'entrée d'un niveau. La force des
 * effectifs sépare nettement les tiers d'un monde neuf — 46 · 63 · 74 · 83 · 91
 * de moyenne du tier 1 au tier 5 — et cette séparation est une donnée du monde,
 * pas une règle qu'on lui impose.
 */
export function sceneReference(world, gameId) {
  const perTier = {};
  let leagueStrengthSum = 0;
  let leagueCount = 0;
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.gameId !== gameId || team.isSelfTeam) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive) continue;
    const tier = org.tier;
    const agg = (perTier[tier] ??= { teams: 0, pointsSum: 0, strengths: [] });
    agg.teams++;
    agg.pointsSum += team.season?.points ?? 0;
    const strength = teamStrength(world, team, { forMatch: false }).strength;
    agg.strengths.push(strength);
    if (canSustainLeague(org)) {
      leagueStrengthSum += strength;
      leagueCount++;
    }
  }
  const meanPoints = {};
  const meanStrength = {};
  const allStrengths = [];
  for (const [tier, agg] of Object.entries(perTier)) {
    meanPoints[tier] = agg.pointsSum / agg.teams;
    const sorted = agg.strengths.sort((a, b) => a - b);
    meanStrength[tier] = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    allStrengths.push(...sorted);
  }
  allStrengths.sort((a, b) => a - b);
  return {
    gameId,
    perTier,
    meanPoints,
    meanStrength,
    allStrengths,
    sceneTeams: allStrengths.length,
    leagueMeanStrength: leagueCount > 0 ? leagueStrengthSum / leagueCount : null,
    leagueTeams: leagueCount,
  };
}

/**
 * Forme de la pyramide : part des équipes d'une scène qui appartiennent à un
 * niveau donné ou au-dessus.
 *
 * C'est la seule chose que ce module postule, et il faut la justifier. Une
 * première version prenait pour barre d'entrée le premier quartile des membres
 * *actuels* du niveau visé — barre qui s'effondrait à mesure que le niveau se
 * remplissait, chaque nouvelle organisation faible abaissant l'exigence pour la
 * suivante : 77 organisations sur 125 atteignaient le tier 5 en vingt ans. La
 * référence doit donc être la distribution de la scène entière, qui ne peut pas
 * se dérober, et non la composition du palier.
 *
 * Les parts elles-mêmes ne sont pas inventées : ce sont celles que `worldgen`
 * produit, mesurées sur cinq mondes neufs (0,740 / 0,507 / 0,212 / 0,062). La
 * hiérarchie conserve donc la forme de pyramide que les données du jeu
 * décrivent déjà, au lieu d'en imposer une autre.
 */
const TIER_SHARE = { 2: 0.74, 3: 0.51, 4: 0.21, 5: 0.06 };

/** Force à atteindre pour prétendre à un niveau, mesurée sur la scène. */
function entryBarFor(reference, tier) {
  const share = TIER_SHARE[tier];
  if (!share || reference.allStrengths.length === 0) return null;
  const list = reference.allStrengths;
  // Valeur telle que `share` des équipes de la scène l'atteignent ou la dépassent.
  const index = clamp(Math.floor(list.length * (1 - share)), 0, list.length - 1);
  return list[index];
}

/**
 * Nombre d'organisations que la scène soutient à ce niveau **ou au-dessus**.
 *
 * Cumulatif, comme `TIER_SHARE` : c'est ce qui donne sa forme à la pyramide.
 * Comparer une part cumulée à l'effectif d'un seul palier — l'erreur d'une
 * première version — revenait à autoriser au tier 4 autant d'organisations que
 * la scène peut en porter du tier 4 au sommet réunis.
 */
function tierCapacity(reference, tier) {
  const share = TIER_SHARE[tier];
  if (!share) return Infinity;
  return Math.max(1, Math.round(reference.sceneTeams * share));
}

/** Organisations présentes à ce niveau ou au-dessus. */
function occupancyAtOrAbove(occupancy, tier) {
  let n = 0;
  for (let t = tier; t <= MAX_TIER; t++) n += occupancy[t] ?? 0;
  return n;
}

/**
 * Dossier de candidature à la montée.
 *
 * Chaque facteur est nommé et porte sa contribution : le total n'est qu'une
 * somme lisible, pas une boîte noire. Un facteur peut être bloquant — une
 * organisation qui ne peut pas payer le niveau supérieur n'y monte pas, quelle
 * que soit sa saison.
 */
export function promotionCase(world, team, reference) {
  const a = seasonAssessment(world, team);
  const factors = [];
  const add = (key, label, delta) => {
    if (delta !== 0) factors.push({ key, label, delta: Math.round(delta * 10) / 10 });
  };

  // 1. A-t-elle réellement joué ? Une saison de trois matchs ne prouve rien.
  const enoughMatches = a.played >= 8;
  if (!enoughMatches) add('matches', `saison trop courte (${a.played} matchs)`, -25);
  else add('matches', `saison complète (${a.played} matchs)`, Math.min(10, a.played * 0.4));

  // 2. Résultats rapportés à ses pairs de même niveau.
  const peerPoints = reference.meanPoints[a.tier] ?? 0;
  if (peerPoints > 0) {
    const ratio = a.points / peerPoints;
    add('results', `points ${a.points} pour ${Math.round(peerPoints)} en moyenne à son niveau`, clamp((ratio - 1) * 26, -20, 32));
  } else if (a.points > 0) {
    add('results', `${a.points} points marqués`, 10);
  }

  // 3. Domination de son niveau — plafonnée, et c'est volontaire (§3).
  if (a.winRatio !== null) {
    add('dominance', `${Math.round(a.winRatio * 100)} % de victoires`, clamp((a.winRatio - 0.5) * 40, -18, 20));
  }

  // 4. Capacité à survivre au-dessus. Deux signaux distincts, et c'est
  //    précisément la distinction du §3 : contre qui la saison a été jouée, et
  //    à quelle distance on se trouve de la barre d'entrée du niveau visé.
  if (a.meanOpponent !== null && reference.leagueMeanStrength) {
    const exposure = a.meanOpponent / reference.leagueMeanStrength;
    add(
      'level',
      `adversaires à ${Math.round(a.meanOpponent)} de force moyenne (ligue : ${Math.round(reference.leagueMeanStrength)})`,
      clamp((exposure - 0.82) * 40, -16, 16),
    );
  }
  const entryBar = entryBarFor(reference, a.tier + 1);
  if (entryBar) {
    // Une saison exceptionnelle peut porter une équipe légèrement en dessous de
    // la barre — mais pas une équipe hors sujet.
    add(
      'target',
      `force ${Math.round(a.power)} pour une barre d'entrée à ${Math.round(entryBar)} au niveau ${a.tier + 1}`,
      clamp((a.power / entryBar - 0.95) * 220, -40, 20),
    );
  }

  // 5. Classement et titres réellement obtenus.
  if (a.bestRankShare !== null) add('rank', `meilleur classement de la saison`, a.bestRankShare * 14);
  if (a.titles > 0) add('titles', `${a.titles} tournoi(s) remporté(s)`, Math.min(12, a.titles * 5));

  // 6. Moyens. Une condition de crédibilité, volontairement modeste dans sa
  //    contribution : dans cette économie, les structures au-dessus du tier 1
  //    couvrent déjà quatre à vingt-six fois le coût de leur niveau. La
  //    capacité ne peut donc pas servir de frein — elle sert de plancher.
  const cost = tierOperatingCost(a.tier + 1) + a.salaryLoad;
  const funds = a.yearlyIncome + Math.max(0, a.budget);
  const coverage = cost > 0 ? funds / cost : 1;
  add('capacity', `moyens couvrant ${Math.round(coverage * 100)} % du coût du niveau visé`, clamp((Math.min(coverage, 2) - 0.8) * 12, -20, 12));
  if (!a.rosterComplete) add('roster', 'effectif incomplet', -20);

  const score = factors.reduce((n, f) => n + f.delta, 0);
  // Blocages absolus : ils ne se compensent pas par une bonne saison.
  const blockers = [];
  if (!enoughMatches) blockers.push('saison trop courte');
  if (!a.rosterComplete) blockers.push('effectif incomplet');
  if (coverage < 0.35) blockers.push('moyens insuffisants');
  if (a.tier >= MAX_TIER) blockers.push('déjà au sommet');
  if (entryBar && a.power < entryBar * 0.86) blockers.push('niveau trop éloigné du palier visé');

  return { assessment: a, factors, score, blockers, eligible: blockers.length === 0 && score >= 20 };
}

/**
 * Dossier de relégation, construit symétriquement.
 *
 * `excess` : nombre d'organisations que son palier compte au-delà de ce que la
 * scène soutient. Il ne pèse que sur celles qui sont déjà sous la barre de leur
 * niveau — un palier encombré fait redescendre ses plus faibles, jamais ses
 * meilleures.
 */
export function relegationCase(world, team, reference, { excess = 0 } = {}) {
  const a = seasonAssessment(world, team);
  const factors = [];
  const add = (key, label, delta) => {
    if (delta !== 0) factors.push({ key, label, delta: Math.round(delta * 10) / 10 });
  };

  // 1. Résultats rapportés à ses pairs : c'est la saison qui juge, pas une
  //    mauvaise semaine.
  const peerPoints = reference.meanPoints[a.tier] ?? 0;
  if (peerPoints > 0) {
    const ratio = a.points / peerPoints;
    add('results', `points ${a.points} pour ${Math.round(peerPoints)} en moyenne à son niveau`, clamp((1 - ratio) * 30, -24, 34));
  }

  // 2. Ratio de victoires.
  if (a.winRatio !== null) {
    add('form', `${Math.round(a.winRatio * 100)} % de victoires`, clamp((0.42 - a.winRatio) * 46, -18, 24));
  } else {
    add('form', 'aucun match joué', 22);
  }

  // 3. Classements.
  if (a.bestRankShare !== null) add('rank', 'meilleur classement de la saison', -a.bestRankShare * 16);
  if (a.titles > 0) add('titles', `${a.titles} tournoi(s) remporté(s)`, -Math.min(18, a.titles * 8));

  // 4. Difficulté sportive : être très en dessous de la barre d'entrée de son
  //    propre niveau, c'est ne plus y appartenir. Symétrique de la promotion.
  const ownBar = entryBarFor(reference, a.tier);
  let shortfall = 0;
  if (ownBar) {
    shortfall = clamp(1 - a.power / ownBar, 0, 1);
    add(
      'level',
      `force ${Math.round(a.power)} pour une barre à ${Math.round(ownBar)} à son niveau`,
      clamp((1 - a.power / ownBar) * 120, -14, 26),
    );
  }
  if (excess > 0 && shortfall > 0) {
    const capacity = tierCapacity(reference, a.tier);
    add(
      'crowding',
      `palier saturé (${excess} de trop) et niveau insuffisant`,
      clamp((excess / Math.max(2, capacity)) * shortfall * 240, 0, 24),
    );
  }

  // 5. Économie : une structure qui ne peut plus payer son niveau le quitte.
  const cost = tierOperatingCost(a.tier) + a.salaryLoad;
  const funds = a.yearlyIncome + Math.max(0, a.budget);
  const coverage = cost > 0 ? funds / cost : 1;
  add('economy', `moyens couvrant ${Math.round(coverage * 100)} % du coût de son niveau`, clamp((0.85 - coverage) * 40, -14, 34));
  if (a.budget < 0) add('debt', 'trésorerie négative', 12);
  if (!a.rosterComplete) add('roster', `effectif incomplet (${a.rosterSize})`, 16);

  const score = factors.reduce((n, f) => n + f.delta, 0);
  const protections = [];
  // On ne relègue pas une équipe qui n'a pas eu l'occasion de jouer : elle
  // vient d'être promue ou la scène ne l'a pas programmée.
  if (a.played < 6 && a.budget >= 0 && a.rosterComplete) protections.push('trop peu de matchs pour juger');
  if (a.tier <= 1) protections.push('déjà au niveau le plus bas');

  return { assessment: a, factors, score, protections, eligible: protections.length === 0 && score >= 22 };
}

/**
 * Décide les mouvements d'une saison, scène par scène.
 *
 * Les deux décisions sont indépendantes : il peut y avoir zéro montée et trois
 * descentes, ou l'inverse. Les places disponibles ne font que **moduler** la
 * probabilité de montée — elles n'imposent aucune égalité.
 */
export function applyHierarchyChanges(world, rng, { leagueTarget = 8 } = {}) {
  const moves = { promoted: [], relegated: [] };

  for (const gameState of Object.values(world.gameStates)) {
    if (!gameState.alive) continue;
    const gameId = gameState.gameId;
    const reference = sceneReference(world, gameId);

    const teams = Object.values(world.teams).filter((t) => {
      if (!t.active || t.gameId !== gameId || t.isSelfTeam) return false;
      const org = world.orgs[t.orgId];
      if (!org?.alive || org.isSelfOrg) return false;
      // L'équipe du joueur suit ses propres événements.
      return !t.roster.some((id) => world.persons[id]?.isPlayer);
    });
    if (teams.length === 0) continue;

    // --- Descentes : jugées d'abord, indépendamment de toute candidature.
    const before = tierOccupancy(world, gameId);
    const relegationCases = teams
      .map((t) => {
        const tier = world.orgs[t.orgId]?.tier ?? 1;
        const excess = Math.max(0, occupancyAtOrAbove(before, tier) - tierCapacity(reference, tier));
        return { team: t, c: relegationCase(world, t, reference, { excess }) };
      })
      .filter((x) => x.c.eligible)
      .sort((a, b) => b.c.score - a.c.score);

    for (const { team, c } of relegationCases) {
      // Une candidature nette descend presque sûrement ; une candidature juste
      // au seuil garde une chance de s'en sortir.
      const p = clamp(0.25 + (c.score - 22) / 55, 0.15, 0.9) * settlingFactor(world, team, c.score);
      if (!rng.chance(p)) continue;
      relegate(world, team, c, moves);
    }

    // --- Montées : évaluées ensuite, indépendamment. Les places disponibles
    //     modulent la probabilité, elles n'imposent aucune égalité avec le
    //     nombre de descentes.
    const leagueNow = countLeagueTeams(world, gameId);
    const regions = activeRegionCount(world, gameId);
    const leagueRoom = leagueTarget * Math.max(1, regions) - leagueNow;
    const occupancy = tierOccupancy(world, gameId);

    const promotionCases = teams
      .map((t) => ({ team: t, c: promotionCase(world, t, reference) }))
      .filter((x) => x.c.eligible)
      .sort((a, b) => b.c.score - a.c.score);

    // Les candidatures sont classées par qualité, et chaque palier n'admet
    // qu'un nombre limité d'entrants par saison : c'est ainsi que la place
    // disponible influence le résultat sans imposer « une descente = une
    // montée ». Un palier saturé n'est pas fermé — il n'accueille plus qu'une
    // organisation par an, et seulement si son dossier s'impose.
    const admissions = {};

    for (const { team, c } of promotionCases) {
      const org = world.orgs[team.orgId];
      if (!org?.alive) continue;
      // Une organisation ne monte pas la saison où elle vient de descendre.
      if (org.lastTierChangeWeek === world.week) continue;

      const target = org.tier + 1;
      const capacity = tierCapacity(reference, target);
      const taken = occupancyAtOrAbove(occupancy, target);
      const seats = capacity - taken;
      const admitted = admissions[target] ?? 0;
      if (seats > 0) {
        if (admitted >= seats) continue;
      } else {
        // Palier saturé : il reste franchissable, mais une seule fois par
        // saison et seulement par un dossier qui s'impose. Une version
        // précédente accordait un siège garanti à chaque palier et à chaque
        // saison (`Math.max(1, capacity - taken)`) : le sommet passait de 9 à
        // 27 organisations en dix ans par ce seul chemin.
        if (admitted >= 1 || c.score < 55) continue;
      }

      let roomFactor = clamp(1 - (taken - capacity) / Math.max(2, capacity), 0.08, 1);
      // À l'entrée en ligue s'ajoute la contrainte propre aux championnats,
      // qui n'accueillent qu'un nombre limité d'équipes par région.
      if (target === LEAGUE_CAPABLE_TIER) {
        roomFactor *= clamp(0.35 + leagueRoom * 0.12, 0.15, 1);
      }

      const merit = clamp((c.score - 20) / 45, 0, 1);
      const p =
        clamp((0.18 + merit * 0.5) * roomFactor, 0.02, 0.75) * settlingFactor(world, team, c.score);
      if (!rng.chance(p)) continue;
      const from = org.tier;
      promote(world, team, c, moves);
      admissions[target] = (admissions[target] ?? 0) + 1;
      occupancy[target] = taken + 1;
      occupancy[from] = Math.max(0, (occupancy[from] ?? 1) - 1);
    }
  }

  refreshStatuses(world);
  return moves;
}

function countLeagueTeams(world, gameId) {
  let n = 0;
  for (const t of Object.values(world.teams)) {
    if (!t.active || t.gameId !== gameId || t.isSelfTeam) continue;
    if (canSustainLeague(world.orgs[t.orgId])) n++;
  }
  return n;
}

/**
 * Inertie après un changement de palier.
 *
 * Sans elle, une organisation promue puis jugée trop juste redescend l'année
 * suivante, remonte, redescend : mesuré, 63 des 67 organisations passées par le
 * sommet y étaient revenues, et l'ascenseur devenait la trajectoire dominante.
 * Une structure qui vient de changer de niveau a le temps de s'y installer —
 * sauf si son dossier est écrasant, auquel cas rien ne la retient (§14 : les
 * ascenseurs doivent rester possibles).
 */
function settlingFactor(world, team, score) {
  const org = world.orgs[team.orgId];
  const since = world.week - (org?.lastTierChangeWeek ?? -Infinity);
  const years = since / WEEKS_PER_YEAR;
  if (years >= 3) return 1;
  const overwhelming = clamp((score - 40) / 30, 0, 1);
  return clamp(0.25 + years * 0.25 + overwhelming * 0.5, 0.15, 1);
}

/** Nombre d'organisations effectivement présentes à chaque niveau. */
function tierOccupancy(world, gameId) {
  const out = {};
  for (const t of Object.values(world.teams)) {
    if (!t.active || t.gameId !== gameId || t.isSelfTeam) continue;
    const org = world.orgs[t.orgId];
    if (!org?.alive || org.isSelfOrg) continue;
    out[org.tier] = (out[org.tier] ?? 0) + 1;
  }
  return out;
}

function activeRegionCount(world, gameId) {
  const regions = new Set();
  for (const t of Object.values(world.teams)) {
    if (!t.active || t.gameId !== gameId) continue;
    const org = world.orgs[t.orgId];
    if (org?.alive) regions.add(org.regionId);
  }
  return regions.size;
}

/**
 * Conséquences d'une montée : une opportunité ET un risque (§7).
 *
 * On ne verse pas une prime fixe. Les revenus progressent parce que le niveau
 * attire davantage, la trésorerie reçoit une avance liée à ce que la nouvelle
 * ligue distribue — et les charges augmentent mécaniquement dans
 * `simulateOrgEconomy`. Une structure peut donc monter, ne pas suivre, et
 * redescendre : rien ne l'en protège.
 */
function promote(world, team, c, moves) {
  const org = world.orgs[team.orgId];
  const from = org.tier;
  org.tier = clamp(org.tier + 1, 1, MAX_TIER);
  org.lastTierChangeWeek = world.week;
  org.tierHistory = [...(org.tierHistory ?? []), { week: world.week, tier: org.tier, kind: 'promotion' }];
  // Aucune prime de montée qui multiplie les revenus : une première version
  // appliquait `revenus × 1,35` à chaque échelon, ce qui rendait chaque montée
  // suivante plus facile que la précédente — 93 organisations sur 134 finissaient
  // tier 5 en vingt ans. Les revenus suivent les résultats et la réputation,
  // via `simulateOrgEconomy`. La montée n'apporte qu'une avance de trésorerie
  // pour affronter des charges qui, elles, augmentent immédiatement.
  org.budget = Math.round(org.budget + tierOperatingCost(org.tier) * 0.4);
  org.history.push({ week: world.week, text: `Montée au niveau ${org.tier}` });
  world.news.push({
    week: world.week,
    headline: `${org.name} monte d'un niveau`,
    body: `Après sa saison, la structure évolue désormais au niveau ${org.tier}.`,
    gameId: team.gameId,
    tone: 'positive',
  });
  moves.promoted.push({ orgId: org.id, teamId: team.id, from, to: org.tier, score: c.score });

  if (isTracing()) {
    trace(TRACE.HIERARCHY, world.week, {
      decision: 'promotion',
      orgId: org.id,
      orgName: org.name,
      teamId: team.id,
      gameId: team.gameId,
      from,
      to: org.tier,
      score: Math.round(c.score),
      factors: c.factors,
    });
  }
}

/**
 * Conséquences d'une descente. On ne détruit rien automatiquement (§8) :
 * l'effectif reste, les revenus baissent, et c'est au marché et à l'économie
 * de décider si la structure se reconstruit ou s'enfonce.
 */
function relegate(world, team, c, moves) {
  const org = world.orgs[team.orgId];
  const from = org.tier;
  org.tier = clamp(org.tier - 1, 1, MAX_TIER);
  org.lastTierChangeWeek = world.week;
  org.tierHistory = [...(org.tierHistory ?? []), { week: world.week, tier: org.tier, kind: 'relegation' }];
  org.yearlyIncome = Math.round(org.yearlyIncome * 0.72);
  org.history.push({ week: world.week, text: `Relégation au niveau ${org.tier}` });
  world.news.push({
    week: world.week,
    headline: `${org.name} est reléguée`,
    body: `La structure descend au niveau ${org.tier} après une saison manquée.`,
    gameId: team.gameId,
    tone: 'negative',
  });
  moves.relegated.push({ orgId: org.id, teamId: team.id, from, to: org.tier, score: c.score });

  if (isTracing()) {
    trace(TRACE.HIERARCHY, world.week, {
      decision: 'relegation',
      orgId: org.id,
      orgName: org.name,
      teamId: team.id,
      gameId: team.gameId,
      from,
      to: org.tier,
      score: Math.round(c.score),
      factors: c.factors,
    });
  }
}

/**
 * Remet les statuts en accord avec le niveau réel des organisations (§9).
 *
 * Le statut décrit la situation **actuelle** : un joueur dont l'équipe descend
 * n'est plus professionnel. Ce qu'il a atteint, en revanche, ne se perd pas —
 * `stats.highestStatus` ne recule jamais.
 */
export function refreshStatuses(world) {
  let changed = 0;
  for (const team of Object.values(world.teams)) {
    if (!team.active) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive || org.isSelfOrg) continue;
    const expected = statusForTier(org.tier);
    for (const id of [...team.roster, ...team.subs]) {
      const p = world.persons[id];
      if (!p) continue;
      if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
      if (p.status !== expected) {
        p.status = expected;
        changed++;
      }
      recordHighestStatus(p, expected);
    }
  }
  return changed;
}

/** Mémorise le statut le plus élevé jamais atteint, sans jamais le réduire. */
export function recordHighestStatus(person, status) {
  const rank = STATUS_RANK[status] ?? 0;
  const best = STATUS_RANK[person.stats.highestStatus] ?? 0;
  if (rank > best) person.stats.highestStatus = status;
}

/** Explication lisible d'un mouvement, pour le mode debug (§19). */
export function explainHierarchy(entry) {
  const lines = [];
  const verb = entry.decision === 'promotion' ? 'monte' : 'descend';
  lines.push(
    `S${entry.week} — ${entry.orgName} ${verb} du niveau ${entry.from} au niveau ${entry.to}` +
      ` (dossier ${entry.score})`,
  );
  for (const f of entry.factors ?? []) {
    const sign = f.delta >= 0 ? '+' : '';
    lines.push(`    ${f.label} : ${sign}${f.delta}`);
  }
  return lines.join('\n');
}
