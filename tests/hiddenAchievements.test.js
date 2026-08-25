/**
 * Tests des succès cachés (§35, étape 9M).
 *
 * LA RÈGLE, ET POURQUOI CE N'EST PAS LA RARETÉ
 * --------------------------------------------
 * Le jeu listait ses vingt-cinq succès d'avance, débloqués comme verrouillés.
 * Une carrière devenait donc une liste de courses.
 *
 * Ce qui est caché n'est pas ce qui est rare, c'est ce qui décrit un CHEMIN :
 * changer de jeu, revenir après une traversée du désert, devenir une figure
 * controversée. Un succès qu'on VISE — remporter un titre, tenir dix ans,
 * atteindre 100 000 abonnés — reste visible : le cacher priverait le joueur de
 * repères, et un jeu de carrière doit dire vers quoi on peut aller.
 *
 * CE QUI POURRAIT MAL TOURNER
 * ---------------------------
 * Cacher un succès ne doit pas le rendre inatteignable, ni changer sa
 * condition, ni le faire disparaître une fois obtenu. Et le compte de secrets
 * restants ne doit jamais laisser deviner lesquels.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID } from '../src/engine/achievements.js';
import { statsView } from '../src/engine/view.js';
import { runOneCareer } from '../src/engine/audit/runner.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

const CACHES = ACHIEVEMENTS.filter((a) => a.hidden);

test('les succès cachés existent, sans être la majorité', () => {
  assert.ok(CACHES.length >= 5, 'trop peu pour que la découverte existe');
  assert.ok(CACHES.length < ACHIEVEMENTS.length / 2, 'trop, le joueur navigue à l’aveugle');
});

test('les objectifs qu’on vise restent visibles', () => {
  // Ce sont les repères : les cacher rendrait la progression illisible.
  for (const id of [
    'first_contract', 'first_title', 'national_champion', 'international_title',
    'world_champion', 'long_career', 'millionaire', 'popular_100k',
  ]) {
    const a = ACHIEVEMENTS_BY_ID[id];
    assert.ok(a, `${id} introuvable`);
    assert.ok(!a.hidden, `${id} est un objectif, il ne doit pas être caché`);
  }
});

test('un succès caché garde un libellé et une description complets', () => {
  // Caché avant, pas amputé après : une fois obtenu il s'affiche comme les
  // autres.
  for (const a of CACHES) {
    assert.ok(a.label?.length > 0, `${a.id} sans libellé`);
    assert.ok(a.desc?.length > 0, `${a.id} sans description`);
    assert.ok(a.rarity?.length > 0, `${a.id} sans rareté`);
  }
});

test('la vue ne nomme jamais un succès caché non obtenu', () => {
  let controlees = 0;
  for (let i = 0; i < 5; i++) {
    const r = runOneCareer({ seed: `9m-${i}`, years: 25, policyId: i % 2 ? 'lucide' : 'reckless', keepSession: true });
    if (r.crash) continue;
    const v = statsView(r.session);
    controlees++;
    const obtenus = new Set(v.achievements.map((a) => a.id));
    for (const l of v.lockedAchievements) {
      assert.ok(!ACHIEVEMENTS_BY_ID[l.id]?.hidden, `${l.id} est caché et pourtant nommé`);
      assert.ok(!obtenus.has(l.id), `${l.id} listé à la fois obtenu et à débloquer`);
    }
    // Le compte doit correspondre exactement aux cachés non obtenus.
    const attendus = CACHES.filter((a) => !obtenus.has(a.id)).length;
    assert.equal(v.hiddenRemaining, attendus);
    assert.equal(v.hiddenTotal, CACHES.length);
  }
  assert.ok(controlees >= 4, `échantillon insuffisant : ${controlees}`);
});

test('un succès caché obtenu s’affiche entièrement', () => {
  // Le risque symétrique : cacher trop bien, au point de ne jamais le montrer.
  let vu = 0;
  for (let i = 0; i < 8 && vu === 0; i++) {
    const r = runOneCareer({ seed: `9m-b-${i}`, years: 30, policyId: 'reckless', keepSession: true });
    if (r.crash) continue;
    const v = statsView(r.session);
    for (const a of v.achievements) {
      if (!ACHIEVEMENTS_BY_ID[a.id]?.hidden) continue;
      vu++;
      assert.ok(a.label?.length > 0, `${a.id} obtenu mais sans libellé`);
      assert.ok(a.desc?.length > 0, `${a.id} obtenu mais sans description`);
      assert.ok(a.year, `${a.id} obtenu sans année`);
    }
  }
  assert.ok(vu > 0, 'aucun succès caché débloqué en huit carrières : ils sont inatteignables');
});

test('cacher un succès ne change pas sa condition', () => {
  // Le drapeau est présentationnel. S'il touchait au déblocage, le nombre de
  // succès obtenus varierait avec lui.
  const r = runOneCareer({ seed: '9m-cond', years: 25, policyId: 'lucide', keepSession: true });
  assert.ok(!r.crash);
  const obtenus = r.session.career.achievements.map((a) => a.id);
  for (const id of obtenus) {
    assert.ok(ACHIEVEMENTS_BY_ID[id], `${id} débloqué mais inconnu du catalogue`);
  }
  // Et tous les succès du catalogue, cachés compris, restent évaluables.
  assert.equal(new Set(obtenus).size, obtenus.length, 'un succès débloqué deux fois');
});
