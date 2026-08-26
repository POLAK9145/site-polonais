/**
 * Tests du bilan de saison (étape 9A).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * À la fin d'une saison, le joueur apprenait ceci : « Fin de saison 2035 :
 * 12 retraites, 40 nouveaux joueurs sur les scènes. » C'est-à-dire rien sur SA
 * saison. Ni ses matchs, ni ses victoires, ni sa progression, ni si l'objectif
 * que sa structure lui avait fixé en le signant était tenu — cette promesse
 * contractuelle n'était d'ailleurs jamais évaluée nulle part.
 *
 * Une carrière de vingt ans, c'est vingt saisons. Sans bilan, ce sont mille
 * semaines qui se ressemblent.
 *
 * LE RISQUE QUE CES TESTS COUVRENT
 * -------------------------------
 * Un bilan affiche des nombres. Chacun doit être une différence réelle entre
 * le début et la fin de la saison, et non un compteur parallèle qui finirait
 * par diverger du total cumulé (test 1).
 *
 * Et un titre de presse est un jugement : mal calibré, il ment. La première
 * version plaçait « saison noire » sous 30 % de victoires — au-dessus de la
 * médiane du jeu, qui est de 25 %. Résultat : 38 % des saisons étaient
 * annoncées comme des catastrophes. Le test 5 empêche ce retour.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runOneCareer } from '../src/engine/audit/runner.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

let cache = null;
function carrieres() {
  if (cache) return cache;
  cache = [];
  for (const policyId of ['grinder', 'random', 'entertainer', 'cautious']) {
    for (let s = 0; s < 2; s++) {
      const r = runOneCareer({ seed: `9a-${s}`, years: 20, policyId, keepSession: true });
      if (!r.crash) cache.push({ seed: `9a-${s}`, policyId, r });
    }
  }
  return cache;
}

function toutesLesSaisons() {
  return carrieres().flatMap(({ seed, policyId, r }) =>
    (r.session.career.seasons ?? []).map((b) => ({ seed, policyId, b })),
  );
}

test('0 — chaque carrière produit un bilan par saison vécue', () => {
  for (const { seed, policyId, r } of carrieres()) {
    const n = (r.session.career.seasons ?? []).length;
    assert.ok(n > 0, `${seed}/${policyId} : aucun bilan`);
    // Une saison par an, à une près : la première est partielle et la dernière
    // peut être coupée par la retraite.
    assert.ok(
      Math.abs(n - Math.round(r.durationYears)) <= 2,
      `${seed}/${policyId} : ${n} bilans pour ${r.durationYears} ans de carrière`,
    );
  }
});

test('1 — chaque chiffre du bilan est une différence réelle', () => {
  // On recompose les totaux à partir des bilans et on les confronte aux
  // compteurs cumulés du moteur. Deux sources pour un même nombre finissent
  // toujours par diverger ; ce test le rend impossible en silence.
  for (const { seed, policyId, r } of carrieres()) {
    const person = r.session.world.persons[r.session.career.personId];
    const saisons = r.session.career.seasons ?? [];
    // Les bilans les plus anciens sont élagués au-delà de trente : on ne peut
    // recomposer que si tout est encore là.
    if (saisons.length >= 30) continue;

    const somme = (k) => saisons.reduce((a, b) => a + (b[k] ?? 0), 0);
    // La saison en cours n'est pas encore close : les totaux du moteur peuvent
    // dépasser la somme des bilans, jamais l'inverse.
    assert.ok(
      somme('matches') <= (person.stats.matches ?? 0),
      `${seed}/${policyId} : ${somme('matches')} matchs en bilans pour ${person.stats.matches} joués`,
    );
    assert.ok(somme('wins') <= (person.stats.wins ?? 0), `${seed}/${policyId} : victoires`);
    assert.ok(somme('titles') <= (person.stats.titles ?? 0), `${seed}/${policyId} : titres`);
    for (const b of saisons) {
      assert.ok(b.wins <= b.matches, `${seed} ${b.year} : ${b.wins} victoires pour ${b.matches} matchs`);
      assert.ok(b.matches >= 0 && b.wins >= 0 && b.titles >= 0, `${seed} ${b.year} : nombre négatif`);
    }
  }
});

test('2 — aucun bilan n’annonce un titre qui n’a pas été gagné', () => {
  for (const { seed, b } of toutesLesSaisons()) {
    if (/soulève|règne/.test(b.headline)) {
      assert.ok(b.titles > 0, `${seed} ${b.year} : « ${b.headline} » sans titre`);
    }
    if (/tombe en finale/.test(b.headline)) {
      assert.ok(b.finals > 0, `${seed} ${b.year} : « ${b.headline} » sans finale`);
    }
    if (/une saison pour rien/.test(b.headline)) {
      assert.equal(b.matches, 0, `${seed} ${b.year} : « saison pour rien » avec ${b.matches} matchs`);
    }
  }
});

test("3 — une saison sans match mais avec progression n'est pas une saison perdue", () => {
  // 13 % des saisons se jouent sans le moindre match — souvent les premières,
  // sans équipe, où l'on gagne jusqu'à quinze points de niveau. Les appeler
  // « une saison pour rien » insulte la saison de débuts.
  const formation = toutesLesSaisons().filter(({ b }) => b.matches === 0 && (b.progression ?? 0) >= 2);
  assert.ok(formation.length > 0, 'prémisse : aucune saison de formation dans l’échantillon');
  for (const { seed, b } of formation) {
    assert.ok(
      !/pour rien/.test(b.headline),
      `${seed} ${b.year} : « ${b.headline} » alors que le joueur a pris ${b.progression} points`,
    );
  }
});

test('4 — l’objectif de la structure est évalué sur les faits', () => {
  let evalues = 0;
  for (const { seed, b } of toutesLesSaisons()) {
    if (!b.objective || b.objective.tenu === null) continue;
    evalues++;
    if (b.objective.id === 'titre_international' && b.objective.tenu) {
      assert.ok(b.titles > 0, `${seed} ${b.year} : titre international « tenu » sans titre`);
    }
    if (b.objective.id === 'progression' && b.objective.tenu) {
      assert.ok((b.progression ?? 0) >= 0, `${seed} ${b.year} : progression « tenue » en reculant`);
    }
    // Une prime ne peut exister que si l'objectif est tenu.
    if (b.objective.prime > 0) assert.equal(b.objective.tenu, true, `${seed} ${b.year} : prime sans objectif tenu`);
  }
  assert.ok(evalues > 5, `prémisse : seulement ${evalues} objectifs évalués`);
});

test('5 — les titres de presse sont calibrés sur la distribution réelle', () => {
  // La première version annonçait « saison noire » sur 38 % des saisons, parce
  // que son seuil (30 % de victoires) était au-dessus de la médiane du jeu.
  // Un jugement qui tombe sur la saison médiane ne juge plus rien.
  const saisons = toutesLesSaisons();
  assert.ok(saisons.length > 60, `prémisse : ${saisons.length} saisons seulement`);

  const part = (motif) => saisons.filter(({ b }) => motif.test(b.headline)).length / saisons.length;

  // CE QUE CE TEST MESURE VRAIMENT
  //
  // La première version bornait la FRÉQUENCE à 15 %. Mesuré sur 390 saisons,
  // le taux réel est de 16-17 % : la borne était plus serrée que le phénomène,
  // et l'échantillon du test la franchissait ou non selon le tirage. Elle
  // échouait donc sur des changements de moteur qui n'avaient rien empiré —
  // vérifié : 17 % avant l'étape 9O, 16 % après.
  //
  // La propriété visée était énoncée dans le commentaire ci-dessus : « un
  // jugement qui tombe sur la saison médiane ne juge plus rien ». On la teste
  // donc directement, en comparant les saisons jugées noires à la médiane du
  // jeu, ce qui est à la fois plus strict de sens et insensible au tirage.
  const tauxDe = (motif) => saisons
    .filter(({ b }) => motif.test(b.headline) && b.winRate != null)
    .map(({ b }) => b.winRate);
  const mediane = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const tousLesTaux = saisons.filter(({ b }) => b.winRate != null).map(({ b }) => b.winRate);
  const medianeGenerale = mediane(tousLesTaux);

  const noires = tauxDe(/Saison noire/);
  assert.ok(noires.length > 0, 'aucune saison noire : le jugement ne s’exprime jamais');
  assert.ok(
    mediane(noires) < medianeGenerale,
    `« saison noire » tombe sur des saisons à ${mediane(noires)} % de victoires, ` +
    `pour une médiane générale de ${medianeGenerale} % : le jugement ne discrimine pas`,
  );
  // Et un garde-fou de fréquence, large : au-delà d'un quart des saisons, le
  // verdict décrirait le quotidien plutôt qu'un accident.
  assert.ok(part(/Saison noire/) < 0.25, `« saison noire » sur ${Math.round(part(/Saison noire/) * 100)} % des saisons`);
  assert.ok(part(/règne sur la saison/) <= 0.1, 'le titre le plus fort est devenu banal');

  // Et l'inverse : le jeu doit produire des saisons variées, pas un seul titre.
  const distincts = new Set(saisons.map(({ b }) => b.headline.replace(/[A-ZÀ-Ý][\wÀ-ÿ_0-9]*/g, 'X')));
  assert.ok(distincts.size >= 5, `seulement ${distincts.size} formulations différentes`);
});

test('6 — une prime versée arrive vraiment sur le compte', () => {
  // Sans cela, l'objectif du club serait une promesse d'écran.
  for (const { seed, r } of carrieres()) {
    const primes = (r.session.career.seasons ?? [])
      .map((b) => b.objective?.prime ?? 0)
      .reduce((a, x) => a + x, 0);
    if (primes === 0) continue;
    const person = r.session.world.persons[r.session.career.personId];
    assert.ok(
      (person.stats.earnings ?? 0) >= primes,
      `${seed} : ${primes} € de primes annoncées pour ${person.stats.earnings} € de gains totaux`,
    );
  }
});
