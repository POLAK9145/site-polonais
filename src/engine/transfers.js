/**
 * Marché des joueurs (§17, §18, §59).
 *
 * Aucune probabilité n'est un nombre magique. Toute décision de recrutement
 * produit une LISTE DE FACTEURS explicable, que l'interface peut afficher
 * telle quelle. C'est ce qui interdit le « vous recevez une offre de la
 * meilleure équipe du monde » sans chaîne causale (§2).
 */

import { clamp, norm } from './rng.js';
import { PHILOSOPHIES_BY_ID } from '../data/orgs.js';
import { GAMES_BY_ID } from '../data/games.js';
import {
  baseRating,
  weightedCeiling,
  overallReputation,
  marketValue,
  age as personAge,
  mods,
  STATUS,
} from './person.js';
import { teamNeeds, teamStrength, addToRoster, removeFromRoster, rosterPersons, detachFromAllTeams, recordStint } from './team.js';
import { benchSlots, prefersBenchOverRelease } from './roster.js';
import { salaryBand } from './org.js';
import { relationValue, adjustRelation, endTeammateBond, REL_TAGS, getRelation } from './relations.js';
import { isTransferWindow, isMajorTransferWindow } from './time.js';
import { isTracing, trace, TRACE } from './trace.js';

/**
 * Intérêt d'une équipe pour un joueur.
 * Retourne un score 0..100 ET le détail des facteurs.
 */
export function evaluateInterest(world, team, person) {
  const org = world.orgs[team.orgId];
  const game = GAMES_BY_ID[team.gameId];
  if (!org || !org.alive || !team.active || !game) {
    return { score: 0, factors: [], viable: false, reason: 'Structure inexistante' };
  }
  if (person.status === STATUS.RETIRED || person.status === STATUS.STAFF) {
    return { score: 0, factors: [], viable: false, reason: 'Joueur non disponible' };
  }
  if (person.teamId === team.id) {
    return { score: 0, factors: [], viable: false, reason: 'Déjà dans l’effectif' };
  }

  const philo = PHILOSOPHIES_BY_ID[org.philosophy];
  const needs = teamNeeds(world, team);
  const rating = baseRating(person, game);
  const potential = weightedCeiling(person, game);
  const a = personAge(person, world.week);
  const rep = overallReputation(person);
  const factors = [];

  // Base volontairement basse : sans raison, il ne se passe rien.
  let score = 5;
  factors.push({ label: 'Base', delta: 5 });

  // 1. Niveau par rapport au besoin réel de l'équipe.
  const levelGap = rating - needs.targetRating;
  const levelDelta = clamp(levelGap * 2.6 * (philo.prefers.ratingWeight ?? 1), -55, 45);
  score += levelDelta;
  factors.push({
    label: levelGap >= 0 ? 'Niveau au-dessus du besoin' : 'Niveau en dessous du besoin',
    delta: levelDelta,
  });

  // 2. Projection : ce que le joueur peut encore devenir.
  const headroom = clamp(potential - rating, 0, 30);
  const potentialDelta = headroom * 0.75 * (philo.prefers.potentialWeight ?? 1);
  score += potentialDelta;
  if (potentialDelta > 1) factors.push({ label: 'Marge de progression estimée', delta: potentialDelta });

  // 3. Âge, filtré par la philosophie du club.
  const maxAge = philo.prefers.maxAge ?? 30;
  let ageDelta = 0;
  if (a > maxAge) ageDelta = -(a - maxAge) * 6;
  else if (a < 20 && philo.id === 'youth') ageDelta = 10;
  else if (a > 27) ageDelta = -(a - 27) * 3;
  if (ageDelta !== 0) {
    score += ageDelta;
    factors.push({ label: ageDelta > 0 ? 'Profil jeune recherché' : 'Âge', delta: ageDelta });
  }

  // 4. Réputation. Les structures « data » s'en moquent, les stars la paient.
  const repDelta = (rep - 30) * 0.22 * (philo.prefers.repWeight ?? 1);
  score += repDelta;
  factors.push({ label: 'Réputation', delta: repDelta });

  // 5. Forme et performances récentes.
  const formDelta = person.form * 0.8;
  score += formDelta;
  if (Math.abs(formDelta) > 1) factors.push({ label: 'Forme du moment', delta: formDelta });

  // 6. Urgence : une équipe incomplète recrute, une équipe satisfaite non — et
  //    une équipe complète qui veut de la profondeur cherche aussi. Sans ce
  //    troisième cas, une organisation décidée à se doter d'un banc était
  //    traitée comme une organisation sans besoin : 78 équipes en voulaient un,
  //    aucune n'y parvenait.
  const depthWanted = benchSlots(world, team);
  let urgencyDelta;
  let urgencyLabel;
  if (needs.openSlots > 0) {
    urgencyDelta = 22;
    urgencyLabel = 'Place libre dans l’effectif';
  } else if (depthWanted > 0) {
    urgencyDelta = 11;
    urgencyLabel = 'Recherche de profondeur d’effectif';
  } else {
    urgencyDelta = needs.urgency * 16 - 6;
    urgencyLabel = 'Besoin de renforcer un poste';
  }
  score += urgencyDelta;
  factors.push({ label: urgencyLabel, delta: urgencyDelta });

  // 7. Réseau : connaître quelqu'un dans la structure change tout (§59).
  let network = 0;
  for (const mate of rosterPersons(world, team)) {
    network += relationValue(world, person.id, mate.id) * 0.06;
  }
  if (team.coachId) network += relationValue(world, person.id, team.coachId) * 0.1;
  network = clamp(network, -18, 18);
  if (Math.abs(network) > 0.5) {
    score += network;
    factors.push({ label: network > 0 ? 'Relations dans l’équipe' : 'Passif avec l’équipe', delta: network });
  }

  // 8. Région, pour les structures ancrées localement.
  if (philo.prefers.regionBias && org.regionId === person.regionId) {
    const d = 9 * philo.prefers.regionBias * 0.5;
    score += d;
    factors.push({ label: 'Joueur de la région', delta: d });
  } else if (philo.prefers.regionBias && org.regionId !== person.regionId) {
    score -= 12;
    factors.push({ label: 'Politique de recrutement régionale', delta: -12 });
  }

  // 9. Coût. Une petite structure ne peut simplement pas suivre.
  const band = salaryBand(org, game);
  const value = marketValue(person, game, world.week);
  const expectedSalary = Math.max(value * 0.28, 1200);
  const affordability = band.max > 0 ? expectedSalary / band.max : 5;
  let costDelta = 0;
  if (affordability > 1) costDelta = -clamp((affordability - 1) * 45, 0, 60);
  else costDelta = clamp((1 - affordability) * 12, 0, 12);
  score += costDelta;
  factors.push({ label: costDelta < 0 ? 'Salaire hors budget' : 'Salaire abordable', delta: costDelta });

  // 10. Contrat en cours : il faut convaincre ET indemniser.
  if (person.contract && person.teamId) {
    const remaining = Math.max(0, person.contract.endWeek - world.week);
    const d = -clamp(remaining * 0.16, 0, 26);
    score += d;
    factors.push({ label: 'Sous contrat ailleurs', delta: d });
  }

  // 11. Comportement. Une réputation toxique ferme des portes.
  if (person.reputation.toxicity > 10) {
    const d = -person.reputation.toxicity * 0.55 * (org.tier >= 4 ? 1.5 : 1);
    score += d;
    factors.push({ label: 'Réputation problématique', delta: d });
  }

  // 12. Familiarité avec le jeu : changer de scène a un coût réel (§10).
  const fam = person.familiarity[game.id] ?? 0;
  if (fam < 0.55) {
    const d = -(0.55 - fam) * 55;
    score += d;
    factors.push({ label: 'Ne connaît pas encore le jeu', delta: d });
  }

  return {
    score: clamp(score, 0, 100),
    factors: factors.filter((f) => Math.abs(f.delta) >= 0.5),
    viable: true,
    rating,
    potential,
    expectedSalary,
    band,
  };
}

/** Construit une proposition de contrat cohérente avec l'intérêt manifesté. */
export function buildOffer(world, team, person, interest, rng) {
  const org = world.orgs[team.orgId];
  const game = GAMES_BY_ID[team.gameId];
  const band = interest.band ?? salaryBand(org, game);
  const enthusiasm = clamp(interest.score / 100, 0, 1);
  const salary = Math.round(
    clamp(
      band.typical * (0.6 + enthusiasm * 0.9) * rng.float(0.9, 1.15),
      band.min,
      band.max * 1.15,
    ),
  );
  const needs = teamNeeds(world, team);
  // Le rôle proposé découle de la place à prendre et de la profondeur voulue.
  // La version précédente n'étiquetait « remplaçant » qu'une recrue *moins*
  // bonne que le plus faible titulaire — l'inverse de la raison pour laquelle
  // une organisation signe une doublure, et un cas que le seuil d'intérêt de 48
  // rendait de toute façon presque inatteignable.
  const wantsDepth = benchSlots(world, team) > 0;
  const isStarter =
    needs.openSlots > 0 ||
    interest.rating >= (needs.weakestRating ?? 0) + (wantsDepth ? 3 : 0);
  const years = rng.weighted([1, 2, 3], (y) => (y === 2 ? 5 : y === 1 ? 3 : 2));

  return {
    orgId: org.id,
    teamId: team.id,
    gameId: game.id,
    salary,
    years,
    endWeek: world.week + years * 52,
    role: isStarter ? 'starter' : 'sub',
    bonusPerTitle: Math.round(salary * rng.float(0.12, 0.4)),
    buyout: Math.round(salary * rng.float(1.2, 3.5)),
    objectives: objectiveFor(org, team),
    pressure: org.pressure,
    interestScore: interest.score,
    factors: interest.factors,
    createdWeek: world.week,
    expiresWeek: world.week + 3,
  };
}

function objectiveFor(org, team) {
  if (org.tier >= 5) return 'titre_international';
  if (org.tier === 4) return 'playoffs';
  if (org.tier === 3) return 'top4';
  if (org.tier === 2) return 'montee';
  return 'progression';
}

export const OBJECTIVE_LABELS = {
  titre_international: 'Gagner un titre international',
  playoffs: 'Atteindre les playoffs',
  top4: 'Terminer dans le top 4',
  montee: 'Monter en ligue',
  progression: 'Progresser',
};

/**
 * Offres reçues par un joueur donné. On ne teste que les équipes
 * plausibles : même jeu, structure vivante, place ou besoin réel.
 */
export function collectOffers(world, person, rng, { maxOffers = 3, minScore = 42, gameId = null } = {}) {
  // `gameId` permet de démarcher une AUTRE scène que la sienne. Sans cette
  // ouverture, aucune équipe ne regardait jamais un joueur venu d'ailleurs et
  // les PNJ ne pouvaient pas changer de jeu — mesuré à 0 % sur vingt ans.
  // `evaluateInterest` applique déjà la pénalité de familiarité (§10), le coût
  // du changement reste donc réel.
  const wanted = gameId ?? person.gameId;
  const candidates = [];
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.gameId !== wanted) continue;
    if (team.id === person.teamId) continue;
    const game = GAMES_BY_ID[team.gameId];
    if (team.roster.length >= game.teamSize + 1) continue;
    const interest = evaluateInterest(world, team, person);
    if (!interest.viable || interest.score < minScore) continue;
    candidates.push({ team, interest });
  }
  candidates.sort((a, b) => b.interest.score - a.interest.score);

  // On diversifie : deux offres de deux structures identiques n'apprennent
  // rien au joueur. On garde le meilleur candidat par organisation.
  const seenOrgs = new Set();
  const picked = [];
  for (const c of candidates) {
    if (seenOrgs.has(c.team.orgId)) continue;
    seenOrgs.add(c.team.orgId);
    picked.push(c);
    if (picked.length >= maxOffers) break;
  }

  return picked.map((c) => buildOffer(world, c.team, person, c.interest, rng));
}

/** Exécute une signature. Toutes les vérifications d'intégrité sont ici. */
export function signPlayer(world, person, offer, { week }) {
  const team = world.teams[offer.teamId];
  const org = world.orgs[offer.orgId];
  if (!team || !team.active || !org || !org.alive) return { ok: false, reason: 'Structure indisponible' };
  if (person.status === STATUS.RETIRED) return { ok: false, reason: 'Joueur retraité' };
  const game = GAMES_BY_ID[team.gameId];
  // On ne signe pas un remplaçant de plus que la profondeur voulue : sans cette
  // borne, `addToRoster` empile les remplaçants sans limite dès qu'un effectif
  // est plein.
  if (offer.role !== 'starter' && team.roster.length >= game.teamSize && benchSlots(world, team) <= 0) {
    return { ok: false, reason: 'Banc au complet' };
  }
  if (team.roster.length >= game.teamSize && offer.role === 'starter') {
    // Il faut libérer une place. Deux issues possibles, et c'est ici que se
    // jouait l'absence totale de banc dans le monde : la version précédente
    // licenciait systématiquement le maillon faible, convertissant en
    // licenciement le moment même où une profondeur d'effectif devrait naître.
    const needs = teamNeeds(world, team);
    if (needs.weakestId && needs.weakestId !== person.id) {
      const displaced = world.persons[needs.weakestId];
      if (prefersBenchOverRelease(world, team, needs.weakestId)) {
        const i = team.roster.indexOf(needs.weakestId);
        if (i >= 0) team.roster.splice(i, 1);
        team.subs.push(needs.weakestId);
        if (displaced) displaced.benchedSince = week;
        if (isTracing()) {
          trace(TRACE.ROSTER, week, {
            decision: 'benched',
            teamId: team.id,
            orgName: org.name,
            benched: displaced?.nick,
            benchedId: needs.weakestId,
            factors: [
              { key: 'arrival', label: `arrivée de ${person.nick}`, delta: 1 },
              { key: 'depth', label: 'la structure a les moyens de le conserver', delta: 1 },
            ],
          });
        }
      } else {
        releasePlayer(world, needs.weakestId, week, 'remplacé');
      }
    } else {
      return { ok: false, reason: 'Effectif complet' };
    }
  }

  if (person.teamId) leaveTeam(world, person, week, 'transfert');

  addToRoster(world, team, person.id);
  person.contract = {
    orgId: org.id,
    teamId: team.id,
    salary: offer.salary,
    signedWeek: week,
    endWeek: offer.endWeek,
    role: offer.role,
    bonusPerTitle: offer.bonusPerTitle,
    buyout: offer.buyout,
    objectives: offer.objectives,
  };
  person.status = org.tier >= 3 ? STATUS.PRO : org.tier === 2 ? STATUS.SEMIPRO : STATUS.AMATEUR;
  recordStint(world, person, team, org, week);

  // Nouveaux coéquipiers : les relations démarrent maintenant.
  for (const mate of rosterPersons(world, team)) {
    if (mate.id === person.id) continue;
    const rel = getRelation(world, person.id, mate.id);
    if (rel && !rel.tags.includes(REL_TAGS.TEAMMATE)) {
      adjustRelation(world, person.id, mate.id, 6, {
        week,
        text: `Coéquipiers chez ${org.name}.`,
        tag: REL_TAGS.TEAMMATE,
        important: true,
      });
    }
  }
  if (team.coachId) {
    adjustRelation(world, person.id, team.coachId, 4, {
      week,
      text: `Entraîné par le staff de ${org.name}.`,
      tag: REL_TAGS.COACH,
    });
  }

  return { ok: true, team, org };
}

/** Sortie d'effectif propre : historique, relations, statut. */
export function leaveTeam(world, person, week, reason = 'départ') {
  const team = person.teamId ? world.teams[person.teamId] : null;
  if (!team) return;
  const org = world.orgs[team.orgId];
  for (const mate of rosterPersons(world, team)) {
    if (mate.id === person.id) continue;
    endTeammateBond(world, person.id, mate.id, week);
  }
  const entry = person.teamHistory.filter((h) => h.teamId === team.id && h.to === null).pop();
  if (entry) entry.to = week;
  removeFromRoster(world, team, person.id);
  if (org) {
    org.history.push({ week, text: `Départ de ${person.nick} (${reason})` });
  }
}

export function releasePlayer(world, personId, week, reason = 'licenciement') {
  const person = world.persons[personId];
  if (!person) return;
  leaveTeam(world, person, week, reason);
  // Ceinture et bretelles : aucune référence résiduelle ne doit survivre.
  detachFromAllTeams(world, personId);
  person.teamId = null;
  person.orgId = null;
  person.contract = null;
  person.roleId = null;
  person.status = person.status === STATUS.RETIRED ? STATUS.RETIRED : STATUS.INACTIVE;
  person.morale = clamp(person.morale - 16, 0, 100);
  if (!world.freeAgents.includes(personId)) world.freeAgents.push(personId);
}

/**
 * Marché des PNJ. Tourne pendant les fenêtres de transfert : les équipes
 * comblent leurs trous, remplacent leurs maillons faibles, et les agents
 * libres trouvent (ou non) une place. Le monde bouge sans le joueur (§3).
 */
export function runNpcTransferWindow(world, rng, { maxMoves = 14, chainDepth = 3 } = {}) {
  if (!isTransferWindow(world.week)) return [];
  const moves = [];
  const teams = rng.shuffle(
    Object.values(world.teams).filter((t) => t.active && world.orgs[t.orgId]?.alive),
  );

  // Chaîne de mercato (§P) : l'équipe dépouillée d'un titulaire est remise en
  // file pour chercher à son tour, dans la même fenêtre. Sans cela, un départ
  // ne créait un trou que jusqu'au prochain passage — les réactions en chaîne
  // n'existaient pas. La profondeur est bornée pour éviter l'emballement.
  const queue = [...teams];
  const chainCount = new Map();

  for (const team of queue) {
    if (moves.length >= maxMoves) break;
    const needs = teamNeeds(world, team);
    const org = world.orgs[team.orgId];
    const philo = PHILOSOPHIES_BY_ID[org.philosophy];
    // La patience de la structure décide de la fréquence des mouvements.
    const wantsDepth = benchSlots(world, team) > 0;
    const moveChance = needs.openSlots > 0
      ? 0.9
      : Math.max(
          wantsDepth ? 0.45 : 0,
          clamp(needs.urgency / (philo.prefers.patience ?? 1), 0, 0.5),
        );
    if (!rng.chance(moveChance)) continue;

    const pool = candidatePool(world, team, rng);
    const game = GAMES_BY_ID[team.gameId];
    const rosterFull = team.roster.length >= (game?.teamSize ?? 1);
    let best = null;
    for (const cand of pool) {
      if (cand.isPlayer) continue; // le joueur décide lui-même
      const interest = evaluateInterest(world, team, cand);
      if (!interest.viable) continue;
      // Le seuil de 48 répond à la question « mérite-t-il une place de
      // titulaire ? ». Signer une doublure est une autre question, et lui
      // opposer la même barre revenait à l'interdire : mesuré, 86 équipes
      // voulaient un banc, une seule trouvait un candidat au-dessus de 48.
      const wouldBench =
        rosterFull && wantsDepth && interest.rating < (needs.weakestRating ?? 0) + 3;
      if (interest.score < (wouldBench ? BENCH_INTEREST : STARTER_INTEREST)) continue;
      if (!best || interest.score > best.interest.score) best = { cand, interest };
    }
    if (!best) continue;

    // Le joueur convoité peut refuser : loyauté, salaire, ambition.
    const accepted = npcAcceptsOffer(world, best.cand, team, best.interest, rng);
    if (!accepted) {
      if (isTracing()) {
        trace(TRACE.RECRUIT_REFUSED, world.week, {
          orgId: org.id,
          orgName: org.name,
          personId: best.cand.id,
          nick: best.cand.nick,
          score: best.interest.score,
          factors: best.interest.factors,
          accepted: false,
          refusalReason: 'le joueur a décliné',
        });
      }
      continue;
    }

    const poachedFrom = best.cand.teamId ? world.teams[best.cand.teamId] : null;
    const offer = buildOffer(world, team, best.cand, best.interest, rng);
    const res = signPlayer(world, best.cand, offer, { week: world.week });
    if (res.ok) {
      // Le club dépouillé cherche à son tour : c'est la réaction en chaîne.
      if (poachedFrom && poachedFrom.active && poachedFrom.id !== team.id) {
        const depth = (chainCount.get(poachedFrom.id) ?? 0) + 1;
        if (depth <= chainDepth) {
          chainCount.set(poachedFrom.id, depth);
          queue.push(poachedFrom);
        }
      }
      if (isTracing()) {
        trace(TRACE.RECRUIT, world.week, {
          orgId: org.id,
          orgName: org.name,
          orgTier: org.tier,
          personId: best.cand.id,
          nick: best.cand.nick,
          gameId: team.gameId,
          score: best.interest.score,
          factors: best.interest.factors,
          salary: offer.salary,
          accepted: true,
          openSlots: needs.openSlots,
        });
      }
      const fa = world.freeAgents.indexOf(best.cand.id);
      if (fa >= 0) world.freeAgents.splice(fa, 1);
      moves.push({ personId: best.cand.id, teamId: team.id, orgId: team.orgId, salary: offer.salary });
    }
  }
  return moves;
}

/**
 * Recrutement de profondeur (étape 5).
 *
 * Une passe distincte, et volontairement modeste. Le marché principal boucle
 * sur les équipes avec un budget de mouvements borné : une organisation qui
 * cherche une doublure y était en concurrence avec toutes celles qui ont un
 * trou réel à combler, et n'obtenait jamais son tour — 86 équipes voulaient un
 * banc, neuf places par an se remplissaient.
 *
 * On puise dans le vivier, pas chez les titulaires des autres : une doublure se
 * trouve parmi les joueurs disponibles. Cela donne accessoirement une fonction
 * au vivier, où stagnaient des joueurs corrects que personne ne regardait.
 */
export function runBenchRecruitment(world, rng, { maxSignings = 8 } = {}) {
  if (!isMajorTransferWindow(world.week)) return [];
  const signings = [];
  const teams = rng.shuffle(
    Object.values(world.teams).filter((t) => {
      if (!t.active || t.isSelfTeam) return false;
      if (!world.orgs[t.orgId]?.alive) return false;
      const game = GAMES_BY_ID[t.gameId];
      return t.roster.length >= (game?.teamSize ?? 1) && benchSlots(world, t) > 0;
    }),
  );

  for (const team of teams) {
    if (signings.length >= maxSignings) break;
    const org = world.orgs[team.orgId];
    let best = null;
    for (const cand of benchCandidates(world, team, org, rng)) {
      if (!cand || cand.isPlayer) continue;
      if (cand.status === STATUS.RETIRED || cand.status === STATUS.STAFF) continue;
      const interest = evaluateInterest(world, team, cand);
      if (!interest.viable || interest.score < BENCH_INTEREST) continue;
      if (!best || interest.score > best.interest.score) best = { cand, interest };
    }
    if (!best) continue;
    if (!npcAcceptsOffer(world, best.cand, team, best.interest, rng, { role: 'sub' })) continue;

    const offer = { ...buildOffer(world, team, best.cand, best.interest, rng), role: 'sub' };
    const res = signPlayer(world, best.cand, offer, { week: world.week });
    if (!res.ok) continue;
    const fa = world.freeAgents.indexOf(best.cand.id);
    if (fa >= 0) world.freeAgents.splice(fa, 1);
    best.cand.benchedSince = world.week;
    signings.push({ personId: best.cand.id, teamId: team.id });

    if (isTracing()) {
      trace(TRACE.ROSTER, world.week, {
        decision: 'bench_signing',
        teamId: team.id,
        orgName: res.org.name,
        orgTier: res.org.tier,
        signed: best.cand.nick,
        signedId: best.cand.id,
        salary: offer.salary,
        factors: best.interest.factors,
      });
    }
  }
  return signings;
}

/**
 * Vivier pour une place de remplaçant.
 *
 * Le marché libre d'abord — c'est là qu'on trouve une doublure sans déranger
 * personne. Mais une grosse structure va aussi chercher le titulaire d'une
 * équipe plus modeste : c'est ainsi que les choses se passent réellement, et
 * s'en tenir au vivier laissait le haut de tableau réclamer trente-quatre
 * places pour en pourvoir deux. On ne pioche que **plus bas que soi** : un
 * club ne pille pas le banc de son rival de même niveau, et le départ ouvre un
 * trou chez le petit, donc une chaîne de mercato.
 */
function benchCandidates(world, team, org, rng) {
  const out = [];
  for (const id of world.freeAgents) {
    const p = world.persons[id];
    if (p && p.gameId === team.gameId) out.push(p);
  }
  const poachable = [];
  for (const p of Object.values(world.persons)) {
    if (p.gameId !== team.gameId || !p.teamId || p.teamId === team.id) continue;
    const from = world.orgs[world.teams[p.teamId]?.orgId];
    if (!from?.alive || from.tier >= org.tier) continue;
    poachable.push(p);
  }
  out.push(...rng.sample(poachable, Math.min(12, poachable.length)));
  return out;
}

/** Intérêt minimal pour offrir une place de titulaire. */
const STARTER_INTEREST = 48;
/** Intérêt minimal pour offrir une place de remplaçant : on achète une
 *  assurance, pas un titulaire. */
const BENCH_INTEREST = 36;

const ROSTERED_LOOKED_AT = 22;

function candidatePool(world, team, rng) {
  const pool = [];
  for (const id of world.freeAgents) {
    const p = world.persons[id];
    if (p && p.gameId === team.gameId && p.status !== STATUS.RETIRED && p.status !== STATUS.STAFF) {
      pool.push(p);
    }
  }

  // On regarde aussi chez les autres : c'est ce qui crée les vrais transferts.
  // On échantillonne par réservoir plutôt qu'en mélangeant tout le monde :
  // l'ancienne version triait plusieurs centaines de personnes pour n'en
  // garder que 22, à chaque équipe et à chaque semaine de mercato.
  const reservoir = [];
  let seen = 0;
  for (const p of Object.values(world.persons)) {
    if (p.gameId !== team.gameId) continue;
    if (!p.teamId || p.teamId === team.id) continue;
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    seen++;
    if (reservoir.length < ROSTERED_LOOKED_AT) {
      reservoir.push(p);
    } else {
      const j = rng.int(0, seen - 1);
      if (j < ROSTERED_LOOKED_AT) reservoir[j] = p;
    }
  }
  pool.push(...reservoir);
  return pool;
}

function npcAcceptsOffer(world, person, team, interest, rng, { role = 'starter' } = {}) {
  const org = world.orgs[team.orgId];
  const m = mods(person);
  const game = GAMES_BY_ID[team.gameId];
  const a = personAge(person, world.week);

  // Une place de remplaçant ne s'accepte pas pour les mêmes raisons qu'une
  // place de titulaire, et c'est ce qui décide *qui* compose les bancs du
  // monde. Un titulaire en pleine force refuse — à juste titre : c'est
  // pourquoi les bancs restent rares. Un jeune à fort potentiel y voit une
  // porte vers une grande structure, un vétéran finissant y voit un emploi.
  let benchAppetite = 1;
  if (role !== 'starter') {
    const rating = baseRating(person, game);
    const ceiling = weightedCeiling(person, game);
    const currentTier = person.orgId ? world.orgs[person.orgId]?.tier ?? 0 : 0;
    benchAppetite = 0.25;
    if (a < 22 && ceiling > rating + 8) benchAppetite += 0.45; // apprendre chez un grand
    if (a >= 29) benchAppetite += 0.3; // prolonger sa carrière
    if (org.tier - currentTier >= 2) benchAppetite += 0.25; // franchir un palier
    benchAppetite = clamp(benchAppetite / m.ambition, 0.05, 1);
  }

  if (!person.teamId) return rng.chance(clamp(0.85 * benchAppetite + (role !== 'starter' ? 0.1 : 0), 0.05, 0.9));

  const currentOrg = person.orgId ? world.orgs[person.orgId] : null;
  const tierGain = org.tier - (currentOrg?.tier ?? 0);
  const salaryGain = person.contract ? interest.expectedSalary / Math.max(1, person.contract.salary) : 2;

  let p = 0.18;
  p += clamp(tierGain, -2, 3) * 0.16;
  p += clamp(salaryGain - 1, -0.5, 1.5) * 0.18 * m.greed;
  p -= (m.loyalty - 1) * 0.22;
  p -= clamp((person.morale - 55) / 100, -0.3, 0.3);
  // Un joueur en fin de contrat bouge beaucoup plus facilement.
  if (person.contract && person.contract.endWeek - world.week < 12) p += 0.25;
  return rng.chance(clamp(p * benchAppetite, 0.02, 0.9));
}

/** Résumé lisible d'une offre, pour l'interface (§45 : info incomplète). */
export function describeOffer(world, offer) {
  const org = world.orgs[offer.orgId];
  const team = world.teams[offer.teamId];
  const strength = team ? teamStrength(world, team, { forMatch: false }) : null;
  return {
    orgName: org?.name ?? '—',
    tier: org?.tier ?? 1,
    salary: offer.salary,
    years: offer.years,
    role: offer.role,
    objective: OBJECTIVE_LABELS[offer.objectives] ?? offer.objectives,
    pressure: offer.pressure,
    // Indices qualitatifs, jamais les chiffres exacts.
    levelHint: strength ? hintFor(strength.strength) : '—',
    synergyHint: team ? hintForSynergy(team.synergy) : '—',
    philosophy: org ? PHILOSOPHIES_BY_ID[org.philosophy].label : '—',
    factors: offer.factors,
  };
}

function hintFor(strength) {
  if (strength >= 88) return 'Prétendant au titre mondial';
  if (strength >= 80) return 'Équipe de haut de tableau';
  if (strength >= 72) return 'Équipe compétitive';
  if (strength >= 62) return 'Équipe de milieu de classement';
  return 'Équipe en construction';
}

function hintForSynergy(s) {
  if (s >= 75) return 'Groupe très soudé';
  if (s >= 60) return 'Bonne ambiance';
  if (s >= 45) return 'Ambiance correcte';
  if (s >= 30) return 'Vestiaire tendu';
  return 'Vestiaire au bord de la rupture';
}
