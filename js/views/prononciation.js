import { pronunciationRules } from '../../data/alphabet.js';
import { audioButton } from '../audio.js';

export function renderPrononciation() {
  return `
    <h1>Règles de prononciation</h1>
    <p class="lead">Le polonais a une orthographe quasi phonétique : chaque lettre se prononce toujours
       de la même façon. Voici les règles qui font la différence entre un accent reconnaissable et un accent fluide.</p>

    <div class="callout tip">
      <strong>💡 Bonne nouvelle :</strong> contrairement au français, en polonais on prononce toutes les lettres écrites
      (sauf rares cas d’assimilation). Ce que tu lis, tu le dis.
    </div>

    ${pronunciationRules.map(rule => `
      <section class="section">
        <div class="section-title">
          <h2>${rule.title}</h2>
          <small>${rule.examples.length} exemple${rule.examples.length>1?'s':''}</small>
        </div>
        <p>${rule.body}</p>
        <div class="wordlist">
          ${rule.examples.map(ex => {
            const plOnly = ex.split('(')[0].trim();
            const fr = ex.includes('(') ? ex.substring(ex.indexOf('(')) : '';
            return `
              <div class="word">
                <div class="pl">${plOnly}</div>
                <div class="fr">${fr}</div>
                ${audioButton(plOnly)}
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `).join('')}

    <section class="section">
      <h2>Entraîne ton oreille</h2>
      <p>Le polonais a un rythme et une mélodie particuliers. Pour progresser rapidement :</p>
      <ul>
        <li>Écoute des podcasts pour apprenants (Real Polish, Easy Polish).</li>
        <li>Regarde des films polonais sous-titrés (Kogel-Mogel, Bogowie, Cold War).</li>
        <li>Répète à voix haute après chaque écoute, même 30 secondes par jour.</li>
        <li>Enregistre-toi de temps en temps — tu progresseras plus vite.</li>
      </ul>
    </section>

    <section class="section">
      <a class="btn primary" href="#/grammaire">Continuer : la grammaire essentielle →</a>
    </section>
  `;
}
