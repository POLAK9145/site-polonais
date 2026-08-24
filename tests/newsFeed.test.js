/**
 * Tests du fil d'actualité (étape 8F).
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * Le monde vit intensément — il couronne des champions chaque année, déplace
 * des dizaines de joueurs par fenêtre de transfert, voit des légendes naître et
 * raccrocher. C'est la promesse centrale du projet. Mais la fenêtre qu'on avait
 * dessus montrait autre chose. Mesuré sur une carrière de dix ans :
 *
 *     promotions / relégations   51 %
 *     notes de patch             38 %
 *     titres remportés            0
 *     transferts                  0
 *     retraites                   1  (sur ~400)
 *
 * `recordTitles` couronnait les vainqueurs sans jamais écrire dans le fil, et
 * `retirePerson` laissait partir les légendes en silence. Les quatorze
 * dépêches affichées étaient régulièrement sept notes de patch d'affilée, pour
 * des scènes auxquelles le joueur ne joue même pas.
 *
 * LE RISQUE QUE CES TESTS COUVRENT
 * -------------------------------
 * Remplacer du bruit par un autre bruit. La première correction l'a fait :
 * 12 dépêches sur 14 sont devenues des titres, gagnés sur des scènes
 * étrangères au joueur. Le test 3 interdit ce retour de bâton.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { runOneCareer } from '../src/engine/audit/runner.js';
import { worldView } from '../src/engine/view.js';
import { initEvents } from '../src/engine/events/index.js';

initEvents({ force: true });

let cache = null;
function carrieres() {
  if (cache) return cache;
  cache = ['8f-0', '8f-1', '8f-2'].map((seed) => {
    const r = runOneCareer({ seed, years: 20, policyId: 'random', keepSession: true });
    assert.ok(!r.crash, `plantage : ${r.crash?.message}`);
    return { seed, session: r.session };
  });
  return cache;
}

const estTitre = (n) => / remporte /.test(n.headline);
const estPatch = (n) => /— patch /.test(n.headline);
const estRetraite = (n) => /met un terme/.test(n.headline);

test('1 — le monde qui vit finit par se savoir', () => {
  // Avant : zéro titre et une seule retraite dans tout le fil.
  let titres = 0;
  let retraites = 0;
  for (const { session } of carrieres()) {
    const news = worldView(session).news;
    titres += news.filter(estTitre).length;
    retraites += news.filter(estRetraite).length;
  }
  assert.ok(titres > 0, 'aucun champion couronné n’apparaît dans le fil');
  assert.ok(retraites > 0, 'aucune fin de carrière n’apparaît dans le fil');
});

test('2 — le fil est celui du monde DU JOUEUR', () => {
  // Une nouvelle venue d'une scène qu'il ne joue pas ne lui parvient que si
  // elle est d'envergure mondiale.
  for (const { seed, session } of carrieres()) {
    const person = session.world.persons[session.career.personId];
    const connues = new Set([person.gameId, ...(session.career.counters?.gamesPlayed ?? [])]);
    const brut = new Map(session.world.news.map((n) => [n.headline, n]));

    for (const n of worldView(session).news) {
      const source = brut.get(n.headline);
      if (!source?.gameId) continue;
      if (connues.has(source.gameId)) continue;
      assert.equal(
        source.portee, 'monde',
        `${seed} : « ${n.headline} » vient de ${source.gameId}, que le joueur ne joue pas`,
      );
    }
  }
});

test('3 — aucune catégorie ne confisque l’écran', () => {
  // Le premier correctif avait remplacé sept notes de patch par douze titres :
  // le bruit avait changé de nature, pas de volume.
  for (const { seed, session } of carrieres()) {
    const news = worldView(session).news;
    assert.ok(news.length > 0, `${seed} : fil vide`);
    for (const [nom, test] of [['titres', estTitre], ['patchs', estPatch], ['retraites', estRetraite]]) {
      const part = news.filter(test).length / news.length;
      assert.ok(
        part <= 0.6,
        `${seed} : les ${nom} occupent ${Math.round(part * 100)} % de l'écran`,
      );
    }
  }
});

test('4 — un championnat du monde traverse les scènes', () => {
  // La règle de portée doit marcher dans les deux sens : ce qui est mondial
  // parvient au joueur même s'il ne suit pas cette scène. Sans ce test, on
  // pourrait « corriger » le bruit en coupant tout ce qui vient d'ailleurs.
  const { session } = carrieres()[0];
  const person = session.world.persons[session.career.personId];
  const etrangere = Object.keys(session.world.gameStates).find((g) => g !== person.gameId);
  assert.ok(etrangere, 'monde de test à une seule scène');

  session.world.news.push({
    week: session.world.week,
    headline: 'Un club inconnu remporte le championnat du monde',
    body: 'Test.',
    gameId: etrangere,
    tone: 'positive',
    important: true,
    portee: 'monde',
  });
  const vues = worldView(session).news.map((n) => n.headline);
  assert.ok(
    vues.includes('Un club inconnu remporte le championnat du monde'),
    'un championnat du monde n’atteint pas le joueur',
  );
});

test('5 — une rafale de promotions ne chasse pas l’essentiel', () => {
  // Les promotions sont nombreuses et arrivent groupées en fin de saison.
  // Elles ne doivent pas pousser hors de l'écran un titre ou une retraite.
  const { session } = carrieres()[1];
  const semaine = session.world.week;
  const avant = worldView(session).news.filter((n) => n.important).length;
  assert.ok(avant > 0, 'prémisse : aucune dépêche importante avant la rafale');

  for (let i = 0; i < 40; i++) {
    session.world.news.push({
      week: semaine, headline: `Équipe ${i} monte d'un niveau`, body: '', tone: 'neutral',
    });
  }
  const apres = worldView(session).news.filter((n) => n.important).length;
  assert.ok(
    apres >= Math.min(avant, 7),
    `quarante promotions ont réduit les dépêches importantes de ${avant} à ${apres}`,
  );
});
