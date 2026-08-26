/**
 * Point d'entrée du catalogue d'événements.
 * Ajouter un fichier de définitions = l'importer et l'enregistrer ici.
 */

import { registerEvents, clearRegistry, allEvents } from './engine.js';
import { registerDeferredHandlers } from './deferred.js';
import { earlyCareerEvents } from './defs/earlyCareer.js';
import { teamLifeEvents } from './defs/teamLife.js';
import { lifeAndMediaEvents } from './defs/lifeAndMedia.js';
import { worldEvents } from './defs/worldEvents.js';
import { dailyLifeEvents } from './defs/dailyLife.js';
import { competitionLifeEvents } from './defs/competitionLife.js';

let initialized = false;

export function initEvents({ force = false } = {}) {
  if (initialized && !force) return allEvents().length;
  if (force) clearRegistry();
  registerEvents(earlyCareerEvents);
  registerEvents(teamLifeEvents);
  registerEvents(lifeAndMediaEvents);
  registerEvents(worldEvents);
  registerEvents(dailyLifeEvents);
  registerEvents(competitionLifeEvents);
  registerDeferredHandlers();
  initialized = true;
  return allEvents().length;
}

export { allEvents };
