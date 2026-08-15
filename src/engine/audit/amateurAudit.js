/**
 * Audit de l'écosystème d'entrée (étape 2, §5, §8, §11, §12).
 *
 * Ce module n'ajoute aucune règle : il fait tourner un monde sans joueur et
 * observe, semaine par semaine, les flux du bas de la pyramide — créations,
 * dissolutions, recrutements, départs, temps passé sans équipe, passages du
 * circuit amateur au niveau professionnel.
 *
 * Deux principes de mesure :
 *
 *  - On mesure des FLUX, pas seulement des états. Un circuit amateur stable à
 *    trois équipes peut aussi bien être vivant (créations et dissolutions qui
 *    s'équilibrent) que mort (les trois mêmes équipes depuis vingt ans). Seuls
 *    les compteurs de mouvement distinguent les deux cas.
 *
 *  - On rend la distribution PAR SCÈNE, jamais la moyenne seule : une moyenne
 *    de trois équipes amateurs peut cacher deux scènes à zéro et une à neuf.
 */

import { RNG, normalizeSeed } from '../rng.js';
import { GAMES } from '../../data/games.js';
import { createSession, advanceWorldOnly } from '../simulation.js';
import { validateWorld } from '../validator.js';
import { STATUS, age as personAge } from '../person.js';
import { canSustainLeague } from '../amateur.js';
import { WEEKS_PER_YEAR } from '../time.js';
import { randomPlayerConfig } from './runner.js';

/** Une équipe appartient-elle au circuit d'entrée ? */
function isAmateurTeam(world, team) {
  if (!team.active || team.isSelfTeam) return false;
  const org = world.orgs[team.orgId];
  return !!org?.alive && !canSustainLeague(org);
}

function activePlayer(p) {
  return p.status !== STATUS.RETIRED && p.status !== STATUS.STAFF;
}

/** État instantané d'une scène, du point de vue du bas de la pyramide. */
function sceneSnapshot(world, gameId, unattachedWeeks) {
  const s = {
    gameId,
    alive: !!world.gameStates[gameId]?.alive,
    leagueTeams: 0,
    amateurTeams: 0,
    amateurPlayers: 0,
    unattached: 0,
    unattachedAgeSum: 0,
    unattachedWeeksSum: 0,
    pros: 0,
    population: 0,
  };
  for (const team of Object.values(world.teams)) {
    if (team.gameId !== gameId || !team.active || team.isSelfTeam) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive) continue;
    if (canSustainLeague(org)) s.leagueTeams++;
    else {
      s.amateurTeams++;
      s.amateurPlayers += team.roster.length;
    }
  }
  for (const p of Object.values(world.persons)) {
    if (p.gameId !== gameId || !activePlayer(p)) continue;
    s.population++;
    if (p.status === STATUS.PRO) s.pros++;
    if (!p.teamId) {
      s.unattached++;
      s.unattachedAgeSum += personAge(p, world.week);
      s.unattachedWeeksSum += unattachedWeeks.get(p.id) ?? 0;
    }
  }
  s.unattachedAgeMean = s.unattached > 0 ? round(s.unattachedAgeSum / s.unattached, 1) : null;
  s.unattachedWeeksMean = s.unattached > 0 ? round(s.unattachedWeeksSum / s.unattached, 1) : null;
  delete s.unattachedAgeSum;
  delete s.unattachedWeeksSum;
  return s;
}

/**
 * Accumulateur annuel par scène.
 *
 * Mesurer l'écosystème d'entrée à un instant donné induit en erreur : la
 * dissolution des équipes en échec a lieu en semaine 51, et la formation ne
 * peut répondre qu'à la revue suivante. Un relevé pris à la frontière d'année
 * tombe donc systématiquement dans le creux — c'est ainsi qu'une scène mesurée
 * à « 0 équipe amateur » en comptait en réalité une à trois la majeure partie
 * de l'année. On accumule donc semaine par semaine.
 */
function newYearAccumulator() {
  const acc = {};
  for (const game of GAMES) {
    acc[game.id] = { weeks: 0, amSum: 0, amMin: Infinity, amMax: 0, unSum: 0, unMax: 0 };
  }
  return acc;
}

function accumulateWeek(world, acc) {
  const amateur = {};
  const unattached = {};
  for (const team of Object.values(world.teams)) {
    if (!isAmateurTeam(world, team)) continue;
    amateur[team.gameId] = (amateur[team.gameId] ?? 0) + 1;
  }
  for (const p of Object.values(world.persons)) {
    if (!activePlayer(p) || p.teamId) continue;
    unattached[p.gameId] = (unattached[p.gameId] ?? 0) + 1;
  }
  for (const game of GAMES) {
    if (!world.gameStates[game.id]?.alive) continue;
    const a = acc[game.id];
    const am = amateur[game.id] ?? 0;
    const un = unattached[game.id] ?? 0;
    a.weeks++;
    a.amSum += am;
    a.amMin = Math.min(a.amMin, am);
    a.amMax = Math.max(a.amMax, am);
    a.unSum += un;
    a.unMax = Math.max(a.unMax, un);
  }
}

function summarizeYear(acc, gameId) {
  const a = acc[gameId];
  if (!a || a.weeks === 0) return { weeks: 0 };
  return {
    weeks: a.weeks,
    amateurMean: round(a.amSum / a.weeks, 1),
    amateurMin: a.amMin === Infinity ? 0 : a.amMin,
    amateurMax: a.amMax,
    unattachedMean: round(a.unSum / a.weeks, 1),
    unattachedMax: a.unMax,
  };
}

function round(v, d = 2) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo), 2);
}

/**
 * Fait tourner un monde sans joueur et suit l'écosystème d'entrée.
 *
 * `cohortYears` : années d'entrée pour lesquelles on suit précisément le
 * devenir des nouveaux venus (§9 — « un nouveau joueur a-t-il un chemin à
 * l'année 1, 10, 20, 30 ? »).
 */
export function runAmateurAudit({
  seed,
  years = 40,
  sampleEveryYears = 5,
  cohortYears = [1, 10, 20, 30],
  collectWorld = false,
}) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:world`)));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  // Le monde tourne seul, par le même chemin de code qu'après une fin de
  // carrière : aucune décision de joueur n'entre dans ces mesures.
  session.career.retired = true;
  session.career.retiredWeek = session.world.week;
  session.world.persons[session.career.personId].status = STATUS.RETIRED;
  const world = session.world;

  const flows = {
    amateurTeamsCreated: 0,
    amateurTeamsDissolved: 0,
    joinsAmateur: 0,
    departuresAmateur: 0,
    amateurToLeague: 0,
    amateurToPro: 0,
  };
  const snapshots = [];
  // Durée de vie des équipes amateurs dissoutes, en semaines.
  const amateurLifespans = [];
  // Suivi des cohortes : première équipe obtenue, ou jamais.
  const cohortSet = new Set(cohortYears);
  const cohorts = new Map(cohortYears.map((y) => [y, []]));

  let prevAmateur = new Map(); // teamId -> Set(personId)
  let prevAmateurByPerson = new Map(); // personId -> teamId
  const unattachedWeeks = new Map(); // personId -> semaines consécutives sans équipe
  const seen = new Set(Object.keys(world.persons));
  let crash = null;

  const scan = () => {
    const next = new Map();
    const nextByPerson = new Map();
    for (const team of Object.values(world.teams)) {
      if (!isAmateurTeam(world, team)) continue;
      const roster = new Set(team.roster);
      next.set(team.id, roster);
      for (const id of roster) nextByPerson.set(id, team.id);
    }
    for (const [id] of next) {
      if (!prevAmateur.has(id)) flows.amateurTeamsCreated++;
    }
    for (const [id, roster] of prevAmateur) {
      if (next.has(id)) continue;
      const team = world.teams[id];
      // Une équipe qui disparaît de l'ensemble amateur a soit été dissoute,
      // soit promue : la distinction compte, c'est la différence entre un
      // échec et une réussite.
      if (team?.active && canSustainLeague(world.orgs[team.orgId])) {
        flows.amateurToLeague++;
      } else {
        flows.amateurTeamsDissolved++;
        if (team) amateurLifespans.push(world.week - team.created);
        flows.departuresAmateur += roster.size;
      }
    }
    for (const [personId, teamId] of nextByPerson) {
      if (prevAmateurByPerson.get(personId) !== teamId) flows.joinsAmateur++;
    }
    for (const [personId, teamId] of prevAmateurByPerson) {
      if (nextByPerson.has(personId)) continue;
      if (!world.teams[teamId] || !prevAmateur.has(teamId)) continue;
      // Départ individuel d'une équipe qui, elle, existe toujours : les
      // rosters d'une équipe dissoute ont déjà été comptés plus haut.
      if (!next.has(teamId)) continue;
      flows.departuresAmateur++;
      const p = world.persons[personId];
      if (p?.teamId && p.teamId !== teamId) {
        const dest = world.teams[p.teamId];
        if (dest && canSustainLeague(world.orgs[dest.orgId])) flows.amateurToPro++;
      }
    }
    prevAmateur = next;
    prevAmateurByPerson = nextByPerson;
  };

  const trackPeople = (yearIndex) => {
    for (const p of Object.values(world.persons)) {
      if (!activePlayer(p)) continue;
      // On tient ce compteur à côté du monde, jamais dedans : un module
      // d'observation ne doit rien ajouter à l'état simulé.
      if (p.teamId) unattachedWeeks.set(p.id, 0);
      else unattachedWeeks.set(p.id, (unattachedWeeks.get(p.id) ?? 0) + 1);
      if (!seen.has(p.id)) {
        seen.add(p.id);
        if (cohortSet.has(yearIndex)) {
          cohorts.get(yearIndex).push({
            id: p.id,
            bornWeek: world.week,
            firstTeamWeek: p.teamId ? world.week : null,
          });
        }
      }
    }
    for (const list of cohorts.values()) {
      for (const entry of list) {
        if (entry.firstTeamWeek !== null) continue;
        const p = world.persons[entry.id];
        if (!p) {
          entry.gone = true;
          continue;
        }
        if (p.teamId) entry.firstTeamWeek = world.week;
      }
    }
  };

  scan();
  snapshots.push({
    year: 0,
    scenes: GAMES.map((g) => sceneSnapshot(world, g.id, unattachedWeeks)),
  });

  try {
    for (let y = 1; y <= years; y++) {
      const acc = newYearAccumulator();
      for (let w = 0; w < WEEKS_PER_YEAR; w++) {
        advanceWorldOnly(session);
        scan();
        trackPeople(y);
        accumulateWeek(world, acc);
      }
      if (y % sampleEveryYears === 0 || y === years) {
        snapshots.push({
          year: y,
          scenes: GAMES.map((g) => ({
            ...sceneSnapshot(world, g.id, unattachedWeeks),
            ...summarizeYear(acc, g.id),
          })),
        });
      }
    }
  } catch (err) {
    crash = { message: err?.message ?? String(err), stack: (err?.stack ?? '').split('\n')[1]?.trim() };
  }

  return {
    seed,
    years,
    crash,
    flows,
    snapshots,
    amateurLifespanYears: summarizeLifespans(amateurLifespans),
    cohorts: summarizeCohorts(cohorts, years),
    population: populationBreakdown(world),
    accessibility: accessibility(world),
    issues: validateWorld(world).slice(0, 20),
    // Le monde lui-même n'est rendu que sur demande : les tests en ont besoin
    // pour inspecter les rosters, un rapport JSON n'en veut surtout pas.
    world: collectWorld ? world : null,
  };
}

function summarizeLifespans(weeks) {
  if (weeks.length === 0) return { count: 0 };
  const years = weeks.map((w) => round(w / WEEKS_PER_YEAR, 2)).sort((a, b) => a - b);
  return {
    count: years.length,
    p10: quantile(years, 0.1),
    median: quantile(years, 0.5),
    p90: quantile(years, 0.9),
    max: years[years.length - 1],
  };
}

function summarizeCohorts(cohorts, years) {
  const out = {};
  for (const [year, list] of cohorts) {
    if (list.length === 0) {
      out[year] = { size: 0, followUpYears: Math.max(0, years - year) };
      continue;
    }
    const delays = list
      .filter((e) => e.firstTeamWeek !== null)
      .map((e) => e.firstTeamWeek - e.bornWeek)
      .sort((a, b) => a - b);
    out[year] = {
      size: list.length,
      // Durée d'observation restante : une cohorte suivie moins de trois ans ne
      // permet aucune conclusion — « jamais » y signifie surtout « pas encore ».
      followUpYears: Math.max(0, years - year),
      foundTeam: delays.length,
      foundTeamPct: round((delays.length / list.length) * 100, 1),
      medianWeeks: quantile(delays, 0.5),
      p90Weeks: quantile(delays, 0.9),
      immediatePct: round((delays.filter((d) => d === 0).length / list.length) * 100, 1),
      overOneYearPct: round((delays.filter((d) => d > WEEKS_PER_YEAR).length / list.length) * 100, 1),
      neverPct: round(((list.length - delays.length) / list.length) * 100, 1),
    };
  }
  return out;
}

function populationBreakdown(world) {
  const out = { total: 0, rostered: 0, unattached: 0, staff: 0, retired: 0 };
  for (const p of Object.values(world.persons)) {
    out.total++;
    if (p.status === STATUS.RETIRED) out.retired++;
    else if (p.status === STATUS.STAFF) out.staff++;
    else if (p.teamId) out.rostered++;
    else out.unattached++;
  }
  return out;
}

/**
 * Accessibilité du bas de la pyramide (§12).
 *
 * Mesure volontairement descriptive, à NE PAS maximiser : parmi les joueurs de
 * moins de 21 ans présents dans la scène, quelle proportion est effectivement
 * dans une équipe ? 100 % signifierait qu'il n'y a plus de compétition à
 * l'entrée ; 0 % qu'il n'y a pas de porte du tout.
 */
export function accessibility(world) {
  const out = {};
  for (const game of GAMES) {
    let young = 0;
    let placed = 0;
    for (const p of Object.values(world.persons)) {
      if (p.gameId !== game.id || !activePlayer(p)) continue;
      if (personAge(p, world.week) >= 21) continue;
      young++;
      if (p.teamId) placed++;
    }
    out[game.id] = {
      young,
      placed,
      rate: young > 0 ? round(placed / young, 3) : null,
    };
  }
  return out;
}
