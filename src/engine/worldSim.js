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
import { addToRoster, assignRoles, recordStint, coachQualityOfPerson } from './team.js';
import { releasePlayer, runNpcTransferWindow, runBenchRecruitment } from './transfers.js';
import { decayRelations } from './relations.js';
import { weekOfYear, WEEKS_PER_YEAR } from './time.js';
import { dissolveOrg } from './events/defs/worldEvents.js';
import { formAmateurTeams, dissolveFailedAmateurTeams } from './amateur.js';
import { bestSubFor, playingTimeFactor, runRotation } from './roster.js';
import { operatingCost, payroll, updateOrgIncome, reinvest, sceneTeamCapacity, tierReferenceIncome } from './economy.js';
import { runVisibilityCycle, decayOrgReputation } from './reputation.js';
import { contextPressure } from './load.js';
import { isTracing, trace, TRACE } from './trace.js';
import { runContractCycle, runReleases } from './contracts.js';
import { runFreeAgentMarket, tickIdleWeeks } from './npcMarket.js';

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
        // Un remplaçant s'entraîne autant mais ne joue pas : il progresse plus
        // lentement, sans être condamné à stagner (§J).
        playingTime: playingTimeFactor(world, p),
        // Même modèle de charge que pour le joueur : un seul chemin de code,
        // sinon les PNJ vivraient sous une autre physique (étape 7B).
        pressure: contextPressure(world, p, { team, org: team ? world.orgs[team.orgId] : null }),
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
        portee: 'scene',
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
    // Charges : salaires plus un fonctionnement proportionnel à l'échelle
    // réelle de la structure. Le forfait de `1200 × tier` par mois ne
    // représentait plus rien dès que l'économie grossissait — 5,8 M pour tout
    // le monde à l'année 5 comme à l'année 30, pour 62 milliards de revenus.
    const monthlyCost = (payroll(world, org) + operatingCost(world, org)) / 12;
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

    // Revenus de l'année : une fonction de l'état, jamais un cumul de son
    // propre passé. La version précédente multipliait `yearlyIncome` par
    // lui-même chaque année, ce qui produisait une exponentielle que rien ne
    // freinait (voir `economy.js`).
    if (world.week % 52 === 0) {
      // La réputation d'organisation s'oublie elle aussi. Elle ne décroissait
      // nulle part, saturait à 100, et verrouillait donc le multiplicateur de
      // revenus au-dessus de 1 pour toujours — c'était la moitié de la cause de
      // la divergence économique.
      decayOrgReputation(world, org);
      updateOrgIncome(world, org, rng);
      // L'excédent est dépensé, pas thésaurisé : c'est la sortie qui manquait,
      // et c'est elle qui rend une organisation mortelle.
      reinvest(world, org);
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

  // Une carrière qui comptait ne s'arrête pas dans le silence (étape 8F).
  // Mesuré avant : une seule retraite apparaissait dans le fil sur les ~400
  // que produit une carrière de dix ans. Les légendes disparaissaient sans que
  // personne ne le remarque — ce qui est précisément l'inverse d'un monde
  // vivant. Le filtre est celui d'une vraie notoriété, sinon on annonce chaque
  // semaine l'arrêt de gens dont on n'a jamais entendu parler.
  const notable = (p.stats?.titles ?? 0) > 0 || (p.stats?.peakRating ?? 0) > 82;
  if (notable) {
    const titres = p.stats?.titles ?? 0;
    world.news.push({
      week: world.week,
      headline: `${p.nick} met un terme à sa carrière`,
      body: becomesCoach
        ? `${titres > 0 ? `${titres} titre${titres > 1 ? 's' : ''} au compteur. ` : ''}Il reste dans le milieu, côté staff.`
        : `${titres > 0 ? `${titres} titre${titres > 1 ? 's' : ''} au compteur. ` : ''}Il quitte la compétition.`,
      gameId: p.gameId,
      tone: 'neutral',
      important: true,
      // Un joueur de rang mondial, on l'apprend même sans suivre sa scène.
      portee: titres >= 3 || (p.stats?.peakRating ?? 0) > 88 ? 'monde' : 'scene',
    });
  }
  return p;
}

/**
 * Les entraîneurs partent aussi (étape 8D).
 *
 * `runRetirements` écarte explicitement le STAFF : un coach ne raccrochait donc
 * jamais. Mesuré après quarante ans, avec le marché des coachs mais sans ce
 * départ : âge médian des entraîneurs en poste 72 ans, maximum 84, et 56 des
 * 89 postes encore tenus par les entraîneurs créés à la génération du monde.
 *
 * Ce n'est pas seulement invraisemblable, c'est bloquant : sans postes qui se
 * libèrent, les reconversions n'ont nulle part où aller et le marché ne
 * distribue rien. La rotation est ce qui permet à un grand joueur d'hier de
 * prendre la place d'un ancien.
 */
export function runCoachRetirements(world, rng) {
  const partis = [];
  for (const p of Object.values(world.persons)) {
    if (p.status !== STATUS.STAFF || p.role !== 'coach') continue;
    const a = personAge(p, world.week);
    // Un métier qu'on peut faire plus longtemps que joueur, mais pas indéfiniment.
    let chance = 0.02;
    if (a >= 64) chance = 0.45;
    else if (a >= 56) chance = 0.2;
    else if (a >= 48) chance = 0.08;
    if (!rng.chance(chance)) continue;

    for (const team of Object.values(world.teams)) {
      if (team.coachId === p.id) team.coachId = null;
    }
    p.status = STATUS.RETIRED;
    p.retiredWeek = world.week;
    p.retirementReason = p.retirementReason ?? 'fin de carrière d’entraîneur';
    partis.push(p.id);
  }
  return partis;
}

/**
 * Le marché des coachs (étape 8D).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * L'après-carrière existait à moitié. `retirePerson` faisait bien passer une
 * partie des joueurs en STAFF — mesuré, 113 reconversions sur 642 retraites en
 * douze ans — mais **aucune équipe ne recrutait jamais de coach**. Ces
 * reconversions restaient donc sans poste, et la pression démographique les
 * effaçait dans l'année : le monde produisait des entraîneurs et les jetait
 * aussitôt.
 *
 * Un commentaire de `pruneWorld` disait déjà la moitié du problème — « les
 * reconversions entraient dans l'écosystème sans jamais pouvoir en sortir » —
 * et une sortie y avait été ajoutée. Il manquait l'entrée.
 *
 * Conséquence mesurée sur quarante ans : la part d'équipes ayant un coach
 * tombait de 73 % à 33 %. Ce n'est pas cosmétique — la qualité du coaching
 * nourrit la progression de tout le monde, joueur compris : un monde sans
 * entraîneurs est un monde où plus personne ne progresse normalement.
 *
 * CE QUI EST MODÉLISÉ, ET CE QUI NE L'EST PAS
 * -------------------------------------------
 * Le salaire récurrent d'un coach n'est PAS modélisé : `payroll` ne compte que
 * les contrats de joueurs, et l'y ajouter déplacerait un équilibre économique
 * validé. L'embauche coûte en revanche une prime d'arrivée réelle, prélevée sur
 * le budget : une organisation sans le sou n'embauche pas. C'est une dette
 * assumée et bornée, pas un oubli.
 */
export function runCoachMarket(world, rng) {
  const embauches = [];

  // Les postes : seuls les jeux collectifs ont un entraîneur. C'est la règle de
  // la génération du monde, et c'est elle qui explique les 73 % de départ — un
  // joueur solo n'a pas de coach d'équipe. Viser 100 % serait inventer un
  // besoin qui n'existe pas.
  const vacants = [];
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.isSelfTeam) continue;
    const game = GAMES_BY_ID[team.gameId];
    if (!game || game.teamSize <= 1) continue;
    if (team.coachId && world.persons[team.coachId]) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive) continue;
    vacants.push({ team, org });
  }
  if (vacants.length === 0) return embauches;

  // Les candidats : ceux qui se sont reconvertis et n'ont pas encore de poste.
  const enPoste = new Set();
  for (const t of Object.values(world.teams)) {
    if (t.active && t.coachId) enPoste.add(t.coachId);
  }
  const libres = Object.values(world.persons).filter(
    (p) => p.status === STATUS.STAFF && p.role === 'coach' && !enPoste.has(p.id),
  );
  if (libres.length === 0) return embauches;

  // Les meilleures structures servies en premier : c'est ce qui fait qu'un
  // grand nom d'hier entraîne une grande équipe, et non la première venue.
  vacants.sort((a, b) => (b.org.tier ?? 1) - (a.org.tier ?? 1) || (b.org.budget ?? 0) - (a.org.budget ?? 0));

  for (const { team, org } of vacants) {
    const prime = primeEmbaucheCoach(org.tier ?? 1);
    if ((org.budget ?? 0) < prime) continue;

    // Un entraîneur connaît une scène. Passer d'un jeu à l'autre existe, mais
    // ce n'est pas la norme, et cela se paie d'une préférence nette.
    let meilleur = null;
    let meilleurScore = -Infinity;
    for (const c of libres) {
      if (enPoste.has(c.id)) continue;
      const memeScene = c.gameId === team.gameId;
      const score =
        coachQualityOfPerson(c) * 100 +
        (memeScene ? 30 : 0) +
        // Un palmarès ouvre les portes des grandes structures.
        Math.min(20, (c.stats?.titles ?? 0) * 4) +
        rng.float(0, 8);
      if (score > meilleurScore) {
        meilleurScore = score;
        meilleur = c;
      }
    }
    if (!meilleur) break;

    org.budget -= prime;
    team.coachId = meilleur.id;
    meilleur.gameId = team.gameId;
    meilleur.idleYears = 0;
    enPoste.add(meilleur.id);
    org.history.push({ week: world.week, text: `${meilleur.nick} prend en main l'équipe.` });
    embauches.push({ teamId: team.id, orgId: org.id, coachId: meilleur.id });
  }
  return embauches;
}

/** Ce que coûte l'arrivée d'un entraîneur, à l'échelle des budgets du tier. */
function primeEmbaucheCoach(tier) {
  const reference = tierReferenceIncome(tier);
  return Math.round(reference * 0.04);
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
    const pool = Object.values(world.persons).filter(
      (p) =>
        p.gameId === game.id &&
        !p.teamId &&
        p.status !== STATUS.RETIRED &&
        p.status !== STATUS.STAFF,
    ).length;

    // Une scène en bonne santé attire beaucoup plus de joueurs qu'elle n'a de
    // places en ligue. Ce surplus EST la base amateur : sans lui, les équipes
    // d'entrée n'ont aucun joueur à recruter et ne peuvent pas se former.
    const activeRegionCount = new Set(
      Object.values(world.teams)
        .filter((t) => t.active && t.gameId === game.id)
        .map((t) => world.orgs[t.orgId]?.regionId)
        .filter(Boolean),
    ).size;
    const desiredReservoir = Math.round(
      game.teamSize * 1.6 * (gs.vitality ?? 0.5) * (gs.popularity / 100) * Math.max(1, activeRegionCount),
    );

    const count =
      intake ??
      Math.max(
        2,
        Math.round((gs.popularity / 100) * 6) +
          Math.max(0, openSlots - pool) +
          Math.max(0, desiredReservoir - pool),
      );
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

/**
 * Création d'organisations quand une scène se dépeuple.
 *
 * Ces structures naissent au bas de la pyramide (tier 1). Auparavant elles
 * naissaient en `tier: rng.int(1, 2)`, et comme le tier 2 est capable de
 * soutenir une ligue, chaque repeuplement gonflait la ligue au lieu de nourrir
 * la base : mesuré sur 40 ans, la ligue Stadium passait de 10 à 18 équipes
 * pendant que le circuit amateur retombait à 0-1. Une ligue ne doit grandir
 * que par promotion (étape 3), jamais par apparition spontanée.
 */
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
      // Combien de structures cette scène peut-elle nourrir ? La réponse était
      // « six », en dur. Tant qu'assez de structures mouraient, ce nombre
      // n'était jamais atteint et ne décidait de rien ; l'économie réparée, il
      // est devenu la seule règle. Même grandeur que pour le circuit d'entrée :
      // une scène riche porte plus de structures qu'une scène en sommeil.
      if (count >= sceneTeamCapacity(world, game.id)) continue;
      if (!rng.chance(0.5)) continue;
      const org = createOrg(rng, {
        regionId,
        tier: 1,
        takenNames: world.indexes.takenOrgNames,
        takenTags: world.indexes.takenTags,
        absWeek: world.week,
      });
      world.orgs[org.id] = org;
      const team = createTeam(rng, { org, gameId: game.id, absWeek: world.week, tierOverride: 1 });
      world.teams[team.id] = team;
      // On la remplit avec des agents libres crédibles.
      const pool = world.freeAgents
        .map((id) => world.persons[id])
        .filter((p) => p && p.gameId === game.id && p.status !== STATUS.RETIRED && p.status !== STATUS.STAFF);
      for (const p of rng.sample(pool, game.teamSize)) {
        addToRoster(world, team, p.id, { initial: true });
        const i = world.freeAgents.indexOf(p.id);
        if (i >= 0) world.freeAgents.splice(i, 1);
        recordStint(world, p, team, org, world.week);
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
  const employedStaff = staffInPost(world);
  for (const p of Object.values(world.persons)) {
    if (p.isPlayer || p.protectedFromPruning) continue;
    // On ne supprime jamais quelqu'un qui compte dans l'histoire du joueur.
    if (playerId && world.relations[relKeyLocal(playerId, p.id)]) continue;

    if (p.status === STATUS.RETIRED) {
      const yearsGone = (world.week - (p.retiredWeek ?? 0)) / WEEKS_PER_YEAR;
      if (yearsGone < 0.5) continue;
      // La mémoire du monde n'est pas infinie, et « notable » ne peut pas être
      // un état permanent : avec un critère binaire, les retraités notables
      // s'accumulaient sans borne (1 → 420 en quarante ans). On modélise donc
      // un oubli progressif — la durée du souvenir est proportionnelle à ce que
      // la personne a réellement accompli.
      if (yearsGone > memoryYears(p)) toDelete.push(p.id);
      continue;
    }
    if (p.status === STATUS.STAFF) {
      // Un entraîneur sans poste finit par quitter le milieu. Sans cette
      // sortie, le staff n'était jamais élagué et grossissait indéfiniment
      // (106 → 334 en quarante ans) : les reconversions entraient dans
      // l'écosystème sans jamais pouvoir en sortir.
      if (employedStaff.has(p.id)) {
        p.idleYears = 0;
        continue;
      }
      p.idleYears = (p.idleYears ?? 0) + 1;
      if (p.idleYears > 2 && p.idleYears > memoryYears(p)) toDelete.push(p.id);
      continue;
    }
    // Agents libres oubliés : au bout de trois ans sans équipe et sans
    // niveau, ils ont simplement arrêté.
    if (!p.teamId) {
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
  let removed = 0;
  const overflow = Object.keys(world.persons).length - MAX_POPULATION;
  if (overflow > 0) {
    const keepable = (p) => {
      if (p.isPlayer || p.protectedFromPruning) return false;
      if (playerId && world.relations[relKeyLocal(playerId, p.id)]) return false;
      return true;
    };

    // 1. D'abord la mémoire. Oublier un retraité ou un entraîneur sans poste ne
    //    prive aucune scène de joueurs : c'est le seul élagage réellement
    //    gratuit, et c'est là que se trouvait toute la croissance mesurée.
    //    Mais avec une réserve. Cette passe prenait les retraités **sans
    //    limite** : dès que le monde tournait à son plafond, la totalité des
    //    retraités disparaissait chaque année. Le défaut est resté invisible
    //    tant qu'il restait de la place, puis s'est manifesté d'un coup quand le
    //    nombre de structures a augmenté — 85 retraités conservés, puis zéro.
    //    Un monde qui ne se souvient de personne n'a plus d'histoire, ce qui
    //    contredit la prémisse du jeu. On protège donc les plus notables et les
    //    plus récents, et la pression se déplace sur ce dont l'absence ne change
    //    rien : les agents libres surnuméraires (étape 2 ci-dessous).
    const retirees = Object.values(world.persons)
      .filter((p) => keepable(p) && p.status === STATUS.RETIRED)
      // Le monde se souvient de ce qui a marqué, et de ce qui est récent.
      .sort((a, b) => memoryYears(b) - memoryYears(a) || (b.retiredWeek ?? 0) - (a.retiredWeek ?? 0));
    const idleStaff = Object.values(world.persons).filter(
      (p) => keepable(p) && p.status === STATUS.STAFF && !employedStaff.has(p.id),
    );
    // Les moins mémorables d'abord — c'est-à-dire la fin de la liste triée.
    const forgettable = [
      ...idleStaff,
      ...retirees.slice(MEMORY_QUOTA).reverse(),
    ];
    for (const p of forgettable) {
      if (removed >= overflow) break;
      forgetPerson(world, p.id);
      removed++;
    }

    // 2. Ensuite seulement les joueurs disponibles, et jamais dans une scène
    //    qui a encore des places à pourvoir : supprimer ses agents libres
    //    laisserait des équipes à trois joueurs pour cinq places, ce qui est
    //    bien pire qu'une sauvegarde un peu plus lourde.
    if (removed < overflow) {
      const surplus = sceneSurplus(world);
      const expendable = Object.values(world.persons)
        .filter((p) => {
          if (!keepable(p)) return false;
          if (p.teamId) return false;
          if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) return false;
          if (p.stats.titles > 0) return false;
          return (surplus[p.gameId] ?? 0) > 0;
        })
        .sort((a, b) => a.stats.peakRating - b.stats.peakRating);

      for (const p of expendable) {
        if (removed >= overflow) break;
        if ((surplus[p.gameId] ?? 0) <= 0) continue;
        surplus[p.gameId]--;
        forgetPerson(world, p.id);
        removed++;
      }
    }

    // 3. En dernier recours, la réserve de mémoire cède. Le plafond de
    //    population est une contrainte dure — il borne la sauvegarde, et donc ce
    //    que le navigateur accepte de stocker. Une réserve qui l'emporterait sur
    //    lui ne serait pas une réserve mais une fuite : mesuré, la population
    //    montait à 739 pour un plafond de 700, et la sauvegarde dépassait son
    //    quota. On rend donc les retraités protégés, du moins mémorable au plus
    //    mémorable — l'ordre de l'oubli est préservé, la limite aussi.
    if (removed < overflow) {
      for (const p of retirees.slice(0, MEMORY_QUOTA).reverse()) {
        if (removed >= overflow) break;
        forgetPerson(world, p.id);
        removed++;
      }
    }
  }

  // Toujours, y compris après un dépassement de population : c'est ici que les
  // structures mortes disparaissent, et la population est justement plafonnée
  // chaque année, si bien qu'un `return` anticipé les rendait éternelles.
  pruneDeadStructures(world);
  trimStructureHistories(world);
  return toDelete.length + removed;
}

/** Nombre d'entrées d'historique conservées par équipe et par organisation. */
const MAX_STRUCTURE_HISTORY = 20;

/**
 * Borne les historiques de structures.
 *
 * `recordTitles` ajoute une ligne à l'équipe ET à l'organisation à chaque titre.
 * Depuis que le circuit d'entrée joue réellement ses tournois — une quinzaine
 * par an et par scène — ces tableaux devenaient la première source de
 * croissance de la sauvegarde : 711 Ko sur 3 392 à vingt ans, sans borne. Les
 * compteurs (`titles`) portent le palmarès ; l'historique n'a besoin de porter
 * que le récit récent.
 */
/**
 * Nombre de passages en équipe conservés pour un PNJ.
 *
 * L'étape 2 avait borné les historiques d'équipes et d'organisations en laissant
 * de côté celui des personnes. Il est devenu le plus gros poste de la
 * sauvegarde — 217 Ko sur 2 743 — à mesure que les carrières s'allongeaient.
 *
 * Personne ne lit le douzième passage d'un PNJ : le récit se sert des plus
 * récents, et le monde oublie déjà progressivement ses habitants
 * (`memoryYears`). Le joueur, lui, garde tout — c'est son histoire.
 */
const MAX_NPC_STINTS = 8;

function trimStructureHistories(world) {
  for (const p of Object.values(world.persons)) {
    if (p.isPlayer || p.protectedFromPruning) continue;
    if (p.teamHistory?.length > MAX_NPC_STINTS) {
      p.teamHistory.splice(0, p.teamHistory.length - MAX_NPC_STINTS);
    }
  }
  for (const team of Object.values(world.teams)) {
    if (team.history?.length > MAX_STRUCTURE_HISTORY) {
      team.history.splice(0, team.history.length - MAX_STRUCTURE_HISTORY);
    }
  }
  for (const org of Object.values(world.orgs)) {
    if (org.history?.length > MAX_STRUCTURE_HISTORY) {
      org.history.splice(0, org.history.length - MAX_STRUCTURE_HISTORY);
    }
  }
}

/**
 * Oublie les structures mortes que plus personne ne mentionne.
 *
 * Le circuit d'entrée crée une organisation par équipe amateur, et une équipe
 * amateur vit en médiane un an : sur vingt ans, 534 organisations et équipes
 * mortes s'accumulaient dans la sauvegarde, qui atteignait 3 392 Ko pour un
 * quota de 2 600. La population était bornée, mais pas les structures.
 *
 * On ne supprime que ce qui n'est plus référencé : ni par l'historique d'une
 * personne encore présente, ni par un contrat, ni par les archives de saison,
 * ni par une compétition en cours. Sans cette précaution, l'interface
 * afficherait « équipe inconnue » dans la carrière d'un joueur.
 */
function pruneDeadStructures(world) {
  const keepTeams = new Set();
  const keepOrgs = new Set();

  for (const p of Object.values(world.persons)) {
    if (p.teamId) keepTeams.add(p.teamId);
    if (p.orgId) keepOrgs.add(p.orgId);
    if (p.contract?.orgId) keepOrgs.add(p.contract.orgId);
    // L'historique des passages n'oblige à rien conserver : depuis
    // `recordStint`, chaque entrée porte le nom de l'organisation. Un ancien
    // club dissous reste donc lisible dans une carrière sans que sa structure
    // encombre la sauvegarde.
  }
  for (const comp of Object.values(world.competitions)) {
    if (!comp) continue;
    for (const id of comp.teamIds ?? []) keepTeams.add(id);
    if (comp.championId) keepTeams.add(comp.championId);
    if (comp.runnerUpId) keepTeams.add(comp.runnerUpId);
  }
  for (const season of world.seasonArchive ?? []) {
    for (const comp of season.competitions ?? []) {
      if (comp.championId) keepTeams.add(comp.championId);
      if (comp.runnerUpId) keepTeams.add(comp.runnerUpId);
      for (const pl of comp.placements ?? []) if (pl.teamId) keepTeams.add(pl.teamId);
    }
  }
  for (const id of Object.keys(world.seasonPoints ?? {})) keepTeams.add(id);

  let removed = 0;
  for (const team of Object.values(world.teams)) {
    if (team.active || team.isSelfTeam) continue;
    if (keepTeams.has(team.id)) continue;
    delete world.teams[team.id];
    removed++;
  }
  for (const org of Object.values(world.orgs)) {
    if (org.alive || org.isSelfOrg) continue;
    if (keepOrgs.has(org.id)) continue;
    // Une organisation dont une équipe est conservée doit l'être aussi : c'est
    // par elle que l'interface retrouve un nom et un blason.
    if (Object.values(org.teams ?? {}).some((id) => world.teams[id])) continue;
    delete world.orgs[org.id];
    // Le nom redevient disponible. Les index sont reconstruits à partir des
    // organisations survivantes au chargement (`worldgen.js`) : ne pas les
    // libérer ici ferait diverger une partie en cours d'une partie rechargée.
    world.indexes?.takenOrgNames?.delete(org.name.toLowerCase());
    world.indexes?.takenTags?.delete(org.tag);
    removed++;
  }
  return removed;
}

/**
 * Durée, en années, pendant laquelle le monde se souvient de quelqu'un.
 * Un joueur ordinaire est oublié dès sa retraite ; un multiple champion
 * international reste une référence pendant des décennies.
 */
function memoryYears(p) {
  const titles = p.stats?.internationalTitles ?? 0;
  const peak = p.stats?.peakRating ?? 0;
  return Math.min(40, titles * 6 + Math.max(0, peak - 78) * 1.2);
}

/** Identifiants du staff réellement en poste dans une équipe active. */
function staffInPost(world) {
  const ids = new Set();
  for (const team of Object.values(world.teams)) {
    if (!team.active) continue;
    if (team.coachId) ids.add(team.coachId);
    if (team.managerId) ids.add(team.managerId);
  }
  return ids;
}

/** Population maximale conservée en mémoire (et donc en sauvegarde). */
export const MAX_POPULATION = 700;

/**
 * Nombre de retraités que le monde garde en mémoire, même sous pression.
 *
 * Ce n'est pas un plafond de population supplémentaire : le plafond reste
 * `MAX_POPULATION`. C'est un **ordre d'oubli** : la mémoire n'est plus la
 * première chose sacrifiée.
 *
 * Sa valeur est bornée par la taille de sauvegarde, qui est la seule contrainte
 * réellement externe — le quota du navigateur. Une réserve de 85, égale à
 * l'équilibre observé auparavant, portait la sauvegarde à 2 517 Ko pour une
 * limite de 2 600 : la marge restante y passait entièrement. On garde donc
 * moins de monde, mais on garde les bons — le tri par palmarès puis par
 * récence fait que ce sont les mémorables qui restent.
 */
export const MEMORY_QUOTA = 50;

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
  // Visibilité avant retraites : la réputation et l'audience de l'année qui
  // s'achève glissent vers ce qui les justifie, pour tout le monde et par un
  // seul chemin de code — joueur compris (étape 6, §K).
  const visibility = runVisibilityCycle(world);
  const retired = runRetirements(world, rng);
  const spawned = spawnNewGeneration(world, rng);
  refreshOrgs(world, rng);
  // Avant l'élagage : sans cela, un entraîneur fraîchement reconverti serait
  // effacé par la pression démographique la même année, avant d'avoir pu être
  // recruté par qui que ce soit.
  // Les départs d'abord : c'est ce qui ouvre les postes que le marché comble.
  const coachsPartis = runCoachRetirements(world, rng);
  const coachs = runCoachMarket(world, rng);
  // Les équipes d'entrée qui n'ont rien produit disparaissent : c'est la
  // contrepartie de leur formation libre.
  const folded = dissolveFailedAmateurTeams(world, rng);
  const pruned = pruneWorld(world);
  return {
    retired: retired.length, spawned: spawned.length, pruned,
    folded: folded.length, visibility,
    coachsRecrutes: coachs.length, coachsPartis: coachsPartis.length,
  };
}

/** Formation spontanée d'équipes amateurs, à partir des joueurs disponibles. */
export function runAmateurFormation(world, rng) {
  return formAmateurTeams(world, rng);
}

/** Le marché des transferts, hors joueur. */
export function runMarket(world, rng) {
  if (world.week % 2 !== 0) return [];
  return runNpcTransferWindow(world, rng, { maxMoves: 24 });
}

/**
 * Vie contractuelle et carrières des PNJ (étape 4).
 *
 * L'ordre compte : les contrats échus sont d'abord arbitrés — ce qui libère des
 * joueurs et ouvre des places —, les licenciements suivent, puis les agents
 * libres démarchent le marché ainsi rouvert. Les équipes, elles, continuent de
 * chercher par `runMarket` : les deux côtés du marché coexistent.
 */
export function runCareerCycle(world, rng) {
  tickIdleWeeks(world);
  const rotations = runRotation(world, rng);
  const benchSignings = runBenchRecruitment(world, rng);
  const contracts = runContractCycle(world, rng);
  const released = runReleases(world, rng);
  const market = runFreeAgentMarket(world, rng);
  return {
    contracts,
    released: released.length,
    rotations: rotations.length,
    benchSignings: benchSignings.length,
    ...market,
  };
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

    // 1. On promeut d'abord ses propres remplaçants — le meilleur, et non le
    //    premier arrivé : la promotion interne est une décision sportive.
    while (missing > 0 && team.subs.length > 0) {
      const promoted = bestSubFor(world, team) ?? team.subs[0];
      const i = team.subs.indexOf(promoted);
      if (i >= 0) team.subs.splice(i, 1);
      const person = world.persons[promoted];
      if (person) {
        team.roster.push(promoted);
        person.benchedSince = null;
        person.startsSince = world.week;
        missing--;
        if (isTracing()) {
          trace(TRACE.ROSTER, world.week, {
            decision: 'promotion',
            teamId: team.id,
            orgName: org.name,
            promoted: person.nick,
            promotedId: person.id,
            factors: [{ key: 'vacancy', label: 'place de titulaire libérée', delta: 1 }],
          });
        }
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
      recordStint(world, candidate, team, org, world.week);
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
