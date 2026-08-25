/**
 * Tests de l'état ressenti devant un choix risqué (étape 9I).
 *
 * CE QUE LA MESURE A ÉTABLI, ET CE QU'ELLE A REFUSÉ
 * ------------------------------------------------
 * L'idée de départ était une échelle de risque graduée sur les choix. La
 * mesure l'a écartée :
 *
 *  - rejoué 14 fois depuis un état identique, sur 12 occasions, un choix
 *    « risqué » ne produit pas plus de dispersion qu'un choix sûr — ni en
 *    niveau (1,27 contre 1,87), ni en charge, ni en moral, ni en ruptures ;
 *  - `crashRisk` vaut exactement zéro dans 99 % des rencontres avec un choix
 *    risqué, donc le terme contextuel de `clamp(0,25 + crashRisk*6, …)`
 *    n'apporte rien : le risque réel est plat, autour de 25 %.
 *
 * Graduer une étiquette sur une probabilité plate aurait été de la décoration,
 * et une décoration présentée comme une simulation est un mensonge.
 *
 * CE QUI EST VRAI, ET QUI EST AFFICHÉ
 * -----------------------------------
 *  - 10 des 12 choix risqués programment une suite différée ou tirent au sort :
 *    le risque est dans la SUITE, pas dans un malus immédiat. L'étiquette le dit
 *    désormais.
 *  - ce qui décide vraiment de la casse est la charge accumulée : 8 carrières
 *    sur 12 connaissent une rupture chez un joueur qui s'entraîne sans relâche
 *    (charge finale 71), 0 sur 12 chez un joueur qui se ménage (charge 26).
 *    C'est donc l'état ressenti — un fait que le moteur enregistre et que le
 *    joueur peut réellement sentir — qui est rappelé au moment de trancher.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSession, advanceWeek, resolveDecision, setRoutine } from '../src/engine/simulation.js';
import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import { LOAD_STATES } from '../src/engine/load.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

/** Collecte les événements présentés au joueur sur une carrière. */
function presentes(seed, { routine = null, years = 15 } = {}) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
  const s = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  if (routine) setRoutine(s, routine);
  const moi = s.world.persons[s.career.personId];
  const out = [];
  for (let w = 0; w < years * WEEKS_PER_YEAR && !s.career.retired; w++) {
    const r = advanceWeek(s);
    if (!r.decision || r.decision.resolved) continue;
    out.push({ presente: r.decision, etatReel: moi.load?.state ?? null });
    resolveDecision(s, r.decision.choices[0].id);
  }
  return out;
}

test('l’état affiché est celui que la simulation a enregistré', () => {
  // La règle de l'étape 8A : on relit un fait, on ne le recompose pas.
  let controles = 0;
  for (const seed of ['9i-a', '9i-b']) {
    for (const { presente, etatReel } of presentes(seed)) {
      controles++;
      if (etatReel === LOAD_STATES.FRESH || etatReel == null) {
        assert.equal(presente.charge, null, 'un joueur frais n’a rien à signaler');
      } else {
        assert.ok(presente.charge, `état ${etatReel} non transmis`);
        assert.equal(presente.charge.etat, etatReel);
        assert.ok(presente.charge.label.length > 0);
      }
    }
  }
  assert.ok(controles > 40, `échantillon insuffisant : ${controles}`);
});

test('les états lourds sont ceux où pousser coûte vraiment', () => {
  const lourds = new Set([LOAD_STATES.OVERLOADED, LOAD_STATES.DRAINED, LOAD_STATES.BURNOUT]);
  let vus = 0;
  for (const seed of ['9i-c', '9i-d']) {
    for (const { presente } of presentes(seed, { routine: ['mechanics', 'mechanics', 'scrim', 'review'] })) {
      if (!presente.charge) continue;
      vus++;
      assert.equal(presente.charge.lourde, lourds.has(presente.charge.etat));
    }
  }
  assert.ok(vus > 20, `échantillon insuffisant : ${vus}`);
});

test('un joueur qui se ménage n’est pas alarmé pour rien', () => {
  // Le garde-fou inverse : si l'avertissement s'affichait tout le temps, il ne
  // voudrait plus rien dire.
  const doux = presentes('9i-e', { routine: ['mechanics', 'strategy', 'rest', 'social'] });
  const dur = presentes('9i-f', { routine: ['mechanics', 'mechanics', 'scrim', 'review'] });
  const partLourde = (l) => {
    const n = l.filter((x) => x.presente.charge?.lourde).length;
    return l.length ? n / l.length : 0;
  };
  assert.ok(doux.length > 10 && dur.length > 10, 'assez d’événements des deux côtés');
  assert.ok(
    partLourde(doux) <= partLourde(dur),
    `routine ménagée ${(partLourde(doux) * 100).toFixed(0)} % contre ${(partLourde(dur) * 100).toFixed(0)} % : l’avertissement devrait suivre la charge`,
  );
});

test('un choix risqué reste identifiable', () => {
  let risques = 0;
  let total = 0;
  for (const seed of ['9i-g', '9i-h']) {
    for (const { presente } of presentes(seed)) {
      total++;
      if (presente.choices.some((c) => c.risky)) risques++;
      for (const c of presente.choices) assert.equal(typeof c.risky, 'boolean');
    }
  }
  assert.ok(total > 40);
  // Mesuré : 17 % des décisions proposent une option risquée. On garde une
  // fourchette large — c'est la présence du mécanisme qu'on protège, pas son
  // réglage.
  const part = risques / total;
  assert.ok(part > 0.03 && part < 0.5, `${(part * 100).toFixed(0)} % de décisions avec option risquée`);
});
