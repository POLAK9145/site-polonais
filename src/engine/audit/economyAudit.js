/**
 * Audit de l'économie, de la réputation et de l'audience (étape 6, §Y).
 *
 * Ce module ne mesure pas des accumulateurs, il mesure des **flux** : revenus,
 * salaires, charges, résultat. C'est la seule manière de répondre à la question
 * qui a démasqué le défaut de la version précédente — « les revenus sont-ils une
 * fonction de l'état, ou de leur propre passé ? » Un total de budget qui grossit
 * ne dit rien ; un compte de résultat le dit.
 *
 * La mémoire, elle, ne peut pas être mesurée sur les retraités : l'élagage de
 * population (`MAX_POPULATION`) les oublie **en priorité**, dès le cycle annuel
 * de leur retraite — un monde de trente ans n'en contient jamais un seul.
 * Ce module mesure donc l'oubli sur les joueurs **sans équipe**, dont la
 * réputation glisse par le même chemin de code ; la propriété exacte
 * « une légende reste connue vingt ans après » est vérifiée par un test
 * unitaire déterministe, ce qui est plus fort qu'un échantillon.
 */

import { RNG, normalizeSeed } from '../rng.js';
import { createSession, advanceWorldOnly } from '../simulation.js';
import { STATUS } from '../person.js';
import { WEEKS_PER_YEAR } from '../time.js';
import { payroll, operatingCost, economySnapshot, sceneEconomy } from '../economy.js';
import { audienceCeiling, standingSupport, reputationFloor } from '../reputation.js';
import { randomPlayerConfig } from './runner.js';

function round(v, d = 3) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function quantile(values, q) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return round(s[lo] + (s[hi] - s[lo]) * (i - lo), 2);
}

/** Part des trois premiers dans un total : la concentration (§Y). */
export function topShare(values, n = 3) {
  const positive = values.filter((v) => v > 0);
  const total = positive.reduce((s, v) => s + v, 0);
  if (total <= 0) return 0;
  const top = [...positive].sort((a, b) => b - a).slice(0, n).reduce((s, v) => s + v, 0);
  return round(top / total, 3);
}

/** Invariants économiques (§W, tests 8 à 10). */
export function economyInvariants(world) {
  const issues = [];
  const push = (code, detail) => {
    if (issues.length < 40) issues.push({ code, detail });
  };
  for (const org of Object.values(world.orgs)) {
    if (!org.alive || org.isSelfOrg) continue;
    if (!Number.isFinite(org.budget)) push('budget_not_finite', `${org.name} : ${org.budget}`);
    if (!Number.isFinite(org.yearlyIncome)) push('income_not_finite', `${org.name} : ${org.yearlyIncome}`);
    if (org.yearlyIncome < 0) push('income_negative', `${org.name} : ${org.yearlyIncome}`);
    if (org.reputation < 0 || org.reputation > 100) push('org_rep_range', `${org.name} : ${org.reputation}`);
  }
  for (const p of Object.values(world.persons)) {
    if (!Number.isFinite(p.followers)) push('followers_not_finite', `${p.nick} : ${p.followers}`);
    if (p.followers < 0) push('followers_negative', `${p.nick} : ${p.followers}`);
    // Le plafond est la promesse centrale du §K : aucun chemin ne doit le
    // dépasser durablement. On tolère l'année en cours (le plafond peut avoir
    // baissé et le retour s'étale), pas un facteur deux.
    const ceiling = audienceCeiling(p);
    if (p.followers > ceiling * 2) {
      push('audience_over_ceiling', `${p.nick} : ${Math.round(p.followers)} pour un plafond de ${Math.round(ceiling)}`);
    }
    for (const kind of ['pros', 'public', 'community', 'media', 'toxicity']) {
      const v = p.reputation[kind];
      if (!(v >= 0 && v <= 100)) push('rep_range', `${p.nick}.${kind} = ${v}`);
    }
  }
  return issues;
}

/**
 * Fait tourner un monde sans joueur et relève l'économie, la réputation et
 * l'audience année par année.
 */
export function runEconomyAudit({ seed, years = 30, sampleEveryYears = 5 }) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:world`)));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  session.career.retired = true;
  session.career.retiredWeek = session.world.week;
  session.world.persons[session.career.personId].status = STATUS.RETIRED;
  const world = session.world;

  const samples = [];
  // Pics d'audience atteints, pour juger de la rareté des vedettes.
  const peaks = new Map();
  let crash = null;
  let dissolved = 0;
  const orgsSeen = new Set(Object.keys(world.orgs));

  try {
    for (let year = 1; year <= years; year++) {
      const flow = { income: 0, payroll: 0, ops: 0, months: 0 };
      for (let w = 0; w < WEEKS_PER_YEAR; w++) {
        advanceWorldOnly(session);
        for (const p of Object.values(world.persons)) {
          const f = p.followers ?? 0;
          if (f > (peaks.get(p.id) ?? 0)) peaks.set(p.id, f);
        }
        if (world.week % 4 !== 0) continue;
        flow.months++;
        for (const org of Object.values(world.orgs)) {
          if (!org.alive || org.isSelfOrg) continue;
          flow.income += org.yearlyIncome / 12;
          flow.payroll += payroll(world, org) / 12;
          flow.ops += operatingCost(world, org) / 12;
        }
      }
      for (const id of Object.keys(world.orgs)) orgsSeen.add(id);
      dissolved = [...orgsSeen].filter((id) => world.orgs[id] && !world.orgs[id].alive).length;
      if (year % sampleEveryYears !== 0 && year !== years && year !== 1) continue;
      samples.push({ year, ...measure(world, flow) });
    }
  } catch (err) {
    crash = { message: err?.message ?? String(err), stack: (err?.stack ?? '').split('\n')[1]?.trim() };
  }

  return {
    seed,
    years,
    crash,
    samples,
    forgotten: forgottenByPalmares(world),
    peaks: [...peaks.values()],
    dissolved,
    invariants: economyInvariants(world).map((i) => i.code),
    invariantDetails: economyInvariants(world).slice(0, 10),
    world,
  };
}

/**
 * Oubli mesuré sur les joueurs sans équipe, groupés par palmarès.
 *
 * C'est la question du §E : un ancien champion reste-t-il connu quand il ne joue
 * plus, et un anonyme est-il oublié ?
 */
export function forgottenByPalmares(world) {
  const groups = { titled: [], finalist: [], anonymous: [] };
  for (const p of Object.values(world.persons)) {
    if (p.status === STATUS.STAFF || p.teamId) continue;
    const key = p.stats.titles > 0 ? 'titled' : p.stats.finals > 0 ? 'finalist' : 'anonymous';
    groups[key].push({ pros: p.reputation.pros, followers: p.followers ?? 0, floor: reputationFloor(p).pros });
  }
  const out = {};
  for (const [key, values] of Object.entries(groups)) {
    out[key] = {
      n: values.length,
      prosMedian: quantile(values.map((v) => v.pros), 0.5),
      followersMedian: quantile(values.map((v) => v.followers), 0.5),
      floorMedian: quantile(values.map((v) => v.floor), 0.5),
    };
  }
  return out;
}

/** Un relevé complet : richesse, réputation, audience, concentration. */
export function measure(world, flow = null) {
  const econ = economySnapshot(world);
  const budgets = econ.budgets;
  const perTier = {};
  for (const [tier, values] of Object.entries(econ.byTier)) {
    perTier[tier] = {
      n: values.length,
      median: quantile(values, 0.5),
      p90: quantile(values, 0.9),
      negatives: values.filter((v) => v < 0).length,
    };
  }
  const perScene = {};
  for (const [gameId, values] of Object.entries(econ.byScene)) {
    perScene[gameId] = {
      n: values.length,
      median: quantile(values, 0.5),
      health: round(sceneEconomy(world, gameId), 2),
    };
  }

  const pros = [];
  const audienceActive = [];
  const audienceAll = [];
  const supports = [];
  for (const p of Object.values(world.persons)) {
    if (p.status === STATUS.STAFF) continue;
    audienceAll.push(p.followers ?? 0);
    if (p.status === STATUS.PRO || p.status === STATUS.SEMIPRO) {
      pros.push(p.reputation.pros);
      audienceActive.push(p.followers ?? 0);
      supports.push(standingSupport(world, p));
    }
  }

  const audienceByTier = {};
  for (const p of Object.values(world.persons)) {
    if (p.status !== STATUS.PRO && p.status !== STATUS.SEMIPRO) continue;
    const team = p.teamId ? world.teams[p.teamId] : null;
    const org = team ? world.orgs[team.orgId] : null;
    (audienceByTier[org?.tier ?? 0] ??= []).push(p.followers ?? 0);
  }
  const perTierAudience = {};
  for (const [tier, values] of Object.entries(audienceByTier)) {
    perTierAudience[tier] = { n: values.length, median: quantile(values, 0.5), p90: quantile(values, 0.9) };
  }

  return {
    orgs: econ.orgs,
    wealth: {
      total: budgets.reduce((s, b) => s + b, 0),
      median: quantile(budgets, 0.5),
      p90: quantile(budgets, 0.9),
      max: budgets.length ? Math.max(...budgets) : 0,
      negatives: budgets.filter((b) => b < 0).length,
      perTier,
      perScene,
    },
    flow: flow
      ? {
          income: Math.round(flow.income),
          payroll: Math.round(flow.payroll),
          ops: Math.round(flow.ops),
          result: Math.round(flow.income - flow.payroll - flow.ops),
        }
      : null,
    reputation: {
      n: pros.length,
      median: quantile(pros, 0.5),
      p90: quantile(pros, 0.9),
      max: pros.length ? Math.max(...pros) : 0,
      saturated: pros.filter((r) => r >= 99.5).length,
      supportMedian: quantile(supports, 0.5),
    },
    audience: {
      median: quantile(audienceActive, 0.5),
      p90: quantile(audienceActive, 0.9),
      max: audienceActive.length ? Math.max(...audienceActive) : 0,
      zeros: audienceAll.filter((f) => f <= 0).length,
      total: audienceAll.reduce((s, f) => s + f, 0),
      perTier: perTierAudience,
    },
    concentration: {
      revenue: topShare(econ.incomes),
      wealth: topShare(budgets),
      audience: topShare(audienceAll),
    },
  };
}
