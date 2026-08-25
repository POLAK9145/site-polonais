/**
 * Le musée des carrières terminées (§52, étape 9K).
 *
 * POURQUOI
 * --------
 * Une carrière se termine, on en commence une autre, et la précédente
 * disparaît. Le jeu perdait donc exactement ce qui fait l'intérêt d'un
 * simulateur de carrière rejouable : pouvoir dire « celle-là était différente,
 * et voilà en quoi ».
 *
 * CE QU'ON CONSERVE, ET CE QU'ON NE CONSERVE PAS
 * ----------------------------------------------
 * On ne garde pas la partie — un monde complet pèse trop et n'apporte rien une
 * fois la carrière finie. On garde une FICHE : ce que le bilan avait déjà
 * calculé au moment de la retraite. Aucun chiffre n'est recalculé ici ; les
 * recalculer plus tard, sans le monde qui les a produits, donnerait des
 * résultats différents de ceux que le joueur a vus. C'est la leçon de l'étape
 * 8A, appliquée au stockage.
 *
 * La graine est conservée : elle permet de rejouer exactement le même monde, et
 * c'est ce qui rendra un jour possible le mode « et si ».
 */

import { computeLegacy, careerStats } from './legacy.js';
import { careerChartView, retirementView } from './view.js';
import { yearOf } from './time.js';

const CLE = 'circuit:archive:v1';

/** Au-delà, la plus ancienne sort. Le stockage local n'est pas extensible. */
export const MAX_FICHES = 24;

/** La version de la fiche : une fiche d'une autre forme est ignorée, pas devinée. */
export const VERSION_FICHE = 1;

function stockage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * La fiche d'une carrière terminée, construite depuis la session encore
 * vivante — c'est le seul moment où tous les faits sont disponibles.
 */
export function careerRecord(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  if (!person) return null;
  const legacy = computeLegacy(world, career);
  const stats = careerStats(world, career);
  const courbe = careerChartView(session);
  const fin = retirementView(session);

  return {
    version: VERSION_FICHE,
    // L'identité de la partie : graine + personne. Deux carrières de la même
    // graine ne sont pas la même carrière, les décisions les séparent.
    id: `${world.seed}:${person.id}`,
    seed: world.seed,
    nick: person.nick,
    nom: `${person.firstName} ${person.lastName}`,
    pays: person.country ?? null,
    debut: yearOf(career.startWeek),
    finAnnee: fin?.year ?? yearOf(world.week),
    archiveLe: Date.now(),

    global: legacy.global,
    dimensions: { ...legacy.dimensions },
    archetype: legacy.archetype?.label ?? null,
    annees: legacy.careerYears,

    matchs: stats.matches,
    victoires: stats.wins,
    tauxVictoire: Math.round((stats.winRate ?? 0) * 100),
    titres: stats.titles,
    finales: stats.finals,
    mvps: stats.mvps,
    gains: Math.round(stats.earnings ?? 0),
    picNiveau: stats.peakRating,
    picAnnee: stats.peakYear,
    abonnes: stats.followers,
    jeux: [...(stats.games ?? [])],
    structures: stats.orgs,
    saisons: stats.seasons,

    // La forme de la carrière, réduite à ce qui se trace.
    courbe: (courbe?.points ?? []).map((p) => ({
      annee: p.annee, niveau: p.niveau, titres: p.titres, transfert: !!p.transfert,
    })),
    finRaison: fin?.path ?? null,
    finChoisie: fin ? fin.chosen : null,
  };
}

export function listArchive() {
  const store = stockage();
  if (!store) return [];
  let brut;
  try {
    brut = JSON.parse(store.getItem(CLE) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(brut)) return [];
  // Une fiche d'une autre version est écartée, jamais réinterprétée.
  return brut
    .filter((f) => f && f.version === VERSION_FICHE && f.id)
    .sort((a, b) => (b.archiveLe ?? 0) - (a.archiveLe ?? 0));
}

/**
 * Archive une carrière terminée. Rejoue-t-on la même ? La fiche est remplacée
 * plutôt que dupliquée : l'identité est la graine et la personne.
 */
export function archiveCareer(session) {
  const store = stockage();
  if (!store) return { ok: false, reason: 'Stockage local indisponible' };
  if (!session?.career?.retired) return { ok: false, reason: 'La carrière n’est pas terminée' };
  const fiche = careerRecord(session);
  if (!fiche) return { ok: false, reason: 'Carrière illisible' };

  const fiches = listArchive().filter((f) => f.id !== fiche.id);
  fiches.unshift(fiche);
  const gardees = fiches.slice(0, MAX_FICHES);
  try {
    store.setItem(CLE, JSON.stringify(gardees));
    return { ok: true, fiche, total: gardees.length };
  } catch (err) {
    return { ok: false, reason: 'Espace de stockage insuffisant', error: String(err) };
  }
}

export function deleteArchived(id) {
  const store = stockage();
  if (!store) return false;
  const restantes = listArchive().filter((f) => f.id !== id);
  try {
    store.setItem(CLE, JSON.stringify(restantes));
    return true;
  } catch {
    return false;
  }
}

/** Les grandeurs comparables, dans l'ordre où elles se lisent. */
const AXES = [
  { cle: 'global', label: 'Score de carrière', sens: 1 },
  { cle: 'annees', label: 'Années de carrière', sens: 1, decimales: 1 },
  { cle: 'picNiveau', label: 'Meilleur niveau', sens: 1, decimales: 1 },
  { cle: 'titres', label: 'Titres', sens: 1 },
  { cle: 'finales', label: 'Finales', sens: 1 },
  { cle: 'matchs', label: 'Matchs joués', sens: 1 },
  { cle: 'tauxVictoire', label: 'Victoires', sens: 1, unite: '%' },
  { cle: 'mvps', label: 'MVP', sens: 1 },
  { cle: 'gains', label: 'Gains', sens: 1, unite: '€' },
  { cle: 'abonnes', label: 'Abonnés', sens: 1 },
  { cle: 'structures', label: 'Structures', sens: 0 },
];

const DIMENSIONS = [
  ['competitive', 'Grandeur compétitive'],
  ['longevity', 'Longévité'],
  ['impact', 'Impact'],
  ['popularity', 'Popularité'],
  ['innovation', 'Innovation'],
  ['leadership', 'Leadership'],
  ['legend', 'Légende'],
];

/**
 * Compare deux fiches.
 *
 * `sens: 0` marque les grandeurs qui ne se classent pas : avoir joué pour six
 * structures n'est ni mieux ni moins bien que d'être resté dans la même. Les
 * présenter comme un score inventerait un jugement que le jeu ne porte pas.
 */
export function compareCareers(a, b) {
  if (!a || !b) return null;
  const ligne = ({ cle, label, sens, unite, decimales = 0 }) => {
    const va = a[cle] ?? 0;
    const vb = b[cle] ?? 0;
    const ecart = Math.round((va - vb) * 10 ** decimales) / 10 ** decimales;
    return {
      cle, label, unite: unite ?? null, decimales,
      a: va, b: vb, ecart,
      // `meilleur` reste null quand la grandeur ne se classe pas OU quand
      // c'est à égalité : les deux cas se dessinent pareil.
      meilleur: sens === 0 || ecart === 0 ? null : ecart > 0 ? 'a' : 'b',
    };
  };
  // Deux mondes différents peuvent produire le même pseudo — vu en jouant :
  // « Cinderie contre Cinderie », et un résumé qui disait « +47 pour Cinderie,
  // +45 pour Cinderie ». Quand les noms se confondent, on désigne les carrières
  // par leur période, qui elle les sépare.
  const memeNom = a.nick === b.nick;
  const periodeA = `${a.debut}–${a.finAnnee}`;
  const periodeB = `${b.debut}–${b.finAnnee}`;
  const etiquette = (fiche, periode) =>
    memeNom ? `${fiche.nick} (${periode})` : fiche.nick;

  return {
    a: { id: a.id, nick: a.nick, archetype: a.archetype, periode: periodeA, etiquette: etiquette(a, periodeA) },
    b: { id: b.id, nick: b.nick, archetype: b.archetype, periode: periodeB, etiquette: etiquette(b, periodeB) },
    memeNom,
    axes: AXES.map(ligne),
    dimensions: DIMENSIONS.map(([cle, label]) => ({
      cle, label,
      a: a.dimensions?.[cle] ?? 0,
      b: b.dimensions?.[cle] ?? 0,
      ecart: (a.dimensions?.[cle] ?? 0) - (b.dimensions?.[cle] ?? 0),
    })),
    // Ce qui distingue vraiment les deux : les trois plus gros écarts de
    // dimension. Onze lignes d'écart ne disent rien ; trois disent l'histoire.
    resume: DIMENSIONS
      .map(([cle, label]) => ({ cle, label, ecart: (a.dimensions?.[cle] ?? 0) - (b.dimensions?.[cle] ?? 0) }))
      .filter((d) => Math.abs(d.ecart) >= 8)
      .sort((x, y) => Math.abs(y.ecart) - Math.abs(x.ecart))
      .slice(0, 3),
  };
}
