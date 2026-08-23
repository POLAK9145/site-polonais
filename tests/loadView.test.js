/**
 * Tests de la vue de charge (étape 8A).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * La charge accumulée décidait de choses lourdes — elle divise la progression
 * jusqu'à −62 %, ronge le moral, et met fin à la carrière — et n'apparaissait
 * sur aucun écran. Mesuré sur 108 carrières : 13 % atteignent « surmené » ou
 * pire, 10 % connaissent un burnout déclaré, 14 % se terminent en usure, et le
 * cas le plus touché perd l'équivalent de 248 semaines de progression. Le
 * joueur choisissait quatre créneaux par semaine sans rien voir de tout cela.
 *
 * LE RISQUE QUE CES TESTS COUVRENT
 * -------------------------------
 * Afficher la charge demande de reconstituer, côté vue, le contexte que la
 * simulation passe à `updateLoad`. Cet assemblage peut dériver du moteur sans
 * que rien ne casse : l'interface montrerait alors une charge plausible et
 * fausse, ce qui est pire que de ne rien montrer. Le test 1 rend cette dérive
 * impossible en comparant la vue au fait enregistré par le moteur.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import {
  createSession, advanceWeek, resolveDecision, acceptOffer,
  seekTeam, canSeekTeam, foundTeam, canFoundTeam, setRoutine,
} from '../src/engine/simulation.js';
import { createPolicyState, pickChoice } from '../src/engine/audit/policies.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { loadView } from '../src/engine/view.js';
import {
  createLoadState, updateLoad, weeklyIntensity, equilibriumLoad, stateAt, LOAD_STATES,
} from '../src/engine/load.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

function play({ seed, policyId = 'random', years = 6, onWeek = null }) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
  const st = createPolicyState(policyId, normalizeSeed(`${seed}:policy`));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  if (st.policy.routine) setRoutine(session, st.policy.routine);
  const person = session.world.persons[session.career.personId];
  let w = 0;
  while (w < years * WEEKS_PER_YEAR && !session.career.retired) {
    const report = advanceWeek(session);
    w++;
    if (report.decision && !report.decision.resolved) {
      const c = pickChoice(st, report.decision.choices);
      resolveDecision(session, (c ?? report.decision.choices[0])?.id);
    }
    if (session.career.offers?.length) acceptOffer(session, 0);
    const real = person.teamId && !session.world.teams[person.teamId]?.isSelfTeam;
    if (!real && canSeekTeam(session).ok) {
      const r = seekTeam(session);
      if (r.offers?.length) acceptOffer(session, 0);
      else if (canFoundTeam(session).ok && st.rng.chance(0.7)) foundTeam(session);
    }
    if (onWeek) onWeek(session, w);
  }
  return session;
}

test("1 — la vue ne peut pas afficher une charge que la simulation n'a pas subie", () => {
  // La vue reconstitue le contexte de charge (routine, matchs, pression,
  // sensibilité, repos) pour projeter l'équilibre. Le moteur, lui, enregistre
  // l'intensité qu'il a RÉELLEMENT appliquée. Les deux doivent coïncider à
  // chaque semaine — sinon l'assemblage de la vue a dérivé du moteur.
  let ecarts = [];
  let controlees = 0;
  for (const seed of ['8a-v1', '8a-v2', '8a-v3']) {
    play({
      seed, policyId: 'grinder', years: 4,
      onWeek: (session) => {
        const v = loadView(session);
        const person = session.world.persons[session.career.personId];
        const reel = person.load?.lastIntensity;
        if (v == null || reel == null) return;
        controlees++;
        // `intensite` est le fait relu ; la projection, elle, part de
        // l'assemblage. On compare donc l'assemblage au fait.
        const ctxRecompose = v.intensiteProjetee;
        if (Math.abs(ctxRecompose - reel) > 0.01) {
          ecarts.push({ seed, semaine: session.world.week, vue: ctxRecompose, moteur: reel });
        }
      },
    });
  }
  assert.ok(controlees > 300, `trop peu de semaines contrôlées : ${controlees}`);
  assert.equal(
    ecarts.length, 0,
    `la vue diverge du moteur sur ${ecarts.length}/${controlees} semaines : ${JSON.stringify(ecarts.slice(0, 3))}`,
  );
});

test("2 — la projection annoncée est bien celle que le moteur atteint", () => {
  // `equilibriumLoad` inverse la loi d'accumulation. On vérifie qu'en tenant
  // réellement une intensité donnée pendant des années, la charge converge
  // vers la valeur annoncée — et pas vers une valeur voisine.
  const ecarts = [];
  for (const volume of [4, 6.9, 8, 10, 12, 16, 20]) {
    const person = { hidden: { burnoutFloor: 0.5 }, load: createLoadState() };
    const ctx = { rawFatigue: volume, matchLoad: 0, pressure: 0, sensitivity: 1, restSlots: 0 };
    const annonce = equilibriumLoad(person, weeklyIntensity(person, ctx).raw);
    for (let w = 0; w < 5000; w++) updateLoad(person, { ...ctx, week: w });
    ecarts.push({ volume, annonce, atteint: Math.round(person.load.value * 10) / 10 });
  }
  for (const e of ecarts) {
    assert.ok(
      Math.abs(e.annonce - e.atteint) <= 0.2,
      `volume ${e.volume} : annoncé ${e.annonce}, atteint ${e.atteint} — ${JSON.stringify(ecarts)}`,
    );
  }
});

test("3 — la projection reste croissante avec l'intensité", () => {
  // Sans cette propriété, « en faire plus » pourrait afficher une charge cible
  // plus basse, et le conseil donné au joueur serait un piège.
  const person = { hidden: { burnoutFloor: 0.5 }, load: createLoadState() };
  let precedent = -1;
  for (let i = 3; i <= 30; i += 0.5) {
    const v = equilibriumLoad(person, i);
    assert.ok(v >= precedent, `l'équilibre redescend entre ${i - 0.5} et ${i} : ${precedent} → ${v}`);
    precedent = v;
  }
  assert.equal(equilibriumLoad(person, 3), 0, 'une intensité soutenable devrait viser zéro');
  assert.ok(equilibriumLoad(person, 30) > 90, 'une intensité extrême devrait viser très haut');
});

test("4 — un joueur qui se détruit le voit venir", () => {
  // La propriété qui compte pour le joueur : au moment où la charge devient
  // dangereuse, la vue le dit AVANT, et elle le dit en clair.
  let alerteAvantDanger = 0;
  let entreesEnDanger = 0;
  for (const seed of ['8a-w1', '8a-w2', '8a-w3', '8a-w4']) {
    let dejaPrevenu = false;
    play({
      seed, policyId: 'grinder', years: 8,
      onWeek: (session) => {
        const v = loadView(session);
        if (!v) return;
        // « la routine ne tient pas » doit apparaître avant l'état haut
        if (!v.tenable) dejaPrevenu = true;
        if (v.eleve) {
          entreesEnDanger++;
          if (dejaPrevenu) alerteAvantDanger++;
        }
      },
    });
  }
  if (entreesEnDanger === 0) {
    // Prémisse invalide plutôt que test vert par accident.
    assert.fail('aucune carrière n’a atteint un état haut : le test ne prouve rien, revoir la politique ou la durée');
  }
  assert.equal(
    alerteAvantDanger, entreesEnDanger,
    `${entreesEnDanger - alerteAvantDanger} semaines en état haut sans avertissement préalable`,
  );
});

test("5 — la vue ne révèle aucune donnée cachée", () => {
  // Le plafond d'attributs et le seuil de rupture personnel restent invisibles :
  // la charge est ce que le joueur ressent, pas ce que le moteur sait de lui.
  const session = play({ seed: '8a-secret', policyId: 'random', years: 3 });
  const v = loadView(session);
  assert.ok(v, 'pas de vue de charge');
  const texte = JSON.stringify(v);
  const person = session.world.persons[session.career.personId];
  for (const cle of Object.keys(person.hidden ?? {})) {
    assert.ok(!texte.includes(`"${cle}"`), `la vue expose la donnée cachée « ${cle} »`);
  }
  assert.ok(typeof v.label === 'string' && v.label.length > 0, 'l’état doit être lisible');
  assert.ok(typeof v.conseil === 'string' && v.conseil.length > 0, 'le joueur doit savoir quoi en penser');
});

test("6 — les états annoncés sont ceux de l'échelle du moteur", () => {
  const person = { hidden: { burnoutFloor: 0.5 }, load: createLoadState() };
  assert.equal(stateAt(0), LOAD_STATES.FRESH);
  assert.equal(stateAt(30), LOAD_STATES.TIRED);
  assert.equal(stateAt(50), LOAD_STATES.PRESSURED);
  assert.equal(stateAt(70), LOAD_STATES.OVERLOADED);
  assert.equal(stateAt(85), LOAD_STATES.DRAINED);
  // Et la projection classe dans le même barème.
  const haut = equilibriumLoad(person, 20);
  assert.equal(stateAt(haut), LOAD_STATES.DRAINED, `équilibre ${haut}`);
});
