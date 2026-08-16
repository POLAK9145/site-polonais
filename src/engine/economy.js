/**
 * Économie des organisations (étape 6).
 *
 * PROBLÈME CORRIGÉ
 * ----------------
 * Les revenus étaient un **accumulateur** :
 *
 *     yearlyIncome *= clamp(0.92 + titres * 0.03 + réputation / 800, 0.7, 1.3)
 *
 * Multiplier une valeur par elle-même chaque année produit une exponentielle,
 * et rien ne la freinait : la réputation d'organisation ne décroissant jamais et
 * saturant à 100, le multiplicateur restait bloqué au-dessus de 1,045 — soit
 * +4,5 % par an au minimum, +13,5 % pour une structure titrée.
 *
 * Face à cela, aucune dépense ne suivait l'économie. Mesuré sur trente ans,
 * monde sans joueur :
 *
 *   an  5 : revenus 158 M | salaires 107 M | fonctionnement 5,8 M | marge +46 M
 *   an 30 : revenus 62 412 M | salaires 29 930 M | fonctionnement 5,8 M | marge +32 476 M
 *
 * Les coûts de fonctionnement (`1200 × tier` par mois) et les dotations étaient
 * des montants **nominaux fixes** : identiques à l'année 5 et à l'année 30, ils
 * représentaient alors 0,009 % des revenus et avaient cessé d'exister comme
 * contrainte. Le budget total passait de 104 M à 117 173 M, mais la médiane ne
 * bougeait pas (206 k → 868 k) : ce n'était pas une inflation, c'était une
 * divergence — le sommet s'échappait, le milieu stagnait, le tier 1 tombait
 * sous zéro.
 *
 * MODÈLE RETENU
 * -------------
 * Les revenus deviennent une **fonction de l'état**, jamais un cumul de leur
 * propre passé : ce que cette organisation vaut, cette année, compte tenu de son
 * niveau, de la scène où elle évolue, de sa notoriété, de ses résultats récents
 * et de l'audience de ses joueurs. Elle s'en approche progressivement — une
 * montée met deux ou trois ans à payer — ce qui autorise croissance, plateau et
 * chute sans qu'aucun plafond arbitraire n'intervienne.
 *
 * Et les charges suivent l'échelle réelle de la structure : le fonctionnement
 * est proportionnel à la masse salariale, pas à un forfait de 1 200.
 */

import { clamp } from './rng.js';
import { GAMES_BY_ID } from '../data/games.js';
import { ORG_TIERS_BY_TIER } from '../data/orgs.js';
import { WEEKS_PER_YEAR } from './time.js';
import { isTracing, trace, TRACE } from './trace.js';

/** Part de la masse salariale consommée par le fonctionnement réel. */
const OVERHEAD_RATE = 0.32;

/**
 * Part des revenus de référence du niveau consacrée aux charges de structure.
 *
 * Le forfait précédent — `1200 × tier` par mois, soit 14 400 par an pour une
 * équipe communautaire — dépassait ce qu'un tier 1 peut gagner au maximum
 * (9 000 × 0,9 = 8 100) : ces structures étaient **insolvables par
 * construction**, quel que soit leur effectif. Une charge de structure doit
 * être une contrainte, pas une impossibilité arithmétique.
 */
const STRUCTURE_RATE = 0.18;

/** Vitesse de convergence annuelle des revenus vers leur cible. */
const INCOME_INERTIA = 0.3;

/** Réserve qu'une organisation cherche à garder, en années de revenus. */
const RESERVE_YEARS = 1;

/** Part de l'excédent réinvestie chaque année au-delà de la réserve. */
const REINVEST_RATE = 0.35;

/** Masse salariale d'une organisation, toutes équipes confondues. */
export function payroll(world, org) {
  let total = 0;
  for (const teamId of Object.values(org.teams ?? {})) {
    const team = world.teams[teamId];
    if (!team?.active) continue;
    for (const id of [...team.roster, ...team.subs]) {
      total += world.persons[id]?.contract?.salary ?? 0;
    }
  }
  return total;
}

/**
 * Coût de fonctionnement annuel : structure, staff, déplacements.
 *
 * Proportionnel à l'échelle de la structure, avec un plancher par niveau pour
 * les petites. Un forfait nominal — ce qu'était `1200 × tier` — cesse d'être
 * une contrainte dès que l'économie grossit.
 */
export function operatingCost(world, org) {
  const floor = tierReferenceIncome(org.tier) * STRUCTURE_RATE;
  return Math.round(floor + payroll(world, org) * OVERHEAD_RATE);
}

/**
 * Revenus de référence d'un niveau : le haut de la fourchette de budget définie
 * pour ce tier. C'est la même donnée qu'à la génération du monde — les charges
 * et les revenus sont ainsi exprimés dans une seule échelle.
 */
export function tierReferenceIncome(tier) {
  const tierDef = ORG_TIERS_BY_TIER[tier] ?? ORG_TIERS_BY_TIER[1];
  return tierDef.budget[1] * 0.9;
}

/**
 * Santé économique de la scène : ce qu'une organisation peut espérer y gagner.
 * Une scène populaire et vivante nourrit ses structures ; une scène en
 * sommeil ne le fait pas, quel que soit le niveau des organisations.
 */
export function sceneEconomy(world, gameId) {
  const gs = world.gameStates[gameId];
  const game = GAMES_BY_ID[gameId];
  if (!gs || !game) return 0.5;
  const popularity = clamp(gs.popularity / 70, 0.15, 1.6);
  const vitality = 0.4 + 0.6 * clamp(gs.vitality ?? 0.5, 0, 1);
  const scale = 0.6 + 0.4 * ((game.prizeScale ?? 1) - 0.5);
  return clamp(popularity * vitality * scale, 0.08, 1.8);
}

/**
 * Combien de structures d'entrée une scène peut-elle nourrir, par région ?
 *
 * Une scène populaire et vivante fait vivre plus de structures qu'une scène en
 * sommeil. Le plancher de deux garantit qu'un circuit d'entrée existe toujours,
 * même sur une scène moribonde — c'est l'acquis de l'étape 2 et il ne doit pas
 * être perdu.
 */
export function sceneTeamCapacity(world, gameId) {
  return Math.max(2, Math.round(2 + sceneEconomy(world, gameId) * 2.2));
}

/**
 * Revenus que cette organisation devrait réaliser cette année.
 *
 * Facteurs nommés et traçables : on doit pouvoir répondre à « pourquoi cette
 * organisation est-elle riche ? » sans deviner.
 */
export function incomeTarget(world, org) {
  const factors = [];
  const add = (key, label, value) => factors.push({ key, label, delta: Math.round(value * 100) / 100 });

  // 1. Le niveau donne l'ordre de grandeur — c'est la donnée qui définit ce
  //    qu'un tier vaut, la même que celle utilisée à la génération du monde.
  const base = tierReferenceIncome(org.tier);
  add('tier', `niveau ${org.tier}`, base);

  // 2. La scène où elle évolue. Une structure de tier 4 sur une scène
  //    moribonde gagne moins qu'une structure de tier 3 sur une scène forte.
  const gameId = Object.keys(org.teams ?? {})[0];
  const scene = gameId ? sceneEconomy(world, gameId) : 0.5;
  add('scene', `santé économique de la scène (×${Math.round(scene * 100) / 100})`, scene);

  // 3. Sa notoriété propre.
  const standing = 0.65 + 0.7 * clamp(org.reputation / 100, 0, 1);
  add('reputation', `réputation ${Math.round(org.reputation)} (×${Math.round(standing * 100) / 100})`, standing);

  // 4. Ses résultats récents, et non son palmarès de toujours : c'est ce qui
  //    permet à des revenus de baisser.
  const recent = recentResults(world, org);
  const form = 0.8 + 0.5 * recent;
  add('results', `résultats récents (×${Math.round(form * 100) / 100})`, form);

  // 5. L'audience de ses joueurs : une organisation qui héberge des vedettes
  //    vend davantage. Rendement décroissant, comme pour l'audience elle-même.
  const reach = audienceReach(world, org);
  const media = 1 + clamp(Math.log10(1 + reach) / 14, 0, 0.45);
  add('audience', `audience cumulée ${Math.round(reach)} (×${Math.round(media * 100) / 100})`, media);

  const target = Math.round(base * scene * standing * form * media);
  return { target, factors, scene, standing, form, media };
}

/** Part de titres récents, sur les trois dernières saisons. */
function recentResults(world, org) {
  const since = world.week - WEEKS_PER_YEAR * 3;
  let recent = 0;
  for (const entry of org.history ?? []) {
    if (entry.week >= since && /remport|Promotion|Montée/i.test(entry.text ?? '')) recent++;
  }
  return clamp(recent / 3, 0, 1);
}

/** Audience cumulée des joueurs de l'organisation. */
function audienceReach(world, org) {
  let total = 0;
  for (const teamId of Object.values(org.teams ?? {})) {
    const team = world.teams[teamId];
    if (!team?.active) continue;
    for (const id of [...team.roster, ...team.subs]) {
      total += world.persons[id]?.followers ?? 0;
    }
  }
  return total;
}

/**
 * Fait vivre l'économie d'une organisation : revenus, charges, résultat.
 *
 * Remplace la croissance composée. Appelé une fois par an ; le flux mensuel
 * (`simulateOrgEconomy`) continue d'appliquer revenus et charges semaine après
 * semaine.
 */
export function updateOrgIncome(world, org, rng) {
  const { target, factors } = incomeTarget(world, org);
  const before = org.yearlyIncome;
  // Convergence progressive : une montée met deux à trois ans à payer, une
  // chute ne ruine pas immédiatement.
  const drift = (target - before) * INCOME_INERTIA;
  const noise = rng ? rng.gauss(0, Math.max(1, target * 0.04)) : 0;
  org.yearlyIncome = Math.max(0, Math.round(before + drift + noise));

  if (isTracing()) {
    trace(TRACE.ECONOMY, world.week, {
      decision: 'income',
      orgId: org.id,
      orgName: org.name,
      tier: org.tier,
      before: Math.round(before),
      target,
      after: org.yearlyIncome,
      factors,
    });
  }
  return org.yearlyIncome;
}

/**
 * Réinvestissement : une organisation ne thésaurise pas indéfiniment.
 *
 * Sans ce flux, il manquait une sortie. Une fois les revenus et les charges
 * réparés, l'agrégat gardait une marge positive d'environ 13 % par an — modeste
 * année après année, mais c'est encore un accumulateur : mesuré à l'année 30,
 * le budget médian d'un tier 5 atteignait 36 M pour une fourchette de niveau
 * définie à [3 M, 9 M], et surtout **plus aucune organisation n'était jamais en
 * difficulté** (`distress > 0` tombait à zéro dès l'année 5). Plus rien ne
 * mourait : le nombre de structures passait de 155 à 213, saturant la population
 * du monde, et les retraités — les premiers oubliés par l'élagage — disparaissaient
 * entièrement (85 → 0).
 *
 * Une organisation réelle dépense son excédent : meilleurs salaires,
 * installations, académie, recrutement. Au-delà d'une année de revenus en
 * réserve, elle réinvestit. Ce n'est pas un plafond — rien n'interdit d'être
 * riche — c'est un flux sortant qui rend la richesse **fragile** : avec une seule
 * année d'avance, une mauvaise saison se paie.
 */
export function reinvest(world, org) {
  const reserve = org.yearlyIncome * RESERVE_YEARS;
  const excess = org.budget - reserve;
  if (excess <= 0) return 0;
  const spent = Math.round(excess * REINVEST_RATE);
  org.budget -= spent;
  if (isTracing()) {
    trace(TRACE.ECONOMY, world.week, {
      decision: 'reinvest',
      orgId: org.id,
      orgName: org.name,
      reserve: Math.round(reserve),
      excess: Math.round(excess),
      spent,
      after: org.budget,
    });
  }
  return spent;
}

/**
 * Explication lisible d'une trace économique (§Z).
 *
 * Doit répondre, sans deviner : pourquoi cette organisation est-elle riche ou
 * pauvre ? pourquoi cette audience monte-t-elle ? pourquoi baisse-t-elle ?
 */
export function explainEconomy(entry) {
  const lines = [];
  if (entry.decision === 'income') {
    const sense = entry.target > entry.before ? 'vers le haut' : 'vers le bas';
    lines.push(
      `S${entry.week} — ${entry.orgName} (niveau ${entry.tier}) : ${entry.before} → ${entry.after}` +
        `, cible ${entry.target} (${sense})`,
    );
    for (const f of entry.factors ?? []) lines.push(`    ${f.label}`);
    return lines.join('\n');
  }
  if (entry.decision === 'followers') {
    lines.push(
      `S${entry.week} — ${entry.personId} gagne ${entry.gained} suiveurs (${entry.reason})` +
        ` — portée brute ${entry.raw}, plafond ${entry.ceiling}, marge restante ${Math.round(entry.room * 100)} %` +
        ` → ${entry.after}`,
    );
    return lines.join('\n');
  }
  if (entry.decision === 'followers_decline') {
    lines.push(
      `S${entry.week} — ${entry.personId} perd ${entry.lost} suiveurs : ${entry.cause}` +
        ` (${entry.before} → ${entry.after}, plafond ${entry.ceiling})`,
    );
    return lines.join('\n');
  }
  return `S${entry.week} — ${entry.decision}`;
}

/** Photographie économique, pour l'audit (§Y). */
export function economySnapshot(world) {
  const orgs = Object.values(world.orgs).filter((o) => o.alive && !o.isSelfOrg);
  const budgets = [];
  const incomes = [];
  const byTier = {};
  const byScene = {};
  let payrollTotal = 0;
  let opsTotal = 0;
  for (const org of orgs) {
    budgets.push(org.budget);
    incomes.push(org.yearlyIncome);
    (byTier[org.tier] ??= []).push(org.budget);
    const gameId = Object.keys(org.teams ?? {})[0];
    if (gameId) (byScene[gameId] ??= []).push(org.yearlyIncome);
    payrollTotal += payroll(world, org);
    opsTotal += operatingCost(world, org);
  }
  return { orgs: orgs.length, budgets, incomes, byTier, byScene, payrollTotal, opsTotal };
}
