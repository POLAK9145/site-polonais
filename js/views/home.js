import { cardStats } from '../storage.js';
import { hasPolishVoice } from '../audio.js';

export function renderHome() {
  const stats = cardStats();
  const voiceOk = hasPolishVoice();

  return `
    <section class="hero">
      <div>
        <h1>Apprends le polonais — pour de vrai.</h1>
        <p class="lead">
          Une méthode complète, structurée et autonome pour parler couramment :
          alphabet et prononciation, les 7 cas, vocabulaire thématique, conjugaisons,
          phrases utiles, flashcards intelligentes et quiz.
          Chaque mot est lu à voix haute par une voix polonaise native.
        </p>
        <div class="cta">
          <a class="btn primary" href="#/parcours">Commencer le parcours</a>
          <a class="btn" href="#/alphabet">Découvrir l’alphabet</a>
          <a class="btn ghost" href="#/flashcards">Réviser maintenant</a>
        </div>
      </div>
      <div class="hero-art">🇵🇱</div>
    </section>

    ${!voiceOk ? `
      <div class="audio-hint">
        <b>Audio en cours de chargement…</b> Si tu n'entends pas de prononciation au premier clic,
        appuie une seconde fois sur le bouton 🔊 — ton navigateur charge la voix polonaise (<code>pl-PL</code>) à la volée.
        Sur certains systèmes, il faut installer le pack voix polonais (Réglages → Voix).
      </div>
    ` : ''}

    <section class="section">
      <div class="section-title"><h2>Par où commencer ?</h2></div>
      <div class="grid cols-3">
        <a class="card linkcard" href="#/parcours">
          <span class="tag">Parcours</span>
          <h3>Parcours guidé A0 → B1</h3>
          <p>Un plan d’étude semaine après semaine, du premier mot au texte continu.</p>
        </a>
        <a class="card linkcard" href="#/alphabet">
          <span class="tag">Étape 1</span>
          <h3>Alphabet & sons</h3>
          <p>Les 32 lettres et les digraphes (cz, sz, rz…) avec audio et exemples.</p>
        </a>
        <a class="card linkcard" href="#/prononciation">
          <span class="tag">Étape 2</span>
          <h3>Règles de prononciation</h3>
          <p>Accent tonique, voyelles nasales, paires douces/dures, dévoisement final.</p>
        </a>
        <a class="card linkcard" href="#/grammaire">
          <span class="tag">Grammaire</span>
          <h3>Les 7 cas, le genre, l’aspect</h3>
          <p>Fiches claires sur tout ce qui rend le polonais unique.</p>
        </a>
        <a class="card linkcard" href="#/vocabulaire">
          <span class="tag">Vocabulaire</span>
          <h3>17 thèmes essentiels</h3>
          <p>Près de 500 mots classés par sujet, chacun avec sa prononciation.</p>
        </a>
        <a class="card linkcard" href="#/verbes">
          <span class="tag">Verbes</span>
          <h3>20 verbes-clés conjugués</h3>
          <p>Présent, passé (masculin/féminin), futur, exemples concrets.</p>
        </a>
        <a class="card linkcard" href="#/phrases">
          <span class="tag">Phrases</span>
          <h3>Phrases utiles par situation</h3>
          <p>Survie, restaurant, transports, urgences, smalltalk.</p>
        </a>
        <a class="card linkcard" href="#/flashcards">
          <span class="tag">Mémoriser</span>
          <h3>Flashcards (SRS)</h3>
          <p>Système de révision espacée pour ancrer le vocabulaire à long terme.</p>
        </a>
        <a class="card linkcard" href="#/quiz">
          <span class="tag">Tester</span>
          <h3>Quiz interactifs</h3>
          <p>Mots, écoute, accords… plusieurs modes pour t’auto-évaluer.</p>
        </a>
      </div>
    </section>

    <section class="section">
      <div class="section-title"><h2>Tes progrès</h2><small>Sauvegardés localement</small></div>
      <div class="grid cols-3">
        <div class="card">
          <small>Cartes apprises</small>
          <h3>${stats.seen}</h3>
        </div>
        <div class="card">
          <small>Cartes maîtrisées</small>
          <h3>${stats.mastered}</h3>
        </div>
        <div class="card">
          <small>À réviser maintenant</small>
          <h3>${stats.dueNow}</h3>
        </div>
      </div>
      <p style="margin-top:1rem"><a href="#/progres">Voir le détail des progrès →</a></p>
    </section>
  `;
}
