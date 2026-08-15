/**
 * Mise en forme du rapport d'audit pour lecture en console (§37).
 * Aucune logique d'analyse ici : uniquement de la présentation.
 */

function pct(v) {
  return `${(v * 100).toFixed(1).padStart(5)} %`;
}

function line(label, s, width = 30) {
  return `  ${label.padEnd(width)} min ${String(s.min).padStart(7)} | p10 ${String(s.p10).padStart(7)} | méd ${String(s.median).padStart(7)} | p90 ${String(s.p90).padStart(7)} | max ${String(s.max).padStart(8)} | moy ${String(s.mean).padStart(7)}`;
}

export function formatReport(r) {
  const out = [];
  const push = (s = '') => out.push(s);

  push('');
  push('═══════════════════════════════════════════════════════════════════════');
  push(`  RAPPORT D'AUDIT — ${r.meta.careersCompleted}/${r.meta.careersRequested} carrières × ${r.meta.years} ans`);
  push(`  seed ${r.meta.seed} · difficulté ${r.meta.difficulty} · ${r.meta.durationSeconds}s`);
  push('═══════════════════════════════════════════════════════════════════════');

  // --- Anomalies en premier : c'est ce qu'on cherche ---
  push('');
  push('┌─ ANOMALIES DÉTECTÉES ─────────────────────────────────────────────────');
  if (r.anomalies.length === 0) {
    push('│  Aucune anomalie détectée.');
  } else {
    for (const a of r.anomalies) {
      const tag = a.severity === 'critique' ? '[CRITIQUE]' : a.severity === 'majeure' ? '[MAJEURE] ' : '[mineure] ';
      push(`│  ${tag} ${a.message}`);
      if (a.data && Array.isArray(a.data) && a.data.length <= 12) {
        push(`│             → ${a.data.join(', ')}`);
      }
    }
  }
  push('└───────────────────────────────────────────────────────────────────────');

  // --- Intégrité ---
  push('');
  push('INTÉGRITÉ');
  push(`  plantages : ${r.integrity.crashes} | carrières incohérentes : ${r.integrity.careerIssues} | mondes incohérents : ${r.integrity.worldIssues}`);
  push(`  récits finaux faux : ${r.integrity.legacyProblems} | carrières atteignant la limite de temps : ${r.integrity.timeLimitReached}`);
  if (r.integrity.crashSamples.length) {
    for (const c of r.integrity.crashSamples) push(`    plantage seed ${c.seed} : ${c.message} @ ${c.stack ?? '?'}`);
  }
  for (const [code, n] of r.integrity.worldIssueCodes) push(`    monde : ${code} × ${n}`);
  for (const [code, n] of r.integrity.legacyProblemCodes) push(`    legacy : ${code} × ${n}`);

  // --- Distribution ---
  push('');
  push('DISTRIBUTION DES TRAJECTOIRES');
  const d = r.distribution;
  const order = [
    ['a eu au moins une équipe', d.aUneEquipe],
    ['a atteint semi-pro ou plus', d.devenusSemipro],
    ['a atteint le statut pro', d.devenusPro],
    ['a gagné au moins un titre', d.auMoinsUnTitre],
    ['champion régional', d.championRegional],
    ['champion international', d.championInternational],
    ['champion du monde', d.championDuMonde],
    ['a changé de jeu', d.changementDeJeu],
    ['audience > 200 k', d.grosseAudience],
    ['carrière courte (< 5 ans)', d.carriereCourte],
    ['carrière longue (≥ 13 ans)', d.carriereLongue],
    ['licencié au moins une fois', d.licencieAuMoinsUneFois],
    ['une seule organisation', d.unSeulClub],
    ['nomade (4 orgs ou plus)', d.nomades],
    ['histoire racontable', d.histoireRacontable],
  ];
  for (const [label, v] of order) push(`  ${label.padEnd(34)} ${pct(v)}`);

  // --- Joueur ---
  push('');
  push('MESURES JOUEUR');
  const p = r.player;
  push(line('âge de début', p.startAge));
  push(line('âge de fin', p.endAge));
  push(line('durée (ans)', p.duration));
  push(line('pic de niveau', p.peak));
  push(line('âge du pic', p.peakAge));
  push(line('niveau final', p.finalRating));
  push(line('organisations', p.orgs));
  push(line('changements de jeu', p.gameChanges));
  push(line('titres', p.titles));
  push(line('finales', p.finals));
  push(line('matchs', p.matches));
  push(line('taux de victoire', p.winRate));
  push(line('gains (€)', p.earnings));
  push(line('abonnés', p.followers));
  push(line('réputation pros', p.reputationPros));
  push(line('score legacy', p.legacy));
  push(line('décisions prises', p.decisions));

  // --- Diversité ---
  push('');
  push('DIVERSITÉ');
  push(`  signatures de carrière distinctes : ${r.diversity.uniqueSignatures} (${pct(r.diversity.uniqueShare)} des carrières)`);
  push('  trajectoires les plus fréquentes :');
  for (const [sig, n] of r.diversity.mostCommonSignatures) {
    push(`    ${String(n).padStart(4)} × ${sig}`);
  }
  push('  archétypes de fin de carrière :');
  for (const a of r.diversity.archetypes) push(`    ${String(a.count).padStart(4)} (${pct(a.share)})  ${a.id}`);
  push('  raisons de fin de carrière :');
  for (const [reason, n] of r.diversity.retirementReasons) push(`    ${String(n).padStart(4)} × ${reason}`);

  // --- Talents ---
  push('');
  push('POTENTIEL ET TALENT');
  push(line('écart plafond − pic', r.talents.ecartAuPlafond));
  push(`  talents gâchés (plafond > 85, pic < plafond−14) : ${pct(r.talents.talentsGaches)}`);
  push(`  surperformances (petit plafond dépassé)          : ${pct(r.talents.surperformances)}`);
  push(`  plafond atteint (à 3 points près)                : ${pct(r.talents.plafondAtteint)}`);
  push(`  corrélation plafond → pic  : ${r.talents.correlationPlafondPic}   (1 = potentiel garanti)`);
  push(`  corrélation croissance → pic : ${r.talents.correlationCroissancePic}`);

  // --- Traits ---
  push('');
  push('EFFET DES TRAITS (écart par rapport aux carrières sans ce trait)');
  push('  trait                n     legacy    pic    durée   orgs   audience   σ(legacy)');
  const traits = Object.entries(r.traits).sort((a, b) => Math.abs(b[1].legacy) - Math.abs(a[1].legacy));
  for (const [id, e] of traits) {
    push(
      `  ${id.padEnd(18)} ${String(e.n).padStart(4)}  ${fmtSigned(e.legacy, 7)}  ${fmtSigned(e.peak, 6)}  ${fmtSigned(e.duree, 6)}  ${fmtSigned(e.orgs, 5)}  ${fmtSigned(e.audience, 9)}  ${String(e.ecartTypeLegacy).padStart(7)}`,
    );
  }

  // --- Politiques ---
  push('');
  push('POLITIQUES DE JEU (le style de décision change-t-il la carrière ?)');
  push('  politique         n    legacy moy   pic moy   titres   durée   audience   % pro');
  const pols = Object.entries(r.policies).sort((a, b) => b[1].legacy.mean - a[1].legacy.mean);
  for (const [id, e] of pols) {
    push(
      `  ${id.padEnd(15)} ${String(e.n).padStart(4)}  ${String(e.legacy.mean).padStart(10)}  ${String(e.peak.mean).padStart(8)}  ${String(e.titres).padStart(7)}  ${String(e.duree).padStart(6)}  ${String(e.audience).padStart(9)}  ${pct(e.proportionPro)}`,
    );
  }

  // --- Choix ---
  push('');
  push('CHOIX LES PLUS DÉSÉQUILIBRÉS (écart de legacy entre meilleur et pire choix)');
  for (const c of r.choices.dominantChoices.slice(0, 12)) {
    push(`  ${String(c.spread).padStart(6)}  ${c.eventId.padEnd(24)} meilleur « ${c.best} » vs pire « ${c.worst} » (n=${c.n})`);
  }

  // --- Événements ---
  push('');
  push('ÉVÉNEMENTS');
  push(`  déclenchés au moins une fois : ${r.events.distinctFired}/${r.events.defined}`);
  if (r.events.neverFired.length) push(`  jamais déclenchés : ${r.events.neverFired.join(', ')}`);
  push('  occurrences par carrière · part des carrières touchées :');
  for (const e of r.events.frequency.slice(0, 20)) {
    push(`    ${String(e.perCareer).padStart(6)} ×   ${pct(e.shareOfCareers)}   ${e.id}`);
  }

  // --- Succès ---
  push('');
  push('SUCCÈS');
  push(`  débloqués au moins une fois : ${r.achievements.unlockedKinds}/${r.achievements.defined}`);
  if (r.achievements.neverUnlocked.length) {
    push(`  jamais débloqués : ${r.achievements.neverUnlocked.join(', ')}`);
  }

  // --- Histoire ---
  push('');
  push('QUALITÉ NARRATIVE');
  push(`  histoires racontables : ${pct(r.story.tellable)} | avec rival : ${pct(r.story.withRival)}`);
  push(`  avec meilleur moment : ${pct(r.story.withBestMoment)} | avec pire moment : ${pct(r.story.withWorstMoment)}`);
  push(`  avec changement de jeu : ${pct(r.story.withGameChange)} | avec changement d’équipe : ${pct(r.story.withTeamChange)}`);
  push(line('moments marquants', r.story.memories));

  // --- Interaction ---
  push('');
  push('MARCHÉ VU DU JOUEUR');
  push(line('offres reçues', r.interaction.offersSeen));
  push(line('offres acceptées', r.interaction.offersAccepted));
  push(line('démarchages tentés', r.interaction.seekAttempts));
  push(`  taux de réussite du démarchage : ${pct(r.interaction.seekSuccessRate)}`);
  push(line('équipes fondées', r.interaction.teamsFounded));

  // --- Monde ---
  if (r.world) {
    push('');
    push(`ÉTAT DU MONDE EN FIN DE CARRIÈRE (${r.world.samples} échantillons)`);
    push(line('personnes', r.world.persons));
    push(line('joueurs actifs', r.world.active));
    push(line('professionnels', r.world.pros));
    push(line('équipes actives', r.world.teamsActive));
    push(line('équipes incomplètes', r.world.teamsIncomplete));
    push(line('organisations mortes', r.world.orgsDead));
    push(line('jeux encore vivants', r.world.gamesAlive));
    push(line('niveau médian', r.world.ratingMedian));
    push(line('meilleur niveau', r.world.ratingMax));
    push(line('âge moyen du top 20', r.world.topPlayerAgeMean));
    push(line('concentration top3 (0-1)', r.world.top3Concentration));
    push(line('concentration des titres', r.world.titleConcentration));
    push(line('orgs ayant un titre', r.world.orgsWithTitles));
    push(line('promotions d’orgs', r.world.orgPromotions));
    push(line('relégations d’orgs', r.world.orgRelegations));
    push(line('chgts de roster / équipe', r.world.rosterChangesPerTeam));
    push(line('chgts de coach / équipe', r.world.coachChangesPerTeam));
  }

  // --- Monde sans joueur ---
  if (r.worldOnly) {
    push('');
    push(`MONDE SANS JOUEUR (${r.worldOnly.years} ans)`);
    if (r.worldOnly.crash) push(`  PLANTAGE : ${r.worldOnly.crash.message}`);
    push('    an  joueurs   pro équipes incompl.  orgs  jeux niv.méd niv.max âge top20');
    for (const s of r.worldOnly.samples) {
      push(
        `  ${String(s.year).padStart(4)} ${String(s.active).padStart(8)} ${String(s.pros).padStart(5)} ${String(s.teamsActive).padStart(7)} ${String(s.teamsIncomplete).padStart(9)} ${String(s.orgsAlive).padStart(5)} ${String(s.gamesAlive).padStart(5)} ${String(s.ratingMedian).padStart(7)} ${String(s.ratingMax).padStart(7)} ${String(s.topPlayerAgeMean).padStart(9)}`,
      );
    }
    push(`  nouveaux venus : ${r.worldOnly.newcomers} | survivants d’origine : ${r.worldOnly.survivors}`);
    push(`  promotions ${r.worldOnly.orgs.promoted} | relégations ${r.worldOnly.orgs.relegated} | orgs mortes ${r.worldOnly.orgs.died}`);
    const empty = r.worldOnly.championsByYear.filter((c) => c.majorChampions === 0).length;
    push(`  années sans champion majeur : ${empty}/${r.worldOnly.championsByYear.length}`);
    push(`  incohérences finales : ${r.worldOnly.finalIssues.length}`);
  }

  // --- PNJ ---
  if (r.npc) {
    push('');
    push('TRAJECTOIRES DE PNJ SUIVIES SUR 20 ANS');
    push(`  suivis : ${r.npc.tracked} | oubliés (élagage) : ${pct(r.npc.oublies)} | retraités : ${pct(r.npc.retraites)}`);
    push(`  trajectoires distinctes : ${r.npc.uniqueTrajectories}/${r.npc.tracked}`);
    push(line('équipes traversées', r.npc.teams));
    push(line('pic de niveau', r.npc.peak));
    push(line('titres', r.npc.titles));
    push(line('âge de retraite', r.npc.retiredAge));
    push(`  talents gâchés : ${pct(r.npc.talentsGaches)} | surperformances : ${pct(r.npc.surperformances)}`);
    push(`  changements de jeu : ${pct(r.npc.changementsDeJeu)}`);
  }

  push('');
  return out.join('\n');
}

function fmtSigned(v, width) {
  const s = v > 0 ? `+${v}` : String(v);
  return s.padStart(width);
}
