/**
 * Traits de personnalité (§16).
 *
 * Un trait n'est pas décoratif : il expose des `mods` lus par le moteur
 * (progression, synergie, transferts, événements). Si un trait n'a aucun
 * effet mesurable, il n'a rien à faire ici (§85).
 *
 * mods disponibles :
 *  growth        multiplicateur de progression
 *  synergy       impact sur la cohésion d'équipe
 *  clutchDelta   bonus/malus de performance dans les matchs à enjeu
 *  formVolatility amplitude des périodes de forme
 *  mediaGrowth   vitesse de croissance de l'audience
 *  loyalty       résistance à partir en transfert
 *  greed         importance du salaire dans les décisions
 *  conflictRisk  probabilité de générer des tensions
 *  burnoutRisk   sensibilité à la surcharge
 */

export const TRAITS = [
  {
    id: 'ambitious',
    label: 'Ambitieux',
    desc: "Veut toujours l'étage au-dessus. Part vite si le projet plafonne.",
    mods: { growth: 1.08, loyalty: 0.75, greed: 1.1, conflictRisk: 1.1 , ambition: 1.35},
  },
  {
    id: 'calm',
    label: 'Calme',
    desc: 'Ne panique pas. Ne s’enflamme pas non plus.',
    mods: { clutchDelta: 3, formVolatility: 0.75, conflictRisk: 0.7 },
  },
  {
    id: 'arrogant',
    label: 'Arrogant',
    desc: 'Sûr de lui jusqu’à l’aveuglement. Les vestiaires le supportent mal.',
    mods: { synergy: -0.18, conflictRisk: 1.6, mediaGrowth: 1.2, clutchDelta: 2 },
  },
  {
    id: 'hardworking',
    label: 'Travailleur',
    desc: 'Le premier arrivé, le dernier parti.',
    mods: { growth: 1.16, burnoutRisk: 1.15, loyalty: 1.1 },
  },
  {
    id: 'unstable',
    label: 'Instable',
    desc: 'Capable du meilleur un soir et de l’inexplicable le lendemain.',
    mods: { formVolatility: 1.7, conflictRisk: 1.3, clutchDelta: -4, growth: 1.05 },
  },
  {
    id: 'loyal',
    label: 'Loyal',
    desc: 'Reste quand ça va mal.',
    mods: { loyalty: 1.7, synergy: 0.12, greed: 0.8 , ambition: 0.82},
  },
  {
    id: 'opportunist',
    label: 'Opportuniste',
    desc: 'Sait exactement quand partir.',
    mods: { loyalty: 0.5, greed: 1.35, synergy: -0.06 , ambition: 1.2},
  },
  {
    id: 'introvert',
    label: 'Introverti',
    desc: 'Parle peu. Ce n’est pas toujours un problème.',
    mods: { mediaGrowth: 0.6, synergy: -0.05, burnoutRisk: 0.9 },
  },
  {
    id: 'showman',
    label: 'Médiatique',
    desc: 'Né pour la caméra.',
    mods: { mediaGrowth: 1.75, growth: 0.95, burnoutRisk: 1.1 },
  },
  {
    id: 'competitive',
    label: 'Compétiteur',
    desc: 'Déteste perdre plus qu’il n’aime gagner.',
    mods: { clutchDelta: 4, growth: 1.06, conflictRisk: 1.15, burnoutRisk: 1.1 , ambition: 1.15},
  },
  {
    id: 'grudgeful',
    label: 'Rancunier',
    desc: 'N’oublie jamais une trahison.',
    mods: { conflictRisk: 1.4, loyalty: 0.9 },
  },
  {
    id: 'diplomat',
    label: 'Diplomate',
    desc: 'Désamorce ce que les autres allument.',
    mods: { synergy: 0.2, conflictRisk: 0.45, mediaGrowth: 1.1 },
  },
  {
    id: 'perfectionist',
    label: 'Perfectionniste',
    desc: 'Revoit ses erreurs jusqu’à en perdre le sommeil.',
    mods: { growth: 1.12, burnoutRisk: 1.35, formVolatility: 0.85 },
  },
  {
    id: 'laidback',
    label: 'Nonchalant',
    desc: 'Ne se met jamais la pression. Parfois trop peu.',
    mods: { growth: 0.86, burnoutRisk: 0.6, clutchDelta: 2, formVolatility: 0.9 , ambition: 0.78},
  },
  {
    id: 'teamfirst',
    label: 'Altruiste',
    desc: 'Fait briller les autres.',
    mods: { synergy: 0.24, mediaGrowth: 0.85 , ambition: 0.9},
  },
  {
    id: 'analytical',
    label: 'Analytique',
    desc: 'Comprend la méta avant qu’elle n’existe.',
    mods: { growth: 1.1, formVolatility: 0.85 },
  },
  {
    id: 'volatile_temper',
    label: 'Soupe au lait',
    desc: 'Explose vite, s’excuse tard.',
    mods: { conflictRisk: 1.8, synergy: -0.15, clutchDelta: -2, mediaGrowth: 1.15 },
  },
  {
    id: 'resilient',
    label: 'Increvable',
    desc: 'Revient toujours.',
    mods: { burnoutRisk: 0.65, formVolatility: 0.8, growth: 1.03 },
  },
];

export const TRAITS_BY_ID = Object.fromEntries(TRAITS.map((t) => [t.id, t]));

/** Paires qui ne peuvent pas coexister chez un même personnage. */
export const INCOMPATIBLE_TRAITS = [
  ['calm', 'volatile_temper'],
  ['calm', 'unstable'],
  ['loyal', 'opportunist'],
  ['introvert', 'showman'],
  ['hardworking', 'laidback'],
  ['diplomat', 'volatile_temper'],
  ['diplomat', 'arrogant'],
  ['teamfirst', 'arrogant'],
  ['perfectionist', 'laidback'],
  ['resilient', 'unstable'],
];

export function traitsCompatible(a, b) {
  return !INCOMPATIBLE_TRAITS.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  );
}

/**
 * Agrège les modificateurs de plusieurs traits.
 *
 * Mémoïsé : cette fonction représentait 15 % du temps CPU de la simulation
 * (appelée à chaque progression, chaque match et chaque calcul de synergie,
 * pour chacun des ~800 personnages). Les traits d'un personnage ne changent
 * jamais après sa création, donc le résultat est mis en cache par
 * combinaison de traits. Comportement identique, coût quasi nul.
 */
const modsCache = new Map();

export function traitMods(traitIds) {
  const key = traitIds && traitIds.length > 0 ? traitIds.join(',') : '';
  const cached = modsCache.get(key);
  if (cached) return cached;
  const computed = computeTraitMods(traitIds);
  // Le nombre de combinaisons réellement rencontrées est petit ; on borne
  // tout de même le cache par prudence.
  if (modsCache.size < 20000) modsCache.set(key, computed);
  return computed;
}

function computeTraitMods(traitIds) {
  const out = {
    growth: 1,
    synergy: 0,
    clutchDelta: 0,
    formVolatility: 1,
    mediaGrowth: 1,
    loyalty: 1,
    greed: 1,
    conflictRisk: 1,
    burnoutRisk: 1,
    // Appétit pour l'étage au-dessus : pèse sur les décisions de carrière des
    // PNJ (accepter une structure modeste, tenter une autre scène). Les traits
    // le portaient déjà dans leur description sans qu'aucun chiffre ne
    // l'exprime — « Veut toujours l'étage au-dessus », pour Ambitieux.
    ambition: 1,
  };
  for (const id of traitIds || []) {
    const t = TRAITS_BY_ID[id];
    if (!t) continue;
    for (const [k, v] of Object.entries(t.mods)) {
      if (k === 'synergy' || k === 'clutchDelta') out[k] += v;
      else out[k] *= v;
    }
  }
  return out;
}
