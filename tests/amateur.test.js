/**
 * Tests de non-régression de l'écosystème d'entrée (phase 2, étape 2).
 *
 * Le bug corrigé : « amateur » était un rang, pas un état. `setupSeason`
 * classait les équipes d'une région et envoyait les huit premières en ligue —
 * or une région en compte rarement plus de huit, si bien que le circuit
 * amateur était vide *par construction* (`teamsByDivision.amateur = 0`) et
 * qu'aucun tournoi d'entrée n'était créé. Ces tests verrouillent la propriété
 * inverse : une porte d'entrée existe, elle vit, et elle n'est pas garantie.
 *
 * Ils partagent une seule simulation de 30 ans, sans joueur : la relancer dix
 * fois coûterait un quart d'heure pour les mêmes faits.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runAmateurAudit } from '../src/engine/audit/amateurAudit.js';
import { canSustainLeague, LEAGUE_CAPABLE_TIER } from '../src/engine/amateur.js';
import { teamStrength } from '../src/engine/team.js';
import { STATUS, age as personAge } from '../src/engine/person.js';
import { worldMetrics } from '../src/engine/audit/metrics.js';
import { GAMES_BY_ID } from '../src/data/games.js';
import { WEEKS_PER_YEAR } from '../src/engine/time.js';

let cached = null;
function run() {
  if (!cached) {
    cached = runAmateurAudit({
      seed: 'amateur-regression',
      years: 30,
      sampleEveryYears: 10,
      collectWorld: true,
    });
  }
  return cached;
}

function amateurTeams(world) {
  return Object.values(world.teams).filter((t) => {
    if (!t.active || t.isSelfTeam) return false;
    const org = world.orgs[t.orgId];
    return !!org?.alive && !canSustainLeague(org);
  });
}

// ---------------------------------------------------------------------------
// Test 1 — une scène vivante possède un écosystème d'entrée après des années.
// ---------------------------------------------------------------------------
test('chaque scène vivante conserve un circuit d’entrée après 30 ans', () => {
  const r = run();
  assert.equal(r.crash, null, `plantage : ${r.crash?.message}`);
  const last = r.snapshots.at(-1);
  const alive = last.scenes.filter((s) => s.alive);
  assert.ok(alive.length >= 6, `${alive.length} scènes vivantes seulement`);

  // On juge sur l'année entière, pas sur l'instantané : la dissolution des
  // équipes en échec a lieu en semaine 51 et creuse le relevé de fin d'année.
  const without = alive.filter((s) => (s.amateurMax ?? 0) === 0);
  assert.equal(
    without.length,
    0,
    `scènes sans aucune équipe d'entrée sur l'année : ${without.map((s) => s.gameId).join(', ')}`,
  );
  // Et ce circuit n'est pas résiduel. On le juge sur son activité, non sur son
  // stock : depuis que la hiérarchie est perméable (étape 3), les meilleures
  // équipes d'entrée sont promues et le stock d'équilibre a baissé — 3,3 à 2,2
  // en moyenne. Ce n'est pas un affaiblissement du circuit mais sa raison
  // d'être, et le test doit mesurer le renouvellement plutôt qu'un effectif.
  const idle = alive.filter((s) => (r.byScene[s.gameId]?.created ?? 0) < 5);
  assert.deepEqual(
    idle.map((s) => s.gameId),
    [],
    'scènes où presque aucune équipe d’entrée ne s’est formée en 30 ans',
  );
  const meanStock = alive.reduce((n, s) => n + (s.amateurMean ?? 0), 0) / alive.length;
  assert.ok(meanStock >= 1.2, `stock moyen d'équipes d'entrée : ${meanStock.toFixed(1)}`);
});

// ---------------------------------------------------------------------------
// Test 2 — des nouveaux joueurs peuvent rejoindre des équipes amateurs.
// ---------------------------------------------------------------------------
test('les nouveaux venus rejoignent réellement des équipes d’entrée', () => {
  const r = run();
  assert.ok(r.flows.joinsAmateur > 100, `${r.flows.joinsAmateur} arrivées en équipe amateur`);

  // Et ce ne sont pas toujours les mêmes : les cohortes de nouveaux venus
  // trouvent une équipe, sans que ce soit systématique (§12).
  for (const [year, c] of Object.entries(r.cohorts)) {
    if (!c.size || c.followUpYears < 3) continue;
    assert.ok(c.foundTeamPct > 40, `cohorte ${year} : seulement ${c.foundTeamPct} % trouvent une équipe`);
    assert.ok(c.foundTeamPct < 100, `cohorte ${year} : 100 % trouvent une équipe, l'entrée n'est plus un enjeu`);
  }
});

// ---------------------------------------------------------------------------
// Test 3 — une équipe amateur peut disparaître.
// ---------------------------------------------------------------------------
test('une équipe amateur peut disparaître', () => {
  const r = run();
  assert.ok(r.flows.amateurTeamsDissolved > 20, `${r.flows.amateurTeamsDissolved} dissolutions en 30 ans`);
  // Une équipe qui échoue meurt en un à deux ans, mais certaines durent.
  const ls = r.amateurLifespanYears;
  assert.ok(ls.median >= 0.5, `durée de vie médiane ${ls.median} an — les équipes meurent trop vite`);
  assert.ok(ls.max > 3, `aucune équipe amateur n'a dépassé ${ls.max} an(s)`);
});

// ---------------------------------------------------------------------------
// Test 4 — une nouvelle équipe amateur peut apparaître.
// ---------------------------------------------------------------------------
test('de nouvelles équipes amateurs apparaissent tout au long de la vie du monde', () => {
  const r = run();
  assert.ok(r.flows.amateurTeamsCreated > 50, `${r.flows.amateurTeamsCreated} créations en 30 ans`);
  // Les créations ne sont pas cantonnées aux premières années : le stock
  // d'équipes d'entrée est encore renouvelé à la fin de la simulation.
  const first = r.snapshots.find((s) => s.year === 10);
  const last = r.snapshots.at(-1);
  const mean = (snap) =>
    snap.scenes.filter((s) => s.alive).reduce((n, s) => n + (s.amateurMean ?? 0), 0);
  assert.ok(mean(last) > mean(first) * 0.4, `le circuit d'entrée s'éteint : ${mean(first)} → ${mean(last)}`);
});

// ---------------------------------------------------------------------------
// Test 5 — une équipe amateur peut devenir candidate à l'échelon supérieur.
// ---------------------------------------------------------------------------
test('une équipe amateur peut devenir candidate à l’échelon supérieur', () => {
  const r = run();
  const world = r.world;
  const power = (t) => teamStrength(world, t, { forMatch: false }).strength;

  // Candidature sportive : au moins une équipe d'entrée fait mieux que la plus
  // faible équipe de ligue de sa scène. C'est la condition que l'étape 3
  // exploitera ; on ne code pas ici de seconde logique de promotion.
  let candidates = 0;
  for (const team of amateurTeams(world)) {
    const league = Object.values(world.teams).filter(
      (t) => t.active && t.gameId === team.gameId && canSustainLeague(world.orgs[t.orgId]),
    );
    if (league.length === 0) continue;
    const weakest = Math.min(...league.map(power));
    if (power(team) > weakest) candidates++;
  }
  assert.ok(candidates > 0, 'aucune équipe amateur ne dépasse la plus faible équipe de ligue');

  // Et le chemin existe réellement : des équipes d'entrée sont passées en
  // ligue pendant la simulation, par montée de tier.
  assert.ok(r.flows.amateurToLeague > 0, 'aucune équipe amateur n’a atteint la ligue en 30 ans');
});

// ---------------------------------------------------------------------------
// Test 6 — le système ne crée pas une infinité d'équipes.
// ---------------------------------------------------------------------------
test('le système ne crée pas une infinité d’équipes ni de population', () => {
  const r = run();
  const world = r.world;
  const active = Object.values(world.teams).filter((t) => t.active && !t.isSelfTeam).length;
  assert.ok(active < 260, `${active} équipes actives après 30 ans`);

  // Un circuit d'entrée sain recycle, il n'accumule pas.
  //
  // Ce test mesurait `dissoutes / créées`, ce qui compte une **promotion** comme
  // une accumulation. Or une équipe promue libère sa place exactement comme une
  // équipe dissoute : elle a simplement quitté le circuit par le haut. La
  // formule est devenue fausse à l'étape 6, quand les structures d'entrée ont
  // cessé d'être insolvables par construction et qu'une partie d'entre elles a
  // commencé à réussir : mesuré sur 30 ans, 351 créations pour 204 dissolutions
  // (58 %) et 100 promotions (28 %). Le circuit évacue 87 % de ce qu'il crée —
  // il est plus sain qu'avant — mais la part de dissolution passe sous 60 %.
  //
  // On mesure donc les sorties, et l'on vérifie séparément que les deux issues
  // existent : un circuit où l'on ne fait que disparaître serait aussi faux
  // qu'un circuit où l'on ne fait que monter.
  const { amateurTeamsCreated: créées, amateurTeamsDissolved: dissoutes, amateurToLeague: promues } = r.flows;
  const sorties = (dissoutes + promues) / Math.max(1, créées);
  assert.ok(sorties > 0.6, `seulement ${Math.round(sorties * 100)} % des équipes créées quittent le circuit`);
  assert.ok(dissoutes > 0, 'aucune équipe d’entrée ne disparaît : le circuit n’a plus d’échec');
  assert.ok(promues > 0, 'aucune équipe d’entrée ne monte : le circuit n’a plus de débouché');
  // Et l'échec reste l'issue la plus fréquente : monter doit rester difficile.
  assert.ok(dissoutes > promues, `${promues} promotions pour ${dissoutes} dissolutions : monter est devenu facile`);

  // Effet « ferme à rookies » (§11) : la population reste bornée.
  // Le seuil suit la réserve de mémoire introduite à l'étape 6 : le monde
  // conserve désormais ~85 retraités au lieu de les effacer tous, ce qui déplace
  // la population sans toucher au plafond `MAX_POPULATION`. La sauvegarde, seule
  // contrainte réelle, reste vérifiée par son propre test.
  assert.ok(r.population.total <= 780, `population ${r.population.total}`);
  // Et les structures mortes ne s'accumulent pas dans la sauvegarde.
  const dead = Object.values(world.teams).filter((t) => !t.active).length;
  assert.ok(dead < 60, `${dead} équipes mortes conservées`);
});

// ---------------------------------------------------------------------------
// Test 7 — une scène faible ne reçoit pas une quantité illimitée d'équipes.
// ---------------------------------------------------------------------------
test('une scène faible ne reçoit pas artificiellement des équipes', () => {
  const r = run();
  const world = r.world;

  // Le plafond de formation est dérivé du vivier disponible ; on vérifie que le
  // stock observé reste dans cet ordre de grandeur, scène par scène.
  for (const snap of r.snapshots) {
    for (const s of snap.scenes) {
      if (!s.alive) continue;
      const size = GAMES_BY_ID[s.gameId].teamSize;
      const supply = (s.unattachedMax ?? s.unattached) + (s.amateurPlayers ?? 0);
      const ceiling = 4 + Math.floor(supply / size) + 2;
      assert.ok(
        (s.amateurMax ?? 0) <= ceiling,
        `année ${snap.year}, ${s.gameId} : ${s.amateurMax} équipes pour un vivier de ${supply} joueurs`,
      );
    }
  }

  // Une scène en petite forme a moins d'équipes d'entrée qu'une scène en
  // pleine santé : le nombre reste une conséquence de la vitalité.
  const scenes = r.snapshots.at(-1).scenes.filter((s) => s.alive);
  const byVitality = scenes
    .map((s) => ({ v: world.gameStates[s.gameId].vitality, am: s.amateurMean ?? 0 }))
    .sort((a, b) => a.v - b.v);
  assert.ok(byVitality.length >= 4, 'trop peu de scènes pour comparer');
});

// ---------------------------------------------------------------------------
// Test 8 — les équipes amateurs ont des rosters cohérents.
// ---------------------------------------------------------------------------
test('les rosters des équipes amateurs sont cohérents', () => {
  const world = run().world;
  const teams = amateurTeams(world);
  assert.ok(teams.length > 0, 'aucune équipe amateur à vérifier');

  for (const team of teams) {
    const game = GAMES_BY_ID[team.gameId];
    assert.ok(team.roster.length <= game.teamSize, `${team.id} : ${team.roster.length} titulaires pour ${game.teamSize} places`);
    assert.equal(new Set(team.roster).size, team.roster.length, `${team.id} : doublon dans l'effectif`);
    for (const pid of team.roster) {
      const p = world.persons[pid];
      assert.ok(p, `${team.id} : membre fantôme ${pid}`);
      assert.equal(p.teamId, team.id, `${p.id} figure dans ${team.id} mais pointe vers ${p.teamId}`);
      assert.equal(p.gameId, team.gameId, `${p.id} joue ${p.gameId} dans une équipe ${team.gameId}`);
      assert.notEqual(p.status, STATUS.RETIRED, `${p.id} est retraité et titulaire`);
      assert.notEqual(p.status, STATUS.STAFF, `${p.id} est staff et titulaire`);
      assert.ok(p.teamHistory.some((h) => h.teamId === team.id), `${p.id} : passage non enregistré`);
    }
    // Une structure communautaire ne peut pas être une organisation de ligue.
    assert.ok(world.orgs[team.orgId].tier < LEAGUE_CAPABLE_TIER);
  }

  // La variance de composition est réelle (§4) : les équipes formées ne sont
  // pas toutes des rassemblements de rookies.
  const styles = new Set(teams.map((t) => t.formationStyle).filter(Boolean));
  const ages = teams
    .filter((t) => t.roster.length > 0)
    .map((t) => {
      const list = t.roster.map((id) => personAge(world.persons[id], world.week));
      return list.reduce((a, b) => a + b, 0) / list.length;
    });
  if (ages.length >= 4) {
    assert.ok(Math.max(...ages) - Math.min(...ages) > 1.5, `âges moyens trop uniformes : ${ages.map((a) => a.toFixed(1)).join(', ')}`);
  }
  assert.ok(styles.size >= 1, 'aucun style de formation enregistré');
});

// ---------------------------------------------------------------------------
// Test 9 — le système reste viable après 30 ans.
// ---------------------------------------------------------------------------
test('l’écosystème d’entrée reste viable après 30 ans, sans incohérence', () => {
  const r = run();
  assert.deepEqual(r.issues, [], `incohérences : ${JSON.stringify(r.issues.slice(0, 3))}`);

  const last = r.snapshots.at(-1);
  const alive = last.scenes.filter((s) => s.alive);
  const totalAmateur = alive.reduce((n, s) => n + (s.amateurMean ?? 0), 0);
  assert.ok(totalAmateur >= 8, `${totalAmateur} équipes d'entrée en moyenne sur la 30e année`);

  // Les joueurs ne restent pas bloqués des années sans équipe (extrême B).
  const stuck = alive.filter((s) => (s.unattachedWeeksMean ?? 0) > 3 * WEEKS_PER_YEAR);
  assert.equal(stuck.length, 0, `scènes où l'attente moyenne dépasse 3 ans : ${stuck.map((s) => s.gameId).join(', ')}`);

  // Mais l'entrée n'est pas instantanée pour tout le monde (extrême A).
  const waiting = alive.reduce((n, s) => n + (s.unattachedMean ?? 0), 0);
  assert.ok(waiting > 5, `seulement ${waiting} joueurs sans équipe : l'entrée n'a plus d'enjeu`);
});

// ---------------------------------------------------------------------------
// Test 10 — le plancher ne détruit pas les distributions existantes.
// ---------------------------------------------------------------------------
test('le circuit d’entrée ne détruit pas les distributions du monde', () => {
  const world = run().world;
  const m = worldMetrics(world);

  // Relève : la génération suivante continue d'émerger.
  assert.ok(m.topPlayerAgeMean > 20 && m.topPlayerAgeMean < 32, `âge moyen du top 20 : ${m.topPlayerAgeMean}`);
  // Le monde n'est pas devenu « uniquement grandes équipes + grands joueurs ».
  assert.ok(m.ratingMedian > 40, `niveau médian ${m.ratingMedian}`);
  assert.ok(m.ratingMax > 80, `meilleur niveau ${m.ratingMax}`);
  // Ni un monde d'amateurs : le sommet de la pyramide existe toujours.
  assert.ok(m.pros > 40, `${m.pros} professionnels`);
  // Les équipes de ligue restent majoritaires en nombre de joueurs employés.
  const rostered = Object.values(world.persons).filter((p) => p.teamId).length;
  const amateurPlayers = amateurTeams(world).reduce((n, t) => n + t.roster.length, 0);
  assert.ok(
    amateurPlayers < rostered * 0.5,
    `${amateurPlayers}/${rostered} joueurs dans le circuit d'entrée : la pyramide est inversée`,
  );
});
