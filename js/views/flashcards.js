import { allCards, vocabulary, themeKeys } from '../../data/vocabulary.js';
import { getDueCards, reviewCard, cardStats } from '../storage.js';
import { speak } from '../audio.js';

let session = null;

function buildSession(filterTheme) {
  const all = allCards().filter(c => !filterTheme || c.theme === filterTheme);
  const { due, fresh } = getDueCards(all);
  const queue = [...due, ...fresh.slice(0, 12)]; // limit fresh per session
  return {
    queue,
    index: 0,
    answered: 0,
    correct: 0,
    flipped: false,
    filter: filterTheme || null,
  };
}

function renderCurrentCard() {
  const root = document.getElementById('flashRoot');
  if (!root) return;
  if (!session || session.index >= session.queue.length) {
    root.innerHTML = `
      <div class="card" style="text-align:center;">
        <h2>Session terminée 👏</h2>
        <p>Tu as révisé ${session ? session.answered : 0} cartes
           ${session && session.answered ? `(${Math.round(session.correct / session.answered * 100)}% « facile/bien »)` : ''}.</p>
        <p>Reviens demain : les cartes vues s'afficheront seulement quand elles seront « dues » selon l'algorithme de répétition espacée.</p>
        <div class="flash-controls">
          <button class="btn primary" id="restart">Nouvelle session</button>
          <a class="btn" href="#/progres">Voir mes progrès</a>
        </div>
      </div>
    `;
    const r = document.getElementById('restart');
    if (r) r.addEventListener('click', () => {
      session = buildSession(session.filter);
      renderCurrentCard();
    });
    return;
  }

  const card = session.queue[session.index];
  const total = session.queue.length;
  const flipCls = session.flipped ? 'flipped' : '';

  root.innerHTML = `
    <div class="flash-meta">Carte ${session.index + 1} / ${total} · thème : ${card.themeLabel}</div>
    <div class="flashcard ${flipCls}" id="flashcard">
      <div class="inner">
        <div class="face front">
          <div class="big">${card.front}</div>
          <div class="small">Clique pour voir la traduction</div>
        </div>
        <div class="face back">
          <div class="big">${card.back}</div>
          <div class="small">Comment l'as-tu trouvée ?</div>
        </div>
      </div>
    </div>
    <button class="audio-btn" id="speakBtn" aria-label="Écouter" style="width:48px;height:48px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px">
        <path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
      </svg>
    </button>
    <div class="flash-controls">
      ${session.flipped ? `
        <button class="btn" data-rate="0" style="background:#fdecef;border-color:var(--red);color:var(--red-dark)">↻ Encore</button>
        <button class="btn" data-rate="1">Difficile</button>
        <button class="btn primary" data-rate="2">Bien</button>
        <button class="btn" data-rate="3" style="background:var(--green-soft);border-color:var(--green);color:#0b5d36">Facile</button>
      ` : `
        <button class="btn primary" id="flip">Montrer la réponse</button>
      `}
    </div>
  `;

  document.getElementById('flashcard').addEventListener('click', () => {
    session.flipped = true; renderCurrentCard();
  });
  document.getElementById('speakBtn').addEventListener('click', (e) => {
    e.stopPropagation(); speak(card.front);
  });
  const flip = document.getElementById('flip');
  if (flip) flip.addEventListener('click', () => { session.flipped = true; renderCurrentCard(); });
  document.querySelectorAll('[data-rate]').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = parseInt(btn.dataset.rate, 10);
      reviewCard(card.id, q);
      session.answered += 1;
      if (q >= 2) session.correct += 1;
      session.index += 1;
      session.flipped = false;
      renderCurrentCard();
    });
  });

  // Auto-pronounce on first show
  speak(card.front);
}

export function renderFlashcards() {
  const stats = cardStats();
  if (!session) session = buildSession(null);

  window.__afterRender = () => {
    renderCurrentCard();
    document.querySelectorAll('[data-filter]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const k = el.dataset.filter;
        session = buildSession(k === 'all' ? null : k);
        document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x.dataset.filter === k));
        renderCurrentCard();
      });
    });
  };

  return `
    <h1>Flashcards — révision espacée</h1>
    <p class="lead">Le système te montre uniquement les cartes que ta mémoire est en train d’oublier.
       Plus tu réponds « facile », plus longtemps une carte sera mise de côté.
       Plus tu fais « encore », plus elle reviendra vite.</p>

    <div class="grid cols-3">
      <div class="card"><small>Cartes vues</small><h3>${stats.seen}</h3></div>
      <div class="card"><small>Maîtrisées</small><h3>${stats.mastered}</h3></div>
      <div class="card"><small>À réviser</small><h3>${stats.dueNow}</h3></div>
    </div>

    <h3>Filtrer par thème</h3>
    <div class="chips">
      <a class="chip active" href="#/flashcards" data-filter="all">Tous</a>
      ${themeKeys.map(k => `<a class="chip" href="#/flashcards" data-filter="${k}">${vocabulary[k].icon} ${vocabulary[k].label}</a>`).join('')}
    </div>

    <div class="flash-stage" id="flashRoot"></div>

    <div class="callout tip">
      <strong>Notation</strong> : <b>Encore</b> (carte ratée, revient bientôt), <b>Difficile</b> (revient demain),
      <b>Bien</b> (intervalle qui grandit), <b>Facile</b> (intervalle qui grandit encore plus vite).
    </div>
  `;
}
