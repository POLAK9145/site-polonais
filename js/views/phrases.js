import { phraseCategories } from '../../data/phrases.js';
import { audioButton } from '../audio.js';

export function renderPhrases() {
  window.__afterRender = () => {
    const search = document.getElementById('phraseSearch');
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        document.querySelectorAll('.word').forEach(w => {
          const txt = w.textContent.toLowerCase();
          w.style.display = txt.includes(q) ? '' : 'none';
        });
      });
    }
  };

  return `
    <h1>Phrases utiles par situation</h1>
    <p class="lead">Plus de 100 phrases prêtes à l’emploi, classées par scénario.
       Mémorise-les en bloc : tu seras opérationnel en quelques semaines.</p>

    <div class="search-bar">
      <input id="phraseSearch" type="search" placeholder="Filtrer (français ou polonais)…" />
    </div>

    ${phraseCategories.map(cat => `
      <section class="section">
        <div class="section-title">
          <h2>${cat.icon} ${cat.label}</h2>
          <small>${cat.phrases.length} phrases</small>
        </div>
        <div class="wordlist">
          ${cat.phrases.map(p => `
            <div class="word">
              <div class="pl">${p.pl}</div>
              <div class="fr">${p.fr}</div>
              ${audioButton(p.pl)}
            </div>
          `).join('')}
        </div>
      </section>
    `).join('')}
  `;
}
