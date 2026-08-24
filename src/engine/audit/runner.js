/**
 * Exécution de simulations en masse (§2, §5, §33, §34).
 *
 * Pas d'interface, pas de navigateur : on joue des carrières entières avec un
 * joueur automatique et on récolte des mesures. Ce module est volontairement
 * séparé du moteur — il n'ajoute aucune règle de jeu, il observe.
 */

import { RNG, normalizeSeed } from '../rng.js';
import { GAMES } from '../../data/games.js';
import { ORIGINS, FAMILY_PROFILES } from '../../data/origins.js';
import { REGIONS } from '../../data/regions.js';
import { generatePersonName, generateNickname } from '../names.js';
import {
  createSession,
  advanceWeek,
  advanceWorldOnly,
  resolveDecision,
  acceptOffer,
  declineOffers,
  seekTeam,
  canSeekTeam,
  foundTeam,
  canFoundTeam,
  setRoutine,
} from '../simulation.js';
import { generateWorld } from '../worldgen.js';
import { validateWorld, validateCareer } from '../validator.js';
import { STATUS } from '../person.js';
import { WEEKS_PER_YEAR, yearOf } from '../time.js';
import { createPolicyState, pickChoice, POLICY_IDS } from './policies.js';
import {
  careerMetrics,
  worldMetrics,
  orgMetrics,
  teamMetrics,
  snapshotOrgTiers,
  snapshotTeams,
  verifyLegacy,
  storyMetrics,
} from './metrics.js';

/**
 * Tire une configuration de départ variée.
 * L'audit doit couvrir l'espace des personnages possibles, pas un seul
 * archétype : sinon on mesure la trajectoire d'un profil et non le système.
 */
export function randomPlayerConfig(rng) {
  const region = rng.pick(REGIONS);
  const origin = rng.pick(ORIGINS);
  const family = rng.pick(FAMILY_PROFILES);
  const game = rng.pick(GAMES);
  const name = generatePersonName(rng, region.id);
  const age = rng.float(origin.startAge[0], origin.startAge[1]);

  return {
    firstName: name.firstName,
    lastName: name.lastName,
    nick: generateNickname(rng, new Set()),
    country: name.country,
    regionId: region.id,
    gameId: game.id,
    age,
    baseLevel: rng.gaussClamped(45, 6, 30, 62),
    attrBias: origin.attrBias,
    potentialBias: origin.potentialBias,
    familiarity: origin.familiarity,
    money: origin.money,
    startFollowers: origin.startFollowers ?? 0,
    originId: origin.id,
    familyId: family.id,
  };
}

/**
 * Joue une carrière complète et retourne ses mesures.
 *
 * Le joueur automatique agit comme un humain attentif : il résout les
 * événements selon sa politique, accepte ou refuse les offres, et cherche
 * activement une équipe quand il n'en a pas.
 */
export function runOneCareer({
  seed,
  years = 20,
  policyId = 'random',
  difficulty = 'standard',
  playerConfig = null,
  collectWorld = false,
  // Rappelé à chaque semaine jouée, pour observer une carrière PENDANT qu'elle
  // se déroule. Sans ce crochet, toute mesure en cours de route obligeait à
  // recopier la boucle d'interaction ailleurs — et une copie finit toujours par
  // diverger de l'originale, ce qui ferait mesurer autre chose que l'audit.
  onWeek = null,
  // Renvoie la session elle-même. Sert aux outils qui doivent inspecter l'état
  // final : écrans de fin de partie, sauvegardes de démonstration.
  keepSession = false,
}) {
  const configRng = new RNG(normalizeSeed(`${seed}:config`));
  const player = playerConfig ?? randomPlayerConfig(configRng);
  const policyState = createPolicyState(policyId, normalizeSeed(`${seed}:policy`));

  const session = createSession({ seed, startYear: 2030, difficulty, player });
  if (policyState.policy.routine) setRoutine(session, policyState.policy.routine);

  const orgSnapshot = collectWorld ? snapshotOrgTiers(session.world) : null;
  const teamSnapshot = collectWorld ? snapshotTeams(session.world) : null;

  const gameStart = player.gameId;
  const maxWeeks = years * WEEKS_PER_YEAR;
  let weeks = 0;
  let crash = null;
  let offersSeen = 0;
  let offersAccepted = 0;
  let seekAttempts = 0;
  let seekSuccesses = 0;
  let teamsFounded = 0;

  try {
    while (!session.career.retired && weeks < maxWeeks) {
      const report = advanceWeek(session);
      weeks++;

      if (report.decision && !report.decision.resolved) {
        const choice = pickChoice(policyState, report.decision.choices);
        if (choice) resolveDecision(session, choice.id);
        else resolveDecision(session, report.decision.choices[0]?.id);
      }

      if (session.career.offers?.length) {
        offersSeen += session.career.offers.length;
        if (policyState.policy.refuseOffers && policyState.rng.chance(0.75)) {
          declineOffers(session);
        } else {
          const res = acceptOffer(session, 0);
          if (res.ok) offersAccepted++;
        }
      }

      const person = session.world.persons[session.career.personId];
      const hasRealTeam =
        person.teamId && !session.world.teams[person.teamId]?.isSelfTeam;
      if (!hasRealTeam && person.status !== STATUS.RETIRED && canSeekTeam(session).ok) {
        seekAttempts++;
        const res = seekTeam(session);
        if (res.offers?.length) {
          offersSeen += res.offers.length;
          if (policyState.policy.refuseOffers && policyState.rng.chance(0.75)) {
            declineOffers(session);
          } else {
            const signed = acceptOffer(session, 0);
            if (signed.ok) {
              seekSuccesses++;
              offersAccepted++;
            }
          }
        } else if (canFoundTeam(session).ok && policyState.rng.chance(0.7)) {
          const founded = foundTeam(session);
          if (founded.ok) teamsFounded++;
        }
      }

      // Le rapport de la semaine est passé au crochet : sans lui, une mesure
      // du rythme ne peut regarder que la timeline, qui n'enregistre que le
      // notable — et conclurait qu'une semaine de match sans incident est une
      // semaine vide.
      if (onWeek) onWeek(session, weeks, report);
    }
  } catch (err) {
    crash = { message: err?.message ?? String(err), stack: (err?.stack ?? '').split('\n')[1]?.trim() };
  }

  const careerIssues = validateCareer(session.world, session.career);
  const worldIssues = validateWorld(session.world);

  const metrics = careerMetrics(session, { policy: policyId, gameStart });
  const legacyCheck = verifyLegacy(session);
  const story = storyMetrics(session);

  return {
    ...metrics,
    weeksSimulated: weeks,
    reachedTimeLimit: weeks >= maxWeeks && !session.career.retired,
    crash,
    careerIssues: careerIssues.map((i) => i.code),
    worldIssues: worldIssues.map((i) => i.code),
    legacyProblems: legacyCheck.problems,
    narrativeLength: legacyCheck.narrativeLength,
    story,
    interaction: { offersSeen, offersAccepted, seekAttempts, seekSuccesses, teamsFounded },
    session: keepSession ? session : null,
    world: collectWorld ? worldMetrics(session.world) : null,
    orgs: collectWorld ? orgMetrics(session.world, orgSnapshot) : null,
    teams: collectWorld ? teamMetrics(session.world, teamSnapshot) : null,
  };
}

/**
 * Monde sans joueur (§5, §34).
 *
 * On génère un monde, on crée un personnage joueur inactif (il n'agit jamais),
 * et on laisse tourner. Le monde doit continuer à produire des champions, des
 * rookies, des transferts et des retraites.
 */
export function runWorldOnly({ seed, years = 30, sampleEveryYears = 5 }) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:world`)));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });

  // Le joueur est mis à la retraite immédiatement : le monde tourne seul,
  // exactement par le chemin de code utilisé après une fin de carrière.
  session.career.retired = true;
  session.career.retiredWeek = session.world.week;
  const person = session.world.persons[session.career.personId];
  person.status = STATUS.RETIRED;

  const orgSnapshot = snapshotOrgTiers(session.world);
  const teamSnapshot = snapshotTeams(session.world);
  const samples = [{ year: 0, ...worldMetrics(session.world) }];
  const initialIds = new Set(Object.keys(session.world.persons));
  let crash = null;
  const championsByYear = [];

  try {
    for (let y = 1; y <= years; y++) {
      const seasonChampions = new Set();
      for (let w = 0; w < WEEKS_PER_YEAR; w++) {
        advanceWorldOnly(session);
        for (const comp of Object.values(session.world.competitions)) {
          if (comp && comp.status === 'done' && comp.championId && comp.tierLevel >= 4) {
            seasonChampions.add(`${comp.gameId}:${comp.championId}`);
          }
        }
      }
      championsByYear.push({ year: y, majorChampions: seasonChampions.size });
      if (y % sampleEveryYears === 0 || y === years) {
        samples.push({ year: y, ...worldMetrics(session.world) });
      }
    }
  } catch (err) {
    crash = { message: err?.message ?? String(err), stack: (err?.stack ?? '').split('\n')[1]?.trim() };
  }

  const world = session.world;
  const newcomers = Object.keys(world.persons).filter((id) => !initialIds.has(id)).length;
  const survivors = Object.keys(world.persons).filter((id) => initialIds.has(id)).length;

  return {
    seed,
    years,
    crash,
    samples,
    championsByYear,
    newcomers,
    survivors,
    finalIssues: validateWorld(world).map((i) => i.code),
    orgs: orgMetrics(world, orgSnapshot),
    teams: teamMetrics(world, teamSnapshot),
  };
}

/**
 * Trajectoires de PNJ (§6, §10, §41).
 *
 * On suit un échantillon de personnages non joueurs sur toute la durée pour
 * vérifier qu'ils ne sont pas des clones : trajectoires de niveau, nombre
 * d'équipes, titres, âge de retraite.
 */
export function runNpcTrajectories({ seed, years = 20, sample = 120 }) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:npc`)));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  session.career.retired = true;
  session.world.persons[session.career.personId].status = STATUS.RETIRED;

  const world = session.world;
  const tracked = Object.values(world.persons)
    .filter((p) => !p.isPlayer && p.status !== STATUS.STAFF)
    .slice(0, sample)
    .map((p) => ({
      id: p.id,
      startAge: (world.week - p.birthWeek) / WEEKS_PER_YEAR,
      startTeam: p.teamId,
      ceilingSnapshot: Math.max(...Object.values(p.hidden.ceilings)),
      growth: p.hidden.growth,
      teamsSeen: new Set(p.teamId ? [p.teamId] : []),
      peakSeen: 0,
      gamesSeen: new Set([p.gameId]),
      // Dernier état observé, relevé AVANT tout oubli. Sans cela, un PNJ élagué
      // par `pruneWorld` est lu comme « oublié » et non comme retraité : 104 des
      // 120 PNJ suivis tombaient dans ce cas et la part de retraités mesurée
      // s'effondrait de 0,758 à 0,133 sans que le monde ait changé de
      // comportement.
      lastStatus: p.status,
      lastTitles: p.stats.titles,
      retiredAgeSeen: null,
    }));

  const byId = new Map(tracked.map((t) => [t.id, t]));

  for (let w = 0; w < years * WEEKS_PER_YEAR; w++) {
    advanceWorldOnly(session);
    if (w % 8 !== 0) continue;
    for (const t of tracked) {
      const p = world.persons[t.id];
      if (!p) continue;
      if (p.teamId) t.teamsSeen.add(p.teamId);
      t.gamesSeen.add(p.gameId);
      t.peakSeen = Math.max(t.peakSeen, p.stats.peakRating);
      t.lastStatus = p.status;
      t.lastTitles = p.stats.titles;
      if (p.retiredWeek && t.retiredAgeSeen === null) {
        t.retiredAgeSeen = Math.round(((p.retiredWeek - p.birthWeek) / WEEKS_PER_YEAR) * 10) / 10;
      }
    }
  }

  const trajectories = tracked.map((t) => {
    const p = world.persons[t.id];
    return {
      id: t.id,
      startAge: Math.round(t.startAge * 10) / 10,
      alive: !!p,
      // Le statut du dernier relevé, qu'il soit encore en mémoire ou non.
      status: t.lastStatus,
      forgotten: !p,
      teams: t.teamsSeen.size,
      games: t.gamesSeen.size,
      peak: Math.round(t.peakSeen * 10) / 10,
      ceiling: Math.round(t.ceilingSnapshot),
      growth: Math.round(t.growth * 100) / 100,
      titles: p?.stats.titles ?? t.lastTitles,
      retiredAge: t.retiredAgeSeen,
      // Talent gâché : gros plafond, pic très en dessous (§9).
      wastedTalent: t.ceilingSnapshot > 88 && t.peakSeen < t.ceilingSnapshot - 16,
      // Surperformance : petit plafond estimé, pic élevé.
      overperformed: t.ceilingSnapshot < 78 && t.peakSeen > 74,
    };
  });

  return { seed, years, trajectories, worldFinal: worldMetrics(world) };
}

export { POLICY_IDS };
