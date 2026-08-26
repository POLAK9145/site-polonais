/**
 * Tests des départs prédéfinis, du défi du jour et du rejeu (§37/§38/§39,
 * étape 9N).
 *
 * CE QU'UN SCÉNARIO DOIT ÊTRE
 * ---------------------------
 * Une situation de départ, pas une histoire écrite d'avance. Sa promesse — le
 * champ `defi` — doit correspondre à une contrainte réelle du moteur : densité
 * de talent, infrastructure, âge, argent, difficulté. Sinon c'est une étiquette
 * sur une porte qui donne sur la même pièce.
 *
 * Ces tests vérifient donc que les scénarios sont VALIDES (le moteur les
 * accepte et produit des mondes jouables) et qu'ils sont RÉELLEMENT
 * DIFFÉRENTS — pas sept variantes du même départ.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SCENARIOS, SCENARIOS_BY_ID, dailySeed, dailyScenario } from '../src/data/scenarios.js';
import { ORIGINS_BY_ID, FAMILY_PROFILES } from '../src/data/origins.js';
import { REGIONS_BY_ID } from '../src/data/regions.js';
import { GAMES_BY_ID } from '../src/data/games.js';
import { DIFFICULTIES } from '../src/engine/career.js';
import { createSession, advanceWeek } from '../src/engine/simulation.js';
import { weightedCeiling } from '../src/engine/person.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

/** Traduit un scénario en configuration de joueur, comme le fait l'écran. */
function config(sc) {
  const o = ORIGINS_BY_ID[sc.originId];
  return {
    firstName: 'Test', lastName: 'Scenario', nick: `sc_${sc.id}`,
    regionId: sc.regionId, gameId: sc.gameId, age: sc.age, baseLevel: 44,
    attrBias: o.attrBias, potentialBias: o.potentialBias,
    familiarity: o.familiarity, money: o.money,
    startFollowers: o.startFollowers ?? 0,
    originId: sc.originId, familyId: sc.familyId,
  };
}

test('chaque scénario ne référence que des données existantes', () => {
  const familles = new Set(FAMILY_PROFILES.map((f) => f.id));
  for (const sc of SCENARIOS) {
    assert.ok(ORIGINS_BY_ID[sc.originId], `${sc.id} : origine ${sc.originId} inconnue`);
    assert.ok(REGIONS_BY_ID[sc.regionId], `${sc.id} : région ${sc.regionId} inconnue`);
    assert.ok(GAMES_BY_ID[sc.gameId], `${sc.id} : jeu ${sc.gameId} inconnu`);
    assert.ok(familles.has(sc.familyId), `${sc.id} : famille ${sc.familyId} inconnue`);
    assert.ok(DIFFICULTIES[sc.difficulty], `${sc.id} : difficulté ${sc.difficulty} inconnue`);
    assert.ok(sc.label && sc.desc && sc.defi, `${sc.id} : incomplet`);
  }
});

test('l’âge de départ respecte les bornes de l’origine', () => {
  // Un scénario qui proposerait un âge hors bornes serait corrigé en silence
  // par l'écran, et sa promesse deviendrait fausse.
  for (const sc of SCENARIOS) {
    const [min, max] = ORIGINS_BY_ID[sc.originId].startAge;
    assert.ok(
      sc.age >= min && sc.age <= max,
      `${sc.id} : ${sc.age} ans hors des bornes [${min}, ${max}] de ${sc.originId}`,
    );
  }
});

test('chaque scénario produit un monde jouable', () => {
  for (const sc of SCENARIOS) {
    const s = createSession({
      seed: `sc-${sc.id}`, startYear: 2030, difficulty: sc.difficulty, player: config(sc),
    });
    const moi = s.world.persons[s.career.personId];
    assert.ok(moi, `${sc.id} : pas de joueur`);
    assert.equal(moi.gameId, sc.gameId);
    assert.equal(moi.regionId, sc.regionId);
    assert.ok(weightedCeiling(moi, GAMES_BY_ID[sc.gameId]) > 0);
    for (let w = 0; w < 26; w++) advanceWeek(s);
    assert.ok(s.world.week > s.career.startWeek, `${sc.id} : la simulation n'avance pas`);
  }
});

test('les scénarios sont réellement différents les uns des autres', () => {
  // Sept étiquettes sur le même départ ne seraient pas sept scénarios.
  const empreintes = SCENARIOS.map(
    (sc) => `${sc.regionId}|${sc.gameId}|${sc.originId}|${sc.familyId}|${sc.age}|${sc.difficulty}`,
  );
  assert.equal(new Set(empreintes).size, empreintes.length, 'deux scénarios identiques');
  // Et ils couvrent plusieurs régions, plusieurs origines, plusieurs jeux.
  assert.ok(new Set(SCENARIOS.map((s) => s.regionId)).size >= 4);
  assert.ok(new Set(SCENARIOS.map((s) => s.originId)).size >= 5);
  assert.ok(new Set(SCENARIOS.map((s) => s.gameId)).size >= 2);
});

test('le départ tardif tient sa promesse : moins de marge', () => {
  // La promesse du scénario doit se lire dans les chiffres, pas dans son titre.
  const potentiel = (id) => {
    const sc = SCENARIOS_BY_ID[id];
    const s = createSession({
      seed: 'promesse', startYear: 2030, difficulty: sc.difficulty, player: config(sc),
    });
    const moi = s.world.persons[s.career.personId];
    return weightedCeiling(moi, GAMES_BY_ID[sc.gameId]);
  };
  assert.ok(
    potentiel('tardif') < potentiel('classique'),
    'un départ à 23 ans devrait laisser moins de marge qu’un départ à 17',
  );
});

test('le défi du jour est le même toute la journée, et change le lendemain', () => {
  const a = dailySeed(new Date('2026-08-25T01:00:00Z'));
  const b = dailySeed(new Date('2026-08-25T23:59:00Z'));
  const c = dailySeed(new Date('2026-08-26T00:01:00Z'));
  assert.equal(a, b, 'la graine doit tenir toute la journée');
  assert.notEqual(a, c, 'elle doit changer le lendemain');
});

test('le défi du jour est un scénario valide, tiré sans hasard', () => {
  const d1 = dailyScenario(new Date('2026-08-25T00:00:00Z'));
  const d2 = dailyScenario(new Date('2026-08-25T12:00:00Z'));
  assert.deepEqual(d1, d2, 'deux appels le même jour doivent donner le même défi');
  assert.ok(SCENARIOS_BY_ID[d1.id], 'le défi doit être un des scénarios');
  assert.equal(d1.seed, dailySeed(new Date('2026-08-25T00:00:00Z')));
  assert.ok(d1.dateLabel?.length > 0);
});

test('le défi ne se fige pas sur un seul scénario', () => {
  // Une dérivation mal faite pourrait rendre le même scénario tous les jours.
  const vus = new Set();
  for (let j = 1; j <= 30; j++) {
    const d = new Date(Date.UTC(2026, 0, j));
    vus.add(dailyScenario(d).id);
  }
  assert.ok(vus.size >= 4, `seulement ${vus.size} scénarios différents sur 30 jours`);
});

test('rejouer une graine régénère exactement le même monde', () => {
  // C'est ce qui rend le « et si » honnête : le monde est identique, seules
  // les décisions changent.
  const sc = SCENARIOS_BY_ID.classique;
  const empreinte = () => {
    const s = createSession({ seed: 'rejeu-9n', startYear: 2030, difficulty: sc.difficulty, player: config(sc) });
    const orgs = Object.values(s.world.orgs).map((o) => `${o.name}:${o.tier}`).sort().join('|');
    const equipes = Object.values(s.world.teams).length;
    return `${orgs}#${equipes}#${Object.keys(s.world.persons).length}`;
  };
  assert.equal(empreinte(), empreinte());
});
