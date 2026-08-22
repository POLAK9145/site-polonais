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
import { selon, VISIBILITE, SAISON_DE_VIE } from '../situation.js';
import { relieveLoad } from '../../load.js';

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
    // Se rapprocher de quelqu'un demande de la disponibilité (étape 7F). Un
    // joueur à bout n'a pas l'énergie des amitiés, et un joueur isolé dans son
    // vestiaire a d'autant plus besoin qu'il s'en noue une.
    weight: (ctx) => {
      const s = ctx.situation;
      const base = 3 + ctx.team.synergy * 0.04;
      return base * (s.aBout ? 0.45 : s.enConvalescence ? 0.6 : 1) * (s.isoleDansEquipe ? 1.5 : 1);
    },
    title: 'Une entente qui se voit',
    text: (ctx) => {
      // On se rapproche de celui dont on est déjà le plus proche, pas d'un
      // coéquipier tiré au sort (étape 7D). Les conflits visaient déjà la pire
      // relation via `worstRelation` ; les moments positifs, eux, tiraient au
      // hasard, si bien que les gains se répartissaient uniformément et
      // qu'aucune amitié ne se construisait vraiment — mesuré, 0,3 relation
      // forte par carrière. Concentrer plutôt qu'augmenter : c'est ainsi que se
      // forment les vraies affinités, et cela ne gonfle aucun total.
      const mate = bestRelation(ctx).person ?? ctx.rng.pick(teammates(ctx));
      ctx.pickedMate = mate;
      if (!mate) return `Quelque chose fonctionne bien dans le groupe en ce moment.`;
      const s = ctx.situation;
      const base = `Sur les dernières semaines, quelque chose fonctionne particulièrement bien entre ${mate.nick} et vous. Vous n'avez plus besoin de vous parler pour savoir ce que l'autre va faire.`;
      if (s.surLeBanc) return `${base} Vous vous entendez surtout à l’entraînement : en match, vous le regardez jouer.`;
      return base;
    },
    choices: [
      {
        id: 'nurture',
        label: 'Travailler ce duo',
        hint: (ctx) => selon(ctx.situation.aBout, 'Des heures en plus que vous n’avez pas', 'Des heures en plus, ensemble'),
        apply: (ctx) => {
          const mate = ctx.pickedMate ?? ctx.rng.pick(teammates(ctx));
          if (!mate) return 'Le moment passe.';
          const s = ctx.situation;
          ctx.fx.relation(mate.id, 18, `Vous construisez un vrai duo avec ${mate.nick}.`, {
            tag: REL_TAGS.FRIEND,
            important: true,
          });
          ctx.fx.synergy(4).attr('teamwork', 1.5);
          // Ces heures supplémentaires existent vraiment : elles s'ajoutent.
          if (s.aBout) ctx.fx.fatigue(6).stress(4);
          ctx.fx.chain('duo_recognition', { delay: ctx.rng.int(10, 26), expires: 60, data: { mateId: mate.id } });
          return `Vous passez des heures supplémentaires à travailler ensemble.`;
        },
      },
      {
        id: 'lean',
        label: 'Vous appuyer sur lui',
        hint: 'Lui dire ce que vous traversez',
        // On ne se confie qu'en ayant quelque chose à confier.
        available: (ctx) => ctx.situation.aBout || ctx.situation.enDifficulte || ctx.situation.fauche,
        apply: (ctx) => {
          const mate = ctx.pickedMate ?? ctx.rng.pick(teammates(ctx));
          if (!mate) return 'Le moment passe.';
          const s = ctx.situation;
          ctx.fx.relation(mate.id, 12, `Vous vous êtes appuyé sur ${mate.nick} dans une mauvaise passe.`, {
            tag: REL_TAGS.FRIEND,
            important: true,
          });
          // Parler ne règle rien de matériel, mais allège réellement.
          ctx.fx.stress(-9).morale(5);
          if (s.aBout) relieveLoad(ctx.person, 10, { week: ctx.world.week, reason: 'soutien d’un coéquipier' });
          return `Vous lui dites une partie de ce que vous n’avez dit à personne. Il n’a pas de solution. Ça aide quand même.`;
        },
      },
      {
        id: 'neutral',
        label: 'Ne rien changer',
        hint: 'Ce qui marche seul n’a pas besoin de vous',
        apply: (ctx) => {
          const mate = ctx.pickedMate ?? ctx.rng.pick(teammates(ctx));
          if (mate) ctx.fx.relation(mate.id, 5, `Bonne entente avec ${mate.nick}.`);
          // Laisser filer une bonne entente quand on va mal, c'est rester seul.
          if (ctx.situation.aBout || ctx.situation.enDifficulte) ctx.fx.morale(-2);
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
      const s = ctx.situation;
      const base = `${coach.nick} vous garde après la review. Il déroule vos erreurs, une par une, sans élever la voix. C'est pire que s'il criait.`;
      // Encaisser une mise au point n'a pas le même poids selon ce qu'on porte
      // déjà. Le joueur sait très bien où il en est.
      if (s.aBout) return `${base} Vous l’écoutez en pensant que vous n’avez déjà plus rien à donner.`;
      if (s.saisonDeVie === SAISON_DE_VIE.VETERAN) return `${base} Il y a dix ans, vous auriez discuté. Là, vous êtes surtout fatigué de l’entendre.`;
      return base;
    },
    choices: [
      {
        id: 'accept',
        label: 'Encaisser et travailler',
        hint: (ctx) => selon(ctx.situation.aBout, 'Il faudra trouver l’énergie quelque part', 'Prendre la critique et s’y mettre'),
        apply: (ctx) => {
          const coach = ctx.world.persons[ctx.team.coachId];
          const s = ctx.situation;
          ctx.fx.relation(coach.id, 8, 'Vous avez accepté une critique dure.');
          // Travailler davantage suppose d'en avoir la ressource. À bout, on
          // encaisse mais on n'apprend presque plus — et cela coûte.
          const rendement = s.aBout ? 0.4 : 1;
          ctx.fx.attr('learning', 1.5 * rendement).attr('discipline', 1 * rendement);
          ctx.fx.morale(-3).stress(s.aBout ? 8 : 4);
          ctx.fx.later('coaching_payoff', ctx.rng.int(14, 30), { coachId: coach.id });
          if (s.aBout) return 'Vous notez tout. Vous relisez vos notes trois fois sans les comprendre.';
          return 'Vous notez tout. Vous ne dormez pas très bien, mais vous notez tout.';
        },
      },
      {
        id: 'admit',
        label: 'Dire que vous n’en pouvez plus',
        hint: 'Ce n’est pas une excuse, c’est un fait',
        // On ne peut dire cela que si c'est vrai, et cela n'a de sens qu'auprès
        // d'un staff qui existe. C'est aussi la porte d'entrée narrative de la
        // charge (7B) hors des événements de rupture.
        available: (ctx) => ctx.situation.aBout || ctx.situation.enchaine,
        apply: (ctx) => {
          const coach = ctx.world.persons[ctx.team.coachId];
          const s = ctx.situation;
          // Un staff écoute mieux quelqu'un avec qui il a du crédit, et une
          // structure exigeante pardonne moins.
          const credit = relationValue(ctx.world, ctx.person.id, coach.id);
          const ecoute = credit > 10 && !s.structureExigeante;
          if (ecoute) {
            relieveLoad(ctx.person, 26, { week: ctx.world.week, reason: 'charge reconnue par le staff' });
            ctx.fx.relation(coach.id, 10, 'Il a dit qu’il n’en pouvait plus, et on l’a entendu.', { important: true });
            ctx.fx.stress(-12).morale(6);
            ctx.fx.log('Charge allégée après une mise au point.', { kind: 'team', important: true });
            return 'Il repose ses notes. « On va lever le pied sur toi deux semaines. » Vous ne saviez pas que c’était possible.';
          }
          ctx.fx.relation(coach.id, -6, 'Il a invoqué la fatigue au mauvais moment.');
          ctx.fx.morale(-5).stress(4);
          return 'Il vous répond que tout le monde est fatigué. La conversation s’arrête là.';
        },
      },
      {
        id: 'defend',
        label: 'Vous défendre',
        hint: (ctx) => selon(ctx.situation.structureExigeante, 'Ici, on ne discute pas beaucoup', 'Expliquer votre lecture'),
        apply: (ctx) => {
          const coach = ctx.world.persons[ctx.team.coachId];
          const s = ctx.situation;
          // Argumenter demande d'être écoutable : de la communication, et une
          // structure qui laisse la place à la discussion.
          const seuil = s.structureExigeante ? 78 : 68;
          if (ctx.person.attrs.communication > seuil) {
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
    // Étape 7D : se retrouver sur le banc n'a pas le même goût selon qu'on a
    // des alliés dans le groupe ou qu'on y est déjà seul.
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
      const s = ctx.situation;
      const base = `Le staff de ${org?.name ?? 'votre équipe'} vous annonce que vous ne commencerez pas le prochain match. Ce n'est pas présenté comme une sanction. Ça en est une.`;
      // Un joueur épuisé entend autre chose dans la même phrase.
      if (s.aBout) return `${base} Une partie de vous, celle qui n’a pas dormi depuis trois mois, est presque soulagée.`;
      if (s.saisonDeVie === SAISON_DE_VIE.VETERAN) return `${base} Vous connaissez la suite : ça commence comme ça.`;
      // Être écarté devant des gens qui vous apprécient, ou devant des gens qui
      // attendaient ça, ce n'est pas la même humiliation (étape 7D).
      if (s.vestiaireHostile) return `${base} Deux ou trois personnes dans ce vestiaire attendaient exactement ça.`;
      if (s.alliesDansEquipe >= 2) return `${base} Vos proches dans le groupe évitent votre regard.`;
      if (s.aEteSurLeBanc) return `${base} Vous êtes déjà passé par là. Vous savez ce que ça coûte de revenir.`;
      return base;
    },
    choices: [
      {
        id: 'fight',
        label: 'Vous battre pour votre place',
        hint: (ctx) => selon(ctx.situation.aBout, 'Doubler les heures, avec ce qu’il vous reste', 'Doubler les heures, sans rien dire'),
        apply: (ctx) => {
          const s = ctx.situation;
          benchPlayer(ctx);
          ctx.fx.stress(10).morale(-10).flag('benched', true);
          // Doubler les heures est une charge réelle, et elle s'ajoute.
          ctx.fx.attr('workCapacity', s.aBout ? 0.6 : 1.5);
          if (s.aBout) ctx.fx.fatigue(8);
          ctx.fx.log('Mis sur le banc.', { kind: 'setback', important: true });
          ctx.fx.chain('bench_verdict', { delay: ctx.rng.int(6, 14), expires: 30 });
          if (s.aBout) return 'Vous doublez vos heures. Vous ne dites rien à personne, et votre corps ne suit pas.';
          return 'Vous doublez vos heures. Vous ne dites rien à personne.';
        },
      },
      {
        id: 'rest',
        label: 'Prendre ce banc comme une pause',
        hint: 'Vous récupérer, et revenir entier',
        // Ce n'est une option que pour quelqu'un qui a réellement besoin de
        // souffler. Un joueur frais mis sur le banc ne se dit pas cela.
        available: (ctx) => ctx.situation.aBout || ctx.situation.enchaine || ctx.situation.dejaRompu,
        apply: (ctx) => {
          benchPlayer(ctx);
          const s = ctx.situation;
          relieveLoad(ctx.person, 30, { week: ctx.world.week, reason: 'banc accepté comme pause' });
          ctx.fx.stress(-10).morale(-3).flag('benched', true);
          ctx.fx.log('Mise à l’écart utilisée comme récupération.', { kind: 'team', important: true });
          ctx.fx.chain('bench_verdict', { delay: ctx.rng.int(10, 20), expires: 30 });
          // Le staff n'aime pas toujours ; une structure exigeante y voit un renoncement.
          if (ctx.team.coachId) {
            ctx.fx.relation(ctx.team.coachId, s.structureExigeante ? -4 : 2, s.structureExigeante
              ? 'Il n’a pas contesté sa mise à l’écart. Le staff y a vu un abandon.'
              : 'Il a accepté sa mise à l’écart sans drame.');
          }
          return 'Vous ne protestez pas. Vous dormez huit heures pour la première fois depuis longtemps.';
        },
      },
      {
        id: 'demand',
        label: 'Exiger des explications',
        hint: (ctx) => selon(ctx.situation.structureExigeante, 'Ici, cela se retiendra contre vous', 'Vous voulez savoir pourquoi'),
        risky: true,
        apply: (ctx) => {
          const s = ctx.situation;
          benchPlayer(ctx);
          ctx.fx.stress(8).flag('benched', true);
          if (ctx.team.coachId) ctx.fx.relation(ctx.team.coachId, s.structureExigeante ? -13 : -9, 'Vous avez contesté votre mise à l’écart.');
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
    text: (ctx) => {
      const s = ctx.situation;
      const base = `Le staff veut confier la prise de parole en jeu à quelqu'un. Votre nom revient. C'est une charge : plus de responsabilité, moins de liberté, et la faute pour vous quand ça rate.`;
      if (s.aBout) return `${base} On vous demande d’en porter plus, à un moment où vous n’arrivez déjà plus à porter le reste.`;
      if (s.saisonDeVie === SAISON_DE_VIE.VETERAN) return `${base} C’est peut-être ce qui vous gardera utile quand les réflexes lâcheront.`;
      return base;
    },
    choices: [
      {
        id: 'accept',
        label: 'Accepter le rôle',
        hint: (ctx) => selon(ctx.situation.aBout, 'Une charge de plus, sur une pile qui déborde', 'Plus de responsabilité, moins de liberté'),
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.person.roleId = ctx.game.roles?.find((r) => r.id === 'igl' || r.id === 'shotcaller')?.id ?? ctx.person.roleId;
          ctx.fx.attr('leadership', 3).attr('decision', 2).attr('communication', 2);
          ctx.fx.synergy(6).flag('captain', true);
          ctx.fx.log('Devient le meneur de jeu de l’équipe.', { kind: 'team', important: true });
          ctx.fx.memory('leadership', 'Capitaine', 'On vous a confié la voix de l’équipe.');
          ctx.fx.achievement('became_captain');
          // Le capitanat est une charge réelle : elle s'ajoute à ce qui est déjà là.
          ctx.fx.stress(s.aBout ? 15 : 9);
          if (s.aBout) ctx.fx.fatigue(5);
          return 'Vous acceptez. À partir de maintenant, les silences sont les vôtres à combler.';
        },
      },
      {
        id: 'share',
        label: 'Accepter, à condition de partager la charge',
        hint: 'Demander que quelqu’un d’autre porte une partie',
        // On ne négocie le rôle que si l'on a un vétéran de crédit ou un besoin
        // reconnu de souffler — et il faut quelqu'un en face pour l'entendre.
        available: (ctx) =>
          ctx.situation.aUnCoach &&
          (ctx.situation.aBout || ctx.situation.saisonDeVie === SAISON_DE_VIE.VETERAN),
        apply: (ctx) => {
          const s = ctx.situation;
          const coach = ctx.world.persons[ctx.team.coachId];
          const credit = relationValue(ctx.world, ctx.person.id, coach.id);
          // Le staff accepte de partager si le joueur a du crédit ; sinon il
          // entend une réticence.
          if (credit > 5 || s.saisonDeVie === SAISON_DE_VIE.VETERAN) {
            ctx.person.roleId = ctx.game.roles?.find((r) => r.id === 'igl' || r.id === 'shotcaller')?.id ?? ctx.person.roleId;
            ctx.fx.attr('leadership', 2).attr('communication', 2);
            ctx.fx.synergy(4).stress(4).flag('captain', true);
            ctx.fx.relation(coach.id, 6, 'Il a pris le rôle en posant ses conditions.');
            ctx.fx.log('Devient meneur de jeu, la charge partagée.', { kind: 'team', important: true });
            return 'Vous acceptez, à condition qu’un autre prenne la préparation. Le staff trouve cela raisonnable.';
          }
          ctx.fx.relation(coach.id, -5, 'Il a posé des conditions pour un rôle qu’on lui offrait.');
          ctx.fx.morale(-4);
          return 'Vous posez vos conditions. Le staff préfère chercher quelqu’un d’autre.';
        },
      },
      {
        id: 'decline',
        label: 'Refuser',
        hint: (ctx) => selon(ctx.situation.aBout, 'Vous protéger, pendant qu’il en reste', 'Vous préférez jouer'),
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.log('Refuse le rôle de meneur.', { kind: 'decision' });
          if (s.aBout) {
            ctx.fx.stress(-8).morale(3);
            return 'Vous préférez jouer. On respecte, sans le dire — et vous savez que c’était la bonne décision.';
          }
          ctx.fx.stress(-4).morale(2);
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
    weight: (ctx) => 9 + (ctx.situation.surLeBanc ? 2 : 0),
    title: 'Fin de contrat',
    text: (ctx) => {
      const weeks = ctx.person.contract.endWeek - ctx.world.week;
      const s = ctx.situation;
      const base = `Votre contrat avec ${ctx.org?.name} expire dans ${weeks} semaines. Le manager veut savoir où vous en êtes. Vous aussi, d'ailleurs.`;
      // Ce que le joueur pèse dépend de ce qu'il vit, et il le sait sans qu'on
      // ait besoin de le lui apprendre.
      if (s.surLeBanc) return `${base} Difficile de réclamer quoi que ce soit quand on n’a pas joué depuis des semaines.`;
      // Ce qui s'est déjà passé entre vous et cette structure pèse sur la
      // conversation, et les deux camps s'en souviennent (étape 7D).
      if (s.aDemandeUnTransfert) return `${base} Vous avez demandé à partir, une fois. Personne ne l’a oublié.`;
      if (s.vestiaireHostile) return `${base} Une partie du vestiaire ne vous regrettera pas.`;
      if (s.aChoisiLaRigueur) return `${base} Vous arrivez avec vos notes, vos chiffres, vos objectifs tenus.`;
      if (s.saisonDeVie === SAISON_DE_VIE.VETERAN) return `${base} À votre âge, ce n’est plus le montant qui compte le plus.`;
      if (s.aBout) return `${base} L’idée de repartir de zéro ailleurs vous épuise d’avance.`;
      return base;
    },
    choices: [
      {
        id: 'renew',
        label: 'Prolonger',
        hint: (ctx) => selon(ctx.situation.enDifficulte, 'Ils ne sont peut-être pas d’accord', 'Rester aux conditions actuelles'),
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
        id: 'security',
        label: 'Demander un contrat long plutôt qu’un gros salaire',
        hint: 'Moins d’argent, mais savoir où l’on dort',
        // La sécurité n'a de sens que pour quelqu'un qui sait que le temps joue
        // contre lui, ou qui n'a plus l'énergie de recommencer ailleurs. Un
        // espoir en forme ne demande pas cela — et le texte le dit.
        available: (ctx) =>
          ctx.situation.saisonDeVie === SAISON_DE_VIE.VETERAN ||
          ctx.situation.aBout ||
          ctx.situation.dejaRompu,
        apply: (ctx) => {
          const s = ctx.situation;
          const strength = teamStrength(ctx.world, ctx.team, { forMatch: false });
          // Une structure accepte volontiers de payer moins longtemps ; elle
          // hésite si le joueur est devenu un poids.
          const utile = ctx.rating >= strength.individual - 9;
          if (!utile) {
            ctx.fx.morale(-6);
            ctx.fx.log('Contrat long refusé.', { kind: 'setback' });
            return 'Ils préfèrent ne rien promettre. Personne ne veut d’engagement long sur vous.';
          }
          ctx.person.contract.salary = Math.round(ctx.person.contract.salary * ctx.rng.float(0.78, 0.95));
          ctx.person.contract.endWeek = ctx.world.week + 52 * ctx.rng.int(2, 4);
          ctx.fx.morale(s.aBout || s.dejaRompu ? 12 : 7).stress(-6);
          if (ctx.team.coachId) ctx.fx.relation(ctx.team.coachId, 4, 'Il a choisi la stabilité plutôt que l’argent.');
          ctx.fx.log(`Contrat long signé chez ${ctx.org.name}.`, { kind: 'contract', important: true });
          return `Vous signez plus longtemps pour moins cher : ${Math.round(ctx.person.contract.salary).toLocaleString('fr-FR')} € par an. Vous savez où vous serez dans deux ans.`;
        },
      },
      {
        id: 'negotiate',
        label: 'Demander plus',
        hint: (ctx) =>
          selon(
            ctx.situation.visibilite === VISIBILITE.VEDETTE,
            'Votre nom parle pour vous',
            'Il faudra le justifier',
          ),
        risky: true,
        // On ne réclame pas une revalorisation quand on ne joue pas. Ce n'est
        // pas le moteur qui l'interdit, c'est la situation qui la rend absurde.
        available: (ctx) => !ctx.situation.surLeBanc,
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
        hint: (ctx) => selon(ctx.situation.surLeBanc, 'Vous n’avez pas grand-chose à perdre', 'Voir ce que vous valez ailleurs'),
        apply: (ctx) => {
          const s = ctx.situation;
          // Un joueur qui ne joue pas cherche d'abord une place, pas un rang :
          // il regarde plus bas, donc il trouve plus souvent.
          const minScore = s.surLeBanc ? 34 : 42;
          const offers = collectOffers(ctx.world, ctx.person, ctx.rng, { maxOffers: 3, minScore });
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
    // Un départ se raconte d'autant plus qu'il y a quelque chose à perdre : une
    // équipe soudée, ou un vestiaire déjà instable. Un groupe tiède ne produit
    // pas de scène.
    weight: (ctx) => {
      const synergie = ctx.team?.synergy ?? 50;
      const enjeu = Math.abs(synergie - 50) / 25;
      // Un départ compte davantage quand il reste peu de monde à qui l'on
      // tient : c'est la mémoire sociale qui donne son poids à la scène.
      const attachement = ctx.situation.alliesDansEquipe > 0 ? 1.5 : 0;
      return clamp(2.5 + enjeu * 2.5 + (ctx.situation.surLeBanc ? 1 : 0) + attachement, 1, 8);
    },
    title: 'Un départ',
    text: (ctx) => {
      const mate = ctx.rng.weighted(teammates(ctx), (m) => 1 + Math.abs(relationValue(ctx.world, ctx.person.id, m.id)) * 0.05);
      ctx.pickedMate = mate;
      if (!mate) return `Un coéquipier quitte l'équipe. L'annonce tombe sans prévenir.`;
      const rel = relationValue(ctx.world, ctx.person.id, mate.id);
      const s = ctx.situation;
      const base = rel > 40
        ? `${mate.nick} vous appelle avant tout le monde : il part. Il a signé ailleurs. Il voulait que vous l'appreniez de lui.`
        : `${mate.nick} quitte l'équipe. L'annonce tombe sur les réseaux avant que le vestiaire en soit informé.`;
      // Un départ ouvre une place. Un remplaçant y pense immédiatement.
      if (s.surLeBanc) return `${base} Une place se libère. Vous n’osez pas encore y penser tout à fait.`;
      return base;
    },
    choices: [
      {
        id: 'support',
        label: 'Lui souhaiter bonne chance',
        hint: (ctx) => selon(ctx.situation.surLeBanc, 'Rester correct, même si cela vous arrange', 'Rester en bons termes'),
        apply: (ctx) => {
          const mate = ctx.pickedMate;
          if (!mate) return 'Le départ se fait sans vous.';
          const s = ctx.situation;
          ctx.fx.relation(mate.id, 10, `${mate.nick} a quitté l'équipe, vous êtes restés proches.`, {
            tag: REL_TAGS.EX_TEAMMATE,
            important: true,
          });
          ctx.fx.synergy(-3);
          // Perdre un coéquipier ne pèse pas pareil selon ce qu'on perd. Un
          // remplaçant perd un concurrent autant qu'un camarade.
          if (s.surLeBanc) {
            ctx.fx.morale(1);
            return 'Vous lui souhaitez bonne route. Vous le pensez. Vous pensez aussi à sa place.';
          }
          ctx.fx.morale(-4);
          return 'Vous lui souhaitez bonne route. Vous le pensez.';
        },
      },
      {
        id: 'claim',
        label: 'Aller voir le staff pour prendre sa place',
        hint: 'Se proposer, tout de suite, avant les autres',
        // Cela n'a de sens que pour quelqu'un qui n'a pas la place et qui a
        // quelqu'un à qui la demander.
        available: (ctx) => ctx.situation.surLeBanc && ctx.situation.aUnCoach,
        apply: (ctx) => {
          const s = ctx.situation;
          const coach = ctx.world.persons[ctx.team.coachId];
          const strength = teamStrength(ctx.world, ctx.team, { forMatch: false });
          // Le staff écoute un joueur qui n'est pas loin du niveau, et qui n'est
          // pas en train de s'effondrer.
          const credible = ctx.rating >= strength.individual - 7 && !s.enDifficulte && !s.enConvalescence;
          ctx.fx.relation(coach?.id, credible ? 6 : -4, credible
            ? 'Il est venu se proposer au bon moment.'
            : 'Il est venu se proposer alors qu’il n’était pas prêt.');
          if (credible) {
            ctx.fx.morale(6).rep('pros', 2);
            ctx.fx.log('Candidature au poste laissé vacant.', { kind: 'team' });
            return 'Vous allez le voir le soir même. Il ne promet rien, mais il écoute.';
          }
          ctx.fx.morale(-6).stress(5);
          return 'Vous allez le voir le soir même. Il vous rappelle gentiment vos dernières sorties.';
        },
      },
      {
        id: 'resent',
        label: 'Mal le prendre',
        hint: 'Vous n’avez pas envie de faire semblant',
        apply: (ctx) => {
          const mate = ctx.pickedMate;
          if (!mate) return 'Le départ se fait sans vous.';
          const s = ctx.situation;
          ctx.fx.relation(mate.id, -18, `Vous avez mal vécu le départ de ${mate.nick}.`, {
            tag: REL_TAGS.EX_TEAMMATE,
            important: true,
          });
          ctx.fx.synergy(-5);
          // Le ressentiment coûte plus cher quand on est déjà mal.
          ctx.fx.morale(s.aBout || s.enDifficulte ? -10 : -7);
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
