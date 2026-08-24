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
 * Elles sont CHOISIES SUR MESURE, pas nommées à l'avance. Deux versions
 * précédentes fixaient des couples graine/politique repérés à la main ; à la
 * première modification du moteur — le marché des coachs, qui déplace le flux
 * aléatoire du monde — la graine « 8b-t1 » est passée de 304 matchs à 6, et
 * trois tests ont échoué sans qu'aucun défaut n'existe.
 *
 * On cherche donc des carrières par leurs PROPRIÉTÉS. Le test ne peut alors
 * échouer que pour une vraie raison : soit le résumé fonctionne mal, soit le
 * moteur ne produit plus du tout de carrières longues — ce qui serait aussi
 * une information, et c'est le test 0 qui la donnerait.
 */
const MATCHS_MINIMUM = 25;
const CARRIERES_VOULUES = 3;

let cacheCarrieres = null;

function carrieresLongues() {
  if (cacheCarrieres) return cacheCarrieres;
  const trouvees = [];
  const politiques = ['entertainer', 'grinder', 'random'];
  for (let i = 1; i <= 10 && trouvees.length < CARRIERES_VOULUES; i++) {
    for (const policyId of politiques) {
      if (trouvees.length >= CARRIERES_VOULUES) break;
      const seed = `8b-t${i}`;
      const r = runOneCareer({ seed, years: 25, policyId, keepSession: true });
      if (r.crash) continue;
      const matchs = r.session.career.timeline.filter((e) => e.kind === 'match').length;
      if (matchs >= MATCHS_MINIMUM && r.session.career.timeline.length >= 100) {
        trouvees.push({ seed, policyId, session: r.session, matchs });
      }
    }
  }
  cacheCarrieres = trouvees;
  return trouvees;
}

function carriere(entree) {
  return entree.session;
}

test('0 — le moteur produit bien des carrières longues à résumer', () => {
  const trouvees = carrieresLongues();
  assert.equal(
    trouvees.length, CARRIERES_VOULUES,
    `seulement ${trouvees.length} carrières d'au moins ${MATCHS_MINIMUM} matchs sur dix graines × trois ` +
      `politiques — les tests suivants ne prouveraient rien, et c'est le moteur qu'il faut regarder`,
  );
});

test('1 — le résumé ne perd rien de ce qui compte', () => {
  for (const entree of carrieresLongues()) {
    const { seed } = entree;
    const session = carriere(entree);
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
  for (const entree of carrieresLongues()) {
    const { seed } = entree;
    const session = carriere(entree);
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
  const session = carriere(carrieresLongues()[0]);
  const matchs = session.career.timeline.filter((e) => e.kind === 'match');
  assert.ok(matchs.length >= MATCHS_MINIMUM, `trop peu de matchs journalisés (${matchs.length})`);
  for (const m of matchs) {
    assert.equal(typeof m.data?.won, 'boolean', `match sans issue enregistrée : ${m.text}`);
    // Et l'issue enregistrée doit correspondre à ce que le texte annonce.
    const texteDitVictoire = m.text.startsWith('Victoire');
    assert.equal(m.data.won, texteDitVictoire, `donnée et texte se contredisent : ${m.text}`);
  }
});

test('4 — aucun moment marquant ne disparaît, les doublons sont regroupés', () => {
  for (const entree of carrieresLongues()) {
    const { seed } = entree;
    const session = carriere(entree);
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
  for (const entree of carrieresLongues()) {
    const { seed } = entree;
    const vue = memoriesView(carriere(entree));
    let precedent = Infinity;
    for (const m of vue) {
      const poids = POIDS[m.kind] ?? 2;
      assert.ok(poids <= precedent, `${seed} : ${m.kind} (${poids}) après un poids ${precedent}`);
      precedent = poids;
    }
  }
});

test('6 — la fiche retire les matchs sans enjeu, et rien d’autre', () => {
  // La propriété qui a motivé l'étape : la page de bilan faisait 16 770 pixels
  // parce qu'elle déroulait tout. Mais « plus courte » n'est pas une propriété
  // vérifiable en soi — une carrière dont la timeline est faite de contrats et
  // de revers ne PEUT pas être beaucoup raccourcie, et c'est correct.
  //
  // Une première version comparait un ratio global à 0,6 : elle est tombée dès
  // que la composition des carrières a changé, sans qu'aucun défaut n'existe.
  // On vérifie donc le mécanisme exactement, plutôt qu'un seuil.
  const rapports = [];
  for (const entree of carrieresLongues()) {
    const { seed, policyId } = entree;
    const session = carriere(entree);
    const lignes = (mode) =>
      timelineView(session, { mode }).reduce((a, y) => a + y.entries.length, 0);
    const complet = lignes('complet');
    const fiche = lignes('fiche');
    const matchsSansEnjeu = session.career.timeline.filter(
      (e) => e.kind === 'match' && !e.important,
    ).length;

    assert.equal(
      fiche, complet - matchsSansEnjeu,
      `${seed}/${policyId} : la fiche a retiré autre chose que des matchs sans enjeu`,
    );
    rapports.push({ seed, policyId, complet, fiche, matchsSansEnjeu });
  }

  // Et le mécanisme doit servir à quelque chose : au moins une des carrières
  // longues retenues doit voir sa fiche nettement allégée, sinon c'est que le
  // moteur ne journalise plus les matchs et que le résumé est devenu inutile.
  const meilleure = Math.max(...rapports.map((r) => r.matchsSansEnjeu / Math.max(1, r.complet)));
  assert.ok(
    meilleure >= 0.4,
    `aucune carrière n'est allégée de plus de ${Math.round(meilleure * 100)} % — ${JSON.stringify(rapports)}`,
  );
});
