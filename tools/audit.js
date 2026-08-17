#!/usr/bin/env node
/**
 * Outil d'audit de simulation (§2, §36, §37).
 *
 * Simule des centaines ou des milliers de carrières sans interface, agrège
 * les résultats et produit un rapport d'anomalies.
 *
 *   node tools/audit.js --careers=1000 --years=20 --seed=4242
 *   node tools/audit.js --careers=200 --json=rapport.json
 *   node tools/audit.js --mode=world --years=30
 *   node tools/audit.js --mode=trace --seed=7 --years=12
 *   node tools/audit.js --mode=economy --years=30
 *   node tools/audit.js --mode=load --careers=12
 *
 * Les carrières sont réparties sur plusieurs processus : une carrière de
 * 20 ans coûte plusieurs secondes, et l'audit doit rester réalisable.
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runOneCareer, runWorldOnly, runNpcTrajectories } from '../src/engine/audit/runner.js';
import { runAmateurAudit } from '../src/engine/audit/amateurAudit.js';
import { runHierarchyAudit } from '../src/engine/audit/hierarchyAudit.js';
import { runRosterAudit } from '../src/engine/audit/rosterAudit.js';
import { runEconomyAudit } from '../src/engine/audit/economyAudit.js';
import { runLoadAudit, HORIZONS } from '../src/engine/audit/loadAudit.js';
import { GAMES_BY_ID } from '../src/data/games.js';
import { POLICY_IDS } from '../src/engine/audit/policies.js';
import { buildReport } from '../src/engine/audit/report.js';
import { formatReport } from '../src/engine/audit/format.js';
import { startTrace, takeTrace, stopTrace, explainRecruit, explainEvent, TRACE } from '../src/engine/trace.js';

const SELF = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const out = {
    careers: 1000,
    years: 20,
    seed: 4242,
    workers: Math.max(1, Math.min(availableParallelism(), 8)),
    mode: 'careers',
    json: null,
    difficulty: 'standard',
    quiet: false,
  };
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z]+)(?:=(.*))?$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key in out) {
      // Un seed peut être un mot : `normalizeSeed` accepte les deux, et forcer
      // Number() transformait « eco-1 » en NaN.
      if (key === 'seed') out[key] = value !== undefined && /^-?\d+$/.test(value) ? Number(value) : value;
      else if (typeof out[key] === 'number') out[key] = Number(value);
      else if (typeof out[key] === 'boolean') out[key] = value === undefined ? true : value !== 'false';
      else out[key] = value;
    }
  }
  return out;
}

/** Répartit les carrières : chaque tâche est indépendante et reproductible. */
function buildTasks(opts) {
  const tasks = [];
  for (let i = 0; i < opts.careers; i++) {
    tasks.push({
      seed: `${opts.seed}:${i}`,
      years: opts.years,
      policyId: POLICY_IDS[i % POLICY_IDS.length],
      difficulty: opts.difficulty,
      // Les mesures « monde » sont coûteuses : on les collecte sur un
      // échantillon suffisant pour être significatif, pas sur tout.
      collectWorld: i % 5 === 0,
    });
  }
  return tasks;
}

async function runInWorkers(tasks, workerCount, onProgress) {
  const results = [];
  let next = 0;
  let done = 0;

  await Promise.all(
    Array.from({ length: Math.min(workerCount, tasks.length) }, () =>
      new Promise((resolve, reject) => {
        const worker = new Worker(SELF, { workerData: { role: 'career' } });
        const feed = () => {
          if (next >= tasks.length) {
            worker.postMessage({ type: 'stop' });
            return;
          }
          worker.postMessage({ type: 'task', task: tasks[next++] });
        };
        worker.on('message', (msg) => {
          if (msg.type === 'result') {
            results.push(msg.result);
            done++;
            onProgress?.(done, tasks.length);
            feed();
          } else if (msg.type === 'stopped') {
            worker.terminate();
            resolve();
          }
        });
        worker.on('error', reject);
        worker.on('exit', () => resolve());
        feed();
      }),
    ),
  );

  return results;
}

if (!isMainThread && workerData?.role === 'career') {
  parentPort.on('message', (msg) => {
    if (msg.type === 'stop') {
      parentPort.postMessage({ type: 'stopped' });
      return;
    }
    let result;
    try {
      result = runOneCareer(msg.task);
    } catch (err) {
      result = {
        seed: msg.task.seed,
        policy: msg.task.policyId,
        crash: { message: err?.message ?? String(err), stack: (err?.stack ?? '').split('\n')[1] },
        careerIssues: [],
        worldIssues: [],
        legacyProblems: [],
        traits: [],
        achievements: [],
        eventsFired: [],
        decisionLog: [],
        titlesByTier: {},
        reached: {},
        story: {},
        interaction: {},
      };
    }
    parentPort.postMessage({ type: 'result', result });
  });
} else if (isMainThread) {
  main().catch((err) => {
    console.error('Audit interrompu :', err);
    process.exit(1);
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  const t0 = Date.now();

  if (opts.mode === 'trace') return runTraceMode(opts);
  if (opts.mode === 'world') return runWorldMode(opts);
  if (opts.mode === 'amateur') return runAmateurMode(opts);
  if (opts.mode === 'hierarchy') return runHierarchyMode(opts);
  if (opts.mode === 'roster') return runRosterMode(opts);
  if (opts.mode === 'economy') return runEconomyMode(opts);
  if (opts.mode === 'load') return runLoadMode(opts);

  console.error(
    `Audit : ${opts.careers} carrières × ${opts.years} ans, seed ${opts.seed}, ${opts.workers} processus…`,
  );

  const tasks = buildTasks(opts);
  let lastPct = -1;
  const careers = await runInWorkers(tasks, opts.workers, (done, total) => {
    const pct = Math.floor((done / total) * 100);
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      const elapsed = (Date.now() - t0) / 1000;
      const eta = done > 0 ? (elapsed / done) * (total - done) : 0;
      process.stderr.write(`\r  ${pct}% (${done}/${total}) — ${Math.round(elapsed)}s écoulées, ~${Math.round(eta)}s restantes   `);
    }
  });
  process.stderr.write('\n');

  // Tests complémentaires : un monde sans joueur et un suivi de PNJ.
  console.error('Monde sans joueur (30 ans)…');
  const worldOnly = runWorldOnly({ seed: `${opts.seed}:world`, years: 30 });
  console.error('Trajectoires de PNJ (20 ans)…');
  const npc = runNpcTrajectories({ seed: `${opts.seed}:npc`, years: 20, sample: 120 });

  const report = buildReport({
    careers,
    worldOnly,
    npc,
    meta: {
      seed: opts.seed,
      years: opts.years,
      difficulty: opts.difficulty,
      durationSeconds: Math.round((Date.now() - t0) / 10) / 100,
    },
  });

  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify(report, null, 2));
    console.error(`Rapport JSON écrit dans ${opts.json}`);
  }
  console.log(formatReport(report));
}

function runWorldMode(opts) {
  console.error(`Monde sans joueur : ${opts.years} ans, seed ${opts.seed}…`);
  const result = runWorldOnly({ seed: opts.seed, years: opts.years, sampleEveryYears: 5 });
  const lines = [];
  lines.push('=== MONDE SANS JOUEUR ===');
  if (result.crash) lines.push(`PLANTAGE : ${result.crash.message} (${result.crash.stack})`);
  lines.push(
    ['an', 'joueurs', 'pro', 'équipes', 'incompl.', 'orgs', 'jeux', 'niv.méd', 'niv.max', 'âge top20']
      .map((h) => h.padStart(9))
      .join(''),
  );
  for (const s of result.samples) {
    lines.push(
      [s.year, s.active, s.pros, s.teamsActive, s.teamsIncomplete, s.orgsAlive, s.gamesAlive, s.ratingMedian, s.ratingMax, s.topPlayerAgeMean]
        .map((v) => String(v).padStart(9))
        .join(''),
    );
  }
  lines.push('');
  lines.push(`Nouveaux venus : ${result.newcomers} | survivants d'origine : ${result.survivors}`);
  lines.push(`Promotions : ${result.orgs.promoted} | relégations : ${result.orgs.relegated} | orgs mortes : ${result.orgs.died}`);
  lines.push(`Changements de roster par équipe : ${result.teams.rosterChangesPerTeam}`);
  const empty = result.championsByYear.filter((c) => c.majorChampions === 0).length;
  lines.push(`Années sans champion majeur : ${empty}/${result.championsByYear.length}`);
  lines.push(`Incohérences finales : ${result.finalIssues.length}`);
  console.log(lines.join('\n'));
}

/** Mode profondeur d'effectif (étape 5) : bancs, promotions, trajectoires. */
function runRosterMode(opts) {
  console.error(`Profondeur d'effectif : ${opts.years} ans, seed ${opts.seed}…`);
  const r = runRosterAudit({ seed: opts.seed, years: opts.years, sampleEveryYears: 10 });
  const lines = [];
  lines.push(`=== PROFONDEUR D'EFFECTIF — seed ${opts.seed}, ${opts.years} ans ===`);
  if (r.crash) lines.push(`PLANTAGE : ${r.crash.message} (${r.crash.stack})`);

  for (const s of r.snapshots) {
    lines.push('');
    lines.push(
      `--- année ${s.year} — ${s.withBench}/${s.teams} équipes avec un banc (${Math.round(s.shareWithBench * 100)} %), ` +
        `${s.subs} remplaçants pour ${s.wanted} places voulues ---`,
    );
    lines.push(['tier', 'équipes', 'avec banc', 'part', 'remplaçants', 'moyenne', 'médiane', 'p90'].map((h) => h.padStart(12)).join(''));
    for (const [tier, t] of Object.entries(s.perTier)) {
      lines.push(
        [tier, t.teams, t.withBench, t.shareWithBench, t.subs, t.mean, t.median, t.p90]
          .map((v) => String(v).padStart(12))
          .join(''),
      );
    }
  }

  const b = r.bench;
  lines.push('');
  lines.push('--- Flux ---');
  lines.push(`Entrées sur le banc      : ${r.flows.benchEntries} (dont ${r.flows.demotions} relégations internes, ${r.flows.externalSignings} arrivées externes)`);
  lines.push(`Promotions internes      : ${r.flows.internalPromotions}`);
  lines.push(`Départs depuis le banc   : ${r.flows.benchDepartures}`);
  lines.push('');
  lines.push('--- Parcours ---');
  lines.push(`Joueurs observés ${b.tracked} | passés par un banc ${b.everSub} (${Math.round(b.shareEverSub * 100)} %)`);
  lines.push(`Titulaires devenus remplaçants : ${b.starterThenSub} | remplaçants devenus titulaires : ${b.subThenStarter} (${Math.round(b.shareSubsPromoted * 100)} % des remplaçants)`);
  lines.push(`Semaines sur le banc par joueur concerné : ${b.benchWeeksMean} en moyenne`);
  lines.push(`Durée d'un passage : médiane ${b.spellWeeksMedian} sem. | p90 ${b.spellWeeksP90} | max ${b.spellWeeksMax}`);
  lines.push(`Avant promotion : ${b.weeksBeforePromotionMean ?? '—'} sem. | avant départ : ${b.weeksBeforeDepartureMean ?? '—'} sem.`);

  lines.push('');
  lines.push('--- Trajectoires du §P réellement survenues ---');
  for (const [kind, t] of Object.entries(r.trajectories)) {
    lines.push(`${kind.padEnd(32)} ${t.nick} : ${JSON.stringify(t)}`);
  }
  lines.push('');
  lines.push(`Invariants d'effectif violés : ${r.invariants.length}`);
  for (const i of r.invariants.slice(0, 6)) lines.push(`  ${i.code} — ${i.detail}`);
  lines.push(`Incohérences du validateur : ${r.issues.length}`);
  console.log(lines.join('\n'));
}

/** Mode charge (étape 7B) : états, ruptures, longévité, progression par horizon. */
function runLoadMode(opts) {
  const perPolicy = Math.max(3, Math.round(opts.careers / 9));
  console.error(`Charge : ${perPolicy} carrières par politique × ${opts.years} ans…`);
  const r = runLoadAudit({ perPolicy, years: opts.years, seedRoot: `load-${opts.seed}` });
  const lines = [];
  lines.push(`=== CHARGE, ÉTATS ET LONGÉVITÉ — ${r.careers} carrières, seed ${opts.seed} ===`);
  if (r.crashes) lines.push(`PLANTAGES : ${r.crashes}`);

  lines.push('');
  lines.push('--- Progression par horizon (le grind paie-t-il tôt et coûte-t-il tard ?) ---');
  lines.push('politique'.padEnd(14) + HORIZONS.map((y) => `an ${y}`.padStart(7)).join('') + '   pic'.padStart(8) + ' années'.padStart(8));
  for (const [id, p] of Object.entries(r.byPolicy)) {
    lines.push(
      id.padEnd(14) +
        HORIZONS.map((y) => String(p.ratingAt[y] ?? '—').padStart(7)).join('') +
        String(p.peak.mean).padStart(8) +
        String(p.years.mean).padStart(8),
    );
  }

  lines.push('');
  lines.push('--- Condition moyenne et charge ---');
  lines.push('politique'.padEnd(14) + 'fatigue'.padStart(9) + 'stress'.padStart(8) + 'moral'.padStart(8) + 'charge'.padStart(8) + 'série'.padStart(8) + ' états hauts'.padStart(13));
  for (const [id, p] of Object.entries(r.byPolicy)) {
    lines.push(
      id.padEnd(14) +
        String(p.condition.fatigue).padStart(9) +
        String(p.condition.stress).padStart(8) +
        String(p.condition.morale).padStart(8) +
        String(p.condition.load).padStart(8) +
        String(p.longestStreak).padStart(8) +
        `${Math.round(p.shareHigh * 100)} %`.padStart(13),
    );
  }

  lines.push('');
  lines.push('--- Ruptures, récupérations, longévité ---');
  for (const [id, p] of Object.entries(r.byPolicy)) {
    lines.push(
      `  ${id.padEnd(13)} ruptures ${String(p.episodes).padStart(5)} (${Math.round(p.shareWithEpisode * 100)} % des carrières) | ` +
        `récupérations ${String(p.recoveries).padStart(5)} | retraites de charge ${p.loadRetirements} | ` +
        `talents gâchés ${Math.round(p.wasted * 100)} % | potentiel→pic ${p.potentialToPeak}`,
    );
    lines.push(`     états : ${Object.entries(p.states).map(([s, v]) => `${s} ${v} %`).join(' · ')}`);
    lines.push(`     fins  : ${Object.entries(p.retirementPaths).map(([k, n]) => `${k} ×${n}`).join(' · ')}`);
  }

  lines.push('');
  lines.push('--- Ensemble ---');
  const g = r.global;
  lines.push(`  durée médiane ${g.years.median} ans (moyenne ${g.years.mean}) | pic médian ${g.peak.median} (moyenne ${g.peak.mean})`);
  lines.push(`  talents gâchés ${Math.round(g.wasted * 100)} % | corrélation potentiel→pic ${g.potentialToPeak}`);
  lines.push(`  signatures uniques ${g.uniqueSignatures}/${r.careers} (${Math.round(g.signatureShare * 100)} %)`);
  lines.push(`  carrières avec au moins une rupture ${Math.round(g.shareWithEpisode * 100)} % | retraites de charge ${g.loadRetirements}`);
  lines.push(`  archétypes : ${Object.entries(g.archetypes).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(lines.join('\n'));
}

/** Mode économie (étape 6) : richesse, inflation, réputation, audience, concentration. */
function runEconomyMode(opts) {
  console.error(`Économie : ${opts.years} ans, seed ${opts.seed}…`);
  const r = runEconomyAudit({ seed: opts.seed, years: opts.years, sampleEveryYears: 5 });
  const M = (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + ' M' : Math.round(v / 1000) + ' k');
  const lines = [];
  lines.push(`=== ÉCONOMIE, RÉPUTATION ET AUDIENCE — seed ${opts.seed}, ${opts.years} ans ===`);
  if (r.crash) lines.push(`PLANTAGE : ${r.crash.message} (${r.crash.stack})`);

  lines.push('');
  lines.push('--- Compte de résultat agrégé (§Y : des flux, pas des accumulateurs) ---');
  lines.push(['année', 'orgs', 'revenus', 'salaires', 'charges', 'résultat', 'budget tot.'].map((h) => h.padStart(13)).join(''));
  for (const s of r.samples) {
    lines.push(
      [s.year, s.orgs, M(s.flow?.income ?? 0), M(s.flow?.payroll ?? 0), M(s.flow?.ops ?? 0), M(s.flow?.result ?? 0), M(s.wealth.total)]
        .map((v) => String(v).padStart(13))
        .join(''),
    );
  }

  lines.push('');
  lines.push('--- Richesse et inflation ---');
  lines.push(['année', 'médiane', 'p90', 'max', 'négatifs'].map((h) => h.padStart(13)).join(''));
  for (const s of r.samples) {
    lines.push(
      [s.year, M(s.wealth.median), M(s.wealth.p90), M(s.wealth.max), s.wealth.negatives]
        .map((v) => String(v).padStart(13))
        .join(''),
    );
  }

  const last = r.samples.at(-1);
  lines.push('');
  lines.push('--- Richesse par niveau (fin de simulation) ---');
  for (const [tier, t] of Object.entries(last.wealth.perTier)) {
    lines.push(`  tier ${tier} | n=${String(t.n).padStart(3)} | médiane ${M(t.median).padStart(8)} | p90 ${M(t.p90).padStart(8)} | négatifs ${t.negatives}`);
  }
  lines.push('');
  lines.push('--- Revenus par scène (chaque scène a son économie) ---');
  for (const [gameId, s] of Object.entries(last.wealth.perScene)) {
    lines.push(`  ${gameId.padEnd(16)} | n=${String(s.n).padStart(3)} | médiane ${M(s.median).padStart(8)} | santé ×${s.health}`);
  }

  lines.push('');
  lines.push('--- Réputation ---');
  lines.push(['année', 'médiane', 'p90', 'max', 'saturés', 'n'].map((h) => h.padStart(11)).join(''));
  for (const s of r.samples) {
    lines.push(
      [s.year, s.reputation.median, s.reputation.p90, s.reputation.max, s.reputation.saturated, s.reputation.n]
        .map((v) => String(v).padStart(11))
        .join(''),
    );
  }
  lines.push('');
  lines.push('--- Oubli mesuré sur les joueurs sans équipe (§E) ---');
  for (const [key, g] of Object.entries(r.forgotten)) {
    lines.push(`  ${key.padEnd(10)} | n=${String(g.n).padStart(4)} | réputation médiane ${String(g.prosMedian).padStart(6)} | plancher médian ${String(g.floorMedian).padStart(6)} | audience médiane ${g.followersMedian}`);
  }

  lines.push('');
  lines.push('--- Audience ---');
  lines.push(['année', 'médiane', 'p90', 'max', 'à zéro', 'total'].map((h) => h.padStart(12)).join(''));
  for (const s of r.samples) {
    lines.push(
      [s.year, s.audience.median, s.audience.p90, s.audience.max, s.audience.zeros, M(s.audience.total)]
        .map((v) => String(v).padStart(12))
        .join(''),
    );
  }
  lines.push('');
  lines.push('--- Audience par niveau d’organisation ---');
  for (const [tier, t] of Object.entries(last.audience.perTier)) {
    lines.push(`  tier ${tier} | n=${String(t.n).padStart(4)} | médiane ${String(t.median).padStart(9)} | p90 ${t.p90}`);
  }
  lines.push('');
  lines.push('--- Rareté des vedettes (pic d’audience atteint) ---');
  const peaks = r.peaks;
  for (const seuil of [2e6, 1e6, 5e5, 3e5, 1e5]) {
    const c = peaks.filter((p) => p > seuil).length;
    lines.push(`  au-dessus de ${M(seuil).padStart(7)} : ${String(c).padStart(4)} personnes (${((100 * c) / Math.max(1, peaks.length)).toFixed(2)} % de ${peaks.length})`);
  }

  lines.push('');
  lines.push('--- Concentration (part des trois premiers) ---');
  lines.push(['année', 'revenus', 'richesse', 'audience'].map((h) => h.padStart(12)).join(''));
  for (const s of r.samples) {
    lines.push([s.year, s.concentration.revenue, s.concentration.wealth, s.concentration.audience].map((v) => String(v).padStart(12)).join(''));
  }

  lines.push('');
  lines.push(`Invariants économiques violés : ${r.invariants.length}`);
  for (const i of r.invariantDetails ?? []) lines.push(`  ${i.code} — ${i.detail}`);
  console.log(lines.join('\n'));
}

/** Mode hiérarchie (étape 3) : mobilité, stabilité, ascensions, déclins. */
function runHierarchyMode(opts) {
  console.error(`Hiérarchie : ${opts.years} ans, seed ${opts.seed}…`);
  const r = runHierarchyAudit({ seed: opts.seed, years: opts.years, sampleEveryYears: 10 });
  const lines = [];
  lines.push(`=== HIÉRARCHIE — seed ${opts.seed}, ${opts.years} ans ===`);
  if (r.crash) lines.push(`PLANTAGE : ${r.crash.message} (${r.crash.stack})`);

  lines.push('');
  lines.push('--- Répartition des paliers ---');
  lines.push(['année', 'équipes', 'tier 1', 'tier 2', 'tier 3', 'tier 4', 'tier 5'].map((h) => h.padStart(10)).join(''));
  for (const s of r.samples) {
    lines.push(
      [s.year, s.teams, s.tiers[1] ?? 0, s.tiers[2] ?? 0, s.tiers[3] ?? 0, s.tiers[4] ?? 0, s.tiers[5] ?? 0]
        .map((v) => String(v).padStart(10))
        .join(''),
    );
  }

  const m = r.mobility;
  lines.push('');
  lines.push('--- Mobilité ---');
  lines.push(`Montées par saison    : ${m.promotionsPerSeason}`);
  lines.push(`Descentes par saison  : ${m.relegationsPerSeason}`);
  lines.push(`Saisons sans mouvement: ${m.seasonsWithoutMovement}/${r.years}`);
  lines.push(
    `Changements par organisation (${m.orgsTracked} suivies) : médiane ${m.changesMedian} | p90 ${m.changesP90}` +
      ` | jamais bougé ${m.neverMoved} | ≥5 changements ${m.movedFiveOrMore}`,
  );

  const st = r.stability;
  lines.push('');
  lines.push('--- Stabilité ---');
  lines.push(
    `Durée passée à un palier : médiane ${st.tenureMedianYears} ans | p90 ${st.tenureP90Years} | max ${st.tenureMaxYears}`,
  );

  lines.push('');
  lines.push('--- Ascension ---');
  lines.push(
    `Organisations montées au-dessus de leur point de départ : ${r.ascension.climbers}` +
      ` | ayant atteint le sommet : ${r.ascension.reachedTop}` +
      ` (médiane ${r.ascension.climbYearsMedian} ans, max ${r.ascension.climbYearsMax})`,
  );

  lines.push('');
  lines.push('--- Déclin ---');
  lines.push(
    `Passées par le sommet : ${r.decline.everTop} | l'ayant quitté : ${r.decline.leftTop}` +
      ` | y étant revenues : ${r.decline.returnedToTop} | disparues après déclin : ${r.decline.diedAfterDecline}`,
  );

  lines.push('');
  lines.push('--- Trajectoires réellement survenues ---');
  for (const [kind, t] of Object.entries(r.trajectories)) {
    lines.push(`${kind.padEnd(10)} ${t.name} : ${t.path}`);
  }

  lines.push('');
  lines.push(`Invariants violés : ${r.invariants.length}`);
  for (const i of r.invariants.slice(0, 6)) lines.push(`  ${i.code} — ${i.detail}`);
  lines.push(`Incohérences du validateur : ${r.issues.length}`);
  console.log(lines.join('\n'));
}

/**
 * Mode écosystème d'entrée (étape 2) : distribution PAR SCÈNE et flux réels du
 * bas de la pyramide. Une moyenne ne dit rien ici — deux scènes à zéro et une
 * à neuf donnent la même moyenne qu'un monde sain.
 */
function runAmateurMode(opts) {
  console.error(`Écosystème amateur : ${opts.years} ans, seed ${opts.seed}…`);
  const r = runAmateurAudit({ seed: opts.seed, years: opts.years, sampleEveryYears: 10 });
  const lines = [];
  lines.push(`=== ÉCOSYSTÈME D'ENTRÉE — seed ${opts.seed}, ${opts.years} ans ===`);
  if (r.crash) lines.push(`PLANTAGE : ${r.crash.message} (${r.crash.stack})`);

  for (const snap of r.snapshots) {
    const alive = snap.scenes.filter((s) => s.alive);
    lines.push('');
    const amMean = alive.reduce((n, s) => n + (s.amateurMean ?? s.amateurTeams), 0);
    lines.push(
      `--- année ${snap.year} — ${alive.length} scènes vivantes, ` +
        `${Math.round(amMean * 10) / 10} équipes amateurs en moyenne sur l’année, ` +
        `${alive.reduce((n, s) => n + s.leagueTeams, 0)} en ligue ---`,
    );
    lines.push(
      ['scène', 'ligue', 'amat.moy', 'min', 'max', 'sans éq.', 'max', 'âge moy.', 'sem. moy.', 'pros', 'popul.']
        .map((h) => h.padStart(10))
        .join(''),
    );
    for (const s of alive) {
      lines.push(
        [
          GAMES_BY_ID[s.gameId].shortName,
          s.leagueTeams,
          s.amateurMean ?? s.amateurTeams,
          s.amateurMin ?? '—',
          s.amateurMax ?? '—',
          s.unattachedMean ?? s.unattached,
          s.unattachedMax ?? '—',
          s.unattachedAgeMean ?? '—',
          s.unattachedWeeksMean ?? '—',
          s.pros,
          s.population,
        ]
          .map((v) => String(v).padStart(10))
          .join(''),
      );
    }
  }

  lines.push('');
  lines.push('--- Distribution de l’écosystème d’entrée, par scène ---');
  lines.push(
    ['scène', 'éq.moy', 'min', 'max', 'j.amateurs', 'sans éq.', 'nouveaux', 'créations', 'dissol.', 'montées', '→ligue']
      .map((h) => h.padStart(11))
      .join(''),
  );
  const finalScenes = r.snapshots.at(-1).scenes;
  const amMeans = [];
  for (const s of finalScenes) {
    if (!s.alive) continue;
    const f = r.byScene[s.gameId];
    amMeans.push(s.amateurMean ?? 0);
    lines.push(
      [
        GAMES_BY_ID[s.gameId].shortName,
        s.amateurMean ?? s.amateurTeams,
        s.amateurMin ?? '—',
        s.amateurMax ?? '—',
        s.amateurPlayers,
        s.unattachedMean ?? s.unattached,
        f.newcomers,
        f.created,
        f.dissolved,
        f.promoted,
        f.toLeaguePlayers,
      ]
        .map((v) => String(v).padStart(11))
        .join(''),
    );
  }
  const sorted = [...amMeans].sort((a, b) => a - b);
  const median = sorted.length
    ? sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : 0;
  lines.push(
    `  moyenne ${Math.round((amMeans.reduce((a, b) => a + b, 0) / Math.max(1, amMeans.length)) * 10) / 10}` +
      ` | médiane ${median} | min ${Math.min(...amMeans)} | max ${Math.max(...amMeans)}`,
  );

  lines.push('');
  lines.push('--- Flux cumulés du circuit d’entrée ---');
  lines.push(`Équipes amateurs créées      : ${r.flows.amateurTeamsCreated}`);
  lines.push(`Équipes amateurs dissoutes   : ${r.flows.amateurTeamsDissolved}`);
  lines.push(`Équipes amateurs promues     : ${r.flows.amateurToLeague}`);
  lines.push(`Arrivées dans une équipe am. : ${r.flows.joinsAmateur}`);
  lines.push(`Départs d’une équipe amateur : ${r.flows.departuresAmateur}`);
  lines.push(`  dont vers une équipe de ligue : ${r.flows.amateurToPro}`);
  const ls = r.amateurLifespanYears;
  lines.push(
    ls.count
      ? `Durée de vie des équipes dissoutes (ans) : p10 ${ls.p10} | médiane ${ls.median} | p90 ${ls.p90} | max ${ls.max}`
      : 'Aucune équipe amateur dissoute.',
  );

  lines.push('');
  lines.push('--- Devenir des nouveaux venus, par année d’arrivée (§9) ---');
  lines.push(
    ['cohorte', 'suivi(ans)', 'taille', 'trouvent', '%', 'médiane', 'p90', 'immédiat%', '>1an%', 'jamais%']
      .map((h) => h.padStart(10))
      .join(''),
  );
  for (const [year, c] of Object.entries(r.cohorts)) {
    if (!c.size) continue;
    lines.push(
      [year, c.followUpYears, c.size, c.foundTeam, c.foundTeamPct, c.medianWeeks, c.p90Weeks, c.immediatePct, c.overOneYearPct, c.neverPct]
        .map((v) => String(v).padStart(10))
        .join('') + (c.followUpYears < 3 ? '   (suivi trop court)' : ''),
    );
  }

  lines.push('');
  lines.push('--- Accessibilité du bas de la pyramide (§12, à ne pas maximiser) ---');
  for (const [gameId, a] of Object.entries(r.accessibility)) {
    if (a.rate === null) continue;
    lines.push(
      `${GAMES_BY_ID[gameId].shortName.padEnd(10)} ${a.placed}/${a.young} jeunes en équipe (${Math.round(a.rate * 100)} %)`,
    );
  }

  lines.push('');
  lines.push('--- Suivi de la formation : vivier suffisant mais dispersé ? ---');
  lines.push(
    ['scène', 'effectif', 'sans éq.', 'régions', 'viables', 'part rég.max', 'p(form.)', 'délai moy.']
      .map((h) => h.padStart(13))
      .join(''),
  );
  for (const [gameId, w] of Object.entries(r.formationWatch)) {
    lines.push(
      [
        GAMES_BY_ID[gameId].shortName,
        w.teamSize,
        w.unattached,
        `${w.regions} [${w.regionPools.join('/')}]`,
        w.viableRegions,
        w.topRegionShare ?? '—',
        w.formationProbabilitySum,
        w.integrationWeeksMean === null ? '—' : `${w.integrationWeeksMean} sem.`,
      ]
        .map((v) => String(v).padStart(13))
        .join(''),
    );
  }

  lines.push('');
  const p = r.population;
  lines.push(
    `Population finale : ${p.total} (${p.rostered} en équipe, ${p.unattached} libres, ${p.staff} staff, ${p.retired} retraités)`,
  );
  lines.push(`Incohérences finales : ${r.issues.length}`);
  for (const i of r.issues.slice(0, 5)) lines.push(`  ${i.code ?? i.type}: ${i.message ?? JSON.stringify(i)}`);
  console.log(lines.join('\n'));
}

/** Mode debug (§36) : joue une carrière en enregistrant toutes les causes. */
function runTraceMode(opts) {
  startTrace({ max: 60000 });
  const result = runOneCareer({
    seed: opts.seed,
    years: opts.years,
    policyId: 'random',
    difficulty: opts.difficulty,
    collectWorld: true,
  });
  const entries = takeTrace();
  stopTrace();

  const lines = [];
  lines.push(`=== TRACE DE SIMULATION — seed ${opts.seed} ===`);
  lines.push(`Carrière : ${result.durationYears} ans, pic ${result.peak}, ${result.titles} titres, legacy ${result.legacy}`);
  lines.push(`Traces enregistrées : ${entries.length}`);
  lines.push('');

  const recruits = entries.filter((e) => e.kind === TRACE.RECRUIT).slice(0, 8);
  lines.push(`--- Recrutements (${entries.filter((e) => e.kind === TRACE.RECRUIT).length} au total, 8 premiers) ---`);
  for (const r of recruits) lines.push(explainRecruit(r));
  lines.push('');

  const refusals = entries.filter((e) => e.kind === TRACE.RECRUIT_REFUSED).slice(0, 5);
  lines.push(`--- Refus de joueurs (${entries.filter((e) => e.kind === TRACE.RECRUIT_REFUSED).length} au total) ---`);
  for (const r of refusals) lines.push(explainRecruit(r));
  lines.push('');

  const fired = entries.filter((e) => e.kind === TRACE.EVENT_FIRED);
  lines.push(`--- Événements déclenchés (${fired.length}) ---`);
  for (const e of fired.slice(0, 15)) {
    lines.push(explainEvent(e));
    const others = (e.candidates ?? [])
      .filter((c) => c.id !== e.eventId)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3);
    if (others.length) {
      lines.push(`    concurrents : ${others.map((c) => `${c.id} (${c.weight.toFixed(2)})`).join(', ')}`);
    }
  }
  lines.push('');

  // Pourquoi certains événements ne se déclenchent jamais.
  const skipReasons = {};
  for (const e of entries) {
    if (e.kind !== TRACE.EVENT_SKIPPED) continue;
    const key = `${e.eventId} — ${e.reason}`;
    skipReasons[key] = (skipReasons[key] ?? 0) + 1;
  }
  lines.push('--- Raisons d’écartement les plus fréquentes ---');
  for (const [k, v] of Object.entries(skipReasons).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    lines.push(`  ${String(v).padStart(6)} × ${k}`);
  }
  const errors = entries.filter((e) => e.kind === TRACE.EVENT_SKIPPED && e.error);
  if (errors.length > 0) {
    lines.push('');
    lines.push(`!!! ${errors.length} conditions d’événement ont levé une exception :`);
    for (const e of errors.slice(0, 5)) lines.push(`    ${e.eventId} : ${e.reason}`);
  }

  const deferred = entries.filter((e) => e.kind === TRACE.DEFERRED);
  lines.push('');
  lines.push(
    `--- Conséquences différées : ${deferred.filter((d) => d.scheduled).length} programmées, ` +
      `${deferred.filter((d) => !d.scheduled).length} arrivées à échéance, ` +
      `${deferred.filter((d) => d.visible).length} visibles pour le joueur ---`,
  );

  console.log(lines.join('\n'));
}
