/**
 * Tests de l'écosystème d'après-carrière (étape 8D).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * L'après-carrière n'existait qu'à moitié. `retirePerson` faisait bien passer
 * une partie des joueurs en STAFF — mesuré, 113 reconversions sur 642 retraites
 * en douze ans — mais aucune équipe ne recrutait jamais de coach. Ces
 * reconversions restaient sans poste et la pression démographique les effaçait
 * dans l'année : le monde fabriquait des entraîneurs et les jetait aussitôt.
 *
 * Et les entraîneurs ne partaient jamais : `runRetirements` écarte le STAFF.
 * Après quarante ans, âge médian des coachs en poste 72 ans, maximum 84, et 56
 * des 89 postes encore tenus par ceux créés à la génération du monde.
 *
 * Conséquence : la part d'équipes de jeux collectifs ayant un entraîneur
 * tombait de 100 % à 68 % en quarante ans. Ce n'est pas cosmétique — la qualité
 * du coaching nourrit la progression de tout le monde, joueur compris.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { createSession, advanceWorldOnly } from '../src/engine/simulation.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { STATUS, age as personAge } from '../src/engine/person.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import { GAMES_BY_ID } from '../src/data/games.js';
import { runCoachMarket, runCoachRetirements } from '../src/engine/worldSim.js';
import { coachQuality, coachQualityOfPerson } from '../src/engine/team.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

/** Un monde sans joueur, laissé tourner : c'est le sujet du test. */
function monde(seed, years) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  for (let w = 0; w < years * WEEKS_PER_YEAR; w++) advanceWorldOnly(session);
  return session.world;
}

/** Les équipes qui ont réellement besoin d'un entraîneur : les jeux collectifs. */
function equipesCollectives(world) {
  return Object.values(world.teams).filter(
    (t) => t.active && !t.isSelfTeam && (GAMES_BY_ID[t.gameId]?.teamSize ?? 1) > 1,
  );
}

test("1 — l'encadrement ne s'assèche pas avec le temps", () => {
  for (const seed of ['8d-a', '8d-b']) {
    const world = monde(seed, 40);
    const equipes = equipesCollectives(world);
    const avecCoach = equipes.filter((t) => t.coachId && world.persons[t.coachId]);
    const part = avecCoach.length / Math.max(1, equipes.length);
    assert.ok(
      part >= 0.85,
      `${seed} : ${Math.round(part * 100)} % d'équipes encadrées après 40 ans ` +
        `(${avecCoach.length}/${equipes.length}) — c'était 68 % avant le marché des coachs`,
    );
  }
});

test('2 — les entraîneurs sont des gens crédibles, pas des immortels', () => {
  const world = monde('8d-a', 40);
  const coachs = equipesCollectives(world)
    .map((t) => world.persons[t.coachId])
    .filter(Boolean);
  assert.ok(coachs.length > 30, `prémisse : seulement ${coachs.length} entraîneurs en poste`);

  const ages = coachs.map((c) => personAge(c, world.week)).sort((a, b) => a - b);
  const median = ages[Math.floor(ages.length / 2)];
  assert.ok(median < 55, `âge médian ${Math.round(median)} ans`);
  assert.ok(
    ages[ages.length - 1] < 70,
    `un entraîneur de ${Math.round(ages[ages.length - 1])} ans est encore en poste`,
  );
});

test('3 — un entraîneur encadre la scène qu’il connaît', () => {
  const world = monde('8d-b', 30);
  const mauvais = equipesCollectives(world).filter((t) => {
    const c = world.persons[t.coachId];
    return c && c.gameId !== t.gameId;
  });
  assert.equal(mauvais.length, 0, `${mauvais.length} entraîneurs sur une scène qui n'est pas la leur`);
});

test('4 — le marché ne prend jamais un poste déjà occupé', () => {
  const player = randomPlayerConfig(new RNG(normalizeSeed('8d-c:config')));
  const session = createSession({ seed: '8d-c', startYear: 2030, difficulty: 'standard', player });
  const world = session.world;
  const rng = new RNG(normalizeSeed('8d-c:market'));

  // On fabrique un vivier : quelques retraités reconvertis, sans poste.
  const candidats = Object.values(world.persons)
    .filter((p) => p.status !== STATUS.STAFF && p.status !== STATUS.RETIRED)
    .slice(0, 8);
  for (const c of candidats) {
    c.status = STATUS.STAFF;
    c.role = 'coach';
    c.teamId = null;
  }
  const avant = new Map(equipesCollectives(world).map((t) => [t.id, t.coachId]));
  runCoachMarket(world, rng);

  // Aucun poste occupé n'a changé de main.
  for (const [id, coachId] of avant) {
    if (!coachId) continue;
    assert.equal(world.teams[id].coachId, coachId, `le poste de ${id} a été repris`);
  }
  // Et personne n'occupe deux postes.
  const occupes = equipesCollectives(world).map((t) => t.coachId).filter(Boolean);
  assert.equal(new Set(occupes).size, occupes.length, 'un entraîneur occupe deux équipes');
});

test('5 — le départ d’un entraîneur libère vraiment son poste', () => {
  const player = randomPlayerConfig(new RNG(normalizeSeed('8d-d:config')));
  const session = createSession({ seed: '8d-d', startYear: 2030, difficulty: 'standard', player });
  const world = session.world;

  // On vieillit tout le monde pour rendre le départ certain, plutôt que
  // d'attendre le hasard : le test porte sur la conséquence, pas sur le tirage.
  const enPoste = equipesCollectives(world).filter((t) => t.coachId);
  assert.ok(enPoste.length > 0, 'prémisse : aucun entraîneur en poste');
  for (const t of enPoste) {
    const c = world.persons[t.coachId];
    if (c) c.birthWeek = world.week - 70 * WEEKS_PER_YEAR;
  }
  const partis = runCoachRetirements(world, new RNG(normalizeSeed('8d-d:retire')));
  assert.ok(partis.length > 0, 'aucun entraîneur de 70 ans n’a raccroché');

  for (const id of partis) {
    assert.equal(world.persons[id].status, STATUS.RETIRED);
    const encore = Object.values(world.teams).filter((t) => t.coachId === id);
    assert.equal(encore.length, 0, `un entraîneur retraité tient encore ${encore.length} poste(s)`);
  }
});

test('6 — une seule formule décide de ce que vaut un entraîneur', () => {
  // Il en existait trois copies mot pour mot. Trois copies, c'est trois
  // occasions qu'elles divergent — et un monde où l'on recruterait sur un
  // critère que la progression n'utilise pas.
  const world = monde('8d-a', 5);
  const equipe = equipesCollectives(world).find((t) => t.coachId && world.persons[t.coachId]);
  assert.ok(equipe, 'prémisse : aucune équipe encadrée');
  assert.equal(
    coachQuality(world, equipe),
    coachQualityOfPerson(world.persons[equipe.coachId]),
    'les deux entrées de la formule ne donnent pas le même résultat',
  );
  assert.equal(coachQuality(world, { coachId: null }), 0);
  assert.equal(coachQualityOfPerson(null), 0);
});

test('7 — les entraîneurs viennent des joueurs qui ont arrêté', () => {
  // C'est le point du cahier des charges : un PNJ doit pouvoir se reconvertir
  // et rester dans l'écosystème. Avant, les reconversions étaient effacées
  // faute de poste, et les seuls entraîneurs du monde étaient ceux de sa
  // génération initiale.
  const world = monde('8d-a', 40);
  const coachs = equipesCollectives(world)
    .map((t) => world.persons[t.coachId])
    .filter(Boolean);
  const anciens = coachs.filter((c) => c.retirementReason === 'reconversion');
  assert.ok(
    anciens.length / coachs.length > 0.5,
    `seulement ${anciens.length}/${coachs.length} entraîneurs sont d'anciens joueurs`,
  );
});
