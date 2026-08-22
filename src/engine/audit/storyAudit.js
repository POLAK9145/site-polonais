/**
 * Audit narratif versionné (étape 7G).
 *
 * Les étapes précédentes mesuraient des grandeurs de simulation : niveau,
 * charge, relations, événements. Elles ne mesuraient pas ce que le projet
 * cherche réellement à produire — une histoire qu'on peut raconter, qui ne se
 * contredit pas, et qui n'est pas la même pour deux joueurs de même talent.
 *
 * Ce module ne contient AUCUNE règle de jeu. Il observe des carrières déjà
 * jouées et en tire trois familles de mesures :
 *
 *   1. RACONTABILITÉ — la carrière contient-elle les briques d'un récit
 *      (un point haut, un point bas, un personnage secondaire) ?
 *   2. COHÉRENCE     — le bilan final affirme-t-il quelque chose que les faits
 *      contredisent ? Toute contradiction est un défaut majeur.
 *   3. DIVERGENCE    — à talent comparable, deux carrières racontent-elles des
 *      choses différentes ?
 *
 * SUR LA DIVERGENCE, ET POURQUOI ELLE EXIGE UNE PRÉCAUTION
 * -------------------------------------------------------
 * Mesurer « l'écart entre deux carrières » sans contrôler le talent ne mesure
 * rien d'utile : un joueur au plafond 82 et un joueur au plafond 48 auront des
 * trajectoires très différentes, mais c'est la génétique qui parle, pas leurs
 * décisions. Le premier a aussi mécaniquement plus de place au-dessus de lui :
 * plus d'archétypes lui sont accessibles, plus de titres, plus de legacy. Un
 * simple écart-type global confondrait donc *effet de plafond* et *effet de
 * décision*.
 *
 * On procède par décomposition de variance. Les carrières sont rangées en
 * tranches de plafond ; pour chaque grandeur on sépare :
 *   - la part de variation expliquée par la tranche (= le talent),
 *   - la part de variation qui subsiste À L'INTÉRIEUR d'une tranche
 *     (= tout le reste : décisions, contexte, hasard, monde).
 *
 * Le projet veut ces deux parts très différentes selon la grandeur :
 *   - talent → niveau atteint : la part « talent » doit rester FORTE ;
 *   - talent → durée, titres, relations, archétype, legacy : la part « talent »
 *     doit rester FAIBLE, c'est-à-dire que la trajectoire doit diverger.
 *
 * L'estimateur retenu est ω² (oméga carré) plutôt que η² (êta carré) : η²
 * surestime mécaniquement la part expliquée quand les groupes sont petits ou
 * nombreux, ce qui rendrait la mesure dépendante de la taille de l'échantillon
 * et donc incomparable d'une exécution à l'autre. ω² retranche l'espérance du
 * bruit et reste stable quand la suite grandit.
 *
 * Pour l'archétype, qui est catégoriel, on ne peut pas décomposer une variance.
 * On compte le nombre d'archétypes distincts observés — mais à effectif FIXE,
 * tiré au sort de façon déterministe : un comptage brut augmente avec la taille
 * de l'échantillon et ne se compare pas entre deux exécutions de tailles
 * différentes.
 */

import { RNG, normalizeSeed } from '../rng.js';

/**
 * Version de l'audit narratif.
 * Toute modification des définitions ci-dessous (tranches, seuils, formules)
 * doit incrémenter cette version : deux audits de versions différentes ne se
 * comparent pas, exactement comme deux baselines de versions différentes.
 */
export const STORY_AUDIT = {
  version: 1,
  name: 'story-audit-v1',
  // Largeur d'une tranche de plafond, en points de rating.
  bandWidth: 5,
  // En dessous de cet effectif, une tranche n'est pas mesurable : on l'écarte
  // du calcul plutôt que de publier une dispersion tirée de six carrières.
  minBand: 30,
  // Effectif fixe pour les comptages catégoriels (archétypes distincts).
  fixedSample: 25,
  // Nombre de tirages moyennés pour ce comptage. Mesuré : à 40 tirages, une
  // tranche de 120 carrières rendait 6,0 là où 300 et 600 rendaient 5,5 et
  // 5,2 — le bruit du tirage, pas la diversité. À 200 il se tasse.
  fixedRepeats: 200,
  seed: 'story-audit-v1',
};

/**
 * Réduit un résultat de carrière aux champs narratifs conservés.
 * Volontairement compact : il est stocké tel quel dans le baseline.
 */
export function storyAuditRow(result) {
  const s = result.story ?? {};
  return {
    tellable: !!s.tellable,
    breakthrough: !!s.hasBreakthrough,
    bestMoment: !!s.hasBestMoment,
    worstMoment: !!s.hasWorstMoment,
    rival: !!s.hasRival,
    bestTeammate: !!s.hasBestTeammate,
    gameChange: !!s.hasGameChange,
    teamChange: !!s.hasTeamChange,
    // Codes seulement : le détail est utile en diagnostic, pas dans un fichier
    // de référence que l'on relit dans six mois.
    problems: (result.legacyProblems ?? []).map((p) => p.code),
    narrativeLength: result.narrativeLength ?? 0,
  };
}

/**
 * Audit narratif complet d'une suite de carrières.
 *
 * `rows` sont des lignes de baseline enrichies : elles doivent porter au moins
 * `ceiling`, `peak`, `legacy`, `durationYears`, `titles`, `orgsCount`,
 * `archetype` et le bloc `story`.
 */
export function narrativeAudit(rows, options = {}) {
  const cfg = { ...STORY_AUDIT, ...options };
  const ok = rows.filter((r) => !r.crash && r.story);
  const n = ok.length;

  return {
    version: cfg.version,
    name: cfg.name,
    careers: n,
    racontabilite: racontabilite(ok),
    coherence: coherence(ok),
    divergence: divergence(ok, cfg),
  };
}

// --- 1. racontabilité ---------------------------------------------------

function racontabilite(rows) {
  const share = (fn) => rate(rows.filter(fn).length, rows.length);
  return {
    tellable: share((r) => r.story.tellable),
    breakthrough: share((r) => r.story.breakthrough),
    bestMoment: share((r) => r.story.bestMoment),
    worstMoment: share((r) => r.story.worstMoment),
    rival: share((r) => r.story.rival),
    bestTeammate: share((r) => r.story.bestTeammate),
    gameChange: share((r) => r.story.gameChange),
    teamChange: share((r) => r.story.teamChange),
    // Ce qui MANQUE aux carrières non racontables : sans cela on sait qu'un
    // problème existe sans savoir lequel corriger.
    manque: manquant(rows),
  };
}

function manquant(rows) {
  const counts = { bestMoment: 0, worstMoment: 0, personnage: 0 };
  for (const r of rows) {
    if (r.story.tellable) continue;
    if (!r.story.bestMoment) counts.bestMoment++;
    if (!r.story.worstMoment) counts.worstMoment++;
    if (!r.story.rival && !r.story.bestTeammate) counts.personnage++;
  }
  return counts;
}

// --- 2. cohérence -------------------------------------------------------

function coherence(rows) {
  const problems = {};
  let sales = 0;
  for (const r of rows) {
    if (r.story.problems.length > 0) sales++;
    for (const code of r.story.problems) problems[code] = (problems[code] ?? 0) + 1;
  }
  const lengths = rows.map((r) => r.story.narrativeLength).sort((a, b) => a - b);
  return {
    // Une seule contradiction suffit à disqualifier un bilan : on mesure la
    // part de récits SANS aucune contradiction, pas une moyenne de défauts.
    sansContradiction: rate(rows.length - sales, rows.length),
    carrieresEnDefaut: sales,
    problemes: sortCounts(problems),
    longueurMediane: lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0,
  };
}

// --- 3. divergence ------------------------------------------------------

function divergence(rows, cfg) {
  const usable = rows.filter((r) => Number.isFinite(r.ceiling));
  const bands = new Map();
  for (const r of usable) {
    const key = Math.floor(r.ceiling / cfg.bandWidth) * cfg.bandWidth;
    if (!bands.has(key)) bands.set(key, []);
    bands.get(key).push(r);
  }
  const kept = [...bands.entries()]
    .filter(([, list]) => list.length >= cfg.minBand)
    .sort((a, b) => a[0] - b[0]);

  const rng = new RNG(normalizeSeed(cfg.seed));

  const metriques = {
    pic: (r) => r.peak,
    legacy: (r) => r.legacy,
    duree: (r) => r.durationYears,
    titres: (r) => r.titles,
    structures: (r) => r.orgsCount,
  };

  const partTalent = {};
  for (const [nom, fn] of Object.entries(metriques)) {
    partTalent[nom] = omegaSquared(kept.map(([, list]) => list.map(fn)));
  }

  const detail = kept.map(([floor, list]) => ({
    plafond: `${floor}-${floor + cfg.bandWidth - 1}`,
    n: list.length,
    picIQR: iqr(list.map((r) => r.peak)),
    legacyIQR: iqr(list.map((r) => r.legacy)),
    dureeIQR: iqr(list.map((r) => r.durationYears)),
    titresIQR: iqr(list.map((r) => r.titles)),
    archetypes: list.length ? distinctAtFixedN(list.map((r) => r.archetype), cfg, rng) : 0,
    partRacontable: rate(list.filter((r) => r.story.tellable).length, list.length),
  }));

  return {
    tranches: detail,
    tranchesRetenues: kept.length,
    carrieresRetenues: kept.reduce((a, [, l]) => a + l.length, 0),
    // Part de la variation expliquée par le plafond. Fort = le talent décide ;
    // faible = tout le reste décide.
    partTalent,
    // Dispersion médiane À PLAFOND COMPARABLE : ce que deux joueurs de même
    // talent peuvent encore vivre de différent.
    aTalentComparable: {
      picIQR: median(detail.map((d) => d.picIQR)),
      legacyIQR: median(detail.map((d) => d.legacyIQR)),
      dureeIQR: median(detail.map((d) => d.dureeIQR)),
      titresIQR: median(detail.map((d) => d.titresIQR)),
      archetypes: round(mean(detail.map((d) => d.archetypes)), 2),
    },
  };
}

/**
 * Nombre de valeurs distinctes attendu sur un échantillon d'effectif FIXE.
 * Un comptage brut croît avec l'échantillon : 5 archétypes sur 40 carrières et
 * 5 sur 400 ne décrivent pas la même diversité. On tire `fixedSample` carrières
 * au hasard, plusieurs fois, et on moyenne. Le RNG est déterministe : deux
 * exécutions de la même suite donnent le même nombre.
 */
function distinctAtFixedN(values, cfg, rng) {
  if (values.length <= cfg.fixedSample) {
    // Trop peu de carrières pour tirer : le comptage brut est le seul possible,
    // et il n'est pas comparable — on le signale en le renvoyant tel quel.
    return new Set(values).size;
  }
  let total = 0;
  for (let r = 0; r < cfg.fixedRepeats; r++) {
    const seen = new Set();
    for (let i = 0; i < cfg.fixedSample; i++) {
      seen.add(values[rng.int(0, values.length - 1)]);
    }
    total += seen.size;
  }
  return round(total / cfg.fixedRepeats, 2);
}

/**
 * ω² : part de variance expliquée par le groupe, corrigée du bruit.
 *
 * η² = SSb / SSt surestime toujours, d'autant plus que les groupes sont petits.
 * ω² retranche l'espérance de cette surestimation, ce qui rend la mesure
 * comparable entre deux suites de tailles différentes — condition posée par
 * l'étape 7G (« métriques de divergence robustes à la taille d'échantillon »).
 * Renvoyé borné à [0, 1] : une valeur négative signifie « aucun effet
 * détectable », ce qui est zéro.
 */
export function omegaSquared(groups) {
  const lists = groups.filter((g) => g.length > 1);
  const k = lists.length;
  const all = lists.flat();
  const N = all.length;
  if (k < 2 || N <= k) return 0;

  const grand = mean(all);
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of lists) {
    const m = mean(g);
    ssBetween += g.length * (m - grand) ** 2;
    for (const v of g) ssWithin += (v - m) ** 2;
  }
  const ssTotal = ssBetween + ssWithin;
  if (ssTotal === 0) return 0;
  const msWithin = ssWithin / (N - k);
  const omega = (ssBetween - (k - 1) * msWithin) / (ssTotal + msWithin);
  return round(Math.max(0, Math.min(1, omega)), 3);
}

// --- utilitaires --------------------------------------------------------

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function median(arr) {
  const v = [...arr].sort((a, b) => a - b);
  return v.length ? round(v[Math.floor(v.length / 2)], 2) : 0;
}

function iqr(values) {
  const v = [...values].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 4) return 0;
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return round(q(0.75) - q(0.25), 2);
}

function rate(a, b) {
  return b ? round(a / b, 3) : 0;
}

function round(v, digits = 3) {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function sortCounts(obj) {
  return Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]));
}
