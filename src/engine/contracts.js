/**
 * Cycle de vie des contrats (étape 4).
 *
 * PROBLÈME CORRIGÉ
 * ----------------
 * `endWeek` était écrit à la signature et **jamais relu comme terminaison**.
 * Aucun chemin de code ne mettait fin à un contrat arrivé à son terme : les
 * deux seuls endroits qui consultaient cette date en tiraient un bonus
 * d'intérêt (`evaluateInterest`) ou d'acceptation (`npcAcceptsOffer`).
 *
 * Mesuré sur vingt ans, sans joueur :
 *
 *  - 228 contrats sur 287 (**79 %**) étaient échus tout en restant actifs,
 *    avec un dépassement médian de **4 ans** et un maximum de 14,5 ans ;
 *  - la durée signée médiane était d'un an — autrement dit, presque tous les
 *    contrats du monde étaient des fantômes ;
 *  - aucun renouvellement n'existait, aucun licenciement sportif ou
 *    économique, et la fin de contrat ne produisait donc jamais le signal de
 *    marché qui rend un joueur disponible.
 *
 * MODÈLE RETENU
 * -------------
 * Un contrat traverse trois états observables — actif, en fin de contrat,
 * échu — et son échéance **provoque une décision** : l'organisation propose
 * ou non une prolongation, le joueur accepte ou tente le marché. Les deux
 * décisions sont construites en facteurs nommés et traçables, comme les
 * dossiers de la hiérarchie.
 *
 * DÉPENDANCE AUX BUDGETS (§U)
 * ---------------------------
 * Les budgets d'organisation croissent sans borne dans le moteur actuel
 * (jusqu'à 179 M à vingt ans). Ce module s'appuie sur `salaryBand`, qui en
 * dérive — mais **jamais sur sa valeur absolue** : les décisions comparent un
 * salaire à la fourchette de sa propre organisation, et une prolongation ne
 * peut pas dépasser un multiple du salaire courant. Une inflation générale des
 * budgets déplace donc toute l'échelle sans dérégler les arbitrages.
 */

import { clamp } from './rng.js';
import { GAMES_BY_ID } from '../data/games.js';
import { STATUS, age as personAge, baseRating, weightedCeiling, mods } from './person.js';
import { salaryBand } from './org.js';
import { isMajorTransferWindow, WEEKS_PER_YEAR, yearOf } from './time.js';
import { releasePlayer } from './transfers.js';
import { isTracing, trace, TRACE } from './trace.js';

/** États observables d'un contrat. */
export const CONTRACT_PHASES = {
  ACTIVE: 'active',
  EXPIRING: 'expiring',
  EXPIRED: 'expired',
};

/** Fenêtre pendant laquelle une fin de contrat est déjà « en cours ». */
export const EXPIRING_WEEKS = 10;

export function contractPhase(person, week) {
  const c = person?.contract;
  if (!c) return null;
  if (c.endWeek <= week) return CONTRACT_PHASES.EXPIRED;
  if (c.endWeek - week <= EXPIRING_WEEKS) return CONTRACT_PHASES.EXPIRING;
  return CONTRACT_PHASES.ACTIVE;
}

/** Le contrat doit-il être arbitré lors de cette intersaison ? */
function isDue(person, week) {
  const phase = contractPhase(person, week);
  return phase === CONTRACT_PHASES.EXPIRED || phase === CONTRACT_PHASES.EXPIRING;
}

/**
 * Dossier de prolongation, vu par l'organisation.
 *
 * Facteurs séparés et traçables : on doit pouvoir répondre à « pourquoi cette
 * structure a-t-elle laissé partir ce joueur ? ».
 */
export function renewalCase(world, person) {
  const team = person.teamId ? world.teams[person.teamId] : null;
  const org = team ? world.orgs[team.orgId] : null;
  const game = GAMES_BY_ID[person.gameId];
  if (!team || !org || !game) return null;

  const factors = [];
  const add = (key, label, delta) => {
    if (delta !== 0) factors.push({ key, label, delta: Math.round(delta * 10) / 10 });
  };

  const rating = baseRating(person, game);
  const mates = team.roster
    .map((id) => world.persons[id])
    .filter((p) => p && p.id !== person.id)
    .map((p) => baseRating(p, game));
  const teamMean = mates.length ? mates.reduce((a, b) => a + b, 0) / mates.length : rating;

  // 1. Ce qu'il vaut par rapport à ses coéquipiers : le cœur de la décision.
  add('performance', `niveau ${Math.round(rating)} pour ${Math.round(teamMean)} de moyenne dans l'effectif`, clamp((rating - teamMean) * 2.2, -30, 30));

  // 2. L'âge et ce qu'il reste à venir.
  const a = personAge(person, world.week);
  const ceiling = weightedCeiling(person, game);
  if (a < 21 && ceiling > rating + 6) {
    add('potential', `${Math.round(a)} ans, encore ${Math.round(ceiling - rating)} points de marge`, 18);
  } else if (a >= 29) {
    add('age', `${Math.round(a)} ans`, -clamp((a - 28) * 5, 0, 22));
  }

  // 3. Le prix, rapporté à ce que cette structure peut payer.
  const band = salaryBand(org, game);
  const salary = person.contract?.salary ?? band.typical;
  const ratio = band.typical > 0 ? salary / band.typical : 1;
  add('salary', `salaire à ${Math.round(ratio * 100)} % du barème maison`, clamp((1 - ratio) * 22, -26, 14));

  // 4. Sa place réelle dans l'équipe.
  if (team.subs.includes(person.id)) add('role', 'remplaçant', -10);
  else add('role', 'titulaire', 6);

  // 5. La saison de l'équipe : une structure qui gagne conserve son groupe.
  const s = team.season ?? {};
  if ((s.played ?? 0) >= 6) {
    const winRatio = (s.wins ?? 0) / s.played;
    add('teamSeason', `${Math.round(winRatio * 100)} % de victoires pour l'équipe`, clamp((winRatio - 0.45) * 30, -12, 12));
  }

  // 6. Les moyens. Une caisse vide ne prolonge personne.
  if (org.budget < 0) add('finances', 'trésorerie négative', -18);
  else if (org.budget < salary) add('finances', 'trésorerie inférieure au salaire', -10);

  // 7. Y a-t-il mieux à prendre ? On ne prolonge pas un joueur si un agent
  //    libre du même niveau attend, et on prolonge volontiers s'il n'y a rien.
  const alternatives = countAlternatives(world, person, rating);
  if (alternatives === 0) add('scarcity', 'aucune alternative disponible sur la scène', 14);
  else if (alternatives >= 3) add('alternatives', `${alternatives} joueurs de niveau comparable disponibles`, -10);

  const score = factors.reduce((n, f) => n + f.delta, 0);
  return { factors, score, offered: score >= 0, band, rating, org, team };
}

function countAlternatives(world, person, rating) {
  let n = 0;
  for (const id of world.freeAgents) {
    const p = world.persons[id];
    if (!p || p.gameId !== person.gameId) continue;
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    const game = GAMES_BY_ID[p.gameId];
    if (baseRating(p, game) >= rating - 3) n++;
    if (n >= 3) break;
  }
  return n;
}

/**
 * Salaire proposé à la prolongation.
 * Volontairement ancré sur le salaire courant : sans cette borne, une
 * organisation dont le budget a gonflé multiplierait les salaires sans raison
 * sportive (voir la note sur les budgets en tête de module).
 */
function renewalSalary(world, person, c) {
  const merit = clamp(c.score / 60, -0.4, 0.6);
  const current = person.contract?.salary ?? c.band.typical;
  const target = clamp(c.band.typical * (0.8 + merit), c.band.min, c.band.max);
  return Math.round(clamp(target, current * 0.7, current * 1.6));
}

/**
 * Décision du joueur face à une prolongation.
 * Les traits pèsent réellement : un joueur loyal reste pour moins, un ambitieux
 * veut voir ailleurs, un vétéran privilégie la stabilité.
 */
export function renewalDecision(world, person, offerSalary, rng) {
  const m = mods(person);
  const org = person.orgId ? world.orgs[person.orgId] : null;
  const game = GAMES_BY_ID[person.gameId];
  const factors = [];
  const add = (key, label, delta) => {
    if (delta !== 0) factors.push({ key, label, delta: Math.round(delta * 100) / 100 });
  };

  let p = 0.5;
  add('base', 'proposition de son club', 0.5);

  const current = person.contract?.salary ?? 0;
  if (current > 0) {
    const gain = offerSalary / current;
    const d = clamp((gain - 1) * 0.5 * m.greed, -0.3, 0.3);
    p += d;
    add('salary', `salaire ${gain >= 1 ? '+' : ''}${Math.round((gain - 1) * 100)} %`, d);
  }

  const d2 = (m.loyalty - 1) * 0.3;
  p += d2;
  add('loyalty', 'attachement à la structure', d2);

  // Ambition : rester dans une structure modeste coûte à celui qui vise haut.
  if (org && org.tier <= 2) {
    const d3 = -(m.ambition - 1) * 0.28 - 0.08;
    p += d3;
    add('ambition', `structure de niveau ${org.tier}`, d3);
  }

  const a = personAge(person, world.week);
  if (a >= 28) {
    p += 0.16;
    add('stability', `${Math.round(a)} ans : la stabilité prime`, 0.16);
  }
  const rating = baseRating(person, game);
  const ceiling = weightedCeiling(person, game);
  if (a < 22 && ceiling > rating + 8 && world.teams[person.teamId]?.subs.includes(person.id)) {
    p -= 0.2;
    add('playtime', 'jeune remplaçant en quête de temps de jeu', -0.2);
  }
  if (person.morale < 40) {
    p -= 0.15;
    add('morale', 'moral bas', -0.15);
  }

  return { accepted: rng.chance(clamp(p, 0.05, 0.95)), probability: clamp(p, 0.05, 0.95), factors };
}

/**
 * Intersaison contractuelle : chaque contrat échu ou en fin de course produit
 * une décision. Une fois par an, à l'ouverture du marché.
 */
export function runContractCycle(world, rng) {
  const result = { renewed: 0, expired: 0, declined: 0, considered: 0 };
  if (!isMajorTransferWindow(world.week)) return result;
  const season = yearOf(world.week);
  if (world.lastContractCycle === season) return result;
  world.lastContractCycle = season;

  for (const person of Object.values(world.persons)) {
    if (person.isPlayer) continue;
    if (!person.contract || !person.teamId) continue;
    if (person.status === STATUS.RETIRED || person.status === STATUS.STAFF) continue;
    if (!isDue(person, world.week)) continue;
    result.considered++;

    const c = renewalCase(world, person);
    if (!c) continue;

    if (!c.offered) {
      endContract(world, person, world.week, 'fin de contrat', c.factors, c.score);
      result.expired++;
      continue;
    }

    const salary = renewalSalary(world, person, c);
    const decision = renewalDecision(world, person, salary, rng);
    if (!decision.accepted) {
      endContract(world, person, world.week, 'prolongation refusée', decision.factors, c.score);
      result.declined++;
      continue;
    }

    const years = person.contract.endWeek - person.contract.signedWeek > WEEKS_PER_YEAR * 1.5 ? 2 : 1;
    person.contract = {
      ...person.contract,
      salary,
      signedWeek: world.week,
      endWeek: world.week + WEEKS_PER_YEAR * years + rng.int(0, 8),
      renewals: (person.contract.renewals ?? 0) + 1,
    };
    result.renewed++;
    if (isTracing()) {
      trace(TRACE.CONTRACT, world.week, {
        decision: 'renewal',
        personId: person.id,
        nick: person.nick,
        orgName: c.org.name,
        salary,
        years,
        score: Math.round(c.score),
        factors: c.factors,
      });
    }
  }
  return result;
}

/** Fin de contrat : le joueur quitte son équipe et rejoint le marché. */
export function endContract(world, person, week, reason, factors = [], score = 0) {
  const orgName = person.orgId ? world.orgs[person.orgId]?.name : null;
  if (isTracing()) {
    trace(TRACE.CONTRACT, week, {
      decision: 'end',
      reason,
      personId: person.id,
      nick: person.nick,
      orgName,
      score: Math.round(score),
      factors,
    });
  }
  releasePlayer(world, person.id, week, reason);
}

/**
 * Licenciements (§K).
 *
 * Une organisation ne rompt pas un contrat à la légère : il faut une raison
 * sportive ou économique nette. Le joueur libéré devient agent libre — c'est
 * une situation de marché, pas une fin de parcours.
 */
export function runReleases(world, rng, { maxReleases = 6 } = {}) {
  if (!isMajorTransferWindow(world.week)) return [];
  const released = [];
  const teams = rng.shuffle(
    Object.values(world.teams).filter((t) => t.active && world.orgs[t.orgId]?.alive),
  );

  for (const team of teams) {
    if (released.length >= maxReleases) break;
    const org = world.orgs[team.orgId];
    const game = GAMES_BY_ID[team.gameId];
    if (!game || team.roster.length < game.teamSize) continue;

    const salaries = team.roster.reduce(
      (n, id) => n + (world.persons[id]?.contract?.salary ?? 0),
      0,
    );
    const strained = org.budget < 0 || salaries > org.yearlyIncome;

    for (const id of [...team.roster]) {
      if (released.length >= maxReleases) break;
      const person = world.persons[id];
      if (!person || person.isPlayer || !person.contract) continue;

      const factors = [];
      const add = (key, label, delta) => factors.push({ key, label, delta: Math.round(delta * 10) / 10 });
      const rating = baseRating(person, game);
      const mates = team.roster
        .filter((x) => x !== id)
        .map((x) => baseRating(world.persons[x], game));
      const teamMean = mates.length ? mates.reduce((a, b) => a + b, 0) / mates.length : rating;

      let score = 0;
      if (rating < teamMean - 6) {
        const d = clamp((teamMean - rating - 6) * 3, 0, 30);
        score += d;
        add('performance', `niveau ${Math.round(rating)} contre ${Math.round(teamMean)} dans l'effectif`, d);
      }
      const band = salaryBand(org, game);
      if (person.contract.salary > band.max) {
        const d = clamp((person.contract.salary / band.max - 1) * 30, 0, 26);
        score += d;
        add('salary', 'salaire au-dessus du barème', d);
      }
      if (strained) {
        score += 14;
        add('finances', 'masse salariale supérieure aux revenus', 14);
      }
      const a = personAge(person, world.week);
      if (a >= 30 && rating < teamMean) {
        score += 8;
        add('age', `${Math.round(a)} ans en fin de cycle`, 8);
      }
      if (score < 26) continue;
      // On ne se sépare de quelqu'un que si on peut le remplacer. C'est cette
      // condition — et non l'existence d'un banc — qui rend un licenciement
      // responsable : la première version exigeait un effectif en surnombre,
      // or aucune équipe de ce moteur n'a de remplaçant (c'est le sujet de
      // l'étape 5), et pas un seul licenciement ne survenait en dix ans.
      if (!hasReplacement(world, team, game, rating)) continue;
      if (!rng.chance(clamp(score / 90, 0.05, 0.5))) continue;

      if (isTracing()) {
        trace(TRACE.CONTRACT, world.week, {
          decision: 'release',
          personId: person.id,
          nick: person.nick,
          orgName: org.name,
          score: Math.round(score),
          factors,
        });
      }
      releasePlayer(world, person.id, world.week, 'licenciement');
      released.push(person.id);
    }
  }
  return released;
}

/** Existe-t-il, dans le vivier, quelqu'un d'au moins équivalent ? */
function hasReplacement(world, team, game, rating) {
  for (const id of world.freeAgents) {
    const p = world.persons[id];
    if (!p || p.gameId !== team.gameId) continue;
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    if (baseRating(p, game) >= rating - 1) return true;
  }
  return false;
}

/** Statistiques de vivacité du marché (§S), pour l'audit. */
export function contractSnapshot(world) {
  const out = {
    contracts: 0,
    active: 0,
    expiring: 0,
    expired: 0,
    renewedEver: 0,
    durationsYears: [],
    freeAgents: 0,
  };
  for (const p of Object.values(world.persons)) {
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    if (!p.teamId) out.freeAgents++;
    if (!p.contract) continue;
    out.contracts++;
    const phase = contractPhase(p, world.week);
    if (phase === CONTRACT_PHASES.ACTIVE) out.active++;
    else if (phase === CONTRACT_PHASES.EXPIRING) out.expiring++;
    else out.expired++;
    if ((p.contract.renewals ?? 0) > 0) out.renewedEver++;
    out.durationsYears.push((p.contract.endWeek - p.contract.signedWeek) / WEEKS_PER_YEAR);
  }
  return out;
}
