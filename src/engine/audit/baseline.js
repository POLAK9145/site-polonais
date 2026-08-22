/**
 * Baseline reproductible et immuable.
 *
 * Une correction de moteur ne peut être jugée que par comparaison. Ce module
 * fige une suite de simulations — mêmes seeds, mêmes conditions initiales,
 * mêmes paramètres — et permet de la rejouer à l'identique après chaque
 * modification.
 *
 * IMPORTANT SUR LA REPRODUCTIBILITÉ
 * ---------------------------------
 * Les *entrées* sont strictement reproductibles : la seed d'une carrière, sa
 * configuration de personnage et sa politique de décision sont dérivées
 * uniquement de son index dans la suite. Rejouer la suite après une
 * modification du moteur régénère donc exactement les mêmes points de départ.
 *
 * Les *sorties* individuelles, elles, divergeront : toute modification du
 * moteur déplace le flux aléatoire, et la carrière n° 37 ne racontera plus la
 * même histoire. C'est attendu et ce n'est pas un défaut de la méthode. Ce
 * que l'on compare, ce sont les DISTRIBUTIONS sur l'ensemble de la suite, pas
 * les carrières une à une.
 */

import { createHash } from 'node:crypto';
import { RNG, normalizeSeed } from '../rng.js';
import { POLICY_IDS } from './policies.js';
import { randomPlayerConfig } from './runner.js';
import { storyAuditRow, narrativeAudit } from './storyAudit.js';

/**
 * Définition figée de la suite de référence.
 * Modifier ces valeurs invalide toute comparaison : la version doit alors
 * changer, et un nouveau baseline être enregistré sous un nouveau nom.
 */
export const BASELINE_SUITE = {
  version: 1,
  name: 'baseline-v1',
  careers: 1400,
  years: 20,
  seedRoot: 'baseline-v1',
  difficulty: 'standard',
  startYear: 2030,
  // Un monde sur cinq collecte les mesures complètes (coûteuses).
  worldSampleEvery: 5,
  worlds: [
    { id: 'monde-a', seed: 'baseline-v1:world:a', years: 30 },
    { id: 'monde-b', seed: 'baseline-v1:world:b', years: 30 },
  ],
  npc: { seed: 'baseline-v1:npc', years: 20, sample: 120 },
};

/**
 * Construit la liste des tâches de la suite.
 * Fonction pure de la définition ci-dessus : deux appels produisent des
 * tâches identiques, aujourd'hui comme dans six mois.
 */
export function buildSuiteTasks(suite = BASELINE_SUITE) {
  const tasks = [];
  for (let i = 0; i < suite.careers; i++) {
    const seed = `${suite.seedRoot}:${i}`;
    // La configuration du personnage est tirée d'un RNG dédié, indépendant
    // du moteur : elle reste identique même si la simulation change.
    const playerConfig = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
    tasks.push({
      index: i,
      seed,
      years: suite.years,
      difficulty: suite.difficulty,
      policyId: POLICY_IDS[i % POLICY_IDS.length],
      playerConfig,
      collectWorld: i % suite.worldSampleEvery === 0,
    });
  }
  return tasks;
}

/** Empreinte des ENTRÉES : garantit qu'on compare bien la même suite. */
export function suiteFingerprint(suite = BASELINE_SUITE) {
  const tasks = buildSuiteTasks(suite);
  const material = tasks
    .map(
      (t) =>
        `${t.seed}|${t.policyId}|${t.difficulty}|${t.years}|${t.playerConfig.gameId}|` +
        `${t.playerConfig.originId}|${t.playerConfig.familyId}|${t.playerConfig.regionId}|` +
        `${t.playerConfig.age.toFixed(4)}|${t.playerConfig.baseLevel.toFixed(4)}`,
    )
    .join('\n');
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/**
 * Réduit une carrière simulée aux champs conservés dans le baseline.
 * Volontairement restreint : un baseline doit rester lisible, diffable et
 * stable dans le temps.
 */
export function baselineCareerRow(result) {
  return {
    seed: result.seed,
    policy: result.policy,
    gameStart: result.gameStart,
    gameEnd: result.gameEnd,
    originId: result.originId,
    durationYears: result.durationYears,
    endAge: result.endAge,
    retirementReason: result.retirementReason,
    peak: result.peak,
    finalRating: result.finalRating,
    ceiling: result.ceiling,
    legacy: result.legacy,
    archetype: result.archetype,
    titles: result.titles,
    worldTitles: result.titlesByTier?.worlds ?? 0,
    internationalTitles: result.titlesByTier?.international ?? 0,
    regionalTitles: result.titlesByTier?.regional ?? 0,
    teamsCount: result.teamsCount,
    orgsCount: result.orgsCount,
    contracts: result.contracts,
    gameChanges: result.gameChanges,
    followers: result.followers,
    peakFollowers: result.peakFollowers,
    reachedPro: !!result.reached?.wasPro,
    reachedSemipro: !!result.reached?.wasSemipro,
    winRate: result.winRate,
    matches: result.matches,
    earnings: result.earnings,
    crash: result.crash ? result.crash.message : null,
    worldIssues: result.worldIssues?.length ?? 0,
    careerIssues: result.careerIssues?.length ?? 0,
    // Volet narratif (étape 7G). Il voyage AVEC la ligne de carrière : une
    // histoire ne se juge pas sur un fichier séparé qu'on oublierait de
    // rejouer. L'empreinte de la suite porte sur les entrées, pas sur les
    // colonnes conservées : ajouter ce champ n'invalide pas baseline-v1, il
    // n'est simplement pas renseigné avant 7G.
    story: storyAuditRow(result),
  };
}

/** Réduit un monde sans joueur aux champs conservés. */
export function baselineWorldRow(worldResult) {
  return {
    seed: worldResult.seed,
    years: worldResult.years,
    crash: worldResult.crash ? worldResult.crash.message : null,
    newcomers: worldResult.newcomers,
    survivors: worldResult.survivors,
    finalIssues: worldResult.finalIssues.length,
    promoted: worldResult.orgs.promoted,
    relegated: worldResult.orgs.relegated,
    orgsDied: worldResult.orgs.died,
    rosterChangesPerTeam: worldResult.teams.rosterChangesPerTeam,
    yearsWithoutMajorChampion: worldResult.championsByYear.filter((c) => c.majorChampions === 0).length,
    samples: worldResult.samples.map((s) => ({
      year: s.year,
      persons: s.persons,
      active: s.active,
      retired: s.retired,
      pros: s.pros,
      semipros: s.semipros,
      amateurs: s.amateurs,
      unattached: s.unattached,
      teamsActive: s.teamsActive,
      teamsIncomplete: s.teamsIncomplete,
      teamsByTier: s.teamsByTier,
      teamsByDivision: s.teamsByDivision,
      orgsAlive: s.orgsAlive,
      orgsDead: s.orgsDead,
      gamesAlive: s.gamesAlive,
      ratingMedian: s.ratingMedian,
      ratingMax: s.ratingMax,
      topPlayerAgeMean: s.topPlayerAgeMean,
      games: s.games.map((g) => ({ id: g.id, alive: g.alive, popularity: g.popularity, teams: g.teams, players: g.players })),
    })),
  };
}

/** Indicateurs de synthèse : ce que l'on compare en priorité. */
export function baselineHeadlines(careers, worlds, narrative = narrativeAudit(careers)) {
  const ok = careers.filter((c) => !c.crash);
  const num = (fn) => ok.map(fn).filter((x) => typeof x === 'number' && Number.isFinite(x));
  const med = (arr) => {
    const v = [...arr].sort((a, b) => a - b);
    return v.length ? Math.round(v[Math.floor(v.length / 2)] * 100) / 100 : 0;
  };
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : 0);
  const rate = (fn) => Math.round((ok.filter(fn).length / Math.max(1, ok.length)) * 1000) / 1000;

  const lastSamples = worlds.map((w) => w.samples[w.samples.length - 1]).filter(Boolean);
  const avgLast = (fn) => avg(lastSamples.map(fn));

  return {
    careersCompleted: ok.length,
    crashes: careers.length - ok.length,
    worldIssues: careers.reduce((a, c) => a + (c.worldIssues ?? 0), 0),
    careerIssues: careers.reduce((a, c) => a + (c.careerIssues ?? 0), 0),

    durationMedian: med(num((c) => c.durationYears)),
    peakMedian: med(num((c) => c.peak)),
    peakMax: Math.max(0, ...num((c) => c.peak)),
    legacyMedian: med(num((c) => c.legacy)),
    legacyMean: avg(num((c) => c.legacy)),
    titlesMean: avg(num((c) => c.titles)),
    orgsMedian: med(num((c) => c.orgsCount)),
    gameChangesMean: avg(num((c) => c.gameChanges)),
    winRateMedian: med(num((c) => c.winRate)),
    followersMedian: med(num((c) => c.followers)),
    followersP90: percentile(num((c) => c.followers), 0.9),
    peakFollowersMax: Math.max(0, ...num((c) => c.peakFollowers)),

    shareReachedPro: rate((c) => c.reachedPro),
    shareTitled: rate((c) => c.titles > 0),
    shareWorldChampion: rate((c) => c.worldTitles > 0),
    shareGameChange: rate((c) => c.gameChanges > 0),
    shareSingleOrg: rate((c) => c.orgsCount === 1),
    shareNomad: rate((c) => c.orgsCount >= 4),

    uniqueSignatures: new Set(
      ok.map(
        (c) =>
          `${Math.round(c.peak / 3)}|${c.titles}|${Math.round(c.durationYears / 2)}|${c.orgsCount}|${c.archetype}|${c.gameChanges}`,
      ),
    ).size,
    archetypeShares: shareMap(ok.map((c) => c.archetype)),

    // Monde sans joueur, à l'année finale.
    worldFinalActive: avgLast((s) => s.active),
    worldFinalTeams: avgLast((s) => s.teamsActive),
    worldFinalOrgs: avgLast((s) => s.orgsAlive),
    worldFinalGamesAlive: avgLast((s) => s.gamesAlive),
    worldFinalAmateurTeams: avgLast((s) => s.teamsByDivision?.amateur ?? 0),
    worldFinalTier1Teams: avgLast((s) => s.teamsByTier?.['1'] ?? 0),
    worldFinalTopAge: avgLast((s) => s.topPlayerAgeMean),
    worldPromotions: avg(worlds.map((w) => w.promoted)),
    worldRelegations: avg(worlds.map((w) => w.relegated)),
    worldNewcomers: avg(worlds.map((w) => w.newcomers)),
    worldIssuesFinal: avg(worlds.map((w) => w.finalIssues)),

    // --- audit narratif (étape 7G) ---
    // Aplatis ici pour que `compareHeadlines` les traite comme n'importe quel
    // autre indicateur. Une exécution antérieure à 7G ne les porte pas : la
    // comparaison les ignore alors au lieu de crier à la régression.
    storyTellable: narrative.racontabilite.tellable,
    storyCoherent: narrative.coherence.sansContradiction,
    storyRival: narrative.racontabilite.rival,
    storyBestTeammate: narrative.racontabilite.bestTeammate,
    storyProblemCount: narrative.coherence.carrieresEnDefaut,
    // Part de variation expliquée par le plafond. On veut qu'elle reste FORTE
    // pour le niveau atteint et FAIBLE pour tout le reste.
    talentSharePeak: narrative.divergence.partTalent.pic,
    talentShareLegacy: narrative.divergence.partTalent.legacy,
    talentShareDuration: narrative.divergence.partTalent.duree,
    talentShareTitles: narrative.divergence.partTalent.titres,
    // Dispersion à plafond comparable : l'effet des décisions, une fois le
    // talent neutralisé.
    divPeakIQR: narrative.divergence.aTalentComparable.picIQR,
    divLegacyIQR: narrative.divergence.aTalentComparable.legacyIQR,
    divDureeIQR: narrative.divergence.aTalentComparable.dureeIQR,
    divArchetypes: narrative.divergence.aTalentComparable.archetypes,
  };
}

function percentile(values, p) {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return 0;
  return v[Math.min(v.length - 1, Math.floor(p * v.length))];
}

function shareMap(values) {
  const counts = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  const total = Math.max(1, values.length);
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => [k, Math.round((n / total) * 1000) / 1000]),
  );
}

/**
 * Compare deux jeux d'indicateurs et signale les écarts notables.
 * `guards` liste les propriétés que les corrections ne doivent pas casser
 * (§10 de la consigne) : elles sont vérifiées explicitement.
 */
export const GUARDED_PROPERTIES = [
  { key: 'uniqueSignatures', label: 'diversité (signatures uniques)', direction: 'higher', tolerance: 0.15 },
  { key: 'legacyMedian', label: 'legacy médian', direction: 'any', tolerance: 0.35 },
  { key: 'peakMedian', label: 'pic médian', direction: 'any', tolerance: 0.15 },
  { key: 'shareReachedPro', label: 'part atteignant le statut pro', direction: 'any', tolerance: 0.4 },
  { key: 'shareTitled', label: 'part avec au moins un titre', direction: 'any', tolerance: 0.5 },
  { key: 'worldFinalActive', label: 'joueurs actifs à 30 ans', direction: 'higher', tolerance: 0.2 },
  { key: 'worldFinalTeams', label: 'équipes actives à 30 ans', direction: 'higher', tolerance: 0.2 },
  { key: 'worldFinalGamesAlive', label: 'scènes vivantes à 30 ans', direction: 'higher', tolerance: 0.2 },
  // --- ajouts 7G ---
  // Un récit qui se contredit est un défaut majeur, pas une dérive tolérable :
  // la tolérance est donc serrée.
  { key: 'storyCoherent', label: 'bilans sans contradiction', direction: 'higher', tolerance: 0.02 },
  { key: 'storyTellable', label: 'carrières racontables', direction: 'higher', tolerance: 0.15 },
  // Le talent doit continuer à décider du niveau atteint : c'est la propriété
  // que 7G interdit explicitement de casser pour gagner de la divergence.
  { key: 'talentSharePeak', label: 'part du talent dans le niveau atteint', direction: 'higher', tolerance: 0.15 },
  // …et les décisions doivent continuer à décider du reste.
  { key: 'divLegacyIQR', label: 'divergence du legacy à talent comparable', direction: 'higher', tolerance: 0.2 },
  { key: 'divArchetypes', label: 'archétypes distincts à talent comparable', direction: 'higher', tolerance: 0.15 },
];

export function compareHeadlines(before, after) {
  const rows = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    const delta = b - a;
    const relative = a !== 0 ? delta / Math.abs(a) : delta === 0 ? 0 : 1;
    rows.push({ key, before: a, after: b, delta: round2(delta), relative: round2(relative) });
  }
  rows.sort((x, y) => Math.abs(y.relative) - Math.abs(x.relative));

  const regressions = [];
  for (const g of GUARDED_PROPERTIES) {
    const row = rows.find((r) => r.key === g.key);
    if (!row) continue;
    const worse =
      g.direction === 'higher'
        ? row.relative < -g.tolerance
        : Math.abs(row.relative) > g.tolerance;
    if (worse) {
      regressions.push({
        key: g.key,
        label: g.label,
        before: row.before,
        after: row.after,
        relative: row.relative,
      });
    }
  }

  return { rows, regressions };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
