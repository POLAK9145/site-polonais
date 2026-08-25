/**
 * Tests de la politique « lucide » (étape 9J).
 *
 * POURQUOI ELLE EXISTE
 * --------------------
 * Ce n'est pas une fonctionnalité du jeu, c'est une réparation d'INSTRUMENT.
 * Toutes les politiques d'audit jouaient une routine fixe et ne se reposaient
 * jamais ; les PNJ, eux, insèrent repos, travail mental ou vie sociale dès que
 * la fatigue ou le stress montent. Mesurer le joueur contre le monde revenait
 * donc à comparer un mauvais pilote à un pilote correct, et j'en ai tiré trois
 * diagnostics faux avant de m'en apercevoir :
 *
 *   - « le joueur ne réalise que 86 % de son potentiel contre 94 % pour un
 *     PNJ » — avec une routine qui se régule, il est à 90 % ;
 *   - « le moral du joueur est effondré » — moral final médian 0 avec le
 *     grinder, 79 avec la politique lucide ;
 *   - « le sommet mondial est inatteignable » — conclusion tirée d'un
 *     échantillon que ces politiques rendaient non représentatif.
 *
 * CE QUE CES TESTS PROTÈGENT
 * --------------------------
 * D'abord que l'ajout n'a rien changé aux politiques existantes : tous les
 * calibrages du dépôt reposent sur elles. Ensuite que « lucide » se régule
 * vraiment, sinon elle serait un troisième mauvais pilote sous un autre nom.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { POLICIES, POLICY_IDS, ROUTINE_REFRESH_WEEKS, createPolicyState } from '../src/engine/audit/policies.js';
import { runOneCareer } from '../src/engine/audit/runner.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

test('les politiques existantes sont inchangées', () => {
  // Le garde-fou central : `routineFor` est le seul point d'entrée du
  // recalcul. Si aucune ancienne politique n'en définit, aucune n'a bougé.
  for (const id of POLICY_IDS) {
    if (id === 'lucide') continue;
    assert.equal(
      POLICIES[id].routineFor, undefined,
      `${id} a acquis une routine dynamique : ses calibrages ne valent plus`,
    );
  }
});

test('« lucide » recalcule sa routine au lieu d’en figer une', () => {
  const p = POLICIES.lucide;
  assert.equal(typeof p.routineFor, 'function');
  assert.equal(p.routine, undefined, 'une routine fixe annulerait le propos');
  assert.ok(ROUTINE_REFRESH_WEEKS >= 1);
});

test('la routine change réellement avec l’état', () => {
  // Une routine « dynamique » qui rendrait toujours la même chose serait un
  // mensonge coûteux : elle ferait croire l'instrument réparé.
  const st = createPolicyState('lucide', 'routine-test');
  const frais = { teamId: 't1', fatigue: 10, stress: 10, attrs: {}, traits: [] };
  const cuit = { teamId: 't1', fatigue: 95, stress: 90, attrs: {}, traits: [] };
  const a = POLICIES.lucide.routineFor(frais, st.rng).join(',');
  const b = POLICIES.lucide.routineFor(cuit, st.rng).join(',');
  assert.notEqual(a, b, `même routine à 10 et à 95 de fatigue : ${a}`);
  assert.ok(b.includes('rest') || b.includes('mentalwork'), `un joueur cuit devrait souffler : ${b}`);
});

test('elle produit un joueur qui tient debout', () => {
  const moral = [];
  let ruptures = 0;
  let n = 0;
  for (let i = 0; i < 6; i++) {
    const r = runOneCareer({ seed: `9j-t-${i}`, years: 20, policyId: 'lucide', keepSession: true });
    if (r.crash) continue;
    const moi = r.session.world.persons[r.session.career.personId];
    moral.push(moi.morale);
    ruptures += moi.load?.episodes ?? 0;
    n++;
  }
  assert.ok(n >= 5, `trop de carrières perdues : ${n}`);
  const median = [...moral].sort((a, b) => a - b)[Math.floor(moral.length / 2)];
  // Mesuré : 79 en médiane, contre 0 pour le grinder. On garde un seuil bas —
  // c'est l'écart de nature qu'on protège, pas la valeur exacte.
  assert.ok(median > 30, `moral final médian ${median} : la régulation ne fonctionne pas`);
  assert.ok(ruptures <= n, `${ruptures} ruptures pour ${n} carrières : trop pour un joueur qui se ménage`);
});

test('elle reste déterministe', () => {
  // Sans ça, plus aucune mesure comparative n'est possible.
  const a = runOneCareer({ seed: 'det', years: 8, policyId: 'lucide', keepSession: true });
  const b = runOneCareer({ seed: 'det', years: 8, policyId: 'lucide', keepSession: true });
  const lire = (r) => {
    const moi = r.session.world.persons[r.session.career.personId];
    return `${moi.stats.matches}|${moi.stats.peakRating.toFixed(6)}|${moi.morale.toFixed(6)}`;
  };
  assert.equal(lire(a), lire(b));
});

test('un joueur qui se ménage se ménage vraiment', () => {
  // Comparaison de nature, pas de réglage : le grinder finit à zéro de moral,
  // la politique lucide non.
  const finalMoral = (pol) => {
    const vals = [];
    for (let i = 0; i < 5; i++) {
      const r = runOneCareer({ seed: `9j-c-${i}`, years: 20, policyId: pol, keepSession: true });
      if (r.crash) continue;
      vals.push(r.session.world.persons[r.session.career.personId].morale);
    }
    return vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)];
  };
  assert.ok(
    finalMoral('lucide') > finalMoral('grinder'),
    'la régulation devrait laisser un joueur en meilleur état qu’un grind sans repos',
  );
});
