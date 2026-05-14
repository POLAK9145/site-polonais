import { lessons, levels, getLesson } from '../../data/lessons.js';
import { lessonDone, markLessonDone } from '../storage.js';

function lessonCardHtml(l) {
  const done = lessonDone(l.id);
  return `
    <a class="lesson" href="#/parcours/${l.id}">
      <div class="num">${done ? '✓' : l.level}</div>
      <div class="meta">
        <strong>${l.title}</strong>
        <small>${l.weeks ? 'Semaine ' + l.weeks : ''} · ${l.objectives.length} objectifs</small>
      </div>
      <span class="btn small">${done ? 'Revoir' : 'Ouvrir →'}</span>
    </a>
  `;
}

export function renderParcours() {
  const byLevel = {};
  for (const l of lessons) {
    byLevel[l.level] = byLevel[l.level] || [];
    byLevel[l.level].push(l);
  }
  const done = lessons.filter(l => lessonDone(l.id)).length;
  const pct = Math.round((done / lessons.length) * 100);

  let html = `
    <h1>Parcours guidé</h1>
    <p class="lead">Un programme structuré, du débutant complet (A0) à l’autonomie (B1).
       Chaque leçon précise des objectifs concrets et te renvoie vers les outils de l’app.</p>

    <div class="card" style="margin-bottom:1rem;">
      <strong>Progression globale : ${done} / ${lessons.length} leçons</strong>
      <div class="progress-bar"><span style="width:${pct}%"></span></div>
    </div>
  `;

  for (const level of levels) {
    const list = byLevel[level];
    if (!list) continue;
    html += `
      <section class="section">
        <div class="section-title"><h2>Niveau ${level}</h2><small>${list.length} leçons</small></div>
        <div class="lesson-list">${list.map(lessonCardHtml).join('')}</div>
      </section>
    `;
  }
  return html;
}

export function renderLesson(id) {
  const l = getLesson(id);
  if (!l) return `<h1>Leçon introuvable</h1><p><a href="#/parcours">← Retour au parcours</a></p>`;
  const done = lessonDone(l.id);

  window.__afterRender = () => {
    const btn = document.getElementById('markDone');
    if (btn) {
      btn.addEventListener('click', () => {
        markLessonDone(l.id);
        location.hash = '#/parcours';
      });
    }
  };

  return `
    <p><a href="#/parcours">← Parcours</a></p>
    <span class="tag" style="background:var(--red);color:#fff;display:inline-block;padding:.2rem .6rem;border-radius:999px;font-size:.8rem;font-weight:600;letter-spacing:.02em;">Niveau ${l.level}${l.weeks ? ' · semaine ' + l.weeks : ''}</span>
    <h1 style="margin-top:.3rem">${l.title}</h1>

    <section class="section">
      <h3>Objectifs</h3>
      <ul>${l.objectives.map(o => `<li>${o}</li>`).join('')}</ul>
    </section>

    <section class="section">
      <h3>À retenir</h3>
      ${l.body.map(p => `<p>${p}</p>`).join('')}
    </section>

    <section class="section">
      <h3>Pratique maintenant</h3>
      <div class="chips">
        ${l.targets.map(t => `<a class="chip active" href="${t.href}">${t.label} →</a>`).join('')}
      </div>
    </section>

    <button class="btn primary" id="markDone">${done ? 'Leçon déjà terminée — marquer à nouveau' : 'Marquer cette leçon comme terminée'}</button>
  `;
}
