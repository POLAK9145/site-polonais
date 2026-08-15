/**
 * Activités hebdomadaires (§23).
 *
 * Le joueur répartit 4 créneaux par semaine. Chaque activité a un gain ET
 * un coût — aucune n'est strictement dominante (§78). S'entraîner 4 créneaux
 * en mécanique progresse vite, épuise, isole, et ne construit ni audience,
 * ni relations, ni compréhension d'équipe.
 */

export const SLOTS_PER_WEEK = 4;

export const ACTIVITIES = [
  {
    id: 'mechanics',
    label: 'Entraînement mécanique',
    desc: 'Aim, exécution, routines individuelles.',
    groups: { mechanical: 1 },
    fatigue: 3.2,
    stress: 0.8,
    morale: -0.3,
    familiarity: 0.012,
    icon: '🎯',
  },
  {
    id: 'strategy',
    label: 'Travail stratégique',
    desc: 'Théorie, préparation, compréhension de la méta.',
    groups: { gameSense: 0.82, professional: 0.18 },
    fatigue: 2.1,
    stress: 0.6,
    morale: -0.1,
    familiarity: 0.016,
    icon: '🧠',
  },
  {
    id: 'review',
    label: 'Analyse de VOD',
    desc: 'Revoir ses erreurs et celles des autres.',
    groups: { gameSense: 0.55, mental: 0.2, professional: 0.25 },
    fatigue: 1.6,
    stress: 1.2,
    morale: -0.5,
    familiarity: 0.01,
    icon: '🎞️',
  },
  {
    id: 'scrim',
    label: 'Entraînement d’équipe',
    desc: 'Scrims, exécutions collectives, communication.',
    groups: { social: 0.5, gameSense: 0.32, mental: 0.18 },
    fatigue: 2.8,
    stress: 1.0,
    morale: 0.4,
    familiarity: 0.02,
    synergy: 1.5,
    requiresTeam: true,
    icon: '🤝',
  },
  {
    id: 'mentalwork',
    label: 'Préparation mentale',
    desc: 'Gestion de la pression, sommeil, routines.',
    groups: { mental: 0.85, professional: 0.15 },
    fatigue: 0.8,
    stress: -3.5,
    morale: 1.0,
    familiarity: 0,
    icon: '🧘',
  },
  {
    id: 'newgame',
    label: 'Apprendre un autre jeu',
    desc: 'Découvrir une nouvelle scène. Long, coûteux, parfois décisif.',
    groups: { gameSense: 0.25, mechanical: 0.25 },
    fatigue: 2.4,
    stress: 1.4,
    morale: -0.2,
    familiarityTarget: 0.028,
    icon: '🔀',
  },
  {
    id: 'streaming',
    label: 'Stream',
    desc: 'Diffuser en direct. Revenus et audience, au prix du temps de jeu sérieux.',
    groups: { media: 0.7, social: 0.3 },
    fatigue: 2.2,
    stress: 0.4,
    morale: 0.6,
    familiarity: 0.004,
    income: true,
    audience: 1.0,
    icon: '📡',
  },
  {
    id: 'content',
    label: 'Création de contenu',
    desc: 'Vidéos, clips, formats courts. Construit une marque personnelle.',
    groups: { media: 0.85, social: 0.15 },
    fatigue: 1.8,
    stress: 0.8,
    morale: 0.3,
    familiarity: 0.002,
    income: true,
    audience: 1.35,
    icon: '🎬',
  },
  {
    id: 'rest',
    label: 'Repos',
    desc: 'Dormir, décrocher, récupérer.',
    groups: {},
    fatigue: -6.5,
    stress: -4,
    morale: 1.2,
    familiarity: -0.002,
    icon: '🛌',
  },
  {
    id: 'social',
    label: 'Vie sociale',
    desc: 'Voir des gens qui ne parlent pas de jeu.',
    groups: { social: 0.35, mental: 0.25 },
    fatigue: -2,
    stress: -3.2,
    morale: 2.4,
    familiarity: -0.001,
    relations: 1,
    icon: '🍻',
  },
  {
    id: 'media',
    label: 'Médias & relations',
    desc: 'Interviews, événements, réseau professionnel.',
    groups: { media: 0.55, social: 0.45 },
    fatigue: 1.4,
    stress: 1.0,
    morale: 0,
    familiarity: 0,
    audience: 0.5,
    network: 1,
    icon: '🎤',
  },
];

export const ACTIVITIES_BY_ID = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));

/**
 * Routine de départ : sérieuse mais tenable. Elle n'est pas optimale — c'est
 * au joueur de décider ce qu'il sacrifie (§78).
 */
export const DEFAULT_ROUTINE = ['mechanics', 'strategy', 'review', 'rest'];
