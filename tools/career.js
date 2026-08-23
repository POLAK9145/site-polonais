#!/usr/bin/env node
/**
 * Joue une carrière complète et en fait ce qu'on lui demande.
 *
 *   node tools/career.js --seed=vitrine --policy=grinder --years=25
 *   node tools/career.js --seed=vitrine --save=/tmp/carriere.json
 *   node tools/career.js --seed=vitrine --narrative
 *
 * À quoi ça sert : regarder les écrans de fin de partie sans jouer vingt ans à
 * la main, et produire une sauvegarde de démonstration qu'on peut poser dans le
 * `localStorage` du navigateur.
 *
 * La carrière est jouée par `runOneCareer`, exactement comme dans l'audit et la
 * baseline : aucune boucle d'interaction n'est recopiée ici, sans quoi cet
 * outil finirait par simuler autre chose que le jeu.
 */

import { writeFileSync } from 'node:fs';
import { runOneCareer } from '../src/engine/audit/runner.js';
import { serializeSession } from '../src/engine/save.js';
import { computeLegacy, buildNarrative, careerStats } from '../src/engine/legacy.js';
import { POLICY_IDS } from '../src/engine/audit/policies.js';

const opts = {};
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([a-zA-Z]+)(?:=(.*))?$/);
  if (m) opts[m[1]] = m[2] === undefined ? true : m[2];
}

const seed = opts.seed ?? 'demo';
const policyId = opts.policy ?? 'random';
const years = Number(opts.years ?? 25);

if (!POLICY_IDS.includes(policyId)) {
  console.error(`Politique inconnue : ${policyId}\nDisponibles : ${POLICY_IDS.join(', ')}`);
  process.exit(2);
}

const res = runOneCareer({ seed, years, policyId, keepSession: true });
if (res.crash) {
  console.error('PLANTAGE :', res.crash.message, res.crash.stack ?? '');
  process.exit(1);
}

const { session } = res;
const person = session.world.persons[session.career.personId];

console.log(
  [
    `${person.nick} (${person.firstName} ${person.lastName})`,
    `${res.durationYears} ans · pic ${res.peak} · plafond ${res.ceiling}`,
    `${res.titles} titre(s) · ${res.matches} matchs · legacy ${res.legacy} · ${res.archetype}`,
    session.career.retired ? `retraite : ${res.retirementReason}` : 'encore en activité',
    `racontable : ${res.story.tellable ? 'oui' : 'non'}`,
    res.legacyProblems.length
      ? `CONTRADICTIONS : ${res.legacyProblems.map((p) => p.code).join(', ')}`
      : 'bilan sans contradiction',
  ].join('\n'),
);

if (opts.narrative) {
  const legacy = computeLegacy(session.world, session.career);
  console.log('\n--- bilan ---');
  console.log(buildNarrative(session.world, session.career, legacy).join('\n\n'));
  console.log('\n--- chiffres ---');
  console.log(JSON.stringify(careerStats(session.world, session.career), null, 1));
}

if (opts.save) {
  const json = serializeSession(session);
  writeFileSync(opts.save, json);
  console.log(`\nSauvegarde écrite : ${opts.save} (${Math.round(json.length / 1024)} Ko)`);
}
