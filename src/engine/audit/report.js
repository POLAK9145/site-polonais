/**
 * Agrégation et rapport d'audit (§37).
 *
 * Ce module ne juge pas selon des cibles arbitraires (§38) : il signale les
 * distributions qui trahissent un bug de simulation. Les seuils choisis sont
 * volontairement larges — on cherche l'absurde, pas le réalisme statistique.
 */

import { ACHIEVEMENTS } from '../achievements.js';
import { allEvents } from '../events/index.js';
import { round, mean } from './metrics.js';

function quantile(sortedNumbers, p) {
  if (sortedNumbers.length === 0) return 0;
  const i = Math.min(sortedNumbers.length - 1, Math.max(0, Math.floor(p * sortedNumbers.length)));
  return sortedNumbers[i];
}

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return { n: 0, min: 0, p10: 0, median: 0, p90: 0, max: 0, mean: 0, sd: 0 };
  const m = mean(v);
  const sd = Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
  return {
    n: v.length,
    min: round(v[0], 1),
    p10: round(quantile(v, 0.1), 1),
    median: round(quantile(v, 0.5), 1),
    p90: round(quantile(v, 0.9), 1),
    max: round(v[v.length - 1], 1),
    mean: round(m, 1),
    sd: round(sd, 2),
  };
}

function share(rows, predicate) {
  if (rows.length === 0) return 0;
  return round(rows.filter(predicate).length / rows.length, 3);
}

function tally(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const keys = keyFn(r);
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (k === null || k === undefined) continue;
      out[k] = (out[k] ?? 0) + 1;
    }
  }
  return out;
}

function sortedTally(obj, limit = 30) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

/** Construit le rapport complet à partir des carrières simulées. */
export function buildReport({ careers, worldOnly = null, npc = null, meta = {} }) {
  const n = careers.length;
  const finished = careers.filter((c) => !c.crash);

  // --- Intégrité ---
  const crashes = careers.filter((c) => c.crash);
  const withCareerIssues = careers.filter((c) => c.careerIssues.length > 0);
  const withWorldIssues = careers.filter((c) => c.worldIssues.length > 0);
  const withLegacyProblems = careers.filter((c) => c.legacyProblems.length > 0);

  // --- Distribution des trajectoires (§4) ---
  const distribution = {
    aucuneEquipe: share(finished, (c) => c.contracts === 0),
    aUneEquipe: share(finished, (c) => c.contracts > 0),
    devenusSemipro: share(finished, (c) => c.seasonsPro > 0 || c.status === 'semipro' || c.status === 'pro'),
    devenusPro: share(finished, (c) => c.reached.wasPro || c.status === 'pro'),
    auMoinsUnTitre: share(finished, (c) => c.titles > 0),
    championRegional: share(finished, (c) => (c.titlesByTier.regional ?? 0) > 0),
    championInternational: share(finished, (c) => (c.titlesByTier.international ?? 0) > 0),
    championDuMonde: share(finished, (c) => (c.titlesByTier.worlds ?? 0) > 0),
    changementDeJeu: share(finished, (c) => c.gameChanges > 0),
    grosseAudience: share(finished, (c) => c.followers > 200000),
    carriereCourte: share(finished, (c) => c.durationYears < 5),
    carriereLongue: share(finished, (c) => c.durationYears >= 13),
    licencieAuMoinsUneFois: share(finished, (c) => c.timesReleased > 0),
    unSeulClub: share(finished, (c) => c.orgsCount === 1),
    nomades: share(finished, (c) => c.orgsCount >= 4),
    histoireRacontable: share(finished, (c) => c.story.tellable),
  };

  // --- Diversité (§6) : deux carrières identiques ? ---
  const signatures = finished.map(
    (c) =>
      `${Math.round(c.peak / 3)}|${c.titles}|${Math.round(c.durationYears / 2)}|${c.orgsCount}|${c.archetype}|${c.gameChanges}`,
  );
  const uniqueSignatures = new Set(signatures).size;
  const signatureCounts = sortedTally(tally(finished.map((c, i) => ({ s: signatures[i] })), (r) => r.s), 5);

  // --- Talents et potentiel (§8, §9) ---
  const gapToCeiling = finished.map((c) => round(c.ceiling - c.peak, 1));
  const talents = {
    ecartAuPlafond: stats(gapToCeiling),
    talentsGaches: share(finished, (c) => c.ceiling > 85 && c.peak < c.ceiling - 14),
    surperformances: share(finished, (c) => c.ceiling < 76 && c.peak > c.ceiling + 2),
    plafondAtteint: share(finished, (c) => c.peak >= c.ceiling - 3),
    // Corrélation croissance cachée / pic : doit être positive mais loin de 1.
    correlationCroissancePic: round(correlation(finished.map((c) => c.hiddenGrowth), finished.map((c) => c.peak)), 3),
    correlationPlafondPic: round(correlation(finished.map((c) => c.ceiling), finished.map((c) => c.peak)), 3),
  };

  // --- Traits (§7) ---
  const traitEffects = {};
  const allTraits = new Set(finished.flatMap((c) => c.traits));
  for (const trait of allTraits) {
    const withTrait = finished.filter((c) => c.traits.includes(trait));
    const without = finished.filter((c) => !c.traits.includes(trait));
    if (withTrait.length < 12) continue;
    traitEffects[trait] = {
      n: withTrait.length,
      legacy: round(mean(withTrait.map((c) => c.legacy)) - mean(without.map((c) => c.legacy)), 1),
      peak: round(mean(withTrait.map((c) => c.peak)) - mean(without.map((c) => c.peak)), 1),
      duree: round(mean(withTrait.map((c) => c.durationYears)) - mean(without.map((c) => c.durationYears)), 1),
      orgs: round(mean(withTrait.map((c) => c.orgsCount)) - mean(without.map((c) => c.orgsCount)), 2),
      audience: Math.round(mean(withTrait.map((c) => c.followers)) - mean(without.map((c) => c.followers))),
      // Un trait déterministe serait un défaut : on mesure la dispersion.
      ecartTypeLegacy: stats(withTrait.map((c) => c.legacy)).sd,
    };
  }

  // --- Politiques de jeu (§25) ---
  const policyEffects = {};
  for (const [policy, rows] of Object.entries(groupBy(finished, (c) => c.policy))) {
    policyEffects[policy] = {
      n: rows.length,
      legacy: stats(rows.map((c) => c.legacy)),
      peak: stats(rows.map((c) => c.peak)),
      titres: round(mean(rows.map((c) => c.titles)), 2),
      duree: round(mean(rows.map((c) => c.durationYears)), 1),
      audience: Math.round(mean(rows.map((c) => c.followers))),
      proportionPro: share(rows, (c) => c.reached.wasPro),
    };
  }

  // --- Choix dominants (§25) ---
  const choiceOutcomes = {};
  for (const c of finished) {
    for (const entry of c.decisionLog) {
      if (!choiceOutcomes[entry]) choiceOutcomes[entry] = [];
      choiceOutcomes[entry].push(c.legacy);
    }
  }
  const choiceRanking = Object.entries(choiceOutcomes)
    .filter(([, v]) => v.length >= 15)
    .map(([k, v]) => ({ choice: k, n: v.length, legacyMean: round(mean(v), 1) }))
    .sort((a, b) => b.legacyMean - a.legacyMean);

  // Pour chaque événement, écart entre son meilleur et son pire choix.
  const perEvent = {};
  for (const row of choiceRanking) {
    const [eventId] = row.choice.split(':');
    (perEvent[eventId] ??= []).push(row);
  }
  const dominantChoices = Object.entries(perEvent)
    .filter(([, rows]) => rows.length >= 2)
    .map(([eventId, rows]) => {
      const sorted = [...rows].sort((a, b) => b.legacyMean - a.legacyMean);
      return {
        eventId,
        best: sorted[0].choice.split(':')[1],
        worst: sorted[sorted.length - 1].choice.split(':')[1],
        spread: round(sorted[0].legacyMean - sorted[sorted.length - 1].legacyMean, 1),
        n: rows.reduce((a, r) => a + r.n, 0),
      };
    })
    .sort((a, b) => b.spread - a.spread);

  // --- Événements (§23) ---
  const eventCounts = tally(finished, (c) => c.eventsFired);
  const occurrenceTotals = {};
  for (const c of finished) {
    for (const [id, n] of Object.entries(c.eventCounts ?? {})) {
      occurrenceTotals[id] = (occurrenceTotals[id] ?? 0) + n;
    }
  }
  const definedEvents = allEvents().map((e) => e.id);
  const neverFired = definedEvents.filter((id) => !eventCounts[id]);
  const eventFrequency = sortedTally(occurrenceTotals, 40).map(([id, occurrences]) => ({
    id,
    occurrences,
    perCareer: round(occurrences / Math.max(1, finished.length), 2),
    shareOfCareers: round((eventCounts[id] ?? 0) / Math.max(1, finished.length), 3),
  }));

  // --- Succès (§36) ---
  const achievementCounts = tally(finished, (c) => c.achievements);
  const neverUnlocked = ACHIEVEMENTS.map((a) => a.id).filter((id) => !achievementCounts[id]);

  // --- Archétypes (§34) ---
  const archetypes = sortedTally(tally(finished, (c) => c.archetype), 30).map(([id, count]) => ({
    id,
    count,
    share: round(count / Math.max(1, finished.length), 3),
  }));

  // --- Anomalies ---
  const anomalies = detectAnomalies({
    n: finished.length,
    distribution,
    uniqueSignatures,
    signatureCounts,
    talents,
    traitEffects,
    policyEffects,
    dominantChoices,
    eventFrequency,
    neverFired,
    crashes,
    withCareerIssues,
    withWorldIssues,
    withLegacyProblems,
    worldOnly,
    npc,
    careers: finished,
  });

  return {
    meta: { ...meta, careersRequested: n, careersCompleted: finished.length },
    integrity: {
      crashes: crashes.length,
      crashSamples: crashes.slice(0, 5).map((c) => ({ seed: c.seed, ...c.crash })),
      careerIssues: withCareerIssues.length,
      careerIssueCodes: sortedTally(tally(withCareerIssues, (c) => c.careerIssues), 12),
      worldIssues: withWorldIssues.length,
      worldIssueCodes: sortedTally(tally(withWorldIssues, (c) => c.worldIssues), 12),
      legacyProblems: withLegacyProblems.length,
      legacyProblemCodes: sortedTally(
        tally(withLegacyProblems, (c) => c.legacyProblems.map((p) => p.code)),
        12,
      ),
      timeLimitReached: careers.filter((c) => c.reachedTimeLimit).length,
    },
    player: {
      startAge: stats(finished.map((c) => c.startAge)),
      endAge: stats(finished.map((c) => c.endAge)),
      duration: stats(finished.map((c) => c.durationYears)),
      peak: stats(finished.map((c) => c.peak)),
      peakAge: stats(finished.map((c) => c.peakAge).filter((x) => x !== null)),
      finalRating: stats(finished.map((c) => c.finalRating)),
      orgs: stats(finished.map((c) => c.orgsCount)),
      contracts: stats(finished.map((c) => c.contracts)),
      gameChanges: stats(finished.map((c) => c.gameChanges)),
      titles: stats(finished.map((c) => c.titles)),
      finals: stats(finished.map((c) => c.finals)),
      matches: stats(finished.map((c) => c.matches)),
      winRate: stats(finished.map((c) => c.winRate)),
      earnings: stats(finished.map((c) => c.earnings)),
      followers: stats(finished.map((c) => c.followers)),
      legacy: stats(finished.map((c) => c.legacy)),
      decisions: stats(finished.map((c) => c.decisions)),
      timelineEntries: stats(finished.map((c) => c.timelineEntries)),
      reputationPros: stats(finished.map((c) => c.reputation.pros)),
      reputationPublic: stats(finished.map((c) => c.reputation.public)),
    },
    distribution,
    diversity: {
      uniqueSignatures,
      uniqueShare: round(uniqueSignatures / Math.max(1, finished.length), 3),
      mostCommonSignatures: signatureCounts,
      archetypes,
      retirementReasons: sortedTally(tally(finished, (c) => c.retirementReason), 12),
    },
    talents,
    traits: traitEffects,
    policies: policyEffects,
    choices: { dominantChoices: dominantChoices.slice(0, 20), ranking: choiceRanking.slice(0, 20) },
    events: {
      distinctFired: Object.keys(eventCounts).length,
      defined: definedEvents.length,
      neverFired,
      frequency: eventFrequency,
      deferredPending: stats(finished.map((c) => c.deferredPending)),
    },
    achievements: {
      unlockedKinds: Object.keys(achievementCounts).length,
      defined: ACHIEVEMENTS.length,
      neverUnlocked,
      frequency: sortedTally(achievementCounts, 30),
    },
    story: {
      tellable: share(finished, (c) => c.story.tellable),
      withRival: share(finished, (c) => c.story.hasRival),
      withBestMoment: share(finished, (c) => c.story.hasBestMoment),
      withWorstMoment: share(finished, (c) => c.story.hasWorstMoment),
      withGameChange: share(finished, (c) => c.story.hasGameChange),
      withTeamChange: share(finished, (c) => c.story.hasTeamChange),
      memories: stats(finished.map((c) => c.memories)),
    },
    interaction: {
      offersSeen: stats(finished.map((c) => c.interaction.offersSeen)),
      offersAccepted: stats(finished.map((c) => c.interaction.offersAccepted)),
      seekAttempts: stats(finished.map((c) => c.interaction.seekAttempts)),
      seekSuccessRate: round(
        mean(
          finished
            .filter((c) => c.interaction.seekAttempts > 0)
            .map((c) => c.interaction.seekSuccesses / c.interaction.seekAttempts),
        ),
        3,
      ),
      teamsFounded: stats(finished.map((c) => c.interaction.teamsFounded)),
    },
    world: summarizeWorlds(finished),
    worldOnly,
    npc: npc ? summarizeNpc(npc) : null,
    anomalies,
  };
}

function summarizeWorlds(careers) {
  const worlds = careers.map((c) => c.world).filter(Boolean);
  if (worlds.length === 0) return null;
  const orgs = careers.map((c) => c.orgs).filter(Boolean);
  const teams = careers.map((c) => c.teams).filter(Boolean);
  return {
    samples: worlds.length,
    persons: stats(worlds.map((w) => w.persons)),
    active: stats(worlds.map((w) => w.active)),
    retired: stats(worlds.map((w) => w.retired)),
    pros: stats(worlds.map((w) => w.pros)),
    teamsActive: stats(worlds.map((w) => w.teamsActive)),
    teamsIncomplete: stats(worlds.map((w) => w.teamsIncomplete)),
    orgsDead: stats(worlds.map((w) => w.orgsDead)),
    gamesAlive: stats(worlds.map((w) => w.gamesAlive)),
    ratingMedian: stats(worlds.map((w) => w.ratingMedian)),
    ratingMax: stats(worlds.map((w) => w.ratingMax)),
    topPlayerAgeMean: stats(worlds.map((w) => w.topPlayerAgeMean)),
    top3Concentration: stats(worlds.map((w) => w.top3Concentration)),
    orgPromotions: stats(orgs.map((o) => o.promoted)),
    orgRelegations: stats(orgs.map((o) => o.relegated)),
    titleConcentration: stats(orgs.map((o) => o.titleConcentration)),
    orgsWithTitles: stats(orgs.map((o) => o.orgsWithTitles)),
    rosterChangesPerTeam: stats(teams.map((t) => t.rosterChangesPerTeam)),
    coachChangesPerTeam: stats(teams.map((t) => t.coachChangesPerTeam)),
  };
}

function summarizeNpc(npc) {
  const t = npc.trajectories;
  return {
    tracked: t.length,
    oublies: share(t, (x) => !x.alive),
    retraites: share(t, (x) => x.status === 'retired' || x.status === 'staff'),
    teams: stats(t.map((x) => x.teams)),
    peak: stats(t.map((x) => x.peak)),
    titles: stats(t.map((x) => x.titles)),
    retiredAge: stats(t.map((x) => x.retiredAge).filter((x) => x !== null)),
    talentsGaches: share(t, (x) => x.wastedTalent),
    surperformances: share(t, (x) => x.overperformed),
    changementsDeJeu: share(t, (x) => x.games > 1),
    uniqueTrajectories: new Set(
      t.map((x) => `${x.teams}|${Math.round(x.peak / 4)}|${x.titles}|${x.games}`),
    ).size,
  };
}

/**
 * Détection d'anomalies (§4).
 * Seuils larges, volontairement : on cherche l'absurde et le monotone.
 */
function detectAnomalies(ctx) {
  const a = [];
  const add = (severity, code, message, data = null) => a.push({ severity, code, message, data });

  if (ctx.crashes.length > 0) {
    add('critique', 'crashes', `${ctx.crashes.length} carrière(s) ont levé une exception.`, ctx.crashes[0].crash);
  }
  if (ctx.withWorldIssues.length > 0) {
    add('critique', 'world_incoherent', `${ctx.withWorldIssues.length} monde(s) terminent en état incohérent.`);
  }
  if (ctx.withCareerIssues.length > 0) {
    add('critique', 'career_incoherent', `${ctx.withCareerIssues.length} carrière(s) en état incohérent.`);
  }
  if (ctx.withLegacyProblems.length > 0) {
    add('critique', 'legacy_faux', `${ctx.withLegacyProblems.length} récit(s) final(aux) contredisent les données.`);
  }

  const d = ctx.distribution;
  if (d.championDuMonde > 0.35) {
    add('majeure', 'trop_de_champions_du_monde', `${pctStr(d.championDuMonde)} deviennent champions du monde.`);
  }
  if (d.auMoinsUnTitre > 0.9) {
    add('majeure', 'titres_trop_faciles', `${pctStr(d.auMoinsUnTitre)} remportent au moins un titre.`);
  }
  if (d.auMoinsUnTitre < 0.04) {
    add('majeure', 'titres_inatteignables', `Seulement ${pctStr(d.auMoinsUnTitre)} remportent un titre.`);
  }
  if (d.aUneEquipe < 0.5) {
    add('majeure', 'acces_equipe_bloque', `${pctStr(1 - d.aUneEquipe)} ne trouvent jamais d'équipe.`);
  }
  if (d.devenusPro < 0.03) {
    add('majeure', 'professionnalisation_impossible', `Seulement ${pctStr(d.devenusPro)} atteignent le statut pro.`);
  }
  if (d.devenusPro > 0.85) {
    add('majeure', 'professionnalisation_automatique', `${pctStr(d.devenusPro)} deviennent pro : trop facile.`);
  }
  if (d.histoireRacontable < 0.4) {
    add('moyenne', 'histoires_pauvres', `Seulement ${pctStr(d.histoireRacontable)} des carrières ont une histoire racontable.`);
  }

  if (ctx.uniqueSignatures / Math.max(1, ctx.n) < 0.35) {
    add('majeure', 'trajectoires_clonees', `Seulement ${ctx.uniqueSignatures} signatures distinctes sur ${ctx.n} carrières.`);
  }
  const topSig = ctx.signatureCounts[0];
  if (topSig && topSig[1] / Math.max(1, ctx.n) > 0.15) {
    add('majeure', 'signature_dominante', `Une même trajectoire couvre ${pctStr(topSig[1] / ctx.n)} des carrières.`, topSig);
  }

  if (ctx.talents.talentsGaches < 0.02) {
    add('moyenne', 'pas_de_talent_gache', 'Presque aucun grand talent n’échoue : le potentiel est une garantie (§8).');
  }
  if (ctx.talents.plafondAtteint > 0.7) {
    add('moyenne', 'plafond_systematiquement_atteint', `${pctStr(ctx.talents.plafondAtteint)} atteignent leur plafond : le contexte ne compte pas assez.`);
  }
  if (Math.abs(ctx.talents.correlationPlafondPic) > 0.95) {
    add('majeure', 'potentiel_deterministe', `Corrélation plafond/pic de ${ctx.talents.correlationPlafondPic} : le potentiel est une garantie.`);
  }

  for (const [trait, e] of Object.entries(ctx.traitEffects)) {
    if (e.ecartTypeLegacy < 4) {
      add('moyenne', 'trait_deterministe', `Le trait « ${trait} » produit des carrières trop uniformes (écart-type ${e.ecartTypeLegacy}).`);
    }
  }
  const traitDeltas = Object.values(ctx.traitEffects).map((e) => Math.abs(e.legacy));
  if (traitDeltas.length > 0 && Math.max(...traitDeltas) < 1.5) {
    add('majeure', 'traits_sans_effet', 'Aucun trait ne modifie mesurablement les carrières (§7).');
  }

  const policyLegacies = Object.entries(ctx.policyEffects).map(([id, p]) => [id, p.legacy.mean]);
  if (policyLegacies.length >= 2) {
    const sorted = [...policyLegacies].sort((x, y) => y[1] - x[1]);
    const spread = sorted[0][1] - sorted[sorted.length - 1][1];
    if (spread < 3) {
      add('majeure', 'decisions_sans_impact', `Toutes les politiques de jeu produisent le même résultat (écart ${round(spread, 1)}).`);
    }
    if (spread > 45) {
      add('moyenne', 'politique_dominante', `La politique « ${sorted[0][0]} » domine largement (écart ${round(spread, 1)} points de legacy).`);
    }
  }

  for (const dc of ctx.dominantChoices.slice(0, 5)) {
    if (dc.spread > 25) {
      add('moyenne', 'choix_dominant', `${dc.eventId} : le choix « ${dc.best} » vaut ${dc.spread} points de legacy de plus que « ${dc.worst} ».`, dc);
    }
  }

  // Un événement omniprésent se mesure en occurrences par carrière : sur
  // vingt ans, « présent au moins une fois » ne signale rien.
  const topEvent = ctx.eventFrequency[0];
  const totalOccurrences = ctx.eventFrequency.reduce((a, e) => a + e.occurrences, 0);
  if (topEvent && totalOccurrences > 0 && topEvent.occurrences / totalOccurrences > 0.15) {
    add('moyenne', 'evenement_omnipresent',
      `${topEvent.id} représente ${pctStr(topEvent.occurrences / totalOccurrences)} de tous les événements joués (${topEvent.perCareer}/carrière).`);
  }
  if (ctx.neverFired.length > 0) {
    add('moyenne', 'evenements_morts', `${ctx.neverFired.length} événement(s) ne se déclenchent jamais.`, ctx.neverFired);
  }

  if (ctx.worldOnly) {
    const last = ctx.worldOnly.samples[ctx.worldOnly.samples.length - 1];
    if (ctx.worldOnly.crash) {
      add('critique', 'monde_sans_joueur_crash', `Le monde sans joueur a planté : ${ctx.worldOnly.crash.message}`);
    }
    if (last && last.active < 150) {
      add('critique', 'monde_qui_se_vide', `Après ${last.year} ans sans joueur, seulement ${last.active} joueurs actifs.`);
    }
    if (last && last.teamsActive < 40) {
      add('critique', 'monde_sans_equipes', `Après ${last.year} ans, seulement ${last.teamsActive} équipes actives.`);
    }
    if (last && last.gamesAlive < 4) {
      add('majeure', 'scenes_eteintes', `Seulement ${last.gamesAlive} scènes encore vivantes après ${last.year} ans.`);
    }
    if (ctx.worldOnly.newcomers < 100) {
      add('majeure', 'pas_de_renouvellement', `Seulement ${ctx.worldOnly.newcomers} nouveaux joueurs en ${ctx.worldOnly.years} ans.`);
    }
    const champs = ctx.worldOnly.championsByYear ?? [];
    const emptyYears = champs.filter((c) => c.majorChampions === 0).length;
    if (emptyYears > champs.length * 0.2) {
      add('majeure', 'annees_sans_champion', `${emptyYears} années sur ${champs.length} sans champion majeur.`);
    }
    if (ctx.worldOnly.finalIssues.length > 0) {
      add('critique', 'monde_sans_joueur_incoherent', `${ctx.worldOnly.finalIssues.length} incohérences après ${ctx.worldOnly.years} ans.`);
    }
  }

  if (ctx.npc) {
    const s = summarizeNpc(ctx.npc);
    if (s.uniqueTrajectories / Math.max(1, s.tracked) < 0.3) {
      add('majeure', 'pnj_clones', `Les PNJ suivent ${s.uniqueTrajectories} trajectoires distinctes sur ${s.tracked}.`);
    }
    if (s.retraites < 0.2) {
      add('moyenne', 'pnj_immortels', `Seulement ${pctStr(s.retraites)} des PNJ suivis prennent leur retraite.`);
    }
    if (s.teams.median <= 1) {
      add('moyenne', 'pnj_immobiles', 'Les PNJ suivis ne changent pratiquement jamais d’équipe (§16).');
    }
  }

  const w = summarizeWorlds(ctx.careers);
  if (w) {
    if (w.teamsIncomplete.median > 2) {
      add('majeure', 'effectifs_incomplets', `Médiane de ${w.teamsIncomplete.median} équipes incomplètes en fin de simulation.`);
    }
    if (w.top3Concentration.median > 0.7) {
      add('majeure', 'super_teams', `Les 3 meilleures organisations concentrent ${pctStr(w.top3Concentration.median)} du top 20 (§15).`);
    }
    if (w.titleConcentration.median > 0.8) {
      add('majeure', 'hegemonie', `Les 3 organisations les plus titrées détiennent ${pctStr(w.titleConcentration.median)} des titres (§18).`);
    }
    if (w.orgPromotions.median === 0 && w.orgRelegations.median === 0) {
      add('moyenne', 'hierarchie_figee', 'Aucune promotion ni relégation : la hiérarchie des organisations est figée (§17, §18).');
    }
    if (w.rosterChangesPerTeam.median < 1) {
      add('moyenne', 'mercato_atone', `Seulement ${w.rosterChangesPerTeam.median} changement(s) de roster par équipe (§14).`);
    }
    if (w.topPlayerAgeMean.median > 29) {
      add('moyenne', 'pas_de_releve', `Âge moyen du top 20 : ${w.topPlayerAgeMean.median} ans — la relève ne prend pas le pouvoir (§10).`);
    }
  }

  return a.sort((x, y) => severityRank(y.severity) - severityRank(x.severity));
}

function severityRank(s) {
  return s === 'critique' ? 3 : s === 'majeure' ? 2 : 1;
}

function pctStr(v) {
  return `${Math.round(v * 1000) / 10} %`;
}

function groupBy(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r) ?? 'inconnu';
    (out[k] ??= []).push(r);
  }
  return out;
}

function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

export { stats, share, tally, sortedTally, correlation };
