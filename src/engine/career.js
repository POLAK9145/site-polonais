/**
 * État de carrière du joueur (§32).
 *
 * Tout ce que le moteur écrit ici est un FAIT daté. La page Legacy et le
 * récit final (§72) ne font que relire cette structure : ils n'inventent
 * jamais un événement qui n'a pas eu lieu.
 */

import { clamp } from './rng.js';
import { createEventState } from './events/engine.js';
import { DEFAULT_ROUTINE } from '../data/training.js';
import { formatDate, yearOf } from './time.js';

export const DIFFICULTIES = {
  story: {
    id: 'story',
    label: 'Récit',
    desc: 'Les opportunités viennent plus facilement. Pour découvrir le jeu.',
    opportunity: 1.35,
    progression: 1.15,
    consequence: 0.7,
    demand: 0.85,
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    desc: 'L’équilibre prévu par le jeu.',
    opportunity: 1,
    progression: 1,
    consequence: 1,
    demand: 1,
  },
  hard: {
    id: 'hard',
    label: 'Exigeant',
    desc: 'Moins d’occasions, des structures plus dures, des erreurs qui coûtent.',
    opportunity: 0.7,
    progression: 0.88,
    consequence: 1.35,
    demand: 1.2,
  },
  brutal: {
    id: 'brutal',
    label: 'Impitoyable',
    desc: 'La plupart des carrières n’aboutissent pas. C’est le propos.',
    opportunity: 0.45,
    progression: 0.78,
    consequence: 1.7,
    demand: 1.45,
  },
};

export const LIFESTYLES = {
  frugal: { id: 'frugal', label: 'Frugal', cost: 380, moraleWeekly: -0.35, stress: 0.2 },
  normal: { id: 'normal', label: 'Normal', cost: 900, moraleWeekly: 0, stress: 0 },
  comfortable: { id: 'comfortable', label: 'Confortable', cost: 1900, moraleWeekly: 0.5, stress: -0.3 },
  lavish: { id: 'lavish', label: 'Train de vie élevé', cost: 4200, moraleWeekly: 0.9, stress: -0.4 },
};

export function createCareer(world, person, opts = {}) {
  const {
    difficulty = 'standard',
    originId = null,
    familyId = null,
    money = 500,
    seed = world.seed,
    scenarioId = null,
  } = opts;

  return {
    personId: person.id,
    seed,
    difficulty,
    scenarioId,
    originId,
    familyId,
    startWeek: world.week,

    routine: [...DEFAULT_ROUTINE],
    lifestyle: 'normal',
    money,
    monthlyDebt: 0,

    eventState: createEventState(),
    timeline: [],
    memories: [],
    achievements: [],
    goals: [],
    hiddenGoals: [],
    flags: {},

    rivalId: null,
    /**
     * Vie de la rivalité en cours (étape 7E).
     *
     * `rivalId` seul ne disait que « qui » — jamais « où en est-on ». Mesuré, une
     * rivalité naissait vers l'an 3, connaissait un affrontement et une
     * résolution, puis se figeait pour une décennie : dix-huit sur vingt
     * terminaient exactement sur une borne du système, et le bilan citait
     * pourtant le rival comme « fil rouge » alors qu'il était retraité dans
     * quinze cas sur dix-huit.
     */
    rivalry: null,
    /** Rivalités éteintes, que le récit garde même quand le présent les lâche. */
    pastRivalries: [],
    mentorId: null,
    learningGameId: null,

    offers: [],
    pendingDecision: null,

    retired: false,
    retiredWeek: null,
    retirementPath: null,

    counters: {
      weeks: 0,
      decisions: 0,
      gamesPlayed: [],
      orgsPlayed: [],
      seasonsCompeted: 0,
      lowestPoint: null,
      highestRating: 0,
      timesReleased: 0,
      titlesByTier: {},
    },
  };
}

/** Ajoute un fait daté à la timeline. C'est la matière première du récit. */
export function logTimeline(career, world, text, { kind = 'info', important = false, data = null } = {}) {
  career.timeline.push({
    week: world.week,
    year: yearOf(world.week),
    kind,
    text,
    important,
    data,
  });
  return career.timeline[career.timeline.length - 1];
}

/**
 * La saison du JOUEUR (étape 9A).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * À la fin d'une saison, le joueur apprenait ceci : « Fin de saison 2035 :
 * 12 retraites, 40 nouveaux joueurs sur les scènes. » C'est-à-dire rien sur SA
 * saison. Ni ses matchs, ni ses victoires, ni son classement, ni si l'objectif
 * que sa structure lui avait fixé en le signant était tenu.
 *
 * Une carrière de vingt ans, c'est vingt saisons. Sans bilan, ce sont mille
 * semaines qui se ressemblent : le joueur ne peut ni se souvenir d'une saison,
 * ni les comparer, ni savoir s'il a progressé.
 *
 * COMMENT
 * -------
 * On photographie les compteurs cumulés au début de chaque saison et on fait
 * la différence à la fin. Aucun compteur parallèle n'est tenu : deux sources
 * pour un même nombre finissent toujours par diverger, et c'est le total
 * cumulé qui fait foi.
 */
export function startSeasonRecord(career, world, person, { rating = null } = {}) {
  career.seasonStart = {
    week: world.week,
    year: yearOf(world.week),
    matches: person.stats.matches ?? 0,
    wins: person.stats.wins ?? 0,
    titles: person.stats.titles ?? 0,
    minorTitles: person.stats.minorTitles ?? 0,
    finals: person.stats.finals ?? 0,
    mvps: person.stats.mvps ?? 0,
    earnings: person.stats.earnings ?? 0,
    followers: person.followers ?? 0,
    // Le niveau du jour : sans lui, la progression d'une saison serait
    // toujours vide, et « avez-vous progressé cette année ? » est la première
    // question qu'un joueur se pose.
    rating,
    orgName: world.orgs[person.orgId]?.name ?? null,
  };
  return career.seasonStart;
}

/**
 * Ce que la saison écoulée a produit, en différences.
 * Retourne `null` si aucune saison n'a été ouverte — au tout début d'une
 * carrière, par exemple. Mieux vaut ne rien afficher qu'un bilan inventé.
 */
export function closeSeasonRecord(career, world, person, { rating = null } = {}) {
  const debut = career.seasonStart;
  if (!debut) return null;
  const diff = (k) => Math.max(0, (person.stats[k] ?? 0) - (debut[k] ?? 0));
  const matches = diff('matches');
  const wins = diff('wins');
  const bilan = {
    // L'année où la saison SE TERMINE, pas celle où elle a commencé.
    //
    // Une saison se referme semaine 51 : à part la première, chacune démarre
    // donc semaine 51 de l'année civile précédente et se déroule pour
    // l'essentiel dans la suivante. Les nommer par leur année de départ les
    // décalait toutes d'un an, et faisait de surcroît porter le même millésime
    // à la première saison et à la deuxième — mesuré sur 8 carrières sur 8. Le
    // défaut ne s'est vu qu'en traçant la courbe de carrière, qui met les
    // années côte à côte (étape 9G).
    year: yearOf(world.week),
    weeks: world.week - debut.week,
    matches,
    wins,
    losses: Math.max(0, matches - wins),
    winRate: matches > 0 ? Math.round((wins / matches) * 100) : null,
    titles: diff('titles'),
    minorTitles: diff('minorTitles'),
    finals: diff('finals'),
    mvps: diff('mvps'),
    earnings: Math.round((person.stats.earnings ?? 0) - (debut.earnings ?? 0)),
    followersGained: Math.round((person.followers ?? 0) - (debut.followers ?? 0)),
    ratingStart: debut.rating,
    ratingEnd: rating,
    progression: debut.rating != null && rating != null ? Math.round((rating - debut.rating) * 10) / 10 : null,
    orgStart: debut.orgName,
    orgEnd: world.orgs[person.orgId]?.name ?? null,
  };
  career.seasons = career.seasons ?? [];
  career.seasons.push(bilan);
  // On ne garde pas vingt-cinq bilans complets en mémoire pour rien : les
  // derniers suffisent à l'affichage, le reste vit dans la timeline.
  if (career.seasons.length > 30) career.seasons.shift();
  return bilan;
}

/**
 * Les coups durs que la SIMULATION produit (étape 8C).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * Tous les « coups durs » enregistrés jusqu'ici venaient d'ÉVÉNEMENTS scriptés
 * — un surmenage, un banc, une organisation qui coule. Rien ne venait de la
 * simulation elle-même, alors que c'est elle qui produit les vrais. Résultat
 * mesuré sur 108 carrières : 23 % n'avaient aucun point bas identifiable, et
 * parmi celles-là, 80 % avaient été licenciées au moins une fois (médiane
 * TROIS fois), 64 % avaient vu un contrat ne pas être prolongé, et 10 sur 25
 * avaient fini leur carrière usées. Une seule sur vingt-cinq n'avait
 * réellement rien vécu de dur.
 *
 * Le jeu racontait donc une carrière sans accroc à un joueur viré trois fois.
 * Ce n'est pas un défaut de mesure : le bilan final construit sa phrase « Tout
 * n'a pas été droit… » à partir de ces mêmes entrées, et restait muet.
 *
 * CE QUI EST FAIT ICI, ET CE QUI NE L'EST PAS
 * -------------------------------------------
 * On n'ajoute AUCUN malheur : on enregistre ceux qui ont déjà lieu. Rien ici ne
 * consomme d'aléatoire et rien ne modifie l'état du monde — seule la trace
 * change. Une exécution de la baseline doit donc rendre exactement les mêmes
 * niveaux, titres et legacy qu'avant, et seules les mesures narratives bougent.
 */
export function trackHardMoments(career, world, person, { hasRealTeam }) {
  // 1. Perdre son équipe sans l'avoir choisi. Le détecteur est ici, au niveau
  //    de la carrière, et non dans chacune des fonctions du monde qui peuvent
  //    en être la cause — licenciement, remplacement, fermeture d'une scène.
  //    Une seule garde couvre alors tous les chemins, présents et à venir.
  //
  //    L'état précédent est MÉMORISÉ sur la carrière et non relu en début de
  //    semaine : une première version comparait le début et la fin du tour de
  //    jeu, et ne voyait donc rien quand l'équipe était perdue entre deux
  //    semaines — c'est-à-dire dans la plupart des cas, puisque le monde tourne
  //    à côté. Le test qui construisait un licenciement l'a montré : zéro
  //    entrée enregistrée.
  const avaitUneEquipe = career.counters.avaitUneEquipe ?? false;
  career.counters.avaitUneEquipe = hasRealTeam;
  const semainesSansEquipe = career.counters.weeksWithoutTeam ?? 0;

  if (avaitUneEquipe && !hasRealTeam) {
    career.counters.sansEquipeDepuis = world.week;
  }
  if (hasRealTeam) career.counters.sansEquipeDepuis = null;

  // On n'annonce pas la perte le jour même. Une première version le faisait, et
  // le test l'a prise en flagrant délit : « Écarté de l'effectif » la même
  // semaine que « Signature chez Crimson » — un transfert raconté comme un
  // licenciement. Quitter une structure pour une autre n'est pas un coup dur ;
  // se retrouver dehors et y rester en est un. On attend donc que la situation
  // dure avant de la nommer.
  const debut = career.counters.sansEquipeDepuis;
  if (debut != null && world.week - debut === SANS_EQUIPE_CONFIRME) {
    // Si la raison précise a déjà été journalisée au début de cette période —
    // une fin de contrat, par exemple — on ne la redit pas en plus vague.
    const dejaDit = career.timeline.some(
      (e) => e.kind === 'setback' && e.week >= debut - 1 && e.week <= world.week,
    );
    if (!dejaDit) {
      logTimeline(career, world, 'Sans équipe depuis un mois. Personne ne rappelle.', {
        kind: 'setback',
        important: true,
      });
    }
  }

  // 2. La traversée du désert. Une année entière sans équipe est un fait dont
  //    le moteur se sert déjà pour décider d'une fin de carrière subie ; il
  //    doit aussi pouvoir se raconter.
  if (semainesSansEquipe >= 52 && !career.flags.desert_en_cours) {
    career.flags.desert_en_cours = true;
    logTimeline(career, world, 'Un an sans équipe. Le téléphone ne sonne plus.', {
      kind: 'setback',
      important: true,
    });
    addMemory(career, world, {
      kind: 'crisis',
      title: 'La traversée du désert',
      text: 'Une année entière sans personne pour vouloir de vous. On finit par se demander si on va revenir.',
    });
  }
  if (semainesSansEquipe === 0) career.flags.desert_en_cours = false;

  // 3. L'effondrement du moral. Distinct du surmenage, qui est physique : on
  //    peut être frais et n'avoir plus aucune envie. Le seuil est celui dont
  //    le moteur se sert déjà pour la retraite « usure », et l'hystérésis
  //    évite qu'un moral qui oscille au plancher ne journalise chaque semaine.
  if (person.morale < MORAL_PLANCHER) {
    career.counters.semainesMoralBas = (career.counters.semainesMoralBas ?? 0) + 1;
    if (career.counters.semainesMoralBas === MORAL_SEMAINES && !career.flags.moral_effondre) {
      career.flags.moral_effondre = true;
      logTimeline(career, world, 'Plus rien n’avait de goût. Deux mois à jouer sans y croire.', {
        kind: 'setback',
        important: true,
      });
      addMemory(career, world, {
        kind: 'crisis',
        title: 'Le passage à vide',
        text: 'Ce n’était pas le corps. C’était l’envie. Se lever pour jouer était devenu un effort.',
      });
    }
  } else {
    career.counters.semainesMoralBas = 0;
    if (person.morale > MORAL_SORTIE) career.flags.moral_effondre = false;
  }
}

/**
 * Combien de semaines dehors avant que « écarté » veuille dire quelque chose.
 * En dessous, c'est un transfert : on quitte une équipe et on en rejoint une
 * autre, ce qui n'a rien d'un coup dur.
 */
const SANS_EQUIPE_CONFIRME = 4;

/** Moral au plancher : le seuil que `maybeRetire` utilise pour l'usure. */
const MORAL_PLANCHER = 8;
/** Deux mois : un mauvais mois arrive à tout le monde, deux sont un creux. */
const MORAL_SEMAINES = 8;
/** On ne re-journalise pas tant que le moral n'est pas franchement remonté. */
const MORAL_SORTIE = 25;

/** Moment marquant (§28) : conservé même quand la timeline est résumée. */
export function addMemory(career, world, { kind, title, text, data = null }) {
  career.memories.push({ week: world.week, year: yearOf(world.week), kind, title, text, data });
  return career.memories[career.memories.length - 1];
}

export function addAchievement(career, world, achievementId) {
  if (career.achievements.some((a) => a.id === achievementId)) return false;
  career.achievements.push({ id: achievementId, week: world.week, year: yearOf(world.week) });
  return true;
}

export function hasAchievement(career, id) {
  return career.achievements.some((a) => a.id === id);
}

export function setFlag(career, name, value = true) {
  career.flags[name] = value;
}

export function getFlag(career, name) {
  return career.flags[name];
}

export function difficultyOf(career) {
  return DIFFICULTIES[career.difficulty] ?? DIFFICULTIES.standard;
}

export function lifestyleOf(career) {
  return LIFESTYLES[career.lifestyle] ?? LIFESTYLES.normal;
}

/** Timeline condensée par année, pour la page Carrière (§65). */
export function timelineByYear(career) {
  const byYear = new Map();
  for (const entry of career.timeline) {
    if (!byYear.has(entry.year)) byYear.set(entry.year, []);
    byYear.get(entry.year).push(entry);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, entries]) => ({ year, entries }));
}

export function formatTimelineEntry(entry) {
  return `${formatDate(entry.week)} — ${entry.text}`;
}

export function trackGamePlayed(career, gameId) {
  if (gameId && !career.counters.gamesPlayed.includes(gameId)) {
    career.counters.gamesPlayed.push(gameId);
  }
}

export function trackOrg(career, orgId) {
  if (orgId && !career.counters.orgsPlayed.includes(orgId)) {
    career.counters.orgsPlayed.push(orgId);
  }
}

export function spend(career, amount) {
  career.money -= amount;
  if (career.money < 0) {
    career.monthlyDebt += -career.money;
    career.money = 0;
    return false;
  }
  return true;
}

export function earn(career, amount) {
  career.money += Math.max(0, amount);
}

export function netWorth(career) {
  return clamp(career.money - career.monthlyDebt, -1e9, 1e9);
}
