/**
 * Progression organique (§69, §70, §22).
 *
 * Pas d'XP, pas de niveaux. Un attribut monte si :
 *  - du temps lui est consacré ;
 *  - il reste de la marge sous le plafond caché ;
 *  - l'âge le permet encore ;
 *  - le corps suit (fatigue) ;
 *  - et le talent brut du personnage l'autorise.
 *
 * Il redescend tout seul quand l'âge s'en mêle, sans que le joueur ait rien
 * fait de mal. C'est ce qui rend les fins de carrière crédibles.
 */

import { clamp, lerp } from './rng.js';
import { ATTRIBUTE_GROUPS, GROUP_IDS, attrsOfGroup } from './attributes.js';
import { ACTIVITIES_BY_ID, SLOTS_PER_WEEK } from '../data/training.js';
import { mods, age as personAge, getFamiliarity, setFamiliarity, STATUS } from './person.js';
import { WEEKS_PER_YEAR } from './time.js';
import { updateLoad, loadCoupling, loadProgressionFactor, effortBonus } from './load.js';

/**
 * Rythme de base. Calibré pour qu'un joueur de 17 ans au talent moyen qui
 * consacre ses 4 créneaux à une famille gagne ~18 points par an, et ~5 s'il
 * n'y met qu'un créneau. C'est ce qui rend le §23 réellement arbitrable :
 * répartir ses créneaux coûte du niveau quelque part.
 */
const BASE_GAIN_PER_SLOT = 0.155;

/**
 * Comportement de chaque famille face à l'âge.
 * declineBase est décalé par `longevity` (0..1) : certains profils tiennent
 * jusqu'à 31 ans, d'autres déclinent à 24 (§70 — pas de règle rigide).
 */
const GROUP_AGING = {
  // Le déclin mécanique doit être VISIBLE : c'est lui qui fait qu'une
  // génération remplace la précédente, et qui force les vétérans à se
  // réinventer sur la lecture du jeu plutôt que sur les mains.
  mechanical: { youthBoost: 1.35, declineBase: 22.5, declineSpan: 6.5, declineRate: 7.0 },
  gameSense: { youthBoost: 1.1, declineBase: 30, declineSpan: 4, declineRate: 1.6 },
  social: { youthBoost: 1.0, declineBase: 34, declineSpan: 4, declineRate: 0.4 },
  // Mental, professionnalisme et médiatique ne déclinent pas : c'est
  // précisément ce qui permet à un vétéran de compenser par la lecture,
  // la préparation et l'aura ce qu'il perd dans les mains (§70).
  mental: { youthBoost: 1.0, declineBase: 99, declineSpan: 1, declineRate: 0 },
  professional: { youthBoost: 1.0, declineBase: 99, declineSpan: 1, declineRate: 0 },
  media: { youthBoost: 1.0, declineBase: 99, declineSpan: 1, declineRate: 0 },
};

/**
 * Courbe d'apprentissage selon l'âge.
 *
 * S'effondre volontairement après 25 ans : passé cet âge, un joueur ne
 * progresse pratiquement plus, et le déclin mécanique prend le dessus. C'est
 * ce qui produit un pic de carrière autour de 22-26 ans et rend la relève
 * générationnelle inévitable (§41, §70).
 */
function ageLearningFactor(a) {
  if (a <= 15) return 1.3;
  if (a <= 18) return lerp(1.3, 1.05, (a - 15) / 3);
  if (a <= 22) return lerp(1.05, 0.68, (a - 18) / 4);
  if (a <= 26) return lerp(0.68, 0.14, (a - 22) / 4);
  if (a <= 30) return lerp(0.14, 0.03, (a - 26) / 4);
  return 0.02;
}

/**
 * Volume brut d'une semaine : la somme des coûts positifs des activités.
 *
 * Sert de mesure d'effort, pour la récompense immédiate comme pour la charge.
 * Les créneaux de récupération ne s'en retranchent pas — ils aident à digérer
 * la semaine, ils n'annulent pas le travail fourni.
 */
export function rawWeeklyVolume(routine) {
  let volume = 0;
  for (const id of routine) {
    const cost = ACTIVITIES_BY_ID[id]?.fatigue ?? 0;
    if (cost > 0) volume += cost;
  }
  return volume;
}

/** Créneaux de récupération d'une routine. */
export function restSlotsOf(routine) {
  let slots = 0;
  for (const id of routine) {
    if ((ACTIVITIES_BY_ID[id]?.fatigue ?? 0) < 0) slots++;
  }
  return slots;
}

/** Convertit une routine (liste d'activités) en poids par famille. */
export function routineWeights(routine) {
  const weights = {};
  for (const g of GROUP_IDS) weights[g] = 0;
  let slots = 0;
  for (const id of routine) {
    const act = ACTIVITIES_BY_ID[id];
    if (!act) continue;
    slots++;
    for (const [g, w] of Object.entries(act.groups)) {
      weights[g] = (weights[g] ?? 0) + w;
    }
  }
  return { weights, slots: Math.max(1, slots) };
}

/**
 * Applique une période d'entraînement.
 * `weeks` permet de traiter les PNJ par lots sans changer les résultats
 * d'un facteur perceptible (ils progressent tous les 4 ticks).
 */
export function progressPerson(person, ctx, rng) {
  const {
    game,
    routine = [],
    coachQuality = 0,
    weeks = 1,
    absWeek = 0,
    teamQuality = 0,
    // Part du temps de jeu : 1 pour un titulaire, moins pour un remplaçant.
    playingTime = 1,
  } = ctx;

  const a = personAge(person, absWeek);
  const m = mods(person);
  const { weights } = routineWeights(routine);

  // Deux termes séparés remplacent le malus plat (étape 7B) : la récompense
  // vient de l'effort de la semaine, le coût de la charge accumulée. « Je
  // pousse maintenant pour progresser plus vite, au risque de payer plus tard »
  // devient donc littéralement la formule.
  //
  // `fatigueFactor = clamp(1 - max(0, fatigue-55)/75, 0.45, 1)` ne faisait que
  // punir : mesuré, ×0,643 en continu pour un grinder et ×0,472 pour un
  // saboteur, sans jamais rien gagner en échange.
  const effort = effortBonus(rawWeeklyVolume(routine));
  const loadFactor = loadProgressionFactor(person);
  const stressFactor = clamp(1 - Math.max(0, person.stress - 60) / 90, 0.6, 1);
  const moraleFactor = clamp(0.75 + person.morale / 250, 0.7, 1.15);
  const coachFactor = (1 + coachQuality * 0.45 + teamQuality * 0.12) * clamp(playingTime, 0.5, 1);
  const learn = ageLearningFactor(a);

  const deltas = {};

  for (const group of ATTRIBUTE_GROUPS) {
    const gid = group.id;
    const aging = GROUP_AGING[gid];
    const ceiling = person.hidden.ceilings[gid];
    const focus = weights[gid] / SLOTS_PER_WEEK;

    // --- Gain ---
    if (focus > 0) {
      for (const attr of group.attrs) {
        const cur = person.attrs[attr.id];
        const headroom = clamp((ceiling - cur) / 26, 0, 1);
        if (headroom <= 0) continue;
        const youth = a <= 19 ? aging.youthBoost : 1;
        let gain =
          BASE_GAIN_PER_SLOT *
          focus *
          SLOTS_PER_WEEK *
          Math.pow(headroom, 0.85) *
          learn *
          youth *
          person.hidden.growth *
          m.growth *
          coachFactor *
          effort *
          loadFactor *
          stressFactor *
          moraleFactor *
          weeks;
        // Bruit : deux joueurs identiques ne progressent pas pareil.
        gain *= rng.float(0.72, 1.28);
        person.attrs[attr.id] = clamp(cur + gain, 1, 99);
        deltas[attr.id] = (deltas[attr.id] ?? 0) + gain;
      }
    }

    // --- Déclin ---
    if (aging.declineRate > 0) {
      const start = aging.declineBase + person.hidden.longevity * aging.declineSpan;
      if (a > start) {
        const severity = clamp((a - start) / 6, 0, 1.6);
        const yearly = aging.declineRate * severity;
        const perWeek = (yearly / WEEKS_PER_YEAR) * weeks;
        for (const attr of group.attrs) {
          const loss = perWeek * rng.float(0.55, 1.45);
          person.attrs[attr.id] = clamp(person.attrs[attr.id] - loss, 1, 99);
          deltas[attr.id] = (deltas[attr.id] ?? 0) - loss;
        }
      }
    }
  }

  applyConditionEffects(person, routine, weeks, ctx, rng);
  applyFamiliarity(person, routine, game, ctx, weeks);

  return deltas;
}

/** Fatigue, stress, moral — la couche « équilibre de vie » (§22). */
function applyConditionEffects(person, routine, weeks, ctx, rng) {
  const m = mods(person);
  let fatigue = 0;
  let stress = 0;
  let morale = 0;
  let rawFatigue = 0;
  for (const id of routine) {
    const act = ACTIVITIES_BY_ID[id];
    if (!act) continue;
    fatigue += act.fatigue ?? 0;
    stress += act.stress ?? 0;
    morale += act.morale ?? 0;
    // Volume brut : ce que la semaine a demandé, avant récupération. C'est la
    // mesure d'intensité que consomme la charge — un `rest` ne doit pas
    // « annuler » l'intensité de la semaine, seulement aider à la digérer.
    if ((act.fatigue ?? 0) > 0) rawFatigue += act.fatigue;
  }
  // Les matchs coûtent, surtout en LAN.
  fatigue += (ctx.matchLoad ?? 0) * 1.8;
  stress += (ctx.matchLoad ?? 0) * 1.6;

  // Équilibre visé : une routine sérieuse + un match par semaine se tient
  // à peu près ; ajouter des scrims et de la mécanique en plus ne se tient
  // pas. C'est là que le §22 devient un arbitrage et pas une jauge.
  const recovery = 1.6 + (1 - person.hidden.burnoutFloor) * 1.0;
  fatigue -= recovery;
  stress -= 1.6;

  // --- Charge accumulée (étape 7B) -----------------------------------------
  // Elle se met à jour AVANT le couplage : la charge de cette semaine pèse sur
  // la fatigue, le stress et le moral de cette semaine.
  updateLoad(
    person,
    {
      rawFatigue,
      matchLoad: ctx.matchLoad ?? 0,
      pressure: ctx.pressure ?? 0,
      sensitivity: m.burnoutRisk,
      // Se reposer aide à digérer la charge, sans effacer l'intensité.
      restSlots: restSlotsOf(routine),
      week: ctx.absWeek ?? 0,
    },
    weeks,
  );
  // Fatigue et stress ne sont plus des compteurs indépendants : ce sont les
  // expressions à court terme de la charge.
  //
  // C'est la seule façon d'interdire réellement « fatigue 98 + stress 2 +
  // moral 98 ». Un simple terme de couplage ajouté à des dynamiques par ailleurs
  // indépendantes ne suffit pas : mesuré après la première tentative, la
  // politique saboteur restait à 98,2 de fatigue pour 3,6 de stress, parce que
  // chaque variable avait son propre delta constant et convergeait vers son
  // propre point fixe, sans rapport avec les deux autres. Une charge de 40,7
  // cohabitait avec une fatigue de 98 — deux mesures du même épuisement qui se
  // contredisaient.
  //
  // Les deux variables tendent donc désormais vers une cible dérivée de la
  // charge, plus la part aiguë de la semaine. Elles gardent leur inertie propre
  // (un retour progressif, pas un saut), mais elles ne peuvent plus divorcer.
  const load = person.load;
  const acute = rawFatigue * 2.0 + (ctx.matchLoad ?? 0) * 5;
  const relief = Math.max(0, -fatigue) * 1.6;
  const fatigueTarget = clamp(load.value * 0.8 + acute - relief, 0, 100);
  person.fatigue = clamp(
    person.fatigue + (fatigueTarget - person.fatigue) * clamp(0.3 * weeks, 0, 1) * m.burnoutRisk,
    0,
    100,
  );

  const stressTarget = clamp(
    load.value * 0.72 + (ctx.pressure ?? 0) * 4.5 + Math.max(0, stress) * 2.2,
    0,
    100,
  );
  person.stress = clamp(
    person.stress + (stressTarget - person.stress) * clamp(0.26 * weeks, 0, 1) * m.burnoutRisk,
    0,
    100,
  );

  // Le moral, lui, garde sa dynamique propre — il dépend aussi des résultats et
  // des événements — mais la charge chronique l'érode.
  morale += loadCoupling(person).morale;
  // Retour lent vers un niveau neutre : une mauvaise passe fait chuter le
  // moral, mais un joueur ne reste pas à zéro indéfiniment — sinon toutes
  // les carrières finissent identiquement par l'abandon.
  const moraleReversion = (48 - person.morale) * 0.02 * weeks;
  person.morale = clamp(
    person.morale + morale * weeks + moraleReversion + rng.float(-0.6, 0.6),
    0,
    100,
  );
}

/** Familiarité : monte avec la pratique, redescend doucement sans elle. */
function applyFamiliarity(person, routine, game, ctx, weeks) {
  if (!game) return;
  let gain = 0;
  let targetGain = 0;
  for (const id of routine) {
    const act = ACTIVITIES_BY_ID[id];
    if (!act) continue;
    gain += act.familiarity ?? 0;
    targetGain += act.familiarityTarget ?? 0;
  }
  const cur = getFamiliarity(person, game.id);
  const learnRate = game.learnRate * (0.7 + person.hidden.adaptability * 0.6);
  // Plus on connaît un jeu, plus le dernier pour cent coûte cher.
  const remaining = Math.pow(1 - cur, 0.7);
  setFamiliarity(person, game.id, cur + gain * learnRate * remaining * weeks);

  if (targetGain > 0 && ctx.learningGameId) {
    const t = getFamiliarity(person, ctx.learningGameId);
    const targetGame = ctx.learningGame;
    const rate = (targetGame?.learnRate ?? 1) * (0.7 + person.hidden.adaptability * 0.6);
    setFamiliarity(
      person,
      ctx.learningGameId,
      t + targetGain * rate * Math.pow(1 - t, 0.7) * weeks,
    );
  }

  // Les autres jeux s'oublient.
  for (const gid of Object.keys(person.familiarity)) {
    if (gid === game.id || gid === ctx.learningGameId) continue;
    person.familiarity[gid] = clamp(person.familiarity[gid] - 0.0018 * weeks, 0, 1);
  }
}

/**
 * Forme (§26) : marche aléatoire à retour à la moyenne. Les traits
 * « instable » ou « calme » changent radicalement l'amplitude, ce qui
 * produit des joueurs fiables et des joueurs imprévisibles.
 */
export function updateForm(person, rng, weeks = 1) {
  const m = mods(person);
  const volatility = 2.6 * m.formVolatility;
  for (let i = 0; i < weeks; i++) {
    const pull = -person.form * 0.14;
    const moraleBias = (person.morale - 55) * 0.012;
    const fatigueBias = -Math.max(0, person.fatigue - 60) * 0.03;
    person.form = clamp(
      person.form + pull + moraleBias + fatigueBias + rng.gauss(0, volatility),
      -20,
      20,
    );
  }
}

/**
 * Routine implicite d'un PNJ, déduite de son statut et de ses traits.
 * Les PNJ ne « trichent » pas : ils utilisent le même système que le joueur.
 */
export function npcRoutine(person, rng) {
  const m = mods(person);
  const routine = [];
  const hasTeam = !!person.teamId;
  routine.push('mechanics');
  routine.push(hasTeam ? 'scrim' : 'strategy');
  if (m.mediaGrowth > 1.3 && rng.chance(0.6)) routine.push('streaming');
  else if (person.fatigue > 60) routine.push('rest');
  else routine.push(rng.chance(0.5) ? 'review' : 'strategy');
  if (person.stress > 65) routine.push('mentalwork');
  else if (person.fatigue > 70) routine.push('rest');
  else routine.push(m.growth > 1.1 ? 'review' : 'social');
  return routine;
}

/**
 * Un joueur peut-il encore encaisser le rythme ? Sert aux retraites (§48).
 *
 * Cette fonction existait, portait déjà ce commentaire, et **n'était appelée
 * nulle part** : la longévité ne dépendait que de l'âge. Elle est désormais
 * consultée par `maybeRetire`, et intègre la charge accumulée et les épisodes
 * de rupture déjà traversés — deux grandeurs qui n'existaient pas.
 */
export function burnoutPressure(person) {
  const load = person.load;
  const accumulated = load ? (load.value - 55) / 45 : 0;
  // Chaque rupture laisse une marque : la troisième pèse plus que la première.
  const scars = load ? clamp((load.episodes ?? 0) * 0.22, 0, 0.9) : 0;
  return clamp(
    (person.fatigue - 55) / 45 + (person.stress - 60) / 45 + Math.max(0, accumulated) + scars,
    0,
    3,
  );
}

export function isEliteStatus(person) {
  return person.status === STATUS.PRO;
}
