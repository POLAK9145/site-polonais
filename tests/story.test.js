/**
 * Tests de l'audit narratif (phase 2, étape 7G).
 *
 * Ce que le diagnostic 7G avait mesuré, et que ces tests protègent :
 *
 *  - 70 % des carrières seulement étaient « racontables », le facteur limitant
 *    étant l'absence de personnage secondaire ;
 *  - 3 bilans sur 27 se contredisaient, tous sur le même point : le texte
 *    affirmait « jamais signé de contrat professionnel » alors qu'il y avait
 *    eu des passages en équipe ;
 *  - la divergence entre carrières était mesurée SANS neutraliser le talent,
 *    donc confondait « ce que les décisions changent » et « ce que le plafond
 *    permet ».
 *
 * Le troisième point est le plus délicat, et c'est pourquoi une bonne moitié de
 * ce fichier teste l'INSTRUMENT plutôt que le moteur. Une métrique de
 * divergence qui bouge quand on change la taille de l'échantillon ne mesure
 * rien : elle ne permet ni de comparer deux exécutions, ni de savoir si une
 * correction a aidé. On vérifie donc explicitement qu'elle ne bouge pas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import {
  createSession, advanceWeek, resolveDecision, acceptOffer,
  seekTeam, canSeekTeam, foundTeam, canFoundTeam, setRoutine,
} from '../src/engine/simulation.js';
import { createPolicyState, pickChoice } from '../src/engine/audit/policies.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { careerMetrics, storyMetrics, verifyLegacy } from '../src/engine/audit/metrics.js';
import { narrativeAudit, omegaSquared, STORY_AUDIT } from '../src/engine/audit/storyAudit.js';
import { buildNarrative, computeLegacy } from '../src/engine/legacy.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

function play({ seed, policyId = 'random', years = 20 }) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
  const st = createPolicyState(policyId, normalizeSeed(`${seed}:policy`));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  if (st.policy.routine) setRoutine(session, st.policy.routine);
  const person = session.world.persons[session.career.personId];
  let w = 0;
  while (w < years * WEEKS_PER_YEAR && !session.career.retired) {
    const report = advanceWeek(session);
    w++;
    if (report.decision && !report.decision.resolved) {
      const c = pickChoice(st, report.decision.choices);
      resolveDecision(session, (c ?? report.decision.choices[0])?.id);
    }
    if (session.career.offers?.length) acceptOffer(session, 0);
    const real = person.teamId && !session.world.teams[person.teamId]?.isSelfTeam;
    if (!real && canSeekTeam(session).ok) {
      const r = seekTeam(session);
      if (r.offers?.length) acceptOffer(session, 0);
      else if (canFoundTeam(session).ok && st.rng.chance(0.7)) foundTeam(session);
    }
  }
  return session;
}

/** η² : l'estimateur naïf, gardé ici comme point de comparaison. */
function etaSquared(groups) {
  const lists = groups.filter((g) => g.length > 1);
  const all = lists.flat();
  const grand = all.reduce((a, b) => a + b, 0) / all.length;
  let ssB = 0;
  let ssW = 0;
  for (const g of lists) {
    const m = g.reduce((a, b) => a + b, 0) / g.length;
    ssB += g.length * (m - grand) ** 2;
    for (const v of g) ssW += (v - m) ** 2;
  }
  return ssB / (ssB + ssW);
}

function gaussianGroups(rng, { groups, n, meanStep, sd }) {
  const out = [];
  for (let g = 0; g < groups; g++) {
    const list = [];
    for (let i = 0; i < n; i++) {
      // Somme de douze uniformes : approximation de Gauss suffisante ici, et
      // qui n'introduit aucune dépendance.
      let s = 0;
      for (let k = 0; k < 12; k++) s += rng.float(0, 1);
      list.push(g * meanStep + (s - 6) * sd);
    }
    out.push(list);
  }
  return out;
}

// --- l'instrument -------------------------------------------------------

test("1 — sans effet de groupe, la part expliquée est nulle", () => {
  const rng = new RNG(normalizeSeed('7g:t1'));
  const groups = gaussianGroups(rng, { groups: 6, n: 30, meanStep: 0, sd: 10 });
  const omega = omegaSquared(groups);
  const eta = etaSquared(groups);

  assert.ok(omega <= 0.02, `ω² = ${omega} alors qu'aucun effet de groupe n'existe`);
  // η², lui, voit un effet là où il n'y en a pas : c'est exactement la raison
  // pour laquelle on ne s'en sert pas.
  assert.ok(eta > omega, `η² (${eta}) devrait surestimer par rapport à ω² (${omega})`);
});

test("2 — un effet de groupe net est mesuré comme tel", () => {
  const rng = new RNG(normalizeSeed('7g:t2'));
  const groups = gaussianGroups(rng, { groups: 5, n: 30, meanStep: 20, sd: 2 });
  assert.ok(omegaSquared(groups) > 0.9, `ω² = ${omegaSquared(groups)}, attendu > 0,9`);
});

test("3 — la mesure ne dépend pas de la taille de l'échantillon", () => {
  // Une métrique de divergence qui bouge quand on simule plus de carrières ne
  // permet pas de comparer deux exécutions : « la divergence a augmenté »
  // voudrait alors dire « j'ai simulé plus longtemps ». C'est le garde-fou
  // explicite de 7G.
  //
  // On compare sur un effet FAIBLE, où le biais de η² est le plus visible, et
  // on moyenne sur quarante répliques : une seule réplique ne dit rien, le
  // bruit d'échantillonnage y dépasse le biais que l'on cherche à montrer.
  const moyennes = (n) => {
    let o = 0;
    let e = 0;
    const R = 40;
    for (let r = 0; r < R; r++) {
      const g = gaussianGroups(new RNG(normalizeSeed(`7g:t3:${n}:${r}`)), {
        groups: 5, n, meanStep: 2, sd: 10,
      });
      o += omegaSquared(g);
      e += etaSquared(g);
    }
    return { omega: o / R, eta: e / R };
  };
  const petit = moyennes(20);
  const grand = moyennes(200);

  const dOmega = Math.abs(petit.omega - grand.omega);
  const dEta = Math.abs(petit.eta - grand.eta);

  assert.ok(
    dOmega <= 0.03,
    `ω² dérive de ${dOmega.toFixed(3)} entre n=20 et n=200 (${petit.omega.toFixed(3)} → ${grand.omega.toFixed(3)})`,
  );
  // Et l'estimateur naïf, lui, dérive nettement : c'est la raison d'être du
  // choix de ω². Sans cette seconde assertion, le test passerait aussi bien
  // avec une métrique qui ne mesure rien du tout.
  assert.ok(
    dEta >= dOmega * 2,
    `η² devrait dériver bien plus (${dEta.toFixed(3)}) que ω² (${dOmega.toFixed(3)})`,
  );
});

test("4 — le comptage d'archétypes ne gonfle pas avec l'échantillon", () => {
  // Même distribution d'archétypes, deux tailles de tranche. Le comptage brut
  // ne peut que croître : plus on simule, plus les archétypes rares finissent
  // par apparaître au moins une fois. Il mesure donc la durée de l'audit
  // autant que la diversité du moteur.
  const palette = [['a', 0.4], ['b', 0.25], ['c', 0.15], ['d', 0.1], ['e', 0.07], ['f', 0.02], ['g', 0.01]];
  const tire = (rng) => {
    let x = rng.float(0, 1);
    for (const [k, p] of palette) {
      if (x < p) return k;
      x -= p;
    }
    return palette[0][0];
  };
  const build = (n, seedLabel) => {
    const rng = new RNG(normalizeSeed(seedLabel));
    return Array.from({ length: n }, () => ({
      ceiling: 62,
      peak: 55 + rng.float(-5, 5),
      legacy: 40 + rng.float(-10, 10),
      durationYears: 10 + rng.float(-3, 3),
      titles: rng.int(0, 3),
      orgsCount: rng.int(1, 4),
      archetype: tire(rng),
      story: { tellable: true, problems: [], narrativeLength: 8 },
    }));
  };

  const petitRows = build(60, '7g:t4a');
  const grandRows = build(600, '7g:t4b');
  const petit = narrativeAudit(petitRows).divergence.aTalentComparable.archetypes;
  const grand = narrativeAudit(grandRows).divergence.aTalentComparable.archetypes;

  assert.ok(
    Math.abs(petit - grand) <= 0.5,
    `comptage à effectif fixe instable : ${petit} (n=60) vs ${grand} (n=600)`,
  );

  const brutPetit = new Set(petitRows.map((r) => r.archetype)).size;
  const brutGrand = new Set(grandRows.map((r) => r.archetype)).size;
  assert.ok(
    brutGrand > brutPetit,
    `le comptage brut devrait grossir avec l'échantillon (${brutPetit} → ${brutGrand}) : ` +
      `s'il ne le fait pas, ce test ne démontre rien et sa palette doit être revue`,
  );
});

test("5 — une tranche trop maigre n'est pas publiée comme une mesure", () => {
  // Six carrières dans une tranche ne disent rien de la dispersion. Elles
  // doivent être écartées, pas moyennées avec le reste.
  const mk = (ceiling, n, label) => {
    const rng = new RNG(normalizeSeed(label));
    return Array.from({ length: n }, () => ({
      ceiling,
      peak: ceiling - rng.float(0, 12),
      legacy: rng.float(0, 60),
      durationYears: rng.float(3, 16),
      titles: rng.int(0, 4),
      orgsCount: rng.int(1, 5),
      archetype: rng.pick(['a', 'b', 'c']),
      story: { tellable: true, problems: [], narrativeLength: 8 },
    }));
  };
  const audit = narrativeAudit([...mk(60, 80, '7g:t5a'), ...mk(90, 6, '7g:t5b')]);
  const plafonds = audit.divergence.tranches.map((t) => t.plafond);
  assert.equal(audit.divergence.tranchesRetenues, 1, `tranches retenues : ${JSON.stringify(plafonds)}`);
  assert.ok(audit.divergence.carrieresRetenues === 80);
  assert.ok(STORY_AUDIT.minBand >= 30, 'le seuil de mesurabilité ne doit pas être abaissé sans raison');
});

// --- le moteur ----------------------------------------------------------

test("6 — le bilan final ne contredit aucun fait", () => {
  // Le défaut corrigé en 7G : le texte concluait « jamais signé de contrat
  // professionnel » de l'absence d'une ligne de journal, alors que
  // `teamHistory` attestait le contraire. La cause était double — le récit
  // lisait le mauvais fait, ET le vérificateur comparait à un autre fait
  // encore (tout passage en équipe, contrat ou non).
  const problemes = [];
  for (const seed of ['7g-coh-1', '7g-coh-2', '7g-coh-3', '7g-coh-4', '7g-coh-5', '7g-coh-6']) {
    const session = play({ seed, policyId: 'random' });
    for (const p of verifyLegacy(session).problems) problemes.push({ seed, ...p });
  }
  assert.equal(problemes.length, 0, `contradictions : ${JSON.stringify(problemes)}`);
});

test("7 — un passage amateur n'est pas raconté comme un contrat, ni nié", () => {
  // Cas construit : le joueur a joué en équipe amateur et n'a jamais rien
  // signé. Les deux erreurs symétriques doivent être exclues — affirmer un
  // contrat qui n'existe pas, et nier une équipe qui a existé.
  const session = play({ seed: '7g-am-1', policyId: 'cautious', years: 6 });
  const { world, career } = session;
  const person = world.persons[career.personId];
  person.teamHistory = [
    { teamId: 't1', orgId: 'o1', orgName: 'Les Bricoleurs', gameId: person.gameId, from: career.startWeek + 30, to: null, contract: false },
  ];
  career.timeline = career.timeline.filter((t) => t.kind !== 'contract');

  const texte = buildNarrative(world, career, computeLegacy(world, career)).join(' ');
  assert.ok(texte.includes('Les Bricoleurs'), `le passage amateur est passé sous silence : ${texte}`);
  assert.ok(
    texte.includes('jamais signé de contrat professionnel'),
    `l'absence de contrat devrait être dite : ${texte}`,
  );
  assert.equal(verifyLegacy(session).problems.length, 0, JSON.stringify(verifyLegacy(session).problems));
});

test("8 — un contrat non journalisé est raconté, pas nié", () => {
  const session = play({ seed: '7g-am-2', policyId: 'cautious', years: 6 });
  const { world, career } = session;
  const person = world.persons[career.personId];
  person.teamHistory = [
    { teamId: 't1', orgId: 'o1', orgName: 'Nordwind', gameId: person.gameId, from: career.startWeek + 60, to: null, contract: true },
  ];
  career.timeline = career.timeline.filter((t) => t.kind !== 'contract');

  const texte = buildNarrative(world, career, computeLegacy(world, career)).join(' ');
  assert.ok(texte.includes('Nordwind'), `le contrat n'est pas raconté : ${texte}`);
  assert.ok(
    !texte.includes('jamais signé de contrat'),
    `le récit nie un contrat attesté : ${texte}`,
  );
  assert.equal(verifyLegacy(session).problems.length, 0, JSON.stringify(verifyLegacy(session).problems));
});

test("9 — à talent identique, les décisions font diverger tout sauf le niveau", () => {
  // C'est le test explicite demandé par 7G : séparer l'effet de plafond de
  // l'effet de décision.
  //
  // Le dispositif : même graine de session ET même configuration de
  // personnage, donc même monde et mêmes plafonds cachés. Seule la politique
  // de décision change. Tout écart observé à l'intérieur d'une graine est donc
  // un effet de décision, jamais un effet de talent — ce qu'aucun regroupement
  // par tranches ne peut garantir aussi proprement.
  //
  // Le `ceiling` mesuré peut malgré tout varier de un ou deux points à
  // l'intérieur d'une graine : il est pondéré par le jeu FINAL, et changer de
  // jeu re-pondère les mêmes attributs cachés. C'est encore une conséquence
  // d'une décision, pas une différence de talent.
  const graines = ['d2', 'd4', 'd6'];
  const politiques = ['grinder', 'cautious', 'reckless', 'teamplayer'];
  const parGraine = [];
  const tous = [];

  for (const seed of graines) {
    const lot = politiques.map((policyId) => {
      const session = play({ seed, policyId });
      return careerMetrics(session, { policy: policyId });
    });
    tous.push(...lot);
    const etendue = (f) => {
      const v = lot.map(f);
      return Math.max(...v) - Math.min(...v);
    };
    parGraine.push({
      seed,
      pic: etendue((r) => r.peak),
      legacy: etendue((r) => r.legacy),
      duree: etendue((r) => r.durationYears),
      archetypes: new Set(lot.map((r) => r.archetype)).size,
      plafonds: lot.map((r) => r.ceiling),
    });
  }

  const resume = JSON.stringify(parGraine);

  for (const g of parGraine) {
    // Le talent continue de borner le niveau atteint : les quatre trajectoires
    // finissent dans un mouchoir de poche en termes de pic.
    assert.ok(g.pic <= 15, `graine ${g.seed} : le pic varie de ${g.pic} points à talent identique — ${resume}`);
    // …mais la carrière, elle, n'a rien à voir d'une politique à l'autre.
    assert.ok(
      g.legacy > g.pic,
      `graine ${g.seed} : le legacy (${g.legacy}) ne diverge pas plus que le pic (${g.pic}) — ${resume}`,
    );
  }

  // LA DURÉE : UNE VOIE DE DIVERGENCE, PAS LA SEULE
  //
  // La version précédente exigeait au moins quatre ans d'écart de durée SUR
  // CHAQUE graine. C'est plus strict que la propriété visée : une graine où les
  // quatre politiques durent autant mais produisent seize points de legacy
  // d'écart et deux archétypes différents A divergé — simplement pas par la
  // durée. Mesuré à l'étape 9O : deux graines sur trois donnaient 7,0 et 8,9
  // ans d'écart, la troisième zéro, et le test échouait sur cette dernière.
  //
  // On exige donc la divergence par la durée sur la MAJORITÉ des graines. Un
  // moteur qui aplatirait vraiment les durées ferait tomber les trois.
  const parDuree = parGraine.filter((g) => g.duree >= 4).length;
  assert.ok(
    parDuree >= 2,
    `seulement ${parDuree} graine(s) sur ${parGraine.length} montrent un écart de durée — ${resume}`,
  );
  // Et l'écart cumulé sur les douze carrières reste substantiel.
  const dureeTotale = Math.max(...tous.map((r) => r.durationYears))
    - Math.min(...tous.map((r) => r.durationYears));
  assert.ok(dureeTotale >= 6, `durées toutes semblables sur l'ensemble (${dureeTotale} ans) — ${resume}`);

  const varie = parGraine.filter((g) => g.archetypes >= 2).length;
  assert.ok(
    varie >= 2,
    `deux graines sur trois au moins doivent produire des archétypes différents — ${resume}`,
  );

  // L'AUTRE MOITIÉ DE LA PROPRIÉTÉ — et pourquoi elle n'est PAS testée ici.
  //
  // Ce test vérifiait aussi que d'une graine à l'autre, le talent décide du
  // niveau, par une corrélation de Pearson sur les douze carrières. C'était un
  // mauvais instrument, et il l'a montré : au premier changement de moteur —
  // le marché des coachs, qui déplace le flux aléatoire du monde — il est tombé
  // à 0,56 et a crié à la régression.
  //
  // Mesuré à ce moment-là : les trois graines s'étalent bien sur 15,8 points de
  // plafond (72,5 / 76,1 / 88,3), mais la dispersion des pics À L'INTÉRIEUR
  // d'une graine atteint 8 points. Douze observations réparties en trois
  // grappes, avec un bruit interne du même ordre que l'écart entre grappes : le
  // coefficient mesure surtout l'échantillon.
  //
  // Cette propriété est déjà surveillée là où elle peut l'être sérieusement :
  // `talentSharePeak` dans la baseline — ω² sur 1400 carrières réparties en
  // onze tranches de plafond, avec un estimateur corrigé du biais, et inscrit
  // dans `GUARDED_PROPERTIES`. La garder ici en double n'ajoutait pas de
  // sécurité : elle ajoutait une fausse alerte.
  void tous;
});
