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
