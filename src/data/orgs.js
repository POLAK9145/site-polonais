/**
 * Archétypes d'organisations (§13) et philosophies de recrutement (§17).
 *
 * Le tier détermine le budget, la pression et le niveau attendu. La
 * philosophie détermine QUI l'organisation veut : c'est elle qui rend le
 * marché lisible. Une structure « formation » ne signera pas un vétéran de
 * 28 ans, même excellent — et c'est exactement ce qui permet à un jeune
 * joueur moyen d'avoir sa chance quelque part.
 */

export const ORG_TIERS = [
  { tier: 1, label: 'Équipe communautaire', budget: [0, 9000], reputation: [2, 12], pressure: 0.1 },
  { tier: 2, label: 'Petite structure', budget: [25000, 90000], reputation: [10, 28], pressure: 0.3 },
  { tier: 3, label: 'Organisation ambitieuse', budget: [180000, 600000], reputation: [26, 52], pressure: 0.55 },
  { tier: 4, label: 'Grosse organisation', budget: [900000, 2600000], reputation: [50, 78], pressure: 0.78 },
  { tier: 5, label: 'Organisation internationale', budget: [3000000, 9000000], reputation: [74, 96], pressure: 0.95 },
];

export const ORG_TIERS_BY_TIER = Object.fromEntries(ORG_TIERS.map((t) => [t.tier, t]));

export const PHILOSOPHIES = [
  {
    id: 'youth',
    label: 'Formation',
    desc: 'Mise sur les jeunes à fort potentiel, accepte de perdre en attendant.',
    prefers: { maxAge: 21, potentialWeight: 1.6, ratingWeight: 0.6, patience: 1.7 },
  },
  {
    id: 'stars',
    label: 'Star system',
    desc: 'Achète des noms. Résultats immédiats exigés.',
    prefers: { maxAge: 30, potentialWeight: 0.5, ratingWeight: 1.5, patience: 0.4, repWeight: 1.5 },
  },
  {
    id: 'stability',
    label: 'Continuité',
    desc: 'Garde son roster longtemps, corrige à la marge.',
    prefers: { maxAge: 32, potentialWeight: 0.9, ratingWeight: 1.0, patience: 1.9, loyaltyWeight: 1.6 },
  },
  {
    id: 'chaos',
    label: 'Instable',
    desc: 'Change de roster à la moindre contre-performance.',
    prefers: { maxAge: 29, potentialWeight: 0.8, ratingWeight: 1.2, patience: 0.25 },
  },
  {
    id: 'domestic',
    label: 'Ancrage régional',
    desc: 'Recrute prioritairement dans sa région.',
    prefers: { maxAge: 30, potentialWeight: 1.0, ratingWeight: 1.0, patience: 1.2, regionBias: 2.2 },
  },
  {
    id: 'analytics',
    label: 'Data-driven',
    desc: 'Évalue les profils, ignore la réputation.',
    prefers: { maxAge: 28, potentialWeight: 1.3, ratingWeight: 1.2, patience: 1.3, repWeight: 0.35 },
  },
];

export const PHILOSOPHIES_BY_ID = Object.fromEntries(PHILOSOPHIES.map((p) => [p.id, p]));

/** Types de sponsors : influent sur le budget et sur l'exposition médiatique. */
export const SPONSOR_TYPES = [
  { id: 'hardware', label: 'Périphériques', value: 0.9, mediaBoost: 0.3 },
  { id: 'energy', label: 'Boisson énergisante', value: 1.2, mediaBoost: 0.7 },
  { id: 'telecom', label: 'Télécom', value: 1.5, mediaBoost: 0.5 },
  { id: 'bank', label: 'Banque', value: 1.7, mediaBoost: 0.4, requiresCleanImage: true },
  { id: 'apparel', label: 'Textile', value: 1.0, mediaBoost: 0.8 },
  { id: 'local', label: 'Commerce local', value: 0.35, mediaBoost: 0.1 },
  { id: 'tech', label: 'Constructeur', value: 1.4, mediaBoost: 0.35 },
];
