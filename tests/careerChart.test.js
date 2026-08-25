/**
 * Tests de la courbe de carrière (étape 9G).
 *
 * CE QUE LA COURBE DOIT GARANTIR
 * ------------------------------
 * Elle affiche une carrière entière d'un coup d'œil : c'est donc le composant
 * qui peut mentir le plus vite et le plus discrètement. La règle est celle de
 * l'étape 8A, apprise à ses dépens sur la charge : **on relit des faits
 * enregistrés, on ne reconstitue rien**. Chaque point vient de
 * `closeSeasonRecord`, écrit au moment où la saison s'est refermée.
 *
 * Le deuxième risque est l'échelle. Une échelle collée aux extrêmes transforme
 * une carrière plate en montagne russe : deux points à 61 et 62 rempliraient
 * toute la hauteur et raconteraient une progression spectaculaire qui n'a pas
 * eu lieu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { careerChartView } from '../src/engine/view.js';
import { runOneCareer } from '../src/engine/audit/runner.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

let cache = null;
/** Des carrières assez longues pour avoir une courbe. */
function carrieres() {
  if (cache) return cache;
  const out = [];
  for (let i = 0; i < 8 && out.length < 5; i++) {
    const r = runOneCareer({ seed: `9g-${i}`, years: 25, policyId: 'grinder', keepSession: true });
    if (r.crash) continue;
    if ((r.session.career.seasons?.length ?? 0) >= 4) out.push(r.session);
  }
  cache = out;
  return out;
}

test('0 — le moteur produit bien des carrières à plusieurs saisons', () => {
  assert.ok(carrieres().length >= 4, `seulement ${carrieres().length} carrières exploitables`);
});

test('une carrière trop courte n’a pas de courbe à montrer', () => {
  const s = carrieres()[0];
  const faux = { world: s.world, career: { ...s.career, seasons: [] } };
  assert.equal(careerChartView(faux), null);
  assert.equal(careerChartView({ world: s.world, career: { ...s.career, seasons: [s.career.seasons[0]] } }), null);
});

test('chaque point est un fait enregistré, pas un calcul', () => {
  for (const s of carrieres()) {
    const v = careerChartView(s);
    assert.ok(v, 'une courbe pour une carrière de plusieurs saisons');
    const saisons = s.career.seasons.filter((x) => x.ratingEnd != null);
    assert.equal(v.points.length, saisons.length);
    for (let i = 0; i < saisons.length; i++) {
      const attendu = saisons[i];
      const point = v.points[i];
      assert.equal(point.annee, attendu.year);
      assert.equal(point.niveau, Math.round(attendu.ratingEnd * 10) / 10);
      assert.equal(point.matchs, attendu.matches ?? 0);
      assert.equal(point.titres, attendu.titles ?? 0);
    }
  }
});

test('un transfert n’est marqué que s’il a eu lieu', () => {
  for (const s of carrieres()) {
    const v = careerChartView(s);
    const saisons = s.career.seasons.filter((x) => x.ratingEnd != null);
    for (let i = 0; i < saisons.length; i++) {
      const b = saisons[i];
      const vraiTransfert = !!(b.orgStart && b.orgEnd && b.orgStart !== b.orgEnd);
      assert.equal(
        !!v.points[i].transfert, vraiTransfert,
        `${b.year} : transfert affiché=${!!v.points[i].transfert}, réel=${vraiTransfert}`,
      );
      if (vraiTransfert) assert.equal(v.points[i].transfert, b.orgEnd);
    }
    assert.equal(v.transferts, v.points.filter((p) => p.transfert).length);
  }
});

test('le pic annoncé est bien la meilleure saison', () => {
  for (const s of carrieres()) {
    const v = careerChartView(s);
    const meilleur = Math.max(...v.points.map((p) => p.niveau));
    assert.equal(v.pic.niveau, meilleur);
    const saison = v.points.find((p) => p.niveau === meilleur);
    assert.equal(v.pic.annee, saison.annee);
  }
});

test('l’échelle contient toujours la courbe', () => {
  for (const s of carrieres()) {
    const v = careerChartView(s);
    for (const p of v.points) {
      assert.ok(p.niveau >= v.bas && p.niveau <= v.haut,
        `niveau ${p.niveau} hors de l'échelle [${v.bas}, ${v.haut}]`);
    }
  }
});

test('une carrière plate ne se dessine pas comme une ascension', () => {
  // Le garde-fou de lisibilité : sans amplitude minimale, deux saisons à 61 et
  // 62 rempliraient toute la hauteur du graphique.
  const s = carrieres()[0];
  const plates = [
    { year: 2030, ratingEnd: 61, ratingStart: 61, matches: 10, titles: 0, orgStart: 'A', orgEnd: 'A' },
    { year: 2031, ratingEnd: 61.5, ratingStart: 61, matches: 10, titles: 0, orgStart: 'A', orgEnd: 'A' },
    { year: 2032, ratingEnd: 62, ratingStart: 61.5, matches: 10, titles: 0, orgStart: 'A', orgEnd: 'A' },
  ];
  const v = careerChartView({ world: s.world, career: { ...s.career, seasons: plates } });
  assert.ok(v.haut - v.bas >= 12, `amplitude ${v.haut - v.bas} : trop serrée, la courbe mentirait`);
  // Et la vraie progression reste une petite fraction de la hauteur.
  assert.ok((62 - 61) / (v.haut - v.bas) < 0.15);
});

test('le total de titres de la courbe est celui des saisons', () => {
  for (const s of carrieres()) {
    const v = careerChartView(s);
    const attendu = s.career.seasons
      .filter((x) => x.ratingEnd != null)
      .reduce((a, x) => a + (x.titles ?? 0), 0);
    assert.equal(v.titresTotal, attendu);
  }
});

test('une carrière tronquée le dit', () => {
  const s = carrieres()[0];
  const trente = Array.from({ length: 30 }, (_, i) => ({
    year: 2030 + i, ratingEnd: 60 + i * 0.4, ratingStart: 60 + i * 0.4,
    matches: 20, titles: 0, orgStart: 'A', orgEnd: 'A',
  }));
  const v = careerChartView({ world: s.world, career: { ...s.career, seasons: trente } });
  assert.equal(v.tronquee, true);
  const court = careerChartView({ world: s.world, career: { ...s.career, seasons: trente.slice(0, 5) } });
  assert.equal(court.tronquee, false);
});

test('deux saisons ne portent jamais le même millésime', () => {
  // Le défaut que la courbe a révélé (étape 9G) : une saison se referme
  // semaine 51, donc chacune sauf la première démarre semaine 51 de l'année
  // civile précédente. Les nommer par leur année de DÉPART les décalait toutes
  // d'un an et donnait le même millésime aux deux premières — mesuré sur 8
  // carrières sur 8. Personne ne l'avait vu tant que les années n'étaient pas
  // affichées côte à côte.
  for (const s of carrieres()) {
    const annees = (s.career.seasons ?? []).map((b) => b.year);
    assert.equal(
      new Set(annees).size, annees.length,
      `millésimes en double : ${annees.join(' ')}`,
    );
  }
});

test('les millésimes se suivent sans trou', () => {
  for (const s of carrieres()) {
    const annees = (s.career.seasons ?? []).map((b) => b.year);
    for (let i = 1; i < annees.length; i++) {
      assert.equal(
        annees[i], annees[i - 1] + 1,
        `saut de ${annees[i - 1]} à ${annees[i]} : ${annees.join(' ')}`,
      );
    }
  }
});

test('une saison porte l’année où elle s’est majoritairement déroulée', () => {
  // Une saison de 52 semaines qui se referme en année N s'est déroulée pour
  // 51 de ses 52 semaines dans l'année N. C'est donc N son millésime.
  const s = carrieres()[0];
  const saisons = s.career.seasons ?? [];
  assert.ok(saisons.length >= 3);
  const pleines = saisons.filter((b) => b.weeks >= 50);
  assert.ok(pleines.length >= 2, 'des saisons pleines pour juger');
  for (let i = 1; i < pleines.length; i++) {
    assert.ok(
      pleines[i].year > pleines[i - 1].year,
      'les saisons pleines avancent d’une année à l’autre',
    );
  }
});
