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
import { isHigh, relieveLoad, crashRisk, markBurnout, LOAD_STATES } from '../../load.js';
import { situationOf, selon, VISIBILITE, ARGENT, PLACE, SAISON_DE_VIE } from '../situation.js';

function family(ctx) {
  return FAMILY_BY_ID[ctx.career.familyId] ?? null;
}

export const lifeAndMediaEvents = [
  // --- CHAÎNE SURCHARGE ------------------------------------------------
  {
    id: 'burnout_warning',
    tags: ['mental', 'santé'],
    cooldown: 40,
    // La charge accumulée, pas la fatigue de la semaine (étape 7B) : le seuil
    // instantané se déclenchait pour un joueur qui vivait en permanence à 70 de
    // fatigue — mesuré, 68,6 % des semaines d'un grinder — sans que la durée y
    // change quoi que ce soit. Un avertissement doit dire « cela fait des
    // semaines que ça dure », ce que seul l'état de charge sait.
    condition: (ctx) => isHigh(ctx.person.load?.state) || ctx.person.stress > 72,
    weight: (ctx) => {
      const load = ctx.person.load;
      if (!load) return 0;
      // Plus la série de semaines chargées est longue, plus l'alerte est
      // pressante — c'est la mémoire de charge qui parle.
      return clamp(
        (load.value - 55) * 0.1 + load.heavyStreak * 0.06 + (ctx.person.stress - 60) * 0.08,
        0,
        10,
      );
    },
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
          // Ralentir agit sur la charge elle-même, pas seulement sur la fatigue
          // du moment : c'est ce qui permet de vraiment redescendre d'un état.
          relieveLoad(ctx.person, 34, { week: ctx.world.week, reason: 'coup de frein volontaire' });
          ctx.fx.log('Coup de frein volontaire.', { kind: 'decision' });
          ctx.fx.attr('timeManagement', 1.5);
          return 'Vous coupez tout pendant une semaine. Le monde continue sans vous, et ce n’est pas si grave.';
        },
      },
      {
        id: 'push',
        label: 'Tenir encore un peu',
        hint: 'Vous progressez, mais la charge continue de monter',
        risky: true,
        apply: (ctx) => {
          ctx.fx.fatigue(6).stress(6).group('mechanical', 0.5);
          // Pousser paie : un vrai gain immédiat, plus large que le demi-point
          // précédent — c'est la contrepartie du risque assumé (§3).
          ctx.fx.group('mental', 0.4);
          // Et le risque est réel : la rupture n'est plus certaine, elle est
          // probable en fonction de la charge accumulée. Un joueur solide qui
          // pousse une fois peut s'en sortir ; celui qui pousse depuis des mois
          // beaucoup moins.
          const risk = clamp(0.25 + crashRisk(ctx.person) * 6, 0.2, 0.85);
          if (ctx.rng.chance(risk)) {
            ctx.fx.chain('burnout_crash', { delay: ctx.rng.int(3, 10), expires: 26 });
            return 'Vous serrez les dents. Il reste trois semaines avant les playoffs.';
          }
          return 'Vous serrez les dents, et ça passe. Cette fois.';
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
          relieveLoad(ctx.person, 22, { week: ctx.world.week, reason: 'semaine allégée par le staff' });
          return 'Le staff allège votre semaine sans en faire un sujet. Personne d’autre n’est au courant.';
        },
      },
    ],
  },

  {
    id: 'burnout_crash',
    chainOnly: true,
    tags: ['mental', 'santé'],
    // La rupture suppose une charge réelle, pas une fatigue de passage.
    condition: (ctx) => (ctx.person.load?.value ?? 0) > 48 || ctx.person.fatigue > 55,
    title: 'La rupture',
    text: () =>
      `Ça lâche d'un coup. Plus d'envie, plus de concentration, plus rien. Vous restez devant l'écran sans lancer une partie.`,
    auto: (ctx) => {
      ctx.fx.fatigue(-10).stress(20).morale(-25).form(-9);
      // L'épisode devient un état, et il laisse une marque : chaque rupture
      // rend la suivante plus probable (`crashRisk`) et pèse sur la longévité
      // (`burnoutPressure`).
      markBurnout(ctx.person, ctx.world.week);
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
          // Accepter de ralentir vide réellement la charge : c'est ce qui rend
          // le retour au haut niveau possible (§critère de validation).
          relieveLoad(ctx.person, 62, { week: ctx.world.week, reason: 'reconstruction' });
          ctx.fx.later('resilience_dividend', 40, null);
          ctx.fx.memory('comeback', 'Reconstruction', 'Vous avez recommencé par le début, sans brûler d’étape.');
          return 'Vous reprenez à petites doses. C’est frustrant. C’est ce qu’il fallait.';
        },
      },
      {
        id: 'return_fast',
        label: 'Revenir tout de suite',
        hint: 'Vous ne perdez pas votre place, mais rien n’est réglé',
        risky: true,
        apply: (ctx) => {
          ctx.fx.fatigue(-12).stress(-5).morale(5).form(-4);
          // Revenir vite ne résout rien : la charge reste haute, donc l'état
          // reste haut, donc la rechute guette. C'est le sens du §2 — « un
          // joueur qui continue malgré les signaux ».
          relieveLoad(ctx.person, 12, { week: ctx.world.week, reason: 'retour précipité' });
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
          relieveLoad(ctx.person, 78, { week: ctx.world.week, reason: 'mise en retrait' });
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
    text: (ctx) => {
      const s = ctx.situation;
      const base = `Une action de vous circule. Le clip est court, sorti de son contexte, et il tourne bien au-delà de votre communauté habituelle.`;
      // Ce que le joueur remarque en premier dépend de son état. C'est le même
      // clip ; ce n'est pas la même semaine pour le recevoir.
      if (s.aBout) return `${base} Il faudrait enchaîner, capitaliser, publier. Vous n’en avez pas la force cette semaine.`;
      if (s.enDifficulte) return `${base} L’ironie ne vous échappe pas : vous n’avez jamais aussi mal joué.`;
      if (s.visibilite === VISIBILITE.INCONNU) return `${base} C’est la première fois que des inconnus parlent de vous.`;
      return base;
    },
    choices: [
      {
        id: 'ride',
        label: 'Surfer dessus',
        hint: (ctx) =>
          selon(ctx.situation.aBout, 'Beaucoup d’audience, et du travail que vous n’avez pas', 'Beaucoup d’audience, un peu de travail'),
        apply: (ctx) => {
          const s = ctx.situation;
          const gain = Math.round(2500 + Math.sqrt(ctx.person.followers) * ctx.rng.float(40, 140));
          // Capitaliser demande de produire. Un joueur à bout le paie ; il vient
          // de le lire dans le texte, ce n'est pas une pénalité cachée.
          const rendu = s.aBout ? Math.round(gain * 0.7) : gain;
          ctx.fx.followers(rendu).rep('public', 6).rep('media', 5);
          ctx.fx.log(`Clip viral : +${rendu.toLocaleString('fr-FR')} abonnés.`, { kind: 'media' });
          ctx.fx.later('sponsor_interest', ctx.rng.int(8, 20), null);
          if (s.aBout) {
            ctx.fx.stress(7).fatigue(5).morale(1);
            return `Vous enchaînez avec deux vidéos, en serrant les dents. ${rendu.toLocaleString('fr-FR')} personnes vous suivent en plus, et vous êtes vidé.`;
          }
          ctx.fx.morale(4);
          return `Vous enchaînez avec deux vidéos. ${rendu.toLocaleString('fr-FR')} personnes vous suivent en plus.`;
        },
      },
      {
        id: 'frame',
        label: 'Reprendre la main sur le récit',
        hint: 'Expliquer l’action vous-même, en professionnel',
        // Il faut déjà avoir une voix pour que cadrer serve à quelque chose.
        available: (ctx) =>
          ctx.situation.visibilite !== VISIBILITE.INCONNU && !ctx.situation.enConvalescence,
        apply: (ctx) => {
          const s = ctx.situation;
          const gain = Math.round(900 + Math.sqrt(ctx.person.followers) * ctx.rng.float(14, 42));
          ctx.fx.followers(gain).rep('pros', 4).rep('media', 2);
          // Expliquer une action qu'on a ratée ne passe pas comme expliquer une
          // action réussie : le milieu regarde la forme du moment.
          if (s.enDifficulte) {
            ctx.fx.rep('community', -2).morale(-2);
            return 'Vous décomposez l’action posément. Le milieu apprécie la lucidité ; les commentaires vous rappellent votre saison.';
          }
          ctx.fx.rep('community', 3).morale(2);
          return 'Vous décomposez l’action posément. Ce n’est pas ce qui fait le plus de vues, mais les joueurs vous lisent.';
        },
      },
      {
        id: 'ignore',
        label: 'Ne rien en faire',
        hint: (ctx) => selon(ctx.situation.aBout, 'Une chose de moins à porter', 'Le clip vivra sa vie'),
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.followers(Math.round(400 + Math.sqrt(ctx.person.followers) * 12)).rep('pros', 2);
          if (s.aBout) {
            ctx.fx.stress(-4).morale(2);
            return 'Vous ne commentez pas. Le clip vit sa vie, puis meurt — et vous dormez.';
          }
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
      // Le montant suit déjà l'audience : une marque paie ce que vaut la
      // visibilité, et le joueur le lit dans la proposition.
      const value = Math.round((3000 + ctx.person.followers * 0.35) * sponsor.value);
      ctx.pickedSponsorValue = value;
      const s = ctx.situation;
      // Ce que le joueur perçoit de l'offre dépend de ce qu'il vit. Les mêmes
      // 8 000 € ne se lisent pas de la même façon selon qu'on est fauché ou non.
      const lecture = s.fauche
        ? ' Vous n’avez pas vraiment le luxe de réfléchir longtemps.'
        : s.visibilite === VISIBILITE.VEDETTE
          ? ' Le montant vous paraît bas, pour ce que vous représentez aujourd’hui.'
          : '';
      const charge = s.aBout
        ? ' « Présence à leurs événements » — vous pensez immédiatement aux week-ends que cela mangera.'
        : '';
      return `Une marque du secteur « ${sponsor.label} » vous propose un partenariat : ${value.toLocaleString('fr-FR')} € sur l'année, contre des publications régulières et une présence à leurs événements.${lecture}${charge}`;
    },
    choices: [
      {
        id: 'accept',
        label: (ctx) => selon(ctx.situation.fauche, 'Accepter — vous en avez besoin', 'Accepter'),
        hint: (ctx) =>
          selon(
            ctx.situation.aBout,
            'De l’argent, et des obligations en plus d’un calendrier déjà plein',
            'De l’argent, et des obligations',
          ),
        apply: (ctx) => {
          const value = ctx.pickedSponsorValue ?? 4000;
          const s = ctx.situation;
          ctx.fx.money(Math.round(value * 0.4)).rep('media', 5);
          ctx.fx.later('sponsor_payment', 26, { amount: Math.round(value * 0.3) });
          ctx.fx.later('sponsor_payment', 52, { amount: Math.round(value * 0.3) });
          ctx.fx.log('Contrat de sponsoring personnel signé.', { kind: 'money', important: true });
          // Signer coûte du temps et de l'attention. Sur un joueur déjà au bout,
          // cela pèse davantage — ce n'est pas un malus caché, c'est ce que le
          // texte vient de lui dire.
          ctx.fx.stress(s.aBout ? 9 : 4);
          if (s.aBout) ctx.fx.fatigue(4);
          // Et sortir de l'urgence financière soulage réellement.
          if (s.fauche) {
            ctx.fx.morale(6);
            return 'Vous signez. Le premier versement tombe la semaine suivante, et vous respirez.';
          }
          return 'Vous signez. Le premier versement tombe la semaine suivante.';
        },
      },
      {
        id: 'negotiate',
        label: 'Négocier le montant',
        hint: 'Votre nom a du poids — mais la marque peut se lasser',
        risky: true,
        // On ne négocie pas quand personne ne vous connaît : la marque
        // raccrocherait. Le joueur sait où il en est de sa notoriété.
        available: (ctx) =>
          ctx.situation.visibilite === VISIBILITE.CONNU || ctx.situation.visibilite === VISIBILITE.VEDETTE,
        apply: (ctx) => {
          const value = ctx.pickedSponsorValue ?? 4000;
          const s = ctx.situation;
          // Une vedette a le dessus, quelqu'un de simplement connu beaucoup moins.
          const poids = s.visibilite === VISIBILITE.VEDETTE ? 0.72 : 0.45;
          if (ctx.rng.chance(poids)) {
            const gagne = Math.round(value * 0.65);
            ctx.fx.money(gagne).rep('media', 6).rep('pros', 2);
            ctx.fx.later('sponsor_payment', 26, { amount: Math.round(value * 0.4) });
            ctx.fx.log('Sponsoring renégocié à la hausse.', { kind: 'money', important: true });
            ctx.fx.stress(s.aBout ? 7 : 3);
            return `Ils reviennent avec une meilleure offre. Votre nom valait plus que leur première proposition.`;
          }
          ctx.fx.rep('media', -3).morale(-5);
          if (s.fauche) {
            ctx.fx.morale(-4);
            return 'Ils ne rappellent pas. Vous regardez votre compte en banque et vous vous en voulez.';
          }
          return 'Ils ne rappellent pas. L’agence a trouvé quelqu’un de moins gourmand.';
        },
      },
      {
        id: 'refuse',
        label: 'Refuser',
        hint: (ctx) =>
          selon(
            ctx.situation.fauche,
            'Votre communauté approuvera. Votre loyer, moins',
            'Votre communauté remarquera que vous ne vendez pas n’importe quoi',
          ),
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.rep('community', 4).rep('pros', 1);
          // Refuser de l'argent quand on n'en a pas est un vrai renoncement.
          if (s.fauche) {
            ctx.fx.morale(-6);
            return 'Vous déclinez. Votre communauté remarque que vous ne vendez pas n’importe quoi. Vous, vous pensez au mois prochain.';
          }
          // Et refuser quand on est à bout, c'est protéger son calendrier.
          if (s.aBout) {
            ctx.fx.morale(3).stress(-3);
            return 'Vous déclinez. Un week-end de moins à tenir : c’est déjà quelque chose.';
          }
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
    text: (ctx) => {
      const s = ctx.situation;
      const base = `Un message posté après une défaite est repris partout. Sorti du contexte, il est indéfendable. Dans le contexte, il n'est pas beaucoup mieux.`;
      if (s.aBout) return `${base} Vous l’avez écrit à deux heures du matin, après une semaine que vous ne souhaitez à personne.`;
      if (s.structureExigeante) return `${base} Votre organisation ne laissera pas passer.`;
      return base;
    },
    choices: [
      {
        id: 'apologize',
        label: 'S’excuser publiquement',
        hint: 'Éteindre l’incendie, en y laissant quelque chose',
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.rep('toxicity', 4).rep('public', -4).rep('pros', -1).stress(8);
          ctx.fx.log('Polémique publique, excuses présentées.', { kind: 'media', important: true });
          ctx.fx.news(`${ctx.person.nick} présente ses excuses`, 'La séquence laissera des traces.', { tone: 'negative' });
          // Une structure exigeante attend précisément cela, et le crédite.
          if (s.structureExigeante && ctx.team?.coachId) {
            ctx.fx.relation(ctx.team.coachId, 4, 'Il a éteint la polémique proprement.');
            return 'Vous publiez des excuses. La moitié des gens y croit. Votre organisation, elle, respire.';
          }
          return 'Vous publiez des excuses. La moitié des gens y croit.';
        },
      },
      {
        id: 'explain',
        label: 'Expliquer dans quel état vous étiez',
        hint: 'Dire la fatigue, sans en faire une excuse',
        // On ne peut invoquer l'épuisement que si l'on est effectivement épuisé.
        // C'est la charge (7B) qui entre dans le récit public.
        available: (ctx) => ctx.situation.aBout || ctx.situation.dejaRompu,
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.rep('toxicity', 1).stress(-4);
          ctx.fx.log('Polémique expliquée par l’épuisement.', { kind: 'media', important: true });
          // Le public entend mieux quelqu'un qu'il connaît déjà, et surtout
          // quelqu'un dont la rupture est déjà publique.
          if (s.dejaRompu) {
            ctx.fx.rep('public', 3).rep('community', 6).morale(4);
            ctx.fx.news(`${ctx.person.nick} évoque son épuisement`, 'Le sujet dépasse la polémique initiale.', { tone: 'neutral' });
            return 'Vous racontez les derniers mois. Le sujet change de nature : on ne parle plus de la phrase.';
          }
          ctx.fx.rep('public', -2).rep('community', 3).morale(1);
          return 'Vous expliquez l’état dans lequel vous étiez. Certains y voient une excuse, d’autres vous croient.';
        },
      },
      {
        id: 'double_down',
        label: 'Assumer',
        hint: (ctx) => selon(ctx.situation.structureExigeante, 'Votre organisation ne vous le pardonnera pas', 'Votre communauté suivra ; les managers noteront'),
        risky: true,
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.rep('toxicity', 12).rep('public', 5).rep('pros', s.structureExigeante ? -12 : -8).rep('community', -6);
          ctx.fx.followers(Math.round(Math.sqrt(ctx.person.followers) * 45));
          ctx.fx.log('Polémique assumée publiquement.', { kind: 'media', important: true });
          ctx.fx.memory('controversy', 'Le clash', 'Vous n’avez rien retiré. Ça vous a suivi longtemps.');
          ctx.fx.later('toxicity_consequence', ctx.rng.int(20, 50), null);
          if (s.structureExigeante && ctx.team?.coachId) {
            ctx.fx.relation(ctx.team.coachId, -10, 'Il a assumé publiquement, contre l’avis de la structure.', { important: true });
          }
          return 'Vous n’enlevez rien. Votre communauté grossit. Les managers, eux, prennent note.';
        },
      },
      {
        id: 'silence',
        label: 'Ne rien dire',
        hint: 'Attendre que ça meure',
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.rep('toxicity', 2).rep('media', -3).stress(5);
          // Se taire quand on est très visible ne suffit pas : le vide se remplit.
          if (s.visibilite === VISIBILITE.VEDETTE) {
            ctx.fx.rep('public', -3).stress(4);
            return 'Vous laissez passer. À votre niveau de visibilité, le silence est lu comme un aveu, et ça dure trois semaines.';
          }
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
      const s = ctx.situation;
      const base = f && f.stability < 0.4
        ? `Il ne reste presque rien. Personne ne peut vous avancer quoi que ce soit. Il faut trouver une solution ce mois-ci.`
        : `Vos réserves sont épuisées. Vous pouvez encore tenir, mais plus longtemps sur ce rythme.`;
      // Être fauché et à bout en même temps, c'est une autre situation que d'être
      // seulement fauché, et le joueur le sait mieux que personne.
      if (s.aBout) return `${base} Vous n’avez ni argent ni énergie, et il va falloir choisir lequel des deux régler d’abord.`;
      return base;
    },
    choices: [
      {
        id: 'job',
        label: 'Prendre un travail à côté',
        hint: (ctx) => selon(ctx.situation.aBout, 'Moins de jeu — et ce sera peut-être un soulagement', 'Moins de temps de jeu, mais une stabilité'),
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.money(1800).flag('side_job', true);
          ctx.fx.log('Emploi alimentaire pris en parallèle.', { kind: 'money', important: true });
          ctx.fx.later('side_job_income', 12, { amount: 1600 });
          // Travailler à côté écrase le volume de jeu. Pour un joueur au bout,
          // c'est mécaniquement une pause forcée — ce qui n'est pas rien.
          if (s.aBout) {
            relieveLoad(ctx.person, 20, { week: ctx.world.week, reason: 'emploi alimentaire' });
            ctx.fx.fatigue(6).stress(-10).morale(2);
            return 'Vous trouvez quelque chose. Vos semaines passent de 40 à 20 heures de jeu — et votre corps vous remercie autant que votre compte.';
          }
          ctx.fx.fatigue(12).stress(-6);
          return 'Vous trouvez quelque chose. Vos semaines passent de 40 à 20 heures de jeu.';
        },
      },
      {
        id: 'stream',
        label: 'Streamer intensivement',
        hint: (ctx) => selon(ctx.situation.aBout, 'De l’argent, mais vous ajoutez des heures', 'Des revenus et de l’audience'),
        // Streamer tous les soirs quand on est déjà en rupture n'est pas une
        // option qu'un joueur envisagerait sérieusement.
        available: (ctx) => !ctx.situation.enConvalescence,
        apply: (ctx) => {
          const s = ctx.situation;
          const income = Math.round(200 + ctx.person.followers * 0.08 + ctx.person.attrs.entertainment * 6);
          ctx.fx.money(income).followers(Math.round(500 + Math.sqrt(ctx.person.followers) * 20));
          ctx.fx.group('media', 1.2);
          ctx.fx.log(`Revenus de stream : ${income.toLocaleString('fr-FR')} €.`, { kind: 'money' });
          // Ajouter des soirées de stream à un calendrier déjà plein se paie.
          if (s.aBout) {
            ctx.fx.fatigue(16).stress(8);
            return `Vous streamez tous les soirs, par-dessus le reste. ${income.toLocaleString('fr-FR')} € rentrent. Vous ne savez plus quel jour on est.`;
          }
          ctx.fx.fatigue(10);
          return `Vous streamez tous les soirs. ${income.toLocaleString('fr-FR')} € rentrent. Ce n’est pas beaucoup, mais ça rentre.`;
        },
      },
      {
        id: 'borrow',
        label: 'Demander de l’aide',
        hint: 'On vous dépannera. Il faudra le rendre, d’une façon ou d’une autre',
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
    text: (ctx) => {
      const s = ctx.situation;
      const base = `Avec ${ctx.person.followers.toLocaleString('fr-FR')} abonnés, une plateforme vous propose un contrat de créateur. Le revenu est supérieur à ce que la compétition vous rapporte. Il faudrait y consacrer l'essentiel de votre temps.`;
      // La même proposition n'est pas la même porte selon où l'on se trouve.
      if (s.aBout) return `${base} Une carrière sans classement, sans review, sans lundi matin. L’idée vous traverse plus longtemps que vous ne l’auriez cru.`;
      if (s.surLeBanc) return `${base} De toute façon, vous ne jouez pas.`;
      if (s.fauche) return `${base} C’est plus que vous n’avez gagné en deux ans.`;
      return base;
    },
    choices: [
      {
        id: 'pivot',
        label: 'Basculer vers la création de contenu',
        hint: (ctx) => selon(ctx.situation.aBout, 'Sortir de la compétition, vraiment', 'Quitter la scène pour l’audience'),
        apply: (ctx) => {
          const s = ctx.situation;
          const income = Math.round(ctx.person.followers * 0.6);
          ctx.fx.money(income).flag('content_career', true);
          ctx.career.routine = ['streaming', 'content', 'social', 'rest'];
          ctx.fx.log('Bascule vers une carrière de créateur.', { kind: 'career', important: true });
          ctx.fx.memory('pivot', 'Le virage', 'Vous avez choisi l’audience plutôt que la scène.');
          ctx.fx.later('content_growth', 26, null);
          // Quitter la compétition allège réellement la charge : plus de scrims,
          // plus d'enjeu hebdomadaire. C'est la sortie que le texte annonçait.
          if (s.aBout) {
            relieveLoad(ctx.person, 38, { week: ctx.world.week, reason: 'sortie de la compétition' });
            ctx.fx.stress(-14).morale(8);
            return `Vous signez. ${income.toLocaleString('fr-FR')} € d'avance, et pour la première fois depuis des mois, aucun match à préparer.`;
          }
          return `Vous signez. ${income.toLocaleString('fr-FR')} € d'avance, et un rythme de publication à tenir.`;
        },
      },
      {
        id: 'hybrid',
        label: 'Faire les deux',
        hint: (ctx) => selon(ctx.situation.aBout, 'Vous n’y arriverez probablement pas', 'Deux fois plus de fatigue'),
        // Mener les deux de front n'est pas une option crédible pour quelqu'un
        // qui sort d'une rupture. Il le sait mieux que quiconque.
        available: (ctx) => !ctx.situation.enConvalescence,
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.money(Math.round(ctx.person.followers * 0.2)).flag('hybrid_career', true);
          // Le cumul est un vrai cumul : il s'ajoute à ce qui est déjà porté.
          ctx.fx.fatigue(s.aBout ? 20 : 14).stress(s.aBout ? 14 : 8);
          if (s.aBout) {
            return 'Vous acceptez une version allégée du contrat. Vous savez déjà que vous ne tiendrez pas les deux.';
          }
          return 'Vous acceptez une version allégée du contrat. Vos journées n’ont plus de trous.';
        },
      },
      {
        id: 'refuse',
        label: 'Rester sur la compétition',
        hint: (ctx) => selon(ctx.situation.fauche, 'Refuser l’argent dont vous avez besoin', 'Vous n’êtes pas venu pour ça'),
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.rep('pros', 4).flag('pure_competitor', true);
          // Refuser une porte de sortie quand on est au bout, c'est un choix qui
          // engage — et qui pèse.
          if (s.aBout) {
            ctx.fx.morale(-3).stress(5);
            return 'Vous refusez. Vous n’êtes pas venu pour ça. Vous raccrochez sans être sûr d’avoir eu raison.';
          }
          if (s.fauche) {
            ctx.fx.morale(-2);
            return 'Vous refusez. Vous n’êtes pas venu pour ça. Le virement n’arrivera pas.';
          }
          ctx.fx.morale(2);
          return 'Vous refusez. Vous n’êtes pas venu pour ça.';
        },
      },
    ],
  },
];
