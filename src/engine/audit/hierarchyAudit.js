/**
 * Audit de la hiérarchie (étape 3, §17).
 *
 * Mesure la mobilité, la stabilité, les ascensions et les déclins d'un monde
 * sans joueur. Aucune valeur cible n'est visée : on cherche à distinguer un
 * système figé (0 mobilité) d'un système chaotique (tout le monde bouge tous
 * les ans), et à vérifier que les deux régimes coexistent — des dynasties et
 * des ascenseurs dans le même monde.
 *
 * On suit les ORGANISATIONS, car c'est leur tier qui porte le statut dans la
 * hiérarchie ; les équipes vont et viennent, la structure demeure.
 */

import { RNG, normalizeSeed } from '../rng.js';
import { createSession, advanceWorldOnly } from '../simulation.js';
import { validateWorld } from '../validator.js';
import { STATUS } from '../person.js';
import { MAX_TIER, statusForTier } from '../hierarchy.js';
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

/**
 * Vérifie les invariants que la hiérarchie doit préserver (§18).
 * Renvoie une liste de problèmes ; vide si tout est cohérent.
 */
export function hierarchyInvariants(world) {
  const issues = [];
  const push = (code, detail) => {
    if (issues.length < 40) issues.push({ code, detail });
  };

  for (const p of Object.values(world.persons)) {
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    if (!p.teamId) continue;
    const team = world.teams[p.teamId];
    if (!team) {
      push('player_team_missing', `${p.nick} référence une équipe inexistante`);
      continue;
    }
    if (!team.active) push('player_in_inactive_team', `${p.nick} dans une équipe inactive`);
    const org = world.orgs[team.orgId];
    if (!org) {
      push('team_org_missing', `${team.id} référence une organisation inexistante`);
      continue;
    }
    if (org.isSelfOrg) continue;
    if (!org.alive) push('player_in_dead_org', `${p.nick} employé par une organisation morte`);
    const expected = statusForTier(org.tier);
    if (p.status !== expected) {
      push('status_tier_mismatch', `${p.nick} ${p.status} dans une organisation tier ${org.tier}`);
    }
    if (p.contract && !world.orgs[p.contract.orgId]?.alive) {
      push('contract_dead_org', `${p.nick} sous contrat avec une organisation disparue`);
    }
  }

  for (const team of Object.values(world.teams)) {
    if (!team.active) continue;
    if (team.division !== 'league' && team.division !== 'amateur') {
      push('team_no_division', `${team.id} division « ${team.division} »`);
    }
    if (new Set(team.roster).size !== team.roster.length) {
      push('roster_duplicate', `${team.id} contient un doublon`);
    }
    for (const id of team.roster) {
      if (!world.persons[id]) push('roster_ghost', `${team.id} référence ${id}, absent du monde`);
    }
    const org = world.orgs[team.orgId];
    if (org?.alive && org.teams[team.gameId] && org.teams[team.gameId] !== team.id) {
      push('org_team_mismatch', `${org.name} ne reconnaît pas ${team.id} pour ${team.gameId}`);
    }
  }

  for (const org of Object.values(world.orgs)) {
    if (!org.alive) continue;
    if (org.tier < 1 || org.tier > MAX_TIER) push('org_tier_range', `${org.name} tier ${org.tier}`);
    for (const teamId of Object.values(org.teams ?? {})) {
      if (!world.teams[teamId]) push('org_ghost_team', `${org.name} référence ${teamId}, absente`);
    }
  }

  return issues;
}

/**
 * Fait tourner un monde sans joueur et suit la trajectoire de chaque
 * organisation à travers les paliers.
 */
export function runHierarchyAudit({ seed, years = 40, sampleEveryYears = 10 }) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:world`)));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  session.career.retired = true;
  session.career.retiredWeek = session.world.week;
  session.world.persons[session.career.personId].status = STATUS.RETIRED;
  const world = session.world;

  // orgId -> { startTier, tiers: [{tier, fromYear}], up, down, born, died }
  const tracks = new Map();
  const seed0 = (org, year) => {
    tracks.set(org.id, {
      id: org.id,
      name: org.name,
      startTier: org.tier,
      current: org.tier,
      tiers: [{ tier: org.tier, fromYear: year }],
      up: 0,
      down: 0,
      bornYear: year,
      diedYear: null,
      peakTier: org.tier,
      lowTier: org.tier,
    });
  };
  for (const org of Object.values(world.orgs)) {
    if (org.alive && !org.isSelfOrg) seed0(org, 0);
  }

  const perSeason = [];
  const samples = [];
  let crash = null;

  const observe = (year) => {
    let up = 0;
    let down = 0;
    for (const org of Object.values(world.orgs)) {
      if (org.isSelfOrg) continue;
      let t = tracks.get(org.id);
      if (!t) {
        if (!org.alive) continue;
        seed0(org, year);
        continue;
      }
      if (!org.alive) {
        if (t.diedYear === null) t.diedYear = year;
        continue;
      }
      if (org.tier !== t.current) {
        if (org.tier > t.current) {
          t.up++;
          up++;
        } else {
          t.down++;
          down++;
        }
        t.current = org.tier;
        t.peakTier = Math.max(t.peakTier, org.tier);
        t.lowTier = Math.min(t.lowTier, org.tier);
        t.tiers.push({ tier: org.tier, fromYear: year });
      }
    }
    return { up, down };
  };

  try {
    for (let y = 1; y <= years; y++) {
      for (let w = 0; w < WEEKS_PER_YEAR; w++) advanceWorldOnly(session);
      const { up, down } = observe(y);
      perSeason.push({ year: y, promotions: up, relegations: down });
      if (y % sampleEveryYears === 0 || y === years) {
        samples.push({ year: y, ...tierSnapshot(world) });
      }
    }
  } catch (err) {
    crash = { message: err?.message ?? String(err), stack: (err?.stack ?? '').split('\n')[1]?.trim() };
  }

  const all = [...tracks.values()];
  // On ne juge que les organisations ayant réellement eu le temps de vivre.
  const lived = all.filter((t) => (t.diedYear ?? years) - t.bornYear >= 3);

  const changes = lived.map((t) => t.up + t.down).sort((a, b) => a - b);
  const tenures = [];
  for (const t of lived) {
    const end = t.diedYear ?? years;
    for (let i = 0; i < t.tiers.length; i++) {
      const from = t.tiers[i].fromYear;
      const to = i + 1 < t.tiers.length ? t.tiers[i + 1].fromYear : end;
      tenures.push(to - from);
    }
  }
  tenures.sort((a, b) => a - b);

  const climbers = lived.filter((t) => t.peakTier > t.startTier);
  const reachedTop = lived.filter((t) => t.peakTier >= MAX_TIER && t.startTier < MAX_TIER);
  const climbTimes = reachedTop
    .map((t) => {
      const arrival = t.tiers.find((s) => s.tier >= MAX_TIER);
      return arrival ? arrival.fromYear - t.bornYear : null;
    })
    .filter((v) => v !== null)
    .sort((a, b) => a - b);

  const everTop = lived.filter((t) => t.peakTier >= MAX_TIER);
  const leftTop = everTop.filter((t) => t.current < MAX_TIER || t.diedYear !== null);
  const returnedTop = everTop.filter((t) => {
    let left = false;
    for (const s of t.tiers) {
      if (s.tier < MAX_TIER) left = true;
      else if (left) return true;
    }
    return false;
  });
  const diedAfterDecline = everTop.filter((t) => t.diedYear !== null && t.current < t.peakTier);

  return {
    seed,
    years,
    crash,
    perSeason,
    samples,
    mobility: {
      promotionsPerSeason: round(perSeason.reduce((n, s) => n + s.promotions, 0) / Math.max(1, perSeason.length), 2),
      relegationsPerSeason: round(perSeason.reduce((n, s) => n + s.relegations, 0) / Math.max(1, perSeason.length), 2),
      seasonsWithoutMovement: perSeason.filter((s) => s.promotions === 0 && s.relegations === 0).length,
      orgsTracked: lived.length,
      changesMedian: quantile(changes, 0.5),
      changesP90: quantile(changes, 0.9),
      neverMoved: changes.filter((n) => n === 0).length,
      movedFiveOrMore: changes.filter((n) => n >= 5).length,
    },
    stability: {
      tenureMedianYears: quantile(tenures, 0.5),
      tenureP90Years: quantile(tenures, 0.9),
      tenureMaxYears: tenures.length ? tenures[tenures.length - 1] : null,
    },
    ascension: {
      climbers: climbers.length,
      reachedTop: reachedTop.length,
      climbYearsMedian: quantile(climbTimes, 0.5),
      climbYearsMax: climbTimes.length ? climbTimes[climbTimes.length - 1] : null,
    },
    decline: {
      everTop: everTop.length,
      leftTop: leftTop.length,
      returnedToTop: returnedTop.length,
      diedAfterDecline: diedAfterDecline.length,
    },
    invariants: hierarchyInvariants(world),
    issues: validateWorld(world).slice(0, 10),
    // Trajectoires réelles, pour illustrer le rapport sans rien inventer.
    trajectories: pickTrajectories(lived, years),
  };
}

function tierSnapshot(world) {
  const tiers = {};
  let teams = 0;
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.isSelfTeam) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive || org.isSelfOrg) continue;
    tiers[org.tier] = (tiers[org.tier] ?? 0) + 1;
    teams++;
  }
  return { tiers, teams };
}

/** Sélectionne des trajectoires réellement survenues, une par forme. */
function pickTrajectories(lived, years) {
  const label = (t) => t.tiers.map((s) => `${s.tier}@an${s.fromYear}`).join(' → ');
  const out = {};
  // Une même organisation ne doit pas illustrer deux formes à la fois : sans
  // cette exclusion, la plus spectaculaire des ascensions se retrouvait aussi
  // désignée comme l'ascenseur du monde.
  const used = new Set();
  const take = (kind, list, rank, render) => {
    const pick = list.filter((t) => !used.has(t.id)).sort(rank)[0];
    if (!pick) return;
    used.add(pick.id);
    out[kind] = { name: pick.name, path: render(pick) };
  };

  take(
    'ascension',
    lived.filter((t) => t.peakTier - t.startTier >= 2 && t.up > t.down),
    (a, b) => b.peakTier - b.startTier - (a.peakTier - a.startTier),
    label,
  );
  take(
    'decline',
    lived.filter((t) => t.peakTier - t.current >= 2),
    (a, b) => b.peakTier - b.current - (a.peakTier - a.current),
    label,
  );
  take(
    'elevator',
    lived.filter((t) => t.up >= 2 && t.down >= 2),
    (a, b) => b.up + b.down - (a.up + a.down),
    label,
  );
  take(
    'stable',
    lived.filter((t) => t.up + t.down === 0 && (t.diedYear ?? years) - t.bornYear >= 15),
    (a, b) => b.current - a.current,
    (t) => `tier ${t.current} pendant ${(t.diedYear ?? years) - t.bornYear} ans`,
  );
  // Une surprise : née tard, partie du bas, montée haut.
  take(
    'surprise',
    lived.filter((t) => t.bornYear > 2 && t.startTier <= 1 && t.peakTier >= 3),
    (a, b) => b.peakTier - a.peakTier || a.bornYear - b.bornYear,
    (t) => `née an ${t.bornYear} — ${label(t)}`,
  );

  return out;
}
