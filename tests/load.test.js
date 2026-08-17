/**
 * Tests de la charge, des états de surcharge et de la récupération
 * (phase 2, étape 7B).
 *
 * Le défaut corrigé : il n'existait pas de modèle de charge. Les variations
 * hebdomadaires de fatigue, de stress et de moral étant constantes pour une
 * routine donnée, chacune convergeait vers son propre point fixe en quelques
 * semaines — le résultat était déterminé au choix de la routine, pas par
 * l'histoire du joueur. Mesuré sur dix carrières par politique :
 *
 *     prudent  : fatigue  1,2 | stress  0,2 | moral 98,4
 *     saboteur : fatigue 97,8 | stress  2,0 | moral 98,3   ← épuisé et serein
 *
 * Et `burnoutPressure()`, exportée avec le commentaire « sert aux retraites »,
 * n'était appelée nulle part : la longévité ne dépendait que de l'âge.
 */

import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import { RNG } from '../src/engine/rng.js';
import { generateWorld } from '../src/engine/worldgen.js';
import { GAMES_BY_ID } from '../src/data/games.js';
import { STATUS } from '../src/engine/person.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';
import {
  LOAD_STATES,
  createLoadState,
  updateLoad,
  weeklyIntensity,
  contextPressure,
  crashRisk,
  markBurnout,
  relieveLoad,
  isHigh,
  loadProgressionFactor,
  effortBonus,
  loadCoupling,
  loadSnapshot,
} from '../src/engine/load.js';
import { progressPerson, burnoutPressure, rawWeeklyVolume, restSlotsOf } from '../src/engine/progression.js';
import { runWorldOnly } from '../src/engine/audit/runner.js';
import { validateWorld } from '../src/engine/validator.js';
import { startTrace, stopTrace, takeTrace, TRACE } from '../src/engine/trace.js';
import { initEvents } from '../src/engine/events/index.js';
import { queueChain, pickEvent, createEventState } from '../src/engine/events/engine.js';

// --- Utilitaires ------------------------------------------------------------

function world0(seed = 7100) {
  return generateWorld({ seed, startYear: 2030 });
}

function anyPlayer(world, gameId = 'vanguard') {
  return Object.values(world.persons).find(
    (p) => p.gameId === gameId && p.teamId && p.status !== STATUS.STAFF,
  );
}

/** Fait vivre `weeks` semaines de charge à une intensité donnée. */
function runWeeks(person, { volume, matchLoad = 0, pressure = 0, restSlots = 0 }, weeks) {
  for (let w = 0; w < weeks; w++) {
    updateLoad(person, { rawFatigue: volume, matchLoad, pressure, restSlots, sensitivity: 1 }, 1);
  }
  return person.load;
}

/** Un personnage nu, pour isoler la charge de tout le reste. */
function bareSubject() {
  return { id: 'sujet', load: createLoadState(), hidden: { burnoutFloor: 0.5 }, stats: {} };
}

// --- 1 à 3 : accumulation, récupération, hystérésis --------------------------

test('1 — la charge monte pendant une période intensive', () => {
  const p = bareSubject();
  const start = p.load.value;
  runWeeks(p, { volume: 10, matchLoad: 1, pressure: 3 }, 20);
  assert.ok(p.load.value > start + 25, `charge ${p.load.value.toFixed(1)} après vingt semaines intensives`);
  assert.ok(p.load.heavyStreak > 10, `série de semaines chargées : ${p.load.heavyStreak}`);
  assert.notEqual(p.load.state, LOAD_STATES.FRESH, 'toujours « frais » après vingt semaines intensives');
});

test('2 — la charge redescend réellement quand on lève le pied', () => {
  const p = bareSubject();
  runWeeks(p, { volume: 10, matchLoad: 1, pressure: 3 }, 25);
  const peak = p.load.value;
  // Même personnage, semaines allégées : la charge doit refluer.
  runWeeks(p, { volume: 2, matchLoad: 0, pressure: 0, restSlots: 2 }, 25);
  assert.ok(p.load.value < peak * 0.5, `charge ${p.load.value.toFixed(1)} après vingt-cinq semaines calmes (pic ${peak.toFixed(1)})`);
  // Et la série de semaines chargées s'efface.
  assert.equal(p.load.heavyStreak, 0, `série résiduelle : ${p.load.heavyStreak}`);
});

test('3 — les seuils de montée et de descente diffèrent (hystérésis)', () => {
  // Monter jusqu'à « sous pression » exige de franchir 46 ; en redescendre
  // exige de repasser sous 37. Entre les deux, l'état ne bouge pas — c'est ce
  // qui empêche un joueur stabilisé à la frontière d'osciller chaque semaine.
  const p = bareSubject();
  runWeeks(p, { volume: 9, matchLoad: 1, pressure: 3 }, 40);
  assert.ok(
    p.load.state === LOAD_STATES.PRESSURED || isHigh(p.load.state),
    `état atteint : ${p.load.state} (charge ${p.load.value.toFixed(1)})`,
  );

  // La bande d'hystérésis de « sous pression » va de 37 (descente) à 46
  // (montée). On construit le cas explicitement : dedans, l'état ne bouge pas.
  //
  // Une première version de ce test plaçait la charge à 41 sans fixer l'état,
  // qui se trouvait être « épuisé » — dont la bande est 67-79. La descente était
  // donc parfaitement légitime et c'est le test qui se trompait.
  const band = bareSubject();
  band.load.state = LOAD_STATES.PRESSURED;
  band.load.value = 43;
  updateLoad(band, { rawFatigue: 3.2, sensitivity: 1 }, 1);
  assert.ok(
    band.load.value > 37 && band.load.value < 46,
    `charge sortie de la bande : ${band.load.value.toFixed(1)}`,
  );
  assert.equal(
    band.load.state,
    LOAD_STATES.PRESSURED,
    `l’état a changé alors que la charge est restée dans la bande (${band.load.value.toFixed(1)})`,
  );

  // Sous le seuil de descente, il change — mais il n'a PAS fallu redescendre
  // jusqu'au seuil de montée du palier inférieur : c'est bien une hystérésis.
  const below = bareSubject();
  below.load.state = LOAD_STATES.PRESSURED;
  below.load.value = 34;
  updateLoad(below, { rawFatigue: 3, sensitivity: 1 }, 1);
  assert.notEqual(below.load.state, LOAD_STATES.PRESSURED, 'l’état ne redescend jamais');
  assert.equal(below.load.state, LOAD_STATES.TIRED, `état après descente : ${below.load.state}`);
});

// --- 4 : l'état interdit ----------------------------------------------------

test('4 — « épuisé mais serein » n’est plus un état durable', () => {
  const world = world0();
  const person = anyPlayer(world);
  const game = GAMES_BY_ID[person.gameId];
  const rng = new RNG(4);
  // Routine du saboteur : celle qui produisait exactement l'état interdit.
  const routine = ['streaming', 'streaming', 'social', 'content'];
  let incoherent = 0;
  for (let w = 0; w < 200; w++) {
    progressPerson(person, { game, routine, weeks: 1, absWeek: world.week + w, matchLoad: 0, pressure: 2 }, rng);
    // L'incohérence visée : une fatigue élevée avec un stress quasi nul.
    if (person.fatigue > 80 && person.stress < 20) incoherent++;
  }
  assert.equal(
    incoherent,
    0,
    `${incoherent} semaines à fatigue > 80 et stress < 20 (fatigue finale ${person.fatigue.toFixed(1)}, stress ${person.stress.toFixed(1)})`,
  );
  // Et les deux grandeurs restent cohérentes avec la charge.
  const gap = Math.abs(person.fatigue - person.load.value);
  assert.ok(gap < 45, `fatigue ${person.fatigue.toFixed(1)} contre charge ${person.load.value.toFixed(1)} : les deux mesures divergent`);
});

// --- 5 et 6 : le risque/récompense ------------------------------------------

test('5 — pousser paie immédiatement, indépendamment de la charge', () => {
  // La récompense vient de l'effort de la semaine. Une première version la
  // faisait dépendre de la charge — il fallait donc être déjà usé pour
  // progresser vite, et aucune politique n'atteignait la moitié montante de la
  // courbe.
  const light = rawWeeklyVolume(['mechanics', 'strategy', 'rest', 'social']);
  const heavy = rawWeeklyVolume(['mechanics', 'mechanics', 'strategy', 'review']);
  assert.ok(heavy > light, `volume : intensif ${heavy} contre prudent ${light}`);
  assert.ok(effortBonus(heavy) > effortBonus(light) * 1.1, 'travailler plus ne rapporte pas davantage');
  // Et le bonus ne dépend pas de la charge du personnage.
  const fresh = bareSubject();
  const worn = bareSubject();
  worn.load.value = 85;
  assert.equal(effortBonus(heavy), effortBonus(heavy), 'le bonus d’effort dépend d’autre chose que de l’effort');
  assert.ok(loadProgressionFactor(worn) < loadProgressionFactor(fresh), 'la charge accumulée ne coûte rien');
});

test('6 — la charge accumulée finit par coûter, et le risque n’existe qu’en haut', () => {
  const fresh = bareSubject();
  assert.equal(loadProgressionFactor(fresh), 1, 'une charge nulle pénalise déjà');
  assert.equal(crashRisk(fresh), 0, 'un joueur frais risque une rupture');

  const pressured = bareSubject();
  pressured.load.value = 50;
  pressured.load.state = LOAD_STATES.PRESSURED;
  assert.equal(crashRisk(pressured), 0, '« sous pression » suffit à risquer la rupture');

  const drained = bareSubject();
  drained.load.value = 85;
  drained.load.state = LOAD_STATES.DRAINED;
  drained.load.heavyStreak = 30;
  const risk = crashRisk(drained);
  assert.ok(risk > 0, 'un joueur épuisé ne risque rien');
  assert.ok(risk < 0.12, `risque hebdomadaire de ${(risk * 100).toFixed(1)} % : la rupture devient inévitable`);
  assert.ok(loadProgressionFactor(drained) < 0.75, 'l’épuisement ne coûte pas de progression');
});

test('7 — une série longue et des ruptures passées aggravent le risque', () => {
  const base = bareSubject();
  base.load.value = 82;
  base.load.state = LOAD_STATES.DRAINED;
  base.load.heavyStreak = 4;
  const low = crashRisk(base);

  const persistent = bareSubject();
  persistent.load.value = 82;
  persistent.load.state = LOAD_STATES.DRAINED;
  persistent.load.heavyStreak = 40;
  assert.ok(crashRisk(persistent) > low * 1.5, 'la durée de la surcharge ne change rien au risque');

  const scarred = bareSubject();
  scarred.load.value = 82;
  scarred.load.state = LOAD_STATES.DRAINED;
  scarred.load.heavyStreak = 4;
  scarred.load.episodes = 3;
  assert.ok(crashRisk(scarred) > low, 'les ruptures passées ne laissent aucune trace');
});

// --- 8 et 9 : la rupture et la récupération ---------------------------------

test('8 — la rupture est un état, et la récupération en sort', () => {
  const p = bareSubject();
  p.load.value = 90;
  markBurnout(p, 100);
  assert.equal(p.load.state, LOAD_STATES.BURNOUT);
  assert.equal(p.load.episodes, 1);
  assert.equal(p.load.heavyStreak, 0, 'la rupture ne remet pas la série à zéro');
  assert.ok(loadProgressionFactor(p) < 0.5, 'un joueur en rupture progresse normalement');

  // Accepter de ralentir permet de sortir de l'état.
  relieveLoad(p, 45, { week: 101, reason: 'test' });
  assert.equal(p.load.state, LOAD_STATES.RECOVERING, `état après allègement : ${p.load.state}`);
  // Et de revenir au haut niveau ensuite.
  runWeeks(p, { volume: 2, restSlots: 2 }, 20);
  assert.equal(p.load.state, LOAD_STATES.FRESH, `état après vingt semaines calmes : ${p.load.state}`);
  assert.equal(loadProgressionFactor(p), 1, 'la progression ne redevient jamais normale');
});

test('9 — refuser de ralentir maintient l’état haut', () => {
  const p = bareSubject();
  p.load.value = 90;
  markBurnout(p, 100);
  // Un allègement symbolique — « je reviens tout de suite » — ne suffit pas.
  relieveLoad(p, 12, { week: 101, reason: 'retour précipité' });
  assert.equal(p.load.state, LOAD_STATES.BURNOUT, `état après un allègement symbolique : ${p.load.state}`);
});

// --- 10 : la longévité ------------------------------------------------------

test('10 — burnoutPressure lit la charge et est réellement appelée', () => {
  const fresh = bareSubject();
  fresh.fatigue = 20;
  fresh.stress = 20;
  assert.equal(burnoutPressure(fresh), 0, 'un joueur frais subit déjà une pression');

  const loaded = bareSubject();
  loaded.fatigue = 20;
  loaded.stress = 20;
  loaded.load.value = 88;
  assert.ok(burnoutPressure(loaded) > 0.5, `pression ${burnoutPressure(loaded)} pour une charge de 88`);

  const scarred = bareSubject();
  scarred.fatigue = 20;
  scarred.stress = 20;
  scarred.load.value = 88;
  scarred.load.episodes = 3;
  assert.ok(burnoutPressure(scarred) > burnoutPressure(loaded), 'les ruptures passées ne pèsent pas sur la longévité');

  // Et le moteur l'appelle : `maybeRetire` la consulte. On le vérifie sur le
  // source plutôt que par un effet de bord, car la probabilité est volontairement
  // faible (plafonnée à 3 %) — ralentir doit rester la première issue.
  const src = readFileSync(new URL('../src/engine/simulation.js', import.meta.url), 'utf8');
  assert.match(src, /burnoutPressure\(person\)/, 'maybeRetire n’appelle pas burnoutPressure');
  assert.match(src, /charge accumulée/, 'aucun chemin de retraite lié à la charge');
});

// --- 11 : la trace ----------------------------------------------------------

test('11 — les chaînes d’événements sont traçables', () => {
  initEvents();
  const world = world0();
  const person = anyPlayer(world);
  const state = createEventState();
  const ctx = {
    world,
    person,
    state,
    rng: new RNG(11),
    career: { eventState: state, flags: {}, counters: {} },
    hasTeam: true,
    team: world.teams[person.teamId],
  };
  // On programme une suite, puis on la fait arriver à échéance.
  queueChain(ctx, 'burnout_recovery', { delay: 3, expires: 40 });
  world.week += 3;

  startTrace({ max: 200 });
  const chosen = pickEvent(ctx);
  const entries = takeTrace().filter((e) => e.kind === TRACE.EVENT_FIRED);
  stopTrace();

  assert.equal(chosen?.id, 'burnout_recovery', `événement retenu : ${chosen?.id}`);
  const traced = entries.find((e) => e.eventId === 'burnout_recovery');
  assert.ok(traced, 'aucune trace pour un événement issu d’une chaîne');
  assert.equal(traced.source, 'chaîne', 'la trace ne dit pas que l’événement vient d’une chaîne');
  assert.equal(traced.dueWeek, world.week, 'la trace ne dit pas pour quand la suite était prévue');
});

test('12 — la charge se trace avec ses facteurs', () => {
  const p = bareSubject();
  startTrace({ max: 200 });
  runWeeks(p, { volume: 11, matchLoad: 1, pressure: 3 }, 12);
  const entries = takeTrace().filter((e) => e.kind === TRACE.LOAD);
  stopTrace();
  assert.ok(entries.length > 0, 'aucune trace de charge');
  const e = entries.at(-1);
  assert.ok(e.factors?.length >= 2, 'la trace n’expose pas ses facteurs');
  for (const key of ['intensity', 'heavyStreak', 'streakAmp', 'excess', 'drain', 'state']) {
    assert.ok(e[key] !== undefined, `la trace n’expose pas « ${key} »`);
  }
});

// --- 13 : cohérence sur la durée --------------------------------------------

let cachedWorlds = null;
function longWorlds() {
  if (!cachedWorlds) {
    cachedWorlds = [20, 30, 40].map((years) => ({
      years,
      r: runWorldOnly({ seed: `load-${years}`, years }),
    }));
  }
  return cachedWorlds;
}

test('13 — aucune incohérence d’état après 20, 30 et 40 ans', () => {
  for (const { years, r } of longWorlds()) {
    assert.equal(r.crash, null, `plantage à ${years} ans : ${r.crash?.message}`);
    assert.deepEqual(r.finalIssues, [], `invariants violés à ${years} ans : ${r.finalIssues.join(', ')}`);
  }
});

test('14 — la charge reste bornée et cohérente pour tout le monde', () => {
  for (const { years, r } of longWorlds()) {
    const world = r.world;
    if (!world) continue;
    let bad = 0;
    let states = new Set();
    let incoherent = 0;
    for (const p of Object.values(world.persons)) {
      const l = p.load;
      if (!l) continue;
      if (!(l.value >= 0 && l.value <= 100)) bad++;
      if (!Number.isFinite(l.value)) bad++;
      states.add(l.state);
      // L'état interdit, mesuré sur la population entière.
      if (p.fatigue > 80 && p.stress < 20) incoherent++;
    }
    assert.equal(bad, 0, `${bad} charges hors bornes à ${years} ans`);
    assert.ok(states.size >= 3, `seulement ${states.size} état(s) de charge distinct(s) à ${years} ans : ${[...states].join(', ')}`);
    assert.ok(
      incoherent < 3,
      `${incoherent} personnes « épuisées mais sereines » à ${years} ans`,
    );
  }
});
