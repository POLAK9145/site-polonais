/**
 * Événements portés par le monde (§9, §10, §31, §40, §41, §48).
 *
 * Ceux-ci ne dépendent pas des choix récents du joueur mais de l'état de la
 * scène : un patch qui renverse la méta, une organisation qui coule, un
 * prodige qui arrive, un rival qui monte, un corps qui ne suit plus.
 */

import { clamp } from '../../rng.js';
import { GAMES, GAMES_BY_ID, transferRate } from '../../../data/games.js';
import { baseRating, age as personAge, STATUS, weightedCeiling } from '../../person.js';
import { rivalryStatus, relationValue, REL_TAGS } from '../../relations.js';
import { releasePlayer } from '../../transfers.js';
import { selon, VISIBILITE, SAISON_DE_VIE } from '../situation.js';
import { relieveLoad } from '../../load.js';

/** Candidat crédible au rôle de rival : même scène, niveau et âge proches. */
function rivalCandidate(ctx) {
  const { world, person } = ctx;
  const myRating = ctx.rating;
  const myAge = ctx.age;
  let best = null;
  let bestScore = -Infinity;
  for (const p of Object.values(world.persons)) {
    if (p.id === person.id) continue;
    if (p.gameId !== person.gameId) continue;
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    if (p.teamId && p.teamId === person.teamId) continue;
    const r = baseRating(p, ctx.game);
    const a = personAge(p, world.week);
    const proximity = -Math.abs(r - myRating) * 1.4 - Math.abs(a - myAge) * 2.2;
    const visibility = p.reputation.public * 0.08;
    const score = proximity + visibility + ctx.rng.float(0, 6);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export const worldEvents = [
  // --- CHAÎNE RIVALITÉ -------------------------------------------------
  {
    id: 'rival_emerges',
    tags: ['rivalité', 'compétition'],
    // `once: true` retiré (étape 7E). Une carrière de vingt ans n'avait qu'un
    // seul rival, désigné vers l'an 3 quand le joueur était encore un espoir, et
    // conservé jusqu'au bout — retraité dans quinze cas sur dix-huit. Une
    // nouvelle rivalité peut naître, mais seulement quand l'ancienne est
    // réellement morte : c'est `rivalryStatus` qui en juge, sur des faits
    // vérifiables. On ne remplace jamais une rivalité vivante.
    cooldown: 120,
    condition: (ctx) => {
      if (ctx.person.stats.matches <= 20 || ctx.rating <= 55) return false;
      if (rivalryStatus(ctx.world, ctx.person, ctx.career).vivante) return false;
      // Une rivalité qui vient de s'éteindre laisse un temps de latence : on ne
      // s'invente pas un adversaire la semaine où l'autre raccroche.
      const derniere = ctx.career.pastRivalries?.at(-1);
      return !derniere || ctx.world.week - derniere.week >= 52;
    },
    weight: (ctx) => {
      // Une deuxième rivalité est plus rare qu'une première : on n'a pas
      // l'énergie de tout recommencer aussi souvent.
      const deja = ctx.career.pastRivalries?.length ?? 0;
      return clamp((ctx.rating - 52) * 0.2, 0, 7) / (1 + deja * 0.8);
    },
    title: 'Un nom qui revient',
    text: (ctx) => {
      const rival = rivalCandidate(ctx);
      ctx.pickedRival = rival;
      if (!rival) return 'La scène est calme.';
      return `${rival.nick} a le même âge que vous, le même niveau, et il progresse exactement au même rythme. Les comparaisons commencent. Elles ne vous plaisent pas.`;
    },
    choices: [
      {
        id: 'accept_rivalry',
        label: 'Faire de lui votre mètre étalon',
        apply: (ctx) => {
          const rival = ctx.pickedRival ?? rivalCandidate(ctx);
          if (!rival) return 'Rien ne se cristallise.';
          ctx.career.rivalId = rival.id;
          ctx.career.rivalry = { depuis: ctx.world.week, actes: 1 };
          ctx.fx.relation(rival.id, -12, `${rival.nick} devient votre rival déclaré.`, {
            tag: REL_TAGS.RIVAL,
            important: true,
          });
          ctx.fx.attr('workCapacity', 2).attr('selfConfidence', 1).morale(3);
          ctx.fx.log(`Rivalité naissante avec ${rival.nick}.`, { kind: 'rivalry', important: true });
          ctx.fx.memory('rivalry', 'Un rival', `${rival.nick} et vous êtes arrivés en même temps. L'un des deux devait passer devant.`);
          ctx.fx.chain('rival_showdown', { delay: ctx.rng.int(20, 60), expires: 120, data: { rivalId: rival.id } });
          return `Vous suivez ses résultats chaque semaine. Il fait probablement pareil.`;
        },
      },
      {
        id: 'ignore_rivalry',
        label: 'Ne pas entrer dans ce jeu',
        apply: (ctx) => {
          const rival = ctx.pickedRival ?? rivalCandidate(ctx);
          if (rival) {
            ctx.career.rivalId = rival.id;
            ctx.career.rivalry = { depuis: ctx.world.week, actes: 1 };
            ctx.fx.relation(rival.id, 4, `Respect distant avec ${rival.nick}.`, { tag: REL_TAGS.RIVAL });
          }
          ctx.fx.attr('composure', 1.5);
          ctx.fx.chain('rival_showdown', { delay: ctx.rng.int(30, 70), expires: 120, data: { rivalId: rival?.id } });
          return 'Vous refusez de commenter. Vous regardez quand même ses matchs.';
        },
      },
    ],
  },

  {
    id: 'rival_showdown',
    chainOnly: true,
    tags: ['rivalité', 'compétition'],
    condition: (ctx) => {
      const rival = ctx.world.persons[ctx.chainData?.rivalId];
      return !!rival && rival.status !== STATUS.RETIRED && rival.gameId === ctx.person.gameId;
    },
    title: 'Face à face',
    text: (ctx) => {
      const rival = ctx.world.persons[ctx.chainData.rivalId];
      return `Le tirage vous oppose à ${rival.nick}. Tout le monde le sait, tout le monde en parle, et vous n'avez pas dormi.`;
    },
    auto: (ctx) => {
      const rival = ctx.world.persons[ctx.chainData.rivalId];
      const myScore = ctx.rating + ctx.person.form + ctx.person.attrs.clutch * 0.12 + ctx.rng.gauss(0, 8);
      const theirScore = baseRating(rival, ctx.game) + rival.form + rival.attrs.clutch * 0.12 + ctx.rng.gauss(0, 8);
      const won = myScore > theirScore;
      if (won) {
        ctx.fx.rep('pros', 6).rep('public', 5).morale(14).form(3);
        ctx.fx.relation(rival.id, -6, `Vous avez battu ${rival.nick} dans un match décisif.`, { important: true });
        ctx.fx.log(`Victoire face à ${rival.nick}.`, { kind: 'rivalry', important: true });
        ctx.fx.memory('rivalry', 'Le duel gagné', `Vous avez battu ${rival.nick} quand ça comptait.`);
        ctx.fx.news(`${ctx.person.nick} prend le dessus sur ${rival.nick}`, 'Le duel de génération tourne en sa faveur.');
        ctx.fx.achievement('beat_rival');
      } else {
        ctx.fx.morale(-14).form(-3).stress(10);
        ctx.fx.relation(rival.id, -4, `${rival.nick} vous a battu dans un match décisif.`, { important: true });
        ctx.fx.log(`Défaite face à ${rival.nick}.`, { kind: 'rivalry', important: true });
        ctx.fx.memory('rivalry', 'Le duel perdu', `${rival.nick} vous a devancé. Vous y repenserez souvent.`);
      }
      ctx.fx.chain('rival_resolution', { delay: ctx.rng.int(40, 110), expires: 160, data: { rivalId: rival.id, won } });
      return won ? 'Vous gagnez. Le silence de son côté vaut tous les commentaires.' : 'Vous perdez. Il ne dit rien non plus. C’est pire.';
    },
  },

  {
    id: 'rival_resolution',
    chainOnly: true,
    tags: ['rivalité', 'social'],
    condition: (ctx) => !!ctx.world.persons[ctx.chainData?.rivalId],
    title: (ctx) => `Des années plus tard`,
    text: (ctx) => {
      const rival = ctx.world.persons[ctx.chainData.rivalId];
      return `${rival.nick} et vous vous croisez en coulisses. Vous avez tous les deux vieilli. La rivalité a duré plus longtemps que la plupart des équipes que vous avez connues.`;
    },
    choices: [
      {
        id: 'respect',
        label: 'Reconnaître ce qu’il vous a apporté',
        apply: (ctx) => {
          const rival = ctx.world.persons[ctx.chainData.rivalId];
          ctx.fx.relation(rival.id, 45, `Réconciliation avec ${rival.nick} : la rivalité devient du respect.`, {
            important: true,
          });
          ctx.fx.morale(10).attr('composure', 2);
          ctx.fx.memory('rivalry', 'Le respect', `Vous et ${rival.nick} avez fini par vous serrer la main.`);
          ctx.fx.log(`Réconciliation avec ${rival.nick}.`, { kind: 'rivalry', important: true });
          return 'Vous lui dites qu’il vous a rendu meilleur. Il répond que c’est réciproque.';
        },
      },
      {
        id: 'cold',
        label: 'Passer sans un mot',
        apply: (ctx) => {
          const rival = ctx.world.persons[ctx.chainData.rivalId];
          ctx.fx.relation(rival.id, -25, `Vous n'avez jamais tourné la page avec ${rival.nick}.`, {
            tag: REL_TAGS.ENEMY,
            important: true,
          });
          ctx.fx.memory('rivalry', 'Jamais réglé', `Avec ${rival.nick}, ça ne s'est jamais arrangé.`);
          return 'Vous vous croisez. Rien. C’est resté comme ça.';
        },
      },
    ],
  },

  // --- LE JEU CHANGE ---------------------------------------------------
  {
    id: 'patch_shock',
    tags: ['jeu', 'mental'],
    cooldown: 30,
    condition: (ctx) => (ctx.person.metaShock ?? 0) > 3.5,
    weight: (ctx) => clamp((ctx.person.metaShock ?? 0), 0, 9),
    title: (ctx) => `Patch ${ctx.gameState.patchMajor}.0`,
    text: (ctx) =>
      `La mise à jour change tout. La méta bascule vers « ${ctx.gameState.meta.axis} ». Ce que vous faisiez le mieux ne vaut plus grand-chose cette saison.`,
    choices: [
      {
        id: 'adapt',
        label: 'Tout réapprendre',
        apply: (ctx) => {
          ctx.person.metaShock = Math.max(0, (ctx.person.metaShock ?? 0) - 3);
          ctx.fx.attr('adaptation', 2.5).attr('metaSense', 2).fatigue(8).stress(6);
          ctx.fx.log(`Adaptation au patch ${ctx.gameState.patchMajor}.0.`, { kind: 'game' });
          return 'Vous jetez vos habitudes. Deux semaines difficiles, puis ça revient.';
        },
      },
      {
        id: 'resist',
        label: 'Continuer à jouer votre style',
        risky: true,
        apply: (ctx) => {
          ctx.person.metaShock = (ctx.person.metaShock ?? 0) + 2;
          ctx.fx.attr('creativity', 2).attr('selfConfidence', 1);
          if (ctx.person.attrs.creativity > 72 && ctx.rng.chance(0.35)) {
            ctx.fx.chain('meta_innovation', { delay: ctx.rng.int(6, 16), expires: 40 });
            return 'Vous refusez de suivre. Vous cherchez autre chose. Vous trouvez peut-être quelque chose.';
          }
          ctx.fx.form(-4);
          return 'Vous continuez comme avant. Les résultats ne suivent pas.';
        },
      },
    ],
  },

  {
    id: 'meta_innovation',
    chainOnly: true,
    tags: ['jeu', 'compétition'],
    title: 'Quelque chose de neuf',
    text: () => `Ce que vous avez bricolé dans votre coin fonctionne. Vraiment bien. Et personne d'autre ne le joue.`,
    auto: (ctx) => {
      ctx.person.metaShock = 0;
      ctx.fx.attr('creativity', 3).attr('metaSense', 3).rep('pros', 10).rep('media', 6).form(5);
      ctx.fx.log('Innovation stratégique reconnue.', { kind: 'game', important: true });
      ctx.fx.memory('innovation', 'Le créateur de méta', `Vous avez inventé quelque chose que toute la scène a copié.`);
      ctx.fx.news(`${ctx.person.nick} bouscule la méta`, `Sa nouvelle approche est reprise par toute la scène.`);
      ctx.fx.achievement('meta_creator');
      ctx.fx.flag('meta_innovator', true);
      return 'En trois semaines, la moitié de la scène joue votre trouvaille.';
    },
  },

  {
    id: 'scene_declining',
    tags: ['jeu', 'transfert'],
    cooldown: 80,
    condition: (ctx) => ctx.gameState.popularity < 35 && ctx.gameState.alive,
    weight: (ctx) => clamp((40 - ctx.gameState.popularity) * 0.25, 0, 8),
    title: 'La scène se vide',
    text: (ctx) => {
      const s = ctx.situation;
      const base = `${ctx.game.name} perd du terrain. Les audiences baissent, deux organisations ont fermé leur section, et les dotations fondent. Ceux qui restent le font par attachement.`;
      if (s.saisonDeVie === SAISON_DE_VIE.VETERAN) return `${base} Vous avez vu arriver cette scène. Vous la verrez partir.`;
      if (s.fauche) return `${base} Des dotations qui fondent, c’est votre revenu qui fond.`;
      return base;
    },
    choices: [
      {
        id: 'stay',
        label: 'Rester fidèle au jeu',
        hint: (ctx) => selon(ctx.situation.fauche, 'La communauté vous le rendra. Pas votre banque', 'La communauté ne l’oubliera pas'),
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.rep('community', 12).flag('loyal_to_scene', true);
          ctx.fx.log(`Choix de rester sur ${ctx.game.shortName} malgré le déclin.`, { kind: 'decision', important: true });
          // Rester sur une scène qui meurt est un choix confortable quand on a
          // gagné, coûteux quand on n'a plus rien.
          if (s.fauche) {
            ctx.fx.morale(-2);
            return 'Vous restez. La communauté ne l’oubliera pas. Les dotations, elles, continuent de baisser.';
          }
          if (s.aDejaGagne) {
            ctx.fx.morale(7).rep('pros', 3);
            return 'Vous restez. Venant de vous, cela pèse : la communauté sait ce que vous avez gagné ici.';
          }
          ctx.fx.morale(4);
          return 'Vous restez. La communauté ne l’oubliera pas.';
        },
      },
      {
        id: 'organize',
        label: 'Essayer de faire vivre ce qui reste',
        hint: 'Votre nom peut encore rassembler du monde',
        // Il faut un nom pour rassembler. Un joueur inconnu n'a personne à appeler.
        available: (ctx) =>
          ctx.situation.visibilite === VISIBILITE.CONNU || ctx.situation.visibilite === VISIBILITE.VEDETTE,
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.rep('community', 18).rep('media', 4).flag('scene_pillar', true);
          ctx.fx.log(`Mobilisation autour de ${ctx.game.shortName}.`, { kind: 'decision', important: true });
          // Porter une scène à bout de bras est un travail, et il fatigue.
          ctx.fx.fatigue(s.aBout ? 12 : 7).stress(5);
          if (s.aBout) {
            ctx.fx.morale(2);
            return 'Vous organisez des tournois communautaires, vous appelez d’anciens joueurs. C’est du travail en plus, et vous n’en avez pas les moyens.';
          }
          ctx.fx.morale(6);
          return 'Vous organisez des tournois communautaires, vous appelez d’anciens joueurs. Quelque chose repart, un peu.';
        },
      },
      {
        id: 'explore',
        label: 'Regarder ailleurs',
        hint: 'Lancer autre chose le soir, juste pour voir',
        apply: (ctx) => {
          ctx.fx.chain('game_switch_offer', { delay: ctx.rng.int(2, 8), expires: 40 });
          return 'Vous commencez à lancer un autre jeu le soir. Juste pour voir.';
        },
      },
    ],
  },

  {
    id: 'game_switch_offer',
    // Étape 7D : changer de jeu, c'est aussi laisser des gens derrière.
    tags: ['jeu', 'transfert'],
    cooldown: 90,
    condition: (ctx) => ctx.person.status !== STATUS.RETIRED && ctx.career.counters.weeks > 30,
    weight: (ctx) => {
      // On ne propose un changement de jeu que s'il y a une raison :
      // scène en déclin, plafond atteint, ou absence d'équipe.
      let w = 0;
      if (ctx.gameState.popularity < 45) w += 3;
      if (!ctx.hasTeam) w += 2.5;
      if (ctx.rating > weightedCeiling(ctx.person, ctx.game) - 3) w += 2;
      return w * ctx.difficulty.opportunity;
    },
    title: 'Une autre scène',
    text: (ctx) => {
      const target = pickSwitchTarget(ctx);
      ctx.pickedGame = target;
      if (!target) return 'Rien d’intéressant ailleurs.';
      const rate = transferRate(ctx.game.genre, target.game.genre);
      const hint =
        rate > 0.5
          ? 'Vos compétences se transposeraient plutôt bien.'
          : rate > 0.3
            ? 'Une partie de votre jeu se transposerait.'
            : 'Presque tout serait à réapprendre.';
      return `${target.game.name} est en pleine expansion. ${hint} Changer de jeu, c'est repartir de très bas, avec de l'expérience en plus et du temps en moins.`;
    },
    choices: [
      {
        id: 'switch',
        label: 'Se lancer',
        risky: true,
        apply: (ctx) => {
          const target = ctx.pickedGame ?? pickSwitchTarget(ctx);
          if (!target) return 'Vous y renoncez.';
          const rate = transferRate(ctx.game.genre, target.game.genre);
          const startFam = clamp(rate * 0.45 * (0.6 + ctx.person.hidden.adaptability * 0.8), 0.03, 0.5);
          ctx.fx.familiarity(target.game.id, startFam);
          ctx.career.learningGameId = target.game.id;
          ctx.career.routine = ['newgame', 'newgame', 'strategy', 'rest'];
          ctx.fx.log(`Début de transition vers ${target.game.name}.`, { kind: 'game', important: true });
          ctx.fx.memory('switch', 'Changement de jeu', `Vous avez tout quitté pour ${target.game.name}.`);
          ctx.fx.chain('game_switch_complete', { delay: 12, expires: 200, data: { gameId: target.game.id } });
          return `Vous vous mettez à ${target.game.name}. Vous êtes redevenu débutant.`;
        },
      },
      {
        id: 'stay',
        label: 'Rester sur votre jeu',
        apply: (ctx) => {
          ctx.fx.attr('metaSense', 1).morale(2);
          return 'Vous refermez le launcher. Ce n’est pas le moment.';
        },
      },
    ],
  },

  {
    id: 'game_switch_complete',
    chainOnly: true,
    tags: ['jeu'],
    condition: (ctx) => {
      const gid = ctx.chainData?.gameId;
      if (!gid) return false;
      // On ne bascule officiellement que quand le niveau suit réellement.
      return (ctx.person.familiarity[gid] ?? 0) > 0.5;
    },
    title: 'Le nouveau départ',
    text: (ctx) => {
      const game = GAMES_BY_ID[ctx.chainData.gameId];
      return `Après des mois de travail, vous tenez enfin votre niveau sur ${game.name}. Ce n'est plus un essai : c'est votre jeu maintenant.`;
    },
    auto: (ctx) => {
      const gid = ctx.chainData.gameId;
      const game = GAMES_BY_ID[gid];
      // Sortie propre de l'ancienne scène avant de basculer.
      if (ctx.person.teamId) releasePlayer(ctx.world, ctx.person.id, ctx.world.week, 'changement de jeu');
      ctx.person.gameId = gid;
      ctx.person.roleId = null;
      ctx.career.learningGameId = null;
      ctx.career.routine = ['mechanics', 'strategy', 'review', 'rest'];
      ctx.fx.log(`Bascule officielle sur ${game.name}.`, { kind: 'game', important: true });
      ctx.fx.achievement('game_switcher');
      ctx.fx.news(`${ctx.person.nick} change de jeu`, `Direction ${game.name}.`);
      return `Vous êtes officiellement un joueur de ${game.name}.`;
    },
  },

  // --- LE MONDE BOUGE --------------------------------------------------
  {
    id: 'org_in_trouble',
    // Étape 7D : ce qu'on hésite à quitter dépend de qui l'on y laisse.
    tags: ['équipe', 'argent'],
    cooldown: 60,
    condition: (ctx) => ctx.hasTeam && !!ctx.org && ctx.org.budget < ctx.org.yearlyIncome * 0.15,
    // Une organisation qui vacille inquiète d'autant plus qu'on y est installé
    // et qu'on en dépend. Un joueur sans salaire chez elle a moins à perdre.
    weight: (ctx) => {
      const attache = ctx.situation.estTitulaire ? 2.5 : 1;
      const dependance = ctx.person.contract?.salary > 0 ? 2.5 : 0.5;
      return clamp(3 + attache + dependance, 2, 9);
    },
    title: 'Des retards de paiement',
    text: (ctx) =>
      `Le salaire n'est pas tombé. Le manager parle d'un « décalage administratif ». Deux joueurs disent la même chose que vous : ce n'est pas la première fois.`,
    choices: [
      {
        id: 'wait',
        label: 'Attendre et faire confiance',
        apply: (ctx) => {
          ctx.fx.stress(8).morale(-5);
          ctx.fx.chain('org_fate', { delay: ctx.rng.int(4, 12), expires: 40 });
          return 'Vous attendez. Vous n’avez pas vraiment le choix.';
        },
      },
      {
        id: 'leave',
        label: 'Demander la résiliation',
        apply: (ctx) => {
          const orgName = ctx.org.name;
          releasePlayer(ctx.world, ctx.person.id, ctx.world.week, 'résiliation');
          ctx.career.counters.timesReleased++;
          ctx.fx.morale(-6).flag('free_agent', true);
          ctx.fx.log(`Résiliation du contrat avec ${orgName}.`, { kind: 'contract', important: true });
          return `Vous partez libre. ${orgName} ne vous retient pas — elle n'en a pas les moyens.`;
        },
      },
    ],
  },

  {
    id: 'org_fate',
    chainOnly: true,
    tags: ['équipe', 'argent'],
    condition: (ctx) => !!ctx.org,
    title: 'La fin d’une structure',
    text: (ctx) => `La réunion est convoquée un mardi matin. Tout le monde a compris avant d'entrer.`,
    auto: (ctx) => {
      const org = ctx.org;
      const survives = org.budget > 0 && ctx.rng.chance(0.35);
      if (survives) {
        org.budget = Math.round(org.budget * 1.6 + 30000);
        ctx.fx.morale(8).log(`${org.name} trouve un investisseur.`, { kind: 'team', important: true });
        return `Un investisseur reprend la structure. Les arriérés sont payés. L'équipe continue.`;
      }
      const orgName = org.name;
      dissolveOrg(ctx.world, org, ctx.world.week);
      ctx.career.counters.timesReleased++;
      ctx.fx.morale(-14).stress(10);
      ctx.fx.log(`${orgName} disparaît.`, { kind: 'setback', important: true });
      ctx.fx.memory('crisis', 'La structure a coulé', `${orgName} a fermé. Vous vous êtes retrouvé sans rien du jour au lendemain.`);
      ctx.fx.news(`${orgName} cesse ses activités`, 'Les joueurs sont libres de tout engagement.', { tone: 'negative' });
      return `${orgName} ferme. Vous êtes libre, et sans équipe.`;
    },
  },

  {
    id: 'prodigy_arrives',
    tags: ['compétition', 'jeu'],
    cooldown: 100,
    condition: (ctx) => ctx.age > 22 && ctx.person.stats.matches > 40,
    weight: (ctx) => clamp((ctx.age - 21) * 0.7, 0, 6),
    title: 'La génération suivante',
    text: (ctx) => {
      const kid = findProdigy(ctx);
      ctx.pickedProdigy = kid;
      if (!kid) return 'La scène tourne, comme toujours.';
      const s = ctx.situation;
      const base = `${kid.nick}, ${Math.floor(personAge(kid, ctx.world.week))} ans, arrive dans la scène. Tout le monde parle de lui. Vous vous souvenez d'avoir été ce joueur-là.`;
      if (s.surLeBanc) return `${base} On parle déjà de lui pour votre poste.`;
      if (s.aBout) return `${base} Il a l’énergie que vous aviez. Vous ne l’avez plus.`;
      // Avoir déjà transmis, ou avoir porté le groupe, change ce qu'on voit
      // arriver en face (étape 7D).
      if (s.aFormeQuelquun) return `${base} Vous savez déjà ce que ça fait, de voir quelqu’un vous dépasser. Vous l’avez aidé.`;
      if (s.aEteCapitaine) return `${base} On vous a confié un groupe, autrefois. Personne ne vous l’a proposé cette année.`;
      return base;
    },
    choices: [
      {
        id: 'mentor',
        label: 'Le prendre sous votre aile',
        hint: 'Transmettre — et compter pour autre chose que vos réflexes',
        apply: (ctx) => {
          const kid = ctx.pickedProdigy ?? findProdigy(ctx);
          if (!kid) return 'Le moment passe.';
          const s = ctx.situation;
          ctx.fx.relation(kid.id, 30, `Vous avez pris ${kid.nick} sous votre aile.`, {
            tag: REL_TAGS.PROTEGE,
            important: true,
          });
          ctx.fx.attr('leadership', 2).attr('motivation', 2).rep('pros', 5);
          ctx.fx.log(`Devient le mentor de ${kid.nick}.`, { kind: 'social', important: true });
          ctx.fx.later('protege_rise', ctx.rng.int(50, 120), { personId: kid.id });
          // Transmettre donne un rôle à celui qui n'en a plus sur le terrain.
          if (s.surLeBanc || s.aBout) {
            ctx.fx.morale(8);
            return 'Vous lui expliquez ce que personne ne vous avait expliqué. Vous servez encore à quelque chose.';
          }
          return 'Vous lui expliquez ce que personne ne vous avait expliqué.';
        },
      },
      {
        id: 'compete',
        label: 'Lui montrer qui est encore là',
        hint: (ctx) => selon(ctx.situation.aBout, 'À votre état, ce sera très cher', 'À votre âge, ça se paie'),
        apply: (ctx) => {
          const kid = ctx.pickedProdigy ?? findProdigy(ctx);
          const s = ctx.situation;
          if (kid) ctx.fx.relation(kid.id, -10, `Rapport de force avec ${kid.nick}.`, { tag: REL_TAGS.RIVAL });
          // Doubler le volume est une charge réelle, et le corps d'un joueur
          // déjà au bout ne l'absorbe pas.
          ctx.fx.attr('workCapacity', s.aBout ? 0.7 : 2);
          ctx.fx.fatigue(s.aBout ? 14 : 6).form(s.aBout ? -1 : 2).morale(3);
          if (s.aBout) return 'Vous doublez votre volume d’entraînement. À votre âge et dans votre état, ça se paie tout de suite.';
          return 'Vous doublez votre volume d’entraînement. À votre âge, ça se paie.';
        },
      },
    ],
  },

  // --- FIN DE CARRIÈRE -------------------------------------------------
  {
    id: 'decline_realization',
    // Étape 7D : accepter son déclin dépend de ce qu'on a déjà traversé.
    tags: ['mental', 'compétition'],
    cooldown: 60,
    condition: (ctx) => {
      const peak = ctx.person.stats.peakRating;
      return peak > 0 && ctx.rating < peak - 5 && ctx.age > 24;
    },
    weight: (ctx) => clamp((ctx.person.stats.peakRating - ctx.rating) * 0.5, 0, 8),
    title: 'Ce n’est plus pareil',
    text: (ctx) => {
      const s = ctx.situation;
      const base = `Les réflexes ne répondent plus tout à fait. Vous compensez par la lecture, l'expérience, le placement. Ça marche encore. Ça ne marchera pas toujours.`;
      // Le joueur sait faire la différence entre vieillir et être vidé — et
      // c'est une distinction qui change complètement la décision.
      if (ctx.situation.aBout) return `${base} Une partie de vous se demande si c’est vraiment l’âge, ou seulement l’état dans lequel vous êtes depuis des mois.`;
      if (s.surLeBanc) return `${base} Le staff, lui, a déjà tranché.`;
      // Ce qu'on a traversé change la façon de recevoir la nouvelle (7D).
      if (s.aConnuLaRupture) return `${base} Vous avez déjà cru que c’était fini une fois. Vous savez que ça peut ne pas l’être.`;
      if (s.aFormeQuelquun) return `${base} Vous reconnaissez, chez les plus jeunes, ce que vous étiez.`;
      return base;
    },
    choices: [
      {
        id: 'adapt_role',
        label: 'Changer votre façon de jouer',
        hint: 'Moins vite, beaucoup mieux placé',
        apply: (ctx) => {
          const s = ctx.situation;
          // Se réinventer demande de la disponibilité mentale. Épuisé, on
          // n'apprend pas un nouveau métier.
          const rendement = s.aBout ? 0.5 : 1;
          ctx.fx.attr('reading', 2.5 * rendement).attr('decision', 2.5 * rendement);
          ctx.fx.attr('anticipation', 2 * rendement).attr('riskControl', 2 * rendement);
          ctx.fx.log('Reconversion du style de jeu.', { kind: 'decision', important: true });
          ctx.fx.flag('reinvented', true);
          if (s.aBout) return 'Vous essayez de jouer autrement. Les idées sont bonnes ; vous n’avez pas la tête à les appliquer.';
          return 'Vous jouez moins vite et beaucoup mieux placé. Les jeunes ne comprennent pas comment vous les battez.';
        },
      },
      {
        id: 'rebuild',
        label: 'Vous demander si c’est l’âge ou l’usure',
        hint: 'Lever le pied avant de conclure',
        // On ne se pose la question que si l'usure est réelle. Un joueur frais
        // en déclin sait que c'est l'âge.
        available: (ctx) => ctx.situation.aBout || ctx.situation.enchaine || ctx.situation.dejaRompu,
        apply: (ctx) => {
          const s = ctx.situation;
          relieveLoad(ctx.person, 34, { week: ctx.world.week, reason: 'doute sur l’usure' });
          ctx.fx.stress(-10).flag('suspected_burnout', true);
          ctx.fx.log('Pause prise pour distinguer l’âge de l’usure.', { kind: 'decision', important: true });
          // Si c'était bien l'usure, la forme revient un peu. Sinon, on a
          // seulement perdu des semaines — et on le sait maintenant.
          if (s.enchaine || s.aBout) {
            ctx.fx.form(4).morale(6);
            return 'Vous levez le pied trois semaines. Une partie de ce que vous croyiez perdu revient. Ce n’était pas l’âge.';
          }
          ctx.fx.morale(-3);
          return 'Vous levez le pied trois semaines. Rien ne revient. C’était bien l’âge.';
        },
      },
      {
        id: 'fight_it',
        label: 'Travailler encore plus dur',
        hint: (ctx) => selon(ctx.situation.aBout, 'Votre corps a déjà répondu à cette question', 'Doubler la mécanique'),
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.group('mechanical', s.aBout ? 0.5 : 1.2);
          ctx.fx.fatigue(s.aBout ? 20 : 14).stress(s.aBout ? 15 : 10);
          ctx.fx.later('overwork_toll', 20, null);
          if (s.aBout) return 'Vous doublez les sessions de mécanique. Votre corps ne proteste plus : il lâche.';
          return 'Vous doublez les sessions de mécanique. Votre corps proteste.';
        },
      },
      {
        id: 'accept',
        label: 'Commencer à penser à l’après',
        hint: (ctx) => selon(ctx.situation.aDejaGagne, 'Vous avez de quoi regarder derrière vous', 'Regarder ce que font les anciens'),
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.flag('thinking_retirement', true).stress(-8).attr('learning', 2);
          ctx.fx.log('Réflexion sur l’après-carrière.', { kind: 'decision' });
          // Envisager l'après est apaisant quand on a gagné quelque chose,
          // amer quand on n'a rien à montrer.
          if (s.aDejaGagne) {
            ctx.fx.morale(4);
            return 'Vous commencez à regarder ce que font les anciens. Coaching, analyse, contenu. Vous avez un palmarès à faire valoir.';
          }
          ctx.fx.morale(-4);
          return 'Vous commencez à regarder ce que font les anciens. Coaching, analyse, contenu. Vous n’avez pas grand-chose à mettre sur une carte de visite.';
        },
      },
    ],
  },

  {
    id: 'retirement_crossroads',
    tags: ['carrière', 'mental'],
    cooldown: 52,
    condition: (ctx) => {
      if (ctx.person.status === STATUS.RETIRED) return false;
      const old = ctx.age >= 27;
      const declining = ctx.person.stats.peakRating > 0 && ctx.rating < ctx.person.stats.peakRating - 8;
      const stuck = !ctx.hasTeam && ctx.career.counters.weeksWithoutTeam > 60;
      const done = ctx.career.flags.thinking_retirement || ctx.career.flags.considering_exit;
      return (old && declining) || stuck || (done && ctx.age > 24);
    },
    weight: (ctx) => clamp((ctx.age - 25) * 1.1 + (ctx.career.flags.thinking_retirement ? 4 : 0), 0, 12),
    // Étape 7D : ce qu'on a déjà traversé pèse sur l'idée d'arrêter.
    title: 'La question',
    text: (ctx) => {
      const s = ctx.situation;
      const base = `Vous avez ${Math.floor(ctx.age)} ans. Une saison de plus, ou pas. Ce n'est plus une question de niveau : c'est une question d'envie, d'argent, et de ce que vous voulez faire des dix prochaines années.`;
      // Ce qui pèse dans la balance dépend de ce qu'on a et de ce qu'on n'a plus.
      if (s.dejaRompu && s.aBout) return `${base} Vous êtes déjà tombé une fois. Vous savez à quoi ressemble la suite si vous continuez comme ça.`;
      if (s.fauche) return `${base} La question d’argent, elle, est déjà tranchée : il n’y en a pas.`;
      if (s.aDejaGagne) return `${base} Vous avez gagné quelque chose. Personne ne pourra vous l’enlever, quoi que vous décidiez.`;
      return base;
    },
    choices: [
      {
        id: 'continue',
        label: 'Continuer',
        hint: (ctx) => selon(ctx.situation.aBout, 'En sachant dans quel état vous êtes', 'Une saison de plus'),
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.flag('thinking_retirement', false);
          // Décider de continuer quand on est au bout n'est pas le même élan que
          // décider de continuer en pleine forme.
          if (s.aBout || s.dejaRompu) {
            ctx.fx.morale(4).stress(6);
            return 'Vous continuez. Vous ne savez pas encore jusqu’à quand, et cette fois la question ne vous quitte plus.';
          }
          ctx.fx.morale(8);
          return 'Vous continuez. Vous ne savez pas encore jusqu’à quand.';
        },
      },
      {
        id: 'last_season',
        label: 'Annoncer une dernière saison',
        hint: (ctx) => selon(ctx.situation.visibilite === VISIBILITE.INCONNU, 'Peu de gens s’en apercevront', 'Chaque match deviendra un adieu'),
        // On n'annonce une dernière saison que si l'on a quelque part où la
        // jouer. Sans équipe, il n'y a rien à annoncer.
        available: (ctx) => ctx.hasTeam,
        apply: (ctx) => {
          const s = ctx.situation;
          ctx.fx.flag('last_season', ctx.world.week + 52).morale(10);
          // L'écho dépend de ce que le public sait de vous.
          const echo = s.visibilite === VISIBILITE.VEDETTE ? 14 : s.visibilite === VISIBILITE.INCONNU ? 2 : 8;
          ctx.fx.rep('public', echo).rep('community', echo);
          ctx.fx.log('Annonce d’une dernière saison.', { kind: 'career', important: true });
          ctx.fx.news(`${ctx.person.nick} annonce sa dernière saison`, 'Une page de la scène se tourne.');
          ctx.fx.memory('ending', 'La dernière saison', 'Vous avez annoncé que ce serait la dernière.');
          if (s.visibilite === VISIBILITE.INCONNU) {
            return 'Vous l’annoncez. Quelques dizaines de personnes réagissent. Chaque match devient quand même un adieu.';
          }
          return 'Vous l’annoncez publiquement. Chaque match devient un adieu.';
        },
      },
      {
        id: 'retire_now',
        label: 'Arrêter maintenant',
        hint: (ctx) => selon(ctx.situation.fauche, 'Sans filet, mais sans y laisser plus', 'Sans conférence de presse'),
        apply: (ctx) => {
          ctx.career.pendingRetirement = 'immediate';
          ctx.fx.log('Décision d’arrêter la compétition.', { kind: 'career', important: true });
          return 'Vous arrêtez. Sans conférence de presse, sans tournée d’adieu.';
        },
      },
    ],
  },
];

function pickSwitchTarget(ctx) {
  const options = GAMES.filter((g) => g.id !== ctx.person.gameId)
    .map((game) => {
      const gs = ctx.world.gameStates[game.id];
      if (!gs?.alive) return null;
      const rate = transferRate(ctx.game.genre, game.genre);
      const score = gs.popularity * 0.6 + rate * 40 + ctx.person.hidden.adaptability * 20;
      return { game, gameState: gs, rate, score };
    })
    .filter(Boolean);
  if (options.length === 0) return null;
  return ctx.rng.weighted(options, (o) => Math.max(0.1, o.score));
}

function findProdigy(ctx) {
  const { world } = ctx;
  let best = null;
  let bestScore = -Infinity;
  for (const p of Object.values(world.persons)) {
    if (p.gameId !== ctx.person.gameId) continue;
    if (p.status === STATUS.RETIRED || p.status === STATUS.STAFF) continue;
    const a = personAge(p, world.week);
    if (a > 19) continue;
    const score = weightedCeiling(p, ctx.game) + ctx.rng.float(0, 5);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** Dissout une organisation : équipes fermées, joueurs libérés (§60). */
export function dissolveOrg(world, org, week) {
  org.alive = false;
  org.disbandedWeek = week;

  // Balayage défensif : on libère TOUTE personne encore contractuellement
  // liée à cette organisation, sans se fier au seul index `org.teams`.
  // Une seule référence oubliée produit un « contrat avec une organisation
  // disparue », que le validateur signale à juste titre (§60).
  for (const p of Object.values(world.persons)) {
    if (p.contract?.orgId === org.id) p.contract = null;
    if (p.orgId === org.id) {
      p.orgId = null;
      if (p.status !== 'retired' && p.status !== 'staff') p.status = 'inactive';
    }
  }

  for (const teamId of Object.values(org.teams)) {
    const team = world.teams[teamId];
    if (!team) continue;
    team.active = false;
    for (const pid of [...team.roster, ...team.subs]) {
      const p = world.persons[pid];
      if (!p) continue;
      releasePlayer(world, pid, week, 'disparition de la structure');
    }
    if (team.coachId) {
      const coach = world.persons[team.coachId];
      if (coach) coach.teamId = null;
      team.coachId = null;
    }
  }
}
