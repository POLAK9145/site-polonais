/**
 * Vie d'équipe (§13, §14, §15, §30 « Duo légendaire » et « Chute »).
 *
 * Ces événements lisent l'état réel du vestiaire : synergie, relations,
 * classement, contrat, rôle. Un conflit n'éclate pas au hasard — il éclate
 * quand la cohésion est déjà basse et que les personnalités s'y prêtent.
 */

import { mods } from '../../person.js';
import { rosterPersons, teamNeeds, teamStrength } from '../../team.js';
import { relationValue, REL_TAGS } from '../../relations.js';
import { collectOffers } from '../../transfers.js';
import { clamp } from '../../rng.js';

function teammates(ctx) {
  if (!ctx.team) return [];
  return rosterPersons(ctx.world, ctx.team).filter((p) => p.id !== ctx.person.id);
}

function worstRelation(ctx) {
  const mates = teammates(ctx);
  let worst = null;
  let worstVal = 999;
  for (const m of mates) {
    const v = relationValue(ctx.world, ctx.person.id, m.id);
    if (v < worstVal) {
      worstVal = v;
      worst = m;
    }
  }
  return { person: worst, value: worstVal };
}

function bestRelation(ctx) {
  const mates = teammates(ctx);
  let best = null;
  let bestVal = -999;
  for (const m of mates) {
    const v = relationValue(ctx.world, ctx.person.id, m.id);
    if (v > bestVal) {
      bestVal = v;
      best = m;
    }
  }
  return { person: best, value: bestVal };
}

export const teamLifeEvents = [
  {
    id: 'teammate_bond',
    tags: ['équipe', 'social'],
    cooldown: 60,
    condition: (ctx) => ctx.hasTeam && teammates(ctx).length > 0 && ctx.team.synergy > 45,
    weight: (ctx) => 3 + ctx.team.synergy * 0.04,
    title: 'Une entente qui se voit',
    text: (ctx) => {
      const mate = ctx.rng.pick(teammates(ctx));
      ctx.pickedMate = mate;
      if (!mate) return `Quelque chose fonctionne bien dans le groupe en ce moment.`;
      return `Sur les dernières semaines, quelque chose fonctionne particulièrement bien entre ${mate.nick} et vous. Vous n'avez plus besoin de vous parler pour savoir ce que l'autre va faire.`;
    },
    choices: [
      {
        id: 'nurture',
        label: 'Travailler ce duo',
        apply: (ctx) => {
          const mate = ctx.pickedMate ?? ctx.rng.pick(teammates(ctx));
          if (!mate) return 'Le moment passe.';
          ctx.fx.relation(mate.id, 18, `Vous construisez un vrai duo avec ${mate.nick}.`, {
            tag: REL_TAGS.FRIEND,
            important: true,
          });
          ctx.fx.synergy(4).attr('teamwork', 1.5);
          ctx.fx.chain('duo_recognition', { delay: ctx.rng.int(10, 26), expires: 60, data: { mateId: mate.id } });
          return `Vous passez des heures supplémentaires à travailler ensemble.`;
        },
      },
      {
        id: 'neutral',
        label: 'Ne rien changer',
        apply: (ctx) => {
          const mate = ctx.pickedMate ?? ctx.rng.pick(teammates(ctx));
          if (mate) ctx.fx.relation(mate.id, 5, `Bonne entente avec ${mate.nick}.`);
          return 'Ça marche tout seul. Vous n’y touchez pas.';
        },
      },
    ],
  },

  {
    id: 'duo_recognition',
    chainOnly: true,
    tags: ['équipe', 'média'],
    condition: (ctx) => {
      const mate = ctx.world.persons[ctx.chainData?.mateId];
      // Le duo n'a de sens que s'ils sont encore coéquipiers.
      return !!mate && mate.teamId === ctx.person.teamId && !!ctx.team;
    },
    title: 'On parle de vous deux',
    text: (ctx) => {
      const mate = ctx.world.persons[ctx.chainData.mateId];
      return `Les analystes commencent à citer votre duo avec ${mate.nick} comme la vraie force de l'équipe. Ce genre de réputation ouvre des portes — et en ferme d'autres.`;
    },
    choices: [
      {
        id: 'embrace',
        label: 'Assumer le duo publiquement',
        apply: (ctx) => {
          const mate = ctx.world.persons[ctx.chainData.mateId];
          ctx.fx.rep('public', 6).rep('media', 5).followers(Math.round(Math.sqrt(ctx.person.followers) * 35) + 800);
          ctx.fx.relation(mate.id, 12, `Votre duo devient une identité publique.`, { important: true });
          ctx.fx.memory('duo', 'Un duo qui compte', `Avec ${mate.nick}, vous formez le cœur de l'équipe.`);
          ctx.fx.news(`Le duo ${ctx.person.nick} — ${mate.nick} fait la différence`, 'Les observateurs saluent une complicité rare.');
          ctx.fx.later('duo_crossroads', ctx.rng.int(40, 90), { mateId: mate.id });
          return 'Vous jouez le jeu des interviews. Le duo devient une marque.';
        },
      },
      {
        id: 'downplay',
        label: 'Renvoyer le mérite à l’équipe',
        apply: (ctx) => {
          const mate = ctx.world.persons[ctx.chainData.mateId];
          ctx.fx.synergy(6).rep('pros', 4).attr('teamwork', 1);
          ctx.fx.relation(mate.id, 6, `Vous refusez de vous mettre en avant.`);
          for (const other of teammates(ctx)) {
            if (other.id !== mate.id) ctx.fx.relation(other.id, 5, 'Vous avez partagé le crédit.');
          }
          return 'Vous parlez du collectif. Le vestiaire l’entend.';
        },
      },
    ],
  },

  {
    id: 'teammate_tension',
    tags: ['équipe', 'mental'],
    cooldown: 45,
    condition: (ctx) => {
      if (!ctx.hasTeam || teammates(ctx).length === 0) return false;
      const { value } = worstRelation(ctx);
      return ctx.team.synergy < 55 || value < -10;
    },
    weight: (ctx) => {
      const { value } = worstRelation(ctx);
      const conflictProne = mods(ctx.person).conflictRisk;
      return clamp((55 - ctx.team.synergy) * 0.12 + Math.max(0, -value) * 0.06, 0, 9) * conflictProne;
    },
    title: 'Ça coince',
    text: (ctx) => {
      const { person: mate } = worstRelation(ctx);
      ctx.pickedMate = mate;
      return `${mate?.nick ?? 'Un coéquipier'} remet en cause vos décisions en jeu. Publiquement, devant le reste de l'équipe. Ce n'est pas la première fois cette semaine.`;
    },
    choices: [
      {
        id: 'confront',
        label: 'Répondre frontalement',
        risky: true,
        apply: (ctx) => {
          const mate = ctx.pickedMate;
          if (!mate) return 'Le sujet retombe.';
          ctx.fx.relation(mate.id, -22, `Affrontement ouvert avec ${mate.nick}.`, { important: true });
          ctx.fx.synergy(-9).stress(8);
          if (ctx.person.attrs.leadership > 68) {
            ctx.fx.rep('pros', 2).attr('leadership', 1);
            ctx.fx.chain('locker_room_split', { delay: ctx.rng.int(3, 8), expires: 30, data: { mateId: mate.id } });
            return 'Vous tenez tête. Le reste du groupe se tait. Personne n’a vraiment gagné.';
          }
          ctx.fx.rep('toxicity', 4);
          ctx.fx.chain('locker_room_split', { delay: ctx.rng.int(2, 6), expires: 30, data: { mateId: mate.id } });
          return 'Le ton monte vite. Trop vite. Le vocal reste silencieux pendant dix minutes après.';
        },
      },
      {
        id: 'defuse',
        label: 'Désamorcer',
        apply: (ctx) => {
          const mate = ctx.pickedMate;
          if (!mate) return 'Le sujet retombe.';
          const skill = (ctx.person.attrs.conflict + ctx.person.attrs.communication) / 2;
          if (skill > 62 || ctx.rng.chance(0.4)) {
            ctx.fx.relation(mate.id, 10, `Vous avez désamorcé un conflit avec ${mate.nick}.`);
            ctx.fx.synergy(4).attr('conflict', 1.2);
            return 'Vous laissez passer, puis vous en parlez à froid. Ça retombe.';
          }
          ctx.fx.relation(mate.id, -6, `Tentative d'apaisement mal reçue.`);
          ctx.fx.stress(5);
          return 'Vous tendez la main. Il la regarde sans la prendre.';
        },
      },
      {
        id: 'coach',
        label: 'En parler au staff',
        available: (ctx) => !!ctx.team?.coachId,
        apply: (ctx) => {
          const mate = ctx.pickedMate;
          const coach = ctx.world.persons[ctx.team.coachId];
          ctx.fx.relation(coach.id, 6, 'Vous avez fait remonter un problème de vestiaire.');
          if (mate) ctx.fx.relation(mate.id, -8, `Le staff a été mis dans la boucle.`);
          ctx.fx.synergy(2);
          return 'Le coach écoute, prend des notes, et convoque tout le monde le lendemain.';
        },
      },
    ],
  },

  {
    id: 'locker_room_split',
    chainOnly: true,
    tags: ['équipe', 'mental'],
    condition: (ctx) => ctx.hasTeam && teammates(ctx).length > 1,
    title: 'Le vestiaire se divise',
    text: (ctx) => {
      const mate = ctx.world.persons[ctx.chainData?.mateId];
      return `Le conflit avec ${mate?.nick ?? 'votre coéquipier'} a fait des camps. Deux joueurs vous soutiennent, un autre a clairement choisi l'autre bord. Le staff sait qu'il devra trancher.`;
    },
    choices: [
      {
        id: 'lead',
        label: 'Prendre les choses en main',
        apply: (ctx) => {
          const success = ctx.person.attrs.leadership * 0.5 + ctx.person.attrs.communication * 0.5;
          if (success > 65) {
            ctx.fx.synergy(10).attr('leadership', 2).rep('pros', 4);
            for (const m of teammates(ctx)) ctx.fx.relation(m.id, 8, 'Vous avez recollé le groupe.');
            ctx.fx.memory('leadership', 'Le groupe recollé', 'Vous avez tenu le vestiaire quand il partait en morceaux.');
            ctx.fx.later('leadership_noticed', 30, null);
            return 'Vous réunissez tout le monde. Vous parlez le premier. Ça tient.';
          }
          ctx.fx.synergy(-6).stress(10).rep('toxicity', 3);
          return 'Vous essayez. On vous laisse parler, puis chacun retourne à ses affaires.';
        },
      },
      {
        id: 'withdraw',
        label: 'Vous concentrer sur votre jeu',
        apply: (ctx) => {
          ctx.fx.synergy(-5).group('mechanical', 0.8).morale(-4);
          ctx.fx.later('isolation_cost', 24, null);
          return 'Vous coupez le vocal en dehors des scrims. Vos statistiques individuelles montent.';
        },
      },
      {
        id: 'ask_out',
        label: 'Demander à partir',
        risky: true,
        apply: (ctx) => {
          ctx.fx.flag('requested_transfer', true).morale(-6);
          ctx.fx.log('Demande de départ formulée.', { kind: 'decision', important: true });
          const offers = collectOffers(ctx.world, ctx.person, ctx.rng, { maxOffers: 2, minScore: 45 });
          if (offers.length > 0) {
            ctx.career.offers = offers;
            return 'Le manager ne discute même pas. Il vous dit qu’il écoutera les offres.';
          }
          ctx.fx.rep('pros', -4);
          return 'Le manager acquiesce. Puis rien. Personne ne rappelle.';
        },
      },
    ],
  },

  {
    id: 'coach_criticism',
    tags: ['équipe', 'mental'],
    cooldown: 40,
    condition: (ctx) =>
      ctx.hasTeam && !!ctx.team.coachId && (ctx.person.form < -4 || ctx.recentPerformance < 5.4),
    weight: (ctx) => clamp(2 + -ctx.person.form * 0.4, 0, 8),
    title: 'Mise au point',
    text: (ctx) => {
      const coach = ctx.world.persons[ctx.team.coachId];
      return `${coach.nick} vous garde après la review. Il déroule vos erreurs, une par une, sans élever la voix. C'est pire que s'il criait.`;
    },
    choices: [
      {
        id: 'accept',
        label: 'Encaisser et travailler',
        apply: (ctx) => {
          const coach = ctx.world.persons[ctx.team.coachId];
          ctx.fx.relation(coach.id, 8, 'Vous avez accepté une critique dure.');
          ctx.fx.attr('learning', 1.5).attr('discipline', 1).morale(-3).stress(4);
          ctx.fx.later('coaching_payoff', ctx.rng.int(14, 30), { coachId: coach.id });
          return 'Vous notez tout. Vous ne dormez pas très bien, mais vous notez tout.';
        },
      },
      {
        id: 'defend',
        label: 'Vous défendre',
        apply: (ctx) => {
          const coach = ctx.world.persons[ctx.team.coachId];
          if (ctx.person.attrs.communication > 68) {
            ctx.fx.relation(coach.id, 2, 'Vous avez argumenté votre point de vue.');
            ctx.fx.attr('selfConfidence', 1.5);
            return 'Vous expliquez votre lecture. Il concède un point sur trois. C’est déjà ça.';
          }
          ctx.fx.relation(coach.id, -12, 'Vous avez contesté le staff.', { important: true });
          ctx.fx.rep('toxicity', 3).stress(6);
          return 'Il vous écoute jusqu’au bout, puis passe au joueur suivant. Vous avez perdu du crédit.';
        },
      },
    ],
  },

  {
    id: 'benched',
    tags: ['équipe', 'compétition'],
    cooldown: 60,
    condition: (ctx) => {
      if (!ctx.hasTeam || !ctx.team.roster.includes(ctx.person.id)) return false;
      const needs = teamNeeds(ctx.world, ctx.team);
      // On ne met sur le banc que le maillon faible, et seulement si
      // l'équipe a réellement une alternative.
      return needs.weakestId === ctx.person.id && (ctx.person.form < -3 || ctx.rating < needs.targetRating - 6) && ctx.team.subs.length + ctx.team.roster.length > (ctx.game.teamSize ?? 1);
    },
    weight: (ctx) => clamp(3 + (ctx.recentPerformance < 5.5 ? 4 : 0) + -ctx.person.form * 0.3, 0, 10),
    title: 'Sur le banc',
    text: (ctx) => {
      const org = ctx.org;
      return `Le staff de ${org?.name ?? 'votre équipe'} vous annonce que vous ne commencerez pas le prochain match. Ce n'est pas présenté comme une sanction. Ça en est une.`;
    },
    choices: [
      {
        id: 'fight',
        label: 'Vous battre pour votre place',
        apply: (ctx) => {
          benchPlayer(ctx);
          ctx.fx.stress(10).morale(-10).attr('workCapacity', 1.5).flag('benched', true);
          ctx.fx.log('Mis sur le banc.', { kind: 'setback', important: true });
          ctx.fx.chain('bench_verdict', { delay: ctx.rng.int(6, 14), expires: 30 });
          return 'Vous doublez vos heures. Vous ne dites rien à personne.';
        },
      },
      {
        id: 'demand',
        label: 'Exiger des explications',
        risky: true,
        apply: (ctx) => {
          benchPlayer(ctx);
          ctx.fx.stress(8).flag('benched', true);
          if (ctx.team.coachId) ctx.fx.relation(ctx.team.coachId, -9, 'Vous avez contesté votre mise à l’écart.');
          ctx.fx.rep('toxicity', 3);
          ctx.fx.chain('bench_verdict', { delay: ctx.rng.int(4, 10), expires: 30 });
          return 'On vous répond que la décision est sportive. Vous n’y croyez pas une seconde.';
        },
      },
    ],
  },

  {
    id: 'bench_verdict',
    chainOnly: true,
    tags: ['équipe'],
    condition: (ctx) => ctx.hasTeam,
    title: 'Le verdict',
    text: (ctx) =>
      `Après quelques semaines en retrait, le staff revient vers vous. La décision est prise.`,
    auto: (ctx) => {
      const team = ctx.team;
      const isBenched = team.subs.includes(ctx.person.id);
      const needs = teamNeeds(ctx.world, team);
      const deserved = ctx.rating >= needs.targetRating - 3 || ctx.person.form > 2;
      if (isBenched && deserved) {
        // Revenir du banc, c'est prendre la place de quelqu'un — pas ajouter un
        // siège. Cette ligne empilait le joueur dans le cinq de départ sans
        // vérifier qu'une place s'y trouvait : sur un jeu solo, dont l'effectif
        // vaut 1, l'équipe se retrouvait avec deux titulaires pour une place.
        // Mesuré sur les 1400 carrières du baseline : 2 occurrences, toutes deux
        // sur `stadiumkings` et `ironfist`, et toutes deux impliquant le joueur.
        const promoted = reclaimStartingSpot(ctx, team);
        if (!promoted) {
          ctx.fx.morale(-8).stress(6);
          ctx.fx.log('Le staff reconnaît vos progrès, mais la place n’est pas libre.', {
            kind: 'result',
          });
          return 'On vous dit de patienter : personne ne cède sa place.';
        }
        ctx.fx.morale(14).flag('benched', false);
        ctx.fx.log('Retour dans le cinq de départ.', { kind: 'result', important: true });
        ctx.fx.memory('comeback', 'Retour dans l’équipe', 'Vous avez repris votre place à la force du travail.');
        return 'Vous récupérez votre place de titulaire.';
      }
      if (isBenched) {
        ctx.fx.morale(-12).stress(8);
        ctx.fx.later('bench_rot', 20, null);
        return 'Rien ne change. On vous demande d’être patient. Le mot est lâché : « patient ».';
      }
      return 'La situation s’est réglée d’elle-même.';
    },
  },

  {
    id: 'captaincy_offer',
    tags: ['équipe', 'social'],
    once: true,
    condition: (ctx) =>
      ctx.hasTeam &&
      teammates(ctx).length >= 2 &&
      ctx.person.attrs.leadership > 62 &&
      ctx.team.synergy > 45 &&
      ctx.person.stats.matches > 25,
    weight: (ctx) => clamp((ctx.person.attrs.leadership - 60) * 0.35, 0, 9),
    title: 'On vous propose le rôle',
    text: (ctx) =>
      `Le staff veut confier la prise de parole en jeu à quelqu'un. Votre nom revient. C'est une charge : plus de responsabilité, moins de liberté, et la faute pour vous quand ça rate.`,
    choices: [
      {
        id: 'accept',
        label: 'Accepter le rôle',
        apply: (ctx) => {
          ctx.person.roleId = ctx.game.roles?.find((r) => r.id === 'igl' || r.id === 'shotcaller')?.id ?? ctx.person.roleId;
          ctx.fx.attr('leadership', 3).attr('decision', 2).attr('communication', 2);
          ctx.fx.synergy(6).stress(9).flag('captain', true);
          ctx.fx.log('Devient le meneur de jeu de l’équipe.', { kind: 'team', important: true });
          ctx.fx.memory('leadership', 'Capitaine', 'On vous a confié la voix de l’équipe.');
          ctx.fx.achievement('became_captain');
          return 'Vous acceptez. À partir de maintenant, les silences sont les vôtres à combler.';
        },
      },
      {
        id: 'decline',
        label: 'Refuser',
        apply: (ctx) => {
          ctx.fx.stress(-4).morale(2);
          ctx.fx.log('Refuse le rôle de meneur.', { kind: 'decision' });
          return 'Vous préférez jouer. On respecte, sans le dire.';
        },
      },
    ],
  },

  {
    id: 'contract_expiring',
    tags: ['transfert', 'argent'],
    cooldown: 26,
    condition: (ctx) =>
      ctx.hasTeam && !!ctx.person.contract && ctx.person.contract.endWeek - ctx.world.week <= 12 && ctx.person.contract.endWeek - ctx.world.week > 0,
    weight: () => 9,
    title: 'Fin de contrat',
    text: (ctx) => {
      const weeks = ctx.person.contract.endWeek - ctx.world.week;
      return `Votre contrat avec ${ctx.org?.name} expire dans ${weeks} semaines. Le manager veut savoir où vous en êtes. Vous aussi, d'ailleurs.`;
    },
    choices: [
      {
        id: 'renew',
        label: 'Prolonger',
        apply: (ctx) => {
          const strength = teamStrength(ctx.world, ctx.team, { forMatch: false });
          const wanted = ctx.rating >= strength.individual - 4;
          if (!wanted) {
            ctx.fx.morale(-8);
            ctx.fx.log('Prolongation refusée par l’organisation.', { kind: 'setback', important: true });
            return 'Ils ne prolongent pas. La conversation est courte.';
          }
          const bump = ctx.rng.float(1.0, 1.35);
          ctx.person.contract.salary = Math.round(ctx.person.contract.salary * bump);
          ctx.person.contract.endWeek = ctx.world.week + 52 * ctx.rng.int(1, 3);
          ctx.fx.morale(8);
          ctx.fx.log(`Prolongation chez ${ctx.org.name}.`, { kind: 'contract', important: true });
          return `Vous prolongez pour ${Math.round(ctx.person.contract.salary).toLocaleString('fr-FR')} € par an.`;
        },
      },
      {
        id: 'negotiate',
        label: 'Demander plus',
        risky: true,
        apply: (ctx) => {
          const leverage = ctx.rating - teamStrength(ctx.world, ctx.team, { forMatch: false }).individual;
          const rep = ctx.person.reputation.pros;
          const success = leverage * 3 + rep * 0.4 + ctx.person.attrs.communication * 0.2 - 20;
          if (success > 25) {
            ctx.person.contract.salary = Math.round(ctx.person.contract.salary * ctx.rng.float(1.4, 1.9));
            ctx.person.contract.endWeek = ctx.world.week + 52 * 2;
            ctx.fx.morale(10).rep('pros', 2);
            ctx.fx.log('Revalorisation obtenue.', { kind: 'contract', important: true });
            return `Ils cèdent. Nouveau salaire : ${ctx.person.contract.salary.toLocaleString('fr-FR')} €.`;
          }
          if (success > 0) {
            ctx.person.contract.salary = Math.round(ctx.person.contract.salary * 1.1);
            ctx.person.contract.endWeek = ctx.world.week + 52;
            return 'Ils lâchent un peu. Pas ce que vous vouliez, mais un peu.';
          }
          ctx.fx.morale(-6).flag('negotiation_failed', true);
          if (ctx.team.coachId) ctx.fx.relation(ctx.team.coachId, -5, 'Négociation salariale tendue.');
          ctx.fx.log('Négociation salariale échouée.', { kind: 'setback' });
          return 'Le manager rit à moitié. Puis il ne rit plus. Il vous dit d’aller voir ailleurs.';
        },
      },
      {
        id: 'test_market',
        label: 'Tester le marché',
        apply: (ctx) => {
          const offers = collectOffers(ctx.world, ctx.person, ctx.rng, { maxOffers: 3, minScore: 42 });
          if (offers.length === 0) {
            ctx.fx.morale(-5);
            ctx.fx.log('Aucune offre extérieure.', { kind: 'setback' });
            return 'Vous laissez filtrer que vous êtes disponible. Le marché ne bouge pas.';
          }
          ctx.career.offers = offers;
          ctx.fx.log(`${offers.length} offre(s) sur le marché.`, { kind: 'transfer' });
          return `${offers.length} structure(s) se manifestent.`;
        },
      },
    ],
  },

  {
    id: 'teammate_departure',
    tags: ['équipe', 'transfert'],
    cooldown: 30,
    condition: (ctx) => ctx.hasTeam && teammates(ctx).length > 0 && ctx.isTransferWindow,
    weight: () => 4,
    title: 'Un départ',
    text: (ctx) => {
      const mate = ctx.rng.weighted(teammates(ctx), (m) => 1 + Math.abs(relationValue(ctx.world, ctx.person.id, m.id)) * 0.05);
      ctx.pickedMate = mate;
      if (!mate) return `Un coéquipier quitte l'équipe. L'annonce tombe sans prévenir.`;
      const rel = relationValue(ctx.world, ctx.person.id, mate.id);
      return rel > 40
        ? `${mate.nick} vous appelle avant tout le monde : il part. Il a signé ailleurs. Il voulait que vous l'appreniez de lui.`
        : `${mate.nick} quitte l'équipe. L'annonce tombe sur les réseaux avant que le vestiaire en soit informé.`;
    },
    choices: [
      {
        id: 'support',
        label: 'Lui souhaiter bonne chance',
        apply: (ctx) => {
          const mate = ctx.pickedMate;
          if (!mate) return 'Le départ se fait sans vous.';
          ctx.fx.relation(mate.id, 10, `${mate.nick} a quitté l'équipe, vous êtes restés proches.`, {
            tag: REL_TAGS.EX_TEAMMATE,
            important: true,
          });
          ctx.fx.morale(-4).synergy(-3);
          return 'Vous lui souhaitez bonne route. Vous le pensez.';
        },
      },
      {
        id: 'resent',
        label: 'Mal le prendre',
        apply: (ctx) => {
          const mate = ctx.pickedMate;
          if (!mate) return 'Le départ se fait sans vous.';
          ctx.fx.relation(mate.id, -18, `Vous avez mal vécu le départ de ${mate.nick}.`, {
            tag: REL_TAGS.EX_TEAMMATE,
            important: true,
          });
          ctx.fx.morale(-7).synergy(-5);
          ctx.fx.later('rivalry_seed', ctx.rng.int(20, 60), { personId: mate.id });
          return 'Vous ne répondez pas à son message. Il le remarquera.';
        },
      },
    ],
  },
];

/**
 * Fait passer le joueur du banc au cinq de départ, en respectant la taille de
 * l'effectif.
 *
 * Deux cas : soit une place est libre et il la prend, soit l'effectif est plein
 * et il faut que quelqu'un lui cède la sienne — le maillon faible, qui rejoint
 * le banc. Si ce maillon faible n'existe pas (effectif d'un seul joueur qui est
 * déjà lui), personne ne sort et la promotion n'a pas lieu.
 *
 * Renvoie `true` si le joueur est désormais titulaire.
 */
function reclaimStartingSpot(ctx, team) {
  const size = ctx.game?.teamSize ?? 1;
  const i = team.subs.indexOf(ctx.person.id);
  if (i < 0) return false;

  if (team.roster.length < size) {
    team.subs.splice(i, 1);
    team.roster.push(ctx.person.id);
    return true;
  }

  const weakest = teamNeeds(ctx.world, team).weakestId;
  if (!weakest || weakest === ctx.person.id) return false;
  const j = team.roster.indexOf(weakest);
  if (j < 0) return false;
  team.roster[j] = ctx.person.id;
  team.subs[i] = weakest;
  const displaced = ctx.world.persons[weakest];
  if (displaced) displaced.benchedSince = ctx.world.week;
  return true;
}

function benchPlayer(ctx) {
  const team = ctx.team;
  const i = team.roster.indexOf(ctx.person.id);
  if (i >= 0) {
    team.roster.splice(i, 1);
    team.subs.push(ctx.person.id);
    // Une équipe amputée doit rester jouable : on remonte un remplaçant.
    const promoted = team.subs.find((id) => id !== ctx.person.id);
    if (promoted && team.roster.length < (ctx.game.teamSize ?? 1)) {
      team.subs.splice(team.subs.indexOf(promoted), 1);
      team.roster.push(promoted);
    }
  }
}
