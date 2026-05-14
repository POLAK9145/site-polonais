import { allCards, vocabulary, themeKeys } from '../../data/vocabulary.js';
import { recordQuizResult } from '../storage.js';
import { speak, audioButton } from '../audio.js';

const QUIZ_LEN = 10;

const modes = {
  pl2fr: {
    label: 'Polonais → Français',
    desc: 'On te montre un mot polonais, choisis sa traduction.',
  },
  fr2pl: {
    label: 'Français → Polonais',
    desc: 'On te montre un mot français, choisis sa traduction polonaise.',
  },
  listen: {
    label: 'Écoute',
    desc: 'Écoute le mot polonais et choisis le bon sens en français.',
  },
};

let quiz = null;

function pickN(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function makeQuiz(mode) {
  const pool = allCards();
  const items = pickN(pool, QUIZ_LEN);
  const questions = items.map(card => {
    const distractors = pickN(pool.filter(c => c.id !== card.id), 3);
    const allChoices = pickN([card, ...distractors], 4);
    return { card, choices: allChoices };
  });
  return { mode, questions, index: 0, correct: 0, locked: false };
}

function renderQuestion() {
  const root = document.getElementById('quizRoot');
  if (!root || !quiz) return;
  if (quiz.index >= quiz.questions.length) {
    recordQuizResult(quiz.mode, quiz.correct, quiz.questions.length);
    root.innerHTML = `
      <div class="card" style="text-align:center;">
        <h2>Résultat : ${quiz.correct} / ${quiz.questions.length}</h2>
        <div class="progress-bar" style="max-width:300px;margin:1rem auto"><span style="width:${(quiz.correct/quiz.questions.length)*100}%"></span></div>
        <p>${quiz.correct === quiz.questions.length ? 'Parfait ! Continue comme ça.' : quiz.correct >= quiz.questions.length * 0.7 ? 'Solide. Encore quelques sessions et c’est gagné.' : 'À retravailler — passe par les flashcards pour ces mots-là.'}</p>
        <div class="flash-controls">
          <button class="btn primary" id="newQuiz">Nouveau quiz</button>
          <a class="btn" href="#/quiz">Changer de mode</a>
        </div>
      </div>
    `;
    document.getElementById('newQuiz').addEventListener('click', () => {
      quiz = makeQuiz(quiz.mode); renderQuestion();
    });
    return;
  }

  const q = quiz.questions[quiz.index];
  const mode = quiz.mode;
  let prompt = '';
  let choicesHtml = '';

  if (mode === 'pl2fr') {
    prompt = `<div class="q">${q.card.front} <span style="margin-left:.5rem;font-size:1rem;color:var(--muted);">— traduction ?</span> ${audioButton(q.card.front)}</div>`;
    choicesHtml = q.choices.map(c => `<button class="choice" data-correct="${c.id === q.card.id ? '1' : '0'}">${c.back}</button>`).join('');
  } else if (mode === 'fr2pl') {
    prompt = `<div class="q">${q.card.back} <span style="margin-left:.5rem;font-size:1rem;color:var(--muted);">— en polonais ?</span></div>`;
    choicesHtml = q.choices.map(c => `<button class="choice pl" data-correct="${c.id === q.card.id ? '1' : '0'}">${c.front}</button>`).join('');
  } else if (mode === 'listen') {
    prompt = `<div class="q">Écoute et trouve le sens ${audioButton(q.card.front, 'Réécouter')}</div>`;
    choicesHtml = q.choices.map(c => `<button class="choice" data-correct="${c.id === q.card.id ? '1' : '0'}">${c.back}</button>`).join('');
    setTimeout(() => speak(q.card.front), 200);
  }

  root.innerHTML = `
    <div class="quiz-progress">
      <span>Question ${quiz.index + 1} / ${quiz.questions.length}</span>
      <span>Score : ${quiz.correct}</span>
    </div>
    <div class="quiz-question">
      ${prompt}
      <div class="choices">${choicesHtml}</div>
    </div>
  `;

  document.querySelectorAll('.choice').forEach(btn => {
    btn.addEventListener('click', () => {
      if (quiz.locked) return;
      quiz.locked = true;
      const isCorrect = btn.dataset.correct === '1';
      if (isCorrect) { btn.classList.add('correct'); quiz.correct += 1; }
      else {
        btn.classList.add('wrong');
        document.querySelectorAll('.choice').forEach(b => {
          if (b.dataset.correct === '1') b.classList.add('correct');
        });
      }
      setTimeout(() => {
        quiz.index += 1; quiz.locked = false; renderQuestion();
      }, 900);
    });
  });
}

export function renderQuiz() {
  const startMode = location.hash.includes('?mode=') ? location.hash.split('mode=')[1] : null;
  if (startMode && modes[startMode] && !quiz) {
    quiz = makeQuiz(startMode);
  }
  window.__afterRender = () => {
    document.querySelectorAll('[data-mode]').forEach(b => {
      b.addEventListener('click', () => {
        quiz = makeQuiz(b.dataset.mode); renderQuestion();
      });
    });
    if (quiz) renderQuestion();
  };

  return `
    <h1>Quiz</h1>
    <p class="lead">Trois modes pour t’auto-évaluer. Chaque quiz fait 10 questions tirées au hasard
       dans tout le vocabulaire. Ton meilleur score par mode est sauvegardé.</p>

    <div class="grid cols-3">
      ${Object.entries(modes).map(([key, m]) => `
        <button class="card linkcard" data-mode="${key}" style="text-align:left;cursor:pointer;border:1px solid var(--line);">
          <span class="tag">${key === 'listen' ? 'Audio' : 'Texte'}</span>
          <h3>${m.label}</h3>
          <p>${m.desc}</p>
        </button>
      `).join('')}
    </div>

    <div id="quizRoot" style="margin-top:1.2rem"></div>
  `;
}
