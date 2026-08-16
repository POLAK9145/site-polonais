/**
 * Réputation et audience (étape 6).
 *
 * DEUX PROBLÈMES CORRIGÉS
 * -----------------------
 *
 * **1. La réputation ne décroissait nulle part.** Aucune ligne du moteur ne
 * faisait jamais baisser `person.reputation`. Sur trente ans, les
 * professionnels mesurés passaient d'une médiane de 26 à 5 — non parce que
 * quiconque était oublié, mais parce que les anciens saturaient à 100 et
 * quittaient l'échantillon, tandis que les nouveaux partaient de 5. Le p90
 * montait de 48 à 99, le maximum atteignait 100 : l'échelle n'avait plus de
 * haut. Et la réputation d'organisation, ne décroissant jamais elle non plus,
 * verrouillait le multiplicateur de revenus au-dessus de 1 (voir `economy.js`).
 *
 * **2. L'audience n'existait que pour le joueur.** La croissance était écrite
 * dans `runPlayerWeek` et nulle part ailleurs : `simulateNpcs` n'y touchait
 * pas. Résultat mesuré, monde sans joueur : médiane 4 148 à l'année 1, **0** à
 * l'année 20 — la cohorte initiale semée par `worldgen` prenait sa retraite et
 * les générations suivantes naissaient à zéro pour n'en jamais sortir. Le
 * maximum tombait de 0,07 M à 0,00 M. Par ailleurs `fx.followers(delta)`
 * écrivait directement dans le champ, sans plafond : le seul plafond du moteur
 * ne s'appliquait qu'à un seul chemin sur trois.
 *
 * MODÈLE RETENU
 * -------------
 * La réputation ne se soustrait pas d'un point par an. Elle **glisse vers ce
 * que la situation actuelle justifie**, et s'arrête sur un plancher que le
 * palmarès rend définitif :
 *
 *     réputation → max(mémoire du palmarès, ce que le niveau actuel justifie)
 *
 * Un champion du monde reste connu vingt ans après sa retraite ; un
 * professionnel anonyme est oublié en trois ans. La portée d'une victoire est
 * distinguée : gagner un open rend connu **localement**, gagner un mondial rend
 * connu **partout**.
 *
 * L'audience passe par une seule porte, `gainFollowers`, qui applique le
 * plafond et le rendement décroissant quel que soit l'appelant. Et comme le
 * plafond est une fonction de la réputation, une réputation qui décroît fait
 * **descendre le plafond**, et l'audience redescend avec lui : le déclin
 * d'audience n'est pas une règle ajoutée, c'est une conséquence.
 */

import { clamp } from './rng.js';
import { STATUS } from './person.js';
import { isTracing, trace, TRACE } from './trace.js';

/** Portée d'une compétition : jusqu'où sa victoire se sait. */
export const SCOPE = { LOCAL: 'local', NATIONAL: 'national', GLOBAL: 'global' };

/**
 * Un tournoi communautaire ne vous fait pas connaître du monde. Le niveau réel
 * de la compétition décide de la portée, pas le fait d'avoir gagné.
 */
export function titleScope(tierLevel) {
  if (tierLevel >= 5) return SCOPE.GLOBAL;
  if (tierLevel >= 3) return SCOPE.NATIONAL;
  return SCOPE.LOCAL;
}

/** Vitesse annuelle d'oubli : retour vers ce que la situation justifie. */
const FORGET_RATE = 0.22;

/**
 * Vitesse annuelle de reconnaissance : jouer à un niveau finit par vous y faire
 * connaître, même sans rien gagner.
 *
 * Sans ce sens-là, la réputation ne pouvait que baisser ou bondir sur un titre,
 * et le milieu du tableau était affamé : mesurée à l'année 30, la réputation
 * médiane d'un titulaire de tier 2 tombait à 2,5 — moins que celle d'un inconnu
 * à sa création. Un titulaire de deuxième division n'est pas un anonyme.
 */
const RECOGNITION_RATE = 0.16;

/** Vitesse de retour annuel de l'audience vers son plafond. */
const AUDIENCE_RETURN = 0.28;

/** Érosion annuelle d'une audience entretenue par personne. */
const AUDIENCE_IDLE_DECAY = 0.06;

/**
 * Mémoire du palmarès : le plancher de réputation qu'un palmarès rend
 * définitif. C'est la différence entre « oublié » et « légende ».
 *
 * Un mondial pèse près de trois fois un titre majeur, et les finales comptent
 * un peu : on se souvient d'avoir vu quelqu'un tout près du sommet.
 */
export function reputationFloor(person) {
  const s = person.stats ?? {};
  const intl = s.internationalTitles ?? 0;
  const majors = Math.max(0, (s.titles ?? 0) - intl);
  const glory = 12 * intl + 3.5 * majors + 1.1 * (s.finals ?? 0);
  return {
    pros: clamp(glory, 0, 88),
    public: clamp(glory * 0.9, 0, 85),
    community: clamp(glory * 0.5, 0, 70),
    // La mémoire médiatique ne retient que le sommet : les médias se souviennent
    // des mondiaux, pas des saisons de ligue nationale.
    media: clamp(12 * intl, 0, 80),
  };
}

/**
 * Ce que la situation actuelle justifie à elle seule, sans palmarès : le niveau
 * réel auquel on joue, et le fait d'y jouer ou de regarder depuis le banc.
 *
 * C'est cette valeur qui fait qu'un joueur sans équipe est progressivement
 * oublié — et qu'un titulaire de tier 5 n'a pas besoin de palmarès pour être
 * connu.
 */
export function standingSupport(world, person) {
  if (person.status === STATUS.RETIRED) return 0;
  const team = person.teamId ? world.teams[person.teamId] : null;
  if (!team?.active) return 3;
  const org = world.orgs[team.orgId];
  const level = org?.alive ? org.tier : 1;
  const starter = team.roster.includes(person.id);
  return clamp(level * 13 * (starter ? 1 : 0.72), 0, 72);
}

/** Part du soutien courant qui alimente chaque canal de réputation. */
const SUPPORT_WEIGHT = { pros: 1, public: 0.62, community: 0.5 };

/**
 * Fait glisser la réputation vers ce que la situation justifie — dans les deux
 * sens, et à deux vitesses différentes.
 *
 * Vers le bas : l'oubli, arrêté par le plancher du palmarès. Vers le haut : la
 * reconnaissance, plus lente, plafonnée par ce que le niveau justifie — au-delà,
 * seuls les titres font monter. Un titulaire de tier 5 sans palmarès atteint
 * ainsi une soixantaine ; les quarante points du haut de l'échelle ne s'obtiennent
 * qu'en gagnant.
 */
export function settleReputation(world, person) {
  const floor = reputationFloor(person);
  const support = standingSupport(world, person);
  let moved = 0;
  for (const kind of ['pros', 'public', 'community']) {
    const current = person.reputation[kind] ?? 0;
    const target = Math.max(floor[kind], support * SUPPORT_WEIGHT[kind]);
    if (Math.abs(current - target) < 0.05) continue;
    const rate = current > target ? FORGET_RATE : RECOGNITION_RATE;
    const next = current + (target - current) * rate;
    moved += Math.abs(current - next);
    person.reputation[kind] = Math.round(next * 10) / 10;
  }
  // La toxicité s'oublie aussi : c'est ce qui permet une seconde chance.
  if (person.reputation.toxicity > 0) {
    person.reputation.toxicity = Math.round(person.reputation.toxicity * 0.85 * 10) / 10;
  }
  return moved;
}

/**
 * Plafond d'audience atteignable, déterminé par la notoriété publique, la
 * communauté et le palmarès. Un champion du monde charismatique peut viser
 * plusieurs millions ; un joueur inconnu qui streame beaucoup plafonnera
 * autour de quelques dizaines de milliers.
 *
 * Source de vérité unique : tout chemin qui fait gagner de l'audience passe par
 * `gainFollowers`, qui l'applique.
 */
export function audienceCeiling(person) {
  const rep = person.reputation;
  const s = person.stats ?? {};
  return (
    8000 +
    Math.pow(Math.max(1, rep.public), 2.15) * 60 +
    rep.community * 900 +
    (s.titles ?? 0) * 25000 +
    (s.internationalTitles ?? 0) * 120000
  );
}

/**
 * **La seule porte d'entrée de l'audience.**
 *
 * Reçoit une quantité brute — ce que l'activité vaudrait sans contrainte — et
 * renvoie ce qui a réellement été gagné, après plafond et rendement
 * décroissant. Tous les appelants passent ici : semaine du joueur, exposition
 * des PNJ, effets d'événement, génération du monde.
 */
export function gainFollowers(world, person, raw, reason = 'exposition') {
  if (!(raw > 0)) return 0;
  const ceiling = audienceCeiling(person);
  const room = clamp(1 - person.followers / ceiling, 0, 1);
  // Rendement décroissant : les derniers pourcents avant le plafond coûtent
  // beaucoup plus que les premiers.
  // Le rendement décroissant règle la **vitesse** d'approche ; il ne suffit pas
  // à faire respecter le plafond. Parti de zéro, `room` vaut 1 et un apport
  // massif en une seule fois passait intégralement : un événement pouvait porter
  // un inconnu à cinq millions de suiveurs. Le plafond est donc aussi une borne
  // dure sur le résultat, sans quoi il n'en est pas un.
  const gained = Math.min(
    Math.round(raw * Math.pow(room, 0.7)),
    Math.max(0, Math.round(ceiling - person.followers)),
  );
  if (gained <= 0) return 0;
  person.followers += gained;
  if (person.followers > (person.stats.peakFollowers ?? 0)) {
    person.stats.peakFollowers = person.followers;
  }
  if (isTracing()) {
    trace(TRACE.ECONOMY, world?.week ?? 0, {
      decision: 'followers',
      personId: person.id,
      reason,
      raw: Math.round(raw),
      ceiling: Math.round(ceiling),
      room: Math.round(room * 100) / 100,
      gained,
      after: person.followers,
    });
  }
  return gained;
}

/**
 * Retour de l'audience vers ce que la notoriété justifie.
 *
 * Le déclin n'est pas une règle indépendante : le plafond est une fonction de
 * la réputation, la réputation décroît quand plus rien ne la soutient, donc le
 * plafond descend — et l'audience redescend avec lui. Un joueur oublié perd son
 * public parce qu'il n'y a plus de raison de le suivre.
 */
export function settleAudience(world, person) {
  const before = person.followers;
  if (before <= 0) return 0;
  const ceiling = audienceCeiling(person);
  if (before > ceiling) {
    person.followers = Math.round(before - (before - ceiling) * AUDIENCE_RETURN);
  } else if (person.status === STATUS.RETIRED || !person.teamId) {
    // Sous le plafond, une audience qu'on n'entretient plus s'érode lentement.
    person.followers = Math.round(before * (1 - AUDIENCE_IDLE_DECAY));
  } else {
    return 0;
  }
  const lost = before - person.followers;
  if (isTracing() && lost > 0) {
    trace(TRACE.ECONOMY, world?.week ?? 0, {
      decision: 'followers_decline',
      personId: person.id,
      before,
      ceiling: Math.round(ceiling),
      after: person.followers,
      lost,
      cause: before > ceiling ? 'plafond descendu' : 'audience non entretenue',
    });
  }
  return lost;
}

/**
 * Exposition annuelle d'un PNJ : ce que le fait de jouer à son niveau lui
 * rapporte en audience, sans simuler ses semaines.
 *
 * C'est ce qui manquait entièrement : sans cette passe, seuls les joueurs
 * simulés semaine par semaine — c'est-à-dire le joueur — avaient une audience.
 */
export function npcAudienceGrowth(world, person) {
  const support = standingSupport(world, person);
  if (support <= 4) return 0;
  // Portée brute de l'année : combien de personnes ont eu l'occasion de le voir
  // jouer. C'est une fonction du **niveau réel** auquel il joue, pas de son
  // compteur actuel — sans quoi la croissance dépend d'elle-même et un joueur
  // parti de zéro n'en sort jamais (mesuré : maximum 8 k après trente ans).
  // L'exposant fait qu'un mondial expose de deux ordres de grandeur plus qu'une
  // ligue nationale, ce qui est l'écart réel.
  const reach = Math.pow(support, 2.55) * 0.6;
  const charisma = 0.35 + (person.attrs?.entertainment ?? 40) / 100;
  return gainFollowers(world, person, reach * charisma, 'exposition compétitive');
}

/**
 * Audience gagnée en **gagnant** — la dimension qui manquait.
 *
 * Sans elle, la portée annuelle ne dépendait que du niveau : tout le monde
 * convergeait vers la même audience et la distribution mesurée était écrasée —
 * 30 % des joueurs au-dessus de 100 k, personne au-dessus de 700 k, aucune
 * vedette. Une vedette doit **combiner** plusieurs dimensions : jouer haut,
 * plaire, et gagner. Un titre mondial expose incomparablement plus qu'une
 * saison de ligue nationale, et c'est la portée qui le dit.
 */
export function titleAudienceBurst(world, person, tierLevel) {
  const scope = titleScope(tierLevel);
  // Un titre national se gagne deux fois par an dans neuf scènes : s'il expose
  // beaucoup, tout le milieu du tableau devient célèbre (mesuré : 19 % des
  // joueurs au-dessus de 300 k). Seul le niveau mondial est transformateur.
  const raw =
    scope === SCOPE.GLOBAL ? 130000 : scope === SCOPE.NATIONAL ? 5000 * (tierLevel - 2) : 600;
  const charisma = 0.35 + (person.attrs?.entertainment ?? 40) / 100;
  return gainFollowers(world, person, raw * charisma, `titre de portée ${scope}`);
}

/**
 * Passe annuelle de visibilité, appliquée à **tout le monde** — joueur inclus.
 *
 * Un seul chemin de code : c'est la condition pour que le plafond, la
 * décroissance et la mémoire soient les mêmes pour un PNJ que pour le joueur.
 */
export function runVisibilityCycle(world) {
  let settled = 0;
  let grown = 0;
  let lost = 0;
  for (const person of Object.values(world.persons)) {
    settleReputation(world, person);
    settled++;
    // Le staff n'a plus d'audience compétitive à gagner, mais celle qu'il a
    // gardée de sa carrière de joueur continue de vivre.
    if (person.status !== STATUS.STAFF) grown += npcAudienceGrowth(world, person);
    lost += settleAudience(world, person);
  }
  return { persons: settled, grown, lost };
}

/** Réputation d'organisation : elle s'oublie aussi (§B). */
export function decayOrgReputation(world, org) {
  const tierFloor = clamp(org.tier * 14, 0, 70);
  // Mémoire longue des grands titres, exactement comme pour les personnes.
  const glory = clamp(6 * (org.titles ?? 0), 0, 90);
  const target = Math.max(tierFloor, glory);
  if (org.reputation <= target) return 0;
  const before = org.reputation;
  org.reputation = Math.round((before - (before - target) * FORGET_RATE) * 10) / 10;
  return before - org.reputation;
}

/** Photographie réputation/audience, pour l'audit (§Y). */
export function visibilitySnapshot(world) {
  const pros = [];
  const audience = [];
  const all = [];
  for (const p of Object.values(world.persons)) {
    if (p.status === STATUS.STAFF) continue;
    all.push(p.followers ?? 0);
    if (p.status === STATUS.PRO || p.status === STATUS.SEMIPRO) {
      pros.push(p.reputation.pros);
      audience.push(p.followers ?? 0);
    }
  }
  return { pros, audience, all };
}
