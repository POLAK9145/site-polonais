/**
 * Orchestration des saisons (§25).
 *
 * Construit la pyramide compétitive de chaque scène à chaque nouvelle année,
 * puis fait vivre le calendrier : ligues, playoffs, international, mondiaux,
 * circuit amateur. Gère aussi promotions et relégations — c'est ce qui rend
 * l'ascension d'une petite structure réellement possible (§60).
 */

import { clamp } from './rng.js';
import { PHASES, phaseOfWeek, weekOfYear, yearOf, absWeek } from './time.js';
import {
  createCompetition,
  runCompetitionWeek,
  sortedStandings,
  COMP_TIERS,
} from './competition.js';
import { teamStrength } from './team.js';
import { GAMES_BY_ID } from '../data/games.js';
import { REGIONS_BY_ID } from '../data/regions.js';
import { assignDivisions, canSustainLeague } from './amateur.js';
import { applyHierarchyChanges } from './hierarchy.js';

const LEAGUE_SIZE = 8;

/** Points de saison attribués selon le niveau de la compétition et le rang. */
const PLACEMENT_POINTS = {
  open: [12, 7, 4, 2],
  qualifier: [25, 15, 9, 5],
  national: [60, 40, 26, 16, 10, 6, 4, 2],
  regional: [120, 85, 60, 42, 30, 20, 12, 6],
  international: [260, 190, 140, 100, 70, 50, 35, 20],
  worlds: [500, 360, 260, 190, 130, 90, 60, 35],
};

export function ensureSeasonState(world) {
  if (!world.seasonPoints) world.seasonPoints = {};
  if (!world.seasonAwards) world.seasonAwards = [];
  if (!world.activeCompetitionIds) world.activeCompetitionIds = [];
}

function pointsFor(world, teamId, gameId) {
  ensureSeasonState(world);
  if (!world.seasonPoints[gameId]) world.seasonPoints[gameId] = {};
  return world.seasonPoints[gameId][teamId] ?? 0;
}

function addPoints(world, teamId, gameId, pts) {
  if (!world.seasonPoints[gameId]) world.seasonPoints[gameId] = {};
  world.seasonPoints[gameId][teamId] = (world.seasonPoints[gameId][teamId] ?? 0) + pts;
}

/** Toutes les équipes actives d'un jeu, groupées par région. */
function scenesOf(world, gameId) {
  const byRegion = {};
  for (const team of Object.values(world.teams)) {
    if (team.gameId !== gameId || !team.active) continue;
    const org = world.orgs[team.orgId];
    if (!org || !org.alive) continue;
    (byRegion[org.regionId] ??= []).push(team);
  }
  return byRegion;
}

function teamPower(world, team) {
  return teamStrength(world, team, { forMatch: false }).strength;
}

/**
 * Présaison : on redessine les ligues de chaque scène.
 * Les meilleures équipes forment la ligue régionale, les autres jouent le
 * circuit amateur. Une équipe reléguée retrouve donc réellement le bas de
 * la pyramide, avec des primes et une exposition dérisoires.
 */
export function setupSeason(world, rng) {
  ensureSeasonState(world);
  const season = yearOf(world.week);
  world.seasonPoints = {};

  for (const gameState of Object.values(world.gameStates)) {
    if (!gameState.alive) continue;
    const game = GAMES_BY_ID[gameState.gameId];
    const scenes = scenesOf(world, game.id);

    for (const [regionId, teams] of Object.entries(scenes)) {
      const region = REGIONS_BY_ID[regionId];
      const ranked = teams
        .map((t) => ({ t, power: teamPower(world, t), tier: world.orgs[t.orgId].tier }))
        .sort((a, b) => b.tier - a.tier || b.power - a.power)
        .map((r) => r.t);

      // La ligue se compose de ce que les organisations peuvent soutenir, et
      // non des huit premières du classement : sinon une scène réduite
      // absorbe tout le monde et n'a plus aucun niveau d'entrée.
      const { league: leagueTeams, amateur: amateurTeams } = assignDivisions(
        world,
        ranked,
        LEAGUE_SIZE,
      );

      for (const t of leagueTeams) t.division = 'league';
      for (const t of amateurTeams) t.division = 'amateur';

      if (leagueTeams.length >= 4) {
        const tierId = region.strength >= 0.8 && game.popularity >= 60 ? 'REGIONAL' : 'NATIONAL';
        const comp = createCompetition(world, {
          name: `${game.shortName} ${region.short} — Split 1 ${season}`,
          gameId: game.id,
          tierId,
          regionId,
          teamIds: leagueTeams.map((t) => t.id),
          kind: 'league',
          startWeek: absWeek(season, 3),
          weeksAvailable: 16,
          format: 3,
          season,
        });
        comp.splitIndex = 1;
        world.competitions[comp.id] = comp;
      }
    }
  }
}

/** Deuxième split : mêmes ligues, rosters éventuellement modifiés. */
export function setupSplit2(world, rng) {
  const season = yearOf(world.week);
  for (const gameState of Object.values(world.gameStates)) {
    if (!gameState.alive) continue;
    const game = GAMES_BY_ID[gameState.gameId];
    const scenes = scenesOf(world, game.id);
    for (const [regionId, teams] of Object.entries(scenes)) {
      const region = REGIONS_BY_ID[regionId];
      const leagueTeams = teams.filter((t) => t.division === 'league');
      if (leagueTeams.length < 4) continue;
      const tierId = region.strength >= 0.8 && game.popularity >= 60 ? 'REGIONAL' : 'NATIONAL';
      const comp = createCompetition(world, {
        name: `${game.shortName} ${region.short} — Split 2 ${season}`,
        gameId: game.id,
        tierId,
        regionId,
        teamIds: leagueTeams.map((t) => t.id),
        kind: 'league',
        startWeek: absWeek(season, 27),
        weeksAvailable: 16,
        format: 3,
        season,
      });
      comp.splitIndex = 2;
      world.competitions[comp.id] = comp;
    }
  }
}

/** Playoffs : top 4 de chaque ligue terminée, demi-finales puis finale. */
export function setupPlayoffs(world, splitIndex, rng) {
  const season = yearOf(world.week);
  const startWeek = splitIndex === 1 ? absWeek(season, 19) : absWeek(season, 43);
  for (const comp of Object.values(world.competitions)) {
    if (!comp) continue;
    if (!comp || comp.season !== season || comp.splitIndex !== splitIndex || comp.kind !== 'league') continue;
    const table = sortedStandings(comp).filter((s) => world.teams[s.teamId]?.active);
    const qualified = table.slice(0, 4).map((s) => s.teamId);
    if (qualified.length < 4) continue;
    const game = GAMES_BY_ID[comp.gameId];
    const region = REGIONS_BY_ID[comp.regionId];
    const playoff = createCompetition(world, {
      name: `${game.shortName} ${region.short} — Playoffs S${splitIndex} ${season}`,
      gameId: comp.gameId,
      tierId: comp.tierId.toUpperCase(),
      regionId: comp.regionId,
      teamIds: qualified,
      kind: 'bracket',
      startWeek,
      format: 5,
      season,
    });
    playoff.splitIndex = splitIndex;
    playoff.isPlayoff = true;
    world.competitions[playoff.id] = playoff;
  }
}

/** International de mi-saison : les meilleures équipes du monde, par jeu. */
export function setupInternational(world, rng) {
  const season = yearOf(world.week);
  for (const gameState of Object.values(world.gameStates)) {
    if (!gameState.alive) continue;
    const game = GAMES_BY_ID[gameState.gameId];
    if (game.popularity < 35) continue;
    const ranked = Object.values(world.teams)
      .filter((t) => t.gameId === game.id && t.active && t.division === 'league')
      .map((t) => ({ t, pts: pointsFor(world, t.id, game.id), power: teamPower(world, t) }))
      .sort((a, b) => b.pts - a.pts || b.power - a.power)
      .slice(0, 8);
    if (ranked.length < 4) continue;
    const comp = createCompetition(world, {
      name: `${game.shortName} — Invitational ${season}`,
      gameId: game.id,
      tierId: 'INTERNATIONAL',
      regionId: null,
      teamIds: ranked.map((r) => r.t.id),
      kind: 'bracket',
      startWeek: absWeek(season, 23),
      format: 5,
      season,
    });
    world.competitions[comp.id] = comp;
  }
}

/** Championnat du monde : l'aboutissement de la saison. */
export function setupWorlds(world, rng) {
  const season = yearOf(world.week);
  for (const gameState of Object.values(world.gameStates)) {
    if (!gameState.alive) continue;
    const game = GAMES_BY_ID[gameState.gameId];
    if (game.popularity < 30) continue;
    const ranked = Object.values(world.teams)
      .filter((t) => t.gameId === game.id && t.active && t.roster.length > 0)
      .map((t) => ({ t, pts: pointsFor(world, t.id, game.id), power: teamPower(world, t) }))
      .sort((a, b) => b.pts - a.pts || b.power - a.power)
      .slice(0, 8);
    if (ranked.length < 4) continue;
    const comp = createCompetition(world, {
      name: `${game.shortName} — Championnat du monde ${season}`,
      gameId: game.id,
      tierId: 'WORLDS',
      regionId: null,
      teamIds: ranked.map((r) => r.t.id),
      kind: 'bracket',
      startWeek: absWeek(season, 47),
      format: 5,
      season,
    });
    comp.isWorlds = true;
    world.competitions[comp.id] = comp;
  }
}

/**
 * Circuit amateur : petits tournois réguliers, ouverts aux équipes hors
 * ligue. C'est la porte d'entrée du §11 — sans lui, un joueur qui débute
 * n'aurait littéralement rien à jouer.
 */
export function setupOpenTournament(world, rng) {
  const season = yearOf(world.week);
  for (const gameState of Object.values(world.gameStates)) {
    if (!gameState.alive) continue;
    const game = GAMES_BY_ID[gameState.gameId];
    const scenes = scenesOf(world, game.id);

    // Un circuit d'entrée se joue à l'échelle de la SCÈNE, pas d'une seule
    // région. Exiger quatre équipes amateurs dans une même région rendait ces
    // tournois impossibles : les deux ou trois équipes d'entrée d'un jeu sont
    // réparties entre ses régions, et aucun tournoi ne se créait jamais.
    const eligible = [];
    for (const teams of Object.values(scenes)) {
      for (const t of teams) {
        if (t.division === 'league') continue;
        if (t.roster.length < game.teamSize) continue;
        eligible.push(t);
      }
    }
    if (eligible.length < 3) continue;

    // On privilégie un tournoi régional quand une région est assez fournie —
    // c'est plus crédible — et on retombe sur un open inter-régional sinon.
    const byRegion = {};
    for (const t of eligible) {
      const regionId = world.orgs[t.orgId]?.regionId;
      if (regionId) (byRegion[regionId] ??= []).push(t);
    }
    const richest = Object.entries(byRegion).sort((a, b) => b[1].length - a[1].length)[0];
    const regional = richest && richest[1].length >= 4;
    const pool = regional ? richest[1] : eligible;
    const regionId = regional ? richest[0] : null;
    const label = regional ? REGIONS_BY_ID[regionId].short : 'Open';

    const entrants = rng.sample(pool, Math.min(8, pool.length));
    const comp = createCompetition(world, {
      name: `Open ${game.shortName} ${label}`,
      gameId: game.id,
      tierId: pool.length >= 6 ? 'QUALIFIER' : 'OPEN',
      regionId,
      teamIds: entrants.map((t) => t.id),
      kind: 'bracket',
      startWeek: world.week,
      format: 3,
      season,
    });
    // Tout se joue le même week-end.
    comp.bracket.rounds.forEach((r) => {
      r.week = world.week;
    });
    comp.isOpen = true;
    world.competitions[comp.id] = comp;
  }
}

/** Joue les rencontres de la semaine et récolte les compétitions terminées. */
export function runWeek(world, rng) {
  ensureSeasonState(world);
  const played = [];
  const finished = [];
  for (const comp of Object.values(world.competitions)) {
    if (!comp || comp.status === 'done') continue;
    const before = comp.status;
    const results = runCompetitionWeek(world, comp, rng);
    played.push(...results);
    if (comp.status === 'done' && before !== 'done') {
      awardPlacementPoints(world, comp);
      recordTitles(world, comp);
      finished.push(comp);
      // Les résultats détaillés ont servi : classements, titres et timeline
      // sont écrits. Les conserver ferait grossir la sauvegarde sans fin.
      comp.results = [];
      comp.rounds = [];
      comp.bracket = null;
      if (comp.tierLevel <= 2) world.competitions[comp.id] = null;
    }
  }
  for (const [id, comp] of Object.entries(world.competitions)) {
    if (comp === null) delete world.competitions[id];
  }
  return { played, finished };
}

function awardPlacementPoints(world, comp) {
  const table = PLACEMENT_POINTS[comp.tierId] ?? PLACEMENT_POINTS.open;
  const entrants = comp.teamIds?.length ?? comp.placements.length;
  for (const { teamId, rank } of comp.placements) {
    const pts = table[rank - 1] ?? 0;
    if (pts > 0) addPoints(world, teamId, comp.gameId, pts);
    // Le classement de la saison, conservé sur l'équipe : la hiérarchie a
    // besoin de savoir où une équipe a fini et à quel niveau elle jouait, et
    // les compétitions terminées sont purgées quelques semaines plus tard.
    const team = world.teams[teamId];
    if (team?.season) {
      (team.season.placements ??= []).push({
        rank,
        entrants,
        tierId: comp.tierId,
        tierLevel: comp.tierLevel,
      });
    }
  }
}

/**
 * Un titre entre dans l'histoire de l'équipe, de l'org et des joueurs.
 *
 * Un tournoi communautaire n'est pas un titre national. La distinction était
 * sans effet tant que le circuit d'entrée ne jouait pas : depuis qu'il joue
 * réellement — une quinzaine d'opens par an et par scène — compter toutes les
 * victoires dans le même compteur faisait passer la moyenne de 1,12 à 14,78
 * titres par carrière, et emportait avec elle le legacy médian (29 → 41) et la
 * part de carrières titrées (22 % → 72 %). Le palmarès conserve donc les
 * titres qui se disputent au niveau national et au-dessus ; les victoires
 * d'entrée sont comptées à part, sans disparaître.
 */
const MAJOR_TITLE_LEVEL = 3;

function recordTitles(world, comp) {
  if (!comp.championId) return;
  const team = world.teams[comp.championId];
  if (!team) return;
  const major = comp.tierLevel >= MAJOR_TITLE_LEVEL;

  if (major) team.titles++;
  else team.minorTitles = (team.minorTitles ?? 0) + 1;
  team.history.push({ week: world.week, text: `Vainqueur de ${comp.name}`, compId: comp.id });
  const org = world.orgs[team.orgId];
  if (org) {
    if (major) org.titles++;
    else org.minorTitles = (org.minorTitles ?? 0) + 1;
    org.reputation = clamp(org.reputation + comp.tierLevel * 1.6, 0, 100);
    org.history.push({ week: world.week, text: `${comp.name} remporté`, compId: comp.id });
  }
  for (const pid of team.roster) {
    const p = world.persons[pid];
    if (!p) continue;
    if (major) p.stats.titles++;
    else p.stats.minorTitles = (p.stats.minorTitles ?? 0) + 1;
    if (comp.tierLevel >= 5) p.stats.internationalTitles++;
    // La réputation ne décroît nulle part dans le moteur : tout gain répété
    // finit donc par saturer l'échelle. Tant qu'aucun tournoi d'entrée n'était
    // joué, la question ne se posait pas ; avec une quinzaine d'opens par an,
    // 1,8 point par victoire suffisait à porter n'importe quel joueur de
    // circuit amateur à 100 de réputation professionnelle. Or gagner un open
    // ne vous fait pas remarquer des professionnels — cela vous fait connaître
    // localement.
    if (major) p.reputation.pros = clamp(p.reputation.pros + comp.tierLevel * 1.8, 0, 100);
    p.reputation.public = clamp(
      p.reputation.public + (major ? comp.tierLevel * 2.2 : 0.6),
      0,
      100,
    );
    p.morale = clamp(p.morale + 12, 0, 100);
  }
  const runner = comp.runnerUpId ? world.teams[comp.runnerUpId] : null;
  if (runner) {
    for (const pid of runner.roster) {
      const p = world.persons[pid];
      if (!p) continue;
      // Même règle que pour les titres, et pour la même raison : une finale
      // d'open perdue n'est pas une finale perdue. Compter les deux ensemble
      // faisait de « l'éternel second » 43 % des carrières — chacun accumulant
      // des dizaines de finales d'entrée pour au plus un vrai titre.
      if (major) p.stats.finals++;
      else p.stats.minorFinals = (p.stats.minorFinals ?? 0) + 1;
    }
  }
}

/**
 * Fin de saison : promotions/relégations, archivage, remise à zéro.
 * L'archivage est aussi ce qui empêche la sauvegarde de grossir sans fin —
 * on ne conserve que les résumés, pas les milliers de matchs joués.
 */
export function endOfSeason(world, rng) {
  const season = yearOf(world.week);
  const archive = [];

  for (const comp of Object.values(world.competitions)) {
    if (!comp) continue;
    if (comp.season !== season) continue;
    // Seules les compétitions qui comptent entrent dans les archives : les
    // milliers de tournois amateurs joués sur quinze ans feraient exploser
    // la taille de sauvegarde sans rien apporter au récit.
    if (comp.tierLevel < 3) continue;
    archive.push({
      id: comp.id,
      name: comp.name,
      gameId: comp.gameId,
      tierId: comp.tierId,
      season,
      championId: comp.championId,
      runnerUpId: comp.runnerUpId,
      placements: comp.placements.slice(0, 4),
      prizePool: comp.prizePool,
    });
  }
  world.seasonArchive.push({ season, competitions: archive });
  if (world.seasonArchive.length > 6) world.seasonArchive.shift();

  // Les joueurs professionnels comptabilisent une saison de plus.
  for (const p of Object.values(world.persons)) {
    if (p.status === 'pro' || p.status === 'semipro') p.stats.seasonsPro++;
  }

  applyPromotionRelegation(world, rng);

  // Purge : on ne garde en mémoire vive que la saison écoulée.
  for (const comp of Object.values(world.competitions)) {
    if (!comp) continue;
    if (comp.season < season) delete world.competitions[comp.id];
    else comp.results = [];
  }

  for (const team of Object.values(world.teams)) {
    team.season = { wins: 0, losses: 0, points: 0, played: 0, mapWins: 0, mapLosses: 0, placements: [] };
  }
}

/**
 * Montées et descentes.
 *
 * La décision appartient à `hierarchy.js` : elle y est prise à l'échelle de la
 * scène, séparément pour la montée et pour la descente, sur des composantes
 * traçables. L'ancienne version faite ici échangeait mécaniquement la pire
 * équipe de ligue contre la meilleure amateur d'une même région, et ne pouvait
 * donc produire ni montée seule, ni descente seule.
 *
 * Le moment ne change pas : après les playoffs, avant `setupSeason`, qui
 * redérivera les divisions des tiers ainsi modifiés.
 */
function applyPromotionRelegation(world, rng) {
  return applyHierarchyChanges(world, rng, { leagueTarget: LEAGUE_SIZE });
}

/** Le calendrier déclenche les bonnes constructions au bon moment. */
export function onWeekStart(world, rng) {
  ensureSeasonState(world);
  const w = weekOfYear(world.week);
  const phase = phaseOfWeek(world.week);

  if (w === 1) setupSeason(world, rng);
  else if (w === 19) setupPlayoffs(world, 1, rng);
  else if (w === 23) setupInternational(world, rng);
  else if (w === 27) setupSplit2(world, rng);
  else if (w === 43) setupPlayoffs(world, 2, rng);
  else if (w === 47) setupWorlds(world, rng);

  // Circuit amateur : un rendez-vous toutes les trois semaines.
  if (w >= 4 && w <= 46 && w % 3 === 1) setupOpenTournament(world, rng);

  return phase;
}

export function onWeekEnd(world, rng) {
  if (weekOfYear(world.week) === 52) endOfSeason(world, rng);
}

export function currentCompetitionsFor(world, teamId) {
  return Object.values(world.competitions).filter(
    (c) => c && c.status !== 'done' && c.teamIds.includes(teamId),
  );
}

export function seasonRankingFor(world, gameId, limit = 20) {
  ensureSeasonState(world);
  const pts = world.seasonPoints[gameId] ?? {};
  return Object.entries(pts)
    .map(([teamId, points]) => ({ teamId, points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}
