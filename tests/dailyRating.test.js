/**
 * Tests de la note du jour (étape 9H).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * L'en-tête affichait « Niveau 69 » — la note PROPRE, celle qui sert au
 * scouting et aux classements. Les matchs, eux, se jouent sur
 * `effectiveRating`, qui retire la fatigue, ajoute la forme et compte le moral.
 *
 * Mesuré sur 6 637 semaines de jeu réel, l'écart entre les deux :
 *
 *   p10   -10,1   (on joue DIX POINTS MIEUX que le chiffre affiché)
 *   p50    +1,4
 *   p90   +12,6
 *
 *   43 % des semaines l'écart dépasse 3 points, 31 % dépasse 6, et 44 % du
 *   temps il joue en faveur du joueur.
 *
 * Le joueur pilotait donc sa carrière — quand se reposer, quand accepter un
 * match, quand signer — sur un chiffre qui n'était pas celui de ses matchs.
 *
 * LE RISQUE QUE CES TESTS COUVRENT
 * -------------------------------
 * Afficher un détail chiffré, c'est promettre qu'il fait la somme annoncée. Un
 * détail qui ne s'additionne pas est pire que pas de détail : il apprend au
 * joueur une règle fausse. La moitié de ce fichier vérifie donc l'addition.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSession, advanceWeek } from '../src/engine/simulation.js';
import { headerView } from '../src/engine/view.js';
import { ratingBreakdown, effectiveRating, baseRating, createPerson } from '../src/engine/person.js';
import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import { GAMES, GAMES_BY_ID } from '../src/data/games.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

function personne({ form = 0, fatigue = 0, morale = 60 } = {}) {
  const p = createPerson(new RNG(normalizeSeed('note')), { age: 22, baseLevel: 60 });
  p.gameId = GAMES[0].id;
  p.form = form;
  p.fatigue = fatigue;
  p.morale = morale;
  return p;
}

test('le détail fait exactement la somme annoncée', () => {
  for (const etat of [
    { form: 0, fatigue: 0, morale: 60 },
    { form: -8, fatigue: 90, morale: 3 },
    { form: 12, fatigue: 20, morale: 98 },
    { form: -3, fatigue: 46, morale: 44 },
  ]) {
    const p = personne(etat);
    const d = ratingBreakdown(p, GAMES[0]);
    const somme = d.base + d.forme + d.fatigue + d.moral;
    assert.ok(Math.abs(somme - d.effectif) < 1e-9, `${JSON.stringify(etat)} : ${somme} ≠ ${d.effectif}`);
  }
});

test('la décomposition est la seule définition de la note effective', () => {
  // Si les deux divergeaient, l'écran expliquerait un chiffre que le moteur
  // n'utilise pas.
  for (const etat of [{ form: 5, fatigue: 70, morale: 20 }, { form: -10, fatigue: 10, morale: 90 }]) {
    const p = personne(etat);
    assert.equal(effectiveRating(p, GAMES[0]), ratingBreakdown(p, GAMES[0]).effectif);
  }
});

test('sans la condition, on retrouve la note propre', () => {
  const p = personne({ form: -9, fatigue: 88, morale: 4 });
  assert.equal(effectiveRating(p, GAMES[0], { includeCondition: false }), baseRating(p, GAMES[0]));
});

test('la fatigue ne coûte qu’au-delà du seuil', () => {
  assert.equal(ratingBreakdown(personne({ fatigue: 45 }), GAMES[0]).fatigue, 0);
  assert.equal(ratingBreakdown(personne({ fatigue: 20 }), GAMES[0]).fatigue, 0);
  assert.ok(ratingBreakdown(personne({ fatigue: 80 }), GAMES[0]).fatigue < 0);
});

test('un moral haut rapporte, un moral bas coûte', () => {
  assert.ok(ratingBreakdown(personne({ morale: 95 }), GAMES[0]).moral > 0);
  assert.equal(ratingBreakdown(personne({ morale: 60 }), GAMES[0]).moral, 0);
  assert.ok(ratingBreakdown(personne({ morale: 5 }), GAMES[0]).moral < 0);
});

test('la vue additionne ce qu’elle affiche', () => {
  // Le test qui compte : sur une vraie carrière, les causes montrées doivent
  // rendre compte de l'écart annoncé, aux arrondis près.
  const player = randomPlayerConfig(new RNG(normalizeSeed('9h:config')));
  const s = createSession({ seed: '9h', startYear: 2030, difficulty: 'standard', player });
  let controlees = 0;
  let ecartsAffiches = 0;
  for (let w = 0; w < 6 * WEEKS_PER_YEAR && !s.career.retired; w++) {
    advanceWeek(s);
    const head = headerView(s);
    if (head.ratingDuJour == null) continue;
    controlees++;
    const somme = head.ratingCauses.reduce((a, c) => a + c.delta, 0);
    // Chaque cause est arrondie au dixième : trois causes tolèrent 0,15.
    assert.ok(
      Math.abs(somme - head.ratingEcart) < 0.16,
      `semaine ${w} : causes ${somme} pour un écart annoncé de ${head.ratingEcart}`,
    );
    if (Math.abs(head.ratingEcart) >= 1) ecartsAffiches++;
    for (const c of head.ratingCauses) {
      assert.notEqual(c.delta, 0, 'une cause à zéro n’explique rien');
      assert.ok(c.label.length > 0);
    }
  }
  assert.ok(controlees > 200, `échantillon insuffisant : ${controlees}`);
  assert.ok(ecartsAffiches > 0, 'l’écart devrait être visible au moins parfois');
});

test('la note du jour est bien celle des matchs, pas la note propre', () => {
  const player = randomPlayerConfig(new RNG(normalizeSeed('9h2:config')));
  const s = createSession({ seed: '9h2', startYear: 2030, difficulty: 'standard', player });
  const moi = s.world.persons[s.career.personId];
  for (let w = 0; w < 3 * WEEKS_PER_YEAR && !s.career.retired; w++) advanceWeek(s);
  const head = headerView(s);
  const game = GAMES_BY_ID[moi.gameId];
  assert.equal(head.ratingDuJour, Math.round(effectiveRating(moi, game)));
  assert.equal(head.rating, Math.round(baseRating(moi, game)));
});

test('les causes sont classées par poids', () => {
  const player = randomPlayerConfig(new RNG(normalizeSeed('9h3:config')));
  const s = createSession({ seed: '9h3', startYear: 2030, difficulty: 'standard', player });
  Object.assign(s.world.persons[s.career.personId], { form: 1, fatigue: 95, morale: 30 });
  const head = headerView(s);
  for (let i = 1; i < head.ratingCauses.length; i++) {
    assert.ok(
      Math.abs(head.ratingCauses[i - 1].delta) >= Math.abs(head.ratingCauses[i].delta),
      'la cause la plus lourde vient en premier',
    );
  }
});
