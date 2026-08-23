/**
 * Tests de la fiche de fin de carrière (étape 8B).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * La fiche est le point d'arrivée : c'est là qu'une carrière de vingt ans prend
 * un sens. Mesuré sur 18 carrières de 25 ans, elle affichait une timeline de
 * 167 entrées en médiane et jusqu'à 489, dont 57,5 % de simples résultats de
 * match, et jusqu'à 82 « moments marquants » — dont des doublons mot pour mot.
 * La page faisait 16 770 pixels de haut et le titre gagné y pesait autant,
 * visuellement, que le 312ᵉ match de poule.
 *
 * LE RISQUE QUE CES TESTS COUVRENT
 * -------------------------------
 * Résumer, c'est choisir — et choisir mal, c'est effacer. Ces tests vérifient
 * que le résumé ne perd RIEN : tout ce qui est important reste affiché, les
 * chiffres du résumé sont ceux des matchs réellement joués, et aucun souvenir
 * ne disparaît (les doublons sont regroupés, pas supprimés).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runOneCareer } from '../src/engine/audit/runner.js';
import { timelineView, memoriesView } from '../src/engine/view.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

/**
 * Trois carrières longues et disputées : c'est là que le résumé se juge.
 *
 * Les couples graine/politique ne sont pas pris au hasard. Un premier jet
 * utilisait trois graines quelconques et mesurait 11 matchs journalisés : le
 * test passait ou échouait selon la carrière tirée, pas selon le code. Ceux-ci
 * ont été choisis parce qu'ils produisent 30 à 300 matchs, et le test 0
 * vérifie que cette prémisse tient toujours — si un jour elle tombe, c'est ce
 * test-là qui doit crier, pas les autres.
 */
const CARRIERES = [
  { seed: '8b-t1', policyId: 'entertainer' },
  { seed: '8b-t4', policyId: 'grinder' },
  { seed: '8b-t8', policyId: 'grinder' },
];

function carriere(seed, policyId = 'grinder', years = 25) {
  const r = runOneCareer({ seed, years, policyId, keepSession: true });
  assert.ok(!r.crash, `plantage : ${r.crash?.message}`);
  return r.session;
}

test('0 — les carrières de test sont bien assez longues pour qu’il y ait à résumer', () => {
  for (const c of CARRIERES) {
    const session = carriere(c.seed, c.policyId);
    const t = session.career.timeline;
    const matchs = t.filter((e) => e.kind === 'match').length;
    assert.ok(
      matchs >= 25,
      `${c.seed}/${c.policyId} : ${matchs} matchs seulement — les tests suivants ne prouveraient rien`,
    );
    assert.ok(t.length >= 100, `${c.seed}/${c.policyId} : timeline de ${t.length} entrées`);
  }
});

test('1 — le résumé ne perd rien de ce qui compte', () => {
  for (const { seed, policyId } of CARRIERES) {
    const session = carriere(seed, policyId);
    const complet = timelineView(session, { mode: 'complet' });
    const fiche = timelineView(session, { mode: 'fiche' });

    // Mêmes années, dans le même ordre.
    assert.deepEqual(fiche.map((y) => y.year), complet.map((y) => y.year), seed);

    // Tout ce qui n'est pas un match sans enjeu est conservé, texte pour texte.
    const attendu = complet.flatMap((y) =>
      y.entries.filter((e) => e.kind !== 'match' || e.important).map((e) => e.text),
    );
    const obtenu = fiche.flatMap((y) => y.entries.map((e) => e.text));
    assert.deepEqual(obtenu, attendu, `${seed} : le résumé a modifié ce qu'il conserve`);
  }
});

test('2 — le résumé de saison compte les matchs réellement joués', () => {
  for (const { seed, policyId } of CARRIERES) {
    const session = carriere(seed, policyId);
    const fiche = timelineView(session, { mode: 'fiche' });

    for (const annee of fiche) {
      // On recompte à la source, sur la timeline brute.
      const matchs = session.career.timeline.filter((e) => e.kind === 'match' && e.year === annee.year);
      if (matchs.length === 0) {
        assert.equal(annee.resume, null, `${seed} ${annee.year} : un résumé sans aucun match`);
        continue;
      }
      assert.ok(annee.resume, `${seed} ${annee.year} : ${matchs.length} matchs sans résumé`);
      assert.equal(annee.resume.matchs, matchs.length, `${seed} ${annee.year}`);
      assert.equal(
        annee.resume.victoires,
        matchs.filter((e) => e.data?.won).length,
        `${seed} ${annee.year} : victoires annoncées ≠ victoires réelles`,
      );
      assert.ok(
        annee.resume.taux >= 0 && annee.resume.taux <= 100,
        `${seed} ${annee.year} : taux hors bornes (${annee.resume.taux})`,
      );
    }
  }
});

test("3 — l'issue d'un match est une donnée, pas une phrase à relire", () => {
  // Sans cette donnée, le résumé devrait deviner le résultat en relisant le
  // texte — ce qui casserait à la première reformulation.
  const session = carriere('8b-t1', 'entertainer');
  const matchs = session.career.timeline.filter((e) => e.kind === 'match');
  assert.ok(matchs.length > 20, `trop peu de matchs journalisés (${matchs.length})`);
  for (const m of matchs) {
    assert.equal(typeof m.data?.won, 'boolean', `match sans issue enregistrée : ${m.text}`);
    // Et l'issue enregistrée doit correspondre à ce que le texte annonce.
    const texteDitVictoire = m.text.startsWith('Victoire');
    assert.equal(m.data.won, texteDitVictoire, `donnée et texte se contredisent : ${m.text}`);
  }
});

test('4 — aucun moment marquant ne disparaît, les doublons sont regroupés', () => {
  for (const { seed, policyId } of CARRIERES) {
    const session = carriere(seed, policyId);
    const vue = memoriesView(session);
    const total = session.career.memories.length;

    const somme = vue.reduce((a, m) => a + m.occurrences, 0);
    assert.equal(somme, total, `${seed} : ${total} souvenirs en entrée, ${somme} comptés en sortie`);

    for (const m of vue) {
      assert.equal(m.annees.length, m.occurrences, `${seed} : années et occurrences désaccordées`);
      assert.equal(m.year, m.annees[0], `${seed} : l'année principale n'est pas la première`);
    }

    // Et plus aucun doublon strict dans la liste rendue.
    const cles = vue.map((m) => `${m.kind}|${m.title}|${m.text}`);
    assert.equal(new Set(cles).size, cles.length, `${seed} : doublons encore présents`);
  }
});

test('5 — les moments les plus lourds arrivent en tête', () => {
  // La fiche n'affiche que les premiers : si l'ordre est mauvais, un titre
  // gagné peut se retrouver derrière une signature de sponsor.
  const POIDS = { title: 5, crisis: 5, comeback: 4, rivalry: 4, betrayal: 4, duo: 3, transfer: 2, media: 1 };
  for (const { seed, policyId } of CARRIERES) {
    const vue = memoriesView(carriere(seed, policyId));
    let precedent = Infinity;
    for (const m of vue) {
      const poids = POIDS[m.kind] ?? 2;
      assert.ok(poids <= precedent, `${seed} : ${m.kind} (${poids}) après un poids ${precedent}`);
      precedent = poids;
    }
  }
});

test('6 — la fiche est franchement plus courte que le journal', () => {
  // La propriété qui a motivé l'étape. On la mesure en nombre de lignes
  // affichées, ce qui est ce que le joueur subit.
  const rapports = [];
  for (const { seed, policyId } of CARRIERES) {
    const session = carriere(seed, policyId);
    const lignes = (mode) =>
      timelineView(session, { mode }).reduce((a, y) => a + y.entries.length, 0);
    const complet = lignes('complet');
    const fiche = lignes('fiche');
    rapports.push({ seed, policyId, complet, fiche });
    assert.ok(fiche <= complet, `${seed} : la fiche est plus longue que le journal`);
  }
  const total = rapports.reduce((a, r) => a + r.complet, 0);
  const resume = rapports.reduce((a, r) => a + r.fiche, 0);
  assert.ok(
    resume < total * 0.6,
    `le résumé ne réduit presque rien : ${resume}/${total} lignes — ${JSON.stringify(rapports)}`,
  );
});
