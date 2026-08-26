/**
 * Départs prédéfinis (§38, étape 9N).
 *
 * CE QU'UN SCÉNARIO EST, ET N'EST PAS
 * -----------------------------------
 * Ce n'est pas une histoire écrite d'avance : le jeu n'en contient aucune, et
 * ce n'est pas le moment de commencer. C'est une SITUATION DE DÉPART — une
 * combinaison d'origine, de région, de jeu, d'âge et de difficulté qui pose un
 * problème différent. La suite reste entièrement simulée.
 *
 * Chaque scénario doit donc se justifier par une contrainte réelle du moteur,
 * pas par son intitulé :
 *
 *  - la densité de talent d'une région décide de la concurrence ;
 *  - son infrastructure décide du nombre de structures et de leur niveau ;
 *  - l'origine décide du niveau de départ, de la marge de progression restante
 *    et de l'argent ;
 *  - l'âge décide de ce qu'il reste à prendre (`remainingPotential`) ;
 *  - la difficulté décide des occasions et du coût des erreurs.
 *
 * Le champ `defi` dit ce que le scénario rend difficile, en une phrase, et doit
 * rester vérifiable dans les chiffres ci-dessus.
 */

export const SCENARIOS = [
  {
    id: 'classique',
    label: 'Premier pas',
    desc: 'Dix-sept ans, une chambre, une scène structurée. Le départ ordinaire.',
    defi: 'Aucun handicap particulier — la carrière à l’état pur.',
    regionId: 'weu',
    gameId: 'vanguard',
    originId: 'child_competitor',
    familyId: 'supportive',
    age: 17,
    difficulty: 'standard',
  },
  {
    id: 'usine',
    label: 'L’usine à talents',
    desc: 'Asie de l’Est : la densité de talent la plus forte du monde, et des structures qui en profitent.',
    defi: 'La concurrence est maximale (densité 0,98) — chaque place se prend à quelqu’un.',
    regionId: 'ea',
    gameId: 'vanguard',
    originId: 'child_competitor',
    familyId: 'demanding',
    age: 16,
    difficulty: 'hard',
  },
  {
    id: 'sans_structure',
    label: 'Du talent, pas de circuit',
    desc: 'Amérique du Sud : beaucoup de joueurs, peu de structures pour les accueillir.',
    defi: 'Densité 0,88 pour une infrastructure de 0,55 — se faire remarquer est le problème.',
    regionId: 'sa',
    gameId: 'ironfist',
    originId: 'selftaught',
    familyId: 'absent',
    age: 18,
    difficulty: 'standard',
  },
  {
    id: 'tardif',
    label: 'Trop tard, peut-être',
    desc: 'Vingt-trois ans. Les autres ont commencé il y a dix ans.',
    defi: 'La marge de progression restante est presque nulle à cet âge : tout se joue sur la lecture du jeu.',
    regionId: 'neu',
    gameId: 'novacircuit',
    originId: 'late_bloomer',
    familyId: 'demanding',
    age: 23,
    difficulty: 'standard',
  },
  {
    id: 'transfuge',
    label: 'Le transfuge',
    desc: 'Vous étiez bon ailleurs. Ce jeu-là est mort, et vous repartez de presque zéro.',
    defi: 'Familiarité de départ à 0,20 : le niveau est là, l’aisance sur le jeu non.',
    regionId: 'na',
    gameId: 'vanguard',
    originId: 'game_switcher',
    familyId: 'supportive',
    age: 20,
    difficulty: 'standard',
  },
  {
    id: 'vitrine',
    label: 'Déjà une audience',
    desc: 'Vous êtes connu avant d’être bon. Tout le monde vous regarde échouer ou réussir.',
    defi: 'On vous jugera sur ce que vous montrez autant que sur ce que vous valez.',
    regionId: 'weu',
    gameId: 'novacircuit',
    originId: 'creator',
    familyId: 'wealthy',
    age: 18,
    difficulty: 'standard',
  },
  {
    id: 'rien',
    label: 'Sans filet',
    desc: 'Pas d’argent, pas de soutien, une scène peu structurée. Une mauvaise année et c’est fini.',
    defi: 'Difficulté exigeante, famille absente, infrastructure faible : aucune erreur n’est amortie.',
    regionId: 'eeu',
    gameId: 'ironfist',
    originId: 'living_room',
    familyId: 'absent',
    age: 17,
    difficulty: 'hard',
  },
];

export const SCENARIOS_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

/**
 * Le défi du jour (§37).
 *
 * Une graine dérivée de la DATE : tout le monde joue exactement le même monde
 * le même jour, et le déterminisme du moteur le garantit sans rien stocker.
 *
 * Il n'y a pas de classement, et il n'y en aura pas : un classement suppose un
 * serveur, alors que le jeu est hors ligne par construction. Ce que le défi
 * offre, c'est un monde partagé — de quoi comparer une carrière avec quelqu'un
 * d'autre en se disant la graine, pas un tableau d'honneur.
 */
export function dailySeed(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const j = String(date.getUTCDate()).padStart(2, '0');
  return `defi-${y}-${m}-${j}`;
}

/** Le scénario du jour : la date choisit aussi la situation de départ. */
export function dailyScenario(date = new Date()) {
  const graine = dailySeed(date);
  // Somme des codes de la date : stable, sans RNG, et indépendante du moteur.
  let somme = 0;
  for (const c of graine) somme = (somme * 31 + c.charCodeAt(0)) >>> 0;
  const scenario = SCENARIOS[somme % SCENARIOS.length];
  return { ...scenario, seed: graine, dateLabel: graine.slice(5) };
}
