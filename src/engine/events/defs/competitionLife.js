/**
 * La vie de compétiteur (étape 10A, seconde série).
 *
 * POURQUOI UNE SECONDE SÉRIE
 * --------------------------
 * La première a fait tomber la domination d'un seul événement — `game_switch_offer`
 * passait de 50 % d'éligibilité à 4 % — et aplati la distribution. Mais la
 * somme des éligibilités ne faisait encore que 190 %, soit moins de deux
 * candidats par tirage en moyenne : le moteur choisissait encore rarement.
 *
 * Ce fichier vise les états que le catalogue couvrait mal, mesurés un par un :
 * la vie en équipe selon le niveau de la structure, les jours de match, le
 * métier quand il est devenu un métier (salaire, contrat, staff), et la fin de
 * parcours d'un vétéran.
 *
 * Même règle que la première série : les conditions restent adossées à l'état.
 * Elles sont larges parce que ces situations arrivent largement.
 */

import { STATUS } from '../../person.js';
import { SAISON_DE_VIE, VISIBILITE } from '../situation.js';
import { clamp } from '../../rng.js';

const enActivite = (ctx) => ctx.person.status !== STATUS.RETIRED;
const aDesCoequipiers = (ctx) =>
  !!ctx.team?.roster?.some((id) => id !== ctx.person.id && ctx.world.persons[id]);

function unCoequipier(ctx) {
  const autres = (ctx.team?.roster ?? [])
    .filter((id) => id !== ctx.person.id)
    .map((id) => ctx.world.persons[id])
    .filter(Boolean);
  return autres.length ? ctx.rng.pick(autres) : null;
}

/**
 * Ces scènes sont le FOND de la carrière, pas ses moments (étape 10A).
 *
 * Elles doivent être très souvent ÉLIGIBLES — c'est ce qui donne au moteur de
 * quoi choisir — mais peser peu. Sans ce facteur, mesuré : trente événements
 * ordinaires à poids 2,5 pèsent 75 face à une scène importante à 9, et cette
 * dernière perd la plupart du temps. Le test « le système produit des
 * trajectoires sociales différentes » est tombé exactement là-dessus : plus
 * aucune amitié forte ne se formait, parce que les scènes de vestiaire ne
 * passaient plus jamais.
 *
 * Elles remplissent donc les semaines où rien d'important ne se joue, et
 * s'effacent quand quelque chose se joue.
 */
const FOND = 0.3;

export const competitionLifeEvents = [
  {
    id: 'veille_de_match',
    tags: ['compétition', 'mental'],
    cooldown: 26,
    condition: (ctx) => enActivite(ctx) && ctx.hasTeam && ctx.person.stats.matches > 2,
    weight: (ctx) => FOND * (clamp(2.6 + (ctx.situation.structureExigeante ? 1 : 0), 1, 4)),
    title: 'La veille',
    text: (ctx) =>
      ctx.situation.structureExigeante
        ? `Match demain. À ce niveau-là, on ne joue plus seulement un match.`
        : `Match demain. Vous connaissez l'adversaire, ou vous croyez le connaître.`,
    choices: [
      {
        id: 'preparer',
        label: 'Préparer l’adversaire',
        hint: 'Des heures de VOD au lieu de dormir',
        apply: (ctx) => {
          ctx.fx.group('gameSense', 0.8).fatigue(5).attr('anticipation', 0.7);
          return 'Vous connaissez leurs habitudes par cœur. Reste à savoir s’ils les garderont.';
        },
      },
      {
        id: 'staff',
        available: (ctx) => !!ctx.team?.coachId,
        label: 'Demander le plan au coach',
        hint: 'S’en remettre à quelqu’un dont c’est le métier',
        apply: (ctx) => {
          ctx.fx.group('gameSense', 0.5).synergy(3).attr('teamwork', 0.6).stress(-4);
          return 'Le coach vous donne trois consignes claires. C’est reposant d’avoir un plan.';
        },
      },
      {
        id: 'dormir',
        label: 'Dormir tôt',
        hint: 'Arriver frais compte aussi',
        apply: (ctx) => {
          ctx.fx.fatigue(-8).form(2).attr('professionalism', 0.6);
          return 'Vous arrivez reposé. C’est un avantage qu’on sous-estime.';
        },
      },
    ],
  },

  {
    id: 'debrief',
    tags: ['équipe', 'compétition'],
    cooldown: 30,
    condition: (ctx) => enActivite(ctx) && ctx.hasTeam && aDesCoequipiers(ctx) && ctx.person.stats.matches > 5,
    weight: (ctx) => FOND * (2.5),
    title: 'Le débrief',
    text: (ctx) => {
      const c = ctx.picked?.coequipier;
      return c
        ? `On repasse la partie. ${c.nick} a une lecture différente de la vôtre sur le moment qui a compté.`
        : `On repasse la partie. Chacun a sa version du moment qui a compté.`;
    },
    pick: (ctx) => ({ coequipier: unCoequipier(ctx) }),
    choices: [
      {
        id: 'defendre',
        label: 'Défendre votre lecture',
        hint: 'Vous pensez avoir raison',
        apply: (ctx) => {
          const c = ctx.picked?.coequipier;
          ctx.fx.attr('communication', 0.7).attr('selfConfidence', 0.6).synergy(-2);
          if (c) ctx.fx.relation(c.id, -4, 'Désaccord en débrief.');
          return 'Vous tenez votre position. Le débrief dure vingt minutes de plus.';
        },
      },
      {
        id: 'ecouter',
        label: 'Écouter la sienne',
        hint: 'Vous n’aviez peut-être pas tout vu',
        apply: (ctx) => {
          const c = ctx.picked?.coequipier;
          ctx.fx.group('gameSense', 0.5).synergy(3).attr('teamwork', 0.7);
          if (c) ctx.fx.relation(c.id, 5, 'Vous avez écouté en débrief.');
          return 'Il avait vu quelque chose que vous n’aviez pas vu. C’est désagréable et utile.';
        },
      },
    ],
  },

  {
    id: 'jour_sans',
    tags: ['compétition', 'mental'],
    cooldown: 34,
    condition: (ctx) => enActivite(ctx) && ctx.hasTeam && ctx.person.form < 0 && ctx.person.stats.matches > 8,
    weight: (ctx) => FOND * (clamp(2 + (ctx.situation.enDifficulte ? 2 : 0), 1, 4)),
    title: 'Un jour sans',
    text: () =>
      `Vous avez été le maillon faible aujourd'hui. Tout le monde l'a vu, personne n'en parle.`,
    choices: [
      {
        id: 'assumer',
        label: 'Le dire vous-même',
        hint: 'Prendre les devants',
        apply: (ctx) => {
          ctx.fx.synergy(4).attr('professionalism', 0.9).morale(-2).rep('pros', 2);
          return 'Vous le dites avant qu’on vous le dise. Le vestiaire s’en souviendra.';
        },
      },
      {
        id: 'public',
        available: (ctx) => ctx.person.followers > 8000,
        label: 'Le reconnaître publiquement',
        hint: 'Devant tout le monde, pas seulement l’équipe',
        apply: (ctx) => {
          ctx.fx.rep('community', 5).rep('public', 2).rep('pros', -1).morale(-3);
          return 'Vous le dites publiquement. La moitié trouve ça digne, l’autre y voit une faiblesse.';
        },
      },
      {
        id: 'silence',
        label: 'Ne rien dire',
        hint: 'Ça passera',
        apply: (ctx) => {
          ctx.fx.stress(6).morale(-4);
          return 'Personne n’en parle. Ça reste quand même dans la pièce.';
        },
      },
    ],
  },

  {
    id: 'demande_du_staff',
    tags: ['équipe'],
    cooldown: 46,
    condition: (ctx) => enActivite(ctx) && ctx.hasTeam && !!ctx.team?.coachId,
    weight: (ctx) => FOND * (clamp(2 + (ctx.situation.structureExigeante ? 1.2 : 0), 1, 3.6)),
    title: 'Ce qu’on vous demande',
    text: () =>
      `Le staff veut que vous jouiez autrement. Pas mieux — autrement. Ce n'est pas la même chose.`,
    choices: [
      {
        id: 'obeir',
        label: 'Faire ce qu’on vous demande',
        hint: 'Le collectif d’abord',
        apply: (ctx) => {
          ctx.fx.synergy(5).attr('teamwork', 0.9).attr('adaptation', 0.7).morale(-3);
          return 'Vous jouez leur plan. Ce n’est pas votre jeu, et l’équipe tourne mieux.';
        },
      },
      {
        id: 'discuter',
        label: 'Argumenter',
        hint: 'Vous avez des raisons',
        risky: true,
        apply: (ctx) => {
          ctx.fx.attr('communication', 0.8).attr('leadership', 0.6);
          if (ctx.rng.chance(0.45)) {
            ctx.fx.synergy(3).rep('pros', 3);
            return 'Vous êtes entendu. Le plan est ajusté, un peu.';
          }
          ctx.fx.synergy(-4).stress(6);
          return 'On vous écoute poliment, et rien ne change. Sauf la façon dont on vous regarde.';
        },
      },
    ],
  },

  {
    id: 'premiere_paie',
    tags: ['argent', 'vie'],
    cooldown: 999,
    once: true,
    condition: (ctx) => enActivite(ctx) && (ctx.person.contract?.salary ?? 0) > 0,
    weight: (ctx) => FOND * (6),
    title: 'Le premier virement',
    text: (ctx) =>
      `De l'argent est arrivé sur votre compte parce que vous avez joué. C'est la première fois.`,
    choices: [
      {
        id: 'garder',
        label: 'Ne rien changer',
        hint: 'Vivre comme avant',
        apply: (ctx) => {
          ctx.fx.morale(6).attr('discipline', 0.8).flag('sobre', true);
          return 'Vous continuez à vivre exactement comme avant. L’argent s’accumule.';
        },
      },
      {
        id: 'fêter',
        label: 'Marquer le coup',
        hint: 'Ça se fête une fois',
        apply: (ctx) => {
          ctx.fx.money(-700).morale(10).stress(-8);
          return 'Vous invitez tout le monde. Ça n’arrive qu’une fois.';
        },
      },
    ],
  },

  {
    id: 'routine_installee',
    tags: ['vie', 'jeu'],
    cooldown: 60,
    condition: (ctx) => enActivite(ctx) && ctx.person.stats.seasonsPro >= 2,
    weight: (ctx) => FOND * (2.2),
    title: 'La routine',
    text: () =>
      `Vous faites la même chose depuis deux ans. Ça marche. C'est peut-être le problème.`,
    choices: [
      {
        id: 'changer',
        label: 'Tout casser et recommencer autrement',
        hint: 'On perd avant de gagner',
        risky: true,
        apply: (ctx) => {
          ctx.fx.stress(8).group('mechanical', -0.6);
          ctx.fx.later('discipline_noticed', 30, { source: 'refonte' });
          ctx.fx.attr('adaptation', 1.4).attr('learning', 1);
          return 'Vous démontez tout. Les prochaines semaines seront mauvaises.';
        },
      },
      {
        id: 'garder',
        label: 'Continuer',
        hint: 'Ne pas casser ce qui marche',
        apply: (ctx) => {
          ctx.fx.attr('consistency', 1).attr('discipline', 0.6).morale(2);
          return 'Vous gardez vos habitudes. Elles vous ont menés là.';
        },
      },
    ],
  },

  {
    id: 'jeune_qui_monte',
    tags: ['scène', 'mental'],
    cooldown: 52,
    condition: (ctx) => enActivite(ctx) && ctx.situation.saisonDeVie !== SAISON_DE_VIE.ESPOIR,
    weight: (ctx) => FOND * (clamp(1.8 + (ctx.situation.saisonDeVie === SAISON_DE_VIE.VETERAN ? 1.6 : 0), 1, 3.6)),
    title: 'Il a dix-sept ans',
    text: () =>
      `Un joueur de dix-sept ans fait des choses que vous ne faites plus. Ou que vous n'avez jamais faites.`,
    choices: [
      {
        id: 'apprendre',
        label: 'Regarder comment il fait',
        hint: 'Il n’y a pas d’âge',
        apply: (ctx) => {
          ctx.fx.attr('learning', 1).group('mechanical', 0.5).morale(-2);
          return 'Vous passez une soirée sur ses parties. Il y a deux ou trois choses à prendre.';
        },
      },
      {
        id: 'relativiser',
        label: 'Se rappeler ce que vous savez',
        hint: 'Il ne sait pas encore ce que vous savez',
        apply: (ctx) => {
          ctx.fx.attr('composure', 0.9).attr('selfConfidence', 0.7).morale(3);
          return 'Il a des mains. Vous avez dix ans de lecture. Ce n’est pas le même métier.';
        },
      },
    ],
  },

  {
    id: 'sollicitation_communaute',
    tags: ['médias', 'réseau'],
    cooldown: 44,
    condition: (ctx) => enActivite(ctx) && ctx.person.reputation.community > 12,
    weight: (ctx) => FOND * (clamp(1.6 + ctx.person.reputation.community / 45, 1, 3.4)),
    title: 'On vous demande quelque chose',
    text: () =>
      `Un petit tournoi communautaire cherche une tête d'affiche. Ce n'est pas payé et ça prend un week-end.`,
    choices: [
      {
        id: 'venir',
        label: 'Y aller',
        hint: 'Ce sont eux qui vous ont suivi les premiers',
        apply: (ctx) => {
          ctx.fx.rep('community', 6).rep('public', 3).followers(900).fatigue(6);
          return 'Vous y allez. Trois cents personnes, et une ambiance que les grands tournois n’ont plus.';
        },
      },
      {
        id: 'decliner',
        label: 'Décliner poliment',
        hint: 'Le week-end servira à s’entraîner',
        apply: (ctx) => {
          ctx.fx.rep('community', -3).group('mechanical', 0.6);
          return 'Vous déclinez. Ils comprennent, disent-ils.';
        },
      },
    ],
  },

  {
    id: 'meta_qui_glisse',
    tags: ['jeu', 'méta'],
    cooldown: 40,
    condition: (ctx) => enActivite(ctx) && ctx.person.stats.matches > 20,
    weight: (ctx) => FOND * (clamp(1.6 + (ctx.person.metaShock ?? 0) * 0.4, 1, 3.4)),
    title: 'Ça ne marche plus comme avant',
    text: (ctx) =>
      `Ce qui fonctionnait sur ${ctx.game.name} il y a six mois fonctionne moins bien. Personne n'a annoncé le changement.`,
    choices: [
      {
        id: 'suivre',
        label: 'Suivre le mouvement',
        hint: 'Faire comme ceux qui gagnent',
        apply: (ctx) => {
          ctx.fx.attr('metaSense', 1).attr('adaptation', 0.8).group('gameSense', 0.4);
          return 'Vous copiez ce qui marche. C’est efficace et un peu triste.';
        },
      },
      {
        id: 'chercher',
        label: 'Chercher autre chose',
        hint: 'Trouver avant les autres, ou se tromper',
        risky: true,
        apply: (ctx) => {
          ctx.fx.attr('creativity', 1.2).stress(5);
          if (ctx.rng.chance(0.35)) {
            ctx.fx.rep('pros', 5).attr('metaSense', 1.2).flag('cherche_meta', true);
            return 'Vous tombez sur quelque chose que personne ne joue. Pour l’instant.';
          }
          ctx.fx.form(-3);
          return 'Vous cherchez pendant trois semaines et vous ne trouvez rien. Le classement en pâtit.';
        },
      },
    ],
  },

  {
    id: 'invitation_exhibition',
    tags: ['compétition', 'médias'],
    cooldown: 56,
    condition: (ctx) => enActivite(ctx) && ctx.situation.visibilite !== VISIBILITE.INCONNU,
    weight: (ctx) => FOND * (clamp(1.4 + ctx.person.reputation.public / 40, 1, 3.2)),
    title: 'Un match d’exhibition',
    text: () =>
      `On vous propose un match sans enjeu, devant du public. Ce n'est pas de la compétition, c'est du spectacle.`,
    choices: [
      {
        id: 'jouer',
        label: 'Y aller et s’amuser',
        hint: 'Se montrer sans rien risquer',
        apply: (ctx) => {
          ctx.fx.rep('public', 5).followers(2200).attr('entertainment', 0.9).fatigue(4).morale(4);
          return 'Vous vous amusez, ce qui ne vous était pas arrivé depuis un moment.';
        },
      },
      {
        id: 'refuser',
        label: 'Refuser',
        hint: 'Rien à y gagner sportivement',
        apply: (ctx) => {
          ctx.fx.rep('pros', 2).group('gameSense', 0.5);
          return 'Vous restez à l’entraînement. Personne ne vous en tiendra rigueur, sauf les organisateurs.';
        },
      },
    ],
  },

  {
    id: 'fin_de_saison',
    tags: ['compétition', 'mental'],
    cooldown: 48,
    condition: (ctx) => enActivite(ctx) && ctx.person.stats.seasonsPro >= 1,
    weight: (ctx) => FOND * (2.2),
    title: 'La saison est finie',
    text: () =>
      `Plus de match avant plusieurs semaines. Le vide après la tension, c'est un moment étrange.`,
    choices: [
      {
        id: 'couper',
        label: 'Couper complètement',
        hint: 'Ne pas toucher au jeu',
        apply: (ctx) => {
          ctx.fx.fatigue(-16).stress(-12).morale(6).group('mechanical', -0.4);
          return 'Vous ne lancez pas le jeu pendant deux semaines. Le retour sera difficile et vous serez neuf.';
        },
      },
      {
        id: 'partir',
        available: (ctx) => ctx.career.money > 4000,
        label: 'Partir loin, sans ordinateur',
        hint: 'Coûteux, et radical',
        apply: (ctx) => {
          ctx.fx.money(-2200).fatigue(-24).stress(-20).morale(12).group('mechanical', -0.8);
          return 'Trois semaines sans écran. Vous ne saviez plus que ça existait.';
        },
      },
      {
        id: 'avancer',
        label: 'Prendre de l’avance',
        hint: 'Travailler pendant que les autres soufflent',
        apply: (ctx) => {
          ctx.fx.group('mechanical', 1).group('gameSense', 0.6).fatigue(6).stress(3);
          return 'Vous travaillez pendant l’intersaison. En janvier, ça se verra.';
        },
      },
    ],
  },

  {
    id: 'question_apres',
    tags: ['vie', 'mental'],
    cooldown: 70,
    condition: (ctx) => enActivite(ctx) && ctx.situation.saisonDeVie === SAISON_DE_VIE.VETERAN,
    weight: (ctx) => FOND * (2.6),
    title: 'Et après ?',
    text: () =>
      `Vous avez plus de carrière derrière que devant. La question ne se pose pas encore vraiment. Elle se pose un peu.`,
    choices: [
      {
        id: 'preparer',
        label: 'Commencer à préparer la suite',
        hint: 'Du temps pris sur le jeu',
        apply: (ctx) => {
          ctx.fx.attr('communication', 0.8).attr('professionalism', 0.9).rep('pros', 3);
          ctx.fx.group('mechanical', -0.3).stress(-5);
          return 'Vous commencez à regarder ailleurs, sans rien lâcher. C’est plus reposant que prévu.';
        },
      },
      {
        id: 'transmettre',
        available: (ctx) => ctx.person.reputation.pros > 45,
        label: 'Commencer à transmettre',
        hint: 'On vous écoute déjà dans le milieu',
        apply: (ctx) => {
          ctx.fx.attr('leadership', 1.2).attr('motivation', 0.8).rep('pros', 5);
          return 'Vous prenez un jeune sous le bras. C’est la première fois que vous expliquez au lieu de faire.';
        },
      },
      {
        id: 'jouer',
        label: 'Jouer tant que ça dure',
        hint: 'Il sera toujours temps',
        apply: (ctx) => {
          ctx.fx.group('mechanical', 0.8).morale(4).flag('jusquau_bout', true);
          return 'Vous remettez la question à plus tard. Ce n’est pas de la lâcheté, c’est un choix.';
        },
      },
    ],
  },

  {
    id: 'joueur_ecarte',
    tags: ['équipe', 'mental'],
    cooldown: 50,
    condition: (ctx) => enActivite(ctx) && ctx.hasTeam && aDesCoequipiers(ctx),
    weight: (ctx) => FOND * (1.8),
    title: 'Quelqu’un va sauter',
    text: (ctx) => {
      const c = ctx.picked?.coequipier;
      return c
        ? `Le bruit court que ${c.nick} ne sera plus là la saison prochaine. Il ne le sait pas encore.`
        : `Le bruit court qu'un joueur ne sera plus là la saison prochaine. Il ne le sait pas encore.`;
    },
    pick: (ctx) => ({ coequipier: unCoequipier(ctx) }),
    choices: [
      {
        id: 'prevenir',
        label: 'Le prévenir',
        hint: 'Il vaut mieux qu’il l’apprenne par vous',
        risky: true,
        apply: (ctx) => {
          const c = ctx.picked?.coequipier;
          if (c) ctx.fx.relation(c.id, 14, 'Vous l’avez prévenu avant tout le monde.', { important: true });
          ctx.fx.attr('trustBuilding', 1);
          if (ctx.rng.chance(0.4)) {
            ctx.fx.rep('pros', -4).synergy(-4);
            return 'Il vous croit. Le staff apprend d’où venait la fuite.';
          }
          return 'Il vous croit, et il ne dira jamais d’où il le tient.';
        },
      },
      {
        id: 'taire',
        label: 'Ne rien dire',
        hint: 'Ce n’est pas à vous de l’annoncer',
        apply: (ctx) => {
          ctx.fx.stress(4).attr('composure', 0.5);
          return 'Vous ne dites rien. Il l’apprendra trois semaines plus tard, en réunion.';
        },
      },
    ],
  },

  {
    id: 'reconnu_dehors',
    tags: ['médias', 'vie'],
    cooldown: 60,
    condition: (ctx) => enActivite(ctx) && ctx.person.followers > 25000,
    weight: (ctx) => FOND * (clamp(1.2 + ctx.person.followers / 400000, 1, 3)),
    title: 'Dans la rue',
    text: () =>
      `Quelqu'un vous reconnaît dans un endroit où vous ne vous y attendiez pas. C'est agréable et un peu déstabilisant.`,
    choices: [
      {
        id: 'accueillir',
        label: 'Prendre le temps',
        hint: 'Ces gens-là font votre carrière',
        apply: (ctx) => {
          ctx.fx.rep('community', 4).rep('public', 2).followers(600).attr('charisma', 0.6);
          return 'Vous discutez dix minutes. Il en parlera pendant des mois.';
        },
      },
      {
        id: 'ecourter',
        label: 'Écourter poliment',
        hint: 'Vous étiez là pour autre chose',
        apply: (ctx) => {
          ctx.fx.rep('community', -2).stress(-2);
          return 'Vous saluez et vous partez. Vous n’êtes pas en service.';
        },
      },
    ],
  },
];
