/**
 * Relations (§15).
 *
 * Une relation n'est pas une barre « 72 ». C'est une valeur ET un historique
 * daté. À la retraite, on doit pouvoir écrire « vous l'avez rencontré en
 * 2029, il vous a défendu en 2031, vous êtes rivaux depuis 2033 » à partir
 * de faits réellement survenus, sans rien inventer (§72).
 *
 * Les relations ne sont créées qu'à la première interaction : le monde
 * compte des centaines de personnes, il serait absurde d'en stocker le
 * produit cartésien.
 */

import { clamp } from './rng.js';
import { formatDate } from './time.js';

export const REL_TAGS = {
  TEAMMATE: 'teammate',
  EX_TEAMMATE: 'ex_teammate',
  FRIEND: 'friend',
  RIVAL: 'rival',
  ENEMY: 'enemy',
  MENTOR: 'mentor',
  PROTEGE: 'protege',
  COACH: 'coach',
  EX_COACH: 'ex_coach',
};

export const REL_TAG_LABELS = {
  teammate: 'Coéquipier',
  ex_teammate: 'Ancien coéquipier',
  friend: 'Ami',
  rival: 'Rival',
  enemy: 'Ennemi',
  mentor: 'Mentor',
  protege: 'Protégé',
  coach: 'Coach',
  ex_coach: 'Ancien coach',
};

export function relKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function getRelation(world, a, b, createIfMissing = true) {
  if (a === b) return null;
  const key = relKey(a, b);
  let rel = world.relations[key];
  if (!rel && createIfMissing) {
    rel = { a: a < b ? a : b, b: a < b ? b : a, value: 0, tags: [], history: [], met: null };
    world.relations[key] = rel;
  }
  return rel ?? null;
}

export function relationValue(world, a, b) {
  const rel = world.relations[relKey(a, b)];
  return rel ? rel.value : 0;
}

export function hasTag(world, a, b, tag) {
  const rel = world.relations[relKey(a, b)];
  return !!rel && rel.tags.includes(tag);
}

/**
 * Modifie une relation et journalise le pourquoi.
 * `text` doit décrire un fait ("Vous avez remporté un titre ensemble"),
 * jamais un chiffre : c'est ce texte qui deviendra le récit final.
 */
export function adjustRelation(world, a, b, delta, { week, text, tag = null, important = false } = {}) {
  const rel = getRelation(world, a, b);
  if (!rel) return null;
  if (rel.met === null) rel.met = week ?? world.week;
  rel.value = clamp(rel.value + delta, -100, 100);
  if (tag) addTag(rel, tag);
  if (text) {
    rel.history.push({ week: week ?? world.week, text, delta: Math.round(delta), important });
    // On garde une trace complète des moments marquants, et seulement les
    // 30 derniers détails ordinaires : sinon la sauvegarde explose.
    if (rel.history.length > 40) {
      const important = rel.history.filter((h) => h.important);
      const recent = rel.history.filter((h) => !h.important).slice(-25);
      rel.history = [...important, ...recent].sort((x, y) => x.week - y.week);
    }
  }
  refreshDerivedTags(rel);
  return rel;
}

export function addTag(rel, tag) {
  if (!rel.tags.includes(tag)) rel.tags.push(tag);
}

export function removeTag(rel, tag) {
  const i = rel.tags.indexOf(tag);
  if (i >= 0) rel.tags.splice(i, 1);
}

/** Les tags d'affection découlent de la valeur ; les tags factuels non. */
function refreshDerivedTags(rel) {
  removeTag(rel, REL_TAGS.FRIEND);
  removeTag(rel, REL_TAGS.ENEMY);
  if (rel.value >= 55) addTag(rel, REL_TAGS.FRIEND);
  if (rel.value <= -55) addTag(rel, REL_TAGS.ENEMY);
}

/** Appelé quand deux joueurs cessent d'être coéquipiers. */
export function endTeammateBond(world, a, b, week) {
  const rel = getRelation(world, a, b, false);
  if (!rel) return;
  removeTag(rel, REL_TAGS.TEAMMATE);
  addTag(rel, REL_TAGS.EX_TEAMMATE);
  rel.history.push({ week, text: 'Vos routes se séparent.', delta: 0, important: false });
}

/** Érosion lente des relations qu'on n'entretient plus. */
export function decayRelations(world, weeks = 1) {
  for (const rel of Object.values(world.relations)) {
    if (rel.tags.includes(REL_TAGS.TEAMMATE)) continue;
    const pull = rel.value > 0 ? -0.05 : 0.05;
    rel.value = clamp(rel.value + pull * weeks, -100, 100);
  }
}

export function relationsOf(world, personId, { minAbs = 1 } = {}) {
  const out = [];
  for (const rel of Object.values(world.relations)) {
    if (rel.a !== personId && rel.b !== personId) continue;
    if (Math.abs(rel.value) < minAbs && rel.tags.length === 0) continue;
    out.push({
      other: rel.a === personId ? rel.b : rel.a,
      value: rel.value,
      tags: rel.tags,
      history: rel.history,
      met: rel.met,
    });
  }
  return out.sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
}

export function describeRelation(value, tags = []) {
  if (tags.includes(REL_TAGS.RIVAL) && value < 0) return 'Rivalité hostile';
  if (tags.includes(REL_TAGS.RIVAL)) return 'Rivalité respectueuse';
  if (tags.includes(REL_TAGS.MENTOR)) return 'Mentor';
  if (tags.includes(REL_TAGS.PROTEGE)) return 'Protégé';
  if (value >= 75) return 'Ami proche';
  if (value >= 45) return 'Ami';
  if (value >= 15) return 'Bonne entente';
  if (value > -15) return 'Neutre';
  if (value > -45) return 'Tension';
  if (value > -75) return 'Conflit';
  return 'Inimitié';
}

export function formatRelationHistory(entry) {
  return `${formatDate(entry.week)} — ${entry.text}`;
}
