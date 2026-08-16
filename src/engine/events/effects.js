/**
 * API d'effets utilisée par les définitions d'événements (§57).
 *
 * Un choix ne modifie jamais l'état « à la main » : il passe par cette
 * couche, qui borne les valeurs, journalise ce qui doit l'être et permet de
 * programmer des conséquences différées (§58).
 */

import { clamp } from '../rng.js';
import { attrsOfGroup } from '../attributes.js';
import { adjustRelation } from '../relations.js';
import { logTimeline, addMemory, addAchievement, setFlag } from '../career.js';
import { scheduleEffect, queueChain } from './engine.js';
import { gainFollowers } from '../reputation.js';

export function createEffects(ctx) {
  const { world, career, person } = ctx;
  const d = ctx.difficulty;

  const fx = {
    /** Modifie un attribut précis. */
    attr(id, delta) {
      if (person.attrs[id] === undefined) return fx;
      const scaled = delta > 0 ? delta * d.progression : delta * d.consequence;
      person.attrs[id] = clamp(person.attrs[id] + scaled, 1, 99);
      return fx;
    },

    /** Modifie toute une famille d'attributs. */
    group(groupId, delta) {
      for (const id of attrsOfGroup(groupId)) fx.attr(id, delta);
      return fx;
    },

    morale(delta) {
      person.morale = clamp(person.morale + delta, 0, 100);
      return fx;
    },
    stress(delta) {
      person.stress = clamp(person.stress + delta * (delta > 0 ? d.consequence : 1), 0, 100);
      return fx;
    },
    fatigue(delta) {
      person.fatigue = clamp(person.fatigue + delta, 0, 100);
      return fx;
    },
    form(delta) {
      person.form = clamp(person.form + delta, -20, 20);
      return fx;
    },

    /** kind : pros | public | community | media | toxicity */
    rep(kind, delta) {
      if (person.reputation[kind] === undefined) return fx;
      person.reputation[kind] = clamp(person.reputation[kind] + delta, 0, 100);
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
      if (delta > 0) gainFollowers(world, person, delta, 'événement');
      else person.followers = Math.max(0, Math.round(person.followers + delta));
      return fx;
    },

    money(amount) {
      career.money += amount;
      if (career.money < 0) {
        career.monthlyDebt += -career.money;
        career.money = 0;
      }
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
