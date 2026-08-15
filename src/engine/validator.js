/**
 * CareerConsistencyValidator (§61).
 *
 * Ce module ne « corrige » rien tout seul : il constate. Le moteur décide
 * ensuite de réparer (simulation.js) ou, dans les tests, d'échouer.
 *
 * Les invariants listés ici sont exactement ceux du §60 : un mort ne signe
 * pas, une équipe dissoute ne recrute pas, un retraité ne joue pas.
 */

import { STATUS, age as personAge } from './person.js';
import { GAMES_BY_ID } from '../data/games.js';

function issue(code, message, data = null) {
  return { code, message, data };
}

/** Contrôle global du monde. Coûteux : réservé aux tests et au débogage. */
export function validateWorld(world, { minCompetitiveAge = 15 } = {}) {
  const issues = [];
  const teamOfPerson = new Map();

  for (const team of Object.values(world.teams)) {
    const org = world.orgs[team.orgId];
    const game = GAMES_BY_ID[team.gameId];

    if (team.active && (!org || !org.alive)) {
      issues.push(issue('team_without_org', `Équipe ${team.id} active sans organisation vivante.`, { teamId: team.id }));
    }

    const members = [...team.roster, ...team.subs];
    for (const pid of members) {
      const p = world.persons[pid];
      if (!p) {
        issues.push(issue('ghost_member', `Équipe ${team.id} référence une personne inexistante (${pid}).`, { teamId: team.id, pid }));
        continue;
      }
      if (p.status === STATUS.RETIRED) {
        issues.push(issue('retired_in_team', `${p.nick} est retraité mais figure dans ${team.id}.`, { pid, teamId: team.id }));
      }
      if (!team.active && p.teamId === team.id) {
        issues.push(issue('team_disbanded', `${p.nick} appartient à une équipe dissoute (${team.id}).`, { pid, teamId: team.id }));
      }
      if (teamOfPerson.has(pid) && teamOfPerson.get(pid) !== team.id) {
        issues.push(issue('double_roster', `${p.nick} figure dans deux équipes.`, { pid }));
      }
      teamOfPerson.set(pid, team.id);

      if (p.gameId !== team.gameId) {
        issues.push(issue('game_mismatch', `${p.nick} joue ${p.gameId} mais est dans une équipe ${team.gameId}.`, { pid }));
      }
      if (team.active && personAge(p, world.week) < minCompetitiveAge) {
        issues.push(issue('underage', `${p.nick} est trop jeune pour une compétition officielle.`, { pid }));
      }
    }

    if (game && team.roster.length > game.teamSize) {
      issues.push(issue('roster_overflow', `Équipe ${team.id} : ${team.roster.length} titulaires pour ${game.teamSize} places.`, { teamId: team.id }));
    }
  }

  for (const p of Object.values(world.persons)) {
    if (p.contract) {
      const org = world.orgs[p.contract.orgId];
      if (!org || !org.alive) {
        issues.push(issue('contract_dead_org', `${p.nick} a un contrat avec une organisation disparue.`, { pid: p.id }));
      }
      if (!p.teamId) {
        issues.push(issue('contract_without_team', `${p.nick} a un contrat mais aucune équipe.`, { pid: p.id }));
      }
    }
    if (p.teamId && !world.teams[p.teamId]) {
      issues.push(issue('ghost_team', `${p.nick} référence une équipe inexistante.`, { pid: p.id }));
    }
    if (p.status === STATUS.RETIRED && p.teamId) {
      issues.push(issue('retired_in_team', `${p.nick} est retraité et pourtant sous contrat.`, { pid: p.id }));
    }
  }

  for (const comp of Object.values(world.competitions)) {
    if (!comp || comp.status === 'done') continue;
    for (const teamId of comp.teamIds) {
      const team = world.teams[teamId];
      if (!team) {
        issues.push(issue('comp_ghost_team', `${comp.name} inscrit une équipe inexistante.`, { compId: comp.id }));
      }
    }
  }

  return issues;
}

/** Contrôle ciblé sur la carrière du joueur, appelé chaque semaine. */
export function validateCareer(world, career) {
  const issues = [];
  const p = world.persons[career.personId];
  if (!p) return [issue('no_player', 'Le personnage du joueur est introuvable.')];

  if (p.status === STATUS.RETIRED && p.teamId) {
    issues.push(issue('retired_in_team', 'Le joueur est retraité mais toujours dans une équipe.'));
  }
  if (p.contract && !p.teamId) {
    issues.push(issue('contract_without_team', 'Contrat actif sans équipe.'));
  }
  if (p.teamId) {
    const team = world.teams[p.teamId];
    if (!team) issues.push(issue('ghost_team', 'Le joueur référence une équipe inexistante.'));
    else if (!team.active) issues.push(issue('team_disbanded', 'Le joueur appartient à une équipe dissoute.'));
    else if (!team.roster.includes(p.id) && !team.subs.includes(p.id)) {
      issues.push(issue('not_in_roster', 'Le joueur n’apparaît pas dans le roster de son équipe.'));
    }
  }
  if (p.contract) {
    const org = world.orgs[p.contract.orgId];
    if (!org?.alive) issues.push(issue('contract_dead_org', 'Contrat avec une organisation disparue.'));
  }
  if (career.retired && p.status !== STATUS.RETIRED) {
    issues.push(issue('career_status_mismatch', 'Carrière terminée mais statut du personnage incohérent.'));
  }

  return issues;
}

/** Vérifie qu'une timeline ne contient pas d'anachronisme. */
export function validateTimeline(career) {
  const issues = [];
  let last = -Infinity;
  for (const entry of career.timeline) {
    if (entry.week < last) {
      issues.push(issue('timeline_order', 'Entrées de timeline désordonnées.', entry));
    }
    last = entry.week;
  }
  return issues;
}
