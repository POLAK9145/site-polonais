import { grammarTopics, getTopic } from '../../data/grammar.js';
import { audioButton } from '../audio.js';

function renderTable(t) {
  return `
    <div class="table-wrap">
      <table class="poltable">
        <thead><tr>${t.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>
          ${t.rows.map(row => `<tr>${row.map((c,i) => `<td${i===2 || (t.headers[i] && /Exemple/i.test(t.headers[i])) ? ' class="pl"' : ''}>${c}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

export function renderGrammaire() {
  return `
    <h1>Grammaire essentielle</h1>
    <p class="lead">Le polonais a la réputation d’être difficile — en réalité, il est très logique
       une fois qu’on a saisi trois choses : les genres, les 7 cas, et l’aspect verbal.
       Choisis un sujet ci-dessous.</p>

    <div class="grid cols-3">
      ${grammarTopics.map(t => `
        <a class="card linkcard" href="#/grammaire/${t.id}">
          <span class="tag">${t.id}</span>
          <h3>${t.title}</h3>
          <p>${t.intro}</p>
        </a>
      `).join('')}
    </div>
  `;
}

export function renderGrammaireTopic(id) {
  const t = getTopic(id);
  if (!t) return `<h1>Sujet introuvable</h1><p><a href="#/grammaire">← Retour</a></p>`;

  return `
    <p><a href="#/grammaire">← Grammaire</a></p>
    <h1>${t.title}</h1>
    <p class="lead">${t.intro}</p>

    ${t.sections.map(s => `
      <section class="section">
        <h2>${s.h}</h2>
        ${s.p ? `<p>${s.p}</p>` : ''}
        ${s.table ? renderTable(s.table) : ''}
      </section>
    `).join('')}

    <section class="section">
      <h2>Pour aller plus loin</h2>
      <div class="chips">
        ${grammarTopics
          .filter(o => o.id !== t.id)
          .slice(0, 6)
          .map(o => `<a class="chip" href="#/grammaire/${o.id}">${o.title}</a>`).join('')}
      </div>
    </section>
  `;
}
