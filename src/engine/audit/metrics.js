/**
 * Extraction des mesures d'audit (§3, §31, §32).
 *
 * Ce module ne simule rien : il lit un monde et une carrière terminés et en
 * extrait des chiffres comparables. Il contient aussi la vérification de
 * véracité du Legacy (§32) : chaque affirmation du récit final est confrontée
 * aux données historiques.
 */

import { GAMES, GAMES_BY_ID } from '../../data/games.js';
import { STATUS, baseRating, age as personAge, weightedCeiling } from '../person.js';
import { WEEKS_PER_YEAR, yearOf } from '../time.js';
import { computeLegacy, buildNarrative } from '../legacy.js';
import { relationsOf } from '../relations.js';
import { teamStrength } from '../team.js';

/** Mesures relatives à la carrière du joueur. */
export function careerMetrics(session, extra = {}) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  const game = GAMES_BY_ID[person.gameId];
  const legacy = computeLegacy(world, career);
  const s = person.stats;

  const endWeek = career.retiredWeek ?? world.week;
  const durationYears = (endWeek - career.startWeek) / WEEKS_PER_YEAR;
  const startAge = personAge(person, career.startWeek);
  const endAge = personAge(person, endWeek);

  const contracts = person.teamHistory.length;
  const relations = relationsOf(world, person.id, { minAbs: 5 });
  const rival = career.rivalId ? world.persons[career.rivalId] : null;

  // Statut le plus élevé réellement atteint pendant la carrière.
  const reached = {
    hadTeam: contracts > 0,
    wasSemipro: career.counters.reachedStatus?.semipro ?? false,
    wasPro: career.counters.reachedStatus?.pro ?? false,
    wasChampion: s.titles > 0,
    wasRegionalChampion: (career.counters.titlesByTier?.regional ?? 0) > 0,
    wasInternational: (career.counters.titlesByTier?.international ?? 0) > 0,
    wasWorldChampion: (career.counters.titlesByTier?.worlds ?? 0) > 0,
  };

  return {
    // --- identité de la simulation ---
    seed: career.seed,
    policy: extra.policy ?? null,
    gameStart: extra.gameStart ?? null,
    gameEnd: person.gameId,
    originId: career.originId,
    familyId: career.familyId,
    difficulty: career.difficulty,
    traits: person.traits,

    // --- joueur ---
    startAge: round(startAge, 1),
    endAge: round(endAge, 1),
    durationYears: round(durationYears, 1),
    retired: career.retired,
    retirementReason: career.retirementPath ?? null,
    peak: round(s.peakRating, 1),
    peakAge: s.peakWeek ? round(personAge(person, s.peakWeek), 1) : null,
    finalRating: round(baseRating(person, game), 1),
    // Plafond réel pour son jeu final : sert au test des talents gâchés (§9).
    ceiling: round(weightedCeiling(person, game), 1),
    hiddenGrowth: round(person.hidden.growth, 2),
    hiddenAdaptability: round(person.hidden.adaptability, 2),
    hiddenLongevity: round(person.hidden.longevity, 2),

    teamsCount: new Set(person.teamHistory.map((h) => h.teamId)).size,
    orgsCount: career.counters.orgsPlayed.length,
    contracts,
    gameChanges: Math.max(0, career.counters.gamesPlayed.length - 1),
    timesReleased: career.counters.timesReleased,

    matches: s.matches,
    wins: s.wins,
    losses: s.losses,
    winRate: s.matches > 0 ? round(s.wins / s.matches, 3) : 0,
    titles: s.titles,
    titlesByTier: { ...career.counters.titlesByTier },
    finals: s.finals,
    mvps: s.mvps,
    earnings: Math.round(s.earnings),
    seasonsPro: s.seasonsPro,

    followers: person.followers,
    reputation: {
      pros: round(person.reputation.pros, 1),
      public: round(person.reputation.public, 1),
      community: round(person.reputation.community, 1),
      media: round(person.reputation.media, 1),
      toxicity: round(person.reputation.toxicity, 1),
    },

    // --- trajectoire ---
    reached,
    status: person.status,
    legacy: legacy.global,
    dimensions: Object.fromEntries(
      Object.entries(legacy.dimensions).map(([k, v]) => [k, round(v, 1)]),
    ),
    archetype: legacy.archetype.id,

    // --- histoire (§31) ---
    timelineEntries: career.timeline.length,
    importantEntries: career.timeline.filter((t) => t.important).length,
    memories: career.memories.length,
    achievements: career.achievements.map((a) => a.id),
    decisions: career.counters.decisions,
    rivalNick: rival?.nick ?? null,
    rivalFinalRelation: rival ? round(relationValueOf(relations, rival.id), 0) : null,
    relationsCount: relations.length,
    flags: Object.keys(career.flags).filter((k) => career.flags[k]),

    // --- décisions prises, pour l'analyse des choix dominants (§25) ---
    decisionLog: (career.decisionsLog ?? []).map((d) => `${d.eventId}:${d.choiceId}`),
    eventsFired: Object.keys(career.eventState.fired),
    // Nombre d'occurrences par événement : « présent dans 100 % des
    // carrières » ne dit rien sur une carrière de 20 ans ; ce qui compte
    // est la fréquence (§23).
    eventCounts: { ...career.eventState.fired },

    // --- conséquences différées (§21) ---
    deferredPending: career.eventState.scheduledEffects.length,
  };
}

function relationValueOf(relations, otherId) {
  return relations.find((r) => r.other === otherId)?.value ?? 0;
}

/** Mesures relatives au monde à la fin de la simulation. */
export function worldMetrics(world) {
  const persons = Object.values(world.persons);
  const teams = Object.values(world.teams);
  const orgs = Object.values(world.orgs);

  const active = persons.filter(
    (p) => p.status !== STATUS.RETIRED && p.status !== STATUS.STAFF,
  );
  const activeTeams = teams.filter((t) => t.active);

  const ratings = active
    .map((p) => {
      const g = GAMES_BY_ID[p.gameId];
      return g ? baseRating(p, g) : null;
    })
    .filter((r) => r !== null)
    .sort((a, b) => a - b);

  const ages = active.map((p) => personAge(p, world.week)).sort((a, b) => a - b);

  // Top 20 mondial, toutes scènes confondues : sert au suivi générationnel.
  const top = active
    .map((p) => ({ p, r: baseRating(p, GAMES_BY_ID[p.gameId]) }))
    .sort((a, b) => b.r - a.r)
    .slice(0, 20);

  const gameStats = GAMES.map((g) => {
    const gs = world.gameStates[g.id];
    const gameTeams = activeTeams.filter((t) => t.gameId === g.id);
    return {
      id: g.id,
      alive: gs?.alive ?? false,
      popularity: round(gs?.popularity ?? 0, 1),
      patchMajor: gs?.patchMajor ?? 0,
      teams: gameTeams.length,
      players: active.filter((p) => p.gameId === g.id).length,
    };
  });

  // Concentration du talent : part des 20 meilleurs joueurs détenue par les
  // trois organisations les plus fournies (§15, détection des super-teams).
  const byOrg = {};
  for (const { p } of top) {
    if (!p.orgId) continue;
    byOrg[p.orgId] = (byOrg[p.orgId] ?? 0) + 1;
  }
  const topOrgShares = Object.values(byOrg).sort((a, b) => b - a);
  const top3Concentration = topOrgShares.slice(0, 3).reduce((a, b) => a + b, 0) / Math.max(1, top.length);

  return {
    persons: persons.length,
    active: active.length,
    retired: persons.filter((p) => p.status === STATUS.RETIRED).length,
    staff: persons.filter((p) => p.status === STATUS.STAFF).length,
    pros: active.filter((p) => p.status === STATUS.PRO).length,
    semipros: active.filter((p) => p.status === STATUS.SEMIPRO).length,
    amateurs: active.filter((p) => p.status === STATUS.AMATEUR).length,
    unattached: active.filter((p) => !p.teamId).length,
    freeAgents: world.freeAgents.length,

    orgs: orgs.length,
    orgsAlive: orgs.filter((o) => o.alive).length,
    orgsDead: orgs.filter((o) => !o.alive).length,
    teams: teams.length,
    teamsActive: activeTeams.length,
    teamsIncomplete: activeTeams.filter(
      (t) => t.roster.length < (GAMES_BY_ID[t.gameId]?.teamSize ?? 1),
    ).length,

    competitions: Object.values(world.competitions).filter(Boolean).length,
    seasonsArchived: world.seasonArchive.length,

    ratingP10: pct(ratings, 0.1),
    ratingMedian: pct(ratings, 0.5),
    ratingP90: pct(ratings, 0.9),
    ratingMax: ratings.length ? round(ratings[ratings.length - 1], 1) : 0,

    ageMedian: pct(ages, 0.5),
    topPlayerAgeMean: round(mean(top.map(({ p }) => personAge(p, world.week))), 1),
    topPlayerRatingMean: round(mean(top.map((t) => t.r)), 1),
    top3Concentration: round(top3Concentration, 3),

    games: gameStats,
    gamesAlive: gameStats.filter((g) => g.alive).length,
    newsCount: world.news.length,
  };
}

/** Mesures sur les organisations : trajectoires, pas photographies (§18). */
export function orgMetrics(world, initialSnapshot) {
  const orgs = Object.values(world.orgs).filter((o) => !o.isSelfOrg);
  const moved = [];
  let promoted = 0;
  let relegated = 0;
  let died = 0;

  for (const org of orgs) {
    const before = initialSnapshot?.[org.id];
    if (!org.alive) died++;
    if (before === undefined) continue;
    const delta = org.tier - before;
    if (delta > 0) promoted++;
    if (delta < 0) relegated++;
    if (delta !== 0) moved.push({ id: org.id, from: before, to: org.tier });
  }

  const titleCounts = orgs.map((o) => o.titles).sort((a, b) => b - a);
  const totalTitles = titleCounts.reduce((a, b) => a + b, 0);

  return {
    tracked: Object.keys(initialSnapshot ?? {}).length,
    promoted,
    relegated,
    died,
    tierChanges: moved.length,
    // Part des titres détenue par les 3 organisations les plus titrées :
    // proche de 1 = une scène monotone (§18).
    titleConcentration:
      totalTitles > 0 ? round(titleCounts.slice(0, 3).reduce((a, b) => a + b, 0) / totalTitles, 3) : 0,
    orgsWithTitles: titleCounts.filter((t) => t > 0).length,
  };
}

export function snapshotOrgTiers(world) {
  const out = {};
  for (const org of Object.values(world.orgs)) {
    if (org.isSelfOrg) continue;
    out[org.id] = org.tier;
  }
  return out;
}

/** Snapshot d'équipes pour mesurer le turnover (§13). */
export function snapshotTeams(world) {
  const out = {};
  for (const team of Object.values(world.teams)) {
    out[team.id] = { roster: [...team.roster], coachId: team.coachId, tier: team.tier };
  }
  return out;
}

export function teamMetrics(world, before) {
  let rosterChanges = 0;
  let coachChanges = 0;
  let tracked = 0;
  let disappeared = 0;
  const rosterSizes = [];

  for (const [id, snap] of Object.entries(before ?? {})) {
    const team = world.teams[id];
    if (!team) {
      disappeared++;
      continue;
    }
    tracked++;
    if (!team.active) {
      disappeared++;
      continue;
    }
    const beforeSet = new Set(snap.roster);
    const afterSet = new Set(team.roster);
    let changed = 0;
    for (const p of afterSet) if (!beforeSet.has(p)) changed++;
    for (const p of beforeSet) if (!afterSet.has(p)) changed++;
    rosterChanges += changed;
    if (snap.coachId !== team.coachId) coachChanges++;
  }

  for (const team of Object.values(world.teams)) {
    if (team.active) rosterSizes.push(team.roster.length);
  }

  return {
    tracked,
    disappeared,
    rosterChangesPerTeam: tracked > 0 ? round(rosterChanges / tracked, 2) : 0,
    coachChangesPerTeam: tracked > 0 ? round(coachChanges / tracked, 2) : 0,
    meanRosterSize: round(mean(rosterSizes), 2),
  };
}

/**
 * Vérité du Legacy (§32).
 *
 * Confronte le récit final aux données. Toute affirmation vérifiable qui ne
 * correspond pas aux faits est une anomalie majeure : c'est exactement ce que
 * le cahier des charges interdit.
 */
export function verifyLegacy(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  const legacy = computeLegacy(world, career);
  const narrative = buildNarrative(world, career, legacy);
  const text = narrative.join(' ');
  const problems = [];

  const titlesInTimeline = career.timeline.filter((t) => t.kind === 'title').length;

  // 1. « jamais remporté » ne doit apparaître que si c'est vrai.
  if (text.includes('jamais remporté') && person.stats.titles > 0) {
    problems.push({ code: 'denies_existing_titles', detail: `${person.stats.titles} titres réels` });
  }
  // 2. Un titre annoncé doit exister dans la timeline.
  const claimed = text.match(/remportez (\d+) compétitions/);
  if (claimed) {
    const n = Number(claimed[1]);
    if (n > titlesInTimeline) {
      problems.push({ code: 'overstates_titles', detail: `annonce ${n}, timeline ${titlesInTimeline}` });
    }
  }
  // 3. « jamais signé de contrat » doit être vrai.
  if (text.includes('jamais signé de contrat') && person.teamHistory.length > 0) {
    problems.push({ code: 'denies_existing_contract', detail: `${person.teamHistory.length} passages en équipe` });
  }
  // 4. Le rival cité doit exister.
  if (career.rivalId && !world.persons[career.rivalId] && text.includes('fil rouge')) {
    problems.push({ code: 'ghost_rival', detail: career.rivalId });
  }
  // 5. Les années citées doivent être dans la fenêtre de la carrière.
  const startYear = yearOf(career.startWeek);
  const endYear = yearOf(career.retiredWeek ?? world.week);
  for (const m of text.matchAll(/\b(20\d\d)\b/g)) {
    const y = Number(m[1]);
    if (y < startYear || y > endYear) {
      problems.push({ code: 'year_out_of_range', detail: `${y} hors [${startYear}, ${endYear}]` });
    }
  }
  // 6. Le jeu de départ cité doit être le premier réellement joué.
  const firstGame = GAMES_BY_ID[career.counters.gamesPlayed[0]];
  if (firstGame && !text.includes(firstGame.name)) {
    problems.push({ code: 'wrong_first_game', detail: firstGame.name });
  }
  // 7. Les statistiques citées doivent correspondre.
  const matchClaim = text.match(/(\d+) matchs/);
  if (matchClaim && Number(matchClaim[1]) !== person.stats.matches) {
    problems.push({
      code: 'match_count_mismatch',
      detail: `annonce ${matchClaim[1]}, réel ${person.stats.matches}`,
    });
  }

  return { problems, narrativeLength: narrative.length };
}

/** Éléments d'histoire structurés (§31), et leur vérification. */
export function storyMetrics(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];

  const important = career.timeline.filter((t) => t.important);
  const breakthrough = important.find((t) => t.kind === 'contract' || t.kind === 'team') ?? null;
  const bestMoment =
    career.memories.find((m) => m.kind === 'title') ??
    career.memories.find((m) => m.kind === 'comeback') ??
    career.memories[0] ??
    null;
  const worstMoment =
    career.memories.find((m) => m.kind === 'crisis') ??
    important.find((t) => t.kind === 'setback') ??
    null;

  const teammates = relationsOf(world, person.id, { minAbs: 10 }).filter((r) =>
    r.tags.includes('teammate') || r.tags.includes('ex_teammate'),
  );
  const bestTeammate = teammates.length > 0 ? teammates[0] : null;

  return {
    hasBreakthrough: !!breakthrough,
    hasBestMoment: !!bestMoment,
    hasWorstMoment: !!worstMoment,
    hasRival: !!career.rivalId,
    hasBestTeammate: !!bestTeammate,
    hasGameChange: career.counters.gamesPlayed.length > 1,
    hasTeamChange: new Set(person.teamHistory.map((h) => h.teamId)).size > 1,
    // Une histoire « racontable » a au moins un point haut, un point bas et
    // un personnage secondaire identifiable.
    tellable:
      !!bestMoment && !!worstMoment && (!!career.rivalId || !!bestTeammate),
  };
}

// --- utilitaires ---

function round(v, digits = 1) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function pct(sorted, p) {
  if (!sorted || sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return round(sorted[i], 1);
}

export { round, mean, pct };
