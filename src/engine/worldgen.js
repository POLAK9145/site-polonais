/**
 * Génération du monde (§42).
 *
 * Le monde est bâti à partir d'une seed, avant l'arrivée du joueur : des
 * scènes, des organisations, des rosters, des vétérans en fin de course et
 * des jeunes qui montent. Le joueur s'insère dans un monde qui existait
 * déjà — c'est ce qui rend le §86 possible.
 *
 * On ne pré-génère PAS l'avenir : seulement l'état initial. La suite est
 * produite semaine par semaine par le moteur.
 */

import { RNG, clamp } from './rng.js';
import { GAMES, GAMES_BY_ID } from '../data/games.js';
import { REGIONS } from '../data/regions.js';
import { createPerson, STATUS, resetPersonCounter } from './person.js';
import { createOrg, createTeam, resetOrgCounters } from './org.js';
import { addToRoster, assignRoles, computeSynergyTarget, recordStint } from './team.js';
import { createGameState } from './meta.js';
import { resetCompCounter } from './competition.js';
import { absWeek } from './time.js';
import { gainFollowers } from './reputation.js';

/** Répartition des tiers d'organisation selon la taille de la scène. */
const SCENE_PROFILES = {
  major: [5, 4, 4, 3, 3, 3, 2, 2, 1, 1],
  mid: [4, 3, 3, 2, 2, 1, 1, 1],
  niche: [3, 3, 2, 2, 1, 1],
};

/** Niveau attendu des joueurs par tier d'organisation. */
const TIER_LEVEL = {
  5: [87, 4],
  4: [79, 4.5],
  3: [72, 5],
  2: [61, 6],
  // Le tier 1 est le VRAI bas de l'échelle : il doit être à portée d'un
  // joueur qui débute, sinon la pyramide n'a pas de première marche et
  // personne ne peut jamais y entrer (§11).
  1: [46, 6.5],
};

function sceneSize(game) {
  if (game.popularity >= 78) return 'major';
  if (game.popularity >= 58) return 'mid';
  return 'niche';
}

function regionCountFor(game) {
  if (game.popularity >= 78) return 3;
  if (game.popularity >= 58) return 2;
  return 1;
}

export function createEmptyWorld(seed, startYear) {
  return {
    seed,
    week: absWeek(startYear, 1),
    startWeek: absWeek(startYear, 1),
    persons: {},
    orgs: {},
    teams: {},
    gameStates: {},
    competitions: {},
    relations: {},
    freeAgents: [],
    news: [],
    records: [],
    playerId: null,
    pendingPlayerIncome: [],
    rngState: 0,
    seasonArchive: [],
    // Index non sérialisés, reconstruits au chargement.
    indexes: {
      takenNicks: new Set(),
      takenOrgNames: new Set(),
      takenTags: new Set(),
    },
  };
}

export function generateWorld({ seed = 12345, startYear = 2030, scale = 1 } = {}) {
  resetPersonCounter();
  resetOrgCounters();
  resetCompCounter();

  const rootRng = new RNG(seed);
  const world = createEmptyWorld(seed, startYear);
  const now = world.week;

  // 1. État vivant de chaque jeu.
  for (const game of GAMES) {
    world.gameStates[game.id] = createGameState(rootRng.fork(`gamestate:${game.id}`), game, now);
  }

  // 2. Scènes : organisations + rosters, jeu par jeu, région par région.
  for (const game of GAMES) {
    const rng = rootRng.fork(`scene:${game.id}`);
    const profile = SCENE_PROFILES[sceneSize(game)];
    const regionCount = Math.max(1, Math.round(regionCountFor(game) * scale));
    // Les régions les plus fortes accueillent les plus grosses scènes.
    const regions = pickRegions(rng, regionCount, game);

    for (const region of regions) {
      const tiers = scale < 1 ? profile.slice(0, Math.max(4, Math.round(profile.length * scale))) : profile;
      for (const tier of tiers) {
        const org = createOrg(rng, {
          regionId: region.id,
          tier,
          takenNames: world.indexes.takenOrgNames,
          takenTags: world.indexes.takenTags,
          absWeek: now - rng.int(52, 52 * 12),
        });
        world.orgs[org.id] = org;

        const team = createTeam(rng, { org, gameId: game.id, absWeek: now });
        world.teams[team.id] = team;

        fillRoster(world, rng, team, game, tier, now);
        if (game.teamSize > 1) attachCoach(world, rng, team, region.id, tier, now);
        assignRoles(world, team);
      }
    }

    // 3. Un vivier d'agents libres par jeu : sans eux, le marché est mort.
    const freeAgentCount = Math.max(3, Math.round((sceneSize(game) === 'major' ? 14 : 8) * scale));
    for (let i = 0; i < freeAgentCount; i++) {
      const region = rng.pick(regions);
      const tier = rng.weighted([1, 2, 3], (t) => (t === 1 ? 5 : t === 2 ? 3 : 1));
      const p = spawnPlayer(world, rng, {
        game,
        regionId: region.id,
        tier,
        now,
        ageRange: [17, 26],
      });
      p.status = tier >= 2 ? STATUS.INACTIVE : STATUS.AMATEUR;
      world.freeAgents.push(p.id);
    }
  }

  world.rngState = rootRng.state;
  return world;
}

function pickRegions(rng, count, game) {
  const pool = [...REGIONS];
  const chosen = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const r = rng.weighted(pool, (region) => Math.pow(region.strength, 3) * 10);
    if (!r) break;
    chosen.push(r);
    pool.splice(pool.indexOf(r), 1);
  }
  return chosen;
}

function fillRoster(world, rng, team, game, tier, now) {
  for (let i = 0; i < game.teamSize; i++) {
    const p = spawnPlayer(world, rng, {
      game,
      regionId: team.orgId ? world.orgs[team.orgId].regionId : 'weu',
      tier,
      now,
      ageRange: tier >= 4 ? [19, 28] : tier === 3 ? [18, 26] : tier === 2 ? [17, 24] : [16, 21],
    });
    p.status = tier >= 3 ? STATUS.PRO : tier === 2 ? STATUS.SEMIPRO : STATUS.AMATEUR;
    if (p.status !== STATUS.AMATEUR) {
      p.contract = makeInitialContract(world, rng, p, team, tier, now);
    }
    addToRoster(world, team, p.id, { initial: true });
    recordStint(world, p, team, world.orgs[team.orgId], now);
  }
  // Un roster existe depuis un moment : sa cohésion est déjà proche de sa
  // cible, avec la dispersion qu'on attend d'équipes plus ou moins récentes.
  team.sharedWeeks = rng.int(0, 90);
  team.synergy = clamp(
    computeSynergyTarget(world, team) * rng.float(0.72, 1.02),
    10,
    97,
  );
}

function spawnPlayer(world, rng, { game, regionId, tier, now, ageRange }) {
  const [mean, sd] = TIER_LEVEL[tier];
  const level = rng.gaussClamped(mean, sd, 30, 96);
  const age = rng.float(ageRange[0], ageRange[1]);
  // Les joueurs de haut niveau ont déjà consommé une partie de leur marge.
  const potentialBias = clamp(28 - age * 0.9 + (tier - 3) * 2, -8, 16);

  const p = createPerson(rng, {
    regionId,
    age,
    baseLevel: level + 2,
    spread: 8,
    potentialBias,
    absWeek: now,
    takenNicks: world.indexes.takenNicks,
    gameId: game.id,
    familiarity: rng.float(0.72, 1),
    traitCount: rng.int(2, 4),
  });
  p.observations = Math.round(rng.float(0, 60) * (tier / 5));
  p.reputation.pros = clamp(rng.gauss(tier * 11, 8), 0, 100);
  p.reputation.public = clamp(rng.gauss(tier * 8.5, 9), 0, 100);
  p.reputation.community = clamp(rng.gauss(tier * 7 + 8, 10), 0, 100);
  p.reputation.media = clamp(rng.gauss(tier * 7, 9), 0, 100);
  // L'audience de départ passe par la même porte que toutes les autres : elle
  // est bornée par ce que la notoriété du personnage justifie. La formule
  // précédente — `public^2,4 × 1,5..5` sans plafond — dotait la cohorte initiale
  // d'une audience que le reste du moteur ne pouvait ni maintenir ni reproduire.
  gainFollowers(world, p, Math.pow(Math.max(1, p.reputation.public), 2.4) * rng.float(1.5, 5), 'notoriété initiale');
  p.stats.matches = Math.round(rng.float(0, 60) * tier);
  p.stats.wins = Math.round(p.stats.matches * rng.float(0.35, 0.65));
  p.stats.losses = p.stats.matches - p.stats.wins;
  p.stats.earnings = Math.round(Math.pow(tier, 3) * rng.float(400, 3000));
  world.persons[p.id] = p;
  return p;
}

function makeInitialContract(world, rng, person, team, tier, now) {
  const org = world.orgs[team.orgId];
  const game = GAMES_BY_ID[team.gameId];
  const base = org.budget * 0.13 * (game.prizeScale ?? 1);
  return {
    orgId: org.id,
    teamId: team.id,
    salary: Math.max(600, Math.round(base * rng.float(0.5, 1.2))),
    signedWeek: now - rng.int(4, 90),
    endWeek: now + rng.int(20, 130),
    role: 'starter',
    bonusPerTitle: Math.round(base * 0.2),
    objectives: tier >= 4 ? 'playoffs' : 'progression',
    buyout: Math.round(base * rng.float(1.2, 3)),
  };
}

function attachCoach(world, rng, team, regionId, tier, now) {
  const level = 45 + tier * 7;
  const coach = createPerson(rng, {
    regionId,
    age: rng.float(27, 45),
    baseLevel: level,
    spread: 9,
    attrBias: { social: 14, gameSense: 12, mechanical: -18, media: 2 },
    absWeek: now,
    takenNicks: world.indexes.takenNicks,
    gameId: team.gameId,
    familiarity: rng.float(0.8, 1),
    traitCount: 2,
  });
  coach.status = STATUS.STAFF;
  coach.role = 'coach';
  world.persons[coach.id] = coach;
  team.coachId = coach.id;
  return coach;
}

/**
 * Reconstruit les index dérivés après un chargement de sauvegarde.
 * Sans cela, deux personnages pourraient recevoir le même pseudo.
 */
export function rebuildIndexes(world) {
  world.indexes = {
    takenNicks: new Set(Object.values(world.persons).map((p) => p.nick.toLowerCase())),
    takenOrgNames: new Set(Object.values(world.orgs).map((o) => o.name.toLowerCase())),
    takenTags: new Set(Object.values(world.orgs).map((o) => o.tag)),
  };
  return world;
}

/** Statistiques rapides sur un monde généré (tests et page Monde). */
export function worldSummary(world) {
  const persons = Object.values(world.persons);
  return {
    persons: persons.length,
    active: persons.filter((p) => p.status !== STATUS.RETIRED && p.status !== STATUS.STAFF).length,
    staff: persons.filter((p) => p.status === STATUS.STAFF).length,
    orgs: Object.values(world.orgs).filter((o) => o.alive).length,
    teams: Object.values(world.teams).filter((t) => t.active).length,
    games: Object.values(world.gameStates).filter((g) => g.alive).length,
    freeAgents: world.freeAgents.length,
  };
}
