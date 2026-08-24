/**
 * API d'effets utilisée par les définitions d'événements (§57).
 *
 * Un choix ne modifie jamais l'état « à la main » : il passe par cette
 * couche, qui borne les valeurs, journalise ce qui doit l'être et permet de
 * programmer des conséquences différées (§58).
 */

import { clamp } from '../rng.js';
import { attrsOfGroup, attrMeta, groupMeta } from '../attributes.js';
import { adjustRelation } from '../relations.js';
import { logTimeline, addMemory, addAchievement, setFlag } from '../career.js';
import { scheduleEffect, queueChain } from './engine.js';
import { gainFollowers, justifiedReputation } from '../reputation.js';

/**
 * Ce qu'un choix a réellement coûté ou rapporté (étape 9B).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * Le joueur tranchait un dilemme, lisait une phrase de résultat, et n'apprenait
 * jamais ce que sa décision avait changé. Le moteur calculait pourtant tout au
 * centième près — moral, réputation, attributs, argent — et n'en montrait
 * rien. Un jeu dont les décisions comptent doit dire ce qu'elles ont fait,
 * sinon le joueur choisit à l'aveugle et ne peut rien apprendre.
 *
 * CE QUI EST ENREGISTRÉ, ET COMMENT
 * ---------------------------------
 * Le registre note ce qui a été APPLIQUÉ, après mise à l'échelle par la
 * difficulté : c'est ce que le joueur a réellement subi, pas ce que l'auteur
 * de l'événement avait écrit. Une modification de famille compte pour une
 * seule ligne — `group('mechanical', 2)` touche six attributs, et six pastilles
 * pour un seul effet seraient du bruit, pas de l'information.
 */
/**
 * De combien un moment médiatique peut porter au-dessus de son rang.
 *
 * Calibré par mesure sur 40 carrières, pas choisi : à 0, le plafond est dur et
 * la carrière en souffre réellement (titres par carrière 0,65 → 0,38, matchs
 * 280 → 245). À 10, l'écart d'audience avec les PNJ comparables tombe de ×25 à
 * ×4 sans aucun coût mesurable — titres identiques, pic de niveau identique.
 */
const MARGE_NOTORIETE = 10;

/** Les canaux qui alimentent le plafond d'audience, et eux seuls. */
const CANAUX_NOTORIETE = new Set(['public', 'community']);

const ETIQUETTES_REP = {
  pros: 'Réputation (milieu)',
  public: 'Notoriété',
  community: 'Communauté',
  media: 'Médias',
  toxicity: 'Toxicité',
};

export function createEffects(ctx) {
  const { world, career, person } = ctx;
  const d = ctx.difficulty;

  // Registre des conséquences chiffrées du choix en cours.
  const journal = [];
  // Quand une famille entière est modifiée, on n'enregistre pas ses six
  // attributs un par un.
  let dansUnGroupe = false;
  const noter = (cle, label, delta) => {
    if (!delta) return;
    const arrondi = Math.round(delta * 10) / 10;
    if (arrondi === 0) return;
    const existant = journal.find((e) => e.cle === cle);
    if (existant) existant.delta = Math.round((existant.delta + arrondi) * 10) / 10;
    else journal.push({ cle, label, delta: arrondi });
  };

  const fx = {
    /** Le registre du choix en cours, remis à zéro entre deux décisions. */
    journal,
    resetJournal() {
      journal.length = 0;
      return fx;
    },

    /** Modifie un attribut précis. */
    attr(id, delta) {
      if (person.attrs[id] === undefined) return fx;
      const scaled = delta > 0 ? delta * d.progression : delta * d.consequence;
      const avant = person.attrs[id];
      person.attrs[id] = clamp(person.attrs[id] + scaled, 1, 99);
      // On note l'écart RÉEL : buter sur la borne 1 ou 99 ne rapporte rien, et
      // l'annoncer quand même serait un mensonge.
      if (!dansUnGroupe) noter(`attr:${id}`, attrMeta(id)?.label ?? id, person.attrs[id] - avant);
      return fx;
    },

    /** Modifie toute une famille d'attributs. */
    group(groupId, delta) {
      const avant = attrsOfGroup(groupId).map((id) => person.attrs[id] ?? 0);
      dansUnGroupe = true;
      for (const id of attrsOfGroup(groupId)) fx.attr(id, delta);
      dansUnGroupe = false;
      const apres = attrsOfGroup(groupId).map((id) => person.attrs[id] ?? 0);
      const moyen = apres.reduce((a, v, i) => a + (v - avant[i]), 0) / Math.max(1, apres.length);
      noter(`group:${groupId}`, groupMeta(groupId)?.label ?? groupId, moyen);
      return fx;
    },

    morale(delta) {
      const avant = person.morale;
      person.morale = clamp(person.morale + delta, 0, 100);
      noter('morale', 'Moral', person.morale - avant);
      return fx;
    },
    stress(delta) {
      const avant = person.stress;
      person.stress = clamp(person.stress + delta * (delta > 0 ? d.consequence : 1), 0, 100);
      noter('stress', 'Stress', person.stress - avant);
      return fx;
    },
    fatigue(delta) {
      const avant = person.fatigue;
      person.fatigue = clamp(person.fatigue + delta, 0, 100);
      noter('fatigue', 'Fatigue', person.fatigue - avant);
      return fx;
    },
    form(delta) {
      const avant = person.form;
      person.form = clamp(person.form + delta, -20, 20);
      noter('form', 'Forme', person.form - avant);
      return fx;
    },

    /** kind : pros | public | community | media | toxicity */
    rep(kind, delta) {
      if (person.reputation[kind] === undefined) return fx;
      const avant = person.reputation[kind];
      let apres = clamp(avant + delta, 0, 100);
      // La notoriété se gagne, elle ne se raconte pas (étape 9D).
      //
      // Mesuré sur 40 carrières : le joueur finissait avec 25 fois l'audience
      // des PNJ de son propre monde ayant la même carrière — même pic de
      // niveau, même volume de matchs, même palmarès — et l'écart était le plus
      // grand chez les joueurs SANS aucun titre. 63 % de son audience venait
      // des événements ; chez les PNJ, 97 % venait de la compétition. La
      // célébrité du joueur n'avait aucun rapport avec sa carrière.
      //
      // La cause n'était pas l'audience donnée par les événements — la couper
      // rendait le problème dix fois pire, parce que `gainFollowers` consomme
      // la marge sous plafond avec un rendement décroissant et que les autres
      // chemins la remplissaient ensuite à plein rendement. C'était la
      // RÉPUTATION : chaque moment médiatique poussait `public` sans borne,
      // le plafond d'audience en dépend, et le seul rappel — `settleReputation`
      // — est annuel.
      //
      // On applique donc aux événements la règle que le modèle énonce déjà
      // pour tout le monde : au-delà de ce que le niveau justifie, seuls les
      // titres font monter. La marge laisse vivre le moment viral — un pic
      // au-dessus de son rang, que l'oubli annuel efface ensuite — sans
      // permettre à une carrière sans palmarès de devenir mondialement connue.
      //
      // Le plafond ne porte QUE sur les canaux de notoriété. Le regard du
      // milieu (`pros`) n'entre pas dans le plafond d'audience et n'a pas été
      // mesuré ici : l'y inclure serait étendre la correction au-delà de ce
      // qu'on a vérifié.
      if (delta > 0 && CANAUX_NOTORIETE.has(kind)) {
        const justifie = justifiedReputation(world, person, kind);
        if (justifie !== null) {
          const plafond = justifie + MARGE_NOTORIETE;
          // Déjà au-dessus : un événement de plus n'ajoute rien. Sinon on
          // monte, sans franchir le plafond.
          apres = avant >= plafond ? avant : Math.min(apres, plafond);
        }
      }
      person.reputation[kind] = apres;
      noter(`rep:${kind}`, ETIQUETTES_REP[kind] ?? kind, person.reputation[kind] - avant);
      return fx;
    },

    /**
     * Le joueur a été vu jouer. Plus il est observé, plus les estimations
     * de potentiel qui circulent à son sujet deviennent fiables (§7).
     */
    observed(n = 1) {
      person.observations += n;
      return fx;
    },

    /**
     * Audience gagnée ou perdue par un événement.
     *
     * Les gains passent par `gainFollowers` : c'était le trou du modèle
     * précédent, où cette fonction écrivait directement dans le champ et
     * ignorait donc le plafond. Un événement pouvait à lui seul porter un
     * inconnu à un million de suiveurs. Les pertes, elles, s'appliquent
     * directement — rien ne protège d'un scandale.
     */
    followers(delta) {
      const avant = person.followers;
      if (delta > 0) gainFollowers(world, person, delta, 'événement');
      else person.followers = Math.max(0, Math.round(person.followers + delta));
      // `gainFollowers` applique un plafond et un rendement décroissant : ce
      // que le joueur gagne n'est presque jamais ce que l'événement annonce.
      // C'est l'écart réel qu'il faut montrer.
      noter('followers', 'Abonnés', person.followers - avant);
      return fx;
    },

    money(amount) {
      const avant = career.money;
      career.money += amount;
      if (career.money < 0) {
        career.monthlyDebt += -career.money;
        career.money = 0;
      }
      // L'argent est la conséquence la plus concrète d'un choix : on note ce
      // qui a réellement bougé sur le compte, dette comprise.
      noter('money', 'Argent', career.money - avant);
      return fx;
    },

    /** Modifie une relation ET l'inscrit dans son historique. */
    relation(otherId, delta, text, opts = {}) {
      if (!otherId) return fx;
      adjustRelation(world, person.id, otherId, delta, {
        week: world.week,
        text,
        tag: opts.tag ?? null,
        important: opts.important ?? false,
      });
      // On nomme la personne : « Relation +8 » ne dit rien, « Relation avec
      // Kessyn +8 » dit ce qui vient de se jouer.
      const autre = world.persons[otherId];
      if (autre) noter(`rel:${otherId}`, `Relation avec ${autre.nick}`, delta);
      return fx;
    },

    /** Synergie de l'équipe actuelle. */
    synergy(delta) {
      if (ctx.team) ctx.team.synergy = clamp(ctx.team.synergy + delta, 1, 99);
      return fx;
    },

    familiarity(gameId, delta) {
      const cur = person.familiarity[gameId] ?? 0;
      person.familiarity[gameId] = clamp(cur + delta, 0, 1);
      return fx;
    },

    flag(name, value = true) {
      setFlag(career, name, value);
      return fx;
    },

    /** Fait daté ajouté à la timeline. */
    log(text, opts = {}) {
      logTimeline(career, world, text, opts);
      return fx;
    },

    /** Moment marquant conservé dans le Legacy. */
    memory(kind, title, text, data = null) {
      addMemory(career, world, { kind, title, text, data });
      return fx;
    },

    achievement(id) {
      addAchievement(career, world, id);
      return fx;
    },

    /** Dépêche fictive (§47), toujours adossée à un fait simulé. */
    news(headline, body = '', opts = {}) {
      world.news.push({
        week: world.week,
        headline,
        body,
        gameId: opts.gameId ?? person.gameId ?? null,
        tone: opts.tone ?? 'neutral',
        aboutPersonId: opts.aboutPersonId ?? person.id,
      });
      if (world.news.length > 150) world.news.splice(0, world.news.length - 150);
      return fx;
    },

    /** Conséquence différée : le joueur n'apprend le lien que plus tard. */
    later(type, delay, payload = null) {
      scheduleEffect(ctx, type, { delay, payload });
      return fx;
    },

    /** Suite de la chaîne narrative. */
    chain(eventId, opts = {}) {
      queueChain(ctx, eventId, opts);
      return fx;
    },
  };

  return fx;
}
