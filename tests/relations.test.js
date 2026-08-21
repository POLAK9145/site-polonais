/**
 * Tests des relations et de la mémoire sociale (phase 2, étape 7D).
 *
 * Le défaut corrigé, mesuré au diagnostic : les relations existaient, étaient
 * correctement structurées — une valeur ET un historique daté — et ne devenaient
 * jamais rien. Signer donnait +6 par coéquipier, puis plus aucun apport : une
 * relation avait 2 entrées d'historique en médiane, un pic de 10 sur une échelle
 * de 200, et 55 % des relations d'une carrière finissaient classées « Neutre ».
 * En parallèle, 26 drapeaux sur 28 n'étaient jamais relus et `timeline` comme
 * `memories` n'étaient consultées que par le bilan de fin de carrière.
 *
 * Deux garde-fous encadrent la correction :
 *
 *  1. **Le réseau ne doit pas devenir un second attribut de puissance.** Le
 *     recrutement lit déjà les relations ; les renforcer ne doit pas faire de
 *     « connaître les bonnes personnes » le déterminant d'une carrière.
 *
 *  2. **Le système doit produire des trajectoires différentes**, pas un bonus
 *     uniforme. Un joueur performant mais isolé, un joueur moyen bien intégré et
 *     un joueur hostile doivent vivre des carrières distinctes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import { generateWorld } from '../src/engine/worldgen.js';
import { STATUS } from '../src/engine/person.js';
import {
  createSession, advanceWeek, resolveDecision, acceptOffer,
  seekTeam, canSeekTeam, foundTeam, canFoundTeam, setRoutine, buildContext,
} from '../src/engine/simulation.js';
import { createPolicyState, pickChoice } from '../src/engine/audit/policies.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import {
  relationsOf, adjustRelation, decayRelations, relationValue,
  getRelation, REL_TAGS, describeRelation,
} from '../src/engine/relations.js';
import { evaluateInterest } from '../src/engine/transfers.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

// --- Utilitaires -------------------------------------------------------------

/** Joue une carrière et rend des relevés pris PENDANT, pas seulement à la fin. */
function play({ seed, policyId = 'random', years = 20, every = 13 }) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
  const st = createPolicyState(policyId, normalizeSeed(`${seed}:${policyId}`));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  if (st.policy.routine) setRoutine(session, st.policy.routine);
  const person = session.world.persons[session.career.personId];
  const releves = [];
  let w = 0;
  while (w < years * WEEKS_PER_YEAR && !session.career.retired) {
    const report = advanceWeek(session);
    w++;
    if (report.decision && !report.decision.resolved) {
      const c = pickChoice(st, report.decision.choices);
      if (c) resolveDecision(session, c.id);
    }
    if (session.career.offers?.length) acceptOffer(session, 0);
    const real = person.teamId && !session.world.teams[person.teamId]?.isSelfTeam;
    if (!real && canSeekTeam(session).ok) {
      const r = seekTeam(session);
      if (r.offers?.length) acceptOffer(session, 0);
      else if (canFoundTeam(session).ok && st.rng.chance(0.7)) foundTeam(session);
    }
    if (w % every === 0) {
      const rels = relationsOf(session.world, person.id, { minAbs: 0 });
      releves.push({
        semaine: w,
        fortes: rels.filter((r) => r.value >= 45).length,
        hostiles: rels.filter((r) => r.value <= -45).length,
        meilleure: rels.length ? Math.max(...rels.map((r) => r.value)) : 0,
        pire: rels.length ? Math.min(...rels.map((r) => r.value)) : 0,
        total: rels.length,
      });
    }
  }
  const pic = (f) => (releves.length ? Math.max(...releves.map(f)) : 0);
  return {
    session, person, weeks: w, releves,
    picFortes: pic((r) => r.fortes),
    picHostiles: pic((r) => r.hostiles),
    meilleure: pic((r) => r.meilleure),
    pire: releves.length ? Math.min(...releves.map((r) => r.pire)) : 0,
  };
}

/** Un monde nu et deux personnes qui vont partager une équipe. */
function paire(seed = 8100) {
  const world = generateWorld({ seed, startYear: 2030 });
  const team = Object.values(world.teams).find((t) => t.active && !t.isSelfTeam && t.roster.length >= 2);
  const [a, b] = team.roster.map((id) => world.persons[id]);
  return { world, team, a, b };
}

// --- 1 à 3 : la vie commune produit quelque chose ---------------------------

test('1 — partager un vestiaire fait évoluer une relation dans les deux sens', () => {
  const { world, team, a, b } = paire();
  adjustRelation(world, a.id, b.id, 6, { week: world.week, tag: REL_TAGS.TEAMMATE });
  const depart = relationValue(world, a.id, b.id);

  // Un groupe qui fonctionne rapproche.
  team.synergy = 80;
  decayRelations(world, 100);
  const apresBon = relationValue(world, a.id, b.id);
  assert.ok(apresBon > depart + 10, `groupe soudé : ${depart.toFixed(1)} → ${apresBon.toFixed(1)}`);

  // Un groupe pourri éloigne — le même mécanisme, en sens inverse.
  team.synergy = 15;
  decayRelations(world, 200);
  const apresMauvais = relationValue(world, a.id, b.id);
  assert.ok(
    apresMauvais < apresBon - 20,
    `groupe pourri : ${apresBon.toFixed(1)} → ${apresMauvais.toFixed(1)}`,
  );
});

test('2 — deux coéquipiers du même poste ne se rapprochent pas comme les autres', () => {
  // Le terme propre à chaque paire. Sans lui, tous les coéquipiers d'une équipe
  // convergeraient vers la même valeur : des relations identiques au lieu de
  // relations plates.
  const { world, team, a, b } = paire(8210);
  const autre = world.persons[team.roster.find((id) => id !== a.id && id !== b.id)] ?? b;
  b.roleId = a.roleId;
  if (autre !== b) autre.roleId = a.roleId === 'entry' ? 'support' : 'entry';

  adjustRelation(world, a.id, b.id, 6, { week: world.week, tag: REL_TAGS.TEAMMATE });
  adjustRelation(world, a.id, autre.id, 6, { week: world.week, tag: REL_TAGS.TEAMMATE });
  team.synergy = 70;
  // 400 semaines et non 200 : à 0,18 point par semaine, 200 semaines déplacent
  // 36 points, et les deux relations parties de 6 arrivaient toutes deux à 42 —
  // encore en transit, pas encore séparées. Le test mesurait la vitesse, pas la
  // cible. Il faut laisser converger pour comparer des équilibres.
  decayRelations(world, 400);

  const concurrent = relationValue(world, a.id, b.id);
  const collegue = relationValue(world, a.id, autre.id);
  if (autre !== b) {
    assert.ok(
      concurrent < collegue,
      `même poste ${concurrent.toFixed(1)} contre poste différent ${collegue.toFixed(1)}`,
    );
  }
});

test('3 — un lien fort s’efface avec le temps, mais laisse une trace', () => {
  const { world, a, b } = paire(8320);
  adjustRelation(world, a.id, b.id, 60, {
    week: world.week,
    text: 'Vous avez gagné un titre ensemble.',
    important: true,
  });
  const rel = getRelation(world, a.id, b.id);
  rel.tags = rel.tags.filter((t) => t !== REL_TAGS.TEAMMATE);
  rel.tags.push(REL_TAGS.EX_TEAMMATE);

  decayRelations(world, 5 * WEEKS_PER_YEAR);
  const cinqAns = relationValue(world, a.id, b.id);
  assert.ok(cinqAns < 45, `après cinq ans : ${cinqAns.toFixed(1)} — rien ne s’érode`);
  assert.ok(cinqAns > 5, `après cinq ans : ${cinqAns.toFixed(1)} — tout a été effacé`);

  // Et même très longtemps après, il en reste quelque chose : on perd de vue,
  // on n'efface pas. La version linéaire précédente ramenait exactement à zéro.
  decayRelations(world, 20 * WEEKS_PER_YEAR);
  const vingtCinqAns = relationValue(world, a.id, b.id);
  assert.ok(
    vingtCinqAns >= 14,
    `un titre gagné ensemble ne laisse plus rien après vingt-cinq ans : ${vingtCinqAns.toFixed(1)}`,
  );
});

// --- 4 : une rupture ne se répare pas toute seule ---------------------------

test('4 — une rupture publique ne se répare pas en partageant un vestiaire', () => {
  const { world, team, a, b } = paire(8430);
  adjustRelation(world, a.id, b.id, 20, { week: world.week, tag: REL_TAGS.TEAMMATE });
  adjustRelation(world, a.id, b.id, -40, {
    week: world.week,
    text: 'Affrontement ouvert.',
    important: true,
  });
  const apresRupture = relationValue(world, a.id, b.id);
  assert.ok(apresRupture < -12, `après l’affrontement : ${apresRupture.toFixed(1)}`);

  // Trois saisons dans un excellent groupe : la routine ne suffit pas.
  team.synergy = 85;
  decayRelations(world, 3 * WEEKS_PER_YEAR);
  const apresTroisAns = relationValue(world, a.id, b.id);
  assert.ok(
    apresTroisAns <= -12,
    `la cohabitation a réparé une rupture publique : ${apresRupture.toFixed(1)} → ${apresTroisAns.toFixed(1)}`,
  );

  // Un geste explicite, lui, peut réparer : il ne passe pas par la routine.
  adjustRelation(world, a.id, b.id, 45, { week: world.week, text: 'Vous vous êtes expliqués.' });
  assert.ok(relationValue(world, a.id, b.id) > 0, 'aucun geste ne peut réparer une rupture');
});

// --- 5 : les étiquettes suivent la valeur ------------------------------------

test('5 — une étiquette d’affection ne survit pas à ce qui la justifiait', () => {
  // `refreshDerivedTags` n'était appelé que depuis `adjustRelation` : une
  // relation qui repassait sous le seuil pendant l'érosion gardait `friend`
  // indéfiniment.
  const { world, a, b } = paire(8540);
  adjustRelation(world, a.id, b.id, 70, { week: world.week, text: 'Une vraie amitié.' });
  const rel = getRelation(world, a.id, b.id);
  assert.ok(rel.tags.includes(REL_TAGS.FRIEND), 'l’étiquette d’ami n’est pas posée');
  rel.tags = rel.tags.filter((t) => t !== REL_TAGS.TEAMMATE);

  decayRelations(world, 15 * WEEKS_PER_YEAR);
  assert.ok(
    !rel.tags.includes(REL_TAGS.FRIEND),
    `étiquette « ami » conservée à une valeur de ${rel.value.toFixed(1)}`,
  );
});

// --- 6 : le passé et l'entourage sont lisibles par les décisions -------------

test('6 — la situation expose l’entourage et le passé, sans chiffres ni données cachées', () => {
  const { session } = play({ seed: 'sit-7d', years: 8 });
  const s = buildContext(session).situation;
  for (const clef of [
    'aDesProches', 'aDesEnnemis', 'alliesDansEquipe', 'isoleDansEquipe', 'aUneRivalite',
    'aRateUnEssai', 'aEteSurLeBanc', 'aConnuLaRupture', 'aPenseArreter', 'momentsMarquants',
  ]) {
    assert.ok(s[clef] !== undefined, `la situation n’expose pas « ${clef} »`);
  }
  // Cohérence : on ne peut pas être isolé et entouré d'alliés.
  assert.equal(s.isoleDansEquipe && s.alliesDansEquipe > 0, false, 'situation sociale incohérente');
  assert.equal(s.aDesProches, s.nbProches > 0, 'aDesProches et nbProches se contredisent');
});

// --- 7 : le garde-fou du réseau ---------------------------------------------

test('7 — le réseau ne devient pas un second attribut de puissance', () => {
  // Le recrutement lit les relations. Renforcer celles-ci ne doit pas faire de
  // « connaître les bonnes personnes » le déterminant d'une carrière.
  //
  // La mesure doit être prise sur un joueur ENCORE EN ACTIVITÉ : une première
  // version jouait douze ans puis évaluait, mais le joueur avait pris sa
  // retraite et `evaluateInterest` renvoyait « Joueur non disponible » sans
  // aucun facteur — le test divisait alors zéro par zéro.
  let session = null;
  let person = null;
  for (const seed of ['net-7d', 'net-7e', 'net-7f', 'net-7g']) {
    const r = play({ seed, years: 8 });
    if (!r.session.career.retired) {
      session = r.session;
      person = r.person;
      break;
    }
  }
  assert.ok(session, 'aucune carrière encore active après huit ans sur quatre graines');
  const world = session.world;
  const equipes = Object.values(world.teams).filter((t) => t.active && !t.isSelfTeam).slice(0, 25);

  let reseau = 0;
  let aptitude = 0;
  let n = 0;
  for (const t of equipes) {
    const it = evaluateInterest(world, t, person);
    if (!it?.factors) continue;
    n++;
    for (const f of it.factors) {
      if (/Relations|Passif/.test(f.label)) reseau += Math.abs(f.delta);
      else aptitude += Math.abs(f.delta);
    }
  }
  assert.ok(n > 0, 'aucune évaluation d’intérêt mesurée');
  assert.ok(aptitude > 0, 'aucune contribution d’aptitude : les facteurs sont vides');
  assert.ok(
    reseau < aptitude * 0.25,
    `le réseau pèse ${Math.round((100 * reseau) / (reseau + aptitude))} % du score d’intérêt : il devient un attribut de puissance`,
  );
});

// --- 8 : des trajectoires contradictoires ----------------------------------

test('8 — le système produit des trajectoires sociales différentes', () => {
  // Le test demandé : performant mais isolé, moyen mais intégré, performant et
  // hostile. Si toutes les politiques produisent le même profil social, le
  // système n'est qu'un bonus uniforme.
  const profils = ['teamplayer', 'saboteur', 'grinder', 'reckless'].map((p) => ({
    politique: p,
    ...play({ seed: 'traj', policyId: p, years: 20 }),
  }));

  const fortes = profils.map((p) => p.picFortes);
  const meilleures = profils.map((p) => p.meilleure);
  assert.ok(
    Math.max(...fortes) > Math.min(...fortes),
    `toutes les politiques atteignent le même nombre d’amitiés fortes : ${fortes.join(', ')}`,
  );
  assert.ok(
    Math.max(...meilleures) - Math.min(...meilleures) > 15,
    `meilleures relations trop semblables : ${meilleures.map((v) => Math.round(v)).join(', ')}`,
  );

  // Et une carrière doit pouvoir contenir de vraies amitiés : mesuré sur
  // 18 carrières, 14 en connaissent au moins une, avec un pic moyen de 1,8.
  assert.ok(
    profils.some((p) => p.picFortes >= 1),
    'aucune des quatre trajectoires ne produit une seule amitié forte',
  );
});

test('9 — une relation se lit toujours comme un fait, jamais comme un score', () => {
  const { session, person } = play({ seed: 'récit', years: 12 });
  const rels = relationsOf(session.world, person.id, { minAbs: 0 });
  assert.ok(rels.length > 0, 'aucune relation après douze ans');

  for (const r of rels) {
    const label = describeRelation(r.value, r.tags);
    assert.ok(typeof label === 'string' && label.length > 0, 'relation sans description');
    for (const h of r.history) {
      assert.ok(typeof h.text === 'string' && h.text.length > 0, 'entrée d’historique sans texte');
      assert.ok(!/^-?\d+$/.test(h.text.trim()), `entrée d’historique réduite à un nombre : « ${h.text} »`);
      assert.ok(Number.isFinite(h.week), 'entrée d’historique sans date');
    }
  }
  // Et l'historique reste borné : les mises à jour de match ne doivent pas le
  // remplir, sinon vingt matchs par an pendant quinze ans le rendraient illisible.
  const plusLong = Math.max(...rels.map((r) => r.history.length));
  assert.ok(plusLong <= 40, `historique de ${plusLong} entrées : les mises à jour silencieuses fuient`);
});
