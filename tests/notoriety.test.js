/**
 * Tests du plafond de notoriété (étape 9D).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * Mesuré sur 40 carrières, en comparant chaque joueur aux PNJ de SON PROPRE
 * monde ayant une carrière équivalente — même pic de niveau à ±5, même volume
 * de matchs à ±40 %, même palmarès :
 *
 *   - le joueur finissait avec 25 fois leur audience ;
 *   - l'écart était le plus grand chez les joueurs SANS aucun titre ;
 *   - 63 % de son audience venait des événements, 3,6 % de la compétition ;
 *   - chez les PNJ, 97 % venait de la compétition.
 *
 * Le monde était cohérent ; le joueur était privilégié. C'est l'inverse exact
 * du principe fondateur.
 *
 * CE QUE L'ABLATION A APPRIS
 * --------------------------
 * La cause n'était pas l'audience donnée par les événements. En la coupant, le
 * rapport passait de ×17 à ×171 — dix fois pire — parce que `gainFollowers`
 * consomme la marge sous plafond avec un rendement décroissant, et que les
 * autres chemins remplissaient ensuite cette marge à plein rendement. C'était
 * la RÉPUTATION accordée par les événements qui portait l'écart.
 *
 * Ces tests protègent donc la règle, pas les chiffres d'un événement : au-delà
 * de ce que le niveau justifie, seuls les titres font monter — et la marge
 * laisse vivre le moment viral.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSession, advanceWeek, buildContext, resolveDecision } from '../src/engine/simulation.js';
import { createEffects } from '../src/engine/events/effects.js';
import {
  justifiedReputation, settleReputation, standingSupport, reputationFloor,
} from '../src/engine/reputation.js';
import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

/** La marge annoncée par le moteur, relue et non recopiée. */
const MARGE = 10;

function session(seed = 'notoriete') {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
  return createSession({ seed, startYear: 2030, difficulty: 'standard', player });
}

function effects(s) {
  const ctx = buildContext(s);
  ctx.fx = createEffects(ctx);
  return { ctx, fx: ctx.fx, person: ctx.person, world: ctx.world };
}

test('le niveau justifié est bien la cible vers laquelle tout le monde glisse', () => {
  // Si les deux formules divergeaient, le plafond des événements ne voudrait
  // plus rien dire : il faut que ce soit littéralement la même valeur.
  const s = session('cible');
  for (let w = 0; w < 3 * WEEKS_PER_YEAR; w++) advanceWeek(s);
  const person = s.world.persons[s.career.personId];

  for (const kind of ['pros', 'public', 'community']) {
    const attendu = justifiedReputation(s.world, person, kind);
    assert.equal(typeof attendu, 'number');
    // La cible doit être le plus haut du palmarès et du niveau où l'on joue.
    const aLaMain = Math.max(
      reputationFloor(person)[kind] ?? 0,
      standingSupport(s.world, person) * { pros: 1, public: 0.62, community: 0.5 }[kind],
    );
    assert.equal(attendu, aLaMain);
  }
  // Un canal sans soutien courant n'a pas de niveau justifié.
  assert.equal(justifiedReputation(s.world, person, 'media'), null);
  assert.equal(justifiedReputation(s.world, person, 'toxicity'), null);
});

test('settleReputation fait bien converger vers ce niveau', () => {
  const s = session('converge');
  for (let w = 0; w < 2 * WEEKS_PER_YEAR; w++) advanceWeek(s);
  const person = s.world.persons[s.career.personId];
  person.reputation.public = 95;
  const cible = justifiedReputation(s.world, person, 'public');
  assert.ok(cible < 95, 'la situation ne justifie pas 95');

  let precedent = person.reputation.public;
  for (let i = 0; i < 40; i++) {
    settleReputation(s.world, person);
    assert.ok(person.reputation.public <= precedent + 0.001, 'la réputation redescend');
    precedent = person.reputation.public;
  }
  assert.ok(Math.abs(person.reputation.public - cible) < 1, `converge vers ${cible}`);
});

test('un événement ne porte pas la notoriété au-delà de ce que la carrière justifie', () => {
  const s = session('plafond');
  for (let w = 0; w < 2 * WEEKS_PER_YEAR; w++) advanceWeek(s);
  const { fx, person, world } = effects(s);

  const justifie = justifiedReputation(world, person, 'public');
  person.reputation.public = justifie;
  fx.rep('public', 80);

  assert.ok(
    person.reputation.public <= justifie + MARGE + 0.001,
    `plafonné à ${justifie} + ${MARGE}, obtenu ${person.reputation.public}`,
  );
});

test('mais le moment viral existe : on peut monter jusqu’à la marge', () => {
  const s = session('viral');
  for (let w = 0; w < 2 * WEEKS_PER_YEAR; w++) advanceWeek(s);
  const { fx, person, world } = effects(s);

  const justifie = justifiedReputation(world, person, 'public');
  person.reputation.public = justifie;
  fx.rep('public', 80);

  assert.ok(
    person.reputation.public > justifie + MARGE - 0.001,
    'un grand moment médiatique porte bien jusqu’à la marge',
  );
  // Et il reste inférieur à ce qu'un plafond absent aurait donné.
  assert.ok(person.reputation.public < justifie + 80);
});

test('un petit gain passe entier tant qu’on est sous le plafond', () => {
  const s = session('petit');
  for (let w = 0; w < 2 * WEEKS_PER_YEAR; w++) advanceWeek(s);
  const { fx, person, world } = effects(s);

  const justifie = justifiedReputation(world, person, 'public');
  person.reputation.public = Math.max(0, justifie - 5);
  const avant = person.reputation.public;
  fx.rep('public', 3);
  assert.equal(Math.round((person.reputation.public - avant) * 10) / 10, 3);
});

test('déjà au-dessus du plafond, un événement de plus n’ajoute rien', () => {
  const s = session('sature');
  for (let w = 0; w < 2 * WEEKS_PER_YEAR; w++) advanceWeek(s);
  const { fx, person, world } = effects(s);

  const justifie = justifiedReputation(world, person, 'public');
  person.reputation.public = justifie + MARGE + 20;
  const avant = person.reputation.public;
  fx.rep('public', 15);
  assert.equal(person.reputation.public, avant, 'aucun gain, mais aucune perte non plus');
});

test('gagner ouvre la notoriété : le palmarès relève le plafond', () => {
  const s = session('titres');
  for (let w = 0; w < 2 * WEEKS_PER_YEAR; w++) advanceWeek(s);
  const person = s.world.persons[s.career.personId];

  const sansTitre = justifiedReputation(s.world, person, 'public');
  person.stats.titles = 6;
  person.stats.internationalTitles = 2;
  const avecTitres = justifiedReputation(s.world, person, 'public');

  assert.ok(avecTitres > sansTitre, 'un palmarès relève ce que la notoriété peut atteindre');
});

test('le regard du milieu n’est pas plafonné : ce n’est pas de la notoriété', () => {
  const s = session('pros');
  for (let w = 0; w < 2 * WEEKS_PER_YEAR; w++) advanceWeek(s);
  const { fx, person, world } = effects(s);

  const justifie = justifiedReputation(world, person, 'pros');
  person.reputation.pros = justifie;
  fx.rep('pros', 25);
  assert.ok(
    person.reputation.pros > justifie + MARGE,
    'le plafond ne porte que sur les canaux qui alimentent l’audience',
  );
});

test('une perte de réputation n’est jamais bloquée par le plafond', () => {
  const s = session('perte');
  for (let w = 0; w < 2 * WEEKS_PER_YEAR; w++) advanceWeek(s);
  const { fx, person } = effects(s);

  person.reputation.public = 70;
  fx.rep('public', -12);
  assert.equal(Math.round(person.reputation.public), 58);
});

test('la notoriété du joueur reste du même ordre que celle de ses pairs', () => {
  // Le vrai garde-fou : on compare le joueur aux PNJ de SON monde ayant une
  // carrière équivalente. Avant 9D, le rapport médian mesuré était ×25 sur 40
  // carrières. On ne vise pas ×1 — le joueur joue vraiment et les moments
  // médiatiques sont un levier réel — mais un ordre de grandeur, pas deux.
  const rapports = [];
  for (const seed of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) {
    const s = session(seed);
    const person = s.world.persons[s.career.personId];
    for (let w = 0; w < 18 * WEEKS_PER_YEAR && !s.career.retired; w++) {
      const r = advanceWeek(s);
      if (r.decision && !r.decision.resolved) resolveDecision(s, r.decision.choices[0].id);
    }
    const pic = person.stats.peakRating ?? 0;
    const matchs = person.stats.matches ?? 0;
    const aTitre = (person.stats.titles ?? 0) >= 1;
    const pairs = [];
    for (const p of Object.values(s.world.persons)) {
      if (p.id === person.id) continue;
      const q = p.stats;
      if (!q) continue;
      if (Math.abs((q.peakRating ?? 0) - pic) > 5) continue;
      const m = q.matches ?? 0;
      if (m < matchs * 0.6 || m > matchs * 1.4) continue;
      if (((q.titles ?? 0) >= 1) !== aTitre) continue;
      pairs.push(q.peakFollowers ?? p.followers ?? 0);
    }
    if (pairs.length < 3) continue;
    pairs.sort((a, b) => a - b);
    const median = pairs[Math.floor(pairs.length / 2)];
    if (median > 0) {
      rapports.push((person.stats.peakFollowers ?? person.followers) / median);
    }
  }
  assert.ok(rapports.length >= 3, `échantillon exploitable (${rapports.length} carrières appariées)`);
  rapports.sort((a, b) => a - b);
  const median = rapports[Math.floor(rapports.length / 2)];
  assert.ok(median < 12, `rapport médian joueur / pairs : ×${median.toFixed(1)} (avant 9D : ×25)`);
});
