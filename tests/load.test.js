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
 * Cette incohérence avait un coût mécanique, visible dans la comparaison sur
 * 1400 carrières. Une fatigue de 97 plaçait l'ancien `fatigueFactor` exactement
 * à son plancher de 0,45, soit un malus permanent de −55 % sur la progression —
 * pour une charge réelle de 40 seulement (volume de routine 6,2, un créneau de
 * repos). En faisant dériver la fatigue de la charge, 7B ramène cette fatigue à
 * 48,5, fait monter le stress à 66,4, et le facteur de progression passe de
 * 0,450 à 0,965 : ×2,14. D'où une legacy du saboteur qui monte de 30,88 à 38,86
 * et des titres de 0,06 à 0,26. Ce n'est pas une régression mais la disparition
 * d'une pénalité qui n'était que le symptôme du défaut corrigé.
 *
 * Et `burnoutPressure()`, exportée avec le commentaire « sert aux retraites »,
 * n'était appelée nulle part : la longévité ne dépendait que de l'âge. Elle
 * produit désormais 33 retraites « charge accumulée » sur 1400 carrières
 * (2,4 %), réparties en grinder ×22, reckless ×10, random ×1 — et aucune sur les
 * politiques prudentes.
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
import { contextualStrength } from '../src/engine/match.js';
import { runWorldOnly } from '../src/engine/audit/runner.js';
import { runLoadAudit } from '../src/engine/audit/loadAudit.js';
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

  // La récompense doit **redistribuer**, pas s'ajouter. Une version antérieure
  // valait `1 + volume/11 × 0,46`, donc toujours ≥ 1 : comparée au code d'étape
  // 6, elle retirait un malus que deux politiques sur neuf payaient et versait
  // une prime aux neuf, gonflant le pic médian de 54,3 à 64,7. Cette assertion
  // existait sous une forme tautologique (`effortBonus(heavy) === effortBonus(heavy)`)
  // et n'avait donc rien détecté.
  assert.ok(effortBonus(light) < 1, `une routine légère est récompensée (×${effortBonus(light).toFixed(3)})`);
  assert.ok(effortBonus(heavy) > 1, `une routine lourde n’est pas récompensée (×${effortBonus(heavy).toFixed(3)})`);
  const routines = [
    ['mechanics', 'strategy', 'review', 'rest'], // routine par défaut
    ['mechanics', 'mechanics', 'strategy', 'review'], // grinder
    ['mechanics', 'strategy', 'rest', 'social'], // prudent
    ['mechanics', 'strategy', 'review', 'social'],
    ['scrim', 'review', 'rest', 'social'],
  ];
  const moyenne =
    routines.reduce((s, r) => s + effortBonus(rawWeeklyVolume(r)), 0) / routines.length;
  assert.ok(
    Math.abs(moyenne - 1) < 0.06,
    `moyenne du bonus d’effort ×${moyenne.toFixed(3)} : c’est une prime générale, pas un arbitrage`,
  );

  // Et le coût, lui, ne dépend pas de la routine mais de ce qui s'est accumulé.
  const fresh = bareSubject();
  const worn = bareSubject();
  worn.load.value = 85;
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
  for (const key of ['intensity', 'heavyStreak', 'excess', 'drain', 'state']) {
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

// --- 15 à 18 : le compromis, mesuré par politique ------------------------

let cachedPolicies = null;
function policyAudit() {
  if (!cachedPolicies) {
    cachedPolicies = runLoadAudit({
      perPolicy: 6,
      years: 20,
      policies: ['grinder', 'cautious', 'random', 'saboteur'],
      seedRoot: 'load-test',
    });
  }
  return cachedPolicies;
}

test('15 — pousser paie tôt : le grind mène au moins un horizon précoce', () => {
  const { byPolicy } = policyAudit();
  const g = byPolicy.grinder;
  const c = byPolicy.cautious;
  assert.ok(g && c, 'politiques manquantes');
  // On ne demande pas que le grind domine partout — seulement qu'il existe un
  // horizon précoce où pousser a payé. Sinon le pari n'existe pas (§3).
  const early = [1, 2, 3].filter((y) => (g.ratingAt[y] ?? 0) >= (c.ratingAt[y] ?? 0));
  assert.ok(
    early.length > 0,
    `le grind n’est jamais devant tôt : an 1 ${g.ratingAt[1]}/${c.ratingAt[1]}, an 2 ${g.ratingAt[2]}/${c.ratingAt[2]}, an 3 ${g.ratingAt[3]}/${c.ratingAt[3]}`,
  );
});

test('16 — et coûte tard : le grind accumule et se rompt, le prudent non', () => {
  const { byPolicy } = policyAudit();
  const g = byPolicy.grinder;
  const c = byPolicy.cautious;
  assert.ok(g.condition.load > c.condition.load * 1.5, `charge : grinder ${g.condition.load} contre prudent ${c.condition.load}`);
  assert.ok(g.shareHigh > c.shareHigh, `part d’états hauts : ${g.shareHigh} contre ${c.shareHigh}`);
  assert.ok(g.episodes > c.episodes, `ruptures : ${g.episodes} contre ${c.episodes}`);
  assert.ok(g.years.mean < c.years.mean, `durée : ${g.years.mean} contre ${c.years.mean} ans`);
});

test('17 — la prudence est plus sûre sans être optimale à tous les horizons', () => {
  const { byPolicy } = policyAudit();
  const c = byPolicy.cautious;
  // Plus sûre : aucune rupture, ou presque.
  assert.ok(c.shareWithEpisode < 0.4, `${Math.round(c.shareWithEpisode * 100)} % des carrières prudentes connaissent une rupture`);
  // Mais pas systématiquement devant : une autre politique doit la dépasser
  // à au moins un horizon, sinon la prudence est un choix évident.
  const others = ['grinder', 'random', 'saboteur'].map((id) => byPolicy[id]).filter(Boolean);
  const beaten = [1, 2, 3, 5, 8, 12, 16].some((y) =>
    others.some((o) => (o.ratingAt[y] ?? 0) > (c.ratingAt[y] ?? 0) + 1),
  );
  assert.ok(beaten, 'la routine prudente domine tous les horizons : elle devient le choix évident');
});

test('18 — la charge pèse sur la longévité sans la déterminer', () => {
  const { byPolicy, global } = policyAudit();
  // Des retraites liées à la charge existent…
  const loadRetirements = Object.values(byPolicy).reduce((s, p) => s + p.loadRetirements, 0);
  // …mais elles ne sont pas la règle : la plupart des carrières finissent
  // autrement. Une probabilité hebdomadaire mal dimensionnée avait produit
  // l'inverse — 3 % par semaine valent 79,5 % par an.
  //
  // Cette assertion comparait une somme à elle-même augmentée d'une constante
  // (`loadRetirements < global.loadRetirements + careers * 0,5`) : les deux
  // termes sont le même nombre, elle était donc toujours vraie et ne vérifiait
  // rien. Elle compare maintenant les retraites de charge au total des fins.
  const finished = Object.values(byPolicy).reduce(
    (s, p) => s + Object.entries(p.retirementPaths).filter(([k]) => k !== '(en activité)').reduce((n, [, v]) => n + v, 0),
    0,
  );
  assert.ok(
    loadRetirements <= finished * 0.35,
    `${loadRetirements} retraites de charge sur ${finished} fins de carrière : la charge devient le destin`,
  );
  const g = byPolicy.grinder;
  assert.ok(g.years.mean > 5, `carrières de grinder trop courtes : ${g.years.mean} ans`);
});

test('19 — la charge reste bornée et cohérente pour tout le monde', () => {
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

// --- 20 à 26 : la continuité de l'équilibre ---------------------------------
//
// Défaut corrigé : la charge d'équilibre n'était pas une fonction continue de
// l'intensité. `HEAVY_WEEK` étant un seuil binaire, l'amplification de série
// passait de 1,00 à 1,45 d'un point d'intensité à l'autre, et l'équilibre sautait
// de 53 à 79 ; au-delà d'une intensité de 12, la décroissance plafonnait à 12 par
// semaine et il n'existait plus d'équilibre du tout. Le modèle n'offrait donc que
// deux régimes — « je tiens sans rien payer » sous le seuil de pénalité de 58, ou
// « je finis à 100 » — et le profil « pousse fort mais tient » était absent.
//
// Ces tests mesurent l'équilibre en faisant tourner le moteur jusqu'à
// stabilisation. Aucune formule n'est recopiée : c'est `updateLoad` qui répond.

/**
 * Charge d'équilibre pour une intensité imposée. La sensibilité par défaut valant
 * 1,1, on divise le volume pour que l'intensité effective soit bien la cible.
 */
function equilibrium(intensity, { maxWeeks = 3000 } = {}) {
  const p = bareSubject();
  const volume = intensity / 1.1;
  let last = -1;
  let stable = 0;
  for (let w = 0; w < maxWeeks; w++) {
    updateLoad(p, { rawFatigue: volume, matchLoad: 0, pressure: 0, restSlots: 0, sensitivity: 1, week: w }, 1);
    if (Math.abs(p.load.value - last) < 0.01) {
      if (++stable > 20) break;
    } else stable = 0;
    last = p.load.value;
  }
  return { value: p.load.value, state: p.load.state, load: p.load };
}

test('20 — des intensités croissantes donnent des équilibres distincts et croissants', () => {
  const intensities = [4, 6, 8, 10, 12, 14, 16];
  const values = intensities.map((i) => equilibrium(i).value);
  for (let k = 1; k < values.length; k++) {
    assert.ok(
      values[k] > values[k - 1] + 2,
      `intensité ${intensities[k - 1]} → ${values[k - 1].toFixed(1)} puis ${intensities[k]} → ${values[k].toFixed(1)} : les deux régimes ne se distinguent pas`,
    );
  }
  // Et surtout : plus de saut. Un point d'intensité valait 22 points de charge.
  const fine = [8, 8.5, 9, 9.5, 10].map((i) => equilibrium(i).value);
  for (let k = 1; k < fine.length; k++) {
    const step = fine[k] - fine[k - 1];
    assert.ok(
      step > 0 && step < 6,
      `saut de ${step.toFixed(1)} points de charge autour de l’intensité 9 : la réponse n’est pas continue`,
    );
  }
});

test('21 — aucune intensité bornée ne force mécaniquement la charge à 100', () => {
  for (const i of [12, 16, 20, 24]) {
    const { value } = equilibrium(i);
    assert.ok(
      value < 97,
      `intensité ${i} : équilibre à ${value.toFixed(1)}, la charge sature au lieu de s’équilibrer`,
    );
  }
  // La borne vient de l'équilibre, pas d'un plafond : à intensité extrême la
  // charge doit monter plus haut, pas se figer à la même valeur.
  assert.ok(
    equilibrium(24).value > equilibrium(16).value + 3,
    'l’équilibre ne répond plus à l’intensité dans le haut de la plage : c’est un plafond déguisé',
  );
});

test('22 — une charge soutenue reste élevée sans devenir une rupture', () => {
  // Le régime « pousse fort mais tient » : celui qui n'existait pas.
  const { value, state, load } = equilibrium(13, { maxWeeks: 2000 });
  assert.ok(value > 58, `charge d’équilibre ${value.toFixed(1)} : pousser fort ne coûte rien`);
  assert.ok(value < 79, `charge d’équilibre ${value.toFixed(1)} : pousser fort mène droit à l’épuisement`);
  assert.notEqual(load.state, LOAD_STATES.BURNOUT, `état ${state} : la charge soutenue devient mécaniquement une rupture`);
  assert.equal(load.episodes, 0, 'un épisode de rupture est survenu sans risque tiré');
  // Et cela coûte, progressivement.
  const p = bareSubject();
  p.load.value = value;
  p.load.state = state;
  const factor = loadProgressionFactor(p);
  assert.ok(factor < 0.95, `facteur de progression ${factor.toFixed(3)} : la charge soutenue ne coûte rien`);
  assert.ok(factor > 0.6, `facteur de progression ${factor.toFixed(3)} : le coût n’est plus progressif`);
});

test('23 — une charge excessive franchit bien les seuils de surcharge', () => {
  const { value, state } = equilibrium(20);
  assert.ok(value >= 79, `charge d’équilibre ${value.toFixed(1)} à intensité 20 : l’excès ne coûte plus rien`);
  assert.ok(isHigh(state), `état ${state} à intensité 20 : ce n’est pas un état de surcharge`);
  // Et le risque de rupture y est réellement actif.
  const p = bareSubject();
  p.load.value = value;
  p.load.state = state;
  p.load.heavyStreak = 40;
  assert.ok(crashRisk(p) > 0, 'aucun risque de rupture à charge excessive');
});

test('24 — réduire l’intensité fait réellement récupérer', () => {
  const { load } = equilibrium(16);
  const worn = bareSubject();
  worn.load = load;
  const high = load.value;
  // Vingt semaines allégées, avec des créneaux de repos.
  runWeeks(worn, { volume: 3, restSlots: 2 }, 20);
  assert.ok(
    worn.load.value < high - 25,
    `charge ${high.toFixed(1)} → ${worn.load.value.toFixed(1)} : lever le pied ne sert à rien`,
  );
  // Et durablement : la charge légère converge vers le bas, pas vers un palier.
  runWeeks(worn, { volume: 3, restSlots: 2 }, 60);
  assert.ok(worn.load.value < 20, `charge ${worn.load.value.toFixed(1)} après quatre-vingts semaines calmes`);
  assert.equal(equilibrium(2).value, 0, 'une intensité soutenable laisse une charge résiduelle');
});

test('25 — les sept états restent atteignables et l’hystérésis tient', () => {
  // Un état par palier d'intensité : c'est la continuité qui les rend tous
  // accessibles sans passer par une rupture.
  const reached = new Set();
  for (const i of [2, 5, 8, 12, 16, 20, 24]) reached.add(equilibrium(i).state);
  assert.ok(
    reached.size >= 4,
    `seulement ${reached.size} état(s) atteints par simple variation d’intensité : ${[...reached].join(', ')}`,
  );
  // Rupture et récupération restent joignables, mais par leur propre chemin.
  const p = bareSubject();
  p.load.value = 95;
  markBurnout(p, 10);
  assert.equal(p.load.state, LOAD_STATES.BURNOUT);
  relieveLoad(p, 50, { week: 11, reason: 'test' });
  assert.equal(p.load.state, LOAD_STATES.RECOVERING);

  // L'hystérésis : redescendre sous le seuil de montée ne suffit pas à sortir.
  const h = bareSubject();
  runWeeks(h, { volume: 9, matchLoad: 1, pressure: 2 }, 60);
  const climbed = h.load.state;
  assert.ok(isHigh(climbed) || climbed === LOAD_STATES.PRESSURED, `état après soixante semaines chargées : ${climbed}`);
  // « surmené » monte à 63 et ne redescend qu'à 53 : à 58, on reste surmené.
  const band = bareSubject();
  band.load.value = 66;
  band.load.state = LOAD_STATES.OVERLOADED;
  runWeeks(band, { volume: 6.5, restSlots: 0 }, 1);
  if (band.load.value > 53 && band.load.value < 63) {
    assert.equal(band.load.state, LOAD_STATES.OVERLOADED, `charge ${band.load.value.toFixed(1)} : l’état est sorti de sa bande sans franchir le seuil de descente`);
  }
});

test('26 — le risque/récompense du grind survit à la continuité', () => {
  // L'arbitrage ne doit pas être perdu en rendant le système continu : une
  // routine lourde progresse plus vite tant qu'elle reste sous le seuil, et
  // paie au-delà.
  const heavy = effortBonus(rawWeeklyVolume(['mechanics', 'mechanics', 'strategy', 'review']));
  const light = effortBonus(rawWeeklyVolume(['mechanics', 'strategy', 'rest', 'social']));
  assert.ok(heavy > light * 1.15, `récompense d’effort : lourde ×${heavy.toFixed(3)} contre légère ×${light.toFixed(3)}`);

  // Et le coût existe : à l'équilibre d'une routine lourde, le produit doit
  // rester au-dessus de celui d'une routine légère — sinon pousser ne paie
  // jamais — mais l'écart doit se refermer quand la charge grimpe.
  const lourd = equilibrium(13);
  const leger = equilibrium(6);
  const subj = (eq) => {
    const p = bareSubject();
    p.load.value = eq.value;
    p.load.state = eq.state;
    return p;
  };
  const produitLourd = heavy * loadProgressionFactor(subj(lourd));
  const produitLeger = light * loadProgressionFactor(subj(leger));
  assert.ok(
    produitLourd > produitLeger,
    `produit effort × charge : lourd ${produitLourd.toFixed(3)} contre léger ${produitLeger.toFixed(3)} — pousser ne paie à aucun moment`,
  );
  const extreme = equilibrium(22);
  const produitExtreme = heavy * loadProgressionFactor(subj(extreme));
  assert.ok(
    produitExtreme < produitLeger,
    `produit à intensité extrême ${produitExtreme.toFixed(3)} contre léger ${produitLeger.toFixed(3)} — l’excès ne coûte rien`,
  );
});

// --- 27 à 33 : la chaîne causale complète -----------------------------------
//
// charge → états de surcharge → burnoutPressure → décision de retraite
//
// Ces tests ne cherchent aucun pourcentage cible. Ils démontrent que chaque
// maillon transmet réellement, et que la chaîne se déclenche quand — et
// seulement quand — les conditions nécessaires sont réunies. Les trajectoires
// sont imposées, pas tirées au sort : c'est la seule façon de séparer « la
// chaîne ne fonctionne pas » de « les conditions ne se sont pas produites ».

/** Amène un sujet à son équilibre pour une intensité donnée, puis le rend. */
function atIntensity(intensity, weeks = 400) {
  const p = bareSubject();
  runWeeks(p, { volume: intensity / 1.1 }, weeks);
  return p;
}

/** Probabilité cumulée de rupture sur `weeks` semaines, à risque constant. */
function cumulativeRisk(person, weeks) {
  const r = crashRisk(person);
  return 1 - (1 - r) ** weeks;
}

test('27 — une charge modérée mais durable n’impose aucune rupture', () => {
  // Dix ans à l'intensité 10 : l'équilibre est à 57, soit « sous pression ».
  // C'est le régime « je travaille beaucoup » — il doit être tenable à vie.
  const p = atIntensity(10, 10 * WEEKS_PER_YEAR);
  assert.ok(p.load.value > 45, `charge ${p.load.value.toFixed(1)} : l’intensité 10 ne pèse rien`);
  assert.ok(!isHigh(p.load.state), `état ${p.load.state} après dix ans : une charge modérée mène à la surcharge`);
  assert.equal(crashRisk(p), 0, 'un régime modéré expose déjà à la rupture');
  assert.equal(p.load.episodes, 0, 'une rupture est survenue sans risque tiré');
  // Et la pression de retraite reste sous le seuil de 1,1 de `maybeRetire`.
  const subject = { ...p, fatigue: p.load.value * 0.8, stress: p.load.value * 0.72 };
  assert.ok(
    burnoutPressure(subject) < 1.1,
    `pression ${burnoutPressure(subject).toFixed(2)} : un régime modéré déclencherait la retraite`,
  );
});

test('28 — le risque augmente réellement et continûment avec la charge', () => {
  // Le maillon « états de surcharge → risque ». Chaque palier doit transmettre.
  const paliers = [10, 12, 14, 16, 18, 20].map((i) => {
    const p = atIntensity(i);
    // Une série longue : c'est le cas où le risque est censé être le plus lisible.
    p.load.heavyStreak = 60;
    return { i, value: p.load.value, state: p.load.state, risk: crashRisk(p) };
  });

  const modere = paliers[0];
  assert.equal(modere.risk, 0, `intensité 10 (charge ${modere.value.toFixed(1)}) : le risque existe déjà`);

  const dangereux = paliers.filter((x) => x.risk > 0);
  assert.ok(
    dangereux.length >= 3,
    `seulement ${dangereux.length} palier(s) exposent au risque : ${paliers.map((x) => `${x.i}→${x.risk.toFixed(4)}`).join(' ')}`,
  );
  // Strictement croissant sur la partie exposée : pas de palier mort.
  for (let k = 1; k < dangereux.length; k++) {
    assert.ok(
      dangereux[k].risk > dangereux[k - 1].risk,
      `risque non croissant entre les intensités ${dangereux[k - 1].i} et ${dangereux[k].i} : ${dangereux[k - 1].risk.toFixed(4)} puis ${dangereux[k].risk.toFixed(4)}`,
    );
  }
  // Et l'écart est mesurable, pas symbolique.
  const haut = dangereux.at(-1);
  assert.ok(
    haut.risk > 0.002,
    `risque hebdomadaire de ${(haut.risk * 100).toFixed(3)} % au régime le plus dur : la rupture est décorative`,
  );
});

test('29 — une charge excessive prolongée finit par rompre', () => {
  // Le maillon « risque → rupture ». On tire réellement, avec une graine fixe.
  //
  // La probabilité cumulée relevée par intensité, à série longue :
  //
  //     intensité   charge   état             /semaine    1 an    2 ans    6 ans
  //          10      57,3    sous pression      0,000 %    0,0 %    0,0 %    0,0 %
  //          12      64,8    surmené            0,377 %   17,8 %   32,5 %   69,2 %
  //          14      71,1    surmené            0,873 %   36,6 %   59,8 %   93,5 %
  //          16      76,6    surmené            1,307 %   49,5 %   74,5 %   98,3 %
  //          20      85,9    épuisé             2,043 %   65,8 %   88,3 %   99,8 %
  //
  // Une première version de ce test exigeait que la rupture ne soit pas
  // systématique **à l'intensité 20 tenue six ans sans jamais lever le pied** :
  // 40 trajectoires sur 40 rompaient, et c'est la bonne réponse. À ce régime,
  // tenu aussi longtemps, rompre doit être quasi certain — c'est le sens de
  // « finit par rompre ». Le caractère non systématique se mesure à un an, pas
  // sur six ans au régime le plus dur.
  const tirer = (intensite, annees, graine, carrieres = 40) => {
    const rng = new RNG(graine);
    let rompus = 0;
    for (let c = 0; c < carrieres; c++) {
      const p = atIntensity(intensite);
      p.load.heavyStreak = 60;
      for (let w = 0; w < annees * WEEKS_PER_YEAR && p.load.episodes === 0; w++) {
        if (rng.chance(crashRisk(p))) markBurnout(p, w);
      }
      if (p.load.episodes > 0) rompus++;
    }
    return rompus;
  };

  // À un an, au régime le plus dur : la rupture arrive, sans être certaine.
  const unAn = tirer(20, 1, 2907);
  assert.ok(unAn > 0, 'aucune rupture en un an à charge excessive : la chaîne est inerte');
  assert.ok(unAn < 40, `${unAn}/40 en un an : la rupture est certaine, ce n’est plus un risque`);

  // Tenu six ans sans jamais ralentir, en revanche, il faut que cela casse.
  const sixAns = tirer(20, 6, 4211);
  assert.ok(sixAns > 34, `${sixAns}/40 après six ans au régime extrême : l’excès ne finit pas par rompre`);

  // Et un régime modéré n'en produit aucune, même sur six ans.
  assert.equal(tirer(10, 6, 2907), 0, 'des ruptures surviennent en régime modéré : le seuil ne sépare rien');

  // Le gradient entre les deux doit exister : un régime dur mais non extrême
  // casse moins souvent qu'un régime extrême, sur le même horizon.
  const dur = tirer(12, 2, 909);
  const extreme = tirer(20, 2, 909);
  assert.ok(
    dur < extreme,
    `même horizon : intensité 12 → ${dur}/40, intensité 20 → ${extreme}/40 — le risque ne distingue pas les régimes`,
  );
});

test('30 — après une rupture, la récupération ramène réellement au jeu', () => {
  const p = atIntensity(20);
  markBurnout(p, 500);
  assert.equal(p.load.state, LOAD_STATES.BURNOUT);
  assert.ok(loadProgressionFactor(p) < 0.5, 'la rupture ne coûte pas de progression');
  assert.equal(crashRisk(p), 0, 'on risque une seconde rupture pendant la première');

  // Le joueur accepte de s'arrêter : c'est l'allègement des événements.
  relieveLoad(p, 78, { week: 501, reason: 'mise en retrait' });
  assert.equal(p.load.state, LOAD_STATES.RECOVERING, `état après mise en retrait : ${p.load.state}`);

  // Puis des semaines calmes le ramènent à un état normal et à une progression
  // normale — la rupture n'est pas une condamnation.
  runWeeks(p, { volume: 2, restSlots: 2 }, 40);
  assert.equal(p.load.state, LOAD_STATES.FRESH, `état après quarante semaines calmes : ${p.load.state}`);
  assert.equal(loadProgressionFactor(p), 1, 'la progression ne redevient jamais normale après une rupture');
  // La cicatrice, elle, reste.
  assert.equal(p.load.episodes, 1, 'l’épisode a été oublié');
});

test('31 — les ruptures répétées pèsent réellement sur la longévité', () => {
  // Le maillon « ruptures → burnoutPressure → retraite ». À charge identique,
  // seul le nombre d'épisodes change.
  const base = () => {
    const p = atIntensity(16);
    return { ...p, fatigue: 70, stress: 68 };
  };
  const pressions = [0, 1, 2, 4].map((n) => {
    const p = base();
    p.load = { ...p.load, episodes: n };
    return { n, pressure: burnoutPressure(p) };
  });
  for (let k = 1; k < pressions.length; k++) {
    assert.ok(
      pressions[k].pressure > pressions[k - 1].pressure,
      `la pression n’augmente pas de ${pressions[k - 1].n} à ${pressions[k].n} ruptures : ${pressions[k - 1].pressure.toFixed(3)} puis ${pressions[k].pressure.toFixed(3)}`,
    );
  }

  // Et cela se traduit en probabilité de retraite, avec la formule de
  // `maybeRetire` : au maximum 0,25 % par semaine au-delà d'une pression de 1,1.
  const chance = (pressure) => Math.min(Math.max((pressure - 1.1) * 0.0012, 0), 0.0025);
  const parAn = (pressure) => 1 - (1 - chance(pressure)) ** WEEKS_PER_YEAR;
  const sansRupture = parAn(pressions[0].pressure);
  const avecQuatre = parAn(pressions.at(-1).pressure);
  assert.ok(
    avecQuatre > sansRupture,
    `probabilité annuelle de retraite inchangée : ${(sansRupture * 100).toFixed(2)} % contre ${(avecQuatre * 100).toFixed(2)} %`,
  );
  assert.ok(
    avecQuatre > 0.02,
    `${(avecQuatre * 100).toFixed(2)} % par an après quatre ruptures : la charge n’atteint jamais la longévité`,
  );
  // Sans jamais devenir une condamnation.
  assert.ok(avecQuatre < 0.5, `${(avecQuatre * 100).toFixed(1)} % par an : la rupture devient une sentence`);
});

test('32 — réduire volontairement la charge fait réellement baisser le risque', () => {
  const p = atIntensity(20);
  p.load.heavyStreak = 60;
  const avant = crashRisk(p);
  assert.ok(avant > 0, 'le sujet de départ n’est pas exposé');

  // L'allègement que propose l'événement « coup de frein volontaire ».
  relieveLoad(p, 34, { week: 100, reason: 'coup de frein volontaire' });
  const apres = crashRisk(p);
  assert.ok(apres < avant, `risque ${avant.toFixed(4)} → ${apres.toFixed(4)} : ralentir ne sert à rien`);

  // Et tenir le nouveau rythme l'annule.
  runWeeks(p, { volume: 4, restSlots: 1 }, 30);
  assert.equal(crashRisk(p), 0, `risque résiduel ${crashRisk(p).toFixed(4)} après trente semaines allégées`);
  assert.ok(!isHigh(p.load.state), `état ${p.load.state} après trente semaines allégées`);

  // La pression de retraite retombe elle aussi sous le seuil.
  const soulage = { ...p, fatigue: p.load.value * 0.8, stress: p.load.value * 0.72 };
  assert.ok(burnoutPressure(soulage) < 1.1, `pression ${burnoutPressure(soulage).toFixed(2)} après avoir levé le pied`);
});

test('33 — pousser expose réellement, sans que ce soit le destin', () => {
  const { byPolicy } = policyAudit();
  const exposes = ['grinder', 'reckless'].map((id) => byPolicy[id]).filter(Boolean);
  const prudents = ['cautious', 'teamplayer'].map((id) => byPolicy[id]).filter(Boolean);
  assert.ok(exposes.length && prudents.length, 'politiques manquantes');

  // Exposé : la surcharge existe pour ceux qui poussent…
  const partHauteExposes = Math.max(...exposes.map((p) => p.shareHigh));
  const partHautePrudents = Math.max(...prudents.map((p) => p.shareHigh));
  assert.ok(
    partHauteExposes > partHautePrudents,
    `états hauts : exposés ${partHauteExposes} contre prudents ${partHautePrudents}`,
  );

  // …et elle n'est pas systématique : toutes les carrières ne se rompent pas.
  for (const p of exposes) {
    assert.ok(
      p.shareWithEpisode < 1,
      `${Math.round(p.shareWithEpisode * 100)} % des carrières se rompent : la rupture est le destin de cette politique`,
    );
  }
});

// --- 34 : la charge ne récompense jamais ------------------------------------

test('34 — la charge n’a aucun chemin vers le résultat sportif', () => {
  // Vérification demandée : l'avantage des routines lourdes doit venir des
  // résultats produits par l'effort, jamais d'une récompense cachée de la
  // charge elle-même. On l'établit de deux façons.

  // 1. Les deux fonctions par lesquelles la charge agit sur la progression ne
  //    peuvent que pénaliser, sur toute leur plage.
  for (let v = 0; v <= 100; v += 5) {
    const p = bareSubject();
    p.load.value = v;
    p.load.state = v >= 79 ? LOAD_STATES.DRAINED : v >= 63 ? LOAD_STATES.OVERLOADED : LOAD_STATES.PRESSURED;
    assert.ok(
      loadProgressionFactor(p) <= 1,
      `charge ${v} : le facteur de progression vaut ${loadProgressionFactor(p).toFixed(3)}, c’est un bonus`,
    );
    assert.ok(
      loadCoupling(p).morale <= 0,
      `charge ${v} : le couplage rend ${loadCoupling(p).morale.toFixed(2)} de moral, c’est un bonus`,
    );
  }

  // 2. La force d'une équipe en match ne lit pas la charge du tout. On calcule
  //    la force, on porte toute l'équipe à la charge maximale et en rupture,
  //    puis on recalcule : le résultat doit être rigoureusement identique.
  const world = world0(7300);
  const team = Object.values(world.teams).find((t) => t.roster?.length >= 3 && !t.isSelfTeam);
  assert.ok(team, 'aucune équipe complète dans le monde de test');
  const gameState = world.gameStates[team.gameId];
  const avant = contextualStrength(world, team, { gameState, stakes: 0.6, prepared: 0.5 });

  for (const pid of team.roster) {
    const p = world.persons[pid];
    p.load = { ...createLoadState(), value: 100, state: LOAD_STATES.BURNOUT, episodes: 5, heavyStreak: 80 };
  }
  const apres = contextualStrength(world, team, { gameState, stakes: 0.6, prepared: 0.5 });
  assert.equal(
    apres.total,
    avant.total,
    `la force d’équipe passe de ${avant.total.toFixed(3)} à ${apres.total.toFixed(3)} quand seule la charge change : il existe un chemin caché`,
  );
});
