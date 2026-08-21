/**
 * Ce que le joueur sait et ressent de sa situation (étape 7C).
 *
 * Toute la contextualité des décisions passe par ici, et par ici seulement.
 * La règle qui justifie ce module : **une décision ne peut être modifiée que
 * par une information que le joueur pourrait raisonnablement connaître ou
 * ressentir.** Il sait qu'il est à bout, qu'il est sur le banc, qu'il n'a plus
 * d'argent, que personne ne le connaît. Il ne sait pas son plafond caché, ni
 * ce que tel choix rapportera dans cinq ans.
 *
 * Centraliser ce vocabulaire répond à deux problèmes mesurés en 7A et 7C :
 *
 *  1. Les définitions d'événements lisaient l'état à la main, chacune à sa
 *     façon. Sur 78 choix, 3 seulement étaient conditionnels et aucun libellé
 *     ne dépendait du contexte — parce qu'écrire la condition juste coûtait
 *     plus cher que de ne pas l'écrire.
 *
 *  2. Rien n'empêchait une condition de lire `person.hidden`. Un point de
 *     passage unique rend cette frontière vérifiable : ce fichier n'accède
 *     jamais à `hidden`, et un test l'impose au reste du catalogue.
 *
 * Les seuils sont volontairement grossiers. Il ne s'agit pas de graduer
 * finement mais de nommer des situations que le joueur reconnaîtrait : « je
 * suis à bout », « je suis remplaçant », « je n'ai plus rien ».
 */

import { LOAD_STATES, isHigh } from '../load.js';
import { relationsOf, REL_TAGS, relationValue } from '../relations.js';

/** Places possibles dans un effectif, du point de vue du joueur. */
export const PLACE = {
  STARTER: 'titulaire',
  SUB: 'remplaçant',
  NONE: 'sans équipe',
};

/** Ce que le joueur perçoit de sa propre notoriété. */
export const VISIBILITE = {
  INCONNU: 'inconnu',
  LOCAL: 'connu localement',
  CONNU: 'connu',
  VEDETTE: 'vedette',
};

/** Situation financière ressentie. */
export const ARGENT = {
  SEC: 'à sec',
  JUSTE: 'juste',
  CORRECT: 'correct',
  AISE: 'à l’aise',
};

/** Où l'on se situe dans sa propre carrière. */
export const SAISON_DE_VIE = {
  ESPOIR: 'espoir',
  PLEINE_FORCE: 'pleine force',
  VETERAN: 'vétéran',
};

/** Forme ressentie, telle qu'un joueur la décrirait. */
export const FORME = {
  CONFIANCE: 'en confiance',
  NEUTRE: 'neutre',
  DIFFICULTE: 'en difficulté',
};

/**
 * Résume la situation du joueur en faits qu'il connaît.
 *
 * Appelée par les conditions, les libellés et les conséquences. Ne modifie
 * rien et ne consomme aucun aléatoire : elle doit pouvoir être appelée
 * plusieurs fois dans la même semaine sans changer la partie.
 */
export function situationOf(ctx) {
  const { person, team, org, career } = ctx;
  const load = person.load;
  const etat = load?.state ?? LOAD_STATES.FRESH;

  const place = !ctx.hasTeam
    ? PLACE.NONE
    : team.roster?.includes(person.id)
      ? PLACE.STARTER
      : PLACE.SUB;

  const pub = person.reputation?.public ?? 0;
  const followers = person.followers ?? 0;
  const visibilite =
    pub >= 55 || followers >= 400000
      ? VISIBILITE.VEDETTE
      : pub >= 28 || followers >= 40000
        ? VISIBILITE.CONNU
        : pub >= 10 || followers >= 2000
          ? VISIBILITE.LOCAL
          : VISIBILITE.INCONNU;

  const money = career.money ?? 0;
  const dette = career.monthlyDebt ?? 0;
  const argent =
    dette > 0 || money < 400
      ? ARGENT.SEC
      : money < 3000
        ? ARGENT.JUSTE
        : money < 30000
          ? ARGENT.CORRECT
          : ARGENT.AISE;

  const age = ctx.age ?? 20;
  const saison = age <= 20 ? SAISON_DE_VIE.ESPOIR : age >= 27 ? SAISON_DE_VIE.VETERAN : SAISON_DE_VIE.PLEINE_FORCE;

  const forme =
    person.form >= 5 ? FORME.CONFIANCE : person.form <= -5 ? FORME.DIFFICULTE : FORME.NEUTRE;

  return {
    // --- Charge (étape 7B) : ce que le corps dit. ---
    etatDeCharge: etat,
    /** Le joueur se sent réellement au bout : surmené, épuisé ou en rupture. */
    aBout: isHigh(etat),
    /** Il a déjà connu au moins une rupture, et il s'en souvient. */
    dejaRompu: (load?.episodes ?? 0) > 0,
    /** Il enchaîne les semaines lourdes depuis longtemps. */
    enchaine: (load?.heavyStreak ?? 0) >= 20,
    /** Il sort d'une rupture et n'est pas encore revenu. */
    enConvalescence: etat === LOAD_STATES.RECOVERING || etat === LOAD_STATES.BURNOUT,

    // --- Place et structure ---
    place,
    estTitulaire: place === PLACE.STARTER,
    surLeBanc: place === PLACE.SUB,
    sansEquipe: place === PLACE.NONE,
    niveauStructure: org?.tier ?? 0,
    /** Une structure exigeante : le tier 4 et au-delà ne pardonne pas. */
    structureExigeante: (org?.tier ?? 0) >= 4,
    aUnCoach: !!team?.coachId,

    // --- Notoriété, argent, âge, forme ---
    visibilite,
    argent,
    fauche: argent === ARGENT.SEC,
    saisonDeVie: saison,
    forme,
    enDifficulte: forme === FORME.DIFFICULTE,

    // --- Palmarès, tel qu'il le vit ---
    aDejaGagne: (person.stats?.titles ?? 0) > 0,
    saisonsPro: person.stats?.seasonsPro ?? 0,

    // --- Ce qu'il sait de ses relations (étape 7D) ---
    //
    // Un joueur sait avec qui il s'entend, qui il ne supporte plus, s'il est
    // seul dans son vestiaire. Il ne connaît pas les valeurs numériques, et ces
    // champs n'en exposent aucune : seulement des faits qu'il pourrait énoncer.
    ...socialOf(ctx),

    // --- Ce dont il se souvient (étape 7D) ---
    ...pastOf(ctx),
  };
}

/**
 * Ce que le joueur perçoit de sa vie sociale.
 *
 * Séparé pour rester lisible, et parce que c'est la partie la plus facile à
 * détourner : il serait tentant d'exposer ici « la meilleure relation
 * disponible » ou « le coéquipier le plus utile ». On s'en tient à ce qui se
 * ressent — j'ai un proche ici, je ne supporte plus quelqu'un, je suis isolé.
 */
function socialOf(ctx) {
  const { world, person, team } = ctx;
  const rels = relationsOf(world, person.id, { minAbs: 0 });
  const proches = rels.filter((r) => r.value >= 45);
  const hostiles = rels.filter((r) => r.value <= -45);

  // Dans l'équipe actuelle, précisément : c'est ce qui pèse au quotidien.
  const equipe = team ? [...(team.roster ?? []), ...(team.subs ?? [])].filter((id) => id !== person.id) : [];
  const alliesIci = equipe.filter((id) => relationValue(world, person.id, id) >= 35);
  const tensionsIci = equipe.filter((id) => relationValue(world, person.id, id) <= -35);

  return {
    /** Des gens à qui l'on tient, où qu'ils soient aujourd'hui. */
    aDesProches: proches.length > 0,
    nbProches: proches.length,
    /** Des gens avec qui c'est cassé. */
    aDesEnnemis: hostiles.length > 0,
    nbEnnemis: hostiles.length,
    /** Dans le vestiaire d'aujourd'hui. */
    alliesDansEquipe: alliesIci.length,
    tensionsDansEquipe: tensionsIci.length,
    /** Personne sur qui compter là où l'on joue. */
    isoleDansEquipe: equipe.length > 0 && alliesIci.length === 0,
    /** Un vestiaire franchement contre soi. */
    vestiaireHostile: tensionsIci.length >= 2,
    /** A-t-on un mentor, a-t-on formé quelqu'un ? */
    aUnMentor: rels.some((r) => r.tags.includes(REL_TAGS.MENTOR)),
    aFormeQuelquun: rels.some((r) => r.tags.includes(REL_TAGS.PROTEGE)),
    /** Une rivalité déclarée, quelle qu'en soit la couleur. */
    aUneRivalite: rels.some((r) => r.tags.includes(REL_TAGS.RIVAL)),
  };
}

/**
 * Ce dont le joueur se souvient de sa propre carrière.
 *
 * Au diagnostic, 26 drapeaux sur 28 n'étaient jamais relus, et `timeline` comme
 * `memories` n'étaient consultées que par le bilan de fin. Le monde enregistrait
 * qu'on avait raté un essai, demandé son transfert ou porté le brassard, et n'y
 * faisait plus jamais référence. Ces champs rendent ce passé consultable par les
 * décisions, sous une forme que le joueur reconnaîtrait.
 */
function pastOf(ctx) {
  const { career } = ctx;
  const f = career.flags ?? {};
  const marquants = (career.timeline ?? []).filter((t) => t.important);
  return {
    /** Des échecs dont on se souvient. */
    aRateUnEssai: !!f.failed_tryout,
    aEteRefuse: !!f.failed_tryout || !!f.negotiation_failed,
    /** Des choix de trajectoire déjà faits. */
    aDemandeUnTransfert: !!f.requested_transfer,
    aEteSurLeBanc: !!f.benched,
    aEteCapitaine: !!f.captain,
    /** Ce qu'on a construit ailleurs que dans le jeu. */
    aUneVieAcote: !!f.content_career || !!f.hybrid_career || !!f.side_job,
    aChoisiLaRigueur: !!f.structured,
    aChoisiLeGrind: !!f.grinder,
    aUnReseau: !!f.networked,
    /** Ce que le corps a déjà connu. */
    aConnuLaRupture: !!f.had_burnout,
    /** L'idée d'arrêter a déjà traversé. */
    aPenseArreter: !!f.thinking_retirement || !!f.considering_exit,
    /** Combien de moments on garderait d'une carrière. */
    momentsMarquants: marquants.length,
    aUnPasse: marquants.length >= 3,
  };
}

/**
 * Petit utilitaire de rédaction : rend l'un ou l'autre texte selon une
 * condition. Sert à écrire des libellés contextuels sans noyer les
 * définitions dans des ternaires imbriqués.
 */
export function selon(condition, siVrai, siFaux) {
  return condition ? siVrai : siFaux;
}
