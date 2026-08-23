/**
 * Rosters, synergie et force collective (§14).
 *
 * Règle de conception : la somme des individus ne fait jamais l'équipe.
 * Cinq joueurs à 85 très soudés doivent pouvoir battre cinq joueurs à 90
 * qui ne se supportent pas — et le système doit pouvoir expliquer pourquoi.
 */

import { clamp } from './rng.js';
import { effectiveRating, baseRating, mods, STATUS } from './person.js';
import { GAMES_BY_ID } from '../data/games.js';
import { relationValue } from './relations.js';

export function rosterPersons(world, team) {
  return team.roster.map((id) => world.persons[id]).filter(Boolean);
}

export function allTeamMembers(world, team) {
  return [...team.roster, ...team.subs].map((id) => world.persons[id]).filter(Boolean);
}

export function teamGame(team) {
  return GAMES_BY_ID[team.gameId];
}

export function teamOrg(world, team) {
  return world.orgs[team.orgId];
}

/**
 * Cible de synergie : où la cohésion de ce roster va tendre s'il reste
 * ensemble. La synergie réelle s'en rapproche progressivement — une équipe
 * neuve ne joue jamais à son plein potentiel immédiatement.
 */
export function computeSynergyTarget(world, team) {
  const players = rosterPersons(world, team);
  if (players.length === 0) return 40;

  let teamwork = 0;
  let communication = 0;
  let traitSynergy = 0;
  let conflict = 0;
  let bestLeadership = 0;

  for (const p of players) {
    teamwork += p.attrs.teamwork;
    communication += p.attrs.communication;
    const m = mods(p);
    traitSynergy += m.synergy;
    conflict += m.conflictRisk - 1;
    bestLeadership = Math.max(bestLeadership, p.attrs.leadership);
  }
  const n = players.length;

  let target =
    12 +
    (teamwork / n) * 0.4 +
    (communication / n) * 0.26 +
    (traitSynergy / n) * 34 -
    (conflict / n) * 16;

  // Une équipe sans meneur plafonne.
  if (bestLeadership > 70) target += 7;
  else if (bestLeadership < 45) target -= 6;

  // Relations réelles entre coéquipiers : une amitié soude, une rancune ronge.
  let relSum = 0;
  let pairs = 0;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      relSum += relationValue(world, players[i].id, players[j].id);
      pairs++;
    }
  }
  if (pairs > 0) target += (relSum / pairs) * 0.16;

  // Le coach est un vrai levier : c'est ce qui rend le §18 (choisir une
  // équipe moins riche mais mieux encadrée) défendable.
  const coach = team.coachId ? world.persons[team.coachId] : null;
  if (coach) {
    target += (coach.attrs.leadership + coach.attrs.communication + coach.attrs.teamwork) / 3 * 0.16 - 6;
  }

  // Temps passé ensemble : jusqu'à +14 après deux ans.
  target += clamp(team.sharedWeeks / 104, 0, 1) * 14;

  return clamp(target, 5, 98);
}

export function updateSynergy(world, team, rng, weeks = 1) {
  const target = computeSynergyTarget(world, team);
  const speed = 0.06;
  for (let i = 0; i < weeks; i++) {
    team.synergy += (target - team.synergy) * speed + rng.gauss(0, 0.7);
    team.synergy = clamp(team.synergy, 1, 99);
  }
  team.sharedWeeks += weeks;
  return target;
}

/**
 * Ce que vaut un entraîneur (0..1).
 *
 * Une seule définition, pour une seule raison : il en existait trois — celle-ci,
 * une copie mot pour mot dans `simulation.js`, et une troisième écrite pour le
 * marché des coachs. Trois copies d'une formule, c'est trois occasions qu'elles
 * divergent, et un monde où l'on recruterait les entraîneurs sur un critère que
 * la progression n'utilise pas.
 */
export function coachQualityOfPerson(c) {
  if (!c?.attrs) return 0;
  return clamp(
    (c.attrs.reading * 0.3 + c.attrs.metaSense * 0.25 + c.attrs.communication * 0.25 + c.attrs.leadership * 0.2) / 100,
    0,
    1,
  );
}

/** Qualité du coaching d'une équipe, utilisée par la progression et les matchs. */
export function coachQuality(world, team) {
  if (!team?.coachId) return 0;
  return coachQualityOfPerson(world.persons[team.coachId]);
}

/**
 * Force d'une équipe pour un match.
 * Retourne le détail : le moteur d'explication et l'UI en dépendent (§59).
 */
export function teamStrength(world, team, { forMatch = true } = {}) {
  const game = teamGame(team);
  const players = rosterPersons(world, team);
  if (players.length === 0) {
    return { strength: 20, individual: 20, synergyMod: 0, coachMod: 0, players: [] };
  }

  const ratings = players.map((p) => ({
    id: p.id,
    rating: forMatch ? effectiveRating(p, game) : baseRating(p, game),
  }));

  // Moyenne pondérée : le meilleur joueur compte un peu plus que les autres
  // (il fait la différence sur les moments décisifs) sans écraser le reste.
  const sorted = [...ratings].sort((a, b) => b.rating - a.rating);
  let weightSum = 0;
  let acc = 0;
  sorted.forEach((r, i) => {
    const w = i === 0 ? 1.25 : i === sorted.length - 1 ? 0.9 : 1;
    acc += r.rating * w;
    weightSum += w;
  });
  const individual = acc / weightSum;

  // Recentré sur la synergie « normale » d'un roster établi (~58) : une
  // équipe soudée gagne jusqu'à +6 points de niveau réel, une équipe qui se
  // déteste en perd autant. C'est l'ordre de grandeur qui permet au §14
  // d'exister sans écraser le niveau individuel.
  const synergyMod = (team.synergy - 58) * 0.22;
  const cq = coachQuality(world, team);
  const coachMod = cq * 4.5;

  // Jouer en infériorité numérique coûte très cher : sans cela, mettre un
  // joueur sur le banc sans le remplacer serait indolore.
  const missing = Math.max(0, (game?.teamSize ?? 1) - players.length);
  const shorthandedMod = -missing * 9;

  return {
    strength: clamp(individual + synergyMod + coachMod + shorthandedMod, 1, 99),
    shorthandedMod,
    individual,
    synergyMod,
    coachMod,
    players: ratings,
  };
}

/** Attribue à chaque joueur le rôle où il est le meilleur, sans doublon. */
export function assignRoles(world, team) {
  const game = teamGame(team);
  if (!game?.roles?.length) return;
  const players = rosterPersons(world, team);
  const available = game.roles.map((r) => r.id);
  const scored = [];
  for (const p of players) {
    for (const role of game.roles) {
      const score = role.attrs.reduce((s, a) => s + (p.attrs[a] ?? 0), 0) / role.attrs.length;
      scored.push({ personId: p.id, roleId: role.id, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const assigned = new Set();
  for (const s of scored) {
    if (assigned.has(s.personId)) continue;
    if (!available.includes(s.roleId)) continue;
    world.persons[s.personId].roleId = s.roleId;
    assigned.add(s.personId);
    available.splice(available.indexOf(s.roleId), 1);
  }
  // Roster plus grand que le nombre de rôles : les restants sont polyvalents.
  for (const p of players) {
    if (!assigned.has(p.id)) p.roleId = game.roles[game.roles.length - 1].id;
  }
}

export function isRosterComplete(world, team) {
  const game = teamGame(team);
  return team.roster.length >= (game?.teamSize ?? 1);
}

/**
 * Besoins d'une équipe (§17) : combien de places libres, et quel est le
 * maillon faible qu'elle cherchera à remplacer. Sans cela, le marché n'a
 * aucune logique et les transferts deviennent du bruit.
 */
export function teamNeeds(world, team) {
  const game = teamGame(team);
  const size = game?.teamSize ?? 1;
  const players = rosterPersons(world, team);
  const openSlots = Math.max(0, size - players.length);

  let weakest = null;
  let weakestRating = Infinity;
  for (const p of players) {
    const r = baseRating(p, game);
    if (r < weakestRating) {
      weakestRating = r;
      weakest = p;
    }
  }

  const strength = teamStrength(world, team, { forMatch: false });
  const org = teamOrg(world, team);
  // Le niveau visé dépend de l'ambition et du budget. Une structure amateur
  // n'a pas d'exigence : elle prend qui veut bien venir.
  const ambitionBonus = (org?.tier ?? 1) <= 1 ? -6 : (org?.ambition ?? 0.5) * 8 - 2;
  const targetRating = clamp(strength.individual + ambitionBonus, 25, 97);

  return {
    openSlots,
    weakestId: weakest?.id ?? null,
    weakestRating: weakest ? weakestRating : null,
    targetRating,
    urgency: openSlots > 0 ? 1 : clamp((targetRating - weakestRating) / 12, 0, 1),
  };
}

/**
 * Retire une personne de TOUS les rosters du monde.
 *
 * Garde-fou central : les chemins de sortie sont nombreux (transfert,
 * licenciement, retraite, dissolution d'org, fermeture de scène) et il
 * suffit qu'un seul oublie une référence pour produire un « joueur retraité
 * qui figure encore dans une équipe » (§60). On ne se fie donc jamais au
 * seul `person.teamId`.
 */
export function detachFromAllTeams(world, personId) {
  let removed = 0;
  for (const team of Object.values(world.teams)) {
    const i = team.roster.indexOf(personId);
    if (i >= 0) {
      team.roster.splice(i, 1);
      removed++;
    }
    const j = team.subs.indexOf(personId);
    if (j >= 0) {
      team.subs.splice(j, 1);
      removed++;
    }
  }
  return removed;
}

/**
 * Enregistre un passage en équipe dans l'historique d'une personne.
 *
 * L'entrée porte le NOM de l'organisation, pas seulement son identifiant.
 * C'est ce qui permet d'oublier les structures mortes : un souvenir doit se
 * suffire à lui-même. Sans cela, chaque équipe amateur dissoute devait rester
 * en mémoire pour que son nom reste lisible, et la sauvegarde accumulait
 * 504 structures fantômes en vingt ans.
 */
export function recordStint(world, person, team, org, week) {
  person.teamHistory.push({
    teamId: team.id,
    orgId: org?.id ?? team.orgId,
    orgName: org?.name ?? world.orgs[team.orgId]?.name ?? null,
    gameId: team.gameId,
    from: week,
    to: null,
    // Un passage en équipe n'est pas forcément un contrat (étape 7G). On
    // rejoint une équipe amateur sans rien signer, et le bilan final doit
    // pouvoir dire lequel des deux s'est produit. `person.contract` est
    // toujours à jour ici : signPlayer l'affecte avant d'appeler cette
    // fonction, et un joueur libéré l'a vu remis à null.
    contract: !!person.contract,
  });
}

export function addToRoster(world, team, personId, { initial = false, asSub = false } = {}) {
  if (team.roster.includes(personId) || team.subs.includes(personId)) return false;
  // Personne ne peut appartenir à deux effectifs simultanément.
  detachFromAllTeams(world, personId);

  // Un effectif ne peut pas dépasser la taille du jeu : au-delà, on rejoint
  // le banc. Sans ce garde-fou, on obtient « 2 titulaires pour 1 place »
  // sur les jeux solo (§60).
  const game = teamGame(team);
  const full = team.roster.length >= (game?.teamSize ?? 1);
  if (asSub || full) {
    team.subs.push(personId);
    const sub = world.persons[personId];
    sub.teamId = team.id;
    sub.orgId = team.orgId;
    sub.gameId = team.gameId;
    return true;
  }

  team.roster.push(personId);
  const p = world.persons[personId];
  p.teamId = team.id;
  p.orgId = team.orgId;
  p.gameId = team.gameId;
  // Un nouveau venu casse temporairement la cohésion acquise — sauf lors de
  // la constitution initiale d'un roster, où il n'y a rien à casser.
  if (!initial) {
    team.synergy = clamp(team.synergy - 7, 5, 99);
    team.sharedWeeks = Math.max(0, team.sharedWeeks * 0.55);
  }
  assignRoles(world, team);
  return true;
}

export function removeFromRoster(world, team, personId) {
  const i = team.roster.indexOf(personId);
  if (i >= 0) team.roster.splice(i, 1);
  const j = team.subs.indexOf(personId);
  if (j >= 0) team.subs.splice(j, 1);
  const p = world.persons[personId];
  if (p && p.teamId === team.id) {
    p.teamId = null;
    p.orgId = null;
    p.contract = null;
    p.roleId = null;
    if (p.status !== STATUS.RETIRED) p.status = STATUS.INACTIVE;
  }
  team.synergy = clamp(team.synergy - 4, 5, 99);
  assignRoles(world, team);
  return i >= 0 || j >= 0;
}
