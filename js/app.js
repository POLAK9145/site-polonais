import { initAudio, bindAudioDelegation, hasPolishVoice } from './audio.js';
import { tickStreak } from './storage.js';

import { renderHome } from './views/home.js';
import { renderParcours, renderLesson } from './views/parcours.js';
import { renderAlphabet } from './views/alphabet.js';
import { renderPrononciation } from './views/prononciation.js';
import { renderGrammaire, renderGrammaireTopic } from './views/grammaire.js';
import { renderVocabulaire } from './views/vocabulaire.js';
import { renderVerbes, renderVerbe } from './views/verbes.js';
import { renderPhrases } from './views/phrases.js';
import { renderFlashcards } from './views/flashcards.js';
import { renderQuiz } from './views/quiz.js';
import { renderProgres } from './views/progres.js';

const root = document.getElementById('app');
const navLinks = document.querySelectorAll('#topnav a');

const routes = [
  { match: /^\/?$/, render: renderHome, key: 'home' },
  { match: /^\/parcours\/(.+)$/, render: (m) => renderLesson(m[1]), key: 'parcours' },
  { match: /^\/parcours$/, render: renderParcours, key: 'parcours' },
  { match: /^\/alphabet$/, render: renderAlphabet, key: 'alphabet' },
  { match: /^\/prononciation$/, render: renderPrononciation, key: 'prononciation' },
  { match: /^\/grammaire\/(.+)$/, render: (m) => renderGrammaireTopic(m[1]), key: 'grammaire' },
  { match: /^\/grammaire$/, render: renderGrammaire, key: 'grammaire' },
  { match: /^\/vocabulaire$/, render: renderVocabulaire, key: 'vocabulaire' },
  { match: /^\/verbes\/(.+)$/, render: (m) => renderVerbe(m[1]), key: 'verbes' },
  { match: /^\/verbes$/, render: renderVerbes, key: 'verbes' },
  { match: /^\/phrases$/, render: renderPhrases, key: 'phrases' },
  { match: /^\/flashcards$/, render: renderFlashcards, key: 'flashcards' },
  { match: /^\/quiz$/, render: renderQuiz, key: 'quiz' },
  { match: /^\/progres$/, render: renderProgres, key: 'progres' },
];

function setActiveNav(key) {
  navLinks.forEach(a => {
    if (a.dataset.route === key) a.classList.add('active');
    else a.classList.remove('active');
  });
}

function parseHash() {
  const h = location.hash || '#/';
  return h.replace(/^#/, '') || '/';
}

function router() {
  const path = parseHash();
  for (const r of routes) {
    const m = path.match(r.match);
    if (m) {
      setActiveNav(r.key);
      try {
        const html = r.render(m);
        if (html instanceof Promise) {
          root.innerHTML = '<p>Chargement…</p>';
          html.then(out => { root.innerHTML = out; afterRender(); });
        } else {
          root.innerHTML = html;
          afterRender();
        }
      } catch (err) {
        console.error(err);
        root.innerHTML = `<div class="callout warn"><b>Erreur :</b> ${err.message}</div>`;
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
  }
  root.innerHTML = `
    <h1>Page introuvable</h1>
    <p>Cette section n'existe pas. <a href="#/">Retour à l'accueil</a>.</p>
  `;
  setActiveNav('home');
}

function afterRender() {
  tickStreak();
  // Allow each view to register custom interactivity via a global hook.
  if (typeof window.__afterRender === 'function') {
    const fn = window.__afterRender;
    window.__afterRender = null;
    fn();
  }
  // Close mobile nav after navigation.
  document.getElementById('topnav').classList.remove('open');
}

// Bootstrap
initAudio();
bindAudioDelegation(document);
window.addEventListener('hashchange', router);
document.addEventListener('DOMContentLoaded', () => {
  router();
  const tgl = document.getElementById('menuToggle');
  const nav = document.getElementById('topnav');
  tgl.addEventListener('click', () => nav.classList.toggle('open'));
});

// Helper for views that want to know if audio is ready.
window.__polishVoiceAvailable = hasPolishVoice;
