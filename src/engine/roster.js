/**
 * Profondeur d'effectif : titulaires et remplaçants (étape 5).
 *
 * PROBLÈME CORRIGÉ
 * ----------------
 * Le banc n'était pas rare, il était structurellement impossible. Mesuré sur
 * vingt ans et ~150 équipes : **0 à 1 équipe** avec un remplaçant, le plus
 * grand banc jamais observé comptant **un** joueur. Sept verrous, dont deux
 * décisifs :
 *
 *  - `signPlayer` **licenciait au lieu de reléguer** : effectif plein, offre de
 *    titulaire, et le maillon faible était renvoyé. Le moment même où un banc
 *    devrait naître était converti en licenciement ;
 *  - `buildOffer` étiquetait « remplaçant » à l'envers — une offre n'était
 *    `sub` que si la recrue valait *moins* que le plus faible titulaire, soit
 *    l'inverse de la raison pour laquelle une organisation signe une doublure ;
 *  - `asSub: true` n'était passé par aucun appelant ;
 *  - `fillEmptyRosters` vidait les bancs en FIFO sans jamais en créer ;
 *  - rien, nulle part, ne décidait qu'une organisation *devrait* porter plus de
 *    joueurs que la taille du jeu ;
 *  - l'événement `benched` exigeait qu'un banc existe déjà pour se déclencher.
 *
 * MODÈLE RETENU
 * -------------
 * Deux rôles seulement — titulaire, remplaçant — et une **profondeur voulue**
 * par organisation, dérivée de ce qui existe déjà : niveau, moyens rapportés au
 * barème maison, ambition, vieillissement de l'effectif, fragilité du groupe.
 * Le banc n'est jamais obligatoire (§T) : c'est une décision d'investissement,
 * et une structure sans raison d'en avoir n'en a pas.
 *
 * « Académie » n'est pas un troisième système : c'est une conséquence
 * observable — un banc jeune à fort potentiel — et non une catégorie.
 */

import { clamp } from './rng.js';
import { GAMES_BY_ID } from '../data/games.js';
import { STATUS, age as personAge, baseRating, weightedCeiling } from './person.js';
import { salaryBand } from './org.js';
import { LEAGUE_CAPABLE_TIER } from './amateur.js';
import { WEEKS_PER_YEAR } from './time.js';
import { isTracing, trace, TRACE } from './trace.js';

/** Nombre maximal de remplaçants qu'une organisation peut porter. */
export const MAX_BENCH = 3;

/** Écart de niveau à franchir pour déloger un titulaire installé. */
const ROTATION_MARGIN = 4;

/** Semaines de domination requises avant qu'une rotation soit actée. */
const ROTATION_PATIENCE = 3;

/**
 * Profondeur que cette organisation souhaite porter, en remplaçants.
 *
 * Facteurs nommés et traçables. Le résultat est une intention, pas une
 * obligation : le marché décide ensuite si elle est réalisable.
 */
export function depthPlan(world, team) {
  const org = world.orgs[team.orgId];
  const game = GAMES_BY_ID[team.gameId];
  if (!org?.alive || !game || team.isSelfTeam) return { wanted: 0, factors: [], score: 0 };

  // Les équipes d'entrée sont hors sujet (§K) : exiger de la profondeur d'elles
  // recréerait exactement la barrière que l'étape 2 a fait tomber.
  if (org.tier < LEAGUE_CAPABLE_TIER) {
    return { wanted: 0, factors: [{ key: 'grassroots', label: 'structure d’entrée', delta: 0 }], score: 0 };
  }

  const factors = [];
  const add = (key, label, delta) => {
    if (delta !== 0) factors.push({ key, label, delta: Math.round(delta * 10) / 10 });
  };

  // 1. Le niveau. Une structure établie a des raisons d'anticiper.
  add('tier', `niveau ${org.tier}`, (org.tier - 2) * 9);

  // 2. Les moyens, rapportés à ce qu'un joueur coûte chez elle — jamais à une
  //    somme absolue (les budgets de ce moteur croissent sans borne, §V).
  const band = salaryBand(org, game);
  const payroll = team.roster.reduce(
    (n, id) => n + (world.persons[id]?.contract?.salary ?? 0),
    0,
  );
  const headroom = band.typical > 0 ? (org.yearlyIncome - payroll) / band.typical : 0;
  add('means', `${Math.round(headroom * 10) / 10} salaire(s) de marge sur les revenus`, clamp(headroom * 14, -25, 26));

  // 3. L'ambition de la structure.
  add('ambition', 'ambition de la structure', ((org.ambition ?? 0.5) - 0.5) * 30);

  // 4. Un effectif vieillissant prépare sa succession.
  const ages = team.roster.map((id) => world.persons[id]).filter(Boolean).map((p) => personAge(p, world.week));
  if (ages.length) {
    const oldest = Math.max(...ages);
    if (oldest >= 28) add('succession', `titulaire de ${Math.round(oldest)} ans`, clamp((oldest - 27) * 6, 0, 20));
  }

  // 5. Un groupe irrégulier a besoin d'une solution de repli.
  const forms = team.roster.map((id) => world.persons[id]).filter(Boolean).map((p) => Math.abs(p.form ?? 0));
  if (forms.length) {
    const volatility = forms.reduce((a, b) => a + b, 0) / forms.length;
    if (volatility > 6) add('volatility', 'effectif irrégulier', clamp((volatility - 6) * 2.5, 0, 12));
  }

  // 6. Une montée récente pousse à se renforcer.
  const sinceTier = world.week - (org.lastTierChangeWeek ?? -Infinity);
  if (sinceTier < WEEKS_PER_YEAR) add('promoted', 'changement de niveau récent', 10);

  const score = factors.reduce((n, f) => n + f.delta, 0);
  // Un banc ne s'impose jamais : il se mérite par un faisceau de raisons.
  // Les seuils sont calés sur ce que le marché peut réellement fournir : avec
  // une barre à 26, 86 équipes déclaraient vouloir de la profondeur pour une
  // dizaine de places effectivement pourvues — une intention que le monde ne
  // tenait pas. Ils font aussi de la profondeur un privilège de haut de
  // tableau, sans imposer de relation linéaire au niveau (§R).
  let wanted = 0;
  if (score >= 40) wanted = 1;
  if (score >= 70) wanted = 2;
  if (score >= 95) wanted = 3;
  return { wanted: Math.min(wanted, MAX_BENCH), factors, score };
}

/** Places de banc encore à pourvoir dans cette équipe. */
export function benchSlots(world, team) {
  const plan = depthPlan(world, team);
  return Math.max(0, plan.wanted - team.subs.length);
}

/**
 * L'organisation a-t-elle intérêt à reléguer son maillon faible plutôt qu'à
 * le licencier ? C'est la correction décisive : sans elle, aucun banc ne peut
 * naître d'un recrutement.
 */
export function prefersBenchOverRelease(world, team, displacedId) {
  const plan = depthPlan(world, team);
  if (plan.wanted <= 0) return false;
  if (team.subs.length >= plan.wanted) return false;
  const person = world.persons[displacedId];
  if (!person) return false;
  const org = world.orgs[team.orgId];
  // Garder quelqu'un coûte son salaire : on ne conserve pas ce qu'on ne peut
  // pas payer.
  const salary = person.contract?.salary ?? 0;
  return org.yearlyIncome > salary * 1.2 || org.budget > salary * 2;
}

/**
 * Rotation titulaires / remplaçants.
 *
 * Avec inertie (§E) : un titulaire installé ne perd pas sa place pour un point
 * d'écart, ni pour une semaine. Il faut un écart net, maintenu plusieurs
 * relevés d'affilée. À l'inverse, un titulaire qui s'effondre ou qui vieillit
 * mal peut être devancé par un jeune qui monte.
 */
export function runRotation(world, rng, { every = 4 } = {}) {
  if (world.week % every !== 0) return [];
  const changes = [];

  for (const team of Object.values(world.teams)) {
    if (!team.active || team.isSelfTeam || team.subs.length === 0) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive) continue;
    const game = GAMES_BY_ID[team.gameId];
    if (!game) continue;

    const rate = (id) => {
      const p = world.persons[id];
      return p ? baseRating(p, game) : -Infinity;
    };
    const starters = team.roster.filter((id) => world.persons[id]);
    if (starters.length === 0) continue;

    let weakestId = starters[0];
    for (const id of starters) if (rate(id) < rate(weakestId)) weakestId = id;
    let bestSubId = team.subs[0];
    for (const id of team.subs) if (rate(id) > rate(bestSubId)) bestSubId = id;
    if (!world.persons[bestSubId] || !world.persons[weakestId]) continue;

    const gap = rate(bestSubId) - rate(weakestId);
    team.rotationPressure ??= {};
    if (gap > ROTATION_MARGIN) {
      team.rotationPressure[bestSubId] = (team.rotationPressure[bestSubId] ?? 0) + 1;
    } else {
      team.rotationPressure = {};
      continue;
    }
    if ((team.rotationPressure[bestSubId] ?? 0) < ROTATION_PATIENCE) continue;

    const sub = world.persons[bestSubId];
    const starter = world.persons[weakestId];
    const factors = [
      { key: 'gap', label: `niveau ${Math.round(rate(bestSubId))} contre ${Math.round(rate(weakestId))}`, delta: Math.round(gap * 10) / 10 },
      { key: 'patience', label: `écart maintenu ${ROTATION_PATIENCE} relevés`, delta: ROTATION_PATIENCE },
    ];
    const starterAge = personAge(starter, world.week);
    if (starterAge >= 28) factors.push({ key: 'age', label: `titulaire de ${Math.round(starterAge)} ans`, delta: 4 });
    const subCeiling = weightedCeiling(sub, game);
    if (personAge(sub, world.week) < 22 && subCeiling > rate(bestSubId) + 8) {
      factors.push({ key: 'potential', label: 'jeune remplaçant en progression', delta: 5 });
    }

    swapRoles(team, weakestId, bestSubId);
    team.rotationPressure = {};
    starter.benchedSince = world.week;
    sub.benchedSince = null;
    sub.startsSince = world.week;
    changes.push({ teamId: team.id, promoted: bestSubId, benched: weakestId });

    if (isTracing()) {
      trace(TRACE.ROSTER, world.week, {
        decision: 'rotation',
        teamId: team.id,
        orgName: org.name,
        promoted: sub.nick,
        promotedId: sub.id,
        benched: starter.nick,
        benchedId: starter.id,
        factors,
      });
    }
  }
  return changes;
}

/** Échange les rôles de deux membres du même effectif. */
export function swapRoles(team, starterId, subId) {
  const i = team.roster.indexOf(starterId);
  const j = team.subs.indexOf(subId);
  if (i < 0 || j < 0) return false;
  team.roster[i] = subId;
  team.subs[j] = starterId;
  return true;
}

/** Le meilleur remplaçant disponible, pour combler une place de titulaire. */
export function bestSubFor(world, team) {
  const game = GAMES_BY_ID[team.gameId];
  let best = null;
  let bestRating = -Infinity;
  for (const id of team.subs) {
    const p = world.persons[id];
    if (!p || p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    const r = baseRating(p, game);
    if (r > bestRating) {
      bestRating = r;
      best = id;
    }
  }
  return best;
}

/**
 * Facteur de progression lié au temps de jeu (§J).
 *
 * Un remplaçant apprend moins vite qu'un titulaire — il s'entraîne autant mais
 * ne joue pas — sans être condamné à stagner : la marge reste largement
 * suffisante pour qu'un jeune banc progresse et finisse par prendre la place.
 */
export function playingTimeFactor(world, person) {
  if (!person.teamId) return 0.82;
  const team = world.teams[person.teamId];
  if (!team) return 0.82;
  if (team.subs.includes(person.id)) return 0.78;
  return 1;
}

/** Photographie du banc, par niveau d'organisation (§Q, §R). */
export function benchSnapshot(world) {
  const byTier = {};
  const all = { teams: 0, withBench: 0, subs: 0, sizes: [] };
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.isSelfTeam) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive || org.isSelfOrg) continue;
    const tier = org.tier;
    const slot = (byTier[tier] ??= { teams: 0, withBench: 0, subs: 0, sizes: [] });
    slot.teams++;
    all.teams++;
    slot.sizes.push(team.subs.length);
    all.sizes.push(team.subs.length);
    if (team.subs.length > 0) {
      slot.withBench++;
      all.withBench++;
      slot.subs += team.subs.length;
      all.subs += team.subs.length;
    }
  }
  return { byTier, all };
}
