/**
 * Conséquences différées (§58).
 *
 * Chaque handler est identifié par une chaîne de caractères — jamais par une
 * closure — pour rester sérialisable dans la sauvegarde. Tous revalident le
 * contexte avant de s'appliquer : six mois ont passé, l'équipe a pu
 * disparaître, le joueur a pu changer de jeu. Un effet qui n'a plus de sens
 * ne s'applique pas (§61).
 */

import { registerDeferred } from './engine.js';
import { STATUS } from '../person.js';
import { collectOffers } from '../transfers.js';
import { relationValue, REL_TAGS } from '../relations.js';
import { clamp } from '../rng.js';

export function registerDeferredHandlers() {
  /** Le travail invisible finit par se voir — beaucoup plus tard. */
  registerDeferred('discipline_noticed', (ctx, payload) => {
    if (ctx.person.attrs.discipline < 60) return null;
    ctx.fx.rep('pros', 5).attr('professionalism', 2);
    if (payload?.source === 'structure') ctx.fx.attr('timeManagement', 2);
    ctx.fx.log('Votre sérieux commence à se savoir.', { kind: 'info' });
    return 'Un entraîneur que vous n’avez jamais rencontré parle de vous à quelqu’un. Vous ne le saurez jamais.';
  });

  registerDeferred('scout_report', (ctx) => {
    if (ctx.person.status === STATUS.PRO) return null;
    ctx.fx.observed(4).rep('pros', 3);
    return null; // Effet silencieux : le joueur ne doit pas voir le lien.
  });

  registerDeferred('rejection_lesson', (ctx) => {
    if (ctx.person.attrs.resilience < 40) return null;
    ctx.fx.attr('resilience', 2.5).attr('learning', 1.5);
    return 'Vous repensez à cet essai raté. Vous savez maintenant ce qui vous manquait.';
  });

  registerDeferred('leadership_noticed', (ctx) => {
    if (!ctx.team) return null;
    ctx.fx.rep('pros', 6).attr('leadership', 1.5);
    return 'Ce que vous avez fait dans ce vestiaire a circulé. Les managers en parlent entre eux.';
  });

  registerDeferred('isolation_cost', (ctx) => {
    if (!ctx.team) return null;
    ctx.fx.synergy(-6).attr('teamwork', -1.5);
    for (const mateId of ctx.team.roster) {
      if (mateId !== ctx.person.id) {
        ctx.fx.relation(mateId, -6, 'Vous vous êtes isolé du groupe.');
      }
    }
    return 'Vous jouez bien. Vous ne faites plus partie du groupe pour autant.';
  });

  registerDeferred('coaching_payoff', (ctx, payload) => {
    const coach = payload?.coachId ? ctx.world.persons[payload.coachId] : null;
    // Le bénéfice n'existe que si le coach est encore là.
    if (!coach || !ctx.team || ctx.team.coachId !== coach.id) return null;
    ctx.fx.group('gameSense', 1.4).form(3);
    return `Le travail avec ${coach.nick} finit par payer. Vous voyez des choses que vous ne voyiez pas.`;
  });

  registerDeferred('bench_rot', (ctx) => {
    if (!ctx.team || !ctx.team.subs.includes(ctx.person.id)) return null;
    ctx.fx.group('mechanical', -1.2).morale(-8).rep('pros', -4);
    ctx.fx.log('Long passage sur le banc.', { kind: 'setback' });
    return 'Des mois sans jouer. On ne perd pas son niveau d’un coup — on le perd sans s’en rendre compte.';
  });

  registerDeferred('rivalry_seed', (ctx, payload) => {
    const other = payload?.personId ? ctx.world.persons[payload.personId] : null;
    if (!other || other.status === STATUS.RETIRED) return null;
    if (relationValue(ctx.world, ctx.person.id, other.id) > -10) return null;
    ctx.fx.relation(other.id, -12, `La tension avec ${other.nick} s'est installée.`, {
      tag: REL_TAGS.RIVAL,
      important: true,
    });
    if (!ctx.career.rivalId) ctx.career.rivalId = other.id;
    return `Vous croisez ${other.nick} en compétition. Rien n'a été réglé.`;
  });

  registerDeferred('sponsor_interest', (ctx) => {
    if (ctx.person.followers < 8000) return null;
    ctx.fx.rep('media', 4);
    return null;
  });

  registerDeferred('sponsor_payment', (ctx, payload) => {
    const amount = payload?.amount ?? 0;
    if (amount <= 0) return null;
    // Une image dégradée fait sauter un partenariat en cours (§21).
    if (ctx.person.reputation.toxicity > 45) {
      ctx.fx.log('Partenariat rompu par la marque.', { kind: 'money', important: true });
      return 'La marque met fin au partenariat. Ils ne développent pas.';
    }
    ctx.fx.money(amount);
    return `Versement du sponsor : ${amount.toLocaleString('fr-FR')} €.`;
  });

  registerDeferred('toxicity_consequence', (ctx) => {
    if (ctx.person.reputation.toxicity < 20) return null;
    const bigOrgInterest = ctx.person.reputation.toxicity * 0.5;
    ctx.fx.rep('pros', -bigOrgInterest * 0.3);
    ctx.fx.log('Votre réputation vous ferme des portes.', { kind: 'setback', important: true });
    return 'Une organisation qui vous suivait arrête le contact. Personne ne vous dira pourquoi, mais vous savez.';
  });

  registerDeferred('side_job_income', (ctx, payload) => {
    if (!ctx.career.flags.side_job) return null;
    ctx.fx.money(payload?.amount ?? 1200);
    // Le travail alimentaire mange le temps d'entraînement, durablement.
    ctx.fx.fatigue(6);
    if (ctx.person.contract?.salary > 20000) {
      ctx.career.flags.side_job = false;
      return 'Vous démissionnez. Le jeu vous paie assez maintenant.';
    }
    ctx.fx.later('side_job_income', 12, payload);
    return null;
  });

  registerDeferred('family_expectations', (ctx) => {
    if (!ctx.career.flags.family_debt) return null;
    ctx.fx.stress(10);
    return 'On vous demande où vous en êtes. Ce n’est pas une question innocente.';
  });

  registerDeferred('family_deadline', (ctx) => {
    if (!ctx.career.flags.deadline_pressure) return null;
    ctx.career.flags.deadline_pressure = false;
    const madeIt = ctx.person.status === STATUS.PRO || ctx.person.status === STATUS.SEMIPRO;
    if (madeIt) {
      ctx.fx.stress(-18).morale(16);
      ctx.fx.log('Pari familial tenu.', { kind: 'life', important: true });
      ctx.fx.memory('milestone', 'Le pari tenu', 'Vous vous étiez donné un an. Vous y êtes arrivé.');
      return 'Vous aviez donné une date. Vous l’avez tenue. Personne ne remettra le sujet sur la table.';
    }
    ctx.fx.stress(20).morale(-18).flag('considering_exit', true);
    ctx.fx.log('Échéance familiale dépassée sans résultat.', { kind: 'setback', important: true });
    return 'L’année est passée. Vous n’avez pas tenu votre part. Le repas de famille est silencieux.';
  });

  registerDeferred('content_growth', (ctx) => {
    if (!ctx.career.flags.content_career && !ctx.career.flags.hybrid_career) return null;
    const growth = Math.round(Math.sqrt(ctx.person.followers) * ctx.rng.float(28, 90)) + 1500;
    ctx.fx.followers(growth).money(Math.round(growth * 0.35));
    ctx.fx.later('content_growth', 26, null);
    return `Votre audience progresse : +${growth.toLocaleString('fr-FR')} abonnés.`;
  });

  registerDeferred('resilience_dividend', (ctx) => {
    ctx.fx.attr('resilience', 3).attr('composure', 2).stress(-10);
    return 'Vous avez traversé quelque chose. Ça vous rend plus difficile à casser.';
  });

  registerDeferred('duo_crossroads', (ctx, payload) => {
    const mate = payload?.mateId ? ctx.world.persons[payload.mateId] : null;
    if (!mate || mate.status === STATUS.RETIRED) return null;
    // Le duo ne peut se séparer que s'il existe encore.
    if (mate.teamId !== ctx.person.teamId) {
      const offers = collectOffers(ctx.world, ctx.person, ctx.rng, { maxOffers: 1, minScore: 40 });
      if (offers.length > 0 && mate.teamId) {
        ctx.career.offers = offers;
        return `${mate.nick} vous fait passer un message : son équipe cherche quelqu'un.`;
      }
      return null;
    }
    ctx.fx.relation(mate.id, 10, `Votre duo avec ${mate.nick} tient dans la durée.`);
    ctx.fx.synergy(4);
    return null;
  });

  registerDeferred('protege_rise', (ctx, payload) => {
    const kid = payload?.personId ? ctx.world.persons[payload.personId] : null;
    if (!kid || kid.status === STATUS.RETIRED) return null;
    const doingWell = kid.reputation.pros > 40 || kid.stats.titles > 0;
    if (!doingWell) return null;
    ctx.fx.rep('pros', 6);
    ctx.fx.relation(kid.id, 12, `${kid.nick}, que vous avez formé, perce au plus haut niveau.`, {
      important: true,
    });
    ctx.fx.memory('mentor', 'Le protégé', `${kid.nick} est devenu ce que vous saviez qu'il deviendrait.`);
    return `${kid.nick} explose au plus haut niveau. Il cite votre nom en interview.`;
  });

  registerDeferred('overwork_toll', (ctx) => {
    if (ctx.person.fatigue < 60) return null;
    ctx.fx.group('mechanical', -1.5).fatigue(10).stress(8);
    ctx.fx.log('Le surmenage laisse des traces.', { kind: 'setback' });
    return 'Vos poignets, vos yeux, votre sommeil. Le corps envoie la facture.';
  });

  /** Récompense différée d'un pari sur un jeune profil : le plafond se révèle. */
  registerDeferred('potential_revealed', (ctx) => {
    ctx.fx.observed(10);
    return null;
  });
}

/** Utilitaire partagé : borne une valeur de réputation. */
export function clampRep(v) {
  return clamp(v, 0, 100);
}
