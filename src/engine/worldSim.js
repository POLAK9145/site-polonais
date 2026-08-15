/**
 * Vie du monde sans le joueur (§3, §41).
 *
 * Les PNJ progressent, vieillissent, déclinent, prennent leur retraite,
 * deviennent coachs. Les organisations gagnent et perdent de l'argent,
 * ferment, se créent. Une nouvelle génération arrive chaque année.
 *
 * Optimisation assumée : les PNJ sont traités par lots de 4 semaines. Le
 * résultat est identique à l'échelle d'une carrière, pour un quart du coût.
 */

import { clamp } from './rng.js';
import { GAMES_BY_ID, GAMES } from '../data/games.js';
import { REGIONS } from '../data/regions.js';
import { progressPerson, updateForm, npcRoutine } from './progression.js';
import { decayMetaShock, maybePatch, updatePopularity } from './meta.js';
import { updateSceneLifecycle, SCENE_PHASES } from './scene.js';
import { updateSynergy, coachQuality, teamStrength, detachFromAllTeams } from './team.js';
import {
  createPerson,
  STATUS,
  baseRating,
  age as personAge,
  effectiveRating,
} from './person.js';
import { createOrg, createTeam } from './org.js';
import { addToRoster, assignRoles } from './team.js';
import { releasePlayer, runNpcTransferWindow } from './transfers.js';
import { decayRelations } from './relations.js';
import { weekOfYear, WEEKS_PER_YEAR } from './time.js';
import { dissolveOrg } from './events/defs/worldEvents.js';

const NPC_BATCH = 4;

/** Progression et forme de tous les PNJ, par lots. */
export function simulateNpcs(world, rng) {
  if (world.week % NPC_BATCH !== 0) return;
  for (const p of Object.values(world.persons)) {
    if (p.isPlayer) continue;
    if (p.status === STATUS.RETIRED) continue;
    const game = GAMES_BY_ID[p.gameId];
    if (!game) continue;

    decayMetaShock(p, NPC_BATCH);

    if (p.status === STATUS.STAFF) {
      // Le staff continue d'apprendre son métier, plus lentement.
      progressPerson(p, { game, routine: ['strategy', 'review'], weeks: NPC_BATCH, absWeek: world.week }, rng);
      continue;
    }

    const team = p.teamId ? world.teams[p.teamId] : null;
    const cq = team ? coachQuality(world, team) : 0;
    progressPerson(
      p,
      {
        game,
        routine: npcRoutine(p, rng),
        coachQuality: cq,
        weeks: NPC_BATCH,
        absWeek: world.week,
        teamQuality: team ? clamp(teamStrength(world, team, { forMatch: false }).individual / 100, 0, 1) : 0,
      },
      rng,
    );
    updateForm(p, rng, NPC_BATCH);

    const rating = baseRating(p, game);
    if (rating > p.stats.peakRating) {
      p.stats.peakRating = rating;
      p.stats.peakWeek = world.week;
    }
  }
}

/** Synergie des équipes : elle se construit ou se délite chaque semaine. */
export function simulateTeams(world, rng) {
  if (world.week % 2 !== 0) return;
  for (const team of Object.values(world.teams)) {
    if (!team.active) continue;
    updateSynergy(world, team, rng, 2);
  }
}

/** Patches, métas et popularité des jeux. */
export function simulateGames(world, rng) {
  for (const gameState of Object.values(world.gameStates)) {
    const patch = maybePatch(world, gameState, rng);
    if (patch?.major) {
      const game = GAMES_BY_ID[gameState.gameId];
      world.news.push({
        week: world.week,
        headline: `${game.shortName} — patch ${patch.version}`,
        body: `La méta bascule vers « ${patch.axis} ». Les équipes ont quelques semaines pour s'adapter.`,
        gameId: game.id,
        tone: 'neutral',
      });
    }
    // Réévaluation trimestrielle de la santé structurelle de la scène.
    const phaseChange = updateSceneLifecycle(world, gameState, rng);
    if (phaseChange) announceScenePhase(world, gameState, phaseChange);

    updatePopularity(world, gameState, rng, 1);
    if (!gameState.alive && !gameState.obituaryPosted) {
      gameState.obituaryPosted = true;
      const game = GAMES_BY_ID[gameState.gameId];
      world.news.push({
        week: world.week,
        headline: `Fin de la scène compétitive de ${game.name}`,
        body: `Faute d'audience et de dotations, les dernières compétitions sont annulées.`,
        gameId: game.id,
        tone: 'negative',
      });
      closeScene(world, gameState.gameId);
    }
  }
}

/** Une bascule de phase est un fait : on la publie comme telle (§47). */
function announceScenePhase(world, gameState, change) {
  const game = GAMES_BY_ID[gameState.gameId];
  if (change.to === SCENE_PHASES.REVIVAL) {
    world.news.push({
      week: world.week,
      headline: `${game.shortName} repart`,
      body: `Nouvelle génération, investissements et compétitions relancées : la scène retrouve des couleurs.`,
      gameId: game.id,
      tone: 'positive',
    });
  } else if (change.to === SCENE_PHASES.DECLINING) {
    world.news.push({
      week: world.week,
      headline: `${game.shortName} s'essouffle`,
      body: `Audiences en baisse et structures qui hésitent à réinvestir.`,
      gameId: game.id,
      tone: 'negative',
    });
  } else if (change.to === SCENE_PHASES.DYING) {
    world.news.push({
      week: world.week,
      headline: `La scène ${game.shortName} est en sursis`,
      body: `Il ne reste qu'une poignée d'équipes actives.`,
      gameId: game.id,
      tone: 'negative',
    });
  }
}

function closeScene(world, gameId) {
  for (const team of Object.values(world.teams)) {
    if (team.gameId !== gameId || !team.active) continue;
    team.active = false;
    for (const pid of [...team.roster, ...team.subs]) {
      releasePlayer(world, pid, world.week, 'fermeture de la scène');
    }
  }
}

/** Économie des organisations (mensuelle). */
export function simulateOrgEconomy(world, rng) {
  if (world.week % 4 !== 0) return;
  for (const org of Object.values(world.orgs)) {
    if (!org.alive) continue;
    const monthlyIncome = org.yearlyIncome / 12;
    let monthlyCost = 0;
    for (const teamId of Object.values(org.teams)) {
      const team = world.teams[teamId];
      if (!team?.active) continue;
      for (const pid of [...team.roster, ...team.subs]) {
        const p = world.persons[pid];
        if (p?.contract?.salary) monthlyCost += p.contract.salary / 12;
      }
      monthlyCost += 1200 * org.tier; // staff, structure, déplacements
    }
    org.budget += Math.round(monthlyIncome - monthlyCost);

    // Une org dans le rouge depuis longtemps finit par fermer.
    if (org.budget < -org.yearlyIncome * 0.3) {
      org.distress = (org.distress ?? 0) + 1;
      if (org.distress > 6 && rng.chance(0.3)) {
        world.news.push({
          week: world.week,
          headline: `${org.name} cesse ses activités`,
          body: 'La structure ne peut plus honorer ses contrats.',
          tone: 'negative',
        });
        dissolveOrg(world, org, world.week);
      }
    } else {
      org.distress = Math.max(0, (org.distress ?? 0) - 1);
    }

    // Les sponsors suivent les résultats.
    if (world.week % 52 === 0) {
      const perf = org.titles;
      org.yearlyIncome = Math.round(
        org.yearlyIncome * clamp(0.92 + perf * 0.03 + org.reputation / 800, 0.7, 1.3),
      );
    }
  }
}

/** Retraites et reconversions (§41, §49). */
export function runRetirements(world, rng) {
  const retired = [];
  for (const p of Object.values(world.persons)) {
    if (p.isPlayer) continue;
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    const game = GAMES_BY_ID[p.gameId];
    if (!game) continue;
    const a = personAge(p, world.week);
    const rating = baseRating(p, game);
    const decline = p.stats.peakRating > 0 ? p.stats.peakRating - rating : 0;

    let chance = 0;
    if (a >= 31) chance = 0.45;
    else if (a >= 29) chance = 0.26;
    else if (a >= 27) chance = 0.14;
    else if (a >= 25) chance = 0.06;
    else if (a >= 23) chance = 0.02;
    else chance = 0.004;

    // Les raisons réelles d'arrêter : le niveau qui s'en va, plus d'équipe,
    // ou simplement plus envie.
    chance += clamp(decline * 0.02, 0, 0.25);
    if (!p.teamId) chance += 0.12;
    if (p.morale < 30) chance += 0.08;
    chance *= 1.35 - p.hidden.longevity * 0.7;
    if (p.stats.titles > 0 && a < 27) chance *= 0.7;

    if (rng.chance(clamp(chance, 0, 0.85))) {
      retirePerson(world, p, rng);
      retired.push(p);
    }
  }
  return retired;
}

export function retirePerson(world, p, rng) {
  releasePlayer(world, p.id, world.week, 'retraite');
  detachFromAllTeams(world, p.id);
  const wasGood = p.stats.peakRating > 72 || p.stats.titles > 0;
  // Une partie des joueurs reste dans l'écosystème comme staff.
  const becomesCoach = wasGood && p.attrs.leadership > 55 && rng.chance(0.3);
  p.status = becomesCoach ? STATUS.STAFF : STATUS.RETIRED;
  p.retiredWeek = world.week;
  p.retirementReason = becomesCoach ? 'reconversion' : 'retraite';
  const fa = world.freeAgents.indexOf(p.id);
  if (fa >= 0) world.freeAgents.splice(fa, 1);
  if (becomesCoach) p.role = 'coach';
  return p;
}

/** Arrivée d'une nouvelle génération (§41). */
export function spawnNewGeneration(world, rng, { intake = null } = {}) {
  const spawned = [];
  for (const game of GAMES) {
    const gs = world.gameStates[game.id];
    if (!gs?.alive) continue;
    // Une scène populaire attire plus de jeunes qu'une scène qui s'éteint.
    // On tient compte des places réellement vacantes : une scène qui perd
    // des joueurs plus vite qu'elle n'en forme finit avec des équipes à
    // trois joueurs pour cinq places.
    const openSlots = Object.values(world.teams).reduce((n, t) => {
      if (!t.active || t.gameId !== game.id) return n;
      return n + Math.max(0, game.teamSize - t.roster.length);
    }, 0);
    const pool = world.freeAgents.filter((id) => world.persons[id]?.gameId === game.id).length;
    const count = intake ?? Math.max(2, Math.round((gs.popularity / 100) * 6) + Math.max(0, openSlots - pool));
    const regions = REGIONS.filter((r) =>
      Object.values(world.orgs).some((o) => o.alive && o.regionId === r.id && o.teams[game.id]),
    );
    if (regions.length === 0) continue;
    for (let i = 0; i < count; i++) {
      const region = rng.weighted(regions, (r) => r.talentDensity * 10);
      const p = createPerson(rng, {
        regionId: region.id,
        age: rng.float(15.5, 18),
        baseLevel: rng.gaussClamped(46, 8, 25, 72),
        spread: 9,
        // C'est ici que naissent les prodiges : quelques plafonds très hauts
        // dans une masse de profils ordinaires.
        potentialBias: rng.chance(0.06) ? rng.float(18, 30) : rng.gauss(4, 8),
        absWeek: world.week,
        takenNicks: world.indexes.takenNicks,
        gameId: game.id,
        familiarity: rng.float(0.35, 0.7),
        traitCount: rng.int(2, 4),
      });
      p.status = STATUS.AMATEUR;
      p.generation = Math.floor(world.week / WEEKS_PER_YEAR);
      world.persons[p.id] = p;
      world.freeAgents.push(p.id);
      spawned.push(p);
    }
  }
  return spawned;
}

/** Création d'organisations quand une scène se dépeuple. */
export function refreshOrgs(world, rng) {
  for (const game of GAMES) {
    const gs = world.gameStates[game.id];
    if (!gs?.alive) continue;
    const byRegion = {};
    for (const team of Object.values(world.teams)) {
      if (team.gameId !== game.id || !team.active) continue;
      const org = world.orgs[team.orgId];
      if (!org?.alive) continue;
      byRegion[org.regionId] = (byRegion[org.regionId] ?? 0) + 1;
    }
    for (const [regionId, count] of Object.entries(byRegion)) {
      if (count >= 6) continue;
      if (!rng.chance(0.5)) continue;
      const org = createOrg(rng, {
        regionId,
        tier: rng.int(1, 2),
        takenNames: world.indexes.takenOrgNames,
        takenTags: world.indexes.takenTags,
        absWeek: world.week,
      });
      world.orgs[org.id] = org;
      const team = createTeam(rng, { org, gameId: game.id, absWeek: world.week });
      world.teams[team.id] = team;
      // On la remplit avec des agents libres crédibles.
      const pool = world.freeAgents
        .map((id) => world.persons[id])
        .filter((p) => p && p.gameId === game.id && p.status !== STATUS.RETIRED && p.status !== STATUS.STAFF);
      for (const p of rng.sample(pool, game.teamSize)) {
        addToRoster(world, team, p.id, { initial: true });
        const i = world.freeAgents.indexOf(p.id);
        if (i >= 0) world.freeAgents.splice(i, 1);
        p.teamHistory.push({ teamId: team.id, orgId: org.id, gameId: game.id, from: world.week, to: null });
      }
      world.news.push({
        week: world.week,
        headline: `${org.name} entre sur la scène ${game.shortName}`,
        body: 'Une nouvelle structure se lance.',
        gameId: game.id,
      });
    }
  }
}

/** Nettoie les agents libres fantômes et évite l'inflation de la population. */
export function pruneWorld(world) {
  if (world.news.length > 150) world.news.splice(0, world.news.length - 150);

  world.freeAgents = world.freeAgents.filter((id) => {
    const p = world.persons[id];
    return p && p.status !== STATUS.RETIRED && p.status !== STATUS.STAFF && !p.teamId;
  });

  // Les personnages sans histoire notable sont oubliés : sans cela, la
  // population et la taille de sauvegarde croissent sans fin.
  const toDelete = [];
  const playerId = world.playerId;
  for (const p of Object.values(world.persons)) {
    if (p.isPlayer || p.protectedFromPruning) continue;
    // On ne supprime jamais quelqu'un qui compte dans l'histoire du joueur.
    if (playerId && world.relations[relKeyLocal(playerId, p.id)]) continue;

    if (p.status === STATUS.RETIRED) {
      if (world.week - (p.retiredWeek ?? 0) < WEEKS_PER_YEAR / 2) continue;
      const notable = p.stats.titles > 0 || p.stats.peakRating > 84;
      if (!notable) toDelete.push(p.id);
      continue;
    }
    // Agents libres oubliés : au bout de trois ans sans équipe et sans
    // niveau, ils ont simplement arrêté.
    if (!p.teamId && p.status !== STATUS.STAFF) {
      p.weeksUnattached = (p.weeksUnattached ?? 0) + 1;
      if (p.weeksUnattached > 2 && p.stats.peakRating < 64) toDelete.push(p.id);
    } else {
      p.weeksUnattached = 0;
    }
  }
  for (const id of toDelete) forgetPerson(world, id);

  // Plafond de population. Sans borne dure, le monde grossit indéfiniment
  // (chaque année amène une génération) et la sauvegarde finit par dépasser
  // le quota du navigateur. On oublie en priorité ceux dont l'absence ne
  // change rien : sans équipe, sans palmarès, sans lien avec le joueur.
  const overflow = Object.keys(world.persons).length - MAX_POPULATION;
  if (overflow > 0) {
    // On ne vide jamais une scène qui a encore des places à pourvoir :
    // supprimer ses agents libres laisserait des équipes à trois joueurs
    // pour cinq places, ce qui est bien pire qu'une sauvegarde un peu plus
    // lourde.
    const surplus = sceneSurplus(world);
    const expendable = Object.values(world.persons)
      .filter((p) => {
        if (p.isPlayer || p.protectedFromPruning) return false;
        if (playerId && world.relations[relKeyLocal(playerId, p.id)]) return false;
        if (p.teamId) return false;
        if (p.stats.titles > 0) return false;
        return (surplus[p.gameId] ?? 0) > 0;
      })
      .sort((a, b) => a.stats.peakRating - b.stats.peakRating);

    let removed = 0;
    for (const p of expendable) {
      if (removed >= overflow) break;
      if ((surplus[p.gameId] ?? 0) <= 0) continue;
      surplus[p.gameId]--;
      forgetPerson(world, p.id);
      removed++;
    }
    return toDelete.length + removed;
  }

  return toDelete.length;
}

/** Population maximale conservée en mémoire (et donc en sauvegarde). */
export const MAX_POPULATION = 700;

/**
 * Agents libres excédentaires par jeu : ceux dont la scène n'a pas besoin.
 * Une marge est conservée pour que le marché reste vivant.
 */
function sceneSurplus(world) {
  const openSlots = {};
  const pool = {};
  for (const game of GAMES) {
    openSlots[game.id] = 0;
    pool[game.id] = 0;
  }
  for (const team of Object.values(world.teams)) {
    if (!team.active) continue;
    const game = GAMES_BY_ID[team.gameId];
    if (!game) continue;
    openSlots[game.id] += Math.max(0, game.teamSize - team.roster.length);
  }
  for (const p of Object.values(world.persons)) {
    if (p.teamId || p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    if (pool[p.gameId] !== undefined) pool[p.gameId]++;
  }
  const surplus = {};
  for (const game of GAMES) {
    surplus[game.id] = Math.max(0, pool[game.id] - openSlots[game.id] - 8);
  }
  return surplus;
}

function forgetPerson(world, id) {
  // Toujours détacher AVANT de supprimer : sinon on laisse des références
  // fantômes dans les effectifs, et un événement finit par parler d'un
  // coéquipier qui n'existe plus (§60, `ghost_member`).
  detachFromAllTeams(world, id);
  for (const team of Object.values(world.teams)) {
    if (team.coachId === id) team.coachId = null;
    if (team.managerId === id) team.managerId = null;
  }
  delete world.persons[id];
  const i = world.freeAgents.indexOf(id);
  if (i >= 0) world.freeAgents.splice(i, 1);
  for (const key of Object.keys(world.relations)) {
    if (key.startsWith(`${id}|`) || key.endsWith(`|${id}`)) delete world.relations[key];
  }
}

function relKeyLocal(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Cycle annuel : retraites, nouvelle génération, structures. */
export function runYearlyCycle(world, rng) {
  const retired = runRetirements(world, rng);
  const spawned = spawnNewGeneration(world, rng);
  refreshOrgs(world, rng);
  const pruned = pruneWorld(world);
  return { retired: retired.length, spawned: spawned.length, pruned };
}

/** Le marché des transferts, hors joueur. */
export function runMarket(world, rng) {
  if (world.week % 2 !== 0) return [];
  return runNpcTransferWindow(world, rng, { maxMoves: 24 });
}

/**
 * Comble les effectifs incomplets, chaque semaine, hors fenêtre de transfert.
 *
 * Indispensable : le mercato ne traite qu'une poignée de mouvements par
 * fenêtre, et une équipe amputée finissait par disputer une saison entière
 * à un joueur contre cinq. Une organisation réelle recrute un remplaçant en
 * urgence — c'est ce que fait cette passe, en piochant d'abord sur son banc.
 */
export function fillEmptyRosters(world, rng) {
  const filled = [];
  for (const team of Object.values(world.teams)) {
    if (!team.active) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive) continue;
    const game = GAMES_BY_ID[team.gameId];
    if (!game) continue;

    let missing = game.teamSize - team.roster.length;
    if (missing <= 0) continue;

    // 1. On promeut d'abord ses propres remplaçants.
    while (missing > 0 && team.subs.length > 0) {
      const promoted = team.subs.shift();
      if (world.persons[promoted]) {
        team.roster.push(promoted);
        missing--;
      }
    }

    // 2. Puis on signe en urgence, avec des exigences abaissées.
    while (missing > 0) {
      const candidate = bestAvailable(world, team, game, rng);
      if (!candidate) break;
      addToRoster(world, team, candidate.id, { initial: true });
      const i = world.freeAgents.indexOf(candidate.id);
      if (i >= 0) world.freeAgents.splice(i, 1);
      candidate.status = org.tier >= 3 ? STATUS.PRO : org.tier === 2 ? STATUS.SEMIPRO : STATUS.AMATEUR;
      if (org.tier >= 2) {
        candidate.contract = {
          orgId: org.id,
          teamId: team.id,
          salary: Math.max(1200, Math.round(org.budget * 0.04)),
          signedWeek: world.week,
          endWeek: world.week + 52,
          role: 'starter',
          bonusPerTitle: 0,
          buyout: 0,
          objectives: 'progression',
        };
      }
      candidate.teamHistory.push({
        teamId: team.id,
        orgId: org.id,
        gameId: team.gameId,
        from: world.week,
        to: null,
      });
      filled.push({ teamId: team.id, personId: candidate.id });
      missing--;
    }

    if (filled.length > 0) assignRoles(world, team);
  }
  return filled;
}

/** Meilleur agent libre disponible sur la scène de cette équipe. */
function bestAvailable(world, team, game, rng) {
  let best = null;
  let bestRating = -Infinity;
  for (const id of world.freeAgents) {
    const p = world.persons[id];
    if (!p || p.teamId) continue;
    if (p.gameId !== team.gameId) continue;
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    const r = baseRating(p, game);
    if (r > bestRating) {
      bestRating = r;
      best = p;
    }
  }
  return best;
}

export function decayWorldRelations(world) {
  if (world.week % 8 !== 0) return;
  decayRelations(world, 8);
}

export function isOffseasonWeek(world) {
  return weekOfYear(world.week) === 51;
}
