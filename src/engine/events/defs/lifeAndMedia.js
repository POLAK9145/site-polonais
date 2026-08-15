/**
 * Vie personnelle, argent, médias (§19, §20, §21, §22, §46).
 *
 * Cette couche existe pour créer des arbitrages, pas pour ajouter des
 * jauges : streamer rapporte de l'argent et coûte du niveau, la surcharge
 * détruit un pic de forme, une polémique ferme des portes chez les
 * structures les plus exposées.
 */

import { clamp } from '../../rng.js';
import { SPONSOR_TYPES } from '../../../data/orgs.js';
import { mods } from '../../person.js';
import { FAMILY_BY_ID } from '../../../data/origins.js';

function family(ctx) {
  return FAMILY_BY_ID[ctx.career.familyId] ?? null;
}

export const lifeAndMediaEvents = [
  // --- CHAÎNE SURCHARGE ------------------------------------------------
  {
    id: 'burnout_warning',
    tags: ['mental', 'santé'],
    cooldown: 40,
    condition: (ctx) => ctx.person.fatigue > 68 || ctx.person.stress > 70,
    weight: (ctx) => clamp((ctx.person.fatigue - 60) * 0.16 + (ctx.person.stress - 60) * 0.16, 0, 10),
    title: 'Les signaux',
    text: (ctx) =>
      `Vous n'arrivez plus à récupérer. Les sessions se ressemblent, vos mains sont lourdes, et vous relisez trois fois la même information sans la retenir. Vous connaissez ces signes. Vous les avez vus chez d'autres.`,
    choices: [
      {
        id: 'stop',
        label: 'Lever le pied maintenant',
        hint: 'Vous perdrez du terrain à court terme',
        apply: (ctx) => {
          ctx.fx.fatigue(-30).stress(-22).morale(6).form(-2);
          ctx.fx.log('Coup de frein volontaire.', { kind: 'decision' });
          ctx.fx.attr('timeManagement', 1.5);
          return 'Vous coupez tout pendant une semaine. Le monde continue sans vous, et ce n’est pas si grave.';
        },
      },
      {
        id: 'push',
        label: 'Tenir encore un peu',
        risky: true,
        apply: (ctx) => {
          ctx.fx.fatigue(6).stress(6).group('mechanical', 0.5);
          ctx.fx.chain('burnout_crash', { delay: ctx.rng.int(3, 10), expires: 26 });
          return 'Vous serrez les dents. Il reste trois semaines avant les playoffs.';
        },
      },
      {
        id: 'help',
        label: 'En parler au staff',
        available: (ctx) => !!ctx.team?.coachId,
        apply: (ctx) => {
          const coach = ctx.world.persons[ctx.team.coachId];
          ctx.fx.relation(coach.id, 8, 'Vous avez parlé de votre état au staff.');
          ctx.fx.fatigue(-18).stress(-16).morale(3);
          return 'Le staff allège votre semaine sans en faire un sujet. Personne d’autre n’est au courant.';
        },
      },
    ],
  },

  {
    id: 'burnout_crash',
    chainOnly: true,
    tags: ['mental', 'santé'],
    condition: (ctx) => ctx.person.fatigue > 55,
    title: 'La rupture',
    text: () =>
      `Ça lâche d'un coup. Plus d'envie, plus de concentration, plus rien. Vous restez devant l'écran sans lancer une partie.`,
    auto: (ctx) => {
      ctx.fx.fatigue(-10).stress(20).morale(-25).form(-9);
      ctx.fx.log('Épisode de surmenage.', { kind: 'setback', important: true });
      ctx.fx.memory('crisis', 'La rupture', 'Le corps et la tête ont fini par dire non.');
      ctx.fx.synergy(-6);
      ctx.fx.chain('burnout_recovery', { delay: ctx.rng.int(4, 10), expires: 40 });
      ctx.fx.flag('had_burnout', true);
      return 'Vous prévenez l’équipe que vous ne pourrez pas jouer cette semaine.';
    },
  },

  {
    id: 'burnout_recovery',
    chainOnly: true,
    tags: ['mental', 'santé'],
    title: 'Ce qu’on fait après',
    text: () => `Il faut décider de la suite. Personne ne peut le faire à votre place.`,
    choices: [
      {
        id: 'rebuild',
        label: 'Reconstruire lentement',
        apply: (ctx) => {
          ctx.fx.fatigue(-40).stress(-30).morale(18).attr('resilience', 3).attr('timeManagement', 2);
          ctx.fx.later('resilience_dividend', 40, null);
          ctx.fx.memory('comeback', 'Reconstruction', 'Vous avez recommencé par le début, sans brûler d’étape.');
          return 'Vous reprenez à petites doses. C’est frustrant. C’est ce qu’il fallait.';
        },
      },
      {
        id: 'return_fast',
        label: 'Revenir tout de suite',
        risky: true,
        apply: (ctx) => {
          ctx.fx.fatigue(-12).stress(-5).morale(5).form(-4);
          if (ctx.rng.chance(0.45)) {
            ctx.fx.chain('burnout_crash', { delay: ctx.rng.int(10, 30), expires: 30 });
          }
          return 'Vous revenez la semaine suivante. Vous dites que ça va.';
        },
      },
      {
        id: 'step_back',
        label: 'Prendre du recul sur la compétition',
        apply: (ctx) => {
          ctx.fx.fatigue(-45).stress(-35).morale(12).flag('considering_exit', true);
          ctx.fx.log('Prise de recul sur la compétition.', { kind: 'decision', important: true });
          return 'Vous ne dites pas que vous arrêtez. Vous dites que vous verrez.';
        },
      },
    ],
  },

  // --- MÉDIAS ET AUDIENCE ---------------------------------------------
  {
    id: 'viral_moment',
    tags: ['média', 'communauté'],
    cooldown: 50,
    condition: (ctx) => ctx.person.stats.matches > 5 && ctx.person.reputation.public > 4,
    weight: (ctx) => {
      const m = mods(ctx.person);
      return clamp(1 + ctx.person.reputation.public * 0.05 + ctx.person.attrs.entertainment * 0.02, 0, 6) * m.mediaGrowth;
    },
    title: 'Un clip qui tourne',
    text: () =>
      `Une action de vous circule. Le clip est court, sorti de son contexte, et il tourne bien au-delà de votre communauté habituelle.`,
    choices: [
      {
        id: 'ride',
        label: 'Surfer dessus',
        apply: (ctx) => {
          const gain = Math.round(2500 + Math.sqrt(ctx.person.followers) * ctx.rng.float(40, 140));
          ctx.fx.followers(gain).rep('public', 6).rep('media', 5).morale(4);
          ctx.fx.log(`Clip viral : +${gain.toLocaleString('fr-FR')} abonnés.`, { kind: 'media' });
          ctx.fx.later('sponsor_interest', ctx.rng.int(8, 20), null);
          return `Vous enchaînez avec deux vidéos. ${gain.toLocaleString('fr-FR')} personnes vous suivent en plus.`;
        },
      },
      {
        id: 'ignore',
        label: 'Ne rien en faire',
        apply: (ctx) => {
          ctx.fx.followers(Math.round(400 + Math.sqrt(ctx.person.followers) * 12)).rep('pros', 2);
          return 'Vous ne commentez pas. Le clip vit sa vie, puis meurt.';
        },
      },
    ],
  },

  {
    id: 'sponsor_offer',
    tags: ['argent', 'média'],
    cooldown: 60,
    condition: (ctx) => ctx.person.followers > 12000 || ctx.person.reputation.public > 30,
    weight: (ctx) => clamp(ctx.person.followers / 40000 + ctx.person.reputation.public * 0.04, 0, 7),
    title: 'Une marque vous contacte',
    text: (ctx) => {
      const sponsor = ctx.rng.pick(SPONSOR_TYPES.filter((s) => s.id !== 'local'));
      ctx.pickedSponsor = sponsor;
      const value = Math.round((3000 + ctx.person.followers * 0.35) * sponsor.value);
      ctx.pickedSponsorValue = value;
      return `Une marque du secteur « ${sponsor.label} » vous propose un partenariat : ${value.toLocaleString('fr-FR')} € sur l'année, contre des publications régulières et une présence à leurs événements.`;
    },
    choices: [
      {
        id: 'accept',
        label: 'Accepter',
        apply: (ctx) => {
          const value = ctx.pickedSponsorValue ?? 4000;
          ctx.fx.money(Math.round(value * 0.4)).rep('media', 5);
          ctx.fx.later('sponsor_payment', 26, { amount: Math.round(value * 0.3) });
          ctx.fx.later('sponsor_payment', 52, { amount: Math.round(value * 0.3) });
          ctx.fx.log('Contrat de sponsoring personnel signé.', { kind: 'money', important: true });
          ctx.fx.stress(4);
          return 'Vous signez. Le premier versement tombe la semaine suivante.';
        },
      },
      {
        id: 'refuse',
        label: 'Refuser',
        apply: (ctx) => {
          ctx.fx.rep('community', 4).rep('pros', 1);
          return 'Vous déclinez. Votre communauté remarque que vous ne vendez pas n’importe quoi.';
        },
      },
    ],
  },

  {
    id: 'controversy',
    tags: ['média', 'mental'],
    cooldown: 70,
    condition: (ctx) => ctx.person.reputation.public > 15 && (mods(ctx.person).conflictRisk > 1.2 || ctx.person.stress > 60),
    weight: (ctx) => clamp((mods(ctx.person).conflictRisk - 1) * 5 + (ctx.person.stress - 55) * 0.08, 0, 6),
    title: 'Une phrase de trop',
    text: () =>
      `Un message posté après une défaite est repris partout. Sorti du contexte, il est indéfendable. Dans le contexte, il n'est pas beaucoup mieux.`,
    choices: [
      {
        id: 'apologize',
        label: 'S’excuser publiquement',
        apply: (ctx) => {
          ctx.fx.rep('toxicity', 4).rep('public', -4).rep('pros', -1).stress(8);
          ctx.fx.log('Polémique publique, excuses présentées.', { kind: 'media', important: true });
          ctx.fx.news(`${ctx.person.nick} présente ses excuses`, 'La séquence laissera des traces.', { tone: 'negative' });
          return 'Vous publiez des excuses. La moitié des gens y croit.';
        },
      },
      {
        id: 'double_down',
        label: 'Assumer',
        risky: true,
        apply: (ctx) => {
          ctx.fx.rep('toxicity', 12).rep('public', 5).rep('pros', -8).rep('community', -6);
          ctx.fx.followers(Math.round(Math.sqrt(ctx.person.followers) * 45));
          ctx.fx.log('Polémique assumée publiquement.', { kind: 'media', important: true });
          ctx.fx.memory('controversy', 'Le clash', 'Vous n’avez rien retiré. Ça vous a suivi longtemps.');
          ctx.fx.later('toxicity_consequence', ctx.rng.int(20, 50), null);
          return 'Vous n’enlevez rien. Votre communauté grossit. Les managers, eux, prennent note.';
        },
      },
      {
        id: 'silence',
        label: 'Ne rien dire',
        apply: (ctx) => {
          ctx.fx.rep('toxicity', 2).rep('media', -3).stress(5);
          return 'Vous laissez passer. Ça meurt en huit jours.';
        },
      },
    ],
  },

  // --- ARGENT ET VIE ---------------------------------------------------
  {
    id: 'money_trouble',
    tags: ['argent', 'famille'],
    cooldown: 30,
    condition: (ctx) => ctx.career.money < 400 && !ctx.person.contract?.salary,
    weight: (ctx) => clamp(8 - ctx.career.money / 100, 0, 10),
    title: 'Le compte est vide',
    text: (ctx) => {
      const f = family(ctx);
      return f && f.stability < 0.4
        ? `Il ne reste presque rien. Personne ne peut vous avancer quoi que ce soit. Il faut trouver une solution ce mois-ci.`
        : `Vos réserves sont épuisées. Vous pouvez encore tenir, mais plus longtemps sur ce rythme.`;
    },
    choices: [
      {
        id: 'job',
        label: 'Prendre un travail à côté',
        hint: 'Moins de temps de jeu, mais une stabilité',
        apply: (ctx) => {
          ctx.fx.money(1800).flag('side_job', true);
          ctx.fx.fatigue(12).stress(-6);
          ctx.fx.log('Emploi alimentaire pris en parallèle.', { kind: 'money', important: true });
          ctx.fx.later('side_job_income', 12, { amount: 1600 });
          return 'Vous trouvez quelque chose. Vos semaines passent de 40 à 20 heures de jeu.';
        },
      },
      {
        id: 'stream',
        label: 'Streamer intensivement',
        apply: (ctx) => {
          const income = Math.round(200 + ctx.person.followers * 0.08 + ctx.person.attrs.entertainment * 6);
          ctx.fx.money(income).followers(Math.round(500 + Math.sqrt(ctx.person.followers) * 20));
          ctx.fx.fatigue(10).group('media', 1.2);
          ctx.fx.log(`Revenus de stream : ${income.toLocaleString('fr-FR')} €.`, { kind: 'money' });
          return `Vous streamez tous les soirs. ${income.toLocaleString('fr-FR')} € rentrent. Ce n’est pas beaucoup, mais ça rentre.`;
        },
      },
      {
        id: 'borrow',
        label: 'Demander de l’aide',
        available: (ctx) => (family(ctx)?.support ?? 0) > 0.35,
        apply: (ctx) => {
          const f = family(ctx);
          ctx.fx.money(Math.round(1200 * (f?.stability ?? 0.5) + 400));
          ctx.fx.stress(6).flag('family_debt', true);
          ctx.fx.later('family_expectations', ctx.rng.int(30, 60), null);
          return 'On vous dépanne. Sans commentaire. Le commentaire viendra plus tard.';
        },
      },
    ],
  },

  {
    id: 'family_ultimatum',
    tags: ['famille', 'mental'],
    once: true,
    condition: (ctx) => {
      const f = family(ctx);
      if (!f || f.pressure < 0.6) return false;
      // L'ultimatum n'a de sens que si la carrière n'a pas encore décollé.
      return ctx.person.status !== 'pro' && ctx.career.counters.weeks > 60 && ctx.age < 24;
    },
    weight: (ctx) => (family(ctx)?.pressure ?? 0) * 8,
    title: 'La conversation',
    text: () =>
      `« On te laisse faire depuis longtemps. Combien de temps encore ? » La question est posée calmement. C'est ce qui la rend difficile.`,
    choices: [
      {
        id: 'commit',
        label: 'Vous engager à réussir dans l’année',
        risky: true,
        apply: (ctx) => {
          ctx.fx.stress(14).morale(-4).attr('discipline', 2).attr('workCapacity', 2);
          ctx.fx.flag('deadline_pressure', ctx.world.week + 52);
          ctx.fx.log('Ultimatum familial accepté : un an pour réussir.', { kind: 'life', important: true });
          ctx.fx.later('family_deadline', 52, null);
          return 'Vous donnez une date. Vous venez de transformer votre passion en compte à rebours.';
        },
      },
      {
        id: 'defy',
        label: 'Tenir tête',
        apply: (ctx) => {
          ctx.fx.stress(10).morale(-8).attr('selfConfidence', 2).flag('family_rift', true);
          ctx.fx.log('Rupture partielle avec la famille.', { kind: 'life', important: true });
          return 'Vous dites que vous continuerez de toute façon. La discussion s’arrête là. Pour longtemps.';
        },
      },
      {
        id: 'compromise',
        label: 'Reprendre des études en parallèle',
        apply: (ctx) => {
          ctx.fx.stress(8).attr('learning', 2).attr('timeManagement', 2).flag('studying', true);
          ctx.fx.log('Reprise d’études en parallèle.', { kind: 'life' });
          return 'Vous vous inscrivez quelque part. Vous aurez moins de temps, et une porte de sortie.';
        },
      },
    ],
  },

  {
    id: 'streaming_pivot',
    tags: ['média', 'argent'],
    cooldown: 80,
    condition: (ctx) => ctx.person.followers > 40000 && ctx.person.reputation.public > 25,
    weight: (ctx) => clamp(ctx.person.followers / 90000, 0, 6) * (ctx.person.status === 'inactive' ? 2.5 : 1),
    title: 'L’autre carrière possible',
    text: (ctx) =>
      `Avec ${ctx.person.followers.toLocaleString('fr-FR')} abonnés, une plateforme vous propose un contrat de créateur. Le revenu est supérieur à ce que la compétition vous rapporte. Il faudrait y consacrer l'essentiel de votre temps.`,
    choices: [
      {
        id: 'pivot',
        label: 'Basculer vers la création de contenu',
        apply: (ctx) => {
          const income = Math.round(ctx.person.followers * 0.6);
          ctx.fx.money(income).flag('content_career', true);
          ctx.career.routine = ['streaming', 'content', 'social', 'rest'];
          ctx.fx.log('Bascule vers une carrière de créateur.', { kind: 'career', important: true });
          ctx.fx.memory('pivot', 'Le virage', 'Vous avez choisi l’audience plutôt que la scène.');
          ctx.fx.later('content_growth', 26, null);
          return `Vous signez. ${income.toLocaleString('fr-FR')} € d'avance, et un rythme de publication à tenir.`;
        },
      },
      {
        id: 'hybrid',
        label: 'Faire les deux',
        hint: 'Deux fois plus de fatigue',
        apply: (ctx) => {
          ctx.fx.money(Math.round(ctx.person.followers * 0.2)).fatigue(14).stress(8).flag('hybrid_career', true);
          return 'Vous acceptez une version allégée du contrat. Vos journées n’ont plus de trous.';
        },
      },
      {
        id: 'refuse',
        label: 'Rester sur la compétition',
        apply: (ctx) => {
          ctx.fx.rep('pros', 4).morale(2).flag('pure_competitor', true);
          return 'Vous refusez. Vous n’êtes pas venu pour ça.';
        },
      },
    ],
  },
];
