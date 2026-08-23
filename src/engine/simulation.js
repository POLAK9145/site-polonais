/**
 * SimulationEngine (§55).
 *
 * Ordonnance une semaine de monde : calendrier, compétitions, progression,
 * marché, économie, événements. Le joueur n'est qu'un habitant de plus de ce
 * monde — sa semaine est traitée par les mêmes systèmes que celle des PNJ,
 * avec en plus la couche de décision.
 */

import { RNG, clamp } from './rng.js';
import { GAMES_BY_ID } from '../data/games.js';
import { ACTIVITIES_BY_ID } from '../data/training.js';
import { generateWorld } from './worldgen.js';
import {
  createPerson,
  STATUS,
  baseRating,
  age as personAge,
  effectiveRating,
} from './person.js';
import { createOrg, createTeam } from './org.js';
import { addToRoster, removeFromRoster, computeSynergyTarget, detachFromAllTeams, recordStint } from './team.js';
import { progressPerson, updateForm, burnoutPressure } from './progression.js';
import { decayMetaShock } from './meta.js';
import { onWeekStart, onWeekEnd, runWeek as runSeasonWeek, ensureSeasonState } from './season.js';
import {
  simulateNpcs,
  simulateTeams,
  simulateGames,
  simulateOrgEconomy,
  runYearlyCycle,
  runMarket,
  runCareerCycle,
  fillEmptyRosters,
  runAmateurFormation,
  decayWorldRelations,
  retirePerson,
} from './worldSim.js';
import {
  releasePlayer,
  signPlayer,
  collectOffers,
  evaluateInterest,
  buildOffer as buildOfferRaw,
} from './transfers.js';
import { createCareer, difficultyOf, lifestyleOf, logTimeline, addMemory, trackGamePlayed, trackOrg } from './career.js';
import { adjustRelation, REL_TAGS } from './relations.js';
import { createEffects } from './events/effects.js';
import {
  pickEvent,
  presentEvent,
  resolveEvent,
  runScheduledEffects,
  restorePicks,
  getEvent,
  queueChain,
} from './events/engine.js';
import { initEvents } from './events/index.js';
import { matchHighlights } from './match.js';
import { weekOfYear, yearOf, isTransferWindow, WEEKS_PER_YEAR } from './time.js';
import { validateWorld, validateCareer } from './validator.js';
import { checkAchievements, trackLowPoint } from './achievements.js';
import { gainFollowers } from './reputation.js';
import { contextPressure, crashRisk, LOAD_STATES } from './load.js';
import { situationOf } from './events/situation.js';
import { rivalryStatus, closeRivalry } from './relations.js';
import { isTracing, trace, TRACE } from './trace.js';

/** Crée une session complète : monde généré + carrière du joueur. */
export function createSession(config) {
  const {
    seed = Date.now(),
    startYear = 2030,
    difficulty = 'standard',
    scale = 1,
    player,
  } = config;

  initEvents();
  const world = generateWorld({ seed, startYear, scale });
  const rng = RNG.fromState(world.rngState).fork('career');

  const person = createPlayerPerson(world, rng, player);
  world.persons[person.id] = person;
  world.playerId = person.id;

  const career = createCareer(world, person, {
    difficulty,
    originId: player.originId,
    familyId: player.familyId,
    money: player.money ?? 500,
    seed,
    scenarioId: player.scenarioId ?? null,
  });
  trackGamePlayed(career, person.gameId);
  logTimeline(career, world, `Début de carrière sur ${GAMES_BY_ID[person.gameId].name}.`, {
    kind: 'career',
    important: true,
  });

  // Les jeux solo permettent de concourir sans structure : on crée une
  // « équipe de soi-même » pour que le joueur puisse entrer en tournoi.
  const game = GAMES_BY_ID[person.gameId];
  if (game.teamSize === 1) createSelfTeam(world, rng, person);

  const session = {
    world,
    career,
    rng,
    pendingDecision: null,
    lastReport: null,
  };
  world.rngState = rng.state;
  return session;
}

function createPlayerPerson(world, rng, player) {
  // Commencer jeune laisse mécaniquement plus de marge de progression : c'est
  // le vrai coût d'un départ tardif (§4, origine « late_bloomer »).
  const youthBonus = clamp(23 - (player.age ?? 18), 0, 8);
  const person = createPerson(rng, {
    regionId: player.regionId,
    age: player.age,
    baseLevel: player.baseLevel ?? 42,
    spread: 9,
    attrBias: player.attrBias ?? {},
    potentialBias: (player.potentialBias ?? 0) + youthBonus,
    isPlayer: true,
    absWeek: world.week,
    takenNicks: world.indexes.takenNicks,
    gameId: player.gameId,
    familiarity: player.familiarity ?? 0.3,
    traitCount: 3,
    forcedTraits: player.traits ?? [],
    identity: {
      firstName: player.firstName,
      lastName: player.lastName,
      nick: player.nick,
      country: player.country,
    },
  });
  person.followers = player.startFollowers ?? 0;
  person.reputation.community = player.startFollowers ? 12 : 3;
  person.reputation.public = player.startFollowers ? 6 : 1;
  person.observations = 0;
  person.protectedFromPruning = true;
  return person;
}

function createSelfTeam(world, rng, person) {
  const org = createOrg(rng, {
    regionId: person.regionId,
    tier: 1,
    takenNames: world.indexes.takenOrgNames,
    takenTags: world.indexes.takenTags,
    absWeek: world.week,
  });
  org.name = `${person.nick} (sans structure)`;
  org.isSelfOrg = true;
  org.budget = 0;
  org.yearlyIncome = 0;
  world.orgs[org.id] = org;
  const team = createTeam(rng, { org, gameId: person.gameId, absWeek: world.week, tierOverride: 1 });
  team.isSelfTeam = true;
  world.teams[team.id] = team;
  addToRoster(world, team, person.id, { initial: true });
  person.status = STATUS.AMATEUR;
  person.contract = null;
  return team;
}

/** Contexte partagé par les événements et les effets. */
export function buildContext(session) {
  const { world, career, rng } = session;
  const person = world.persons[career.personId];
  const team = person.teamId ? world.teams[person.teamId] : null;
  const org = person.orgId ? world.orgs[person.orgId] : null;
  const game = GAMES_BY_ID[person.gameId];
  const gameState = world.gameStates[person.gameId];

  const ctx = {
    world,
    career,
    state: career.eventState,
    person,
    team,
    org,
    game,
    gameState,
    rng,
    difficulty: difficultyOf(career),
    age: personAge(person, world.week),
    rating: baseRating(person, game),
    hasTeam: !!team && team.active && !team.isSelfTeam,
    isTransferWindow: isTransferWindow(world.week),
    recentPerformance: averageRecentScore(career),
    buildOffer: (t, interest) => buildOfferRaw(world, t, person, interest, rng),
  };
  ctx.fx = createEffects(ctx);
  // Ce que le joueur sait et ressent de sa situation (étape 7C). Calculé une
  // fois par contexte : les conditions, les libellés et les conséquences le
  // lisent, et n'ont donc pas à refaire chacune leur propre lecture d'état.
  ctx.situation = situationOf(ctx);
  return ctx;
}

function averageRecentScore(career) {
  const scores = career.counters.recentScores ?? [];
  if (scores.length === 0) return 6;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

/**
 * Avance d'une semaine.
 * Retourne un rapport : matchs du joueur, dépêches, effets différés,
 * et éventuellement une décision en attente.
 */
export function advanceWeek(session) {
  const { world, career } = session;
  // Le monde ne s'arrête pas parce que le joueur a raccroché (§49) : les
  // scènes, les équipes et les générations continuent sans lui.
  if (career.retired) return advanceWorldOnly(session);
  if (session.pendingDecision) return session.lastReport;

  const rng = session.rng;
  world.week++;
  career.counters.weeks++;
  ensureSeasonState(world);

  const report = {
    week: world.week,
    year: yearOf(world.week),
    matches: [],
    news: [],
    messages: [],
    decision: null,
    finishedCompetitions: [],
    levelUps: [],
  };

  // 1. Calendrier : création des compétitions de la période.
  onWeekStart(world, rng);

  // 2. Le monde vit.
  simulateGames(world, rng);
  simulateNpcs(world, rng);
  simulateTeams(world, rng);
  simulateOrgEconomy(world, rng);
  runMarket(world, rng);
  runCareerCycle(world, rng);
  runAmateurFormation(world, rng);
  fillEmptyRosters(world, rng);
  decayWorldRelations(world);

  // 3. Compétitions de la semaine.
  const { played, finished } = runSeasonWeek(world, rng);
  const person = world.persons[career.personId];
  for (const result of played) {
    const perf = result.perfs.find((p) => p.personId === person.id);
    if (!perf) continue;
    report.matches.push(buildMatchReport(world, career, result, perf));
  }
  report.finishedCompetitions = finished
    .filter((c) => c.teamIds.includes(person.teamId))
    .map((c) => summarizeCompetition(world, career, c, person));

  // 4. Le joueur : progression, forme, méta.
  runPlayerWeek(session, person, report);

  // 5. Argent.
  applyPlayerEconomy(session, person, report);

  // 6. Conséquences différées.
  const ctx = buildContext(session);
  const deferredMessages = runScheduledEffects(ctx);
  report.messages.push(...deferredMessages);

  // 7. Cycles annuels et fin de saison.
  if (weekOfYear(world.week) === 51) {
    const cycle = runYearlyCycle(world, rng);
    report.messages.push(...seasonSummaryMessages(world, career, cycle));
    career.counters.seasonsCompeted++;
  }
  onWeekEnd(world, rng);

  // 8. Contrats arrivés à terme sans prolongation.
  checkContractExpiry(session, person, report);

  // 9. Retraite déclenchée par un choix ou une échéance.
  if (maybeRetire(session, person, report)) {
    world.rngState = rng.state;
    session.lastReport = report;
    return report;
  }

  // 10. Rupture spontanée : un joueur qui accumule sans jamais lever le pied
  //      peut craquer sans avoir choisi « tenir encore un peu ». Sans ce
  //      chemin, la rupture n'était accessible qu'à celui qui l'avait
  //      explicitement acceptée — mesuré, la chaîne ne partait jamais autrement.
  maybeSpontaneousCrash(session, report);

  // 11. Événement de la semaine.
  maybeCloseRivalry(session, report);
  maybeFireEvent(session, report);

  // 11. Succès.
  const unlocked = checkAchievements(session);
  for (const a of unlocked) report.messages.push(`Succès débloqué : ${a.label}`);

  // 12. Dépêches du monde concernant la scène du joueur.
  report.news = world.news.filter((n) => n.week === world.week).slice(-6);

  // 13. Garde-fou de cohérence.
  const issues = validateCareer(world, career);
  if (issues.length > 0) {
    report.validationIssues = issues;
    repairCareer(world, career, issues);
  }

  world.rngState = rng.state;
  session.lastReport = report;
  return report;
}

/**
 * Avance le monde seul, après la retraite du joueur.
 * Même pipeline, sans la couche de décision ni la progression du joueur.
 */
export function advanceWorldOnly(session) {
  const { world, rng } = session;
  world.week++;
  ensureSeasonState(world);
  const report = {
    week: world.week,
    year: yearOf(world.week),
    matches: [],
    news: [],
    messages: [],
    decision: null,
    finishedCompetitions: [],
    retired: true,
    worldOnly: true,
  };
  onWeekStart(world, rng);
  simulateGames(world, rng);
  simulateNpcs(world, rng);
  simulateTeams(world, rng);
  simulateOrgEconomy(world, rng);
  runMarket(world, rng);
  runCareerCycle(world, rng);
  runAmateurFormation(world, rng);
  fillEmptyRosters(world, rng);
  decayWorldRelations(world);
  runSeasonWeek(world, rng);
  if (weekOfYear(world.week) === 51) runYearlyCycle(world, rng);
  onWeekEnd(world, rng);
  report.news = world.news.filter((n) => n.week === world.week).slice(-6);
  world.rngState = rng.state;
  session.lastReport = report;
  return report;
}

/**
 * La routine réellement appliquée, une fois retirés les créneaux impossibles.
 *
 * Extrait pour que l'interface annonce le coût de la routine EFFECTIVE et non
 * celui de la routine affichée (étape 8A). Un joueur sans équipe ne peut pas
 * faire de scrims : son choix est silencieusement remplacé, et lui annoncer la
 * charge du choix impossible serait un mensonge de plus.
 */
export function effectiveRoutineOf(routine, team) {
  const gardes = (routine ?? []).filter((id) => {
    const act = ACTIVITIES_BY_ID[id];
    if (!act) return false;
    if (act.requiresTeam && !team) return false;
    return true;
  });
  return gardes.length > 0 ? gardes : ['mechanics', 'rest'];
}

function runPlayerWeek(session, person, report) {
  const { world, career, rng } = session;
  const game = GAMES_BY_ID[person.gameId];
  const team = person.teamId ? world.teams[person.teamId] : null;

  decayMetaShock(person, 1);

  const effectiveRoutine = effectiveRoutineOf(career.routine, team);

  const learningGame = career.learningGameId ? GAMES_BY_ID[career.learningGameId] : null;
  const cq = team ? coachQualityOf(world, team) : 0;
  const matchLoad = report.matches.length;

  progressPerson(
    person,
    {
      game,
      routine: effectiveRoutine,
      coachQuality: cq,
      weeks: 1,
      absWeek: world.week,
      matchLoad,
      // Pression du contexte : c'est elle qui fait dépendre la charge de la
      // situation réelle du joueur — niveau de la structure, statut de
      // titulaire, attentes, résultats récents — et non de sa seule routine.
      pressure: contextPressure(world, person, { team, org: team ? world.orgs[team.orgId] : null, career }),
      learningGameId: career.learningGameId,
      learningGame,
    },
    rng,
  );
  updateForm(person, rng, 1);

  const life = lifestyleOf(career);
  person.morale = clamp(person.morale + life.moraleWeekly, 0, 100);
  person.stress = clamp(person.stress + life.stress, 0, 100);

  // Audience : elle vit même sans événement, portée par l'activité choisie.
  const audienceSlots = effectiveRoutine.reduce(
    (s, id) => s + (ACTIVITIES_BY_ID[id]?.audience ?? 0),
    0,
  );
  if (audienceSlots > 0) {
    // L'audience sature contre ce que la notoriété réelle justifie : on ne
    // devient pas la personne la plus suivie du monde en streamant beaucoup,
    // il faut aussi qu'il y ait une raison de vous suivre. Le plafond et le
    // rendement décroissant sont appliqués par `gainFollowers`, qui est le seul
    // chemin d'écriture de l'audience dans tout le moteur.
    const raw =
      (55 + Math.sqrt(person.followers) * 2.4) *
      audienceSlots *
      (0.4 + person.attrs.entertainment / 100);
    gainFollowers(world, person, raw, 'activité hebdomadaire');
    person.reputation.public = clamp(person.reputation.public + audienceSlots * 0.05, 0, 100);
  } else if (person.followers > 1000) {
    // Une audience qu'on n'entretient pas s'érode.
    person.followers = Math.round(person.followers * 0.998);
  }

  const rating = baseRating(person, game);
  if (rating > person.stats.peakRating) {
    person.stats.peakRating = rating;
    person.stats.peakWeek = world.week;
    career.counters.highestRating = rating;
  }
  // Pic d'audience : l'audience finale seule masque les carrières qui ont
  // été très populaires puis oubliées.
  if (person.followers > (person.stats.peakFollowers ?? 0)) {
    person.stats.peakFollowers = person.followers;
  }
  if (!team) career.counters.weeksWithoutTeam = (career.counters.weeksWithoutTeam ?? 0) + 1;
  else career.counters.weeksWithoutTeam = 0;
  trackLowPoint(career, world, rating);

  // Statut le plus élevé jamais atteint. Le statut courant ne suffit pas :
  // à la retraite il vaut « retired », ce qui effaçait toute trace d'être
  // passé professionnel.
  const reached = (career.counters.reachedStatus ??= {});
  if (person.status === STATUS.SEMIPRO || person.status === STATUS.PRO) reached.semipro = true;
  if (person.status === STATUS.PRO) reached.pro = true;
}

// `audienceCeiling` vit désormais dans `reputation.js`, avec la fonction qui
// l'applique : il n'y a qu'une source de vérité pour l'audience (§K). Le
// ré-export garde les appelants existants — la vue notamment — inchangés.
export { audienceCeiling } from './reputation.js';

function coachQualityOf(world, team) {
  if (!team?.coachId) return 0;
  const c = world.persons[team.coachId];
  if (!c) return 0;
  return clamp(
    (c.attrs.reading * 0.3 + c.attrs.metaSense * 0.25 + c.attrs.communication * 0.25 + c.attrs.leadership * 0.2) / 100,
    0,
    1,
  );
}

function applyPlayerEconomy(session, person, report) {
  const { world, career } = session;
  const life = lifestyleOf(career);

  if (person.contract?.salary) career.money += person.contract.salary / 52;
  career.money -= life.cost / 4.33; // coût hebdomadaire

  for (const income of world.pendingPlayerIncome) {
    career.money += income.amount;
    report.messages.push(`${income.label} : +${Math.round(income.amount).toLocaleString('fr-FR')} €`);
  }
  world.pendingPlayerIncome = [];

  if (career.money < 0) {
    career.monthlyDebt += -career.money;
    career.money = 0;
    person.stress = clamp(person.stress + 1.2, 0, 100);
  }
}

function buildMatchReport(world, career, result, perf) {
  const isA = result.teamAId === perf.teamId;
  const opponentId = isA ? result.teamBId : result.teamAId;
  const opponent = world.teams[opponentId];
  const opponentOrg = opponent ? world.orgs[opponent.orgId] : null;

  const scores = career.counters.recentScores ?? [];
  scores.push(perf.score);
  while (scores.length > 6) scores.shift();
  career.counters.recentScores = scores;

  const won = result.winnerId === perf.teamId;
  if (result.stakes >= 0.55) {
    logTimeline(career, world, `${won ? 'Victoire' : 'Défaite'} — ${result.label} contre ${opponentOrg?.name ?? '?'} (${result.scoreA}-${result.scoreB}).`, {
      kind: 'match',
      important: result.stakes >= 0.8,
    });
  }
  if (result.comeback && won) {
    addMemory(career, world, {
      kind: 'comeback',
      title: 'Le renversement',
      text: `Mené au bord de l'élimination contre ${opponentOrg?.name ?? 'l’adversaire'}, vous avez retourné la série.`,
    });
  }
  if (result.upset && won && result.stakes > 0.5) {
    addMemory(career, world, {
      kind: 'upset',
      title: 'L’exploit',
      text: `Personne ne vous donnait gagnant contre ${opponentOrg?.name ?? 'le favori'}.`,
    });
  }

  return {
    label: result.label,
    opponent: opponentOrg?.name ?? 'Adversaire',
    scoreFor: isA ? result.scoreA : result.scoreB,
    scoreAgainst: isA ? result.scoreB : result.scoreA,
    won,
    score: perf.score,
    mvp: result.mvpId === perf.personId,
    stakes: result.stakes,
    highlights: matchHighlights(world, result),
  };
}

function summarizeCompetition(world, career, comp, person) {
  const placement = comp.placements.find((p) => p.teamId === person.teamId);
  const rank = placement?.rank ?? null;
  const isChampion = comp.championId === person.teamId;
  if (isChampion) {
    // Gagner un tournoi communautaire est un fait réel, mais ce n'est pas un
    // titre : le récit et le compteur `stats.titles` doivent dire la même
    // chose, sans quoi une carrière « sans titre » se met à raconter qu'elle
    // en a remporté sept.
    const major = comp.tierLevel >= 3;
    logTimeline(career, world, major ? `Titre : ${comp.name}.` : `Vainqueur de ${comp.name}.`, {
      kind: major ? 'title' : 'minor_title',
      important: major,
    });
    addMemory(career, world, {
      kind: major ? 'title' : 'minor_title',
      title: comp.name,
      text: `Vous remportez ${comp.name}.`,
    });
    career.counters.titlesByTier[comp.tierId] = (career.counters.titlesByTier[comp.tierId] ?? 0) + 1;
  } else if (rank === 2) {
    logTimeline(career, world, `Finaliste : ${comp.name}.`, { kind: 'result', important: true });
  }
  return { name: comp.name, rank, champion: isChampion, prizePool: comp.prizePool };
}

function seasonSummaryMessages(world, career, cycle) {
  return [
    `Fin de saison ${yearOf(world.week)} : ${cycle.retired} retraites, ${cycle.spawned} nouveaux joueurs sur les scènes.`,
  ];
}

function checkContractExpiry(session, person, report) {
  const { world, career } = session;
  if (!person.contract) return;
  if (world.week <= person.contract.endWeek) return;
  const orgName = world.orgs[person.orgId]?.name ?? 'votre organisation';
  releasePlayer(world, person.id, world.week, 'fin de contrat');
  career.counters.timesReleased++;
  logTimeline(career, world, `Fin de contrat avec ${orgName}, non prolongé.`, {
    kind: 'contract',
    important: true,
  });
  report.messages.push(`Votre contrat avec ${orgName} est arrivé à terme. Vous êtes sans équipe.`);
}

function maybeRetire(session, person, report) {
  const { world, career, rng } = session;
  const lastSeason = career.flags.last_season;
  const forced = career.pendingRetirement === 'immediate';
  const seasonOver = lastSeason && world.week >= lastSeason;

  // Fin de carrière subie : à un moment, ce n'est plus une décision. Sans ce
  // garde-fou, un joueur pouvait « continuer » indéfiniment jusqu'à 40 ans
  // sans équipe, ce qu'aucune carrière réelle ne fait.
  let inevitable = null;
  if (!forced && !seasonOver) {
    const a = personAge(person, world.week);
    const noTeamYears = (career.counters.weeksWithoutTeam ?? 0) / WEEKS_PER_YEAR;
    if (a >= 34) inevitable = 'âge';
    else if (a >= 29 && noTeamYears >= 2) inevitable = 'plus aucune équipe intéressée';
    else if (noTeamYears >= 4) inevitable = 'sortie de la compétition';
    // L'usure n'emporte que les carrières durablement enlisées : sans ce
    // resserrement, tout le monde arrêtait mécaniquement à 27 ans.
    else if (a >= 28 && person.morale < 8 && person.stats.titles === 0 && rng.chance(0.04)) {
      inevitable = 'usure';
    } else {
      // Charge accumulée (étape 7B). `burnoutPressure` existait déjà, portait le
      // commentaire « sert aux retraites » et n'était appelée nulle part : la
      // longévité ne dépendait que de l'âge — 14 carrières prudentes sur 14
      // s'arrêtaient au plafond de 34 ans.
      //
      // Ce n'est jamais automatique. Arrêter est la dernière issue, pas la
      // première : un joueur surchargé a d'abord toutes les occasions de
      // ralentir, de récupérer ou de changer de routine.
      //
      // ATTENTION : ce test est évalué **chaque semaine**. Une première version
      // plafonnait la probabilité à 3 %, écrite en pensant à un ordre de
      // grandeur annuel — or 3 % par semaine valent 79,5 % par an. Mesuré, les
      // carrières s'arrêtaient si tôt que certaines graines ne vivaient plus que
      // six ou sept types d'événements sur huit ans. Les valeurs ci-dessous sont
      // donc exprimées pour ce qu'elles sont : au maximum 0,25 % par semaine,
      // soit environ 12 % par an à pression maximale.
      const pressure = burnoutPressure(person);
      if (a >= 23 && pressure > 1.1) {
        const chance = clamp((pressure - 1.1) * 0.0012, 0, 0.0025);
        if (rng.chance(chance)) inevitable = 'charge accumulée';
      }
    }
    if (!inevitable) return false;
  }
  retireCareer(
    session,
    forced ? 'décision personnelle' : seasonOver ? 'dernière saison annoncée' : inevitable,
  );
  report.messages.push('Votre carrière de joueur s’achève.');
  report.retired = true;
  return true;
}

export function retireCareer(session, reason) {
  const { world, career, rng } = session;
  const person = world.persons[career.personId];
  releasePlayer(world, person.id, world.week, 'retraite');
  detachFromAllTeams(world, person.id);
  person.status = STATUS.RETIRED;
  person.retiredWeek = world.week;
  person.retirementReason = reason;
  career.retired = true;
  career.retiredWeek = world.week;
  career.retirementPath = reason;
  logTimeline(career, world, `Fin de carrière (${reason}).`, { kind: 'career', important: true });
  world.news.push({
    week: world.week,
    headline: `${person.nick} met un terme à sa carrière`,
    body: `Après ${Math.round((world.week - career.startWeek) / WEEKS_PER_YEAR)} ans de compétition.`,
    aboutPersonId: person.id,
  });
  world.rngState = rng.state;
}

/**
 * Rupture spontanée sous charge accumulée (étape 7B).
 *
 * `crashRisk` ne dépasse jamais 9 % par semaine et ne s'applique qu'aux états
 * hauts : la rupture reste possible sans être obligatoire, ce qui est
 * exactement la propriété demandée. La chaîne narrative existante prend le
 * relais — on programme `burnout_crash`, on ne réécrit pas l'épisode ici.
 */
function maybeSpontaneousCrash(session, report) {
  const { world, career, rng } = session;
  const person = world.persons[career.personId];
  const risk = crashRisk(person);
  if (risk <= 0) return false;
  // Une rupture déjà programmée ne se cumule pas avec une autre.
  const pending = career.eventState.pendingChains.some(
    (c) => c.eventId === 'burnout_crash' || c.eventId === 'burnout_recovery',
  );
  if (pending || person.load?.state === LOAD_STATES.BURNOUT) return false;
  if (!rng.chance(risk)) return false;

  const ctx = buildContext(session);
  queueChain(ctx, 'burnout_crash', { delay: rng.int(1, 4), expires: 26 });
  if (isTracing()) {
    trace(TRACE.LOAD, world.week, {
      decision: 'crash_queued',
      personId: person.id,
      state: person.load?.state,
      load: Math.round(person.load?.value ?? 0),
      heavyStreak: person.load?.heavyStreak ?? 0,
      episodes: person.load?.episodes ?? 0,
      risk: Math.round(risk * 1000) / 1000,
    });
  }
  return true;
}

/**
 * Une rivalité devenue hors sujet doit s'éteindre (étape 7E).
 *
 * Une rivalité n'est pas un souvenir, c'est une tension avec quelqu'un qui joue
 * encore. Quand elle meurt, elle rejoint les rivalités passées — le récit la
 * garde, le présent la lâche — et une autre pourra naître un an plus tard.
 */
function maybeCloseRivalry(session, report) {
  const { world, career } = session;
  if (!career.rivalId) return;
  const person = world.persons[career.personId];
  const etat = rivalryStatus(world, person, career);
  if (etat.vivante) return;
  const nick = etat.rival?.nick ?? 'Votre rival';
  const entry = closeRivalry(career, world, { raison: etat.raison, week: world.week });
  if (!entry) return;
  const phrases = {
    'retraité': `${nick} a raccroché. Il n'y a plus personne à battre.`,
    'autre scène': `${nick} joue à autre chose désormais. Vos routes ne se croiseront plus.`,
    'réconciliée': `Ce que vous aviez avec ${nick} n'est plus une rivalité depuis longtemps.`,
    'disparu': `On n'entend plus parler de ${nick}.`,
  };
  const texte = phrases[etat.raison] ?? `La rivalité avec ${nick} s'est éteinte.`;
  logTimeline(career, world, texte, { kind: 'rivalry', important: true });
  report.messages.push(texte);
}

function maybeFireEvent(session, report) {
  const { career, world } = session;
  // Un événement toutes les 2 semaines au minimum : au-delà, la carrière
  // devient un fil d'actualité et plus une simulation.
  if (world.week - career.eventState.lastEventWeek < 2) return;
  const ctx = buildContext(session);
  const def = pickEvent(ctx);
  if (!def) return;
  const presented = presentEvent(def, ctx);
  career.eventState.lastPresented = presented;

  if (presented.auto) {
    // Événement sans choix : il se résout immédiatement.
    restorePicks(ctx, presented.picks);
    ctx.chainData = presented.chainData;
    const outcome = resolveEvent(def, null, ctx);
    report.decision = { ...presented, resolved: true, outcome };
    career.counters.decisions++;
    return;
  }

  session.pendingDecision = { eventId: def.id, presented };
  career.pendingDecision = session.pendingDecision;
  report.decision = presented;
}

/** Applique le choix du joueur sur l'événement en attente. */
export function resolveDecision(session, choiceId) {
  const pending = session.pendingDecision ?? session.career.pendingDecision;
  if (!pending) return null;
  const def = getEvent(pending.eventId);
  if (!def) {
    session.pendingDecision = null;
    session.career.pendingDecision = null;
    return null;
  }
  const ctx = buildContext(session);
  restorePicks(ctx, pending.presented.picks);
  ctx.chainData = pending.presented.chainData;
  const outcome = resolveEvent(def, choiceId, ctx);
  session.career.counters.decisions++;
  session.career.decisionsLog = session.career.decisionsLog ?? [];
  session.career.decisionsLog.push({
    week: session.world.week,
    eventId: def.id,
    choiceId,
  });
  session.pendingDecision = null;
  session.career.pendingDecision = null;
  session.world.rngState = session.rng.state;
  return { outcome, offers: session.career.offers };
}

/** Accepte une offre de contrat présentée au joueur. */
export function acceptOffer(session, index) {
  const { world, career } = session;
  const offer = career.offers[index];
  if (!offer) return { ok: false, reason: 'Offre introuvable' };
  const person = world.persons[career.personId];
  const res = signPlayer(world, person, offer, { week: world.week });
  career.offers = [];
  if (!res.ok) return res;
  trackOrg(career, res.org.id);
  trackGamePlayed(career, person.gameId);
  logTimeline(career, world, `Signature chez ${res.org.name} (${Math.round(offer.salary).toLocaleString('fr-FR')} €/an).`, {
    kind: 'contract',
    important: true,
  });
  world.rngState = session.rng.state;
  return res;
}

export function declineOffers(session) {
  session.career.offers = [];
}

/** Délai entre deux démarchages : sans lui, on spamme jusqu'à réussir (§79). */
export const SEEK_COOLDOWN_WEEKS = 4;

export function canSeekTeam(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  if (career.retired || person.status === STATUS.RETIRED) return { ok: false, reason: 'Carrière terminée' };
  const last = career.lastSeekWeek ?? -999;
  const remaining = SEEK_COOLDOWN_WEEKS - (world.week - last);
  if (remaining > 0) return { ok: false, reason: `Réessayez dans ${remaining} semaine(s)`, remaining };
  return { ok: true };
}

/**
 * Démarcher activement des équipes.
 *
 * Indispensable : sans cette action, un joueur sans équipe ne pouvait
 * qu'attendre qu'un événement le remarque, et pouvait passer des années
 * bloqué. Ici il agit — mais le résultat reste dicté par l'intérêt réel des
 * structures, avec le détail des facteurs (§59).
 */
export function seekTeam(session) {
  const { world, career, rng } = session;
  const gate = canSeekTeam(session);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const person = world.persons[career.personId];
  career.lastSeekWeek = world.week;

  // Démarcher soi-même donne accès à des structures qui ne vous auraient pas
  // contacté, au prix d'un seuil d'intérêt plus bas — donc de moins bonnes
  // offres.
  const offers = collectOffers(world, person, rng, { maxOffers: 3, minScore: 26 });
  world.rngState = rng.state;

  if (offers.length === 0) {
    person.morale = clamp(person.morale - 2, 0, 100);
    const best = bestRefusal(world, person, rng);
    return { ok: true, offers: [], refusal: best };
  }
  career.offers = offers;
  logTimeline(career, world, `Démarchage : ${offers.length} réponse(s) positive(s).`, { kind: 'transfer' });
  return { ok: true, offers };
}

/**
 * Monter sa propre équipe amateur.
 *
 * Sans cette action, un joueur qui débute dépendait entièrement de l'ouverture
 * d'une place ailleurs — et pouvait rester bloqué des années. C'est aussi la
 * façon dont la plupart des rosters amateurs se forment réellement.
 */
export function canFoundTeam(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  if (career.retired) return { ok: false, reason: 'Carrière terminée' };
  if (person.teamId && !world.teams[person.teamId]?.isSelfTeam) {
    return { ok: false, reason: 'Vous êtes déjà dans une équipe' };
  }
  const game = GAMES_BY_ID[person.gameId];
  const pool = recruitablePool(world, person, game);
  const needed = game.teamSize - 1;
  if (pool.length < needed) {
    return { ok: false, reason: 'Pas assez de joueurs libres sur cette scène' };
  }
  if (career.money < FOUND_TEAM_COST) {
    return { ok: false, reason: `Il vous faut ${FOUND_TEAM_COST} € pour les frais d'inscription` };
  }
  return { ok: true, candidates: pool.slice(0, needed + 3) };
}

// Volontairement bas : ce coût ne doit jamais verrouiller la seule porte
// d'entrée d'un joueur fauché (l'origine la plus pauvre démarre à 200 €).
export const FOUND_TEAM_COST = 150;

function recruitablePool(world, person, game) {
  const myRating = baseRating(person, game);
  return world.freeAgents
    .map((id) => world.persons[id])
    .filter(
      (p) =>
        p &&
        p.gameId === game.id &&
        p.id !== person.id &&
        p.status !== STATUS.RETIRED &&
        p.status !== STATUS.STAFF &&
        !p.teamId &&
        // On ne recrute que des joueurs d'un niveau comparable : un espoir
        // de 45 ne convainc pas un joueur de 80 de rejoindre son projet.
        baseRating(p, game) < myRating + 12,
    )
    .sort((a, b) => baseRating(b, game) - baseRating(a, game));
}

export function foundTeam(session, teamName = null) {
  const { world, career, rng } = session;
  const gate = canFoundTeam(session);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const person = world.persons[career.personId];
  const game = GAMES_BY_ID[person.gameId];

  // Une éventuelle « équipe de soi-même » solo est remplacée.
  if (person.teamId) {
    const old = world.teams[person.teamId];
    if (old?.isSelfTeam) {
      old.active = false;
      const org = world.orgs[old.orgId];
      if (org) org.alive = false;
      removeFromRoster(world, old, person.id);
    }
  }

  const org = createOrg(rng, {
    regionId: person.regionId,
    tier: 1,
    takenNames: world.indexes.takenOrgNames,
    takenTags: world.indexes.takenTags,
    absWeek: world.week,
  });
  if (teamName) org.name = teamName;
  org.budget = 0;
  org.yearlyIncome = 0;
  org.foundedByPlayer = true;
  world.orgs[org.id] = org;

  const team = createTeam(rng, { org, gameId: game.id, absWeek: world.week, tierOverride: 1 });
  team.division = 'amateur';
  world.teams[team.id] = team;

  addToRoster(world, team, person.id, { initial: true });
  person.status = STATUS.AMATEUR;
  recordStint(world, person, team, org, world.week);

  const recruits = recruitablePool(world, person, game).slice(0, game.teamSize - 1);
  for (const r of recruits) {
    addToRoster(world, team, r.id, { initial: true });
    const i = world.freeAgents.indexOf(r.id);
    if (i >= 0) world.freeAgents.splice(i, 1);
    r.status = STATUS.AMATEUR;
    recordStint(world, r, team, org, world.week);
    adjustRelation(world, person.id, r.id, 8, {
      week: world.week,
      text: `Vous avez fondé ${org.name} ensemble.`,
      tag: REL_TAGS.TEAMMATE,
      important: true,
    });
  }
  team.synergy = clamp(computeSynergyTarget(world, team) * 0.7, 10, 90);

  career.money -= FOUND_TEAM_COST;
  logTimeline(career, world, `Fondation de l'équipe ${org.name}.`, { kind: 'team', important: true });
  addMemory(career, world, {
    kind: 'early',
    title: 'Votre équipe',
    text: `Vous avez monté ${org.name} vous-même, avec ${recruits.length} joueur(s) trouvé(s) sur la scène.`,
  });
  world.rngState = rng.state;
  return { ok: true, team, org, recruits };
}

/** Explique pourquoi personne ne veut de vous : le refus doit être lisible. */
function bestRefusal(world, person, rng) {
  let best = null;
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.gameId !== person.gameId || team.isSelfTeam) continue;
    if (team.id === person.teamId) continue;
    const interest = evaluateInterest(world, team, person);
    if (!interest.viable) continue;
    if (!best || interest.score > best.interest.score) best = { team, interest };
  }
  if (!best) return null;
  const org = world.orgs[best.team.orgId];
  const worst = [...best.interest.factors].sort((a, b) => a.delta - b.delta)[0];
  return {
    orgName: org?.name ?? '—',
    score: best.interest.score,
    mainReason: worst?.label ?? 'Niveau insuffisant',
    factors: best.interest.factors,
  };
}

export function setRoutine(session, routine) {
  session.career.routine = routine.slice(0, 4);
}

export function setLifestyle(session, lifestyleId) {
  session.career.lifestyle = lifestyleId;
}

/**
 * Corrige les incohérences détectées plutôt que de les afficher (§61).
 * Ce chemin ne devrait jamais s'exécuter : sa présence dans les tests est
 * ce qui prouve que le reste du moteur est correct.
 */
function repairCareer(world, career, issues) {
  const person = world.persons[career.personId];
  for (const issue of issues) {
    switch (issue.code) {
      case 'retired_in_team':
        if (person.teamId) releasePlayer(world, person.id, world.week, 'incohérence corrigée');
        break;
      case 'contract_without_team':
      case 'contract_dead_org':
        person.contract = null;
        break;
      case 'team_disbanded':
        person.teamId = null;
        person.orgId = null;
        person.contract = null;
        person.status = STATUS.INACTIVE;
        break;
      default:
        break;
    }
  }
}

/** Avance jusqu'à ce que quelque chose se passe, ou N semaines au maximum. */
export function advanceUntilEvent(session, maxWeeks = 12) {
  const reports = [];
  for (let i = 0; i < maxWeeks; i++) {
    const report = advanceWeek(session);
    reports.push(report);
    if (report.retired) break;
    if (report.decision || report.matches.length > 0 || session.pendingDecision) break;
  }
  return reports;
}

export { validateWorld };
