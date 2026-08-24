#!/usr/bin/env node
/**
 * Empreinte de simulation : ce changement a-t-il modifié le jeu, ou seulement
 * ce qu'il enregistre ?
 *
 *   node tools/fingerprint.js --out=/tmp/avant.json --n=25
 *   (on applique le changement)
 *   node tools/fingerprint.js --out=/tmp/apres.json --n=25
 *   node tools/fingerprint.js compare --before=/tmp/avant.json --after=/tmp/apres.json
 *
 * POURQUOI CET OUTIL EXISTE
 * -------------------------
 * Beaucoup de corrections n'ajoutent qu'une trace : elles enregistrent un fait
 * que la simulation produisait déjà sans le dire. Elles ne doivent alors RIEN
 * déplacer — mêmes durées, mêmes pics, mêmes titres, au dernier chiffre. Le
 * vérifier prend trois minutes ici, contre une heure quarante pour une
 * baseline complète, et la réponse est plus nette : une baseline compare des
 * distributions, celui-ci compare des carrières une à une.
 *
 * Il ne remplace pas la baseline : dès qu'un changement touche au tirage
 * aléatoire, les carrières divergent par construction et seule la comparaison
 * de distributions a un sens. C'est justement ce que cet outil dit en premier.
 *
 * Les tâches sont celles de la baseline, échantillonnées à pas régulier : mêmes
 * graines, mêmes configurations de personnage, mêmes politiques de décision.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { buildSuiteTasks } from '../src/engine/audit/baseline.js';
import { runOneCareer } from '../src/engine/audit/runner.js';

const CHAMPS = [
  'durationYears', 'peak', 'finalRating', 'ceiling', 'legacy', 'titles',
  'archetype', 'retirementReason', 'matches', 'wins', 'orgsCount', 'gameChanges',
];

const opts = { n: '25' };
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([a-zA-Z]+)(?:=(.*))?$/);
  if (m) opts[m[1]] = m[2] === undefined ? true : m[2];
}
const cmd = process.argv[2]?.startsWith('--') ? 'run' : process.argv[2] ?? 'run';

if (cmd === 'compare') {
  const before = JSON.parse(readFileSync(opts.before, 'utf8'));
  const after = JSON.parse(readFileSync(opts.after, 'utf8'));
  const ecarts = [];
  const parSeed = new Map(before.rows.map((r) => [r.seed, r]));
  for (const b of after.rows) {
    const a = parSeed.get(b.seed);
    if (!a) continue;
    for (const k of CHAMPS) {
      if (a[k] !== b[k]) ecarts.push({ seed: b.seed, champ: k, avant: a[k], apres: b[k] });
    }
  }
  const communes = after.rows.filter((r) => parSeed.has(r.seed)).length;
  console.log(`carrières comparées : ${communes}`);
  console.log(`champs qui diffèrent : ${ecarts.length}`);
  if (ecarts.length === 0) {
    console.log('→ simulation strictement identique : le changement n’ajoute qu’une trace.');
  } else {
    const touchees = new Set(ecarts.map((e) => e.seed)).size;
    console.log(`→ ${touchees}/${communes} carrières ont changé : le changement touche au tirage.`);
    console.log('   Une baseline complète est alors nécessaire — comparer des carrières');
    console.log('   une à une n’a plus de sens, seules les distributions en ont.');
    console.log(JSON.stringify(ecarts.slice(0, 10), null, 1));
  }
  process.exit(0);
}

const taches = buildSuiteTasks();
const n = Math.max(1, Number(opts.n));
const pas = Math.max(1, Math.floor(taches.length / n));
const rows = [];
for (let i = 0; i < taches.length && rows.length < n; i += pas) {
  const t = taches[i];
  const r = runOneCareer(t);
  const ligne = { seed: t.seed, policy: t.policyId };
  for (const k of CHAMPS) ligne[k] = r[k];
  rows.push(ligne);
  process.stderr.write(`\r  ${rows.length}/${n}   `);
}
process.stderr.write('\n');
const out = opts.out ?? '/tmp/fingerprint.json';
writeFileSync(out, JSON.stringify({ n: rows.length, rows }, null, 1));
console.log(`Écrit : ${out} (${rows.length} carrières)`);
