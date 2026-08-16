/**
 * Audit de la profondeur d'effectif (étape 5, §Q, §R, §P).
 *
 * Suit, semaine par semaine, qui est titulaire et qui est remplaçant, puis en
 * tire les grandeurs demandées : part d'équipes avec un banc, durée passée sur
 * le banc, temps avant promotion ou avant départ, promotions internes contre
 * recrutements externes — et la même chose ventilée par niveau d'organisation.
 *
 * Le module cherche aussi, dans les trajectoires réellement simulées, les cinq
 * formes du §P. Il ne les fabrique pas : il les reconnaît si elles surviennent.
 */

import { RNG, normalizeSeed } from '../rng.js';
import { createSession, advanceWorldOnly } from '../simulation.js';
import { validateWorld } from '../validator.js';
import { STATUS, age as personAge, baseRating } from '../person.js';
import { benchSnapshot, depthPlan } from '../roster.js';
import { GAMES_BY_ID } from '../../data/games.js';
import { WEEKS_PER_YEAR } from '../time.js';
import { randomPlayerConfig } from './runner.js';

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

/** Invariants d'effectif (§O, tests 13 à 15). */
export function rosterInvariants(world) {
  const issues = [];
  const push = (code, detail) => {
    if (issues.length < 40) issues.push({ code, detail });
  };

  for (const team of Object.values(world.teams)) {
    if (!team.active) continue;
    const game = GAMES_BY_ID[team.gameId];
    for (const id of team.roster) {
      if (team.subs.includes(id)) push('starter_and_sub', `${id} est titulaire ET remplaçant dans ${team.id}`);
    }
    if (new Set(team.subs).size !== team.subs.length) push('sub_duplicate', `doublon sur le banc de ${team.id}`);
    if (game && team.roster.length > game.teamSize) {
      push('roster_oversized', `${team.id} : ${team.roster.length} titulaires pour ${game.teamSize} places`);
    }
    for (const id of [...team.roster, ...team.subs]) {
      const p = world.persons[id];
      if (!p) {
        push('member_ghost', `${team.id} référence ${id}, absent du monde`);
        continue;
      }
      if (p.status === STATUS.RETIRED) push('retired_in_roster', `${p.nick} est retraité et dans ${team.id}`);
      if (p.status === STATUS.STAFF) push('staff_in_roster', `${p.nick} est staff et dans ${team.id}`);
      if (p.teamId !== team.id) push('member_team_mismatch', `${p.nick} figure dans ${team.id} mais pointe vers ${p.teamId}`);
    }
  }
  return issues;
}

/**
 * Fait tourner un monde sans joueur et observe les effectifs.
 */
export function runRosterAudit({ seed, years = 20, sampleEveryYears = 10 }) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:world`)));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  session.career.retired = true;
  session.career.retiredWeek = session.world.week;
  session.world.persons[session.career.personId].status = STATUS.RETIRED;
  const world = session.world;

  const flows = {
    benchEntries: 0,
    internalPromotions: 0,
    benchDepartures: 0,
    externalSignings: 0,
    demotions: 0,
  };
  // personId -> état de suivi
  const people = new Map();
  const track = (id) => {
    let t = people.get(id);
    if (!t) {
      t = {
        id,
        everSub: false,
        everStarter: false,
        starterThenSub: false,
        subThenStarter: false,
        benchWeeks: 0,
        spells: [],
        currentSpell: null,
        peak: 0,
        retiredAt: null,
      };
      people.set(id, t);
    }
    return t;
  };

  const snapshots = [];
  let prev = new Map(); // personId -> 'starter' | 'sub'
  let crash = null;

  const roles = () => {
    const m = new Map();
    for (const team of Object.values(world.teams)) {
      if (!team.active || team.isSelfTeam) continue;
      for (const id of team.roster) m.set(id, 'starter');
      for (const id of team.subs) m.set(id, 'sub');
    }
    return m;
  };
  prev = roles();
  for (const [id, role] of prev) {
    const t = track(id);
    if (role === 'sub') {
      t.everSub = true;
      t.currentSpell = { start: world.week };
    } else t.everStarter = true;
  }

  try {
    for (let y = 1; y <= years; y++) {
      for (let w = 0; w < WEEKS_PER_YEAR; w++) {
        advanceWorldOnly(session);
        const now = roles();

        for (const [id, role] of now) {
          const before = prev.get(id);
          const t = track(id);
          if (role === 'sub') {
            t.everSub = true;
            t.benchWeeks++;
            if (before !== 'sub') {
              flows.benchEntries++;
              if (before === 'starter') {
                flows.demotions++;
                t.starterThenSub = true;
              } else {
                flows.externalSignings++;
              }
              t.currentSpell = { start: world.week };
            }
          } else {
            t.everStarter = true;
            if (before === 'sub') {
              flows.internalPromotions++;
              t.subThenStarter = true;
              if (t.currentSpell) {
                t.spells.push({ ...t.currentSpell, end: world.week, outcome: 'promotion' });
                t.currentSpell = null;
              }
            }
          }
          const p = world.persons[id];
          if (p) t.peak = Math.max(t.peak, p.stats.peakRating);
        }
        // Sorties du banc vers l'extérieur.
        for (const [id, role] of prev) {
          if (role !== 'sub' || now.has(id)) continue;
          flows.benchDepartures++;
          const t = track(id);
          if (t.currentSpell) {
            t.spells.push({ ...t.currentSpell, end: world.week, outcome: 'departure' });
            t.currentSpell = null;
          }
        }
        for (const p of Object.values(world.persons)) {
          if (p.status !== STATUS.RETIRED) continue;
          const t = people.get(p.id);
          if (t && t.retiredAt === null) t.retiredAt = personAge(p, world.week);
        }
        prev = now;
      }
      if (y % sampleEveryYears === 0 || y === years) {
        snapshots.push({ year: y, ...describeBench(world) });
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
    bench: summarizePeople(people, years),
    invariants: rosterInvariants(world),
    issues: validateWorld(world).slice(0, 10),
    trajectories: findTrajectories(world, people),
  };
}

/** Photographie des bancs, globale et par niveau (§R). */
function describeBench(world) {
  const snap = benchSnapshot(world);
  const perTier = {};
  for (const [tier, s] of Object.entries(snap.byTier)) {
    const sizes = s.sizes.sort((a, b) => a - b);
    perTier[tier] = {
      teams: s.teams,
      withBench: s.withBench,
      shareWithBench: round(s.withBench / s.teams, 2),
      subs: s.subs,
      mean: round(s.subs / s.teams, 2),
      median: quantile(sizes, 0.5),
      p90: quantile(sizes, 0.9),
    };
  }
  const sizes = snap.all.sizes.sort((a, b) => a - b);
  // Intention déclarée, pour la comparer à la réalité.
  let wanted = 0;
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.isSelfTeam) continue;
    if (!world.orgs[team.orgId]?.alive) continue;
    wanted += depthPlan(world, team).wanted;
  }
  return {
    teams: snap.all.teams,
    withBench: snap.all.withBench,
    shareWithBench: round(snap.all.withBench / Math.max(1, snap.all.teams), 3),
    subs: snap.all.subs,
    mean: round(snap.all.subs / Math.max(1, snap.all.teams), 2),
    median: quantile(sizes, 0.5),
    p90: quantile(sizes, 0.9),
    wanted,
    perTier,
  };
}

function summarizePeople(people, years) {
  const all = [...people.values()];
  const observed = all.filter((t) => t.everSub || t.everStarter);
  const subs = all.filter((t) => t.everSub);
  const promotions = [];
  const departures = [];
  const benchSpells = [];
  for (const t of all) {
    for (const s of t.spells) {
      benchSpells.push(s.end - s.start);
      if (s.outcome === 'promotion') promotions.push(s.end - s.start);
      else departures.push(s.end - s.start);
    }
  }
  benchSpells.sort((a, b) => a - b);
  promotions.sort((a, b) => a - b);
  departures.sort((a, b) => a - b);
  return {
    tracked: observed.length,
    everSub: subs.length,
    shareEverSub: round(subs.length / Math.max(1, observed.length), 3),
    starterThenSub: all.filter((t) => t.starterThenSub).length,
    subThenStarter: all.filter((t) => t.subThenStarter).length,
    shareSubsPromoted: round(
      all.filter((t) => t.subThenStarter).length / Math.max(1, subs.length),
      3,
    ),
    benchWeeksMean: round(
      subs.reduce((n, t) => n + t.benchWeeks, 0) / Math.max(1, subs.length),
      1,
    ),
    spellWeeksMedian: quantile(benchSpells, 0.5),
    spellWeeksP90: quantile(benchSpells, 0.9),
    spellWeeksMax: benchSpells.length ? benchSpells[benchSpells.length - 1] : null,
    weeksBeforePromotionMean: promotions.length
      ? round(promotions.reduce((a, b) => a + b, 0) / promotions.length, 1)
      : null,
    weeksBeforeDepartureMean: departures.length
      ? round(departures.reduce((a, b) => a + b, 0) / departures.length, 1)
      : null,
    years,
  };
}

/** Reconnaît les cinq formes du §P parmi les trajectoires réellement produites. */
function findTrajectories(world, people) {
  const out = {};
  const all = [...people.values()];
  const name = (id) => world.persons[id]?.nick ?? id;
  const used = new Set();
  const take = (kind, list, rank, render) => {
    const pick = list.filter((t) => !used.has(t.id)).sort(rank)[0];
    if (!pick) return;
    used.add(pick.id);
    out[kind] = render(pick);
  };

  // A — jeune remplaçant devenu titulaire, puis fort.
  take(
    'A_banc_vers_titulaire',
    all.filter((t) => t.subThenStarter && t.peak > 70),
    (a, b) => b.peak - a.peak,
    (t) => ({ nick: name(t.id), peak: round(t.peak, 1), benchWeeks: t.benchWeeks }),
  );
  // B — titulaire devenu remplaçant, puis retraité.
  take(
    'B_titulaire_vers_banc_retraite',
    all.filter((t) => t.starterThenSub && t.retiredAt !== null),
    (a, b) => b.peak - a.peak,
    (t) => ({ nick: name(t.id), peak: round(t.peak, 1), retiredAt: round(t.retiredAt, 1) }),
  );
  // C — passé par le banc, parti, redevenu titulaire ailleurs.
  take(
    'C_banc_depart_titulaire_ailleurs',
    all.filter(
      (t) => t.everSub && t.spells.some((s) => s.outcome === 'departure') && t.everStarter,
    ),
    (a, b) => b.benchWeeks - a.benchWeeks,
    (t) => ({ nick: name(t.id), benchWeeks: t.benchWeeks, spells: t.spells.length }),
  );
  // D — titulaire relégué, puis reparti.
  take(
    'D_titulaire_relegue_puis_parti',
    all.filter((t) => t.starterThenSub && t.spells.some((s) => s.outcome === 'departure')),
    (a, b) => b.peak - a.peak,
    (t) => ({ nick: name(t.id), peak: round(t.peak, 1), benchWeeks: t.benchWeeks }),
  );
  // E — long passage sur le banc suivi d'une promotion.
  take(
    'E_banc_long_puis_promotion',
    all.filter((t) => t.spells.some((s) => s.outcome === 'promotion' && s.end - s.start > 52)),
    (a, b) => b.benchWeeks - a.benchWeeks,
    (t) => {
      const spell = t.spells.find((s) => s.outcome === 'promotion' && s.end - s.start > 52);
      return { nick: name(t.id), benchWeeks: spell.end - spell.start, peak: round(t.peak, 1) };
    },
  );
  return out;
}
