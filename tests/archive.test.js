/**
 * Tests du musée des carrières terminées (§52, étape 9K).
 *
 * CE QUE ÇA RÉPARE
 * ----------------
 * Une carrière se terminait et disparaissait. Le jeu perdait exactement ce qui
 * fait l'intérêt d'un simulateur rejouable : pouvoir dire « celle-là était
 * différente, et voilà en quoi ».
 *
 * LES DEUX RISQUES
 * ----------------
 * 1. La fiche doit être prise pendant que le monde qui l'a produite existe
 *    encore. Recalculée plus tard, sans ce monde, elle donnerait des chiffres
 *    que le joueur n'a jamais vus — la leçon de l'étape 8A appliquée au
 *    stockage.
 * 2. Une comparaison désigne un vainqueur ligne par ligne. Sur une grandeur qui
 *    ne se classe pas — le nombre de structures traversées — désigner un
 *    vainqueur inventerait un jugement que le jeu ne porte pas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { careerRecord, compareCareers, VERSION_FICHE } from '../src/engine/archive.js';
import { computeLegacy, careerStats } from '../src/engine/legacy.js';
import { runOneCareer } from '../src/engine/audit/runner.js';
import { retireCareer } from '../src/engine/simulation.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

let cache = null;
/** Des carrières menées à leur terme, avec leur session encore vivante. */
function terminees() {
  if (cache) return cache;
  const out = [];
  for (let i = 0; i < 8 && out.length < 4; i++) {
    const r = runOneCareer({ seed: `9k-${i}`, years: 30, policyId: i % 2 ? 'lucide' : 'grinder', keepSession: true });
    if (r.crash) continue;
    if (!r.session.career.retired) retireCareer(r.session, 'décision personnelle');
    out.push(r.session);
  }
  cache = out;
  return out;
}

test('0 — le moteur produit bien des carrières terminées', () => {
  assert.equal(terminees().length, 4);
});

test('la fiche reprend les chiffres du bilan, sans les recalculer', () => {
  for (const s of terminees()) {
    const f = careerRecord(s);
    const legacy = computeLegacy(s.world, s.career);
    const stats = careerStats(s.world, s.career);

    assert.equal(f.version, VERSION_FICHE);
    assert.equal(f.global, legacy.global);
    assert.equal(f.annees, legacy.careerYears);
    assert.equal(f.archetype, legacy.archetype.label);
    assert.equal(f.matchs, stats.matches);
    assert.equal(f.titres, stats.titles);
    assert.equal(f.picNiveau, stats.peakRating);
    assert.equal(f.gains, Math.round(stats.earnings));
    for (const [cle, v] of Object.entries(legacy.dimensions)) {
      assert.equal(f.dimensions[cle], v, `dimension ${cle}`);
    }
  }
});

test('la fiche se suffit à elle-même', () => {
  // Elle sera relue sans le monde : aucune valeur ne doit être une référence
  // vers un objet de la simulation.
  for (const s of terminees()) {
    const f = careerRecord(s);
    const relue = JSON.parse(JSON.stringify(f));
    assert.deepEqual(relue, f, 'la fiche doit survivre à un aller-retour JSON');
    assert.ok(f.id && f.seed && f.nick);
    assert.ok(Array.isArray(f.courbe));
    assert.ok(Array.isArray(f.jeux));
  }
});

test('deux carrières de la même graine restent distinctes', () => {
  // L'identité est la graine ET la personne : deux parcours d'un même monde ne
  // sont pas la même carrière, les décisions les séparent.
  const [a, b] = terminees();
  assert.notEqual(careerRecord(a).id, careerRecord(b).id);
});

test('la comparaison désigne le bon vainqueur, ligne par ligne', () => {
  const [a, b] = terminees().map(careerRecord);
  const c = compareCareers(a, b);
  assert.ok(c);
  for (const l of c.axes) {
    if (l.meilleur === null) continue;
    const gagnant = l.meilleur === 'a' ? l.a : l.b;
    const perdant = l.meilleur === 'a' ? l.b : l.a;
    assert.ok(gagnant > perdant, `${l.label} : ${gagnant} désigné meilleur que ${perdant}`);
  }
});

test('une grandeur qui ne se classe pas n’a pas de vainqueur', () => {
  // Jouer pour six structures n'est ni mieux ni moins bien que d'être resté
  // dans la même.
  const [a, b] = terminees().map(careerRecord);
  const c = compareCareers({ ...a, structures: 6 }, { ...b, structures: 1 });
  const ligne = c.axes.find((l) => l.cle === 'structures');
  assert.ok(ligne, 'la ligne des structures existe');
  assert.equal(ligne.meilleur, null, 'aucun vainqueur ne doit être désigné');
  assert.equal(ligne.a, 6);
  assert.equal(ligne.b, 1);
});

test('une égalité ne désigne personne', () => {
  const [a] = terminees().map(careerRecord);
  const c = compareCareers(a, { ...a, id: 'autre' });
  for (const l of c.axes) {
    assert.equal(l.meilleur, null, `${l.label} : vainqueur désigné sur une égalité`);
    assert.equal(l.ecart, 0);
  }
  assert.equal(c.resume.length, 0, 'rien ne sépare deux carrières identiques');
});

test('le résumé ne retient que ce qui sépare vraiment', () => {
  const [a, b] = terminees().map(careerRecord);
  const c = compareCareers(a, b);
  assert.ok(c.resume.length <= 3, 'onze lignes d’écart ne racontent rien, trois si');
  for (const d of c.resume) {
    assert.ok(Math.abs(d.ecart) >= 8, `écart de ${d.ecart} retenu comme significatif`);
  }
  // Et il est trié du plus séparant au moins séparant.
  for (let i = 1; i < c.resume.length; i++) {
    assert.ok(Math.abs(c.resume[i - 1].ecart) >= Math.abs(c.resume[i].ecart));
  }
});

test('comparer une carrière à elle-même ou à rien ne casse pas', () => {
  const [a] = terminees().map(careerRecord);
  assert.equal(compareCareers(a, null), null);
  assert.equal(compareCareers(null, a), null);
});

test('deux carrières homonymes restent distinguables', () => {
  // Vu en jouant : deux mondes différents avaient produit le même pseudo, et
  // le résumé annonçait « +47 pour Cinderie, +45 pour Cinderie ». Une
  // comparaison qui ne distingue pas ses deux termes ne compare rien.
  const [a, b] = terminees().map(careerRecord);
  const homonyme = { ...b, nick: a.nick, debut: a.debut + 5, finAnnee: a.finAnnee + 5 };
  const c = compareCareers(a, homonyme);
  assert.equal(c.memeNom, true);
  assert.notEqual(c.a.etiquette, c.b.etiquette, 'les deux étiquettes doivent différer');
  assert.ok(c.a.etiquette.includes(String(a.debut)), 'la période désambiguïse');

  // Et quand les noms diffèrent, on ne surcharge pas l'affichage.
  const distinct = compareCareers(a, { ...b, nick: 'AutreNom' });
  assert.equal(distinct.memeNom, false);
  assert.equal(distinct.a.etiquette, a.nick);
});
