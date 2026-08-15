/**
 * Succès (§36).
 *
 * Chaque succès est une condition lue sur l'état réel de la simulation.
 * Aucun n'est décoratif : ils décrivent des trajectoires que le moteur peut
 * réellement produire, y compris les plus improbables.
 */

import { STATUS, age as personAge } from './person.js';
import { addAchievement, hasAchievement } from './career.js';
import { WEEKS_PER_YEAR } from './time.js';

export const ACHIEVEMENTS = [
  { id: 'first_contract', label: 'Premier contrat', desc: 'Signer votre premier contrat.', rarity: 'commun' },
  { id: 'first_title', label: 'Premier titre', desc: 'Remporter une compétition.', rarity: 'commun' },
  { id: 'national_champion', label: 'Champion national', desc: 'Remporter une ligue nationale.', rarity: 'peu commun' },
  { id: 'regional_champion', label: 'Champion régional', desc: 'Remporter une ligue régionale.', rarity: 'peu commun' },
  { id: 'international_title', label: 'Titre international', desc: 'Remporter un tournoi international.', rarity: 'rare' },
  { id: 'world_champion', label: 'Champion du monde', desc: 'Remporter un championnat du monde.', rarity: 'très rare' },
  { id: 'mvp_10', label: 'Homme du match', desc: 'Être MVP dix fois.', rarity: 'peu commun' },
  { id: 'became_captain', label: 'Capitaine', desc: 'Devenir meneur de jeu.', rarity: 'peu commun' },
  { id: 'beat_rival', label: 'Le duel', desc: 'Battre votre rival dans un match décisif.', rarity: 'peu commun' },
  { id: 'game_switcher', label: 'Reconversion', desc: 'Réussir un changement de jeu complet.', rarity: 'rare' },
  { id: 'multi_game_pro', label: 'Polyvalent', desc: 'Être professionnel sur deux jeux différents.', rarity: 'très rare' },
  { id: 'meta_creator', label: 'Créateur de méta', desc: 'Inventer une stratégie adoptée par la scène.', rarity: 'très rare' },
  { id: 'popular_100k', label: '100 000 abonnés', desc: 'Atteindre 100 000 abonnés.', rarity: 'peu commun' },
  { id: 'popular_1m', label: 'Star', desc: 'Atteindre un million d’abonnés.', rarity: 'rare' },
  { id: 'long_career', label: 'Longévité', desc: 'Tenir dix ans de carrière.', rarity: 'rare' },
  { id: 'very_long_career', label: 'Increvable', desc: 'Tenir quinze ans de carrière.', rarity: 'très rare' },
  { id: 'comeback_king', label: 'Retour au sommet', desc: 'Retrouver votre meilleur niveau après une chute majeure.', rarity: 'rare' },
  { id: 'loyal_five_years', label: 'Fidèle', desc: 'Rester cinq ans dans la même organisation.', rarity: 'rare' },
  { id: 'journeyman', label: 'Nomade', desc: 'Jouer pour cinq organisations différentes.', rarity: 'peu commun' },
  { id: 'undrafted', label: 'Sans équipe', desc: 'Rester un an sans équipe et revenir en compétition.', rarity: 'rare' },
  { id: 'millionaire', label: 'Million', desc: 'Cumuler un million d’euros de gains.', rarity: 'très rare' },
  { id: 'respected', label: 'Respecté', desc: 'Atteindre une réputation maximale auprès des professionnels.', rarity: 'rare' },
  { id: 'infamous', label: 'Sulfureux', desc: 'Devenir une figure ouvertement controversée.', rarity: 'peu commun' },
  { id: 'mentor', label: 'Mentor', desc: 'Former un joueur qui perce au plus haut niveau.', rarity: 'rare' },
  { id: 'survivor', label: 'Debout', desc: 'Revenir en compétition après un épisode de surmenage.', rarity: 'peu commun' },
];

export const ACHIEVEMENTS_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Évalue tous les succès. Retourne ceux qui viennent d'être débloqués. */
export function checkAchievements(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  if (!person) return [];
  const unlocked = [];

  const grant = (id) => {
    if (hasAchievement(career, id)) return;
    if (addAchievement(career, world, id)) unlocked.push(ACHIEVEMENTS_BY_ID[id]);
  };

  const stats = person.stats;
  const years = (world.week - career.startWeek) / WEEKS_PER_YEAR;

  if (person.contract) grant('first_contract');
  if (stats.titles >= 1) grant('first_title');
  if ((career.counters.titlesByTier.national ?? 0) > 0) grant('national_champion');
  if ((career.counters.titlesByTier.regional ?? 0) > 0) grant('regional_champion');
  if ((career.counters.titlesByTier.international ?? 0) > 0) grant('international_title');
  if ((career.counters.titlesByTier.worlds ?? 0) > 0) grant('world_champion');
  if (stats.mvps >= 10) grant('mvp_10');
  if (person.followers >= 100000) grant('popular_100k');
  if (person.followers >= 1000000) grant('popular_1m');
  if (years >= 10) grant('long_career');
  if (years >= 15) grant('very_long_career');
  if (career.counters.orgsPlayed.length >= 5) grant('journeyman');
  if (stats.earnings >= 1000000) grant('millionaire');
  if (person.reputation.pros >= 92) grant('respected');
  if (person.reputation.toxicity >= 55 && person.reputation.public >= 55) grant('infamous');
  if (career.counters.gamesPlayed.length >= 2 && person.status === STATUS.PRO) grant('multi_game_pro');
  if (career.flags.had_burnout && person.status !== STATUS.RETIRED && person.form > 0) grant('survivor');

  // Fidélité : cinq ans sans changer d'organisation.
  const current = person.teamHistory.find((h) => h.to === null);
  if (current && world.week - current.from >= WEEKS_PER_YEAR * 5) grant('loyal_five_years');

  // Retour au sommet : avoir chuté d'au moins 10 points puis retrouvé son pic.
  if (career.counters.lowestPoint && stats.peakRating > 0) {
    const drop = career.counters.lowestPoint.peak - career.counters.lowestPoint.rating;
    if (drop >= 10 && stats.peakWeek > career.counters.lowestPoint.week) grant('comeback_king');
  }

  if ((career.counters.weeksWithoutTeam ?? 0) === 0 && career.counters.longestWithoutTeam >= 52) {
    grant('undrafted');
  }

  return unlocked;
}

/** Suit le point le plus bas de la carrière (utilisé par « Retour au sommet »). */
export function trackLowPoint(career, world, rating) {
  const peak = world.persons[career.personId]?.stats.peakRating ?? 0;
  const current = career.counters.lowestPoint;
  const drop = peak - rating;
  if (!current || drop > current.peak - current.rating) {
    career.counters.lowestPoint = { week: world.week, rating, peak };
  }
  const w = career.counters.weeksWithoutTeam ?? 0;
  career.counters.longestWithoutTeam = Math.max(career.counters.longestWithoutTeam ?? 0, w);
}
