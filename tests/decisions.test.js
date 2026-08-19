/**
 * Tests des décisions contextuelles (phase 2, étape 7C).
 *
 * Le défaut corrigé, mesuré au diagnostic : le menu d'une décision ne dépendait
 * presque jamais de la situation. Sur 78 choix du catalogue, 3 étaient
 * conditionnels et aucun libellé ne dépendait du contexte, alors que
 * `presentEvent` sait filtrer par `available` et accepter des libellés
 * fonctionnels depuis l'origine. Mesuré en jeu, 29 décisions sur 32 offraient
 * toujours exactement le même menu — un joueur revoyait `viral_moment` onze
 * fois par carrière, avec les mêmes mots et les mêmes options.
 *
 * Deux garde-fous encadrent la correction, et ce sont eux que ces tests
 * protègent :
 *
 *  1. **La contextualité ne lit que du ressenti.** Une décision ne peut être
 *     modifiée que par une information que le joueur pourrait raisonnablement
 *     connaître : être à bout, être sur le banc, être fauché, être inconnu.
 *     Jamais par son plafond caché, jamais par la valeur future d'un choix.
 *
 *  2. **Aucun choix ne doit devenir universellement gagnant.** Faire compter les
 *     décisions ne doit pas transformer le jeu en arbre où une réponse est
 *     mathématiquement supérieure. C'est le défaut inverse, et il serait pire.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { RNG, normalizeSeed } from '../src/engine/rng.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import { initEvents, allEvents } from '../src/engine/events/index.js';
import {
  createSession,
  advanceWeek,
  resolveDecision,
  acceptOffer,
  seekTeam,
  canSeekTeam,
  foundTeam,
  canFoundTeam,
  setRoutine,
  buildContext,
} from '../src/engine/simulation.js';
import { serializeSession, deserializeSession } from '../src/engine/save.js';
import { createPolicyState, pickChoice, POLICY_IDS } from '../src/engine/audit/policies.js';
import { randomPlayerConfig } from '../src/engine/audit/runner.js';
import { situationOf, PLACE, VISIBILITE, ARGENT, SAISON_DE_VIE } from '../src/engine/events/situation.js';
import { LOAD_STATES } from '../src/engine/load.js';
import { computeLegacy } from '../src/engine/legacy.js';
import { baseRating } from '../src/engine/person.js';
import { GAMES_BY_ID } from '../src/data/games.js';

initEvents({ force: true });

// --- Utilitaires -------------------------------------------------------------

const src = (fn) => (typeof fn === 'function' ? fn.toString() : String(fn ?? ''));

/**
 * Retire les commentaires avant d'inspecter du source.
 *
 * Sans cela, un commentaire qui *explique* qu'on ne lit pas les données cachées
 * fait échouer le test qui vérifie qu'on ne les lit pas — c'est exactement ce
 * qui s'est produit sur `situation.js`, dont l'en-tête mentionne
 * `person.hidden` pour dire qu'il n'y touche jamais. Le garde-fou doit porter
 * sur le code, pas sur la prose qui le documente.
 */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function decisions() {
  return allEvents().filter((d) => (d.choices ?? []).length > 0);
}

function allChoices() {
  return decisions().flatMap((d) => d.choices.map((c) => ({ def: d, choice: c })));
}

/** Joue une carrière en pilote automatique, en collectant ce qu'on lui demande. */
function play({ seed, policyId = 'random', years = 20, onDecision = null }) {
  const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
  const st = createPolicyState(policyId, normalizeSeed(`${seed}:policy`));
  const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
  if (st.policy.routine) setRoutine(session, st.policy.routine);
  const person = session.world.persons[session.career.personId];
  let w = 0;
  while (w < years * WEEKS_PER_YEAR && !session.career.retired) {
    const report = advanceWeek(session);
    w++;
    const d = report.decision;
    if (d && !d.resolved) {
      if (onDecision) onDecision(d, session);
      const c = pickChoice(st, d.choices);
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

// --- 1 à 3 : la structure de la contextualité --------------------------------

test('1 — les menus dépendent réellement de la situation', () => {
  const defs = decisions();
  const variables = defs.filter((d) => d.choices.some((c) => c.available));
  assert.ok(
    variables.length >= 15,
    `seulement ${variables.length}/${defs.length} décisions ont un menu variable : le joueur revoit toujours les mêmes options`,
  );

  const choices = allChoices();
  const conditionnels = choices.filter(({ choice }) => choice.available);
  assert.ok(
    conditionnels.length / choices.length >= 0.18,
    `${Math.round((100 * conditionnels.length) / choices.length)} % de choix conditionnels`,
  );

  // Et les textes doivent parler de la situation, pas seulement les options.
  const contextuels = choices.filter(
    ({ choice }) => typeof choice.label === 'function' || typeof choice.hint === 'function',
  );
  assert.ok(
    contextuels.length >= 15,
    `seulement ${contextuels.length} libellés ou indices dépendent du contexte`,
  );
});

test('2 — les conséquences ne sont presque jamais forfaitaires', () => {
  // « Forfaitaire » : ni lecture d'état, ni tirage. Le même effet, toujours.
  // Le motif couvre les deux écritures, y compris la déstructuration
  // (`const { rng, fx, person } = ctx`) qui trompait une version antérieure de
  // l'instrument et gonflait le chiffre de 28 % à 32 %.
  const lit = /ctx\b|\brng\.|\bperson\.|\bcareer\.|\bteam\.|\bworld\.|\bsituation\b/;
  const choices = allChoices();
  const forfait = choices.filter(({ choice }) => !lit.test(src(choice.apply)));
  const part = forfait.length / choices.length;
  assert.ok(
    part <= 0.12,
    `${Math.round(part * 100)} % de conséquences forfaitaires (${forfait.map((f) => `${f.def.id}/${f.choice.id}`).join(', ')})`,
  );
});

test('3 — la contextualité ne lit que ce que le joueur peut savoir', () => {
  // Le garde-fou central de l'étape. Une condition de choix, un libellé ou un
  // indice n'a pas le droit de consulter les données cachées : ni le plafond,
  // ni la croissance, ni la longévité. Sinon le monde répondrait à des chiffres
  // que le joueur ne verra jamais, et les décisions cesseraient d'être les
  // siennes pour devenir la résolution d'une fonction d'optimisation.
  const interdits = /person\.hidden|\.hidden\b|weightedCeiling|ceilings|hidden\.growth|hidden\.longevity/;
  const fautifs = [];
  for (const { def, choice } of allChoices()) {
    for (const [quoi, fn] of [
      ['available', choice.available],
      ['label', choice.label],
      ['hint', choice.hint],
    ]) {
      if (typeof fn !== 'function') continue;
      if (interdits.test(codeOnly(src(fn)))) fautifs.push(`${def.id}/${choice.id} (${quoi})`);
    }
  }
  assert.deepEqual(fautifs, [], `des décisions lisent des données cachées : ${fautifs.join(', ')}`);

  // Et le vocabulaire lui-même doit rester propre : c'est le point de passage
  // unique, donc le seul endroit à vérifier.
  const source = readFileSync(new URL('../src/engine/events/situation.js', import.meta.url), 'utf8');
  assert.ok(
    !/\.hidden\b/.test(codeOnly(source)),
    'le vocabulaire du ressenti accède aux données cachées du personnage',
  );
});

// --- 4 et 5 : le vocabulaire du ressenti ------------------------------------

test('4 — la situation nomme des états que le joueur reconnaîtrait', () => {
  const { session } = play({ seed: 'sit-1', years: 6 });
  const ctx = buildContext(session);
  const s = ctx.situation;

  for (const clef of ['etatDeCharge', 'aBout', 'place', 'visibilite', 'argent', 'saisonDeVie', 'forme']) {
    assert.ok(s[clef] !== undefined, `la situation n’expose pas « ${clef} »`);
  }
  assert.ok(Object.values(PLACE).includes(s.place), `place inattendue : ${s.place}`);
  assert.ok(Object.values(VISIBILITE).includes(s.visibilite), `visibilité inattendue : ${s.visibilite}`);
  assert.ok(Object.values(ARGENT).includes(s.argent), `situation d’argent inattendue : ${s.argent}`);
  assert.ok(Object.values(SAISON_DE_VIE).includes(s.saisonDeVie), `saison de vie inattendue : ${s.saisonDeVie}`);
  // Cohérence : on ne peut pas être titulaire et sans équipe.
  assert.equal(s.estTitulaire && s.sansEquipe, false, 'situation incohérente : titulaire et sans équipe');
  assert.equal(s.surLeBanc && s.estTitulaire, false, 'situation incohérente : titulaire et remplaçant');
});

test('5 — l’état de charge change réellement le menu proposé', () => {
  // On construit deux contextes identiques hormis la charge, et on vérifie que
  // les décisions n'offrent pas les mêmes options. C'est ce qui manquait : trois
  // événements sur trente-neuf lisaient la charge, et c'étaient les trois
  // événements de rupture.
  const { session } = play({ seed: 'charge-menu', years: 8 });
  const ctx = buildContext(session);
  const person = ctx.person;

  const menusPour = (etat, extra = {}) => {
    person.load = { ...person.load, ...extra, state: etat };
    const c = buildContext(session);
    const out = new Map();
    for (const def of decisions()) {
      const dispo = def.choices.filter((ch) => (ch.available ? safe(ch.available, c) : true)).map((ch) => ch.id);
      out.set(def.id, dispo.join('+'));
    }
    return out;
  };
  const safe = (fn, c) => {
    try {
      return !!fn(c);
    } catch {
      return false;
    }
  };

  const frais = menusPour(LOAD_STATES.FRESH, { value: 10, heavyStreak: 0, episodes: 0 });
  const cuit = menusPour(LOAD_STATES.DRAINED, { value: 85, heavyStreak: 60, episodes: 1 });

  const differents = [...frais.keys()].filter((id) => frais.get(id) !== cuit.get(id));
  assert.ok(
    differents.length >= 5,
    `seulement ${differents.length} décision(s) changent de menu entre un joueur frais et un joueur épuisé`,
  );
});

// --- 6 : même situation, pas toujours la même décision ----------------------

test('6 — une même situation ne produit pas toujours la même décision', () => {
  // Le test demandé explicitement : il ne doit pas exister de chaîne rigide
  // « situation X → événement Y → toujours choix A ». On mesure la diversité des
  // événements rencontrés à un même stade de carrière, sur des graines
  // différentes — c'est-à-dire des joueurs différents dans des situations
  // comparables.
  const parStade = new Map(); // stade -> Set d'événements rencontrés
  for (let i = 0; i < 8; i++) {
    play({
      seed: `variance:${i}`,
      policyId: 'random',
      years: 10,
      onDecision: (d, session) => {
        const annees = Math.floor(session.career.counters.weeks / WEEKS_PER_YEAR);
        const stade = annees <= 2 ? 'début' : annees <= 6 ? 'milieu' : 'fin';
        if (!parStade.has(stade)) parStade.set(stade, new Set());
        parStade.get(stade).add(d.id);
      },
    });
  }
  for (const [stade, vus] of parStade) {
    assert.ok(
      vus.size >= 4,
      `seulement ${vus.size} type(s) de décision au stade « ${stade} » : la carrière suit un rail`,
    );
  }
});

// --- 7 : aucun choix universellement gagnant --------------------------------

test('7 — aucun choix n’est gagnant dans toutes les situations', () => {
  // Mesure par bifurcation contrôlée : la même carrière, à la même semaine, dans
  // le même état, avec le même état du générateur aléatoire, rejouée une fois
  // par option. C'est la seule façon de comparer des choix et non des joueurs.
  //
  // On ne cherche pas à ce qu'aucun choix ne soit meilleur — un choix doit
  // pouvoir changer une trajectoire. On vérifie qu'aucun ne l'est *partout* :
  // pour chaque décision rencontrée assez souvent, une autre option doit gagner
  // au moins une fois.
  const SUIVI = 3;
  const resultats = new Map(); // `${eventId}|${choiceId}` -> [gagnant ?]

  const bilan = (session, seed) => {
    const st = createPolicyState('random', normalizeSeed(`${seed}:suite`));
    const person = session.world.persons[session.career.personId];
    let w = 0;
    while (w < SUIVI * WEEKS_PER_YEAR && !session.career.retired) {
      const rep = advanceWeek(session);
      w++;
      if (rep.decision && !rep.decision.resolved) {
        const c = pickChoice(st, rep.decision.choices);
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
    return computeLegacy(session.world, session.career).global;
  };

  for (let i = 0; i < 6; i++) {
    const seed = `dom:${i}`;
    const player = randomPlayerConfig(new RNG(normalizeSeed(`${seed}:config`)));
    const st = createPolicyState('random', normalizeSeed(`${seed}:policy`));
    const session = createSession({ seed, startYear: 2030, difficulty: 'standard', player });
    const person = session.world.persons[session.career.personId];
    let forks = 0;
    let w = 0;
    while (w < 12 * WEEKS_PER_YEAR && !session.career.retired && forks < 4) {
      const rep = advanceWeek(session);
      w++;
      const d = rep.decision;
      if (d && !d.resolved && d.choices.length >= 2) {
        const snap = serializeSession(session);
        const scores = [];
        for (const c of d.choices) {
          const branche = deserializeSession(snap);
          resolveDecision(branche, c.id);
          scores.push({ id: c.id, legacy: bilan(branche, `${seed}:${w}:${c.id}`) });
        }
        const meilleur = scores.reduce((a, b) => (b.legacy > a.legacy ? b : a));
        for (const s of scores) {
          const cle = `${d.id}|${s.id}`;
          if (!resultats.has(cle)) resultats.set(cle, []);
          resultats.get(cle).push(s.id === meilleur.id);
        }
        forks++;
        const c = pickChoice(st, d.choices);
        if (c) resolveDecision(session, c.id);
      } else if (d && !d.resolved) {
        const c = pickChoice(st, d.choices ?? []);
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
  }

  assert.ok(resultats.size > 0, 'aucune bifurcation mesurée : le test ne vérifie rien');

  // Un choix qui gagne à chaque fois qu'il est offert, sur un nombre suffisant
  // de bifurcations, est un choix dominant.
  const dominants = [...resultats.entries()]
    .filter(([, gagnes]) => gagnes.length >= 4 && gagnes.every(Boolean))
    .map(([cle, gagnes]) => `${cle} (${gagnes.length}/${gagnes.length})`);
  assert.deepEqual(
    dominants,
    [],
    `choix gagnant dans toutes les situations mesurées : ${dominants.join(', ')}`,
  );
});
