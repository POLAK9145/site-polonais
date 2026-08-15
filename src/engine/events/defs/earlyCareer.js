/**
 * Chaînes de début de carrière (§11, §30 « Ascension »).
 *
 * Rien n'arrive « parce que ». Un recruteur ne remarque un joueur que s'il
 * a réellement produit des performances observables, dans une scène qui a
 * réellement des équipes en recherche.
 */

import { collectOffers, signPlayer, evaluateInterest } from '../../transfers.js';
import { STATUS, weightedCeiling } from '../../person.js';
import { teamNeeds } from '../../team.js';

/** Équipes de la scène du joueur qui cherchent réellement quelqu'un. */
function teamsLookingFor(ctx, { maxTier = 5, minTier = 1 } = {}) {
  const { world, person } = ctx;
  const out = [];
  for (const team of Object.values(world.teams)) {
    if (!team.active || team.gameId !== person.gameId) continue;
    if (team.id === person.teamId) continue;
    const org = world.orgs[team.orgId];
    if (!org?.alive || org.tier > maxTier || org.tier < minTier) continue;
    if (org.regionId !== person.regionId) continue;
    const needs = teamNeeds(world, team);
    if (needs.openSlots > 0 || needs.urgency > 0.4) out.push({ team, org, needs });
  }
  return out;
}

export const earlyCareerEvents = [
  {
    id: 'first_ladder_grind',
    tags: ['jeu', 'progression'],
    once: true,
    cooldown: 999,
    condition: (ctx) => !ctx.hasTeam && ctx.career.counters.weeks < 20,
    weight: () => 8,
    title: 'Les premières heures',
    text: (ctx) =>
      `Vous enchaînez les parties sur ${ctx.game.name}. Personne ne vous regarde. Personne ne vous attend. C'est exactement le moment où tout se décide, et vous n'en savez rien encore.`,
    choices: [
      {
        id: 'grind',
        label: 'Jouer sans compter les heures',
        hint: 'Progression rapide, équilibre fragile',
        apply: (ctx) => {
          ctx.fx.group('mechanical', 1.2).fatigue(10).stress(5).flag('grinder', true);
          ctx.fx.later('discipline_noticed', 40, { source: 'grind' });
          return 'Vous ne comptez plus. Certaines nuits se terminent quand le jour se lève.';
        },
      },
      {
        id: 'structured',
        label: 'Vous organiser sérieusement',
        hint: 'Progression plus lente, fondations solides',
        apply: (ctx) => {
          ctx.fx.group('professional', 1.6).group('gameSense', 0.6).flag('structured', true);
          ctx.fx.later('discipline_noticed', 60, { source: 'structure' });
          return 'Vous notez vos sessions, vos erreurs, vos objectifs. Personne ne le remarque. Pas encore.';
        },
      },
      {
        id: 'social',
        label: 'Jouer avec la communauté',
        hint: 'Réseau et relations, moins de niveau brut',
        apply: (ctx) => {
          ctx.fx.group('social', 1.4).rep('community', 4).morale(4).flag('networked', true);
          return 'Vous vous faites un nom sur quelques serveurs. Des gens commencent à vous reconnaître.';
        },
      },
    ],
  },

  {
    id: 'local_tournament_invite',
    tags: ['compétition', 'jeu'],
    cooldown: 40,
    condition: (ctx) => !ctx.hasTeam && ctx.rating > 38,
    weight: (ctx) => 6 + (ctx.person.reputation.community > 15 ? 3 : 0),
    title: 'Un tournoi local',
    text: () =>
      `Un tournoi ouvert se tient ce week-end. Petite salle, petit lot, quelques dizaines de participants. Rien d'important — sauf que tout le monde a commencé quelque part.`,
    choices: [
      {
        id: 'go',
        label: 'Y aller',
        apply: (ctx) => {
          const { rng, fx, person } = ctx;
          // Le résultat dépend du niveau réel, pas d'un tirage arbitraire.
          const quality = ctx.rating + person.form + rng.gauss(0, 9);
          if (quality > 72) {
            fx.rep('community', 9).rep('pros', 4).morale(8).money(450).observed(3);
            fx.log('Victoire dans un tournoi local.', { kind: 'result', important: true });
            fx.memory('early', 'Premier trophée', 'Un tournoi local, une salle à moitié vide, et une première victoire.');
            fx.later('scout_report', 10, { reason: 'tournoi local' });
            return 'Vous gagnez. La salle est petite, mais quelqu’un a filmé la finale.';
          }
          if (quality > 58) {
            fx.rep('community', 4).morale(3).money(120).observed(2);
            fx.log('Bon parcours dans un tournoi local.', { kind: 'result' });
            return 'Vous sortez en demi-finale. Deux personnes vous demandent votre pseudo.';
          }
          fx.morale(-5).observed(1);
          fx.log('Élimination précoce dans un tournoi local.', { kind: 'result' });
          return 'Éliminé au deuxième tour. Le trajet du retour est long.';
        },
      },
      {
        id: 'skip',
        label: 'Rester chez vous',
        hint: 'Rien à perdre, rien à gagner',
        apply: (ctx) => {
          ctx.fx.morale(-1);
          return 'Vous regardez les résultats tomber le soir même. Vous connaissez la moitié des noms.';
        },
      },
    ],
  },

  // --- CHAÎNE ASCENSION -----------------------------------------------
  {
    id: 'scout_notices',
    tags: ['transfert', 'compétition'],
    cooldown: 60,
    condition: (ctx) => {
      if (ctx.person.status === STATUS.PRO) return false;
      if (teamsLookingFor(ctx, { maxTier: 3 }).length === 0) return false;
      // Il faut avoir été VU : des matchs joués et un niveau qui dépasse
      // la moyenne des équipes qui recrutent.
      return ctx.person.observations >= 5 && ctx.rating > 50;
    },
    weight: (ctx) => {
      const potential = weightedCeiling(ctx.person, ctx.game);
      const base = (ctx.rating - 52) * 0.5 + (potential - ctx.rating) * 0.2;
      return Math.max(0, base) * ctx.difficulty.opportunity;
    },
    title: 'Quelqu’un vous regarde jouer',
    text: (ctx) => {
      const candidates = teamsLookingFor(ctx, { maxTier: 3 });
      const target = ctx.rng.pick(candidates);
      ctx.chainTarget = target;
      if (!target) return `Un message privé, puis plus rien. La piste s'éteint aussitôt.`;
      return `Un message privé. Le manager de ${target.org.name} dit avoir vu vos dernières parties. Il ne promet rien. Il pose des questions.`;
    },
    choices: [
      {
        id: 'engage',
        label: 'Répondre sérieusement',
        apply: (ctx) => {
          const candidates = teamsLookingFor(ctx, { maxTier: 3 });
          const target = ctx.rng.pick(candidates);
          if (!target) return 'La conversation s’éteint d’elle-même.';
          ctx.fx.flag('scouted_by', target.org.id);
          ctx.fx.log(`Contact avec ${target.org.name}.`, { kind: 'transfer' });
          ctx.fx.chain('tryout_invite', { delay: ctx.rng.int(2, 5), expires: 20, data: { teamId: target.team.id } });
          return 'Vous répondez à tout. Il note. Il dit qu’il revient vers vous.';
        },
      },
      {
        id: 'cool',
        label: 'Rester distant',
        hint: 'Vous ne voulez pas paraître désespéré',
        apply: (ctx) => {
          const candidates = teamsLookingFor(ctx, { maxTier: 3 });
          const target = ctx.rng.pick(candidates);
          ctx.fx.rep('pros', 1);
          if (target && ctx.rng.chance(0.4)) {
            ctx.fx.chain('tryout_invite', { delay: ctx.rng.int(4, 9), expires: 16, data: { teamId: target.team.id } });
            return 'Vous répondez en trois mots. Il insiste quand même.';
          }
          return 'Vous répondez en trois mots. Il ne relance pas.';
        },
      },
    ],
  },

  {
    id: 'tryout_invite',
    chainOnly: true,
    tags: ['transfert', 'équipe'],
    cooldown: 0,
    condition: (ctx) => {
      const teamId = ctx.chainData?.teamId;
      const team = teamId ? ctx.world.teams[teamId] : null;
      // La chaîne s'interrompt si l'équipe n'existe plus ou n'a plus besoin
      // de personne : mieux vaut pas d'histoire qu'une histoire fausse.
      if (!team || !team.active) return false;
      const org = ctx.world.orgs[team.orgId];
      if (!org?.alive) return false;
      const needs = teamNeeds(ctx.world, team);
      return needs.openSlots > 0 || needs.urgency > 0.3;
    },
    title: 'Un essai',
    text: (ctx) => {
      const team = ctx.world.teams[ctx.chainData.teamId];
      const org = ctx.world.orgs[team.orgId];
      return `${org.name} vous propose une semaine d'essai. Vous jouerez avec l'équipe, vous serez évalué, et ils décideront. Ils sont clairs : ils regardent aussi deux autres joueurs.`;
    },
    choices: [
      {
        id: 'accept',
        label: 'Accepter l’essai',
        apply: (ctx) => {
          const team = ctx.world.teams[ctx.chainData.teamId];
          const interest = evaluateInterest(ctx.world, team, ctx.person);
          const perf = ctx.rating + ctx.person.form + ctx.rng.gauss(0, 7);
          const needs = teamNeeds(ctx.world, team);
          const passed = perf > needs.targetRating - 4 && interest.score > 38;
          ctx.fx.fatigue(6).stress(8).observed(4);
          if (passed) {
            ctx.fx.chain('tryout_success', { delay: 1, expires: 8, data: { teamId: team.id } });
            return 'La semaine se passe bien. Très bien, même. Ils vous disent qu’ils vous rappellent lundi.';
          }
          ctx.fx.morale(-10).flag('failed_tryout', true);
          ctx.fx.log(`Essai manqué chez ${ctx.world.orgs[team.orgId].name}.`, { kind: 'setback' });
          ctx.fx.later('rejection_lesson', 26, { teamId: team.id });
          return 'Vous n’étiez pas mauvais. Vous n’étiez juste pas le meilleur des trois. Ils prennent l’autre.';
        },
      },
      {
        id: 'decline',
        label: 'Refuser',
        hint: 'Vous ne vous sentez pas prêt',
        apply: (ctx) => {
          ctx.fx.morale(-3).flag('declined_tryout', true);
          ctx.fx.log('Essai refusé.', { kind: 'decision' });
          return 'Vous déclinez poliment. Vous y repenserez longtemps.';
        },
      },
    ],
  },

  {
    id: 'tryout_success',
    chainOnly: true,
    tags: ['transfert', 'équipe'],
    cooldown: 0,
    condition: (ctx) => {
      const team = ctx.world.teams[ctx.chainData?.teamId];
      return !!team && team.active && !!ctx.world.orgs[team.orgId]?.alive;
    },
    title: 'Une proposition',
    text: (ctx) => {
      const team = ctx.world.teams[ctx.chainData.teamId];
      const org = ctx.world.orgs[team.orgId];
      const interest = evaluateInterest(ctx.world, team, ctx.person);
      const offer = ctx.buildOffer(team, interest);
      ctx.chainOffer = offer;
      ctx.career.offers = [offer];
      return `${org.name} vous propose de rejoindre l'effectif. ${offer.salary > 0 ? `Salaire annuel : ${offer.salary.toLocaleString('fr-FR')} €.` : 'Pas de salaire — juste une place.'} Rôle : ${offer.role === 'starter' ? 'titulaire' : 'remplaçant'}.`;
    },
    choices: [
      {
        id: 'sign',
        label: 'Signer',
        apply: (ctx) => {
          const offer = ctx.career.offers[0];
          if (!offer) return 'L’offre a disparu avant que vous ne répondiez.';
          const res = signPlayer(ctx.world, ctx.person, offer, { week: ctx.world.week });
          ctx.career.offers = [];
          if (!res.ok) return `La signature échoue : ${res.reason}.`;
          ctx.fx.morale(14).achievement('first_contract');
          ctx.fx.log(`Signature chez ${res.org.name}.`, { kind: 'contract', important: true });
          ctx.fx.memory('milestone', 'Premier contrat', `${res.org.name} vous fait signer. C'est votre première équipe sérieuse.`);
          ctx.fx.news(`${ctx.person.nick} rejoint ${res.org.name}`, 'Un renfort issu de la scène amateur.');
          return `Vous signez chez ${res.org.name}.`;
        },
      },
      {
        id: 'wait',
        label: 'Demander à réfléchir',
        hint: 'Une meilleure offre existe peut-être. Ou pas.',
        risky: true,
        apply: (ctx) => {
          const offer = ctx.career.offers[0];
          ctx.career.offers = [];
          // Faire attendre a un coût réel : l'équipe a d'autres candidats.
          if (ctx.rng.chance(0.45)) {
            ctx.fx.morale(-8);
            ctx.fx.log('Offre perdue après hésitation.', { kind: 'setback' });
            return 'Ils prennent quelqu’un d’autre. Le message est sec.';
          }
          ctx.fx.chain('tryout_success', { delay: 2, expires: 6, data: { teamId: offer?.teamId } });
          return 'Ils acceptent d’attendre. Deux semaines, pas plus.';
        },
      },
    ],
  },

  {
    id: 'amateur_team_forms',
    tags: ['équipe', 'social'],
    cooldown: 70,
    // Porte d'entrée du §11 : elle doit rester réellement accessible, sinon
    // un joueur sans équipe peut rester bloqué des années sans rien pouvoir
    // faire. Le poids augmente avec le temps passé sans structure.
    condition: (ctx) =>
      !ctx.hasTeam &&
      ctx.rating > 38 &&
      teamsLookingFor(ctx, { maxTier: 2 }).length > 0,
    weight: (ctx) =>
      5 +
      ctx.person.attrs.communication * 0.05 +
      ctx.person.reputation.community * 0.1 +
      Math.min(14, (ctx.career.counters.weeksWithoutTeam ?? 0) * 0.25),
    title: 'Un projet se monte',
    text: (ctx) => {
      const t = teamsLookingFor(ctx, { maxTier: 2 })[0];
      if (!t) return `Un projet d'équipe se monte, puis se défait avant d'exister.`;
      return `Quelques joueurs de votre niveau montent une équipe sous le nom de ${t.org.name}. Pas de salaire, pas de structure, juste l'envie de jouer les tournois ensemble.`;
    },
    choices: [
      {
        id: 'join',
        label: 'Rejoindre le projet',
        apply: (ctx) => {
          const candidates = teamsLookingFor(ctx, { maxTier: 2 });
          const target = candidates[0];
          if (!target) return 'Le projet se dissout avant même de commencer.';
          const interest = evaluateInterest(ctx.world, target.team, ctx.person);
          const offer = ctx.buildOffer(target.team, interest);
          offer.salary = 0;
          offer.role = 'starter';
          const res = signPlayer(ctx.world, ctx.person, offer, { week: ctx.world.week });
          if (!res.ok) return `Ça ne se fait pas : ${res.reason}.`;
          ctx.fx.morale(10).rep('community', 4);
          ctx.fx.log(`Rejoint l'équipe amateur ${res.org.name}.`, { kind: 'team', important: true });
          ctx.fx.memory('early', 'Première équipe', `Cinq joueurs, aucun contrat, et le sentiment que ça peut marcher.`);
          return `Vous rejoignez ${res.org.name}. Personne ne vous paie. Vous vous en fichez.`;
        },
      },
      {
        id: 'solo',
        label: 'Continuer seul',
        hint: 'Vous préférez progresser avant de vous engager',
        apply: (ctx) => {
          ctx.fx.group('mechanical', 0.5);
          return 'Vous déclinez. Vous voulez d’abord être meilleur.';
        },
      },
    ],
  },

  {
    id: 'first_pro_offer_window',
    tags: ['transfert'],
    cooldown: 30,
    condition: (ctx) =>
      ctx.isTransferWindow &&
      ctx.person.status !== STATUS.RETIRED &&
      (!ctx.person.contract || ctx.person.contract.endWeek - ctx.world.week < 10),
    weight: (ctx) => 6 * ctx.difficulty.opportunity,
    title: 'Le marché s’ouvre',
    text: () =>
      `La fenêtre de transferts est ouverte. Les structures bougent, les rosters se recomposent. C'est le moment où une carrière se joue en trois messages.`,
    choices: [
      {
        id: 'listen',
        label: 'Écouter le marché',
        apply: (ctx) => {
          const offers = collectOffers(ctx.world, ctx.person, ctx.rng, { maxOffers: 3, minScore: 40 });
          if (offers.length === 0) {
            ctx.fx.morale(-4);
            return 'Vous faites savoir que vous écoutez. Le silence est la réponse.';
          }
          ctx.career.offers = offers;
          ctx.pendingOffers = true;
          ctx.fx.log(`${offers.length} offre(s) reçue(s).`, { kind: 'transfer' });
          return `${offers.length} structure(s) reviennent vers vous.`;
        },
      },
      {
        id: 'ignore',
        label: 'Rester concentré sur le jeu',
        apply: (ctx) => {
          ctx.fx.group('gameSense', 0.4).rep('pros', 1);
          return 'Vous ne répondez à personne. Votre agent, si vous en aviez un, aurait crié.';
        },
      },
    ],
  },
];
