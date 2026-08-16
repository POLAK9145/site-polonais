/**
 * Carrière active des PNJ (étape 4).
 *
 * PROBLÈME CORRIGÉ
 * ----------------
 * Le marché ne s'exécutait que du côté des équipes : `runNpcTransferWindow`
 * parcourt les équipes, cherche un candidat, propose. Un PNJ ne pouvait donc
 * jamais *agir* — ni démarcher, ni comparer deux offres, ni décider de
 * changer de scène. Mesuré sur 120 PNJ suivis vingt ans :
 *
 *  - médiane d'**une seule équipe** traversée, 78 sur 120 n'ayant jamais bougé ;
 *  - **0 %** de changement de jeu, ce qui n'est pas une tendance mais une
 *    impossibilité : `collectOffers` et `candidatePool` filtrent sur
 *    `gameId`, aucune équipe ne regarde donc jamais un joueur d'une autre
 *    scène ;
 *  - une médiane de **156 semaines sans équipe** (p90 : 627), le vivier
 *    n'étant consulté que lorsqu'une équipe daigne chercher.
 *
 * MODÈLE RETENU
 * -------------
 * Les PNJ empruntent le **même marché fondamental que le joueur** —
 * `collectOffers`, `evaluateInterest`, `signPlayer` — mais avec une décision
 * simplifiée : pas d'événements narratifs, pas d'agence exceptionnelle, un
 * arbitrage entre rester, partir, changer de scène, attendre ou arrêter (§J).
 *
 * Le changement de jeu n'est pas une règle périodique : il émerge de
 * circonstances mesurables — scène qui décline, absence d'équipe qui dure,
 * familiarité déjà acquise ailleurs, adaptabilité du joueur.
 */

import { clamp } from './rng.js';
import { GAMES, GAMES_BY_ID } from '../data/games.js';
import {
  STATUS,
  age as personAge,
  baseRating,
  weightedCeiling,
  mods,
  getFamiliarity,
  setFamiliarity,
} from './person.js';
import { ratingForGame } from './attributes.js';
import { collectOffers, signPlayer } from './transfers.js';
import { isMajorTransferWindow, WEEKS_PER_YEAR, yearOf } from './time.js';
import { isTracing, trace, TRACE } from './trace.js';

/** Nombre d'agents libres qui démarchent par fenêtre de mercato. */
const SEEKERS_PER_WINDOW = 45;

/**
 * Décision d'un PNJ sans équipe : chercher ici, chercher ailleurs, attendre.
 * Renvoie des facteurs nommés — « pourquoi ce PNJ a-t-il changé de scène ? ».
 */
export function sceneChangeCase(world, person) {
  const factors = [];
  const add = (key, label, delta) => {
    if (delta !== 0) factors.push({ key, label, delta: Math.round(delta * 10) / 10 });
  };
  const m = mods(person);
  const home = world.gameStates[person.gameId];
  const a = personAge(person, world.week);

  // 1. La santé de sa propre scène.
  if (home) {
    const vitality = home.vitality ?? 0.5;
    add('scene', `vitalité de sa scène à ${Math.round(vitality * 100)} %`, clamp((0.45 - vitality) * 70, -18, 30));
    if (!home.alive) add('dead_scene', 'sa scène a fermé', 45);
  }

  // 2. Le temps passé sans équipe : c'est ce qui pousse à regarder ailleurs.
  const idle = person.weeksIdle ?? 0;
  if (idle > 26) add('idle', `${Math.round(idle / 52 * 10) / 10} an(s) sans équipe`, clamp(idle / 26, 0, 4) * 8);

  // 3. Son profil est-il fait pour un autre jeu ? Question mesurable : on
  //    compare l'aptitude brute, familiarité mise de côté. Sans ce facteur, le
  //    seul chemin praticable était la désespérance — or le marché place
  //    désormais un agent libre en vingt semaines médianes, si bien que
  //    personne n'atteignait plus le seuil et que les changements de scène
  //    restaient à 0,1 par saison. Une aptitude nettement meilleure ailleurs
  //    est une raison en soi (§H, « meilleure compatibilité avec son profil »).
  const fit = bestAptitudeGain(world, person);
  if (fit && fit.gain > 2) {
    // On ne nomme pas la scène : celle qu'il rejoindra est tirée parmi
    // plusieurs, et citer ici la meilleure aptitude produirait une explication
    // qui ne correspond pas au mouvement observé.
    add('fit', `profil mieux adapté à une autre scène (+${Math.round(fit.gain)} d'aptitude)`, clamp(fit.gain * 3, 0, 26));
  }

  // 4. Son adaptabilité, et ce qu'il connaît déjà ailleurs.
  add('adaptability', 'capacité d’adaptation', (person.hidden.adaptability - 0.5) * 24);
  if (a > 27) add('age', `${Math.round(a)} ans : réapprendre coûte cher`, -clamp((a - 27) * 4, 0, 18));
  add('ambition', 'ambition', (m.ambition - 1) * 12);

  const score = factors.reduce((n, f) => n + f.delta, 0);
  return { factors, score, willing: score >= 22 };
}

/**
 * Meilleure aptitude brute disponible ailleurs, familiarité mise de côté.
 * C'est ce que vaudrait ce joueur sur une autre scène une fois le jeu appris —
 * pas ce qu'il y vaut aujourd'hui.
 */
export function bestAptitudeGain(world, person) {
  const home = GAMES_BY_ID[person.gameId];
  if (!home) return null;
  const mine = ratingForGame(person.attrs, home, { familiarity: 1 });
  let best = null;
  for (const game of GAMES) {
    if (game.id === person.gameId) continue;
    if (!world.gameStates[game.id]?.alive) continue;
    const there = ratingForGame(person.attrs, game, { familiarity: 1 });
    if (!best || there > best.rating) best = { game, rating: there };
  }
  return best ? { game: best.game, gain: best.rating - mine } : null;
}

/** La scène vers laquelle ce PNJ se tournerait, s'il devait en changer. */
export function alternativeScene(world, person, rng) {
  const options = [];
  for (const game of GAMES) {
    if (game.id === person.gameId) continue;
    const gs = world.gameStates[game.id];
    if (!gs?.alive) continue;
    const fam = getFamiliarity(person, game.id);
    // Une scène vivante, qu'on connaît un peu, où il reste de la place, et où
    // son profil vaut quelque chose.
    const openings = countOpenings(world, game.id);
    const aptitude = ratingForGame(person.attrs, game, { familiarity: 1 });
    const score = (gs.vitality ?? 0.5) * 40 + fam * 45 + Math.min(openings, 8) * 3 + aptitude * 0.6;
    options.push({ game, score });
  }
  if (options.length === 0) return null;
  return rng.weighted(options, (o) => Math.max(0.5, o.score)).game;
}

function countOpenings(world, gameId) {
  let n = 0;
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.gameId !== gameId) continue;
    const game = GAMES_BY_ID[gameId];
    n += Math.max(0, game.teamSize - team.roster.length);
  }
  return n;
}

/**
 * Les agents libres démarchent.
 *
 * C'est la moitié manquante du marché : jusqu'ici, seules les équipes
 * cherchaient. Un joueur libre passe par `collectOffers`, exactement comme le
 * joueur humain, puis arbitre entre ce qu'on lui propose et le fait d'attendre.
 */
export function runFreeAgentMarket(world, rng, { maxSeekers = SEEKERS_PER_WINDOW } = {}) {
  if (!isMajorTransferWindow(world.week)) return { signed: [], switched: [], waited: 0 };
  // Une seule vague de démarchage par intersaison. La fenêtre majeure dure
  // quatre semaines : laisser 45 agents libres démarcher chaque semaine
  // produisait 219 changements d'équipe par an pour 434 joueurs — un marché
  // hystérique, exactement ce que le §Q interdit. Les trous urgents restent
  // comblés chaque semaine par `fillEmptyRosters`.
  const season = yearOf(world.week);
  if (world.lastFreeAgentWave === season) return { signed: [], switched: [], waited: 0 };
  world.lastFreeAgentWave = season;
  const signed = [];
  const switched = [];
  let waited = 0;

  const seekers = [];
  for (const id of world.freeAgents) {
    const p = world.persons[id];
    if (!p || p.isPlayer) continue;
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    if (p.teamId) continue;
    seekers.push(p);
  }
  // Les plus désœuvrés cherchent en premier : c'est eux que la situation presse.
  seekers.sort((a, b) => (b.weeksIdle ?? 0) - (a.weeksIdle ?? 0));

  for (const person of seekers.slice(0, maxSeekers)) {
    const game = GAMES_BY_ID[person.gameId];
    if (!game) continue;

    let offers = collectOffers(world, person, rng, { maxOffers: 3, minScore: 40 });

    // Aucune porte sur sa scène : il peut en essayer une autre (§H).
    if (offers.length === 0) {
      const c = sceneChangeCase(world, person);
      const target = c.willing ? alternativeScene(world, person, rng) : null;
      if (target) {
        // On ne cherche pas à lui faire signer un contrat sur la nouvelle
        // scène : personne ne recrute un joueur qui ne connaît pas le jeu —
        // `evaluateInterest` lui inflige à juste titre 30 points de pénalité de
        // familiarité. Changer de scène, c'est repartir par la porte d'entrée
        // construite à l'étape 2 : il devient disponible là-bas, avec le peu
        // qu'il en sait, et c'est au circuit amateur de le récupérer — ou pas.
        const before = person.gameId;
        person.gameId = target.id;
        setFamiliarity(person, target.id, Math.max(getFamiliarity(person, target.id), rng.float(0.2, 0.4)));
        person.roleId = null;
        person.weeksIdle = 0;
        switched.push({ personId: person.id, from: before, to: target.id });
        if (isTracing()) {
          trace(TRACE.NPC_CAREER, world.week, {
            decision: 'scene_change',
            personId: person.id,
            nick: person.nick,
            from: before,
            to: target.id,
            score: Math.round(c.score),
            factors: c.factors,
          });
        }
        continue;
      }
      waited++;
      continue;
    }

    const res = acceptBest(world, person, offers, rng);
    if (res) signed.push({ personId: person.id, teamId: res.teamId });
    else waited++;
  }

  return { signed, switched, waited };
}

/**
 * Le PNJ compare ce qu'on lui propose et choisit — ou refuse tout.
 * Décision volontairement simple (§J) : le niveau de la structure, le salaire,
 * la place à prendre, pondérés par ses traits.
 */
function acceptBest(world, person, offers, rng) {
  const m = mods(person);
  const scored = offers.map((offer) => {
    const org = world.orgs[offer.orgId];
    const team = world.teams[offer.teamId];
    let value = 0;
    if (org) value += org.tier * 8 * m.ambition;
    value += Math.log10(Math.max(1, offer.salary)) * 6 * m.greed;
    if (team && offer.role === 'starter') value += 10;
    // Rester sur une scène qu'on connaît vaut quelque chose.
    value += getFamiliarity(person, team?.gameId ?? person.gameId) * 8;
    return { offer, value: value * rng.float(0.9, 1.1) };
  });
  scored.sort((a, b) => b.value - a.value);
  const best = scored[0];
  if (!best) return null;

  // Un joueur désœuvré accepte plus facilement ; un joueur qui vient d'arriver
  // sur le marché peut se permettre d'attendre mieux.
  const idleYears = (person.weeksIdle ?? 0) / WEEKS_PER_YEAR;
  const org = world.orgs[best.offer.orgId];
  const a = personAge(person, world.week);
  const rating = baseRating(person, GAMES_BY_ID[person.gameId]);
  let p = 0.55 + clamp(idleYears, 0, 2) * 0.18;
  // L'ambition rend difficile : viser plus haut a un coût.
  if (org && org.tier <= 2) p -= (m.ambition - 1) * 0.25;
  if (a > 30) p += 0.12;
  if (rating > 78 && org && org.tier <= 2) p -= 0.2;

  if (!rng.chance(clamp(p, 0.08, 0.95))) {
    if (isTracing()) {
      trace(TRACE.NPC_CAREER, world.week, {
        decision: 'offer_declined',
        personId: person.id,
        nick: person.nick,
        orgName: org?.name,
        offers: offers.length,
        probability: Math.round(clamp(p, 0.08, 0.95) * 100) / 100,
      });
    }
    return null;
  }

  const res = signPlayer(world, person, best.offer, { week: world.week });
  if (!res.ok) return null;
  const fa = world.freeAgents.indexOf(person.id);
  if (fa >= 0) world.freeAgents.splice(fa, 1);
  person.weeksIdle = 0;
  if (isTracing()) {
    trace(TRACE.NPC_CAREER, world.week, {
      decision: 'signed',
      personId: person.id,
      nick: person.nick,
      orgName: res.org.name,
      orgTier: res.org.tier,
      salary: best.offer.salary,
      offers: offers.length,
    });
  }
  return { teamId: best.offer.teamId };
}

/** Compte les semaines sans équipe, à la base des décisions de carrière. */
export function tickIdleWeeks(world) {
  for (const p of Object.values(world.persons)) {
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    if (p.teamId) p.weeksIdle = 0;
    else p.weeksIdle = (p.weeksIdle ?? 0) + 1;
  }
}

/**
 * Envie de partir d'un PNJ sous contrat, à l'approche de la fin de son bail.
 * Ce n'est pas une décision de départ : c'est ce qui le rend disponible aux
 * sollicitations, et cela nourrit les chaînes de mercato.
 */
export function restlessness(world, person) {
  const m = mods(person);
  const team = person.teamId ? world.teams[person.teamId] : null;
  const org = team ? world.orgs[team.orgId] : null;
  if (!team || !org) return 0;
  const game = GAMES_BY_ID[person.gameId];
  let n = 0;
  if (team.subs.includes(person.id)) n += 0.3;
  if (person.morale < 40) n += 0.2;
  const rating = baseRating(person, game);
  const ceiling = weightedCeiling(person, game);
  if (rating > 70 && org.tier <= 2) n += 0.25;
  if (ceiling > rating + 10 && personAge(person, world.week) < 23) n += 0.15;
  n *= m.ambition;
  n -= (m.loyalty - 1) * 0.3;
  return clamp(n, 0, 1);
}
