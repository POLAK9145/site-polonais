/**
 * Écosystème amateur : formation et disparition des équipes d'entrée.
 *
 * PROBLÈME CORRIGÉ
 * ----------------
 * « Amateur » n'était pas un état structurel mais un rang : `setupSeason`
 * classait les équipes d'une région et envoyait les huit premières en ligue.
 * Comme une région compte rarement plus de huit équipes après attrition, le
 * découpage prenait tout le monde et le circuit amateur était vide *par
 * construction*. Mesuré : 0 équipe amateur et 0 tournoi d'entrée créé en dix
 * ans, alors même que ~54 joueurs sans équipe (18 ans de moyenne) attendaient
 * quelque part.
 *
 * MODÈLE RETENU
 * -------------
 * Deux corrections indépendantes et minimales :
 *
 *  1. Appartenir à une ligue devient une CAPACITÉ, pas une position. Une
 *     organisation communautaire (tier 1, budget quasi nul) ne peut pas
 *     soutenir une saison de ligue : elle joue le circuit amateur, quel que
 *     soit son classement. Ce critère existait déjà dans les données
 *     (`ORG_TIERS`), il n'était simplement pas utilisé.
 *
 *  2. Les équipes amateurs se forment à partir de joueurs réellement sans
 *     équipe, avec une probabilité dictée par la pression démographique de la
 *     scène, sa vitalité et sa saturation — et disparaissent quand elles
 *     échouent. Aucun nombre cible n'est maintenu : le nombre d'équipes est
 *     une conséquence, pas une consigne.
 *
 * Compatibilité avec les promotions (étape 3) : la division étant désormais
 * dérivée du tier de l'organisation, une promotion se traduit par une hausse
 * de tier et la division suit d'elle-même. Aucune logique de promotion n'est
 * dupliquée ici.
 */

import { clamp } from './rng.js';
import { GAMES, GAMES_BY_ID } from '../data/games.js';
import { STATUS, age as personAge, baseRating, weightedCeiling } from './person.js';
import { createOrg, createTeam } from './org.js';
import { addToRoster, computeSynergyTarget, recordStint, rosterPersons } from './team.js';
import { releasePlayer } from './transfers.js';
import { WEEKS_PER_YEAR } from './time.js';

/** Tier minimal d'organisation capable de tenir une saison de ligue. */
export const LEAGUE_CAPABLE_TIER = 2;

/** Cadence d'examen de la formation d'équipes amateurs. */
export const FORMATION_REVIEW_WEEKS = 4;

/**
 * Une organisation peut-elle soutenir une saison de ligue ?
 *
 * Critère unique : le tier de la structure. Une première version ajoutait « ou
 * un budget supérieur à 60 000 », ce qui s'est révélé être une seconde logique
 * de promotion — non sportive, à sens unique, et donc cumulative : mesuré sur
 * quarante ans, la ligue passait de 108 à 134 équipes uniquement par ce
 * chemin (`ligue par tier` restant à 109), chaque structure enrichie quittant
 * définitivement le circuit d'entrée. Le seul chemin vers la ligue est la
 * montée de tier, qui relève des promotions (étape 3).
 */
export function canSustainLeague(org) {
  if (!org || !org.alive || org.isSelfOrg) return false;
  return org.tier >= LEAGUE_CAPABLE_TIER;
}

/** Joueurs sans équipe, par scène et par région. */
function unattachedByRegion(world, gameId) {
  const out = {};
  for (const p of Object.values(world.persons)) {
    if (p.gameId !== gameId) continue;
    if (p.teamId) continue;
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    (out[p.regionId] ??= []).push(p);
  }
  return out;
}

function amateurTeamsByRegion(world, gameId) {
  const out = {};
  for (const t of Object.values(world.teams)) {
    if (!t.active || t.gameId !== gameId || t.isSelfTeam) continue;
    const org = world.orgs[t.orgId];
    if (!org?.alive || canSustainLeague(org)) continue;
    out[org.regionId] = (out[org.regionId] ?? 0) + 1;
  }
  return out;
}

/**
 * Formation d'équipes amateurs.
 *
 * La probabilité vient de trois grandeurs réelles : combien de joueurs
 * attendent, quelle est la santé de la scène, et combien d'équipes d'entrée
 * existent déjà. Le plafond lui-même est dérivé du nombre de joueurs
 * disponibles — il n'y a donc pas de « bon nombre » d'équipes amateurs.
 */
export function formAmateurTeams(world, rng) {
  if (world.week % FORMATION_REVIEW_WEEKS !== 0) return [];
  const created = [];

  for (const game of GAMES) {
    const gs = world.gameStates[game.id];
    if (!gs?.alive) continue;
    const size = game.teamSize;
    const pools = unattachedByRegion(world, game.id);
    const existing = amateurTeamsByRegion(world, game.id);

    for (const [regionId, pool] of Object.entries(pools)) {
      if (pool.length < size) continue;

      // Appétit : avec trois rosters de joueurs disponibles, la scène est
      // clairement sous-équipée en équipes d'entrée.
      const appetite = clamp(pool.length / (size * 3), 0, 1);
      // Plafond dérivé de la population disponible, pas d'une constante.
      const ceilingTeams = 2 + Math.floor(pool.length / size);
      const room = clamp(1 - (existing[regionId] ?? 0) / ceilingTeams, 0, 1);
      const vitality = gs.vitality ?? 0.5;

      const p = 0.38 * appetite * room * (0.35 + 0.65 * vitality);
      if (!rng.chance(p)) continue;

      const team = createAmateurTeam(world, rng, game, regionId, pool);
      if (team) {
        created.push(team);
        existing[regionId] = (existing[regionId] ?? 0) + 1;
      }
    }
  }
  return created;
}

/**
 * Styles de constitution d'un roster amateur.
 * La variance est volontaire (§4) : une équipe qui se monte peut être un
 * groupe de débutants, un rassemblement de vétérans sans club, ou un projet
 * bâti autour d'un joueur qui vaut mieux que ce niveau.
 */
const FORMATION_STYLES = ['rookies', 'veterans', 'mixed', 'around_talent'];

function pickRoster(world, rng, game, pool, size) {
  const style = rng.pick(FORMATION_STYLES);
  const sorted = [...pool];
  switch (style) {
    case 'rookies':
      sorted.sort((a, b) => personAge(a, world.week) - personAge(b, world.week));
      return { style, members: sorted.slice(0, size) };
    case 'veterans':
      sorted.sort((a, b) => personAge(b, world.week) - personAge(a, world.week));
      return { style, members: sorted.slice(0, size) };
    case 'around_talent': {
      sorted.sort((a, b) => weightedCeiling(b, game) - weightedCeiling(a, game));
      const star = sorted[0];
      const rest = rng.sample(sorted.slice(1), size - 1);
      return { style, members: [star, ...rest].filter(Boolean) };
    }
    default:
      return { style: 'mixed', members: rng.sample(pool, size) };
  }
}

function createAmateurTeam(world, rng, game, regionId, pool) {
  const size = game.teamSize;
  const { style, members } = pickRoster(world, rng, game, pool, size);
  if (members.length < size) return null;

  const org = createOrg(rng, {
    regionId,
    tier: 1,
    takenNames: world.indexes.takenOrgNames,
    takenTags: world.indexes.takenTags,
    absWeek: world.week,
  });
  // Une structure communautaire naît sans moyens : c'est ce qui la distingue.
  org.budget = Math.round(rng.float(0, 4000));
  org.yearlyIncome = Math.round(rng.float(0, 6000));
  org.grassroots = true;
  world.orgs[org.id] = org;

  const team = createTeam(rng, { org, gameId: game.id, absWeek: world.week, tierOverride: 1 });
  team.division = 'amateur';
  team.formationStyle = style;
  world.teams[team.id] = team;

  for (const p of members) {
    addToRoster(world, team, p.id, { initial: true });
    const i = world.freeAgents.indexOf(p.id);
    if (i >= 0) world.freeAgents.splice(i, 1);
    p.status = STATUS.AMATEUR;
    recordStint(world, p, team, org, world.week);
  }
  // Un groupe qui vient de se former ne joue pas encore ensemble.
  team.synergy = clamp(computeSynergyTarget(world, team) * rng.float(0.5, 0.8), 8, 70);
  team.sharedWeeks = 0;

  return team;
}

/**
 * Disparition des équipes amateurs.
 *
 * Une équipe d'entrée qui n'a ni résultats, ni effectif complet, ni moyens
 * finit par se dissoudre — ses joueurs retournent au vivier. C'est la
 * contrepartie indispensable de la formation : sans elle, le monde
 * accumulerait indéfiniment des équipes.
 */
export function dissolveFailedAmateurTeams(world, rng) {
  const dissolved = [];
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.isSelfTeam) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive || canSustainLeague(org)) continue;
    // On laisse à une jeune équipe le temps d'exister.
    if (world.week - team.created < WEEKS_PER_YEAR) continue;
    // Ne jamais dissoudre l'équipe du joueur sous ses pieds : sa structure
    // a ses propres événements (org_in_trouble, org_fate).
    if (org.foundedByPlayer) continue;
    if (team.roster.some((id) => world.persons[id]?.isPlayer)) continue;

    const game = GAMES_BY_ID[team.gameId];
    const season = team.season ?? { wins: 0, played: 0 };
    const players = rosterPersons(world, team);

    let risk = 0.1;
    if (players.length < (game?.teamSize ?? 1)) risk += 0.25;
    if (season.played > 0 && season.wins === 0) risk += 0.2;
    if (season.played === 0) risk += 0.15;
    if (org.budget <= 0) risk += 0.12;

    // Un espoir crédible dans l'effectif retient le projet.
    const hasProspect = players.some(
      (p) => personAge(p, world.week) < 21 && weightedCeiling(p, game) > 78,
    );
    if (hasProspect) risk -= 0.18;
    // Comme un début de résultats.
    if (season.wins >= 3) risk -= 0.15;

    if (!rng.chance(clamp(risk, 0.02, 0.7))) continue;

    team.active = false;
    org.alive = false;
    org.disbandedWeek = world.week;
    for (const pid of [...team.roster, ...team.subs]) {
      releasePlayer(world, pid, world.week, 'dissolution de l’équipe amateur');
    }
    dissolved.push(team);
  }
  return dissolved;
}

/**
 * Répartit les équipes d'une scène entre ligue et circuit amateur.
 * Remplace le découpage par rang : on part de ce que les organisations
 * peuvent réellement soutenir.
 */
export function assignDivisions(world, teams, leagueSize) {
  const capable = [];
  const amateur = [];
  for (const t of teams) {
    const org = world.orgs[t.orgId];
    if (canSustainLeague(org)) capable.push(t);
    else amateur.push(t);
  }
  // Si une scène compte plus de structures capables que de places, les
  // moins performantes redescendent — une situation légitime, que l'étape 3
  // rendra dynamique.
  let league = capable;
  if (capable.length > leagueSize) {
    league = capable.slice(0, leagueSize);
    amateur.push(...capable.slice(leagueSize));
  }
  return { league, amateur };
}

/** Statistiques d'écosystème d'entrée, par scène (audit et tests). */
export function amateurEcosystem(world) {
  const out = {};
  for (const game of GAMES) {
    const gs = world.gameStates[game.id];
    const scene = {
      alive: !!gs?.alive,
      leagueTeams: 0,
      amateurTeams: 0,
      amateurPlayers: 0,
      unattached: 0,
      youngUnattached: 0,
      proPlayers: 0,
    };
    for (const t of Object.values(world.teams)) {
      if (!t.active || t.gameId !== game.id || t.isSelfTeam) continue;
      const org = world.orgs[t.orgId];
      if (!org?.alive) continue;
      if (canSustainLeague(org)) scene.leagueTeams++;
      else {
        scene.amateurTeams++;
        scene.amateurPlayers += t.roster.length;
      }
    }
    for (const p of Object.values(world.persons)) {
      if (p.gameId !== game.id) continue;
      if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
      if (p.status === STATUS.PRO) scene.proPlayers++;
      if (!p.teamId) {
        scene.unattached++;
        if (personAge(p, world.week) < 22) scene.youngUnattached++;
      }
    }
    out[game.id] = scene;
  }
  return out;
}
