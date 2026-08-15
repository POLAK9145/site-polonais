/**
 * Audit du marché et des carrières de PNJ (étape 4, §N et §S).
 *
 * Distingue soigneusement ce qui compte comme mouvement. Un compteur naïf sur
 * `teamId` mélange trois choses très différentes : un transfert entre deux
 * structures établies, la première signature d'un agent libre, et la formation
 * d'une équipe amateur — laquelle place cinq joueurs d'un coup et gonflait à
 * elle seule le total à plus de deux cents « mouvements » par an.
 *
 * On mesure donc séparément :
 *   - les transferts (d'une équipe vers une autre) ;
 *   - les entrées depuis le vivier ;
 *   - les sorties vers le vivier (fin de contrat, licenciement, dissolution) ;
 *   - les changements de scène.
 */

import { RNG, normalizeSeed } from '../rng.js';
import { createSession, advanceWorldOnly } from '../simulation.js';
import { validateWorld } from '../validator.js';
import { STATUS, age as personAge } from '../person.js';
import { contractSnapshot, contractPhase, CONTRACT_PHASES } from '../contracts.js';
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
 * Invariants du cycle de vie contractuel (§O, tests 12 à 14).
 * Vide si tout est cohérent.
 */
export function contractInvariants(world) {
  const issues = [];
  const push = (code, detail) => {
    if (issues.length < 40) issues.push({ code, detail });
  };

  for (const p of Object.values(world.persons)) {
    const c = p.contract;
    if (!c) continue;
    if (p.status === STATUS.RETIRED) push('retired_with_contract', `${p.nick} est retraité et sous contrat`);
    if (contractPhase(p, world.week) === CONTRACT_PHASES.EXPIRED) {
      push('expired_still_active', `${p.nick} : contrat échu depuis ${world.week - c.endWeek} semaines`);
    }
    const org = world.orgs[c.orgId];
    if (!org) push('contract_ghost_org', `${p.nick} : organisation ${c.orgId} inexistante`);
    else if (!org.alive) push('contract_dead_org', `${p.nick} employé par une organisation morte`);
    if (c.teamId) {
      const team = world.teams[c.teamId];
      if (!team) push('contract_ghost_team', `${p.nick} : équipe ${c.teamId} inexistante`);
      else if (p.teamId && p.teamId !== c.teamId) {
        push('contract_team_mismatch', `${p.nick} joue en ${p.teamId} sous un contrat ${c.teamId}`);
      }
    }
    // Un seul contrat par personne, par construction du modèle : on vérifie
    // qu'aucune équipe ne le revendique en plus de la sienne.
    let claims = 0;
    for (const team of Object.values(world.teams)) {
      if (!team.active) continue;
      if (team.roster.includes(p.id) || team.subs.includes(p.id)) claims++;
    }
    if (claims > 1) push('multiple_rosters', `${p.nick} figure dans ${claims} effectifs`);
  }

  for (const org of Object.values(world.orgs)) {
    if (org.alive) continue;
    for (const p of Object.values(world.persons)) {
      if (p.contract?.orgId === org.id) push('dead_org_employee', `${org.name} (morte) emploie ${p.nick}`);
      if (p.orgId === org.id) push('dead_org_member', `${p.nick} rattaché à ${org.name} (morte)`);
    }
  }
  return issues;
}

/**
 * Fait tourner un monde sans joueur et suit les carrières de PNJ.
 * `sample` : nombre de PNJ suivis individuellement du début à la fin.
 */
export function runMarketAudit({ seed, years = 20, sample = 120 }) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:world`)));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  session.career.retired = true;
  session.career.retiredWeek = session.world.week;
  session.world.persons[session.career.personId].status = STATUS.RETIRED;
  const world = session.world;

  const flows = {
    transfers: 0,
    signedFromPool: 0,
    releasedToPool: 0,
    sceneChanges: 0,
    renewals: 0,
    retirements: 0,
  };

  const tracked = new Map();
  for (const p of Object.values(world.persons)) {
    if (p.isPlayer || p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    if (tracked.size >= sample) break;
    tracked.set(p.id, {
      id: p.id,
      nick: p.nick,
      teams: new Set(p.teamId ? [p.teamId] : []),
      orgs: new Set(p.orgId ? [p.orgId] : []),
      games: new Set([p.gameId]),
      transfers: 0,
      spells: [],
      startedWeek: world.week,
      retiredWeek: null,
      retiredAge: null,
      poolWeeks: 0,
      history: [],
    });
  }

  const prevTeam = new Map();
  const prevGame = new Map();
  const prevRenewals = new Map();
  const prevStatus = new Map();
  const poolSince = new Map();
  const poolDurations = [];
  for (const p of Object.values(world.persons)) {
    prevTeam.set(p.id, p.teamId ?? null);
    prevGame.set(p.id, p.gameId);
    prevRenewals.set(p.id, p.contract?.renewals ?? 0);
    prevStatus.set(p.id, p.status);
  }

  let crash = null;
  const perYear = [];

  try {
    for (let y = 1; y <= years; y++) {
      const start = { ...flows };
      for (let w = 0; w < WEEKS_PER_YEAR; w++) {
        advanceWorldOnly(session);
        observe(world, flows, { prevTeam, prevGame, prevRenewals, prevStatus, poolSince, poolDurations, tracked });
      }
      perYear.push({
        year: y,
        transfers: flows.transfers - start.transfers,
        signedFromPool: flows.signedFromPool - start.signedFromPool,
        releasedToPool: flows.releasedToPool - start.releasedToPool,
        renewals: flows.renewals - start.renewals,
        sceneChanges: flows.sceneChanges - start.sceneChanges,
      });
    }
  } catch (err) {
    crash = { message: err?.message ?? String(err), stack: (err?.stack ?? '').split('\n')[1]?.trim() };
  }

  return {
    seed,
    years,
    crash,
    flows,
    perYear,
    market: marketVivacity(flows, poolDurations, years, world),
    npc: summarizeTracked(tracked, years),
    contracts: summarizeContracts(world),
    invariants: contractInvariants(world),
    issues: validateWorld(world).slice(0, 10),
    trajectories: pickCareers(tracked, world),
  };
}

function observe(world, flows, ctx) {
  const { prevTeam, prevGame, prevRenewals, prevStatus, poolSince, poolDurations, tracked } = ctx;
  for (const p of Object.values(world.persons)) {
    const before = prevTeam.get(p.id);
    const now = p.teamId ?? null;
    if (before !== undefined && before !== now) {
      if (before && now) flows.transfers++;
      else if (now) {
        flows.signedFromPool++;
        const since = poolSince.get(p.id);
        if (since !== undefined) {
          poolDurations.push(world.week - since);
          poolSince.delete(p.id);
        }
      } else {
        flows.releasedToPool++;
        poolSince.set(p.id, world.week);
      }
    }
    prevTeam.set(p.id, now);

    const gameBefore = prevGame.get(p.id);
    if (gameBefore !== undefined && gameBefore !== p.gameId) flows.sceneChanges++;
    prevGame.set(p.id, p.gameId);

    const renewalsBefore = prevRenewals.get(p.id) ?? 0;
    const renewalsNow = p.contract?.renewals ?? 0;
    if (renewalsNow > renewalsBefore) flows.renewals += renewalsNow - renewalsBefore;
    prevRenewals.set(p.id, renewalsNow);

    const statusBefore = prevStatus.get(p.id);
    if (statusBefore !== STATUS.RETIRED && p.status === STATUS.RETIRED) flows.retirements++;
    prevStatus.set(p.id, p.status);

    const t = tracked.get(p.id);
    if (t) {
      if (now) {
        t.teams.add(now);
        if (before && before !== now) t.transfers++;
      } else {
        t.poolWeeks++;
      }
      if (p.orgId) t.orgs.add(p.orgId);
      t.games.add(p.gameId);
      if (p.status === STATUS.RETIRED && t.retiredWeek === null) {
        t.retiredWeek = world.week;
        t.retiredAge = personAge(p, world.week);
      }
      if (gameBefore !== undefined && gameBefore !== p.gameId) {
        t.history.push({ week: world.week, kind: 'scene', from: gameBefore, to: p.gameId });
      }
      if (before !== now && now) {
        const org = world.orgs[world.teams[now]?.orgId];
        t.history.push({ week: world.week, kind: 'join', org: org?.name ?? '?', tier: org?.tier ?? null });
      }
    }
  }
}

/** Vivacité du marché (§S) : ni mort, ni hystérique. */
function marketVivacity(flows, poolDurations, years, world) {
  const rostered = Object.values(world.persons).filter(
    (p) => p.teamId && p.status !== STATUS.RETIRED && p.status !== STATUS.STAFF,
  ).length;
  const durations = poolDurations.slice().sort((a, b) => a - b);
  return {
    rostered,
    transfersPerSeason: round(flows.transfers / years, 1),
    // Part de l'effectif mondial qui change de structure chaque année : c'est
    // le nombre à surveiller. Zéro = marché mort, proche de 1 = hystérie.
    turnover: rostered > 0 ? round(flows.transfers / years / rostered, 3) : null,
    signingsPerSeason: round(flows.signedFromPool / years, 1),
    releasesPerSeason: round(flows.releasedToPool / years, 1),
    renewalsPerSeason: round(flows.renewals / years, 1),
    sceneChangesPerSeason: round(flows.sceneChanges / years, 2),
    retirementsPerSeason: round(flows.retirements / years, 1),
    poolWeeksMedian: quantile(durations, 0.5),
    poolWeeksP90: quantile(durations, 0.9),
  };
}

function summarizeTracked(tracked, years) {
  const all = [...tracked.values()];
  if (all.length === 0) return { sample: 0 };
  const teams = all.map((t) => t.teams.size).sort((a, b) => a - b);
  const orgs = all.map((t) => t.orgs.size).sort((a, b) => a - b);
  const games = all.map((t) => t.games.size).sort((a, b) => a - b);
  const moves = all.map((t) => t.transfers).sort((a, b) => a - b);
  const retiredAges = all.filter((t) => t.retiredAge !== null).map((t) => t.retiredAge).sort((a, b) => a - b);
  return {
    sample: all.length,
    teamsMedian: quantile(teams, 0.5),
    teamsMean: round(teams.reduce((a, b) => a + b, 0) / all.length, 2),
    teamsP90: quantile(teams, 0.9),
    teamsMax: teams[teams.length - 1],
    orgsMedian: quantile(orgs, 0.5),
    orgsP90: quantile(orgs, 0.9),
    gamesMedian: quantile(games, 0.5),
    changedGame: games.filter((n) => n > 1).length,
    neverMoved: moves.filter((n) => n === 0).length,
    movedOnce: moves.filter((n) => n === 1).length,
    movedThreePlus: moves.filter((n) => n >= 3).length,
    retired: retiredAges.length,
    retirementAgeMedian: quantile(retiredAges, 0.5),
    retirementAgeP10: quantile(retiredAges, 0.1),
    retirementAgeP90: quantile(retiredAges, 0.9),
    poolWeeksMedian: quantile(all.map((t) => t.poolWeeks).sort((a, b) => a - b), 0.5),
  };
}

function summarizeContracts(world) {
  const snap = contractSnapshot(world);
  const durations = snap.durationsYears.sort((a, b) => a - b);
  return {
    contracts: snap.contracts,
    active: snap.active,
    expiring: snap.expiring,
    expired: snap.expired,
    renewedEver: snap.renewedEver,
    freeAgents: snap.freeAgents,
    durationMedianYears: quantile(durations, 0.5),
    durationP90Years: quantile(durations, 0.9),
  };
}

/** Deux carrières réellement simulées, aussi différentes que possible (§critère). */
function pickCareers(tracked, world) {
  const all = [...tracked.values()];
  const render = (t) => ({
    nick: t.nick,
    teams: t.teams.size,
    orgs: t.orgs.size,
    games: t.games.size,
    transfers: t.transfers,
    retiredAge: t.retiredAge ? round(t.retiredAge, 1) : null,
    path: t.history
      .slice(0, 10)
      .map((h) => (h.kind === 'scene' ? `→ ${h.to}` : `${h.org}${h.tier ? ` (T${h.tier})` : ''}`))
      .join(' · '),
  });
  const out = {};
  const loyal = all.filter((t) => t.transfers === 0 && t.teams.size === 1).sort((a, b) => b.poolWeeks - a.poolWeeks)[0];
  if (loyal) out.fidele = render(loyal);
  const nomad = [...all].sort((a, b) => b.transfers - a.transfers)[0];
  if (nomad) out.nomade = render(nomad);
  const switcher = all.filter((t) => t.games.size > 1).sort((a, b) => b.teams.size - a.teams.size)[0];
  if (switcher) out.reconverti = render(switcher);
  const drifter = all.filter((t) => t.poolWeeks > 200).sort((a, b) => b.poolWeeks - a.poolWeeks)[0];
  if (drifter) out.oublie = render(drifter);
  return out;
}
