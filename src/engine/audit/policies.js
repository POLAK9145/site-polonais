/**
 * Joueurs automatiques pour l'audit (§4, §25, §27).
 *
 * Une seule politique de jeu ne suffit pas à auditer un simulateur : si le
 * robot choisit toujours la première option, on mesure la qualité de la
 * première option, pas celle du système. On fait donc jouer plusieurs
 * profils décisionnels, y compris volontairement mauvais (§27), et on compare.
 *
 * Ces politiques ne trichent pas : elles n'ont accès qu'à ce que l'interface
 * montre au joueur (libellé, indice, marqueur « risqué »).
 */

import { RNG } from '../rng.js';

/** Mots-clés repérables dans les libellés visibles par le joueur. */
const KEYWORDS = {
  training: ['entraîn', 'travail', 'réapprendre', 'analys', 'progress', 'sérieus', 'organiser'],
  rest: ['repos', 'lever le pied', 'reconstruire', 'recul', 'décrocher'],
  media: ['surfer', 'assumer', 'média', 'contenu', 'créateur', 'basculer', 'publiquement', 'stream'],
  social: ['désamorcer', 'souhaiter', 'partager', 'équipe', 'staff', 'aile', 'reconnaître'],
  money: ['accepter', 'signer', 'prolonger', 'plus', 'travail à côté'],
  safe: ['rester', 'refuser', 'ne rien', 'attendre', 'continuer', 'concentr'],
};

function matches(label, keys) {
  const l = (label ?? '').toLowerCase();
  return keys.some((k) => l.includes(k));
}

/**
 * Chaque politique reçoit les choix visibles et renvoie un index.
 * `state` est un petit espace mémoire propre à la politique.
 */
export const POLICIES = {
  /** Toujours la première option : référence neutre. */
  first: {
    label: 'Première option',
    choose: () => 0,
  },

  /** Toujours la dernière : détecte les options « de repli » mal réglées. */
  last: {
    label: 'Dernière option',
    choose: (choices) => choices.length - 1,
  },

  /** Aléatoire seedé : la référence statistique. */
  random: {
    label: 'Aléatoire',
    choose: (choices, ctx) => ctx.rng.int(0, choices.length - 1),
  },

  /** Cherche la progression avant tout, quitte à se griller. */
  grinder: {
    label: 'Bourreau de travail',
    routine: ['mechanics', 'mechanics', 'strategy', 'review'],
    choose: (choices, ctx) => {
      const i = choices.findIndex((c) => matches(c.label, KEYWORDS.training));
      return i >= 0 ? i : ctx.rng.int(0, choices.length - 1);
    },
  },

  /** Joue la sécurité, refuse le risque. */
  cautious: {
    label: 'Prudent',
    routine: ['mechanics', 'strategy', 'rest', 'social'],
    choose: (choices, ctx) => {
      const safe = choices.findIndex((c) => !c.risky && matches(c.label, KEYWORDS.safe));
      if (safe >= 0) return safe;
      const nonRisky = choices.findIndex((c) => !c.risky);
      return nonRisky >= 0 ? nonRisky : ctx.rng.int(0, choices.length - 1);
    },
  },

  /** Prend systématiquement les options risquées. */
  reckless: {
    label: 'Tête brûlée',
    routine: ['mechanics', 'scrim', 'streaming', 'review'],
    choose: (choices, ctx) => {
      const risky = choices.findIndex((c) => c.risky);
      return risky >= 0 ? risky : ctx.rng.int(0, choices.length - 1);
    },
  },

  /** Construit une audience plutôt qu'un palmarès. */
  entertainer: {
    label: 'Créateur',
    routine: ['streaming', 'content', 'mechanics', 'rest'],
    choose: (choices, ctx) => {
      const i = choices.findIndex((c) => matches(c.label, KEYWORDS.media));
      return i >= 0 ? i : ctx.rng.int(0, choices.length - 1);
    },
  },

  /** Privilégie le collectif et les relations. */
  teamplayer: {
    label: 'Collectif',
    routine: ['scrim', 'strategy', 'social', 'rest'],
    choose: (choices, ctx) => {
      const i = choices.findIndex((c) => matches(c.label, KEYWORDS.social));
      return i >= 0 ? i : ctx.rng.int(0, choices.length - 1);
    },
  },

  /**
   * Politique volontairement mauvaise (§27) : refuse les opportunités, ne
   * se repose jamais, cherche l'argent immédiat. Le système doit produire
   * une carrière médiocre mais cohérente, pas une erreur.
   */
  saboteur: {
    label: 'Décisions calamiteuses',
    routine: ['streaming', 'streaming', 'social', 'content'],
    refuseOffers: true,
    choose: (choices, ctx) => {
      const refuse = choices.findIndex((c) => matches(c.label, KEYWORDS.safe) && !matches(c.label, KEYWORDS.training));
      return refuse >= 0 ? refuse : choices.length - 1;
    },
  },
};

export const POLICY_IDS = Object.keys(POLICIES);

export function createPolicyState(policyId, seed) {
  const policy = POLICIES[policyId] ?? POLICIES.random;
  return {
    id: policyId,
    policy,
    rng: new RNG(seed),
  };
}

/** Choisit une option ; robuste face à une politique qui déraille. */
export function pickChoice(policyState, choices) {
  if (!choices || choices.length === 0) return null;
  let index = 0;
  try {
    index = policyState.policy.choose(choices, policyState);
  } catch {
    index = 0;
  }
  if (!Number.isInteger(index) || index < 0 || index >= choices.length) index = 0;
  return choices[index];
}
