/**
 * Tests de la fin de carrière côté joueur (étape 9C).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * Découvert en jouant une carrière entière dans un navigateur, pas en relisant
 * le moteur. Le moteur faisait pourtant tout correctement : il choisissait une
 * raison d'arrêt, la datait, l'enregistrait, et l'étape 8C lui avait même écrit
 * un récit distinguant une fin choisie d'une fin subie.
 *
 * Rien n'arrivait au joueur. Une carrière qui se terminait d'elle-même poussait
 * une seule phrase — « Votre carrière de joueur s'achève » — au milieu du
 * rapport de la semaine. L'écran continuait ensuite d'afficher « Semaine
 * suivante », une routine hebdomadaire et des objectifs à atteindre, à un joueur
 * retraité. La page de fin de carrière n'était accessible qu'en remarquant
 * qu'un onglet de navigation avait changé de nom.
 *
 * Dans un jeu de carrière, la fin est le moment où tout ce qui a été joué prend
 * un sens. La manquer, c'est manquer le jeu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSession, advanceWeek, resolveDecision, retireCareer,
} from '../src/engine/simulation.js';
import { retirementView } from '../src/engine/view.js';
import { FINS_SUBIES } from '../src/engine/legacy.js';
import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

function session(seed) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
  return createSession({ seed, startYear: 2030, difficulty: 'standard', player });
}

/** Joue jusqu'à ce que la carrière s'arrête d'elle-même. */
function jusquAuBout(seed, maxYears = 45) {
  const s = session(seed);
  for (let w = 0; w < maxYears * WEEKS_PER_YEAR; w++) {
    const report = advanceWeek(s);
    if (report.decision && !report.decision.resolved) {
      resolveDecision(s, report.decision.choices[0].id);
    }
    if (s.career.retired) return s;
  }
  return null;
}

test('une carrière en cours n’a pas de fin à raconter', () => {
  const s = session('encours');
  advanceWeek(s);
  assert.equal(retirementView(s), null);
});

test('la fin relit ce que le moteur a enregistré, sans rien recalculer', () => {
  const s = jusquAuBout('fin-1');
  assert.ok(s, 'la carrière se termine bien toute seule');
  const fin = retirementView(s);
  const person = s.world.persons[s.career.personId];

  assert.equal(fin.path, s.career.retirementPath);
  assert.equal(fin.matches, person.stats.matches);
  assert.equal(fin.titles, person.stats.titles);
  assert.ok(fin.years >= 1);
  assert.ok(fin.age > 0 && fin.age < 60);
  assert.ok(typeof fin.title === 'string' && fin.title.length > 0);
});

test('une fin subie est dite ; une fin choisie ne s’explique pas', () => {
  const s = session('choix');
  for (let w = 0; w < 3 * WEEKS_PER_YEAR; w++) advanceWeek(s);
  retireCareer(s, 'décision personnelle');

  const fin = retirementView(s);
  assert.equal(fin.chosen, true);
  assert.equal(fin.text, null, 'on n’explique pas au joueur la décision qu’il vient de prendre');
  assert.equal(fin.title, 'Vous raccrochez');
});

test('chaque raison d’arrêt subie a une phrase, et une seule forme', () => {
  // Les clés de FINS_SUBIES doivent rester exactement celles que `maybeRetire`
  // pose. Une clé qui dérive rendrait la fin muette sans casser aucun test.
  for (const [path, texte] of Object.entries(FINS_SUBIES)) {
    const s = session(`fin-${path}`);
    for (let w = 0; w < 2 * WEEKS_PER_YEAR; w++) advanceWeek(s);
    retireCareer(s, path);
    const fin = retirementView(s);
    assert.equal(fin.chosen, false, `« ${path} » est une fin subie`);
    assert.equal(fin.text, texte);
  }
});

test('aller jusqu’à la limite d’âge ne se titre pas comme un échec', () => {
  const s = session('age');
  for (let w = 0; w < 2 * WEEKS_PER_YEAR; w++) advanceWeek(s);
  retireCareer(s, 'âge');
  const parAge = retirementView(s);

  const s2 = session('usure');
  for (let w = 0; w < 2 * WEEKS_PER_YEAR; w++) advanceWeek(s2);
  retireCareer(s2, 'usure');
  const parUsure = retirementView(s2);

  assert.notEqual(parAge.title, parUsure.title);
  assert.equal(parAge.title, 'Vous êtes allé au bout');
});

test('le store conduit le joueur à la fin de sa carrière', async () => {
  const { actions, getState } = await import('../src/ui/store.js');
  const player = randomPlayerConfig(new RNG(normalizeSeed('fin-store:config')));
  actions.newCareer({ seed: 'fin-store', startYear: 2030, difficulty: 'standard', player });
  const st = getState();

  assert.equal(st.careerEnd, null);
  assert.equal(st.screen, 'career');

  for (let w = 0; w < 45 * WEEKS_PER_YEAR; w++) {
    if (st.pendingEvent && !st.pendingEvent.resolved && !st.pendingEvent.resolvedOnly) {
      actions.chooseEvent(st.pendingEvent.choices[0].id);
      actions.dismissEvent();
    } else if (st.pendingEvent) {
      actions.dismissEvent();
    }
    actions.advance(1);
    if (st.session.career.retired) break;
  }
  assert.ok(st.session.career.retired, 'la carrière s’est bien terminée');

  // C'est ici que l'ancienne version échouait : elle sortait de la boucle en
  // laissant le joueur sur l'écran d'un joueur en activité.
  assert.equal(st.screen, 'legacy', 'le jeu ouvre la fin de carrière tout seul');
  assert.ok(st.careerEnd, 'et il a quelque chose à annoncer');
  assert.equal(st.careerEnd.path, st.session.career.retirementPath);
  assert.equal(st.pendingEvent, null, 'aucune fenêtre d’événement ne survit à la fin');

  actions.acknowledgeCareerEnd();
  assert.equal(st.careerEnd, null);
  assert.equal(st.screen, 'legacy', 'on reste sur la page de fin');
});

test('la retraite décidée passe par le même chemin', async () => {
  const { actions, getState } = await import('../src/ui/store.js');
  const player = randomPlayerConfig(new RNG(normalizeSeed('fin-store2:config')));
  actions.newCareer({ seed: 'fin-store2', startYear: 2030, difficulty: 'standard', player });
  const st = getState();
  for (let w = 0; w < 4 * WEEKS_PER_YEAR; w++) {
    if (st.pendingEvent) { actions.dismissEvent(); }
    actions.advance(1);
    if (st.session.career.retired) break;
  }
  if (st.session.career.retired) return; // fin naturelle : déjà couverte

  actions.retire();
  assert.equal(st.screen, 'legacy');
  assert.ok(st.careerEnd);
  assert.equal(st.careerEnd.chosen, true);
});

test('reprendre une sauvegarde ne rejoue pas l’annonce de fin', async () => {
  const { actions, getState } = await import('../src/ui/store.js');
  const st = getState();
  st.careerEnd = { title: 'reste d’une partie précédente' };
  const player = randomPlayerConfig(new RNG(normalizeSeed('fin-store3:config')));
  actions.newCareer({ seed: 'fin-store3', startYear: 2030, difficulty: 'standard', player });
  assert.equal(st.careerEnd, null);
});
