/**
 * Bilan de carrière (§33, §34, §48, §51, §72).
 *
 * Le score n'est pas une note de réussite : c'est une description en sept
 * dimensions. Une carrière à 74 avec une rivalité de dix ans et un titre
 * arraché est plus mémorable qu'une carrière à 88 sans histoire — et le
 * texte final doit le montrer (§71).
 *
 * Règle absolue : tout ce qui est écrit ici provient de la timeline, des
 * mémoires ou des statistiques. Rien n'est inventé.
 */

import { clamp, norm } from './rng.js';
import { GAMES_BY_ID } from '../data/games.js';
import { STATUS, age as personAge, weightedCeiling } from './person.js';
import { WEEKS_PER_YEAR, yearOf } from './time.js';
import { relationsOf, describeRelation } from './relations.js';
import { ACHIEVEMENTS_BY_ID } from './achievements.js';

const TIER_WEIGHT = { open: 1, qualifier: 2, national: 5, regional: 9, international: 18, worlds: 34 };

export function computeLegacy(world, career) {
  const person = world.persons[career.personId];
  const years = (career.retiredWeek ?? world.week) - career.startWeek;
  const careerYears = years / WEEKS_PER_YEAR;
  const stats = person.stats;

  const titleScore = Object.entries(career.counters.titlesByTier ?? {}).reduce(
    (s, [tier, n]) => s + (TIER_WEIGHT[tier] ?? 1) * n,
    0,
  );
  const winRate = stats.matches > 0 ? stats.wins / stats.matches : 0;

  // --- Les sept dimensions (§33) ---
  const competitive = clamp(
    norm(titleScore, 0, 90) * 55 + norm(stats.peakRating, 45, 95) * 30 + norm(winRate, 0.35, 0.72) * 15,
    0,
    100,
  );

  const longevity = clamp(
    norm(careerYears, 1, 16) * 70 + norm(stats.seasonsPro ?? career.counters.seasonsCompeted, 0, 14) * 30,
    0,
    100,
  );

  const impact = clamp(
    norm(person.reputation.pros, 5, 95) * 55 +
      norm(stats.mvps, 0, 30) * 20 +
      (career.flags.meta_innovator ? 15 : 0) +
      (career.achievements.some((a) => a.id === 'mentor') ? 10 : 0),
    0,
    100,
  );

  const popularity = clamp(
    norm(Math.log10(Math.max(1, person.followers)), 2, 6.4) * 60 + norm(person.reputation.public, 2, 95) * 40,
    0,
    100,
  );

  const innovation = clamp(
    (career.flags.meta_innovator ? 55 : 0) +
      norm(person.attrs.creativity, 40, 95) * 25 +
      norm(career.counters.gamesPlayed.length, 1, 3) * 20,
    0,
    100,
  );

  const leadership = clamp(
    (career.flags.captain ? 35 : 0) +
      norm(person.attrs.leadership, 40, 95) * 40 +
      norm(countProteges(world, career), 0, 3) * 25,
    0,
    100,
  );

  // La légende n'est pas la moyenne des autres : elle récompense les pics et
  // la rareté, pas la régularité.
  const rareAchievements = career.achievements.filter((a) => {
    const def = ACHIEVEMENTS_BY_ID[a.id];
    return def && (def.rarity === 'rare' || def.rarity === 'très rare');
  }).length;
  const legend = clamp(
    norm(titleScore, 0, 120) * 40 +
      norm(rareAchievements, 0, 7) * 30 +
      norm(Math.max(competitive, popularity, impact), 40, 100) * 30,
    0,
    100,
  );

  const dimensions = { competitive, longevity, impact, popularity, innovation, leadership, legend };

  // Formule volontairement non exposée à l'interface (§33).
  const global = clamp(
    competitive * 0.26 +
      legend * 0.2 +
      impact * 0.16 +
      longevity * 0.14 +
      popularity * 0.12 +
      leadership * 0.07 +
      innovation * 0.05,
    0,
    100,
  );

  return {
    dimensions,
    global: Math.round(global),
    careerYears: Math.round(careerYears * 10) / 10,
    titleScore,
    winRate,
    archetype: pickArchetype(world, career, dimensions, { titleScore, careerYears, winRate }),
  };
}

function countProteges(world, career) {
  return relationsOf(world, career.personId)
    .filter((r) => r.tags.includes('protege'))
    .length;
}

/** Archétypes de fin de carrière (§34). Le premier qui matche l'emporte. */
const ARCHETYPES = [
  {
    id: 'goat',
    label: 'GOAT compétitif',
    test: (d, c) => d.competitive > 88 && d.legend > 85 && c.titleScore > 60,
    desc: 'Vous n’êtes pas seulement un champion : vous êtes la référence à laquelle on comparera les autres.',
  },
  {
    id: 'streamer_star',
    label: 'Star devenue créateur',
    test: (d) => d.popularity > 82 && d.popularity > d.competitive + 18,
    desc: 'Le grand public vous connaît mieux que la scène compétitive. Ce n’était pas le plan, mais ça a marché.',
  },
  {
    id: 'meta_creator',
    label: 'Créateur de méta',
    test: (d) => d.innovation > 72,
    desc: 'On joue encore aujourd’hui des choses que vous avez inventées.',
  },
  {
    id: 'legendary_captain',
    label: 'Capitaine légendaire',
    test: (d) => d.leadership > 78 && d.competitive > 55,
    desc: 'Vos équipes jouaient au-dessus de la somme de leurs joueurs. C’était vous.',
  },
  {
    id: 'controversial',
    label: 'Légende controversée',
    test: (d, c, p) => p.reputation.toxicity > 45 && d.legend > 55,
    desc: 'Personne n’est neutre à votre sujet. Y compris ceux qui ont joué avec vous.',
  },
  {
    id: 'eternal_second',
    label: 'Éternel second',
    test: (d, c, p) => p.stats.finals >= 3 && p.stats.titles <= 1,
    desc: 'Vous avez atteint plus de finales que la plupart des champions. Vous en avez perdu presque autant.',
  },
  {
    id: 'eternal_veteran',
    label: 'Vétéran éternel',
    test: (d, c) => c.careerYears >= 12 && d.longevity > 78,
    desc: 'Vous avez vu passer trois générations. Vous étiez encore là quand elles sont parties.',
  },
  {
    id: 'cult_player',
    label: 'Joueur culte',
    test: (d, c, p) => p.reputation.community > 65 && d.competitive < 65,
    desc: 'Vous n’avez pas gagné grand-chose. Votre communauté ne vous a jamais lâché pour autant.',
  },
  {
    id: 'wasted_talent',
    label: 'Grand talent gâché',
    // On compare le pic atteint au plafond POUR SON JEU : comparer une note
    // pondérée au plafond d'une seule famille classait tout le monde comme
    // talent gâché.
    test: (d, c, p) => c.gameCeiling > 82 && p.stats.peakRating < c.gameCeiling - 12,
    desc: 'Tout le monde savait ce que vous auriez pu devenir. C’est bien le problème.',
  },
  {
    id: 'one_hit',
    label: 'Héros d’une seule compétition',
    test: (d, c, p) => p.stats.titles >= 1 && c.careerYears < 6 && d.competitive < 70,
    desc: 'Une compétition, un moment, et une trace définitive dans les archives.',
  },
  {
    id: 'reconverted',
    label: 'Pionnier de sa reconversion',
    test: (d, c) => c.gamesPlayed >= 2 && d.competitive > 55,
    desc: 'Vous avez recommencé de zéro, dans un autre jeu, et vous y êtes arrivé.',
  },
  {
    id: 'journeyman',
    label: 'Joueur sous-estimé',
    test: (d) => d.longevity > 55 && d.competitive > 40 && d.popularity < 45,
    desc: 'Jamais la star. Toujours dans l’équipe. Les entraîneurs savaient pourquoi.',
  },
  {
    id: 'unfinished',
    label: 'Carrière inachevée',
    test: (d, c) => c.careerYears < 4,
    desc: 'Ça n’a pas duré. Ce qui ne veut pas dire que ça n’a pas compté.',
  },
];

function pickArchetype(world, career, dimensions, extra) {
  const person = world.persons[career.personId];
  const game = GAMES_BY_ID[person.gameId];
  const context = {
    ...extra,
    gamesPlayed: career.counters.gamesPlayed.length,
    gameCeiling: game ? weightedCeiling(person, game) : 0,
  };
  for (const a of ARCHETYPES) {
    try {
      if (a.test(dimensions, context, person)) return { id: a.id, label: a.label, desc: a.desc };
    } catch {
      continue;
    }
  }
  return {
    id: 'competitor',
    label: 'Compétiteur',
    desc: 'Une carrière de joueur, avec ses hauts, ses bas, et ce qu’il en reste.',
  };
}

/**
 * Récit de fin de carrière (§72).
 * Construit uniquement à partir d'événements réellement survenus.
 */
export function buildNarrative(world, career, legacy) {
  const person = world.persons[career.personId];
  const parts = [];
  const startYear = yearOf(career.startWeek);
  const endYear = yearOf(career.retiredWeek ?? world.week);
  const firstGame = GAMES_BY_ID[career.counters.gamesPlayed[0]];

  parts.push(
    `En ${startYear}, à ${Math.floor(personAge(person, career.startWeek))} ans, vous commencez sur ${firstGame?.name ?? 'votre premier jeu'}. Personne ne vous connaît.`,
  );

  const important = career.timeline.filter((t) => t.important);

  // Le récit doit se fonder sur les FAITS, pas sur la présence d'une entrée de
  // journal (étape 7G). La version précédente concluait « jamais signé de
  // contrat professionnel » de la seule absence d'une ligne `kind: 'contract'`
  // marquée importante. Or deux chemins mènent à une équipe sans jamais écrire
  // cette ligne : on rejoint une équipe amateur sans rien signer, et le marché
  // des PNJ peut recruter le joueur libre sans passer par une offre. Mesuré,
  // `verifyLegacy` relevait la contradiction dans 3 carrières sur 27.
  //
  // On raconte donc à partir de `teamHistory`, qui distingue désormais un
  // passage sous contrat d'un passage amateur.
  const firstContract = important.find((t) => t.kind === 'contract');
  const passages = person.teamHistory ?? [];
  const sousContrat = passages.filter((h) => h.contract);
  if (firstContract) {
    parts.push(`${firstContract.text} (${firstContract.year})`);
  } else if (sousContrat.length > 0) {
    // Il y a bien eu contrat, mais aucune signature dont le journal ait fait
    // un moment marquant : on dit ce qui s'est passé plutôt que de le nier.
    const premier = sousContrat[0];
    const structures = new Set(sousContrat.map((h) => h.orgName).filter(Boolean));
    parts.push(
      structures.size <= 1
        ? `Vous signez chez ${premier.orgName ?? 'une structure'} en ${yearOf(premier.from)}, sans que cette signature ait jamais fait de bruit.`
        : `Vous signez chez ${premier.orgName ?? 'une structure'} en ${yearOf(premier.from)}, puis dans ${structures.size - 1} autre${structures.size > 2 ? 's' : ''} structure${structures.size > 2 ? 's' : ''}, sans qu'aucun de ces contrats ne marque vraiment votre carrière.`,
    );
  } else if (passages.length > 0) {
    // Aucun contrat, mais des équipes tout de même : nier les deux serait faux.
    const premier = passages[0];
    const structures = new Set(passages.map((h) => h.orgName).filter(Boolean));
    parts.push(
      `Vous n'avez jamais signé de contrat professionnel. Vous aurez tout de même joué sous les couleurs de ${premier.orgName ?? 'une équipe amateur'}${structures.size > 1 ? `, puis de ${structures.size - 1} autre${structures.size > 2 ? 's' : ''}` : ''}, à partir de ${yearOf(premier.from)}.`,
    );
  } else {
    parts.push(`Vous n'avez jamais signé de contrat professionnel, ni porté les couleurs de personne.`);
  }

  const titles = important.filter((t) => t.kind === 'title');
  if (titles.length === 0) {
    // Une carrière entière passée à gagner des opens n'est pas une carrière
    // vide : on le dit, sans pour autant en faire un palmarès.
    const minor = person.stats.minorTitles ?? 0;
    parts.push(
      minor > 0
        ? `Vous n'avez jamais remporté de compétition majeure, mais ${minor} tournois d'entrée portent votre nom.`
        : `Vous n'avez jamais remporté de compétition majeure.`,
    );
  } else if (titles.length === 1) {
    parts.push(`${titles[0].text} (${titles[0].year}) — le seul titre de votre carrière, et vous le savez.`);
  } else {
    parts.push(
      `Vous remportez ${titles.length} compétitions, dont la première en ${titles[0].year} et la dernière en ${titles[titles.length - 1].year}.`,
    );
  }

  const setbacks = important.filter((t) => t.kind === 'setback');
  if (setbacks.length > 0) {
    const worst = setbacks[Math.floor(setbacks.length / 2)];
    parts.push(`Tout n'a pas été droit : ${lowerFirst(worst.text)} (${worst.year}).`);
  }

  const gameChanges = career.timeline.filter((t) => t.kind === 'game' && t.important);
  if (gameChanges.length > 0) {
    parts.push(`${gameChanges[gameChanges.length - 1].text} Ce choix a redéfini la suite.`);
  }

  // Le fil rouge doit avoir duré (étape 7E). Une version antérieure citait le
  // rival dès que `rivalId` existait : mesuré, il était retraité dans quinze cas
  // sur dix-huit, et le bilan présentait comme fil rouge quelqu'un que le joueur
  // n'avait plus croisé depuis une décennie. On raconte maintenant la rivalité
  // la plus longue réellement vécue, active ou éteinte, et on dit ce qu'elle est
  // devenue plutôt que de la figer au présent.
  const rivalites = [
    ...(career.pastRivalries ?? []),
    ...(career.rivalId ? [{ rivalId: career.rivalId, depuis: career.rivalry?.depuis ?? null, raison: null }] : []),
  ]
    .map((r) => ({ ...r, duree: r.depuis ? (r.week ?? world.week) - r.depuis : 0 }))
    .sort((a, b) => b.duree - a.duree);
  const principale = rivalites[0];
  if (principale) {
    const rival = world.persons[principale.rivalId];
    if (rival) {
      const rel = relationsOf(world, person.id).find((r) => r.other === rival.id);
      const state = rel ? describeRelation(rel.value, rel.tags) : 'Rivalité';
      const annees = Math.round(principale.duree / 52);
      const fin = {
        'retraité': ` Il a raccroché avant vous.`,
        'autre scène': ` Il est parti jouer à autre chose.`,
        'réconciliée': ` Vous avez fini par vous entendre.`,
        'disparu': ` On a fini par ne plus en entendre parler.`,
      }[principale.raison] ?? '';
      const duree = annees >= 2 ? ` pendant ${annees} ans` : '';
      parts.push(
        `${rival.nick} aura été le fil rouge de votre carrière${duree}.${fin} État final de la relation : ${state.toLowerCase()}.`,
      );
    }
  }
  if (rivalites.length > 1) {
    parts.push(`Vous aurez eu ${rivalites.length} rivalités déclarées, pas une seule.`);
  }

  const bestMemory = career.memories.find((m) => m.kind === 'title') ?? career.memories[0];
  if (bestMemory) parts.push(`Le moment que vous retiendrez : ${lowerFirst(bestMemory.text)}`);

  parts.push(
    `Vous arrêtez en ${endYear}, après ${legacy.careerYears} ans de carrière, ${person.stats.matches} matchs et ${Math.round(person.stats.earnings).toLocaleString('fr-FR')} € de gains.`,
  );

  // Comment on s'arrête fait partie de l'histoire (étape 8C). Le moteur
  // distingue une fin choisie d'une fin subie — le corps qui lâche, plus
  // personne qui appelle, l'envie qui s'en va — et le bilan n'en disait rien :
  // toutes les carrières se terminaient de la même façon, sur un décompte de
  // matchs. La phrase n'est ajoutée que si la fin a été SUBIE : « vous avez
  // décidé d'arrêter » n'apprend rien à qui vient de décider d'arrêter.
  const finSubie = FINS_SUBIES[career.retirementPath];
  if (finSubie) parts.push(finSubie);
  parts.push(legacy.archetype.desc);

  return parts;
}

/**
 * Les fins que le joueur n'a pas choisies, dites avec les mots de ce qui s'est
 * réellement passé. Les clés sont exactement celles que `maybeRetire` pose.
 */
export const FINS_SUBIES = {
  'usure':
    'Vous n’avez pas décidé d’arrêter. L’envie était partie depuis longtemps, et un jour vous n’êtes pas revenu.',
  'plus aucune équipe intéressée':
    'Vous n’avez pas décidé d’arrêter. Plus personne n’appelait, et à un moment il a bien fallu l’admettre.',
  'sortie de la compétition':
    'Vous n’avez pas décidé d’arrêter. La compétition a continué sans vous, des années, jusqu’à ce que revenir n’ait plus de sens.',
  'charge accumulée':
    'Vous n’avez pas décidé d’arrêter. Le corps a lâché avant la tête, et il n’a plus suivi.',
  'âge':
    'Vous avez tenu jusqu’au bout de ce que ce métier permet.',
};

function lowerFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** Carte de partage (§51). */
export function buildShareCard(world, career, legacy) {
  const person = world.persons[career.personId];
  const lines = [];
  lines.push(`${person.nick.toUpperCase()} — ${legacy.archetype.label.toUpperCase()}`);
  lines.push('');
  lines.push(`${legacy.careerYears} ans de carrière`);
  const worldTitles = career.counters.titlesByTier.worlds ?? 0;
  if (worldTitles > 0) lines.push(`${worldTitles}× Champion du monde`);
  const intl = career.counters.titlesByTier.international ?? 0;
  if (intl > 0) lines.push(`${intl}× Titre international`);
  if (person.stats.titles > 0) lines.push(`${person.stats.titles} titres au total`);
  if (person.stats.mvps > 0) lines.push(`${person.stats.mvps}× MVP`);
  lines.push(`${career.counters.orgsPlayed.length || 1} organisation(s)`);
  if (career.counters.gamesPlayed.length > 1) lines.push(`${career.counters.gamesPlayed.length} jeux`);
  if (career.rivalId && world.persons[career.rivalId]) {
    lines.push(`Rival : ${world.persons[career.rivalId].nick}`);
  }
  lines.push(`Peak : ${Math.round(person.stats.peakRating)}`);
  lines.push(`Legacy : ${legacy.global}/100`);
  return lines;
}

/** Statistiques détaillées (§67). */
export function careerStats(world, career) {
  const person = world.persons[career.personId];
  const s = person.stats;
  return {
    matches: s.matches,
    wins: s.wins,
    losses: s.losses,
    winRate: s.matches > 0 ? s.wins / s.matches : 0,
    titles: s.titles,
    finals: s.finals,
    mvps: s.mvps,
    earnings: s.earnings,
    peakRating: Math.round(s.peakRating * 10) / 10,
    peakYear: s.peakWeek ? yearOf(s.peakWeek) : null,
    games: career.counters.gamesPlayed.map((id) => GAMES_BY_ID[id]?.shortName ?? id),
    orgs: career.counters.orgsPlayed.length,
    followers: person.followers,
    reputation: person.reputation,
    seasons: career.counters.seasonsCompeted,
  };
}

/** Options offertes après la retraite (§49). */
export function postCareerOptions(world, career) {
  const person = world.persons[career.personId];
  const options = [];
  if (person.attrs.leadership > 55 || person.attrs.communication > 60) {
    options.push({ id: 'coach', label: 'Devenir coach', desc: 'Encadrer une équipe et transmettre.' });
  }
  if (person.followers > 25000) {
    options.push({ id: 'creator', label: 'Créateur à plein temps', desc: 'Vivre de votre audience.' });
  }
  if (person.stats.earnings > 250000) {
    options.push({ id: 'owner', label: 'Fonder une organisation', desc: 'Monter votre structure.' });
  }
  options.push({ id: 'analyst', label: 'Analyste', desc: 'Commenter et analyser la scène.' });
  options.push({ id: 'retire_fully', label: 'Tourner la page', desc: 'Quitter complètement l’écosystème.' });
  return options;
}
