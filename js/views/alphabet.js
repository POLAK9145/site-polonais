import { alphabet, digraphs, foreignLetters } from '../../data/alphabet.js';
import { audioButton } from '../audio.js';

export function renderAlphabet() {
  const tileFor = (entry) => `
    <button class="tile" data-speak="${entry.l.toLowerCase()}" aria-label="Écouter ${entry.l}">
      <div class="letter">${entry.l} ${entry.l.toLowerCase() !== entry.l ? `<span style="color:var(--muted);font-size:1.1rem">${entry.l.toLowerCase()}</span>` : ''}</div>
      <div class="ipa">${entry.ipa}</div>
      <div class="ex">${entry.fr}</div>
      <div style="margin-top:.3rem"><strong>${entry.ex}</strong> — <span style="color:var(--muted)">${entry.trans}</span></div>
    </button>
  `;

  const digraphTile = (d) => `
    <button class="tile" data-speak="${d.ex}" aria-label="Écouter ${d.ex}">
      <div class="letter">${d.d}</div>
      <div class="ipa">${d.ipa}</div>
      <div class="ex">${d.fr}</div>
      <div style="margin-top:.3rem"><strong>${d.ex}</strong> — <span style="color:var(--muted)">${d.trans}</span></div>
    </button>
  `;

  return `
    <h1>L’alphabet polonais</h1>
    <p class="lead">Le polonais utilise <strong>32 lettres</strong> : 9 voyelles et 23 consonnes,
       plus les digraphes (deux lettres formant un seul son). Clique sur chaque tuile pour entendre la lettre.</p>

    <div class="callout tip">
      <strong>💡 À retenir :</strong> les lettres Q, V et X n’existent pas dans les mots polonais
      traditionnels — on les rencontre seulement dans les emprunts étrangers.
    </div>

    <section class="section">
      <div class="section-title"><h2>Les 32 lettres</h2><small>Clic = audio</small></div>
      <div class="alpha">${alphabet.map(tileFor).join('')}</div>
    </section>

    <section class="section">
      <div class="section-title"><h2>Les digraphes (dwuznaki)</h2><small>Deux lettres = un son</small></div>
      <p>Ces combinaisons sont essentielles : sans elles, beaucoup de mots restent illisibles.</p>
      <div class="alpha">${digraphs.map(digraphTile).join('')}</div>
    </section>

    <section class="section">
      <div class="section-title"><h2>Lettres absentes en polonais natif</h2></div>
      <p>Les lettres <strong>${foreignLetters.join(', ')}</strong> n’existent que dans les emprunts (taxi, kiwi, xenon).
         Ne les utilise jamais dans un mot polonais authentique.</p>
    </section>

    <section class="section">
      <a class="btn primary" href="#/prononciation">Étape suivante : les règles de prononciation →</a>
    </section>
  `;
}
