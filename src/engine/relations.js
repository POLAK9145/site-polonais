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
export function refreshDerivedTags(rel) {
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

/**
 * Érosion des liens qu'on n'entretient plus, **proportionnelle** et par semaine.
 *
 * La version précédente retranchait 0,05 point par semaine quel que soit le
 * lien. Sur une carrière de vingt ans cela fait 52 points : n'importe quelle
 * amitié, si forte fût-elle, revenait exactement à zéro et y restait. Mesuré,
 * la valeur médiane d'un ancien coéquipier était de 0 et la moitié des relations
 * d'une carrière finissaient classées « Neutre ».
 *
 * Une érosion proportionnelle décroît vite au début et de plus en plus lentement
 * : un lien de 60 tombe à 21 en cinq ans, à 7 en dix, sans jamais s'annuler tout
 * à fait. C'est ce qu'on veut — on perd de vue, on n'efface pas.
 */
const EROSION = 0.004;

/**
 * Ce qu'on n'oublie pas.
 *
 * Une relation qui a connu un moment marquant — un titre gagné ensemble, une
 * trahison — garde un socle même après des années sans contact. Sans ce socle,
 * l'érosion proportionnelle finirait quand même par tout aplatir, et « vous avez
 * gagné un mondial ensemble en 2033 » se lirait à côté d'une relation neutre.
 */
const SOCLE_MARQUANT = 15;

function socleDe(rel) {
  return rel.history.some((h) => h.important) ? SOCLE_MARQUANT : 0;
}

/**
 * Ce qu'une rupture interdit de réparer par la simple routine.
 *
 * Sans ce plafond, la cohabitation annulait les conflits : un affrontement
 * ouvert coûtait -22, puis la convergence vers la cible positive du vestiaire
 * le remontait de neuf points par an et l'effaçait en trois saisons. Mesuré, le
 * saboteur — qui choisit systématiquement l'option la plus destructrice —
 * terminait avec 0 relation hostile, exactement comme le joueur le plus
 * conciliant. Se comporter mal ne coûtait socialement rien.
 *
 * Partager un vestiaire ne répare pas ce qui a été cassé publiquement. Seul un
 * geste explicite le peut : les événements de réconciliation appellent
 * `adjustRelation` directement et ne passent donc pas par ce plafond.
 */
const PLAFOND_APRES_RUPTURE = -12;

function plafondDe(rel) {
  const rupture = rel.history.some((h) => h.important && (h.delta ?? 0) <= -12);
  return rupture ? PLAFOND_APRES_RUPTURE : 100;
}

/**
 * Vitesse à laquelle la vie commune rapproche — ou éloigne — deux coéquipiers.
 *
 * Étape 7D. Mesuré au diagnostic, une relation n'avait que **2 entrées
 * d'historique en médiane** et un pic de **10** sur une échelle de -100 à +100 :
 * signer donnait +6 par coéquipier, et plus rien ne se produisait ensuite. Les
 * relations existaient sans jamais devenir quoi que ce soit — 55 % finissaient
 * classées « Neutre ».
 *
 * Partager un quotidien pendant des années doit produire quelque chose. Mais
 * pas mécaniquement de l'amitié : ce que cela produit dépend du climat du
 * groupe. C'est pourquoi la cible dérive de la synergie de l'équipe — un
 * vestiaire soudé rapproche, un vestiaire pourri dresse les gens les uns contre
 * les autres. Le même mécanisme fabrique donc les amitiés et les inimitiés,
 * sans qu'aucun événement n'ait à s'en charger.
 */
const COHABITATION = 0.18;

/**
 * Vers quoi tend une relation entre deux coéquipiers de CE groupe.
 *
 * Deux termes, et le second est indispensable. Le climat du vestiaire donne la
 * base : mesurée, la synergie des équipes a une médiane de 54, un p25 de 43 et
 * un p75 de 65, donc c'est autour de 54 qu'il faut centrer — une première
 * version centrée sur 50 avec un gain de 0,9 ne produisait qu'une cible de +4
 * au vestiaire médian, soit rien.
 *
 * Mais la synergie seule ferait converger TOUS les coéquipiers d'une équipe vers
 * la même valeur, ce qui remplacerait des relations plates par des relations
 * identiques. Il faut donc un moteur propre à chaque paire. La concurrence pour
 * une place en est un, et il est déjà dans le monde : deux joueurs du même poste
 * se disputent la même place, et celui qui est sur le banc pendant que l'autre
 * joue le vit forcément moins bien.
 */
function cohabitationTarget(world, team, a, b) {
  // Centré sur 40 et non sur la synergie médiane (54) : passer des années avec
  // les mêmes personnes doit construire quelque chose par défaut, et c'est le
  // vestiaire pourri qui doit être l'exception. Centrer sur la médiane donnait
  // une cible nulle pour la moitié des équipes — la cohabitation ne produisait
  // alors rien du tout pour un joueur sur deux.
  // Gain 1,8 et non 1,4 : mesuré, rester longtemps produisait bien de meilleurs
  // liens qu'un parcours nomade — meilleure relation à 42,7 contre 19, avec une
  // corrélation de 0,347 entre la durée du plus long passage et la relation la
  // plus forte — mais les liens culminaient dans les 40, juste sous le seuil de
  // 45 qui fait une relation forte. Cinq ans dans un bon groupe doivent
  // produire une vraie amitié. Le vestiaire médian, lui, reste modeste : sa
  // synergie de 54 ne donne qu'une cible de 25.
  let target = clamp((team.synergy - 40) * 1.8, -55, 62);
  if (a.roleId && a.roleId === b.roleId) {
    const aTitulaire = !!team.roster?.includes(a.id);
    const bTitulaire = !!team.roster?.includes(b.id);
    // Se disputer la place use ; la perdre au profit de l'autre use davantage.
    target -= aTitulaire === bTitulaire ? 12 : 22;
  }
  return clamp(target, -60, 55);
}

/**
 * Fait vivre les relations d'une période.
 *
 * Deux régimes. Les coéquipiers actuels convergent vers ce que vaut leur
 * vestiaire ; tous les autres s'érodent vers l'indifférence. Un lien fort
 * survit donc à une séparation, mais seulement un temps.
 */
export function decayRelations(world, weeks = 1) {
  for (const rel of Object.values(world.relations)) {
    if (rel.tags.includes(REL_TAGS.TEAMMATE)) {
      const a = world.persons[rel.a];
      const b = world.persons[rel.b];
      const team = a?.teamId && a.teamId === b?.teamId ? world.teams[a.teamId] : null;
      // Étiquette obsolète : les deux ne jouent plus ensemble mais personne
      // n'a appelé `endTeammateBond`. On laisse l'érosion ordinaire faire.
      if (team) {
        const target = Math.min(cohabitationTarget(world, team, a, b), plafondDe(rel));
        const step = COHABITATION * weeks;
        const ecart = target - rel.value;
        rel.value = Math.abs(ecart) <= step ? target : rel.value + Math.sign(ecart) * step;
        rel.value = clamp(rel.value, -100, 100);
        // Sans ceci, une relation qui franchit un seuil pendant l'érosion garde
        // son ancienne étiquette : `friend` survivait à la valeur qui l'avait
        // justifiée, indéfiniment, parce que `refreshDerivedTags` n'était appelé
        // que depuis `adjustRelation`.
        refreshDerivedTags(rel);
        continue;
      }
    }
    const socle = socleDe(rel);
    const facteur = (1 - EROSION) ** weeks;
    if (rel.value > socle) rel.value = Math.max(socle, rel.value * facteur);
    else if (rel.value < -socle) rel.value = Math.min(-socle, rel.value * facteur);
    refreshDerivedTags(rel);
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
