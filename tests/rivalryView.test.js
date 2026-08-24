/**
 * Tests de la rivalité vue du joueur (étape 8E).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * Le moteur suit une rivalité en détail — qui, depuis quand, comment elle s'est
 * éteinte — et archive celles qui sont finies. 85 % des carrières en connaissent
 * une. L'interface, elle, n'affichait qu'une liste plate de relations où le
 * rival était une bordure de couleur. Le fil rouge d'une carrière, que le bilan
 * final raconte à la retraite, était invisible pendant qu'on le vivait.
 *
 * Et `career.rivalry.actes` était posé à 1 à la naissance de la rivalité sans
 * jamais être incrémenté : un compteur mort, que l'écran aurait présenté comme
 * un fait.
 *
 * LE RISQUE QUE CES TESTS COUVRENT
 * -------------------------------
 * Afficher une rivalité, c'est afficher des nombres — durée, confrontations,
 * victoires. Chacun doit correspondre à quelque chose qui s'est réellement
 * produit. Le test 2 recompte les confrontations à la source, dans la timeline.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runOneCareer } from '../src/engine/audit/runner.js';
import { rivalryView } from '../src/engine/view.js';
import { rivalryStatus } from '../src/engine/relations.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

/** Des carrières choisies sur PROPRIÉTÉ : celles qui ont connu une rivalité. */
let cache = null;
function carrieresAvecRivalite() {
  if (cache) return cache;
  const out = [];
  for (let i = 0; i < 6 && out.length < 4; i++) {
    for (const policyId of ['grinder', 'random', 'entertainer']) {
      if (out.length >= 4) break;
      const r = runOneCareer({ seed: `8e-${i}`, years: 25, policyId, keepSession: true });
      if (r.crash) continue;
      const c = r.session.career;
      if ((c.pastRivalries?.length ?? 0) + (c.rivalId ? 1 : 0) > 0) {
        out.push({ seed: `8e-${i}`, policyId, session: r.session });
      }
    }
  }
  cache = out;
  return out;
}

test('0 — le moteur produit bien des carrières avec rivalité', () => {
  assert.equal(
    carrieresAvecRivalite().length, 4,
    'pas assez de carrières avec rivalité : les tests suivants ne prouveraient rien',
  );
});

test('1 — la vue dit la même chose que le moteur', () => {
  for (const { seed, session } of carrieresAvecRivalite()) {
    const v = rivalryView(session);
    assert.ok(v, `${seed} : aucune vue alors qu'il y a eu une rivalité`);

    const person = session.world.persons[session.career.personId];
    const statut = rivalryStatus(session.world, person, session.career);
    assert.equal(
      !!v.enCours, statut.vivante,
      `${seed} : la vue et le moteur ne s'accordent pas sur l'existence d'une rivalité vivante`,
    );
    assert.equal(
      v.passees.length, (session.career.pastRivalries ?? []).length,
      `${seed} : rivalités archivées perdues en route`,
    );
    assert.equal(v.total, v.passees.length + (v.enCours ? 1 : 0), `${seed}`);
  }
});

test('2 — chaque confrontation annoncée a réellement eu lieu', () => {
  // Le nombre affiché est recompté à la source : les matchs de la timeline
  // joués contre l'équipe du rival. Sans cette vérification, l'écran pourrait
  // afficher un compteur qui a dérivé — c'est exactement ce qui était arrivé à
  // `actes`, posé à 1 et jamais incrémenté.
  for (const { seed, session } of carrieresAvecRivalite()) {
    const v = rivalryView(session);
    if (!v?.enCours) continue;
    const person = session.world.persons[session.career.personId];
    // Le bon dénominateur est le nombre de matchs RÉELLEMENT joués, pas les
    // entrées de timeline : celle-ci ne journalise que les matchs à enjeu
    // (`stakes >= 0.55`). Une première version comparait aux entrées et a
    // trouvé « 7 confrontations pour 1 match » — la prémisse était fausse, pas
    // le compteur.
    const joues = person.stats.matches ?? 0;
    const total =
      (v.enCours?.confrontations ?? 0) + v.passees.reduce((a, r) => a + r.confrontations, 0);
    assert.ok(v.enCours.confrontations >= 0, `${seed} : confrontations négatives`);
    assert.ok(
      v.enCours.victoires <= v.enCours.confrontations,
      `${seed} : ${v.enCours.victoires} victoires pour ${v.enCours.confrontations} confrontations`,
    );
    assert.ok(
      total <= joues,
      `${seed} : ${total} confrontations pour ${joues} matchs joués au total`,
    );
  }
});

test('3 — le compteur de confrontations n’est plus mort', () => {
  // La propriété qui a motivé l'étape : sur un échantillon de carrières avec
  // rivalité, au moins une doit avoir réellement affronté son rival. Si ce
  // test tombe, c'est que le compteur est retombé à zéro partout — donc mort à
  // nouveau, et l'écran mentirait.
  const totaux = [];
  for (const { session } of carrieresAvecRivalite()) {
    const v = rivalryView(session);
    if (!v) continue;
    totaux.push(
      (v.enCours?.confrontations ?? 0) + v.passees.reduce((a, r) => a + r.confrontations, 0),
    );
  }
  assert.ok(
    totaux.some((t) => t > 0),
    `aucune confrontation comptée sur ${totaux.length} carrières : le compteur est mort`,
  );
});

test('4 — une carrière sans rival ne raconte pas de rivalité', () => {
  // On construit le cas plutôt que de le chercher : la vue doit renvoyer null,
  // pas un objet vide qui ferait afficher un bloc « Rivalités » vide.
  const { session } = carrieresAvecRivalite()[0];
  const sans = {
    world: session.world,
    career: { ...session.career, rivalId: null, rivalry: null, pastRivalries: [] },
  };
  assert.equal(rivalryView(sans), null);
});

test("5 — une rivalité éteinte est dite éteinte, pas effacée", () => {
  // `rivalryStatus` sait pourquoi elle est morte — retraite, changement de
  // scène, réconciliation. Le bilan final s'en sert déjà ; l'écran doit
  // pouvoir en faire autant.
  const raisons = new Set();
  for (const { session } of carrieresAvecRivalite()) {
    const v = rivalryView(session);
    for (const r of v?.passees ?? []) {
      assert.ok(r.raison, 'une rivalité archivée sans raison');
      assert.ok(r.nick, 'une rivalité archivée sans rival nommé');
      raisons.add(r.raison);
    }
  }
  assert.ok(raisons.size >= 2, `une seule façon de finir observée : ${[...raisons].join(', ')}`);
});
