/**
 * Tests du registre des conséquences (étape 9B).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * Le joueur tranchait un dilemme et le jeu ne lui répondait pas. Deux fois :
 *
 *  1. l'interface refermait la fenêtre au clic, donc la phrase de résolution —
 *     pourtant écrite pour chaque choix — n'était jamais lue ;
 *  2. le moteur calculait moral, réputation, attributs et argent au centième
 *     près sans jamais en montrer le moindre chiffre.
 *
 * Une décision sans réponse n'a aucun poids : le joueur choisit à l'aveugle et
 * ne peut rien apprendre de ce qu'il a fait.
 *
 * CE QUE CES TESTS PROTÈGENT
 * --------------------------
 * Le point délicat n'est pas d'afficher des chiffres, c'est d'afficher les
 * BONS. Le registre note ce qui a été appliqué — après mise à l'échelle par la
 * difficulté, après plafonnement — et non ce que l'auteur de l'événement avait
 * écrit. Annoncer « +3 Visée » quand l'attribut butait sur 99 serait un
 * mensonge, et un mensonge sur un chiffre est pire que le silence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSession, advanceWeek, resolveDecision, buildContext } from '../src/engine/simulation.js';
import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { createEffects } from '../src/engine/events/effects.js';
import { lastConsequences } from '../src/engine/events/engine.js';
import { attrsOfGroup } from '../src/engine/attributes.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

function session(seed = 'consequences', difficulty = 'standard') {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
  return createSession({ seed, startYear: 2030, difficulty, player });
}

/** Un `fx` branché sur une vraie session, pour observer le registre isolément. */
function effects(s) {
  const ctx = buildContext(s);
  ctx.fx = createEffects(ctx);
  return { ctx, fx: ctx.fx, person: ctx.person, career: ctx.career };
}

test('le registre note l’écart réel, pas l’écart demandé', () => {
  const s = session();
  const { fx, person } = effects(s);

  person.morale = 97;
  fx.morale(20);
  const moral = fx.journal.find((e) => e.cle === 'morale');
  assert.equal(person.morale, 100);
  // 20 demandés, 3 obtenus : c'est 3 qu'on montre.
  assert.equal(moral.delta, 3);
});

test('un attribut bloqué à sa borne ne produit aucune ligne', () => {
  const s = session();
  const { fx, person } = effects(s);

  const id = Object.keys(person.attrs)[0];
  person.attrs[id] = 99;
  fx.attr(id, 5);
  assert.equal(person.attrs[id], 99);
  assert.equal(fx.journal.length, 0, 'rien n’a bougé, rien ne doit être annoncé');
});

test('une famille entière donne une ligne, pas six', () => {
  const s = session();
  const { fx, person } = effects(s);

  // On écarte les attributs de leurs bornes pour que le gain passe entier.
  for (const id of attrsOfGroup('mechanical')) person.attrs[id] = 50;
  fx.group('mechanical', 2);

  assert.equal(fx.journal.length, 1);
  const ligne = fx.journal[0];
  assert.equal(ligne.cle, 'group:mechanical');
  assert.ok(ligne.delta > 0);
  assert.ok(attrsOfGroup('mechanical').length > 1, 'la famille compte bien plusieurs attributs');
});

test('la ligne de famille porte la moyenne réellement appliquée', () => {
  const s = session();
  const { fx, person } = effects(s);

  const ids = attrsOfGroup('mechanical');
  for (const id of ids) person.attrs[id] = 50;
  // Un attribut déjà au plafond : il ne gagnera rien, la moyenne doit baisser.
  person.attrs[ids[0]] = 99;

  const avant = ids.map((id) => person.attrs[id]);
  fx.group('mechanical', 2);
  const reel = ids.reduce((a, id, i) => a + (person.attrs[id] - avant[i]), 0) / ids.length;

  assert.equal(fx.journal[0].delta, Math.round(reel * 10) / 10);
});

test('deux effets de même nature fusionnent en une seule ligne', () => {
  const s = session();
  const { fx, person } = effects(s);

  person.morale = 50;
  fx.morale(5).morale(3);
  const lignes = fx.journal.filter((e) => e.cle === 'morale');
  assert.equal(lignes.length, 1, 'une seule ligne « Moral »');
  assert.equal(lignes[0].delta, 8);
});

test('le registre repart de zéro à chaque décision', () => {
  const s = session();
  const { fx, person } = effects(s);

  person.morale = 50;
  fx.morale(5);
  assert.equal(fx.journal.length, 1);
  fx.resetJournal();
  assert.equal(fx.journal.length, 0);
  assert.equal(lastConsequences({ fx }).length, 0);
});

test('la mise à l’échelle par la difficulté est prise en compte', () => {
  // Piège rencontré en écrivant ce test : un identifiant de difficulté inconnu
  // retombe silencieusement sur « standard ». Le test comparait alors deux fois
  // la même chose et passait sans rien vérifier. On contrôle donc d'abord que
  // les deux sessions ont bien la difficulté demandée.
  const mesure = (s, attendu) => {
    const { ctx, fx, person } = effects(s);
    assert.equal(ctx.difficulty.id, attendu, 'la difficulté demandée est bien appliquée');
    const id = Object.keys(person.attrs)[0];
    person.attrs[id] = 50;
    fx.attr(id, 4);
    return { delta: fx.journal[0]?.delta, progression: ctx.difficulty.progression };
  };

  const doux = mesure(session('diff', 'story'), 'story');
  const dur = mesure(session('diff', 'hard'), 'hard');

  assert.ok(doux.progression !== dur.progression, 'les deux difficultés progressent différemment');
  // Le registre annonce le gain APPLIQUÉ, jamais le 4 écrit dans l'événement.
  assert.equal(doux.delta, Math.round(4 * doux.progression * 10) / 10);
  assert.equal(dur.delta, Math.round(4 * dur.progression * 10) / 10);
  assert.ok(doux.delta > dur.delta);
});

test('resolveDecision rend les conséquences du choix appliqué', () => {
  const s = session('resolve');
  let trouve = null;
  for (let w = 0; w < 12 * WEEKS_PER_YEAR && !trouve; w++) {
    const report = advanceWeek(s);
    if (s.career.retired) break;
    if (report.decision && !report.decision.resolved) {
      const res = resolveDecision(s, report.decision.choices[0].id);
      assert.ok(res, 'une décision résolue rend un résultat');
      assert.ok(Array.isArray(res.consequences));
      if (res.consequences.length > 0) trouve = res;
    }
  }
  assert.ok(trouve, 'au moins un choix chiffré en douze ans');
  for (const c of trouve.consequences) {
    assert.equal(typeof c.label, 'string');
    assert.ok(c.label.length > 0, 'chaque ligne porte un libellé lisible');
    assert.equal(typeof c.delta, 'number');
    assert.notEqual(c.delta, 0, 'aucune ligne à zéro : ce serait du bruit');
  }
});

test('un événement auto-résolu porte aussi ses conséquences', () => {
  const s = session('auto');
  let vu = false;
  for (let w = 0; w < 20 * WEEKS_PER_YEAR && !vu; w++) {
    const report = advanceWeek(s);
    if (s.career.retired) break;
    if (report.decision?.resolved) {
      assert.ok(Array.isArray(report.decision.consequences));
      vu = true;
    } else if (report.decision) {
      resolveDecision(s, report.decision.choices[0].id);
    }
  }
  assert.ok(vu, 'au moins un événement sans choix en vingt ans');
});

test('la plupart des choix disent quelque chose au joueur', () => {
  // Un registre vide n'est pas un défaut en soi : certains événements sont
  // structurels — une fenêtre d'offres s'ouvre, un jeu change de version — et
  // leur phrase de résolution porte déjà tout le sens. Mais si la majorité des
  // choix ne chiffraient rien, l'affichage ne servirait à rien.
  let total = 0;
  let muets = 0;
  for (const seed of ['c1', 'c2', 'c3', 'c4']) {
    const s = session(seed);
    for (let w = 0; w < 10 * WEEKS_PER_YEAR; w++) {
      const report = advanceWeek(s);
      if (s.career.retired) break;
      if (report.decision && !report.decision.resolved) {
        const res = resolveDecision(s, report.decision.choices[0].id);
        total++;
        if (!res?.consequences?.length) muets++;
      }
    }
  }
  assert.ok(total > 50, `échantillon suffisant (${total} choix)`);
  const part = muets / total;
  assert.ok(part < 0.35, `trop de choix muets : ${(part * 100).toFixed(0)} %`);
});

/**
 * Le second défaut, et le plus grave : l'interface refermait la fenêtre au
 * moment du clic. Le moteur avait beau écrire une phrase de résolution pour
 * chaque choix, personne ne la lisait jamais. Vérifié dans un navigateur avant
 * correction : « APRÈS le choix : la fenêtre a disparu, aucun résultat
 * affiché ». Ces deux tests-là gardent le comportement côté interface.
 */
test('le store garde la fenêtre ouverte après un choix, avec sa réponse', async () => {
  const { actions, getState } = await import('../src/ui/store.js');
  const player = randomPlayerConfig(new RNG(normalizeSeed('store:config')));

  actions.newCareer({ seed: 'store', startYear: 2030, difficulty: 'standard', player });
  const st = getState();

  let choix = null;
  for (let w = 0; w < 12 * WEEKS_PER_YEAR && !choix; w++) {
    actions.advance(1);
    if (st.session.career.retired) break;
    if (st.pendingEvent && !st.pendingEvent.resolved && !st.pendingEvent.resolvedOnly) {
      choix = st.pendingEvent.choices[0].id;
    } else if (st.pendingEvent) {
      actions.dismissEvent();
    }
  }
  assert.ok(choix, 'un événement à choix est apparu');

  actions.chooseEvent(choix);
  assert.ok(st.pendingEvent, 'la fenêtre reste ouverte : c’est là que le jeu répond');
  assert.equal(st.pendingEvent.resolved, true);
  assert.ok(
    st.eventOutcome || st.pendingEvent.outcome,
    'la phrase de résolution est disponible pour l’affichage',
  );
  assert.ok(Array.isArray(st.eventConsequences));

  actions.dismissEvent();
  assert.equal(st.pendingEvent, null, '« Continuer » referme bien');
  assert.equal(st.eventOutcome, null);
  assert.deepEqual(st.eventConsequences, []);
});

test('une nouvelle carrière ne traîne pas la réponse de la précédente', async () => {
  const { actions, getState } = await import('../src/ui/store.js');
  const st = getState();
  st.eventOutcome = 'reste d’une partie précédente';
  st.eventConsequences = [{ cle: 'morale', label: 'Moral', delta: 5 }];

  const player = randomPlayerConfig(new RNG(normalizeSeed('store2:config')));
  actions.newCareer({ seed: 'store2', startYear: 2030, difficulty: 'standard', player });

  assert.equal(st.eventOutcome, null);
  assert.deepEqual(st.eventConsequences, []);
});
