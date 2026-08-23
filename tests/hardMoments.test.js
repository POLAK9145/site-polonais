/**
 * Tests des coups durs enregistrés par la simulation (étape 8C).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * Tous les moments difficiles journalisés venaient d'ÉVÉNEMENTS scriptés. La
 * simulation, elle, en produisait sans jamais les nommer. Mesuré sur 108
 * carrières : 23 % n'avaient aucun point bas identifiable, et parmi celles-là,
 * 80 % avaient été licenciées au moins une fois — médiane TROIS fois — 64 %
 * avaient vu un contrat ne pas être prolongé, et 10 sur 25 avaient fini usées.
 * Une seule sur vingt-cinq n'avait réellement rien vécu de dur.
 *
 * Le bilan final construisant sa phrase « Tout n'a pas été droit… » à partir de
 * ces mêmes entrées, il restait muet sur des carrières éprouvantes.
 *
 * LE RISQUE QUE CES TESTS COUVRENT
 * -------------------------------
 * Rendre les carrières « racontables » en inventant du malheur serait pire que
 * le défaut d'origine. Le test 1 vérifie donc que la simulation est INCHANGÉE —
 * mêmes durées, mêmes titres, mêmes fins de carrière — et le test 2 qu'aucune
 * entrée ne raconte un licenciement là où il y a eu un transfert.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runOneCareer } from '../src/engine/audit/runner.js';
import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { createSession, advanceWeek, resolveDecision } from '../src/engine/simulation.js';
import { addToRoster } from '../src/engine/team.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { releasePlayer } from '../src/engine/transfers.js';
import { trackHardMoments } from '../src/engine/career.js';
import { buildNarrative, computeLegacy, FINS_SUBIES } from '../src/engine/legacy.js';
import { readFileSync } from 'node:fs';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

const CARRIERES = [
  { seed: '8c-0', policyId: 'grinder' },
  { seed: '8c-1', policyId: 'random' },
  { seed: '8c-2', policyId: 'cautious' },
  { seed: '8c-3', policyId: 'reckless' },
];

function jouer({ seed, policyId }) {
  const r = runOneCareer({ seed, years: 25, policyId, keepSession: true });
  assert.ok(!r.crash, `plantage : ${r.crash?.message}`);
  return r;
}

test('1 — une carrière difficile finit par le dire', () => {
  // La propriété qui compte : si des choses dures sont réellement arrivées,
  // la carrière doit avoir un point bas identifiable.
  const manquants = [];
  let eprouvees = 0;
  for (const c of CARRIERES) {
    for (const suffixe of ['', 'b', 'c']) {
      const r = jouer({ seed: c.seed + suffixe, policyId: c.policyId });
      const { career, world } = r.session;
      const person = world.persons[career.personId];
      const dur =
        (career.counters.timesReleased ?? 0) > 0 ||
        (person.load?.episodes ?? 0) > 0 ||
        (career.counters.longestWithoutTeam ?? 0) >= 52;
      if (!dur) continue;
      eprouvees++;
      if (!r.story.hasWorstMoment) {
        manquants.push({
          seed: c.seed + suffixe,
          licencie: career.counters.timesReleased,
          burnout: person.load?.episodes ?? 0,
          sansEquipe: career.counters.longestWithoutTeam ?? 0,
        });
      }
    }
  }
  assert.ok(eprouvees >= 6, `prémisse : seulement ${eprouvees} carrières éprouvées dans l'échantillon`);
  assert.equal(
    manquants.length, 0,
    `${manquants.length}/${eprouvees} carrières éprouvées sans point bas : ${JSON.stringify(manquants)}`,
  );
});

test("2 — aucun transfert n'est raconté comme un licenciement", () => {
  // Le détecteur générique compare l'équipe en début et en fin de semaine.
  // Un transfert, où l'on quitte une équipe pour une autre, ne doit jamais le
  // déclencher — sinon on annoncerait au joueur qu'il a été écarté le jour où
  // il vient de signer.
  for (const c of CARRIERES) {
    const { session } = jouer(c);
    const t = session.career.timeline;
    const ecartes = t.filter((e) => e.text.includes('Écarté de l’effectif'));
    const contrats = t.filter((e) => e.kind === 'contract');
    for (const e of ecartes) {
      const proche = contrats.find((s) => Math.abs(s.week - e.week) <= 1);
      assert.ok(!proche, `${c.seed} : « écarté » la même semaine que « ${proche?.text} »`);
    }
    // Et jamais deux fois la même semaine.
    const semaines = ecartes.map((e) => e.week);
    assert.equal(new Set(semaines).size, semaines.length, `${c.seed} : doublons`);
  }
});

test('3 — perdre son équipe hors fin de contrat est enregistré', () => {
  // Le chemin existe dans le moteur — une structure qui recrute peut écarter le
  // maillon faible, une scène qui ferme libère tout le monde — mais il est plus
  // rare que la fin de contrat, et n'apparaissait dans aucune des douze
  // carrières mesurées. On le construit donc : du code jamais exécuté n'est pas
  // du code vérifié.
  const player = randomPlayerConfig(new RNG(normalizeSeed('8c-cut:config')));
  const session = createSession({ seed: '8c-cut', startYear: 2030, difficulty: 'standard', player });
  const person = session.world.persons[session.career.personId];

  // Une semaine jouée proprement : les décisions en attente bloquent l'horloge,
  // il faut donc y répondre. (Première version du test : elle sortait de la
  // boucle à la première décision, le monde n'avançait plus, et j'en concluais
  // à tort que le moteur ne voyait rien.)
  const semaine = () => {
    const report = advanceWeek(session);
    if (report.decision && !report.decision.resolved) {
      resolveDecision(session, report.decision.choices[0]?.id);
    }
  };

  // On installe une vraie équipe par le chemin normal du moteur.
  const equipe = Object.values(session.world.teams).find(
    (t) => t.active && !t.isSelfTeam && t.gameId === person.gameId && t.roster.length > 0,
  );
  assert.ok(equipe, 'aucune équipe disponible dans ce monde de test');
  addToRoster(session.world, equipe, person.id);
  person.contract = {
    orgId: equipe.orgId, teamId: equipe.id, salary: 1000,
    signedWeek: session.world.week, endWeek: session.world.week + 400, role: 'starter',
  };
  semaine();
  assert.equal(session.career.counters.avaitUneEquipe, true, 'le moteur n’a pas vu l’équipe');

  const avant = session.career.timeline.length;
  // Licenciement PAR LE MONDE, sans passer par l'expiration du contrat.
  releasePlayer(session.world, person.id, session.world.week, 'remplacé');
  // Perdre son équipe n'est un coup dur que si l'on reste dehors : on laisse la
  // situation durer, exactement comme la règle l'exige.
  for (let i = 0; i < 6; i++) semaine();

  const nouvelles = session.career.timeline.slice(avant);
  const dit = nouvelles.filter((e) => e.kind === 'setback' && e.important);
  assert.ok(
    dit.length >= 1,
    `perdre son équipe n'a rien enregistré : ${JSON.stringify(nouvelles.map((e) => e.text))}`,
  );
  assert.equal(dit.length, 1, `la perte a été journalisée ${dit.length} fois : ${JSON.stringify(dit.map((e) => e.text))}`);
});

test("4 — l'effondrement du moral se dit une fois, pas chaque semaine", () => {
  // Sans hystérésis, un moral qui oscille au plancher journaliserait un
  // « passage à vide » toutes les semaines pendant des années.
  const career = { timeline: [], memories: [], flags: {}, counters: {} };
  const world = { week: 0 };
  const person = { morale: 0 };
  const contexte = { hadRealTeam: true, hasRealTeam: true };

  for (let i = 0; i < 200; i++) {
    world.week = i;
    trackHardMoments(career, world, person, contexte);
  }
  const passages = career.memories.filter((m) => m.title === 'Le passage à vide');
  assert.equal(passages.length, 1, `${passages.length} passages à vide pour un seul épisode`);

  // Le moral remonte franchement, puis rechute : c'est un deuxième épisode.
  person.morale = 60;
  for (let i = 200; i < 240; i++) { world.week = i; trackHardMoments(career, world, person, contexte); }
  person.morale = 0;
  for (let i = 240; i < 300; i++) { world.week = i; trackHardMoments(career, world, person, contexte); }
  assert.equal(
    career.memories.filter((m) => m.title === 'Le passage à vide').length, 2,
    'une rechute après récupération devrait compter comme un nouvel épisode',
  );

  // Et un creux court ne compte pas.
  const court = { timeline: [], memories: [], flags: {}, counters: {} };
  const p2 = { morale: 0 };
  for (let i = 0; i < 5; i++) { world.week = i; trackHardMoments(court, world, p2, contexte); }
  assert.equal(court.memories.length, 0, 'cinq mauvaises semaines ne sont pas un passage à vide');
});

test("5 — la traversée du désert ne se journalise qu'une fois par épisode", () => {
  const career = { timeline: [], memories: [], flags: {}, counters: { weeksWithoutTeam: 0 } };
  const world = { week: 0 };
  const person = { morale: 60 };
  const contexte = { hadRealTeam: false, hasRealTeam: false };

  for (let i = 0; i < 200; i++) {
    world.week = i;
    career.counters.weeksWithoutTeam = i;
    trackHardMoments(career, world, person, contexte);
  }
  assert.equal(
    career.memories.filter((m) => m.title === 'La traversée du désert').length, 1,
    'deux cents semaines sans équipe ne font pas deux traversées',
  );

  // Retrouver une équipe, puis replonger un an : deuxième traversée.
  career.counters.weeksWithoutTeam = 0;
  world.week = 200;
  trackHardMoments(career, world, person, contexte);
  for (let i = 201; i < 260; i++) {
    world.week = i;
    career.counters.weeksWithoutTeam = i - 200;
    trackHardMoments(career, world, person, contexte);
  }
  assert.equal(career.memories.filter((m) => m.title === 'La traversée du désert').length, 2);
});

test("6 — une fin de contrat n'ouvre plus le récit comme une signature", () => {
  // `buildNarrative` cherchait la PREMIÈRE entrée de type « contrat » pour
  // raconter les débuts. Une fin de contrat en portait l'étiquette : une
  // carrière pouvait donc s'ouvrir sur « Fin de contrat avec X, non prolongé ».
  for (const c of CARRIERES) {
    const { session } = jouer(c);
    const texte = buildNarrative(
      session.world, session.career, computeLegacy(session.world, session.career),
    ).join(' ');
    assert.ok(
      !/^En \d{4}.*Fin de contrat/s.test(texte.slice(0, 400)),
      `${c.seed} : le récit s'ouvre sur une fin de contrat — ${texte.slice(0, 300)}`,
    );
  }
});

test("7 — le bilan dit comment la carrière s'est terminée", () => {
  // Toutes les carrières se terminaient sur le même décompte de matchs, que le
  // joueur ait choisi d'arrêter ou que le corps ait lâché. Le moteur connaît la
  // différence ; le récit l'ignorait.
  let subies = 0;
  for (const c of CARRIERES) {
    for (const suffixe of ['', 'b', 'c']) {
      const { session } = jouer({ seed: c.seed + suffixe, policyId: c.policyId });
      const chemin = session.career.retirementPath;
      if (!session.career.retired) continue;
      const texte = buildNarrative(
        session.world, session.career, computeLegacy(session.world, session.career),
      ).join(' ');
      const phrase = FINS_SUBIES[chemin];
      if (phrase) {
        subies++;
        assert.ok(texte.includes(phrase), `${c.seed}${suffixe} (${chemin}) : la fin subie n'est pas dite`);
      } else {
        // Une fin choisie ne doit surtout pas être racontée comme subie.
        for (const p of Object.values(FINS_SUBIES)) {
          assert.ok(!texte.includes(p), `${c.seed}${suffixe} (${chemin}) : fin choisie racontée comme subie`);
        }
      }
    }
  }
  assert.ok(subies >= 3, `prémisse : seulement ${subies} fins subies dans l'échantillon`);
});

test('8 — aucune fin subie du moteur n’est oubliée par le récit', () => {
  // Une chaîne mal recopiée ferait taire la phrase sans rien casser. On lit
  // donc le moteur : chaque fin qu'il peut poser doit avoir son texte.
  const source = readFileSync(new URL('../src/engine/simulation.js', import.meta.url), 'utf8');
  const chemins = [...source.matchAll(/inevitable = '([^']+)'/g)].map((m) => m[1]);
  assert.ok(chemins.length >= 4, `lecture du moteur ratée : ${JSON.stringify(chemins)}`);
  const oublies = chemins.filter((c) => !FINS_SUBIES[c]);
  assert.deepEqual(
    oublies, [],
    `fins subies sans phrase dans le bilan : ${JSON.stringify(oublies)}`,
  );
});
