#!/usr/bin/env node
/**
 * Enregistrement et comparaison du baseline.
 *
 *   node tools/baseline.js record --out=baselines/baseline-v1.json
 *   node tools/baseline.js run    --out=/tmp/apres.json
 *   node tools/baseline.js compare --before=baselines/baseline-v1.json --after=/tmp/apres.json
 *
 * `record` refuse d'écraser un fichier existant : un baseline est une
 * référence, pas un brouillon. Utiliser --force en connaissance de cause.
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runOneCareer, runWorldOnly, runNpcTrajectories } from '../src/engine/audit/runner.js';
import {
  BASELINE_SUITE,
  buildSuiteTasks,
  suiteFingerprint,
  baselineCareerRow,
  baselineWorldRow,
  baselineHeadlines,
  compareHeadlines,
} from '../src/engine/audit/baseline.js';
import { narrativeAudit } from '../src/engine/audit/storyAudit.js';

const SELF = fileURLToPath(import.meta.url);

if (!isMainThread && workerData?.role === 'baseline') {
  parentPort.on('message', (msg) => {
    if (msg.type === 'stop') {
      parentPort.postMessage({ type: 'stopped' });
      return;
    }
    let row;
    try {
      row = baselineCareerRow(runOneCareer(msg.task));
    } catch (err) {
      row = { seed: msg.task.seed, policy: msg.task.policyId, crash: err?.message ?? String(err) };
    }
    parentPort.postMessage({ type: 'result', index: msg.task.index, row });
  });
} else if (isMainThread) {
  main().catch((err) => {
    console.error('Échec :', err);
    process.exit(1);
  });
}

function parseArgs(argv) {
  const cmd = argv[2] ?? 'help';
  const opts = { workers: Math.max(1, Math.min(availableParallelism(), 8)), force: false };
  for (const arg of argv.slice(3)) {
    const m = arg.match(/^--([a-zA-Z]+)(?:=(.*))?$/);
    if (!m) continue;
    const [, key, value] = m;
    opts[key] = value === undefined ? true : key === 'workers' ? Number(value) : value;
  }
  return { cmd, opts };
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv);
  if (cmd === 'record' || cmd === 'run') return runSuite(cmd, opts);
  if (cmd === 'compare') return compare(opts);
  console.log(readFileSync(SELF, 'utf8').split('\n').slice(2, 12).join('\n').replace(/^ \*ic?/gm, ''));
}

async function runSuite(cmd, opts) {
  const out = opts.out ?? (cmd === 'record' ? 'baselines/baseline-v1.json' : '/tmp/suite-run.json');
  if (cmd === 'record' && existsSync(out) && !opts.force) {
    console.error(
      `Refus d'écraser un baseline existant : ${out}\n` +
        `Un baseline est immuable. Utiliser « run » pour une exécution de comparaison, ` +
        `ou --force si vous voulez vraiment le remplacer.`,
    );
    process.exit(2);
  }

  const suite = BASELINE_SUITE;
  const fingerprint = suiteFingerprint(suite);
  const tasks = buildSuiteTasks(suite);
  const t0 = Date.now();

  console.error(
    `Suite « ${suite.name} » v${suite.version} — ${tasks.length} carrières × ${suite.years} ans\n` +
      `empreinte des entrées : ${fingerprint} | ${opts.workers} processus`,
  );

  const rows = new Array(tasks.length);
  let next = 0;
  let done = 0;

  await Promise.all(
    Array.from({ length: Math.min(opts.workers, tasks.length) }, () =>
      new Promise((resolve, reject) => {
        const worker = new Worker(SELF, { workerData: { role: 'baseline' } });
        const feed = () => {
          if (next >= tasks.length) {
            worker.postMessage({ type: 'stop' });
            return;
          }
          worker.postMessage({ type: 'task', task: tasks[next++] });
        };
        worker.on('message', (msg) => {
          if (msg.type === 'result') {
            rows[msg.index] = msg.row;
            done++;
            if (done % 50 === 0) {
              const el = (Date.now() - t0) / 1000;
              process.stderr.write(
                `\r  ${done}/${tasks.length} — ${Math.round(el)}s, ~${Math.round((el / done) * (tasks.length - done))}s restantes   `,
              );
            }
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
  process.stderr.write('\n');

  console.error('Mondes sans joueur…');
  const worlds = suite.worlds.map((w) =>
    baselineWorldRow(runWorldOnly({ seed: w.seed, years: w.years, sampleEveryYears: 5 })),
  );

  console.error('Trajectoires de PNJ…');
  const npcRun = runNpcTrajectories(suite.npc);
  const npc = {
    tracked: npcRun.trajectories.length,
    teamsMedian: median(npcRun.trajectories.map((t) => t.teams)),
    teamsMean: mean(npcRun.trajectories.map((t) => t.teams)),
    gameChangeShare: rate(npcRun.trajectories, (t) => t.games > 1),
    retiredShare: rate(npcRun.trajectories, (t) => t.status === 'retired' || t.status === 'staff'),
    wastedTalentShare: rate(npcRun.trajectories, (t) => t.wastedTalent),
    uniqueTrajectories: new Set(
      npcRun.trajectories.map((t) => `${t.teams}|${Math.round(t.peak / 4)}|${t.titles}|${t.games}`),
    ).size,
    peakMedian: median(npcRun.trajectories.map((t) => t.peak)),
    retiredAgeMedian: median(npcRun.trajectories.map((t) => t.retiredAge).filter((x) => x !== null)),
  };

  const narrative = narrativeAudit(rows);

  const payload = {
    suite: { ...suite },
    fingerprint,
    recordedAt: new Date().toISOString(),
    engineCommit: gitCommit(),
    engineDirty: gitDirty(),
    durationSeconds: Math.round((Date.now() - t0) / 10) / 100,
    // L'audit narratif tourne AVEC la suite, jamais à côté : une mesure qu'on
    // doit penser à relancer finit par ne plus être relancée (étape 7G).
    narrative,
    headlines: baselineHeadlines(rows, worlds, narrative),
    npc,
    careers: rows,
    worlds,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload, null, 1));
  console.error(`Écrit : ${out} (${Math.round(JSON.stringify(payload).length / 1024)} Ko)`);
  printHeadlines(payload);
}

function compare(opts) {
  const before = JSON.parse(readFileSync(opts.before, 'utf8'));
  const after = JSON.parse(readFileSync(opts.after, 'utf8'));

  if (before.fingerprint !== after.fingerprint) {
    console.error(
      `ATTENTION : empreintes d'entrées différentes (${before.fingerprint} vs ${after.fingerprint}).\n` +
        `Les deux exécutions ne partent pas des mêmes conditions initiales : la comparaison n'est pas valide.`,
    );
    process.exitCode = 3;
  }

  const { rows, regressions } = compareHeadlines(before.headlines, after.headlines);
  const out = [];
  out.push('');
  out.push('════════ COMPARAISON AVEC LE BASELINE ════════');
  out.push(`avant : ${opts.before} (${before.recordedAt}, commit ${before.engineCommit})`);
  out.push(`après : ${opts.after} (${after.recordedAt}, commit ${after.engineCommit})`);
  out.push(`empreinte des entrées : ${after.fingerprint}${before.fingerprint === after.fingerprint ? ' (identique)' : ' (DIFFÉRENTE)'}`);
  out.push('');

  out.push('┌─ PROPRIÉTÉS SURVEILLÉES ─────────────────────────────────────');
  if (regressions.length === 0) {
    out.push('│  Aucune régression sur les propriétés protégées.');
  } else {
    for (const r of regressions) {
      out.push(`│  RÉGRESSION — ${r.label} : ${r.before} → ${r.after} (${signedPct(r.relative)})`);
    }
  }
  out.push('└──────────────────────────────────────────────────────────────');
  out.push('');

  out.push('indicateur                        avant       après      écart');
  for (const r of rows) {
    if (Math.abs(r.relative) < 0.005) continue;
    out.push(
      `  ${r.key.padEnd(30)} ${String(r.before).padStart(10)} ${String(r.after).padStart(11)}  ${signedPct(r.relative).padStart(9)}`,
    );
  }

  out.push('');
  out.push('archétypes (part des carrières)');
  const arche = new Set([
    ...Object.keys(before.headlines.archetypeShares ?? {}),
    ...Object.keys(after.headlines.archetypeShares ?? {}),
  ]);
  for (const a of arche) {
    const b = before.headlines.archetypeShares?.[a] ?? 0;
    const af = after.headlines.archetypeShares?.[a] ?? 0;
    if (Math.abs(af - b) < 0.005) continue;
    out.push(`  ${a.padEnd(24)} ${String(b).padStart(6)} → ${String(af).padStart(6)}`);
  }

  console.log(out.join('\n'));
}

function printHeadlines(payload) {
  const h = payload.headlines;
  const lines = [];
  lines.push('');
  lines.push(`── Indicateurs de la suite « ${payload.suite.name} » ──`);
  for (const [k, v] of Object.entries(h)) {
    if (typeof v === 'number') lines.push(`  ${k.padEnd(30)} ${v}`);
  }
  const nar = payload.narrative;
  if (nar) {
    lines.push('');
    lines.push(`── Audit narratif « ${nar.name} » (${nar.careers} carrières) ──`);
    lines.push(`  racontables                    ${nar.racontabilite.tellable}`);
    lines.push(`  dont manque un point haut      ${nar.racontabilite.manque.bestMoment}`);
    lines.push(`  dont manque un point bas       ${nar.racontabilite.manque.worstMoment}`);
    lines.push(`  dont manque un personnage      ${nar.racontabilite.manque.personnage}`);
    lines.push(`  bilans sans contradiction      ${nar.coherence.sansContradiction} (${nar.coherence.carrieresEnDefaut} en défaut)`);
    for (const [k, v] of Object.entries(nar.coherence.problemes)) {
      lines.push(`      ${k.padEnd(26)} ${v}`);
    }
    lines.push(`  part du talent — pic           ${nar.divergence.partTalent.pic}`);
    lines.push(`  part du talent — legacy        ${nar.divergence.partTalent.legacy}`);
    lines.push(`  part du talent — durée         ${nar.divergence.partTalent.duree}`);
    lines.push(`  part du talent — titres        ${nar.divergence.partTalent.titres}`);
    lines.push(`  part du talent — structures    ${nar.divergence.partTalent.structures}`);
    lines.push(`  à plafond comparable (médianes des tranches) :`);
    lines.push(`      IQR pic                    ${nar.divergence.aTalentComparable.picIQR}`);
    lines.push(`      IQR legacy                 ${nar.divergence.aTalentComparable.legacyIQR}`);
    lines.push(`      IQR durée                  ${nar.divergence.aTalentComparable.dureeIQR}`);
    lines.push(`      archétypes (n=25)          ${nar.divergence.aTalentComparable.archetypes}`);
    lines.push(`  tranches retenues              ${nar.divergence.tranchesRetenues} (${nar.divergence.carrieresRetenues} carrières)`);
    for (const t of nar.divergence.tranches) {
      lines.push(
        `      ${t.plafond.padEnd(8)} n=${String(t.n).padStart(4)}  pic±${String(t.picIQR).padStart(5)}  legacy±${String(t.legacyIQR).padStart(5)}  durée±${String(t.dureeIQR).padStart(4)}  arch=${String(t.archetypes).padStart(4)}  racontable=${t.partRacontable}`,
      );
    }
    lines.push('');
  }
  lines.push('  archétypes :');
  for (const [k, v] of Object.entries(h.archetypeShares ?? {})) {
    lines.push(`    ${k.padEnd(22)} ${v}`);
  }
  console.log(lines.join('\n'));
}

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'inconnu';
  }
}

function gitDirty() {
  try {
    return execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return null;
  }
}

function median(arr) {
  const v = [...arr].filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}
function mean(arr) {
  const v = arr.filter((x) => typeof x === 'number');
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : 0;
}
function rate(arr, fn) {
  return arr.length ? Math.round((arr.filter(fn).length / arr.length) * 1000) / 1000 : 0;
}
function signedPct(v) {
  const p = Math.round(v * 1000) / 10;
  return `${p > 0 ? '+' : ''}${p} %`;
}
