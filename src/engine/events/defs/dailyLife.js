/**
 * La vie ordinaire d'un joueur (étape 10A).
 *
 * LE DÉFAUT QUE CE FICHIER CORRIGE
 * --------------------------------
 * Mesuré sur 673 tirages : le moteur n'avait qu'UN seul candidat éligible dans
 * 40 % des cas, et trois ou moins dans 98 %. La graine ne faisait donc que
 * permuter l'ordre de deux ou trois événements, et deux carrières différentes
 * traversaient les mêmes situations. C'est exactement ce qu'un joueur a
 * remarqué en entamant deux parties.
 *
 * La cause n'était pas un bug de tirage : les conditions du catalogue sont
 * justes, mais si étroites qu'à tout instant presque rien ne s'y qualifie. Avec
 * 27 événements tirables pour une carrière de dix-sept ans, le moteur ne
 * choisissait pas — il jouait le seul disponible.
 *
 * CE QUI EST ÉCRIT ICI, ET COMMENT
 * --------------------------------
 * Des situations ORDINAIRES, celles qui peuvent arriver dans beaucoup d'états
 * différents : une soirée qu'on sacrifie, un message qu'on reçoit, une manière
 * de jouer qu'on choisit. Elles ne racontent pas de grands moments — le
 * catalogue en avait déjà — elles remplissent les semaines entre eux.
 *
 * Leurs conditions restent adossées à l'état réel : elles sont larges parce que
 * ces situations ARRIVENT largement, pas parce qu'on a desserré un garde-fou.
 * Une condition qu'on élargit sans raison ferait apparaître des scènes qui ne
 * correspondent à rien, et ce serait pire que la répétition.
 */

import { STATUS } from '../../person.js';
import { selon, SAISON_DE_VIE } from '../situation.js';
import { clamp } from '../../rng.js';

/** Un coéquipier au hasard, ou `null`. Sert aux scènes de vestiaire. */
function unCoequipier(ctx) {
  if (!ctx.team?.roster) return null;
  const autres = ctx.team.roster
    .filter((id) => id !== ctx.person.id)
    .map((id) => ctx.world.persons[id])
    .filter(Boolean);
  return autres.length ? ctx.rng.pick(autres) : null;
}

/** Actif, pas retraité : le socle commun de toutes ces scènes. */
const enActivite = (ctx) => ctx.person.status !== STATUS.RETIRED;

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

export const dailyLifeEvents = [
  {
    id: 'nuit_blanche',
    tags: ['jeu', 'santé'],
    cooldown: 34,
    // Il faut avoir de quoi s'entraîner et ne pas être déjà à terre : pousser
    // quand on est au bout est une autre scène, déjà écrite.
    condition: (ctx) => enActivite(ctx) && !ctx.situation.aBout && ctx.person.fatigue < 78,
    weight: (ctx) => FOND * (clamp(2.4 + (ctx.situation.enDifficulte ? 1.6 : 0), 1, 4)),
    title: 'Trois heures du matin',
    text: (ctx) =>
      ctx.situation.enDifficulte
        ? `Vous n'arrivez plus à gagner. Il est trois heures, vous avez classement en berne et l'impression que la prochaine partie sera la bonne. Elle ne l'est jamais.`
        : `Une partie de plus, et vous vous couchez. Vous vous dites ça depuis une heure et demie.`,
    choices: [
      {
        id: 'encore',
        label: 'Encore une',
        hint: 'Du travail en plus, du sommeil en moins',
        apply: (ctx) => {
          ctx.fx.group('mechanical', 0.7).fatigue(9).stress(3);
          return 'Vous fermez le client à cinq heures. La séance de demain sera difficile.';
        },
      },
      {
        id: 'appeler',
        // N'existe que si quelqu'un peut décrocher : un joueur sans équipe et
        // sans entourage n'a personne à appeler à trois heures du matin.
        available: (ctx) => ctx.hasTeam,
        label: 'Réveiller un coéquipier pour jouer à deux',
        hint: 'Moins efficace, beaucoup moins seul',
        apply: (ctx) => {
          ctx.fx.group('mechanical', 0.4).synergy(3).morale(5).fatigue(7);
          return 'Vous jouez à deux jusqu’à l’aube. Le classement n’avance pas, l’équipe si.';
        },
      },
      {
        id: 'couper',
        label: 'Éteindre',
        hint: 'Vous serez frais demain',
        apply: (ctx) => {
          ctx.fx.fatigue(-6).morale(2).attr('discipline', 0.8);
          return 'Vous éteignez. Ce n’est pas grand-chose, mais c’est une décision.';
        },
      },
    ],
  },

  {
    id: 'message_inconnu',
    tags: ['réseau', 'médias'],
    cooldown: 40,
    // Un joueur de classement croise du monde sans jouer un seul match
    // officiel : c'est le nombre de semaines passées à jouer qui compte.
    condition: (ctx) => enActivite(ctx) && ctx.career.counters.weeks > 3,
    weight: (ctx) => FOND * (clamp(1.6 + ctx.person.reputation.public / 40, 1, 3.6)),
    title: 'Un message',
    text: () =>
      `Quelqu'un vous écrit. Il joue, il est moins bon que vous, il a des questions. Beaucoup de questions.`,
    choices: [
      {
        id: 'repondre',
        label: 'Prendre le temps de répondre',
        hint: 'Ça ne rapporte rien d’immédiat',
        apply: (ctx) => {
          ctx.fx.rep('community', 3).attr('communication', 0.6).morale(2);
          return 'Vous répondez longuement. Il vous remerciera encore dans deux ans.';
        },
      },
      {
        id: 'publier',
        // Répondre publiquement suppose qu'il y ait un public.
        available: (ctx) => ctx.person.followers > 3000,
        label: 'En faire un contenu public',
        hint: 'Sa question intéressera d’autres gens',
        apply: (ctx) => {
          ctx.fx.followers(1400).rep('community', 4).attr('storytelling', 0.7).fatigue(3);
          return 'Vous en faites une vidéo. Elle marche mieux que vos parties.';
        },
      },
      {
        id: 'ignorer',
        label: 'Laisser passer',
        hint: 'Vous avez autre chose à faire',
        apply: (ctx) => {
          ctx.fx.group('mechanical', 0.3);
          return 'Vous retournez à votre partie. Le message reste sans réponse.';
        },
      },
    ],
  },

  {
    id: 'style_de_jeu',
    tags: ['jeu', 'identité'],
    cooldown: 60,
    condition: (ctx) => enActivite(ctx) && ctx.career.counters.weeks > 6,
    weight: (ctx) => FOND * (2.2),
    title: 'Votre manière de jouer',
    text: (ctx) =>
      `On commence à reconnaître votre façon de jouer sur ${ctx.game.name}. Ce n'est pas encore un style, mais ça y ressemble.`,
    choices: [
      {
        id: 'affirmer',
        label: 'L’assumer complètement',
        hint: 'Ce qui vous distingue vous rend aussi lisible',
        apply: (ctx) => {
          ctx.fx.attr('creativity', 1).rep('pros', 2).flag('style_affirme', true);
          return 'Vous jouez ce que vous êtes. Les adversaires apprendront à s’y préparer.';
        },
      },
      {
        id: 'elargir',
        label: 'Apprendre à jouer autrement',
        hint: 'Moins tranché, plus difficile à contrer',
        apply: (ctx) => {
          ctx.fx.attr('adaptation', 1).group('gameSense', 0.4).stress(3);
          return 'Vous travaillez ce que vous ne savez pas faire. C’est ingrat et ça paiera plus tard.';
        },
      },
    ],
  },

  {
    id: 'defaite_qui_reste',
    tags: ['mental', 'jeu'],
    cooldown: 30,
    // Une défaite ne marque que si elle comptait un peu.
    condition: (ctx) => enActivite(ctx) && ctx.person.stats.matches > 6 && ctx.person.form < 2,
    weight: (ctx) => FOND * (clamp(2 + (ctx.situation.enDifficulte ? 2 : 0), 1, 4)),
    title: 'Celle-là ne passe pas',
    text: () =>
      `Vous rejouez la partie dans votre tête. Le moment précis où ça a basculé, et ce que vous auriez dû faire.`,
    choices: [
      {
        id: 'revoir',
        label: 'La revoir en entier',
        hint: 'Comprendre au lieu de ruminer',
        apply: (ctx) => {
          ctx.fx.group('gameSense', 0.8).attr('focus', 0.5).stress(2);
          return 'Vous trouvez l’erreur à la douzième minute. Elle n’était pas où vous croyiez.';
        },
      },
      {
        id: 'partager',
        available: (ctx) => ctx.hasTeam,
        label: 'En parler à l’équipe',
        hint: 'Ils l’ont vécue aussi',
        apply: (ctx) => {
          ctx.fx.synergy(4).morale(3).attr('communication', 0.6).stress(-3);
          return 'Vous en parlez ensemble. Ce n’était pas que votre erreur.';
        },
      },
      {
        id: 'tourner',
        label: 'Passer à autre chose',
        hint: 'Ne pas s’enfermer dedans',
        apply: (ctx) => {
          ctx.fx.morale(4).stress(-5);
          return 'Vous fermez la fenêtre. Demain est un autre jour de classement.';
        },
      },
    ],
  },

  {
    id: 'proche_inquiet',
    tags: ['vie', 'mental'],
    cooldown: 70,
    condition: (ctx) => enActivite(ctx) && ctx.situation.saisonDeVie !== SAISON_DE_VIE.VETERAN,
    weight: (ctx) => FOND * (clamp(1.4 + (ctx.situation.fauche ? 2 : 0) + (ctx.situation.sansEquipe ? 1.2 : 0), 1, 4)),
    title: 'La question',
    text: (ctx) =>
      ctx.situation.fauche
        ? `« Et si ça ne marche pas ? » On vous l'a demandé gentiment. Ça ne rend pas la question plus facile.`
        : `« Tu comptes faire ça longtemps ? » Ce n'est pas un reproche. C'est pire, c'est une vraie question.`,
    choices: [
      {
        id: 'defendre',
        label: 'Défendre votre choix',
        hint: 'Vous y croyez, dites-le',
        apply: (ctx) => {
          ctx.fx.morale(5).attr('resilience', 0.7).stress(2);
          return 'Vous expliquez. Vous n’êtes pas sûr d’avoir convaincu, mais vous vous êtes convaincu vous-même.';
        },
      },
      {
        id: 'douter',
        label: 'Admettre que vous n’en savez rien',
        hint: 'C’est honnête, et ça coûte',
        apply: (ctx) => {
          ctx.fx.morale(-6).attr('composure', 0.5);
          return 'Vous dites la vérité : vous n’en savez rien. Le silence qui suit dure longtemps.';
        },
      },
    ],
  },

  {
    id: 'seance_vide',
    tags: ['jeu', 'mental'],
    cooldown: 44,
    // `stats.matches` compte les matchs OFFICIELS. S'en servir ici était une
    // erreur : une séance d'entraînement qui ne donne rien arrive dès la
    // première semaine, et cette condition verrouillait la scène pendant tout
    // le début de carrière — là où le catalogue est justement le plus pauvre.
    condition: (ctx) => enActivite(ctx) && ctx.career.counters.weeks > 2,
    weight: (ctx) => FOND * (clamp(1.8 + (ctx.person.morale < 40 ? 1.8 : 0), 1, 3.8)),
    title: 'Rien ne rentre',
    text: () =>
      `Deux heures d'entraînement et pas une seule chose apprise. Ça arrive. Ça n'en est pas moins désagréable.`,
    choices: [
      {
        id: 'insister',
        label: 'Rester jusqu’à ce que ça vienne',
        hint: 'Parfois ça vient',
        apply: (ctx) => {
          ctx.fx.fatigue(6).stress(4).group('mechanical', 0.5);
          return 'Ça finit par venir, à la dernière demi-heure. Vous ne saurez jamais si ça valait le coup.';
        },
      },
      {
        id: 'autre_chose',
        available: (ctx) => (ctx.career.counters.gamesPlayed?.length ?? 1) > 1
          || ctx.person.followers > 1500,
        label: 'Faire complètement autre chose',
        hint: 'Sortir du jeu pour y revenir',
        apply: (ctx) => {
          ctx.fx.morale(6).stress(-7).attr('creativity', 0.6);
          return 'Vous passez la soirée ailleurs. Demain, la même situation vous paraîtra simple.';
        },
      },
      {
        id: 'arreter',
        label: 'Arrêter là',
        hint: 'S’acharner ne sert à rien',
        apply: (ctx) => {
          ctx.fx.morale(3).fatigue(-4).attr('timeManagement', 0.6);
          return 'Vous coupez au bout de deux heures. La séance de demain sera meilleure.';
        },
      },
    ],
  },

  {
    id: 'vestiaire_ordinaire',
    tags: ['équipe'],
    cooldown: 36,
    condition: (ctx) => enActivite(ctx) && ctx.hasTeam && !!unCoequipierPossible(ctx),
    weight: (ctx) => FOND * (2.4),
    title: 'Entre deux scrims',
    text: (ctx) => {
      const c = ctx.picked?.coequipier;
      return c
        ? `${c.nick} traîne dans le vocal après la session. Il ne parle pas du jeu.`
        : `Le vocal reste ouvert après la session. Personne ne raccroche vraiment.`;
    },
    pick: (ctx) => ({ coequipier: unCoequipier(ctx) }),
    choices: [
      {
        id: 'rester',
        label: 'Rester discuter',
        hint: 'Ce n’est pas du temps perdu',
        apply: (ctx) => {
          const c = ctx.picked?.coequipier;
          ctx.fx.synergy(2).morale(3);
          if (c) ctx.fx.relation(c.id, 6, 'Une conversation après la session.');
          return c
            ? `Vous parlez d'autre chose pendant une heure. C'est comme ça qu'une équipe se tient.`
            : `Vous restez. La conversation part ailleurs, et c'est très bien.`;
        },
      },
      {
        id: 'partir',
        label: 'Retourner travailler',
        hint: 'Le classement ne monte pas tout seul',
        apply: (ctx) => {
          ctx.fx.group('mechanical', 0.6).synergy(-1);
          return 'Vous relancez une file solo. Le vocal continue sans vous.';
        },
      },
    ],
  },

  {
    id: 'petit_boulot',
    tags: ['vie', 'argent'],
    cooldown: 52,
    // Une vraie tension d'argent, sans salaire pour l'absorber.
    condition: (ctx) => enActivite(ctx) && ctx.career.money < 2500 && !ctx.person.contract?.salary,
    weight: (ctx) => FOND * (clamp(2 + (ctx.situation.fauche ? 2.5 : 0), 1, 4.5)),
    title: 'Une proposition sans rapport',
    text: () =>
      `Un travail. Quelques heures par semaine, rien d'exaltant, mais de quoi ne plus compter chaque euro.`,
    choices: [
      {
        id: 'accepter',
        label: 'Accepter',
        hint: 'Du temps en moins, de l’air en plus',
        apply: (ctx) => {
          ctx.fx.money(2600).stress(-8).morale(3).fatigue(5);
          ctx.fx.attr('timeManagement', 0.8);
          return 'Vous acceptez. Douze heures par semaine en moins pour jouer, et une angoisse en moins.';
        },
      },
      {
        id: 'streamer',
        available: (ctx) => ctx.person.followers > 2000,
        label: 'Monétiser votre audience à la place',
        hint: 'Moins sûr, mais dans votre métier',
        apply: (ctx) => {
          const gain = Math.round(400 + Math.sqrt(ctx.person.followers) * 12);
          ctx.fx.money(gain).followers(700).fatigue(4).rep('public', 2);
          return `Vous streamez davantage. ${gain} € ce mois-ci, sans quitter le jeu.`;
        },
      },
      {
        id: 'refuser',
        label: 'Refuser',
        hint: 'Tout miser sur le jeu',
        risky: true,
        apply: (ctx) => {
          ctx.fx.stress(7).attr('resilience', 0.8).flag('tout_mise', true);
          return 'Vous refusez. Il faudra que ça marche.';
        },
      },
    ],
  },

  {
    id: 'comparaison',
    tags: ['mental', 'réseau'],
    cooldown: 48,
    condition: (ctx) => enActivite(ctx) && ctx.person.stats.matches > 15,
    weight: (ctx) => FOND * (clamp(1.6 + (ctx.situation.saisonDeVie === SAISON_DE_VIE.ESPOIR ? 1.4 : 0), 1, 3.4)),
    title: 'Quelqu’un de votre âge',
    text: (ctx) =>
      `Un joueur que vous croisiez au même niveau il y a un an vient de signer. Pas vous.`,
    choices: [
      {
        id: 'moteur',
        label: 'En faire un moteur',
        hint: 'La comparaison peut servir',
        apply: (ctx) => {
          ctx.fx.morale(-3).group('mechanical', 0.9).attr('workCapacity', 0.8);
          return 'Vous vous y remettez le soir même, un peu plus sérieusement qu’avant.';
        },
      },
      {
        id: 'ignorer',
        label: 'Ne pas se comparer',
        hint: 'Sa carrière n’est pas la vôtre',
        apply: (ctx) => {
          ctx.fx.morale(2).attr('composure', 0.9);
          return 'Vous lui écrivez pour le féliciter, sincèrement, et vous passez à autre chose.';
        },
      },
    ],
  },

  {
    id: 'materiel',
    tags: ['vie', 'jeu'],
    cooldown: 80,
    condition: (ctx) => enActivite(ctx) && ctx.career.money > 600,
    weight: (ctx) => FOND * (clamp(1.2 + (ctx.situation.fauche ? 0 : 0.8), 1, 2.4)),
    title: 'Le matériel lâche',
    text: () =>
      `Votre matériel donne des signes. Rien de bloquant, mais vous le sentez à chaque partie.`,
    choices: [
      {
        id: 'remplacer',
        label: 'Remplacer maintenant',
        hint: 'Ça coûte, et ça se sent',
        apply: (ctx) => {
          ctx.fx.money(-900).group('mechanical', 0.7).stress(-3);
          return 'Vous investissez. La différence est réelle, même si elle est petite.';
        },
      },
      {
        id: 'tenir',
        label: 'Faire durer',
        hint: 'Économiser, et s’en accommoder',
        apply: (ctx) => {
          ctx.fx.stress(4).attr('adaptation', 0.6);
          return 'Vous faites avec. On s’habitue à tout, y compris à ce qui nous ralentit.';
        },
      },
    ],
  },
  // --- LES TOUTES PREMIÈRES SEMAINES -----------------------------------------
  //
  // Mesuré après la première série : à la deuxième décision d'une carrière, le
  // moteur n'avait encore que trois événements possibles. Un débutant sans
  // équipe, sans match et sans argent a une vie objectivement étroite — mais
  // c'est justement le moment que le joueur voit en premier, et celui où la
  // répétition a été remarquée. Ces scènes-ci n'appartiennent qu'à ce moment-là.

  {
    id: 'ou_jouer',
    tags: ['jeu', 'vie'],
    once: true,
    cooldown: 999,
    condition: (ctx) => enActivite(ctx) && !ctx.hasTeam && ctx.career.counters.weeks < 16,
    weight: (ctx) => FOND * (clamp(7 - ctx.career.counters.weeks * 0.3, 2, 7)),
    title: 'Où vous jouez',
    text: (ctx) =>
      ctx.situation.fauche
        ? `Votre installation tient dans un coin de pièce. Ce n'est pas idéal, et ce n'est pas négociable.`
        : `Vous pouvez encore choisir comment vous vous installez. Ça paraît anodin.`,
    choices: [
      {
        id: 'serieux',
        label: 'Aménager sérieusement',
        hint: 'Un vrai poste de travail',
        apply: (ctx) => {
          ctx.fx.attr('professionalism', 1).attr('focus', 0.8).fatigue(-4);
          return 'Vous installez tout correctement. Les longues sessions seront moins dures.';
        },
      },
      {
        id: 'social',
        // Jouer au milieu des autres suppose une scène qui a des lieux : les
        // régions peu structurées n'offrent pas cette option.
        available: (ctx) => (ctx.person.reputation.community ?? 0) > 2 || ctx.career.money > 400,
        label: 'Aller jouer là où il y a du monde',
        hint: 'Moins confortable, plus de rencontres',
        apply: (ctx) => {
          ctx.fx.rep('community', 4).attr('communication', 0.7).fatigue(4).observed(2);
          return 'Vous jouez au milieu des autres. On commence à savoir qui vous êtes.';
        },
      },
      {
        id: 'rien',
        label: 'Ne rien changer',
        hint: 'Ce qui compte, c’est le jeu',
        apply: (ctx) => {
          ctx.fx.group('mechanical', 0.5).stress(2);
          return 'Vous jouez là où vous êtes, comme vous êtes.';
        },
      },
    ],
  },

  {
    id: 'premier_palier',
    tags: ['jeu', 'progression'],
    once: true,
    cooldown: 999,
    condition: (ctx) => enActivite(ctx) && ctx.career.counters.weeks > 1 && ctx.career.counters.weeks < 24,
    weight: (ctx) => FOND * (clamp(5 - ctx.career.counters.weeks * 0.15, 1.5, 5)),
    title: 'Un palier',
    text: (ctx) =>
      `Vous atteignez un niveau de classement que vous n'aviez jamais atteint. Sur ${ctx.game.name}, ça ne veut pas dire grand-chose. Pour vous, si.`,
    choices: [
      {
        id: 'viser',
        label: 'Viser tout de suite le suivant',
        hint: 'Ne pas s’arrêter là',
        apply: (ctx) => {
          ctx.fx.group('mechanical', 0.9).attr('workCapacity', 0.8).fatigue(7).morale(3);
          return 'Vous repartez immédiatement. Le palier suivant paraît déjà atteignable.';
        },
      },
      {
        id: 'savourer',
        label: 'Prendre un moment',
        hint: 'On ne franchit un premier palier qu’une fois',
        apply: (ctx) => {
          ctx.fx.morale(8).stress(-6).attr('selfConfidence', 0.9);
          return 'Vous vous arrêtez cinq minutes. C’est peu, et vous vous en souviendrez.';
        },
      },
    ],
  },

  {
    id: 'premiers_contacts',
    tags: ['réseau'],
    cooldown: 60,
    condition: (ctx) => enActivite(ctx) && !ctx.hasTeam && ctx.career.counters.weeks > 1,
    weight: (ctx) => FOND * (clamp(3.2 - ctx.career.counters.weeks * 0.02, 1.2, 3.2)),
    title: 'Des joueurs comme vous',
    text: () =>
      `Vous croisez toujours les mêmes têtes en haut du classement de votre région. Personne ne s'est encore parlé.`,
    choices: [
      {
        id: 'parler',
        label: 'Engager la conversation',
        hint: 'Une équipe commence souvent comme ça',
        apply: (ctx) => {
          ctx.fx.rep('pros', 3).attr('trustBuilding', 0.8).attr('communication', 0.5);
          ctx.fx.later('discipline_noticed', 26, { source: 'reseau' });
          return 'Vous parlez à deux ou trois d’entre eux. On verra ce que ça donne.';
        },
      },
      {
        id: 'observer',
        label: 'Les observer d’abord',
        hint: 'Apprendre d’eux avant de se montrer',
        apply: (ctx) => {
          ctx.fx.group('gameSense', 0.8).attr('reading', 0.6);
          return 'Vous regardez leurs parties pendant des heures. Il y a beaucoup à prendre.';
        },
      },
    ],
  },

  {
    id: 'temps_a_soi',
    tags: ['vie', 'mental'],
    cooldown: 46,
    condition: (ctx) => enActivite(ctx) && ctx.career.counters.weeks > 1,
    weight: (ctx) => FOND * (clamp(2 + (ctx.person.stress > 45 ? 1.4 : 0), 1, 3.4)),
    title: 'Le reste de votre vie',
    text: (ctx) =>
      ctx.situation.sansEquipe
        ? `Il y a autre chose que le jeu, en principe. Vous n'y avez pas touché depuis un moment.`
        : `Entre les sessions, il reste des heures. Vous ne savez plus très bien quoi en faire.`,
    choices: [
      {
        id: 'sortir',
        label: 'Sortir, voir des gens',
        hint: 'Rien à voir avec le jeu',
        apply: (ctx) => {
          ctx.fx.morale(7).stress(-8).fatigue(3).group('mechanical', -0.2);
          return 'Vous passez une soirée normale. Ça faisait longtemps.';
        },
      },
      {
        id: 'apprendre',
        label: 'Travailler autre chose',
        hint: 'Se garder une porte ouverte',
        apply: (ctx) => {
          ctx.fx.attr('learning', 0.9).attr('timeManagement', 0.7).morale(2);
          return 'Vous consacrez vos heures creuses à autre chose. On ne sait jamais.';
        },
      },
      {
        id: 'jouer',
        label: 'Rejouer',
        hint: 'Il n’y a rien d’autre, pour l’instant',
        apply: (ctx) => {
          ctx.fx.group('mechanical', 0.8).fatigue(6).stress(3);
          return 'Vous relancez une file. Les heures creuses n’existent pas.';
        },
      },
    ],
  },
];

/** Y a-t-il quelqu'un dans le vestiaire ? Évalué sans consommer d'aléatoire. */
function unCoequipierPossible(ctx) {
  if (!ctx.team?.roster) return false;
  return ctx.team.roster.some((id) => id !== ctx.person.id && ctx.world.persons[id]);
}
