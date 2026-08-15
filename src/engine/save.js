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

function packPersons(persons) {
  const out = {};
  for (const [id, p] of Object.entries(persons)) {
    out[id] = {
      ...p,
      attrs: ATTR_ORDER.map((a) => p.attrs[a]),
      hidden: { ...p.hidden, ceilings: GROUP_IDS.map((g) => p.hidden.ceilings[g]) },
    };
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
    if (Array.isArray(p.hidden?.ceilings)) {
      const ceilings = {};
      GROUP_IDS.forEach((g, i) => {
        ceilings[g] = p.hidden.ceilings[i];
      });
      p.hidden.ceilings = ceilings;
    }
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
