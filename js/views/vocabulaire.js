import { vocabulary, themeKeys } from '../../data/vocabulary.js';
import { audioButton } from '../audio.js';

export function renderVocabulaire() {
  const initial = location.hash.split('?')[1] ? new URLSearchParams(location.hash.split('?')[1]).get('theme') : null;
  const activeKey = initial && vocabulary[initial] ? initial : themeKeys[0];

  window.__afterRender = () => {
    document.querySelectorAll('[data-theme]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const k = el.dataset.theme;
        showTheme(k);
      });
    });
    const search = document.getElementById('vocabSearch');
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

  function showTheme(key) {
    const list = document.getElementById('vocabList');
    const title = document.getElementById('themeTitle');
    document.querySelectorAll('[data-theme]').forEach(el => {
      el.classList.toggle('active', el.dataset.theme === key);
    });
    const theme = vocabulary[key];
    title.innerHTML = `${theme.icon} ${theme.label} <small>(${theme.words.length} mots)</small>`;
    list.innerHTML = theme.words.map(w => `
      <div class="word">
        <div class="pl">${w.pl}</div>
        <div class="fr">${w.fr}</div>
        ${audioButton(w.pl)}
      </div>
    `).join('');
    document.getElementById('vocabSearch').value = '';
  }
  // Expose for after render
  window.__showTheme = showTheme;

  const startKey = activeKey;
  const startTheme = vocabulary[startKey];

  return `
    <h1>Vocabulaire thématique</h1>
    <p class="lead">Près de 500 mots classés en ${themeKeys.length} thèmes.
       Chaque mot est lu à voix haute en polonais natif. Clique sur 🔊 pour entendre la prononciation.</p>

    <div class="chips">
      ${themeKeys.map(k => `
        <a class="chip ${k === startKey ? 'active' : ''}" href="#/vocabulaire" data-theme="${k}">${vocabulary[k].icon} ${vocabulary[k].label}</a>
      `).join('')}
    </div>

    <div class="search-bar">
      <input id="vocabSearch" type="search" placeholder="Filtrer dans ce thème (français ou polonais)…" />
    </div>

    <h2 id="themeTitle">${startTheme.icon} ${startTheme.label} <small>(${startTheme.words.length} mots)</small></h2>
    <div id="vocabList" class="wordlist">
      ${startTheme.words.map(w => `
        <div class="word">
          <div class="pl">${w.pl}</div>
          <div class="fr">${w.fr}</div>
          ${audioButton(w.pl)}
        </div>
      `).join('')}
    </div>

    <div class="callout tip" style="margin-top:1.5rem">
      <strong>💡 Pour mémoriser :</strong> envoie ce vocabulaire dans tes flashcards.
      <a href="#/flashcards">Lancer une session de révision →</a>
    </div>
  `;
}
