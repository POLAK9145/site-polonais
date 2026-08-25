/**
 * Vues (view-models) construites à partir de l'état de simulation.
 *
 * L'interface ne lit jamais directement le monde : elle consomme ces objets.
 * Cela garantit qu'aucun écran ne peut afficher une information que le moteur
 * ne produit pas réellement (§83) — et permet de tester l'affichage sans
 * navigateur.
 */

import { clamp } from './rng.js';
import { GAMES_BY_ID } from '../data/games.js';
import { REGIONS_BY_ID } from '../data/regions.js';
import { TRAITS_BY_ID } from '../data/traits.js';
import { PHILOSOPHIES_BY_ID, ORG_TIERS_BY_TIER } from '../data/orgs.js';
import { ACHIEVEMENTS_BY_ID } from './achievements.js';
import {
  STATUS_LABELS,
  age as personAge,
  baseRating,
  effectiveRating,
  profile,
  estimatedPotential,
  overallReputation,
  displayName,
  mods,
  STATUS,
} from './person.js';
import { ATTRIBUTE_GROUPS, starString, toStars } from './attributes.js';
import { formatDate, formatPhase, yearOf, weekOfYear, isTransferWindow, WEEKS_PER_YEAR } from './time.js';
import { teamStrength, rosterPersons, teamNeeds } from './team.js';
import { metaLabel, patchLabel } from './meta.js';
import { relationsOf, describeRelation, REL_TAG_LABELS, rivalryStatus } from './relations.js';
import { sortedStandings } from './competition.js';
import { currentCompetitionsFor, seasonRankingFor } from './season.js';
import { describeOffer, OBJECTIVE_LABELS } from './transfers.js';
import { lifestyleOf, difficultyOf } from './career.js';
import { FINS_SUBIES } from './legacy.js';
import {
  LOAD_STATES,
  weeklyIntensity,
  equilibriumLoad,
  stateAt,
  crashRisk,
} from './load.js';
import { audienceCeiling, effectiveRoutineOf } from './simulation.js';
import { routineVolume, restSlotsOf } from './progression.js';

export function formatMoney(v) {
  const n = Math.round(v);
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)} M€`;
  if (Math.abs(n) >= 10000) return `${Math.round(n / 1000)} k€`;
  return `${n.toLocaleString('fr-FR')} €`;
}

export function formatFollowers(v) {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)} M`;
  if (v >= 1000) return `${Math.round(v / 1000)} k`;
  return String(Math.round(v));
}

/** En-tête permanent : tout ce qui doit rester visible en continu (§64). */
export function headerView(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  const game = GAMES_BY_ID[person.gameId];
  const team = person.teamId ? world.teams[person.teamId] : null;
  const org = team ? world.orgs[team.orgId] : null;
  const gameState = world.gameStates[person.gameId];

  return {
    nick: person.nick,
    fullName: `${person.firstName} ${person.lastName}`,
    country: person.country,
    region: REGIONS_BY_ID[person.regionId]?.label ?? '—',
    age: Math.floor(personAge(person, world.week)),
    date: formatDate(world.week),
    year: yearOf(world.week),
    week: weekOfYear(world.week),
    phase: formatPhase(world.week),
    transferWindow: isTransferWindow(world.week),
    game: game?.name ?? '—',
    gameShort: game?.shortName ?? '—',
    patch: gameState ? patchLabel(gameState) : '—',
    meta: gameState ? metaLabel(gameState) : '—',
    team: org && !org.isSelfOrg ? org.name : null,
    teamTier: org && !org.isSelfOrg ? ORG_TIERS_BY_TIER[org.tier]?.label : null,
    status: STATUS_LABELS[person.status] ?? person.status,
    rating: Math.round(baseRating(person, game)),
    form: Math.round(person.form),
    morale: Math.round(person.morale),
    fatigue: Math.round(person.fatigue),
    stress: Math.round(person.stress),
    money: career.money,
    moneyLabel: formatMoney(career.money),
    followers: person.followers,
    followersLabel: formatFollowers(person.followers),
    reputation: person.reputation,
    salary: person.contract?.salary ?? 0,
    contractEndsIn: person.contract ? Math.max(0, Math.round((person.contract.endWeek - world.week) / 52 * 10) / 10) : null,
    retired: career.retired,
    difficulty: difficultyOf(career).label,
    lifestyle: lifestyleOf(career).label,
  };
}

/**
 * La charge, telle que le joueur peut la ressentir (étape 8A).
 *
 * POURQUOI CETTE VUE EXISTE
 * -------------------------
 * La charge accumulée divise la progression (jusqu'à −62 %), ronge le moral, et
 * met fin à la carrière : mesuré sur 108 carrières, 13 % atteignent « surmené »
 * ou pire, 10 % connaissent un burnout déclaré, et 14 % se terminent en usure.
 * Jusqu'ici, aucun écran ne la montrait. Le joueur choisissait quatre créneaux
 * par semaine sans savoir qu'il accumulait ce qui allait le casser — une
 * punition sans avertissement, ce que le §83 interdit.
 *
 * CE QU'ELLE MONTRE, ET CE QU'ELLE NE MONTRE PAS
 * ----------------------------------------------
 * Elle montre ce qu'un joueur sait de son propre corps : dans quel état il est,
 * si ça monte ou si ça descend, et ce qui pèse. Elle ne révèle aucune donnée
 * cachée — les plafonds d'attributs, eux, restent invisibles.
 *
 * `intensite` est LUE sur `load.lastIntensity`, que le moteur enregistre au
 * moment où il l'applique : l'interface ne peut pas afficher une charge que la
 * simulation n'a pas subie. La projection, elle, appelle `equilibriumLoad`,
 * c'est-à-dire l'inversion de la loi d'accumulation du moteur — pas une courbe
 * approchée qui finirait par mentir.
 */
export function loadView(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  const load = person.load ?? null;
  if (!load) return null;

  const valeur = Math.round(load.value);
  const etat = load.state;

  // Ce que la semaine écoulée, répétée telle quelle, finit par produire.
  //
  // Les cinq entrées sont des FAITS enregistrés par le moteur au moment où il
  // les a appliqués — volume, matchs, pression, sensibilité, récupération — et
  // non un contexte reconstitué après coup. Les deux premières tentatives
  // recalculaient : elles se trompaient de semaine une fois sur trente, parce
  // que la pression et l'équipe bougent PENDANT la semaine. Un écart invisible
  // est un mensonge tranquille, et le test 1 le rend impossible.
  const ctx = {
    rawFatigue: load.lastVolume ?? 0,
    matchLoad: load.lastMatchLoad ?? 0,
    pressure: load.lastPressure ?? 0,
    sensitivity: mods(person).burnoutRisk,
    restSlots: load.lastRestSlots ?? 0,
  };
  const { raw, factors } = weeklyIntensity(person, ctx);
  const cible = equilibriumLoad(person, raw);
  const etatCible = stateAt(cible);

  // Monte, tient, ou redescend : la seule chose que le joueur a besoin de
  // savoir pour arbitrer, et elle se déduit de la comparaison avec la cible.
  const ecart = cible - load.value;
  const tendance = ecart > 3 ? 'monte' : ecart < -3 ? 'descend' : 'stable';

  const risque = crashRisk(person);

  return {
    valeur,
    etat,
    label: ETIQUETTES_CHARGE[etat] ?? etat,
    // L'intensité réellement appliquée la semaine dernière (un fait).
    intensite: Math.round((load.lastIntensity ?? 0) * 10) / 10,
    // La même, recomposée par la vue. Elle n'est pas affichée : elle existe
    // pour qu'un test puisse constater que l'assemblage n'a pas dérivé. Elle
    // n'est donc pas arrondie — l'arrondir consommait un tiers de la tolérance
    // du test avant même de comparer quoi que ce soit.
    intensiteProjetee: raw,
    // Et ce que la routine actuelle vise, si rien ne change.
    cible: Math.round(cible),
    etatCible,
    labelCible: ETIQUETTES_CHARGE[etatCible] ?? etatCible,
    tendance,
    tenable: cible < 63,
    eleve: etat === LOAD_STATES.OVERLOADED || etat === LOAD_STATES.DRAINED || etat === LOAD_STATES.BURNOUT,
    // Risque hebdomadaire de rupture, en clair. Zéro tant qu'on n'est pas haut.
    risqueRupture: Math.round(risque * 1000) / 10,
    semainesDansEtat: load.weeksInState,
    serieChargee: load.heavyStreak,
    episodes: load.episodes ?? 0,
    pic: Math.round(load.peak),
    // Ce qui pèse, dans l'ordre. Les entrées à delta nul sont des modulateurs
    // (sensibilité, repos) : on les garde, elles expliquent autant.
    facteurs: factors.map((f) => ({ key: f.key, label: f.label, delta: f.delta })),
    conseil: conseilCharge(etat, tendance, cible),
  };
}

/**
 * Ce qu'une routine ENVISAGÉE coûterait, à contexte égal (étape 8A).
 *
 * `loadView` décrit ce qui est ; celle-ci répond à « et si je changeais ? ».
 * C'est une hypothèse, et elle est construite comme telle : on ne bouge que ce
 * que le joueur contrôle — le volume d'entraînement et les créneaux de
 * récupération — et on garde tel quel ce qu'il subit, c'est-à-dire le rythme de
 * compétition, la pression de sa structure et sa sensibilité propre. Changer
 * aussi ces trois-là produirait un joli chiffre sans rapport avec sa situation.
 *
 * La projection reste donc juste tant que le contexte ne change pas, ce que le
 * libellé doit dire — et pas laisser croire à une promesse.
 */
export function routineOutlook(session, routine) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  const load = person.load;
  if (!load) return null;
  const team = person.teamId ? world.teams[person.teamId] : null;
  const effective = effectiveRoutineOf(routine, team);

  const { raw } = weeklyIntensity(person, {
    rawFatigue: routineVolume(effective),
    restSlots: restSlotsOf(effective),
    // Subi, donc inchangé.
    matchLoad: load.lastMatchLoad ?? 0,
    pressure: load.lastPressure ?? 0,
    sensitivity: mods(person).burnoutRisk,
  });
  const cible = equilibriumLoad(person, raw);
  const etatCible = stateAt(cible);
  // Les créneaux impossibles ont été retirés : le joueur doit le savoir, sinon
  // on lui annonce le coût d'une routine qu'il ne fera pas.
  const ignores = (routine ?? []).length - effective.length;

  return {
    cible: Math.round(cible),
    etatCible,
    labelCible: ETIQUETTES_CHARGE[etatCible] ?? etatCible,
    tenable: cible < 63,
    dangereux: cible >= 79,
    // Écart avec la charge actuelle : c'est l'arbitrage, pas la valeur absolue.
    ecart: Math.round(cible - load.value),
    creneauxIgnores: ignores > 0 ? ignores : 0,
  };
}

const ETIQUETTES_CHARGE = {
  [LOAD_STATES.FRESH]: 'Frais',
  [LOAD_STATES.TIRED]: 'Fatigué',
  [LOAD_STATES.PRESSURED]: 'Sous pression',
  [LOAD_STATES.OVERLOADED]: 'Surmené',
  [LOAD_STATES.DRAINED]: 'Épuisé',
  [LOAD_STATES.BURNOUT]: 'Burnout',
  [LOAD_STATES.RECOVERING]: 'Récupération',
};

/**
 * Une phrase, pas un diagnostic. Elle dit ce qui se passe si rien ne change,
 * et rien de plus : le joueur décide.
 */
function conseilCharge(etat, tendance, cible) {
  if (etat === LOAD_STATES.BURNOUT) return 'Vous avez craqué. Rien ne repartira tant que vous n’aurez pas récupéré.';
  if (etat === LOAD_STATES.RECOVERING) return 'Vous remontez. Reprendre trop vite vous y ramènera.';
  if (cible >= 79) return 'Cette routine ne tient pas. À ce rythme, vous finirez par craquer.';
  if (cible >= 63) return 'Cette routine vous mène au surmenage. Tenable quelques mois, pas des années.';
  if (tendance === 'monte') return 'Ça monte. Vous n’êtes pas encore en danger, mais vous montez.';
  if (tendance === 'descend') return 'Vous récupérez.';
  return 'Vous tenez ce rythme sans vous abîmer.';
}

/** Profil détaillé : les 6 familles, sans jamais révéler les plafonds réels. */
export function profileView(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  const game = GAMES_BY_ID[person.gameId];
  const averages = profile(person);
  const estimate = estimatedPotential(person, game, hashOf(person.id));

  return {
    groups: ATTRIBUTE_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      short: g.short,
      value: Math.round(averages[g.id]),
      weightInGame: Math.round((game.weights[g.id] ?? 0) * 100),
      attrs: g.attrs.map((a) => ({
        id: a.id,
        label: a.label,
        value: Math.round(person.attrs[a.id]),
        key: game.keyAttrs?.includes(a.id) ?? false,
      })),
    })),
    traits: person.traits.map((id) => ({
      id,
      label: TRAITS_BY_ID[id]?.label ?? id,
      desc: TRAITS_BY_ID[id]?.desc ?? '',
    })),
    role: game.roles?.find((r) => r.id === person.roleId)?.label ?? null,
    familiarity: Math.round((person.familiarity[person.gameId] ?? 0) * 100),
    // Estimation, jamais la valeur exacte (§7).
    potentialStars: starString(estimate.stars),
    potentialConfidence: Math.round(estimate.confidence * 100),
    metaShock: Math.round(person.metaShock ?? 0),
    audienceCeiling: audienceCeiling(person),
    reputationBars: [
      { label: 'Professionnels', value: Math.round(person.reputation.pros) },
      { label: 'Grand public', value: Math.round(person.reputation.public) },
      { label: 'Communauté', value: Math.round(person.reputation.community) },
      { label: 'Médias', value: Math.round(person.reputation.media) },
      { label: 'Controverse', value: Math.round(person.reputation.toxicity), negative: true },
    ],
  };
}

function hashOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/** L'équipe actuelle, ses coéquipiers, sa cohésion et son classement. */
export function teamView(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  if (!person.teamId) return null;
  const team = world.teams[person.teamId];
  if (!team) return null;
  const org = world.orgs[team.orgId];
  const game = GAMES_BY_ID[team.gameId];
  const strength = teamStrength(world, team, { forMatch: false });
  const comps = currentCompetitionsFor(world, team.id);

  return {
    orgName: org?.name ?? '—',
    tag: org?.tag ?? '',
    isSelf: !!org?.isSelfOrg,
    foundedByPlayer: !!org?.foundedByPlayer,
    tier: org?.tier ?? 1,
    tierLabel: ORG_TIERS_BY_TIER[org?.tier ?? 1]?.label ?? '',
    philosophy: PHILOSOPHIES_BY_ID[org?.philosophy]?.label ?? '',
    budget: formatMoney(org?.budget ?? 0),
    division: team.division === 'league' ? 'Ligue' : 'Circuit amateur',
    synergy: Math.round(team.synergy),
    synergyLabel: synergyLabel(team.synergy),
    strength: Math.round(strength.strength),
    coach: team.coachId ? displayName(world.persons[team.coachId]) : null,
    season: { ...team.season },
    titles: team.titles,
    minorTitles: team.minorTitles ?? 0,
    benched: team.subs.includes(person.id),
    roster: rosterPersons(world, team).map((p) => ({
      id: p.id,
      nick: p.nick,
      isPlayer: p.isPlayer,
      age: Math.floor(personAge(p, world.week)),
      role: game.roles?.find((r) => r.id === p.roleId)?.label ?? '—',
      rating: Math.round(baseRating(p, game)),
      form: Math.round(p.form),
      relation: p.isPlayer ? null : relationSummary(world, person.id, p.id),
    })),
    competitions: comps.map((c) => ({
      id: c.id,
      name: c.name,
      tier: c.tierId,
      standings:
        c.kind === 'league'
          ? sortedStandings(c)
              .slice(0, 8)
              .map((s, i) => ({
                rank: i + 1,
                team: world.orgs[world.teams[s.teamId]?.orgId]?.name ?? '?',
                wins: s.wins,
                losses: s.losses,
                isMine: s.teamId === team.id,
              }))
          : null,
    })),
  };
}

function synergyLabel(s) {
  if (s >= 78) return 'Symbiose';
  if (s >= 64) return 'Très soudée';
  if (s >= 50) return 'Correcte';
  if (s >= 36) return 'Fragile';
  if (s >= 22) return 'Tendue';
  return 'Au bord de la rupture';
}

function relationSummary(world, aId, bId) {
  const rel = relationsOf(world, aId).find((r) => r.other === bId);
  if (!rel) return { label: 'Neutre', value: 0, tags: [] };
  return {
    label: describeRelation(rel.value, rel.tags),
    value: Math.round(rel.value),
    tags: rel.tags.map((t) => REL_TAG_LABELS[t] ?? t),
  };
}

/** Relations importantes, avec leur historique daté (§15). */
export function relationsView(session, { limit = 12 } = {}) {
  const { world, career } = session;
  return relationsOf(world, career.personId, { minAbs: 6 })
    .slice(0, limit)
    .map((rel) => {
      const other = world.persons[rel.other];
      if (!other) return null;
      return {
        id: other.id,
        nick: other.nick,
        name: `${other.firstName} ${other.lastName}`,
        age: Math.floor(personAge(other, world.week)),
        status: STATUS_LABELS[other.status] ?? other.status,
        team: other.orgId ? world.orgs[other.orgId]?.name ?? null : null,
        game: GAMES_BY_ID[other.gameId]?.shortName ?? '—',
        value: Math.round(rel.value),
        label: describeRelation(rel.value, rel.tags),
        tags: rel.tags.map((t) => REL_TAG_LABELS[t] ?? t),
        isRival: career.rivalId === other.id,
        history: rel.history
          .slice(-8)
          .map((h) => ({ date: formatDate(h.week), text: h.text, important: h.important })),
      };
    })
    .filter(Boolean);
}

/**
 * La rivalité, vue du joueur (étape 8E).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * Le moteur en sait beaucoup — qui, depuis quand, combien d'affrontements,
 * comment elle s'est éteinte — et il archive les rivalités passées. 85 % des
 * carrières en connaissent une. L'interface, elle, affichait une liste plate de
 * relations où le rival n'était qu'une bordure de couleur. Le fil rouge d'une
 * carrière, que le bilan final raconte à la retraite, était invisible PENDANT
 * qu'on le vivait.
 *
 * Renvoie `null` s'il n'y a jamais rien eu : une carrière sans rival est une
 * carrière sans rival, et l'écran doit le dire plutôt que d'inventer.
 */
export function rivalryView(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  const statut = rivalryStatus(world, person, career);
  const passees = career.pastRivalries ?? [];
  if (!statut.rival && passees.length === 0) return null;

  const anneesDepuis = (depuis) =>
    depuis == null ? null : Math.round(((world.week - depuis) / WEEKS_PER_YEAR) * 10) / 10;

  const enCours = statut.vivante && statut.rival
    ? {
        nick: statut.rival.nick,
        id: statut.rival.id,
        depuis: yearOf(career.rivalry?.depuis ?? world.week),
        annees: anneesDepuis(career.rivalry?.depuis) ?? 0,
        // Tension : ce que vaut la relation, du côté négatif. Une rivalité
        // respectueuse et une rancune tenace ne se racontent pas pareil.
        tension: Math.round(statut.tension ?? 0),
        valeur: Math.round(statut.valeur ?? 0),
        label: describeRelation(statut.valeur ?? 0, ['rival']),
        confrontations: career.rivalry?.confrontations ?? 0,
        victoires: career.rivalry?.victoires ?? 0,
        equipe: statut.rival.orgId ? world.orgs[statut.rival.orgId]?.name ?? null : null,
        niveau: Math.round(baseRating(statut.rival, GAMES_BY_ID[statut.rival.gameId])),
        // Le rival est-il devant ou derrière ? C'est la question qu'on se pose.
        ecart: Math.round(
          baseRating(statut.rival, GAMES_BY_ID[statut.rival.gameId]) -
            baseRating(person, GAMES_BY_ID[person.gameId]),
        ),
      }
    : null;

  return {
    enCours,
    // Une rivalité éteinte mais non archivée : le rival existe encore, la
    // tension est retombée. On le dit, plutôt que de la faire disparaître.
    finieMaisRecente: !statut.vivante && statut.rival && statut.raison !== 'aucune'
      ? { nick: statut.rival.nick, raison: statut.raison }
      : null,
    passees: passees.map((r) => ({
      nick: world.persons[r.rivalId]?.nick ?? 'un adversaire',
      raison: r.raison,
      annee: yearOf(r.week),
      duree: r.depuis != null ? Math.round(((r.week - r.depuis) / WEEKS_PER_YEAR) * 10) / 10 : null,
      confrontations: r.confrontations ?? 0,
      victoires: r.victoires ?? 0,
    })),
    total: passees.length + (enCours ? 1 : 0),
  };
}

/** Page Monde (§66). */
export function worldView(session, { gameId = null } = {}) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  const focusGame = gameId ?? person.gameId;

  const games = Object.values(world.gameStates)
    .map((gs) => {
      const game = GAMES_BY_ID[gs.gameId];
      return {
        id: gs.gameId,
        name: game.name,
        shortName: game.shortName,
        genre: game.genre,
        popularity: Math.round(gs.popularity),
        alive: gs.alive,
        patch: patchLabel(gs),
        meta: metaLabel(gs),
        sceneAge: Math.round(gs.sceneAgeYears),
        isCurrent: gs.gameId === person.gameId,
      };
    })
    .sort((a, b) => b.popularity - a.popularity);

  const teams = Object.values(world.teams)
    .filter((t) => t.active && t.gameId === focusGame && !world.orgs[t.orgId]?.isSelfOrg)
    .map((t) => ({
      id: t.id,
      name: world.orgs[t.orgId]?.name ?? '?',
      region: REGIONS_BY_ID[world.orgs[t.orgId]?.regionId]?.short ?? '—',
      tier: world.orgs[t.orgId]?.tier ?? 1,
      strength: Math.round(teamStrength(world, t, { forMatch: false }).strength),
      titles: t.titles,
      isMine: t.id === person.teamId,
    }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 16);

  const players = Object.values(world.persons)
    .filter((p) => p.gameId === focusGame && p.status !== STATUS.RETIRED && p.status !== STATUS.STAFF)
    .map((p) => ({
      id: p.id,
      nick: p.nick,
      age: Math.floor(personAge(p, world.week)),
      team: p.orgId ? world.orgs[p.orgId]?.name ?? null : null,
      rating: Math.round(baseRating(p, GAMES_BY_ID[focusGame])),
      titles: p.stats.titles,
      isPlayer: p.isPlayer,
    }))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 20);

  const ranking = seasonRankingFor(world, focusGame, 10).map((r) => ({
    name: world.orgs[world.teams[r.teamId]?.orgId]?.name ?? '?',
    points: r.points,
    isMine: r.teamId === person.teamId,
  }));

  return {
    focusGame,
    games,
    teams,
    players,
    ranking,
    news: filActualite(world, career, person),
  };
}

/** Page Statistiques (§67). */
/**
 * Le fil d'actualité tel qu'il arrive au joueur (étape 8F).
 *
 * Mesuré sur une carrière de dix ans, le fil brut contenait 51 % de promotions,
 * 38 % de notes de patch, une seule retraite sur les quelque quatre cents que
 * le monde produit, et AUCUN titre. Les quatorze dépêches affichées étaient
 * régulièrement sept notes de patch d'affilée, pour des scènes auxquelles le
 * joueur ne joue même pas.
 *
 * Deux corrections, sans rien masquer d'important :
 *
 *   1. Un patch ne concerne que ceux qui jouent la scène. Ceux des autres jeux
 *      sont écartés — ce n'est pas votre actualité, c'est du décor.
 *   2. Les dépêches marquées `important` — titres majeurs, retraites qui
 *      comptent, organisations et scènes qui meurent — ne peuvent pas être
 *      chassées de l'écran par une rafale de promotions. On garde d'abord les
 *      plus récentes d'entre elles, puis on complète avec le reste.
 */
function filActualite(world, career, person, limite = 14) {
  const scenesConnues = new Set([person.gameId, ...(career.counters?.gamesPlayed ?? [])]);
  const pertinent = [...world.news].filter((n) => {
    // Ce qui se passe sur les scènes du joueur le concerne toujours. Ailleurs,
    // seules les nouvelles d'envergure mondiale lui parviennent : un titre
    // international, la disparition d'une scène, un joueur de rang mondial qui
    // raccroche. Un split régional ou un patch sur un jeu auquel il ne touche
    // pas, non — c'est du décor, et le décor chassait l'essentiel de l'écran.
    if (!n.gameId || scenesConnues.has(n.gameId)) return true;
    return n.portee === 'monde';
  });

  const parRecence = (a, b) => b.week - a.week;
  const importantes = pertinent.filter((n) => n.important).sort(parRecence);
  const autres = pertinent.filter((n) => !n.important).sort(parRecence);

  // Au moins la moitié de la place réservée à ce qui compte, sans lui donner
  // toute la place : une saison où rien de notable n'arrive doit rester lisible.
  //
  // La sélection se fait AVANT le tri d'affichage. Une première version
  // réservait les places puis retriait l'ensemble par date, ce qui annulait la
  // réservation : quarante promotions arrivées la même semaine — ce qui se
  // produit à chaque fin de saison — repoussaient les sept dépêches
  // importantes hors de l'écran. Le test l'a prise en flagrant délit, 7 → 0.
  const placesImportantes = Math.ceil(limite / 2);
  const tete = importantes.slice(0, placesImportantes);
  const reste = autres.slice(0, limite - tete.length);
  const retenues = [...tete, ...reste].sort(parRecence);

  return retenues.map((n) => ({
    date: formatDate(n.week),
    headline: n.headline,
    body: n.body,
    tone: n.tone ?? 'neutral',
    important: !!n.important,
  }));
}

export function statsView(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  const s = person.stats;
  return {
    matches: s.matches,
    wins: s.wins,
    losses: s.losses,
    winRate: s.matches > 0 ? Math.round((s.wins / s.matches) * 100) : 0,
    titles: s.titles,
    // Le circuit d'entrée compte à part : on ne le cache pas, on ne le
    // confond pas avec un palmarès national.
    minorTitles: s.minorTitles ?? 0,
    finals: s.finals,
    mvps: s.mvps,
    internationalTitles: s.internationalTitles,
    earnings: formatMoney(s.earnings),
    peakRating: Math.round(s.peakRating),
    peakYear: s.peakWeek ? yearOf(s.peakWeek) : null,
    seasonsPro: s.seasonsPro,
    games: career.counters.gamesPlayed.map((id) => GAMES_BY_ID[id]?.shortName ?? id),
    orgs: career.counters.orgsPlayed.length,
    decisions: career.counters.decisions,
    timesReleased: career.counters.timesReleased,
    followers: formatFollowers(person.followers),
    achievements: career.achievements.map((a) => ({
      id: a.id,
      year: a.year,
      ...(ACHIEVEMENTS_BY_ID[a.id] ?? { label: a.id, desc: '', rarity: 'commun' }),
    })),
    lockedAchievements: Object.values(ACHIEVEMENTS_BY_ID)
      .filter((a) => !career.achievements.some((x) => x.id === a.id))
      .map((a) => ({ id: a.id, label: a.label, desc: a.desc, rarity: a.rarity })),
  };
}

/** Timeline de carrière (§65). */
/**
 * La carrière année par année.
 *
 * Deux lectures, parce que ce ne sont pas les mêmes questions (étape 8B) :
 *
 *   `complet` — tout, dans l'ordre. C'est un journal de bord.
 *   `fiche`   — ce qui a compté, plus une ligne de résumé par saison.
 *
 * Mesuré sur 18 carrières de 25 ans : la timeline compte 167 entrées en
 * médiane et jusqu'à 489, dont **57,5 % de simples résultats de match**. Tout
 * afficher dans le bilan final donnait une page de seize mille pixels où le
 * titre gagné pesait autant, visuellement, que le 312ᵉ match de poule. Le
 * commentaire d'`addMemory` prévoyait d'ailleurs le cas depuis le début :
 * « conservé même quand la timeline est résumée ».
 *
 * Rien n'est perdu : le mode `complet` reste à un clic. Résumer n'est pas
 * cacher — c'est refuser que l'essentiel pèse autant que le reste.
 */
export function timelineView(session, { mode = 'complet' } = {}) {
  const { career } = session;
  const byYear = new Map();
  for (const entry of career.timeline) {
    if (!byYear.has(entry.year)) byYear.set(entry.year, { entries: [], matchs: 0, victoires: 0 });
    const annee = byYear.get(entry.year);
    if (entry.kind === 'match') {
      annee.matchs++;
      if (entry.data?.won) annee.victoires++;
    }
    // En mode fiche, les matchs sans enjeu sont comptés mais pas listés. Ceux
    // que le moteur a marqués « importants » restent, eux, à leur place.
    if (mode === 'fiche' && entry.kind === 'match' && !entry.important) continue;
    annee.entries.push({
      date: formatDate(entry.week),
      text: entry.text,
      kind: entry.kind,
      important: entry.important,
    });
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, a]) => ({
      year,
      entries: a.entries,
      // Ce que les matchs de la saison ont donné, une fois qu'on ne les liste
      // plus un par un. `null` quand il n'y en a pas eu : une saison sans
      // compétition ne doit pas afficher « 0 match, 0 % ».
      resume:
        a.matchs > 0
          ? { matchs: a.matchs, victoires: a.victoires, taux: Math.round((a.victoires / a.matchs) * 100) }
          : null,
    }));
}

/**
 * Les moments marquants.
 *
 * Mesuré : jusqu'à 82 par carrière. Au-delà d'une poignée, le mot ne veut plus
 * rien dire. On les classe donc par ce qu'ils pèsent réellement — un titre ou
 * une rupture marquent une carrière, un bon tournoi la ponctue — sans en
 * supprimer aucun : l'interface montre les premiers et propose le reste.
 */
const POIDS_SOUVENIR = {
  title: 5,
  crisis: 5,
  comeback: 4,
  rivalry: 4,
  betrayal: 4,
  duo: 3,
  transfer: 2,
  media: 1,
};

export function memoriesView(session) {
  // Un même moment peut revenir : trois épisodes de surmenage, deux titres sur
  // le même circuit. Classés par poids, ces doublons se retrouvaient côte à
  // côte, mot pour mot — « La rupture · 2031 », « La rupture · 2032 »,
  // « La rupture · 2034 ». Avoir craqué trois fois est un fait qui compte, mais
  // il se dit une fois, avec ses dates.
  const groupes = new Map();
  session.career.memories.forEach((m, index) => {
    const cle = `${m.kind}|${m.title}|${m.text}`;
    const existant = groupes.get(cle);
    if (existant) {
      existant.annees.push(m.year);
      return;
    }
    groupes.set(cle, { m, index, annees: [m.year] });
  });

  return [...groupes.values()]
    .sort((a, b) => {
      const pa = POIDS_SOUVENIR[a.m.kind] ?? 2;
      const pb = POIDS_SOUVENIR[b.m.kind] ?? 2;
      // À poids égal, l'ordre chronologique : une carrière se raconte dans le
      // sens où elle a été vécue.
      return pb - pa || a.index - b.index;
    })
    .map(({ m, annees }) => ({
      year: m.year,
      // Toutes les années où ce moment s'est produit, la première comprise.
      annees,
      occurrences: annees.length,
      kind: m.kind,
      title: m.title,
      text: m.text,
    }));
}

/** Offres en attente, avec leurs facteurs explicables (§45, §59). */
export function offersView(session) {
  const { world, career } = session;
  return (career.offers ?? []).map((offer, index) => {
    const described = describeOffer(world, offer);
    return {
      index,
      ...described,
      salaryLabel: offer.salary > 0 ? formatMoney(offer.salary) + ' / an' : 'Aucun salaire',
      years: offer.years,
      roleLabel: offer.role === 'starter' ? 'Titulaire' : 'Remplaçant',
      pressureLabel: pressureLabel(offer.pressure ?? 0.3),
      factors: (offer.factors ?? []).map((f) => ({
        label: f.label,
        delta: Math.round(f.delta),
      })),
    };
  });
}

function pressureLabel(p) {
  if (p >= 0.85) return 'Obligation de résultat';
  if (p >= 0.6) return 'Attentes élevées';
  if (p >= 0.35) return 'Attentes mesurées';
  return 'Aucune pression';
}

/** Objectifs vivants, déduits de l'état réel (§35). */
export function goalsView(session) {
  const { world, career } = session;
  const person = world.persons[career.personId];
  const goals = [];

  if (!person.teamId || world.teams[person.teamId]?.isSelfTeam) {
    goals.push({ label: 'Trouver une équipe', done: false, hint: 'Démarchez ou montez votre propre roster.' });
  }
  if (!person.contract) {
    goals.push({ label: 'Décrocher un premier contrat', done: false });
  } else if (person.status !== STATUS.PRO) {
    goals.push({ label: 'Passer professionnel', done: false, hint: 'Rejoignez une structure de tier 3 ou plus.' });
  }
  if (person.stats.titles === 0) {
    goals.push({ label: 'Remporter une première compétition', done: false });
  } else if ((career.counters.titlesByTier.worlds ?? 0) === 0) {
    goals.push({ label: 'Atteindre un championnat du monde', done: false });
  }
  if (career.rivalId && world.persons[career.rivalId]) {
    goals.push({
      label: `Dépasser ${world.persons[career.rivalId].nick}`,
      done: baseRating(person, GAMES_BY_ID[person.gameId]) >
        baseRating(world.persons[career.rivalId], GAMES_BY_ID[world.persons[career.rivalId].gameId]),
    });
  }
  if (person.contract?.objectives) {
    const objective = OBJECTIVE_LABELS[person.contract.objectives] ?? person.contract.objectives;
    goals.push({ label: `Objectif du club : ${objective}`, done: false, contract: true });
  }
  return goals.slice(0, 5);
}

/**
 * Comment la carrière s'est arrêtée (étape 9C).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * Le moteur savait déjà tout : la raison de l'arrêt, l'année, l'âge, et un
 * récit complet écrit à l'étape 8C qui distinguait une fin choisie d'une fin
 * subie. Rien de tout cela n'arrivait au joueur. Une carrière qui se terminait
 * d'elle-même poussait une seule phrase — « Votre carrière de joueur s'achève »
 * — au milieu du rapport de la semaine, puis l'écran continuait d'afficher un
 * bouton « Semaine suivante », une routine d'entraînement et des objectifs à
 * atteindre. Vérifié en jouant : un joueur retraité restait devant un panneau
 * qui lui proposait de s'entraîner, et la page de fin de carrière n'était
 * accessible qu'en remarquant qu'un onglet avait changé de nom.
 *
 * Dans un jeu de carrière, la fin EST le moment. La manquer, c'est manquer le
 * seul instant où tout ce qui a été joué prend un sens.
 *
 * Cette vue ne calcule rien : elle relit ce que `retireCareer` a enregistré.
 */
export function retirementView(session) {
  const { world, career } = session;
  if (!career.retired) return null;
  const person = world.persons[career.personId];
  const path = career.retirementPath ?? null;
  // Une fin choisie et une fin subie ne se racontent pas de la même façon, et
  // le moteur fait déjà la différence : on ne la refabrique pas ici.
  const subie = FINS_SUBIES[path] ?? null;
  const week = career.retiredWeek ?? world.week;
  return {
    path,
    chosen: !subie,
    year: yearOf(week),
    age: Math.floor(personAge(person, week)),
    years: Math.max(1, Math.round((week - career.startWeek) / WEEKS_PER_YEAR)),
    matches: person.stats.matches,
    titles: person.stats.titles,
    // Le titre dit ce qui arrive, la phrase dit pourquoi. Une fin choisie n'a
    // pas besoin qu'on lui explique sa propre décision. Et aller jusqu'à la
    // limite d'âge n'est pas une carrière brisée : c'est la seule fin subie
    // qu'un joueur puisse revendiquer, elle ne se titre pas comme un échec.
    title: !subie ? 'Vous raccrochez' : path === 'âge' ? 'Vous êtes allé au bout' : 'Votre carrière s’arrête là',
    text: subie,
  };
}

/**
 * La carrière en une courbe (étape 9G).
 *
 * CE QUE ÇA RÉPOND
 * ----------------
 * Une carrière de dix-sept ans, c'est dix-sept bilans de saison qu'il faut
 * lire l'un après l'autre pour se faire une idée. La forme d'une carrière —
 * la montée, le palier, le pic, le déclin, et à quel moment un transfert a
 * tout changé — ne se voit pas dans une liste. Elle se voit d'un coup d'œil
 * dans une courbe.
 *
 * CE QUE ÇA NE FAIT PAS
 * ---------------------
 * Aucun calcul. Chaque point est un fait déjà enregistré par
 * `closeSeasonRecord` au moment où la saison s'est refermée : le niveau de fin
 * de saison, les titres gagnés, la structure. Reconstituer une courbe après
 * coup, c'est risquer d'afficher une carrière que la simulation n'a pas vécue —
 * l'erreur que l'étape 8A avait déjà coûtée sur la charge.
 *
 * Les changements de structure sont marqués : `orgStart` et `orgEnd` sont
 * enregistrés par saison, un écart entre les deux EST un transfert.
 */
export function careerChartView(session) {
  const { career } = session;
  const saisons = career.seasons ?? [];
  if (saisons.length < 2) return null;

  const points = saisons
    .filter((s) => s.ratingEnd != null)
    .map((s, i) => ({
      annee: s.year,
      niveau: Math.round(s.ratingEnd * 10) / 10,
      // Le niveau de début n'est utile que pour la première saison : ensuite
      // c'est le niveau de fin de la précédente.
      niveauDebut: i === 0 && s.ratingStart != null ? Math.round(s.ratingStart * 10) / 10 : null,
      matchs: s.matches ?? 0,
      titres: s.titles ?? 0,
      finales: s.finals ?? 0,
      org: s.orgEnd ?? s.orgStart ?? null,
      // Un transfert : la structure de fin n'est pas celle de début.
      transfert: s.orgStart && s.orgEnd && s.orgStart !== s.orgEnd ? s.orgEnd : null,
      gains: Math.round(s.earnings ?? 0),
      titre: s.headline ?? null,
    }));
  if (points.length < 2) return null;

  const niveaux = points.map((p) => p.niveau);
  const min = Math.min(...niveaux, points[0].niveauDebut ?? Infinity);
  const max = Math.max(...niveaux);
  // Une échelle collée aux extrêmes transforme un plat en montagne russe. On
  // garde une amplitude minimale pour que la forme reste honnête.
  const AMPLITUDE_MIN = 12;
  const centre = (min + max) / 2;
  const demi = Math.max((max - min) / 2, AMPLITUDE_MIN / 2);

  const meilleure = points.reduce((a, p) => (p.niveau > a.niveau ? p : a), points[0]);
  return {
    points,
    bas: Math.floor(centre - demi),
    haut: Math.ceil(centre + demi),
    pic: { annee: meilleure.annee, niveau: meilleure.niveau },
    titresTotal: points.reduce((a, p) => a + p.titres, 0),
    transferts: points.filter((p) => p.transfert).length,
    // Une carrière tronquée à 30 saisons doit le dire plutôt que de faire
    // croire qu'elle a commencé là.
    tronquee: saisons.length >= 30,
  };
}
