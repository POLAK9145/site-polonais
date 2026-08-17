/**
 * Sauvegarde locale (§63).
 *
 * Aucun compte, aucun serveur : tout tient dans le navigateur. Le format est
 * volontairement plat et versionné pour rester migrable.
 *
 * Détail qui compte : l'état du RNG est sauvegardé avec la partie. Recharger
 * une sauvegarde ne permet donc pas de retirer un résultat différent (§79).
 */

import { RNG } from './rng.js';
import { rebuildIndexes } from './worldgen.js';
import { initEvents } from './events/index.js';
import { ALL_ATTRS, GROUP_IDS } from './attributes.js';

export const SAVE_VERSION = 1;

/**
 * Les 34 attributs d'un personnage coûtent plus cher en NOMS DE CLÉS qu'en
 * valeurs. Sur 600 personnages, cela représente la moitié de la sauvegarde.
 * On les sérialise donc en tableau à ordre fixe.
 */
const ATTR_ORDER = ALL_ATTRS.map((a) => a.id);

/**
 * Même raison pour l'état de charge (étape 7B) : neuf champs nommés répétés sur
 * sept cents personnages coûtaient 104 Ko sur 2 374, soit la totalité de
 * l'écart mesuré avec la sauvegarde de l'étape 6. On applique le précédent des
 * attributs — ordre fixe, et l'état en indice plutôt qu'en chaîne.
 */
const LOAD_ORDER = [
  'value',
  'weeksInState',
  'heavyStreak',
  'longestStreak',
  'peak',
  'episodes',
  'lastEpisodeWeek',
  'weeksHigh',
];
const LOAD_STATE_ORDER = [
  'frais',
  'fatigué',
  'sous pression',
  'surmené',
  'épuisé',
  'burnout',
  'récupération',
];

function packLoad(load) {
  if (!load) return undefined;
  return [LOAD_STATE_ORDER.indexOf(load.state), ...LOAD_ORDER.map((k) => load[k] ?? 0)];
}

function unpackLoad(packed) {
  if (!Array.isArray(packed)) return packed;
  const load = { state: LOAD_STATE_ORDER[packed[0]] ?? 'frais' };
  LOAD_ORDER.forEach((k, i) => {
    load[k] = packed[i + 1];
  });
  return load;
}

/** Réputation : cinq canaux nommés, 45 Ko. Même traitement. */
const REP_ORDER = ['pros', 'public', 'community', 'media', 'toxicity'];

/** Talents cachés : quatre grandeurs nommées, en plus des plafonds déjà en tableau. */
const HIDDEN_ORDER = ['growth', 'adaptability', 'longevity', 'burnoutFloor'];

function packByOrder(obj, order) {
  if (!obj) return undefined;
  const packed = order.map((k) => obj[k] ?? null);
  const extra = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!order.includes(k)) extra[k] = v;
  }
  return Object.keys(extra).length ? { s: packed, x: extra } : packed;
}

function unpackByOrder(packed, order) {
  if (!packed) return packed;
  const arr = Array.isArray(packed) ? packed : packed.s;
  if (!Array.isArray(arr)) return packed;
  const out = {};
  order.forEach((k, i) => {
    out[k] = arr[i];
  });
  if (!Array.isArray(packed) && packed.x) Object.assign(out, packed.x);
  return out;
}

/**
 * Et pour les statistiques, pour la même raison : quinze compteurs nommés,
 * répétés sur sept cents personnages, coûtaient 162 Ko.
 */
const STAT_ORDER = [
  'matches',
  'wins',
  'losses',
  'mvps',
  'titles',
  'minorTitles',
  'finals',
  'minorFinals',
  'highestStatus',
  'earnings',
  'seasonsPro',
  'peakRating',
  'peakWeek',
  'peakFollowers',
  'internationalTitles',
];

function packStats(stats) {
  if (!stats) return undefined;
  const packed = STAT_ORDER.map((k) => stats[k] ?? null);
  // Un compteur ajouté après coup ne doit pas disparaître dans la sauvegarde :
  // on conserve à part ce que l'ordre fixe ne couvre pas.
  const extra = {};
  for (const [k, v] of Object.entries(stats)) {
    if (!STAT_ORDER.includes(k)) extra[k] = v;
  }
  return Object.keys(extra).length ? { s: packed, x: extra } : packed;
}

function unpackStats(packed) {
  if (!packed) return packed;
  const arr = Array.isArray(packed) ? packed : packed.s;
  if (!Array.isArray(arr)) return packed;
  const stats = {};
  STAT_ORDER.forEach((k, i) => {
    stats[k] = arr[i];
  });
  if (!Array.isArray(packed) && packed.x) Object.assign(stats, packed.x);
  return stats;
}

function packPersons(persons) {
  const out = {};
  for (const [id, p] of Object.entries(persons)) {
    out[id] = {
      ...p,
      attrs: ATTR_ORDER.map((a) => p.attrs[a]),
      hidden: { ...p.hidden, ceilings: GROUP_IDS.map((g) => p.hidden.ceilings[g]) },
      load: packLoad(p.load),
      stats: packStats(p.stats),
      reputation: packByOrder(p.reputation, REP_ORDER),
    };
    out[id].hidden = packByOrder(out[id].hidden, HIDDEN_ORDER);
  }
  return out;
}

function unpackPersons(persons) {
  for (const p of Object.values(persons)) {
    if (Array.isArray(p.attrs)) {
      const attrs = {};
      ATTR_ORDER.forEach((a, i) => {
        attrs[a] = p.attrs[i];
      });
      p.attrs = attrs;
    }
    if (Array.isArray(p.hidden) || p.hidden?.s) p.hidden = unpackByOrder(p.hidden, HIDDEN_ORDER);
    if (Array.isArray(p.hidden?.ceilings)) {
      const ceilings = {};
      GROUP_IDS.forEach((g, i) => {
        ceilings[g] = p.hidden.ceilings[i];
      });
      p.hidden.ceilings = ceilings;
    }
    if (Array.isArray(p.reputation) || p.reputation?.s) p.reputation = unpackByOrder(p.reputation, REP_ORDER);
    if (Array.isArray(p.load)) p.load = unpackLoad(p.load);
    if (Array.isArray(p.stats) || p.stats?.s) p.stats = unpackStats(p.stats);
  }
  return persons;
}
const STORAGE_PREFIX = 'esport-sim:save:';
const INDEX_KEY = 'esport-sim:index';

/** Les flottants sont arrondis : sans cela, la sauvegarde triple de taille. */
function replacer(key, value) {
  if (key === 'indexes') return undefined;
  if (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)) {
    return Math.round(value * 1000) / 1000;
  }
  return value;
}

export function serializeSession(session) {
  const payload = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    world: { ...session.world, persons: packPersons(session.world.persons) },
    career: session.career,
    rngState: session.rng.state,
    pendingDecision: session.pendingDecision,
  };
  return JSON.stringify(payload, replacer);
}

export function deserializeSession(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.version > SAVE_VERSION) {
    throw new Error('Sauvegarde incompatible avec cette version du jeu.');
  }
  initEvents();
  const world = data.world;
  unpackPersons(world.persons);
  rebuildIndexes(world);
  world.pendingPlayerIncome = world.pendingPlayerIncome ?? [];
  const session = {
    world,
    career: data.career,
    rng: RNG.fromState(data.rngState ?? world.rngState ?? 1),
    pendingDecision: data.pendingDecision ?? data.career.pendingDecision ?? null,
    lastReport: null,
  };
  return session;
}

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function saveSession(session, slotId = 'auto') {
  const store = storage();
  if (!store) return { ok: false, reason: 'Stockage local indisponible' };
  const json = serializeSession(session);
  try {
    store.setItem(STORAGE_PREFIX + slotId, json);
    updateIndex(store, slotId, session, json.length);
    return { ok: true, size: json.length };
  } catch (err) {
    // Quota dépassé : on prévient au lieu de perdre silencieusement la partie.
    return { ok: false, reason: 'Espace de stockage insuffisant', error: String(err) };
  }
}

export function loadSession(slotId = 'auto') {
  const store = storage();
  if (!store) return null;
  const json = store.getItem(STORAGE_PREFIX + slotId);
  if (!json) return null;
  try {
    return deserializeSession(json);
  } catch {
    return null;
  }
}

export function deleteSave(slotId) {
  const store = storage();
  if (!store) return;
  store.removeItem(STORAGE_PREFIX + slotId);
  const index = readIndex(store).filter((s) => s.slotId !== slotId);
  store.setItem(INDEX_KEY, JSON.stringify(index));
}

export function listSaves() {
  const store = storage();
  if (!store) return [];
  return readIndex(store);
}

function readIndex(store) {
  try {
    return JSON.parse(store.getItem(INDEX_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function updateIndex(store, slotId, session, size) {
  const person = session.world.persons[session.career.personId];
  const index = readIndex(store).filter((s) => s.slotId !== slotId);
  index.push({
    slotId,
    nick: person?.nick ?? '—',
    week: session.world.week,
    seed: session.world.seed,
    retired: session.career.retired,
    savedAt: Date.now(),
    size,
  });
  store.setItem(INDEX_KEY, JSON.stringify(index));
}

/** Export texte, pour partager ou archiver une carrière hors du navigateur. */
export function exportSave(session) {
  return serializeSession(session);
}

export function importSave(json) {
  return deserializeSession(json);
}
