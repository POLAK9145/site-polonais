/**
 * Jeux vidéo fictifs (§8).
 *
 * Aucune licence réelle. Chaque jeu est mécaniquement différent : les poids
 * par famille d'attributs changent réellement qui est bon à quoi. Un
 * spécialiste d'IRONFIST (1v1, mécanique pure) et un IGL de VANGUARD
 * (5v5, social + lecture) ne sont pas comparables sur la même échelle.
 *
 * Ajouter un jeu = ajouter un objet ici. Rien d'autre à modifier (§54).
 */

export const GENRES = {
  TACTICAL_FPS: { id: 'tactical_fps', label: 'FPS tactique' },
  ARCADE_FPS: { id: 'arcade_fps', label: 'FPS arcade' },
  MOBA: { id: 'moba', label: 'MOBA' },
  BATTLE_ROYALE: { id: 'battle_royale', label: 'Battle Royale' },
  FIGHTING: { id: 'fighting', label: 'Jeu de combat' },
  RACING: { id: 'racing', label: 'Jeu de course' },
  SPORTS: { id: 'sports', label: 'Jeu de sport' },
  STRATEGY: { id: 'strategy', label: 'Stratégie' },
  CARD: { id: 'card', label: 'Jeu de cartes' },
};

/**
 * Transfert de compétences entre genres (§10).
 * 1 = identique, 0 = tout est à réapprendre. Utilisé pour calculer la
 * familiarité de départ quand un joueur change de jeu.
 */
export const GENRE_TRANSFER = {
  tactical_fps: { tactical_fps: 1, arcade_fps: 0.62, battle_royale: 0.55, moba: 0.2, fighting: 0.18, racing: 0.1, sports: 0.12, strategy: 0.22, card: 0.12 },
  arcade_fps: { tactical_fps: 0.6, arcade_fps: 1, battle_royale: 0.58, moba: 0.28, fighting: 0.24, racing: 0.12, sports: 0.15, strategy: 0.16, card: 0.1 },
  moba: { tactical_fps: 0.22, arcade_fps: 0.3, battle_royale: 0.26, moba: 1, fighting: 0.2, racing: 0.08, sports: 0.18, strategy: 0.45, card: 0.32 },
  battle_royale: { tactical_fps: 0.56, arcade_fps: 0.58, battle_royale: 1, moba: 0.24, fighting: 0.16, racing: 0.14, sports: 0.14, strategy: 0.2, card: 0.12 },
  fighting: { tactical_fps: 0.2, arcade_fps: 0.26, battle_royale: 0.16, moba: 0.2, fighting: 1, racing: 0.18, sports: 0.28, strategy: 0.22, card: 0.24 },
  racing: { tactical_fps: 0.12, arcade_fps: 0.14, battle_royale: 0.14, moba: 0.08, fighting: 0.2, racing: 1, sports: 0.3, strategy: 0.12, card: 0.08 },
  sports: { tactical_fps: 0.14, arcade_fps: 0.16, battle_royale: 0.14, moba: 0.2, fighting: 0.3, racing: 0.28, sports: 1, strategy: 0.2, card: 0.18 },
  strategy: { tactical_fps: 0.22, arcade_fps: 0.16, battle_royale: 0.18, moba: 0.45, fighting: 0.22, racing: 0.1, sports: 0.2, strategy: 1, card: 0.42 },
  card: { tactical_fps: 0.1, arcade_fps: 0.1, battle_royale: 0.1, moba: 0.32, fighting: 0.24, racing: 0.08, sports: 0.18, strategy: 0.42, card: 1 },
};

export const GAMES = [
  {
    id: 'vanguard',
    name: 'VANGUARD PROTOCOL',
    shortName: 'Vanguard',
    genre: 'tactical_fps',
    teamSize: 5,
    releasedYearsAgo: 6,
    popularity: 82,
    esportPotential: 92,
    difficulty: 0.72,
    depth: 0.9,
    metaVolatility: 0.45,
    learnRate: 0.85,
    prizeScale: 1.35,
    description:
      "FPS tactique 5v5 en rounds. Économie, utilitaires, exécutions millimétrées. La scène récompense les équipes qui communiquent mieux qu'elles ne visent.",
    weights: { mechanical: 0.3, gameSense: 0.3, social: 0.16, mental: 0.16, professional: 0.06, media: 0.02 },
    keyAttrs: ['precision', 'reading', 'communication', 'composure'],
    roles: [
      { id: 'entry', label: 'Entry fragger', attrs: ['reflexes', 'precision', 'selfConfidence'] },
      { id: 'igl', label: 'In-game leader', attrs: ['leadership', 'reading', 'decision', 'communication'] },
      { id: 'support', label: 'Support', attrs: ['teamwork', 'anticipation', 'riskControl'] },
      { id: 'sniper', label: 'Sniper', attrs: ['precision', 'composure', 'focus'] },
      { id: 'flex', label: 'Flex', attrs: ['adaptation', 'technique', 'metaSense'] },
    ],
    metaAxes: ['agressif', 'lent', 'utilitaire', 'duels'],
  },
  {
    id: 'novacircuit',
    name: 'NOVA CIRCUIT',
    shortName: 'Nova',
    genre: 'arcade_fps',
    teamSize: 5,
    releasedYearsAgo: 3,
    popularity: 74,
    esportPotential: 78,
    difficulty: 0.55,
    depth: 0.72,
    metaVolatility: 0.78,
    learnRate: 1.15,
    prizeScale: 1.0,
    description:
      "FPS arcade à héros, rythme très élevé. Les patches redistribuent les cartes tous les deux mois : s'adapter vaut plus que maîtriser.",
    weights: { mechanical: 0.34, gameSense: 0.24, social: 0.14, mental: 0.14, professional: 0.06, media: 0.08 },
    keyAttrs: ['reflexes', 'execution', 'adaptation', 'metaSense'],
    roles: [
      { id: 'duelist', label: 'Duelliste', attrs: ['reflexes', 'execution', 'selfConfidence'] },
      { id: 'anchor', label: 'Ancre', attrs: ['composure', 'riskControl', 'teamwork'] },
      { id: 'support', label: 'Soutien', attrs: ['teamwork', 'anticipation', 'communication'] },
      { id: 'flex', label: 'Flex', attrs: ['adaptation', 'metaSense', 'technique'] },
    ],
    metaAxes: ['dive', 'poke', 'contrôle de zone'],
  },
  {
    id: 'aetheris',
    name: 'AETHERIS',
    shortName: 'Aetheris',
    genre: 'moba',
    teamSize: 5,
    releasedYearsAgo: 11,
    popularity: 95,
    esportPotential: 98,
    difficulty: 0.8,
    depth: 0.96,
    metaVolatility: 0.6,
    learnRate: 0.6,
    prizeScale: 1.8,
    description:
      "Le MOBA historique. Scène immense, académies, salaires records. La macro et la discipline de draft comptent plus que les mains.",
    weights: { mechanical: 0.2, gameSense: 0.38, social: 0.18, mental: 0.15, professional: 0.07, media: 0.02 },
    keyAttrs: ['reading', 'decision', 'metaSense', 'teamwork'],
    roles: [
      { id: 'carry', label: 'Carry', attrs: ['precision', 'consistency', 'focus'] },
      { id: 'mid', label: 'Midlane', attrs: ['creativity', 'execution', 'selfConfidence'] },
      { id: 'jungle', label: 'Jungle', attrs: ['anticipation', 'decision', 'riskControl'] },
      { id: 'shotcaller', label: 'Shotcaller', attrs: ['leadership', 'reading', 'communication'] },
      { id: 'support', label: 'Support', attrs: ['teamwork', 'anticipation', 'motivation'] },
    ],
    metaAxes: ['scaling', 'tempo', 'teamfight', 'split'],
  },
  {
    id: 'dropzone',
    name: 'DROPZONE 9',
    shortName: 'Dropzone',
    genre: 'battle_royale',
    teamSize: 3,
    releasedYearsAgo: 4,
    popularity: 88,
    esportPotential: 66,
    difficulty: 0.5,
    depth: 0.6,
    metaVolatility: 0.7,
    learnRate: 1.05,
    prizeScale: 0.9,
    description:
      "Battle royale en trios. Format à points sur plusieurs parties : la régularité et le sang-froid battent l'éclat.",
    weights: { mechanical: 0.28, gameSense: 0.26, social: 0.12, mental: 0.18, professional: 0.06, media: 0.1 },
    keyAttrs: ['consistency', 'riskControl', 'anticipation', 'composure'],
    roles: [
      { id: 'fragger', label: 'Fragger', attrs: ['reflexes', 'precision'] },
      { id: 'igl', label: 'IGL', attrs: ['decision', 'riskControl', 'communication'] },
      { id: 'support', label: 'Support', attrs: ['teamwork', 'consistency'] },
    ],
    metaAxes: ['agressif', 'placement', 'rotation'],
  },
  {
    id: 'ironfist',
    name: 'IRONFIST SAGA',
    shortName: 'Ironfist',
    genre: 'fighting',
    teamSize: 1,
    releasedYearsAgo: 8,
    popularity: 55,
    esportPotential: 60,
    difficulty: 0.85,
    depth: 0.93,
    metaVolatility: 0.3,
    learnRate: 0.7,
    prizeScale: 0.55,
    description:
      "Jeu de combat 1v1. Peu d'argent, énormément de prestige. La communauté est petite, ancienne, et n'oublie rien.",
    weights: { mechanical: 0.4, gameSense: 0.3, social: 0.04, mental: 0.2, professional: 0.03, media: 0.03 },
    keyAttrs: ['execution', 'technique', 'reading', 'composure'],
    roles: [
      { id: 'rushdown', label: 'Rushdown', attrs: ['execution', 'reflexes', 'selfConfidence'] },
      { id: 'zoner', label: 'Zoner', attrs: ['riskControl', 'anticipation', 'focus'] },
      { id: 'technical', label: 'Technicien', attrs: ['technique', 'consistency', 'learning'] },
    ],
    metaAxes: ['rushdown', 'défensif', 'mix-up'],
  },
  {
    id: 'apexvelocity',
    name: 'APEX VELOCITY',
    shortName: 'Velocity',
    genre: 'racing',
    teamSize: 1,
    releasedYearsAgo: 5,
    popularity: 48,
    esportPotential: 52,
    difficulty: 0.68,
    depth: 0.8,
    metaVolatility: 0.25,
    learnRate: 0.8,
    prizeScale: 0.7,
    description:
      "Simulation de course. Écuries, ingénieurs, réglages. Une scène propre, professionnelle, peu médiatique.",
    weights: { mechanical: 0.38, gameSense: 0.24, social: 0.08, mental: 0.19, professional: 0.09, media: 0.02 },
    keyAttrs: ['consistency', 'coordination', 'focus', 'technique'],
    roles: [{ id: 'driver', label: 'Pilote', attrs: ['consistency', 'focus', 'composure'] }],
    metaAxes: ['réglage agressif', 'gestion des pneus', 'qualification'],
  },
  {
    id: 'stadiumkings',
    name: 'STADIUM KINGS',
    shortName: 'Stadium',
    genre: 'sports',
    teamSize: 1,
    releasedYearsAgo: 9,
    popularity: 63,
    esportPotential: 58,
    difficulty: 0.5,
    depth: 0.65,
    metaVolatility: 0.9,
    learnRate: 1.2,
    prizeScale: 0.75,
    description:
      "Simulation de football 1v1, adossée aux clubs traditionnels. Un nouvel opus chaque année remet tout le monde à zéro.",
    weights: { mechanical: 0.32, gameSense: 0.26, social: 0.06, mental: 0.18, professional: 0.06, media: 0.12 },
    keyAttrs: ['execution', 'adaptation', 'composure', 'charisma'],
    roles: [{ id: 'player', label: 'Joueur', attrs: ['execution', 'adaptation'] }],
    metaAxes: ['possession', 'contre', 'pressing'],
  },
  {
    id: 'dominion',
    name: 'DOMINION RISING',
    shortName: 'Dominion',
    genre: 'strategy',
    teamSize: 1,
    releasedYearsAgo: 14,
    popularity: 38,
    esportPotential: 55,
    difficulty: 0.9,
    depth: 0.98,
    metaVolatility: 0.2,
    learnRate: 0.5,
    prizeScale: 0.6,
    description:
      "RTS 1v1 exigeant. Scène vieillissante mais d'une longévité rare : on y fait des carrières de quinze ans.",
    weights: { mechanical: 0.3, gameSense: 0.4, social: 0.04, mental: 0.17, professional: 0.07, media: 0.02 },
    keyAttrs: ['execution', 'decision', 'anticipation', 'workCapacity'],
    roles: [{ id: 'commander', label: 'Commandant', attrs: ['decision', 'execution', 'anticipation'] }],
    metaAxes: ['rush', 'macro', 'harass'],
  },
  {
    id: 'arcanum',
    name: 'ARCANUM DUEL',
    shortName: 'Arcanum',
    genre: 'card',
    teamSize: 1,
    releasedYearsAgo: 7,
    popularity: 51,
    esportPotential: 44,
    difficulty: 0.45,
    depth: 0.75,
    metaVolatility: 0.95,
    learnRate: 1.3,
    prizeScale: 0.65,
    description:
      "Jeu de cartes compétitif. Extension tous les trimestres, variance énorme en tournoi : on y devient célèbre vite, et on y disparaît vite.",
    weights: { mechanical: 0.08, gameSense: 0.46, social: 0.06, mental: 0.2, professional: 0.08, media: 0.12 },
    keyAttrs: ['metaSense', 'decision', 'creativity', 'riskControl'],
    roles: [{ id: 'duelist', label: 'Duelliste', attrs: ['metaSense', 'decision'] }],
    metaAxes: ['aggro', 'contrôle', 'combo'],
  },
];

export const GAMES_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));

export function transferRate(fromGenre, toGenre) {
  return GENRE_TRANSFER[fromGenre]?.[toGenre] ?? 0.15;
}
