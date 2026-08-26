/**
 * Tests de la variété des événements (étape 10A).
 *
 * LE DÉFAUT, SIGNALÉ PAR UN JOUEUR
 * --------------------------------
 * « Sur les quelques choix que j'ai eu à faire sur 2 carrières entamées, les
 * situations sont toujours les mêmes dans le même ordre. »
 *
 * Mesuré, c'était exact et la cause était nette : sur 673 tirages, le moteur
 * n'avait qu'UN candidat éligible dans 40 % des cas et trois ou moins dans
 * 98 %. Le gagnant emportait 100 % du poids en médiane — autrement dit il n'y
 * avait pas de tirage, seulement le seul événement disponible. Un événement,
 * `game_switch_offer`, était même éligible dans la MOITIÉ de tous les tirages
 * parce que sa condition était un simple minuteur (« plus de 30 semaines de
 * carrière ») : il tombait semaine 30 dans neuf carrières sur douze.
 *
 * POURQUOI CES TESTS MESURENT L'ÉLIGIBILITÉ ET PAS LES SUITES
 * -----------------------------------------------------------
 * Ma première mesure comparait les SUITES d'événements et concluait « 12 suites
 * distinctes sur 12 » — donc tout va bien. C'était faux : les suites étaient
 * distinctes parce que l'ORDRE changeait, alors que le contenu était le même.
 * Ce qu'il faut mesurer, c'est ce que le moteur avait le choix de tirer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSession, advanceWeek, resolveDecision } from '../src/engine/simulation.js';
import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import { startTrace, stopTrace } from '../src/engine/trace.js';
import { initEvents } from '../src/engine/events/index.js';
import { allEvents } from '../src/engine/events/engine.js';

initEvents({ force: true });

/** Les tirages réellement effectués, lus dans la trace du moteur. */
let cacheTirages = null;
function tirages() {
  if (cacheTirages) return cacheTirages;
  const out = [];
  startTrace({ max: 400000, onRecord: (r) => { if (r.eventId && r.eligible !== undefined) out.push(r); } });
  for (let i = 0; i < 6; i++) {
    const seed = `variete-${i}`;
    const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
    const s = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
    for (let w = 0; w < 12 * WEEKS_PER_YEAR && !s.career.retired; w++) {
      const r = advanceWeek(s);
      if (r.decision && !r.decision.resolved) resolveDecision(s, r.decision.choices[0].id);
    }
  }
  stopTrace();
  cacheTirages = out;
  return out;
}

test('0 — l’échantillon de tirages est exploitable', () => {
  assert.ok(tirages().length > 300, `seulement ${tirages().length} tirages`);
});

test('le moteur a vraiment le choix, la plupart du temps', () => {
  // La propriété centrale. Un seul candidat, ce n'est pas un tirage : c'est
  // une programmation.
  const seuls = tirages().filter((t) => t.eligible <= 1).length;
  const part = seuls / tirages().length;
  assert.ok(
    part < 0.3,
    `${Math.round(part * 100)} % des tirages n'ont qu'un seul candidat (40 % avant l'étape 10A)`,
  );
});

test('le gagnant n’emporte pas tout le poids', () => {
  // Mesuré avant correction : 100 % en médiane, sur toutes les années. Un
  // gagnant qui prend tout le poids est un gagnant désigné d'avance.
  const parts = tirages().map((t) => t.share ?? 0).sort((a, b) => a - b);
  const mediane = parts[Math.floor(parts.length / 2)];
  assert.ok(mediane < 0.8, `le gagnant emporte ${Math.round(mediane * 100)} % du poids en médiane`);
});

test('aucun événement n’occupe à lui seul ce que le joueur voit', () => {
  // MA PREMIÈRE VERSION MESURAIT LA MAUVAISE CHOSE.
  //
  // Elle bornait l'ÉLIGIBILITÉ à 35 %. Or les scènes ordinaires — une séance
  // qui ne donne rien, une nuit trop longue — doivent justement être éligibles
  // très souvent : c'est ce qui donne au moteur de quoi choisir. Ce qui ne doit
  // pas arriver, c'est qu'un événement se DÉCLENCHE tout le temps. Les scènes
  // de fond sont donc largement éligibles et faiblement pesantes, et le test
  // mesure maintenant ce que le joueur voit réellement.
  const joue = new Map();
  for (const t of tirages()) joue.set(t.eventId, (joue.get(t.eventId) ?? 0) + 1);
  const total = tirages().length;
  const domine = [...joue].filter(([, n]) => n / total > 0.15);
  assert.equal(
    domine.length, 0,
    `événement(s) omniprésent(s) à l'écran : ${domine.map(([id, n]) => `${id} ${Math.round(n / total * 100)} %`).join(', ')}`,
  );
});

test('le catalogue tirable est assez fourni pour une carrière', () => {
  // Une carrière de dix-sept ans traverse une centaine d'événements. Les tirer
  // dans un catalogue trop court les fait tous revenir.
  const tirables = allEvents().filter((d) => !d.chainOnly);
  assert.ok(tirables.length >= 50, `seulement ${tirables.length} événements tirables`);
});

test('deux carrières ne traversent pas les mêmes débuts', () => {
  // Le test tel qu'un joueur le vit : il entame deux parties et compare.
  const debuts = [];
  for (let i = 0; i < 10; i++) {
    const seed = `debut-${i}`;
    const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
    const s = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
    const vus = [];
    for (let w = 0; w < 3 * WEEKS_PER_YEAR && vus.length < 6; w++) {
      const r = advanceWeek(s);
      if (!r.decision) continue;
      vus.push(r.decision.id);
      if (!r.decision.resolved) resolveDecision(s, r.decision.choices[0].id);
    }
    if (vus.length === 6) debuts.push(vus);
  }
  assert.ok(debuts.length >= 8, `échantillon insuffisant : ${debuts.length}`);

  // LES DEUX PREMIÈRES DÉCISIONS SONT L'OUVERTURE, PAS LA RÉPÉTITION
  //
  // `first_ladder_grind` raconte les toutes premières heures d'un joueur
  // inconnu. Il est `once: true`, porte un poids délibérément élevé qui décroît
  // chaque semaine, et occupe donc l'une des deux premières décisions dans la
  // moitié des parties. C'est une scène d'ouverture, écrite comme telle bien
  // avant cette étape : exiger qu'elle varie autant que les suivantes
  // reviendrait à interdire au jeu d'avoir un début.
  //
  // Ce que le joueur a signalé, c'est la SUITE identique — « toujours les mêmes
  // dans le même ordre ». C'est elle que ce test protège, à partir de la
  // troisième décision, et strictement : mesuré après correction, 8, 8, 6 et 10
  // événements différents sur dix parties, aucun n'occupant plus de 3 places.
  const OUVERTURE = 2;
  for (let k = 0; k < 6; k++) {
    const ids = debuts.map((d) => d[k]);
    const distincts = new Set(ids).size;
    const minimum = k < OUVERTURE ? 3 : 5;
    assert.ok(
      distincts >= minimum,
      `position ${k + 1} : seulement ${distincts} événements différents (minimum ${minimum})`,
    );
    if (k < OUVERTURE) continue;
    const max = Math.max(...[...new Set(ids)].map((id) => ids.filter((x) => x === id).length));
    assert.ok(
      max <= ids.length * 0.4,
      `position ${k + 1} : un même événement occupe ${max}/${ids.length} des parties`,
    );
  }
});
