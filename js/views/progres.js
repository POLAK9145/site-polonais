import { getState, cardStats, resetAll } from '../storage.js';
import { lessons } from '../../data/lessons.js';
import { allCards } from '../../data/vocabulary.js';

export function renderProgres() {
  const state = getState();
  const stats = cardStats();
  const total = allCards().length;
  const lessonsDone = Object.values(state.lessons || {}).filter(l => l.done).length;
  const streak = state.streak || { current: 0, longest: 0 };

  const quizRows = Object.entries(state.quizStats || {}).map(([mode, s]) => `
    <tr>
      <td>${mode}</td>
      <td>${s.plays}</td>
      <td>${s.correct} / ${s.total}</td>
      <td>${s.bestPct}%</td>
    </tr>
  `).join('');

  window.__afterRender = () => {
    const r = document.getElementById('resetAll');
    if (r) r.addEventListener('click', () => {
      if (confirm('Effacer toutes les données locales (cartes apprises, leçons, scores, série) ? Cette action est irréversible.')) {
        resetAll(); location.reload();
      }
    });
  };

  const seenPct = total ? Math.round((stats.seen / total) * 100) : 0;
  const masteredPct = total ? Math.round((stats.mastered / total) * 100) : 0;
  const lessonsPct = lessons.length ? Math.round((lessonsDone / lessons.length) * 100) : 0;

  return `
    <h1>Mes progrès</h1>
    <p class="lead">Tout est sauvegardé localement dans ton navigateur. Pas de compte, pas de tracking.</p>

    <section class="section">
      <h2>Série quotidienne 🔥</h2>
      <div class="grid cols-2">
        <div class="card">
          <small>Actuelle</small>
          <h3 style="font-size:2.4rem">${streak.current || 0} jour${streak.current === 1 ? '' : 's'}</h3>
        </div>
        <div class="card">
          <small>Record</small>
          <h3 style="font-size:2.4rem">${streak.longest || 0} jour${streak.longest === 1 ? '' : 's'}</h3>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>Cartes</h2>
      <div class="card">
        <p><strong>Vues :</strong> ${stats.seen} / ${total} (${seenPct}%)</p>
        <div class="progress-bar"><span style="width:${seenPct}%"></span></div>
        <p style="margin-top:.8rem"><strong>Maîtrisées :</strong> ${stats.mastered} (${masteredPct}%)</p>
        <div class="progress-bar"><span style="width:${masteredPct}%"></span></div>
        <p style="margin-top:.8rem"><strong>À réviser maintenant :</strong> ${stats.dueNow}</p>
      </div>
    </section>

    <section class="section">
      <h2>Parcours</h2>
      <div class="card">
        <p><strong>Leçons terminées :</strong> ${lessonsDone} / ${lessons.length} (${lessonsPct}%)</p>
        <div class="progress-bar"><span style="width:${lessonsPct}%"></span></div>
        <p style="margin-top:.8rem"><a href="#/parcours">Reprendre le parcours →</a></p>
      </div>
    </section>

    ${quizRows ? `
      <section class="section">
        <h2>Quiz</h2>
        <div class="table-wrap">
          <table class="poltable">
            <thead><tr><th>Mode</th><th>Sessions</th><th>Bonnes réponses</th><th>Meilleur score</th></tr></thead>
            <tbody>${quizRows}</tbody>
          </table>
        </div>
      </section>
    ` : `
      <section class="section">
        <h2>Quiz</h2>
        <p>Tu n’as pas encore fait de quiz. <a href="#/quiz">Lancer un premier quiz →</a></p>
      </section>
    `}

    <section class="section">
      <h2>Zone d’administration</h2>
      <p>Si tu veux repartir de zéro :</p>
      <button class="btn" id="resetAll" style="background:#fdecef;border-color:var(--red);color:var(--red-dark)">Réinitialiser toutes mes données</button>
    </section>
  `;
}
