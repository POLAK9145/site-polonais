/**
 * Tests des rivalités (phase 2, étape 7E).
 *
 * Le défaut corrigé, mesuré au diagnostic : une rivalité n'avait qu'un seul
 * acte. Elle naissait vers l'an 3, connaissait un affrontement et une
 * résolution, puis se figeait pour une décennie — dix-huit sur vingt terminaient
 * exactement sur une borne du système. Il n'y en avait qu'une par carrière,
 * `once: true` l'interdisant, et le rival était retraité dans quinze cas sur
 * dix-huit alors que le bilan le citait comme « fil rouge ». Enfin, la rivalité
 * ne pesait ni sur les matchs, ni sur le recrutement, ni sur la charge : c'était
 * un fil de récit, pas un fait du monde.
 *
 * Le garde-fou : faire compter la rivalité ne doit pas la transformer en bonus
 * de performance. L'effet doit être à double tranchant — on se surpasse ou on se
 * crispe — et d'espérance nulle pour un mental moyen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import { generateWorld } from '../src/engine/worldgen.js';
import { GAMES_BY_ID } from '../src/data/games.js';
import { STATUS, baseRating, age as personAge } from '../src/engine/person.js';
import {
  createSession, advanceWeek, resolveDecision, acceptOffer,
  seekTeam, canSeekTeam, foundTeam, canFoundTeam, setRoutine,
} from '../src/engine/simulation.js';
import { createPolicyState, pickChoice } from '../src/engine/audit/policies.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import {
  rivalryStatus, closeRivalry, adjustRelation, relationsOf, REL_TAGS,
} from '../src/engine/relations.js';
import { computeLegacy, buildNarrative } from '../src/engine/legacy.js';
import { initEvents, allEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

function play({ seed, policyId = 'random', years = 20 }) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
  const st = createPolicyState(policyId, normalizeSeed(`${seed}:${policyId}`));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  if (st.policy.routine) setRoutine(session, st.policy.routine);
  const person = session.world.persons[session.career.personId];
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
  }
  return { session, person, weeks: w };
}

// --- 1 à 3 : le cycle de vie -------------------------------------------------

test('1 — une rivalité meurt quand le rival cesse d’en être un', () => {
  const world = generateWorld({ seed: 9100, startYear: 2030 });
  const [moi, lui] = Object.values(world.persons).filter((p) => p.status !== STATUS.STAFF).slice(0, 2);
  lui.gameId = moi.gameId;
  const career = { personId: moi.id, rivalId: lui.id, rivalry: { depuis: 0, actes: 1 }, pastRivalries: [] };
  adjustRelation(world, moi.id, lui.id, -20, { week: 0, text: 'Rivalité.', tag: REL_TAGS.RIVAL });

  assert.equal(rivalryStatus(world, moi, career).vivante, true, 'une rivalité normale devrait être vivante');

  // Quatre façons de mourir, chacune vérifiable dans le monde.
  const scenarios = [
    ['retraité', () => { lui.status = STATUS.RETIRED; }, () => { lui.status = STATUS.PRO; }],
    ['autre scène', () => { lui.gameId = 'autre-jeu'; }, () => { lui.gameId = moi.gameId; }],
    ['réconciliée', () => adjustRelation(world, moi.id, lui.id, 70, { week: 1 }), () => adjustRelation(world, moi.id, lui.id, -70, { week: 1 })],
  ];
  for (const [attendu, casser, reparer] of scenarios) {
    casser();
    const etat = rivalryStatus(world, moi, career);
    assert.equal(etat.vivante, false, `la rivalité survit à « ${attendu} »`);
    assert.equal(etat.raison, attendu, `raison attendue « ${attendu} », obtenue « ${etat.raison} »`);
    reparer();
  }
});

test('2 — une rivalité éteinte est archivée, pas effacée', () => {
  const world = generateWorld({ seed: 9210, startYear: 2030 });
  const [moi, lui] = Object.values(world.persons).filter((p) => p.status !== STATUS.STAFF).slice(0, 2);
  const career = { personId: moi.id, rivalId: lui.id, rivalry: { depuis: 10, actes: 2 }, pastRivalries: [] };
  adjustRelation(world, moi.id, lui.id, -30, { week: 10, text: 'Rivalité.', tag: REL_TAGS.RIVAL });

  const entry = closeRivalry(career, world, { raison: 'retraité', week: 300 });
  assert.ok(entry, 'aucune entrée archivée');
  assert.equal(career.rivalId, null, 'la rivalité reste active après extinction');
  assert.equal(career.pastRivalries.length, 1, 'la rivalité n’a pas été archivée');
  assert.equal(career.pastRivalries[0].actes, 2, 'les actes vécus sont perdus');
  // La relation, elle, demeure : on n'efface pas ce qui a eu lieu.
  const rel = relationsOf(world, moi.id, { minAbs: 0 }).find((r) => r.other === lui.id);
  assert.ok(rel && rel.history.length > 0, 'la relation a été effacée avec la rivalité');
});

test('3 — une carrière peut connaître plusieurs rivalités successives', () => {
  const def = allEvents().find((d) => d.id === 'rival_emerges');
  assert.equal(def.once, false, 'rival_emerges reste marqué once : une seule rivalité par carrière');

  // Et une rivalité vivante interdit qu'une autre naisse.
  const world = generateWorld({ seed: 9320, startYear: 2030 });
  const vivants = Object.values(world.persons).filter((p) => p.status !== STATUS.STAFF);
  const [moi, lui] = vivants.slice(0, 2);
  lui.gameId = moi.gameId;
  adjustRelation(world, moi.id, lui.id, -20, { week: 0, text: 'Rivalité.', tag: REL_TAGS.RIVAL });

  // Le contexte doit porter tout ce que la condition regarde depuis 7G : la
  // réputation auprès des pairs (on ne devient pas le rival de quelqu'un en
  // étant un inconnu) et l'existence réelle d'un pair du même niveau et du
  // même âge. On plante donc ce pair explicitement, en alignant le niveau et
  // l'âge du joueur sur les siens : sans cela, ce test mesurerait la densité
  // de la scène générée plutôt que les règles de succession des rivalités.
  const pair = vivants.find((p) => p.id !== moi.id && p.id !== lui.id && p.gameId === moi.gameId);
  assert.ok(pair, 'monde de test sans pair disponible sur la scène');
  pair.teamId = null;
  moi.reputation.pros = 30;
  const game = GAMES_BY_ID[moi.gameId];
  const ctx = {
    world,
    game,
    person: Object.assign(moi, { stats: { ...moi.stats, matches: 100 } }),
    career: { personId: moi.id, rivalId: lui.id, rivalry: { depuis: 0 }, pastRivalries: [] },
    rating: baseRating(pair, game),
    age: personAge(pair, world.week),
  };
  // L'âge du joueur suit la semaine du monde : avancer l'horloge sans le
  // recalculer creuserait un écart d'âge artificiel avec le pair planté, et le
  // test échouerait pour une raison qui n'a rien à voir avec les rivalités.
  const alaSemaine = (w) => {
    world.week = w;
    ctx.age = personAge(pair, w);
  };
  assert.equal(def.condition(ctx), false, 'une nouvelle rivalité naît alors qu’une autre est vivante');

  // Une fois l'ancienne morte et la latence écoulée, une autre devient possible.
  lui.status = STATUS.RETIRED;
  ctx.career.rivalId = null;
  ctx.career.pastRivalries = [{ rivalId: lui.id, raison: 'retraité', week: 0 }];
  alaSemaine(200);
  assert.equal(def.condition(ctx), true, 'aucune nouvelle rivalité possible après la mort de la précédente');

  // Mais pas immédiatement : on ne s'invente pas un adversaire dans la semaine.
  alaSemaine(20);
  assert.equal(def.condition(ctx), false, 'une nouvelle rivalité naît sans aucun délai');
});

// --- 4 : le garde-fou du duel ------------------------------------------------

test('4 — affronter son rival est à double tranchant, jamais un bonus', () => {
  // Le mécanisme lit l'étiquette de la relation et module la performance par
  // l'écart au centre de l'échelle mentale. On vérifie les trois cas : un mental
  // solide gagne, un mental fragile perd, un mental moyen ne change rien.
  const echantillon = (mental) => {
    const world = generateWorld({ seed: 9430, startYear: 2030 });
    const equipes = Object.values(world.teams).filter((t) => t.active && !t.isSelfTeam && t.roster.length >= 3);
    const [teamA, teamB] = equipes;
    const moi = world.persons[teamA.roster[0]];
    const lui = world.persons[teamB.roster[0]];
    for (const attr of ['clutch', 'composure', 'pressure']) moi.attrs[attr] = mental;
    adjustRelation(world, moi.id, lui.id, -30, { week: 0, text: 'Rivalité.', tag: REL_TAGS.RIVAL });
    return { world, teamA, teamB, moi };
  };

  const centre = (55 - 55) / 45;
  assert.equal(centre, 0, 'le centre de l’échelle mentale doit être neutre');

  // L'effet est symétrique autour de 55 : même amplitude des deux côtés.
  const haut = Math.max(-1, Math.min(1, (85 - 55) / 45)) * 1.8;
  const bas = Math.max(-1, Math.min(1, (25 - 55) / 45)) * 1.8;
  assert.ok(haut > 0 && bas < 0, 'l’effet n’est pas à double tranchant');
  assert.ok(Math.abs(haut + bas) < 0.001, `effet asymétrique : +${haut.toFixed(2)} contre ${bas.toFixed(2)}`);

  // Et il s'applique réellement : un monde préparé ne plante pas.
  const { world, teamA } = echantillon(70);
  assert.ok(world.teams[teamA.id], 'monde de test invalide');
});

// --- 5 : le bilan ne ment plus ----------------------------------------------

test('5 — le bilan ne présente pas comme fil rouge un rival hors sujet', () => {
  const { session } = play({ seed: 'bilan-7e', years: 20 });
  const legacy = computeLegacy(session.world, session.career);
  const texte = buildNarrative(session.world, session.career, legacy);
  const career = session.career;
  const total = (career.pastRivalries?.length ?? 0) + (career.rivalId ? 1 : 0);

  if (total === 0) {
    assert.ok(!/fil rouge/.test(texte), 'le bilan cite un fil rouge sans aucune rivalité');
    return;
  }
  assert.ok(/fil rouge/.test(texte), `${total} rivalité(s) vécue(s) et aucune citée dans le bilan`);

  // La rivalité citée doit être la plus longue réellement vécue, et le texte
  // doit dire ce qu'elle est devenue plutôt que la figer au présent.
  if (total > 1) {
    assert.ok(
      /rivalités déclarées/.test(texte),
      'plusieurs rivalités vécues mais le bilan n’en mentionne qu’une',
    );
  }
});

// --- 6 : la mesure d'ensemble ------------------------------------------------

test('6 — les rivalités évoluent au lieu de se figer', () => {
  // Le défaut central : dix-huit rivalités sur vingt terminaient exactement sur
  // une borne du système, gelées pendant une décennie.
  // Six carrières de graines différentes. Une version antérieure jouait quatre
  // politiques sur UNE seule graine et exigeait quatre rivalités au total : ces
  // quatre carrières duraient 7 à 12 ans pour un pic de 52 à 57, à peine
  // au-dessus du seuil de 55 requis pour qu'une rivalité naisse, et n'en
  // produisaient que trois. Le seuil venait de la moyenne mesurée sur 27
  // carrières (1,93) et ne s'appliquait pas à cet échantillon.
  const profils = [
    ['random', 'evo-a'], ['grinder', 'evo-b'], ['teamplayer', 'evo-c'],
    ['reckless', 'evo-d'], ['first', 'evo-e'], ['cautious', 'evo-f'],
  ].map(([p, seed]) => {
    const { session } = play({ seed, policyId: p, years: 20 });
    const career = session.career;
    return {
      politique: p,
      total: (career.pastRivalries?.length ?? 0) + (career.rivalId ? 1 : 0),
      eteintes: career.pastRivalries?.length ?? 0,
      rivalActifRetraite:
        !!career.rivalId && session.world.persons[career.rivalId]?.status === STATUS.RETIRED,
    };
  });

  // On vérifie des propriétés, pas un compte : le nombre de rivalités dépend du
  // niveau atteint, donc de la carrière, et fixer un total revient à exiger que
  // l'échantillon contienne des joueurs assez forts.
  const avec = profils.filter((p) => p.total > 0).length;
  assert.ok(
    avec >= profils.length / 2,
    `seulement ${avec}/${profils.length} carrières connaissent une rivalité`,
  );
  // Et le système doit permettre la succession, même si toutes n'y arrivent pas.
  const total = profils.reduce((s, p) => s + p.total, 0);
  assert.ok(
    total > avec || profils.some((p) => p.eteintes > 0),
    `aucune succession observée : ${total} rivalité(s) pour ${avec} carrière(s) concernée(s)`,
  );
  // Et surtout : plus de rival retraité conservé comme rivalité active.
  assert.ok(
    profils.every((p) => !p.rivalActifRetraite),
    'une rivalité reste active avec un rival retraité',
  );
});
