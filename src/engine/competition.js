/**
 * Compétitions (§25).
 *
 * Deux formats génériques suffisent à couvrir toute la pyramide :
 *  - LIGUE  : round-robin, points, classement (saisons régulières) ;
 *  - BRACKET: élimination directe avec seeding (playoffs, opens, mondiaux).
 *
 * Les tiers vont du tournoi communautaire au championnat du monde et
 * portent l'enjeu (`stakes`), qui alimente la pression dans le simulateur
 * de match et l'impact médiatique du résultat.
 */

import { clamp } from './rng.js';
import { simulateMatch } from './match.js';
import { GAMES_BY_ID } from '../data/games.js';

export const COMP_TIERS = {
  OPEN: { id: 'open', label: 'Tournoi communautaire', stakes: 0.12, prize: 1200, level: 1 },
  QUALIFIER: { id: 'qualifier', label: 'Qualification', stakes: 0.3, prize: 4000, level: 2 },
  NATIONAL: { id: 'national', label: 'Ligue nationale', stakes: 0.4, prize: 30000, level: 3 },
  REGIONAL: { id: 'regional', label: 'Ligue régionale', stakes: 0.55, prize: 180000, level: 4 },
  INTERNATIONAL: { id: 'international', label: 'Tournoi international', stakes: 0.8, prize: 900000, level: 5 },
  WORLDS: { id: 'worlds', label: 'Championnat du monde', stakes: 1.0, prize: 2400000, level: 6 },
};

export const TIER_ORDER = ['open', 'qualifier', 'national', 'regional', 'international', 'worlds'];

let compCounter = 0;
export function resetCompCounter() {
  compCounter = 0;
}

export function createCompetition(world, opts) {
  const {
    name,
    gameId,
    tierId,
    regionId = null,
    teamIds,
    kind,
    startWeek,
    weeksAvailable,
    format = 3,
    season,
  } = opts;
  const tier = COMP_TIERS[tierId.toUpperCase()] ?? COMP_TIERS.OPEN;
  const gameState = world.gameStates[gameId];
  const prizePool = Math.round(
    tier.prize * (GAMES_BY_ID[gameId]?.prizeScale ?? 1) * (gameState?.prizeMultiplier ?? 1),
  );

  const comp = {
    id: `c${++compCounter}`,
    name,
    gameId,
    tierId: tier.id,
    tierLevel: tier.level,
    stakes: tier.stakes,
    regionId,
    season,
    kind,
    teamIds: [...teamIds],
    rounds: [],
    bracket: null,
    standings: {},
    prizePool,
    status: 'scheduled',
    startWeek,
    results: [],
    championId: null,
    runnerUpId: null,
    placements: [],
    format,
  };

  for (const id of teamIds) {
    comp.standings[id] = { wins: 0, losses: 0, points: 0, mapWins: 0, mapLosses: 0 };
  }

  if (kind === 'league') {
    comp.rounds = buildLeagueSchedule(teamIds, startWeek, weeksAvailable, format, tier.stakes);
  } else {
    comp.bracket = buildBracket(teamIds, startWeek, format, tier.stakes);
  }
  return comp;
}

/**
 * Round-robin par la méthode du cercle. Si la fenêtre le permet, on joue
 * deux tours (aller-retour) — c'est ce qui donne des saisons régulières
 * assez longues pour que la forme et les blessures de calendrier comptent.
 */
export function buildLeagueSchedule(teamIds, startWeek, weeksAvailable, format, stakes) {
  const teams = [...teamIds];
  if (teams.length % 2 === 1) teams.push(null); // bye
  const n = teams.length;
  const roundsPerCycle = n - 1;
  const cycles = weeksAvailable >= roundsPerCycle * 2 ? 2 : 1;

  const rounds = [];
  let arr = [...teams];
  for (let cycle = 0; cycle < cycles; cycle++) {
    arr = [...teams];
    for (let r = 0; r < roundsPerCycle; r++) {
      const week = startWeek + rounds.length;
      const matches = [];
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i];
        const b = arr[n - 1 - i];
        if (a === null || b === null) continue;
        // Au retour, on inverse pour équilibrer.
        matches.push({
          aId: cycle === 0 ? a : b,
          bId: cycle === 0 ? b : a,
          format,
          stakes,
          round: `J${rounds.length + 1}`,
          played: false,
        });
      }
      rounds.push({ week, matches });
      // Rotation : le premier reste fixe.
      arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
    }
  }
  return rounds;
}

/**
 * Bracket à élimination directe, avec byes pour les mieux classés.
 * `weekStride` à 0 fait tenir tout le tableau dans une seule semaine —
 * c'est le cas des tournois communautaires du week-end.
 */
export function buildBracket(teamIds, startWeek, format, stakes, weekStride = 1) {
  const n = teamIds.length;
  if (n < 2) return { rounds: [], startWeek };
  const size = Math.pow(2, Math.ceil(Math.log2(n)));
  const seeds = [...teamIds];
  while (seeds.length < size) seeds.push(null); // byes en fin de tableau

  const ordered = seedOrder(size).map((i) => seeds[i - 1] ?? null);

  const rounds = [];
  let current = ordered;
  let roundIndex = 0;
  while (current.length > 1) {
    const matches = [];
    for (let i = 0; i < current.length; i += 2) {
      matches.push({
        aId: current[i],
        bId: current[i + 1],
        format: roundIndex >= Math.log2(size) - 2 ? Math.max(format, 5) : format,
        stakes: stakes * (0.8 + 0.2 * (roundIndex + 1) / Math.log2(size)),
        round: roundName(current.length),
        played: false,
        winnerId: null,
      });
    }
    rounds.push({ week: startWeek + roundIndex * weekStride, matches });
    current = new Array(matches.length).fill(null);
    roundIndex++;
  }
  return { rounds, startWeek };
}

function roundName(remaining) {
  if (remaining === 2) return 'Finale';
  if (remaining === 4) return 'Demi-finale';
  if (remaining === 8) return 'Quart de finale';
  if (remaining === 16) return 'Huitième de finale';
  return `Tour à ${remaining}`;
}

/** Ordre de seeding standard : 1 affronte le dernier, etc. */
function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const next = [];
    const total = order.length * 2 + 1;
    for (const s of order) {
      next.push(s, total - s);
    }
    order = next;
  }
  return order;
}

/** Joue tous les matchs d'une compétition prévus pour cette semaine. */
export function runCompetitionWeek(world, comp, rng) {
  if (comp.status === 'done') return [];
  const gameState = world.gameStates[comp.gameId];
  const played = [];

  if (comp.kind === 'league') {
    const round = comp.rounds.find((r) => r.week === world.week);
    if (!round) return [];
    comp.status = 'running';
    for (const m of round.matches) {
      if (m.played) continue;
      const teamA = world.teams[m.aId];
      const teamB = world.teams[m.bId];
      if (!validMatchup(teamA, teamB)) {
        m.played = true;
        continue;
      }
      const result = simulateMatch(world, {
        teamA,
        teamB,
        gameState,
        format: m.format,
        stakes: m.stakes,
        label: `${comp.name} — ${m.round}`,
        competitionId: comp.id,
        round: m.round,
        preparedA: preparation(world, teamA),
        preparedB: preparation(world, teamB),
      }, rng);
      m.played = true;
      m.resultId = result;
      applyStandings(comp, result);
      comp.results.push(result);
      played.push(result);
    }
    const allPlayed = comp.rounds.every((r) => r.matches.every((m) => m.played));
    if (allPlayed) finishLeague(world, comp);
  } else {
    // Plusieurs tours peuvent tomber la même semaine (tournoi d'un week-end).
    // On les traite dans l'ordre : chaque tour remplit le suivant.
    const rounds = comp.bracket.rounds.filter((r) => r.week === world.week);
    if (rounds.length === 0) return [];
    comp.status = 'running';
    for (const round of rounds) {
      playBracketRound(world, comp, round, gameState, played, rng);
    }
    const last = comp.bracket.rounds[comp.bracket.rounds.length - 1];
    if (last.matches.every((m) => m.played)) {
      finishBracket(world, comp, last);
    }
  }
  return played;
}

function playBracketRound(world, comp, round, gameState, played, rng) {
  for (const m of round.matches) {
      if (m.played) continue;
      const teamA = m.aId ? world.teams[m.aId] : null;
      const teamB = m.bId ? world.teams[m.bId] : null;
      // Bye : qualification automatique.
      if (!validMatchup(teamA, teamB)) {
        m.played = true;
        m.winnerId = validTeam(teamA) ? teamA.id : validTeam(teamB) ? teamB.id : null;
        advanceWinner(comp, round, m);
        continue;
      }
      const result = simulateMatch(world, {
        teamA,
        teamB,
        gameState,
        format: m.format,
        stakes: m.stakes,
        label: `${comp.name} — ${m.round}`,
        competitionId: comp.id,
        round: m.round,
        preparedA: preparation(world, teamA),
        preparedB: preparation(world, teamB),
      }, rng);
      m.played = true;
      m.winnerId = result.winnerId;
      m.resultId = result;
      applyStandings(comp, result);
      comp.results.push(result);
      played.push(result);
    advanceWinner(comp, round, m);
    recordElimination(comp, m, result);
  }
}

function validTeam(t) {
  return !!t && t.active && t.roster.length > 0;
}

function validMatchup(a, b) {
  return validTeam(a) && validTeam(b) && a.id !== b.id;
}

/** Une équipe qui gagne monte au tour suivant, à la bonne position. */
function advanceWinner(comp, round, match) {
  const roundIdx = comp.bracket.rounds.indexOf(round);
  const nextRound = comp.bracket.rounds[roundIdx + 1];
  if (!nextRound) return;
  const matchIdx = round.matches.indexOf(match);
  const target = nextRound.matches[Math.floor(matchIdx / 2)];
  if (!target) return;
  if (matchIdx % 2 === 0) target.aId = match.winnerId;
  else target.bId = match.winnerId;
}

function recordElimination(comp, match, result) {
  comp.placements.push({ teamId: result.loserId, round: match.round });
}

function applyStandings(comp, result) {
  const a = comp.standings[result.teamAId];
  const b = comp.standings[result.teamBId];
  if (a) {
    a.mapWins += result.scoreA;
    a.mapLosses += result.scoreB;
    if (result.winnerId === result.teamAId) {
      a.wins++;
      a.points += 3;
    } else a.losses++;
  }
  if (b) {
    b.mapWins += result.scoreB;
    b.mapLosses += result.scoreA;
    if (result.winnerId === result.teamBId) {
      b.wins++;
      b.points += 3;
    } else b.losses++;
  }
}

export function sortedStandings(comp) {
  return Object.entries(comp.standings)
    .map(([teamId, s]) => ({ teamId, ...s, mapDiff: s.mapWins - s.mapLosses }))
    .sort((x, y) => y.points - x.points || y.mapDiff - x.mapDiff || y.mapWins - x.mapWins);
}

function finishLeague(world, comp) {
  comp.status = 'done';
  const table = sortedStandings(comp);
  comp.placements = table.map((t, i) => ({ teamId: t.teamId, rank: i + 1 }));
  comp.championId = table[0]?.teamId ?? null;
  comp.runnerUpId = table[1]?.teamId ?? null;
  distributePrizes(world, comp, table.map((t) => t.teamId));
}

function finishBracket(world, comp, finalRound) {
  comp.status = 'done';
  const final = finalRound.matches[0];
  comp.championId = final?.winnerId ?? null;
  const finalResult = comp.results[comp.results.length - 1];
  comp.runnerUpId = finalResult ? finalResult.loserId : null;

  // Classement : champion, finaliste, puis ordre inverse d'élimination.
  const ordered = [comp.championId, comp.runnerUpId].filter(Boolean);
  const eliminated = [...comp.placements].reverse();
  for (const e of eliminated) {
    if (!ordered.includes(e.teamId)) ordered.push(e.teamId);
  }
  comp.placements = ordered.map((teamId, i) => ({ teamId, rank: i + 1 }));
  distributePrizes(world, comp, ordered);
}

/**
 * Répartition des gains. Une part va à l'organisation, le reste est
 * partagé entre les joueurs : c'est ce qui permet à un amateur de vivre
 * quelques mois sur un bon tournoi (§19).
 */
export function distributePrizes(world, comp, orderedTeamIds) {
  const shares = [0.42, 0.24, 0.13, 0.08, 0.05, 0.035, 0.025, 0.02];
  orderedTeamIds.forEach((teamId, i) => {
    const share = shares[i] ?? 0;
    if (share <= 0) return;
    const amount = Math.round(comp.prizePool * share);
    const team = world.teams[teamId];
    if (!team) return;
    const org = world.orgs[team.orgId];
    const orgCut = org && org.tier > 1 ? 0.5 : 0.15;
    if (org) org.budget += Math.round(amount * orgCut);
    const playerPot = Math.round(amount * (1 - orgCut));
    const players = team.roster.map((id) => world.persons[id]).filter(Boolean);
    if (players.length === 0) return;
    const each = Math.round(playerPot / players.length);
    for (const p of players) {
      p.stats.earnings += each;
      if (p.isPlayer) world.pendingPlayerIncome.push({ label: `Prize money — ${comp.name}`, amount: each });
    }
  });
}

/** Bonus de préparation : dépend du staff et du professionnalisme du roster. */
function preparation(world, team) {
  if (!team) return 0;
  const players = team.roster.map((id) => world.persons[id]).filter(Boolean);
  if (players.length === 0) return 0;
  const pro = players.reduce((s, p) => s + p.attrs.professionalism, 0) / players.length;
  return clamp((pro - 45) / 90, -0.3, 0.7);
}

export function competitionLabel(comp) {
  return comp.name;
}

export function isTeamInCompetition(comp, teamId) {
  return comp.teamIds.includes(teamId);
}
