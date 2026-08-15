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
  STATUS,
} from './person.js';
import { ATTRIBUTE_GROUPS, starString, toStars } from './attributes.js';
import { formatDate, formatPhase, yearOf, weekOfYear, isTransferWindow } from './time.js';
import { teamStrength, rosterPersons, teamNeeds } from './team.js';
import { metaLabel, patchLabel } from './meta.js';
import { relationsOf, describeRelation, REL_TAG_LABELS } from './relations.js';
import { sortedStandings } from './competition.js';
import { currentCompetitionsFor, seasonRankingFor } from './season.js';
import { describeOffer, OBJECTIVE_LABELS } from './transfers.js';
import { lifestyleOf, difficultyOf } from './career.js';
import { audienceCeiling } from './simulation.js';

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
    news: [...world.news].reverse().slice(0, 14).map((n) => ({
      date: formatDate(n.week),
      headline: n.headline,
      body: n.body,
      tone: n.tone ?? 'neutral',
    })),
  };
}

/** Page Statistiques (§67). */
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
export function timelineView(session) {
  const { career } = session;
  const byYear = new Map();
  for (const entry of career.timeline) {
    if (!byYear.has(entry.year)) byYear.set(entry.year, []);
    byYear.get(entry.year).push({
      date: formatDate(entry.week),
      text: entry.text,
      kind: entry.kind,
      important: entry.important,
    });
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, entries]) => ({ year, entries }));
}

export function memoriesView(session) {
  return session.career.memories.map((m) => ({
    year: m.year,
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
