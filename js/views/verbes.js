import { verbs, getVerb } from '../../data/verbs.js';
import { audioButton } from '../audio.js';

function conjTable(name, conj) {
  const rows = [
    ['ja', conj.ja],
    ['ty', conj.ty],
    ['on / ona / ono', conj.on],
    ['my', conj.my],
    ['wy', conj.wy],
    ['oni / one', conj.oni],
  ];
  return `
    <h3>${name}</h3>
    <div class="table-wrap">
      <table class="poltable">
        <thead><tr><th>Personne</th><th>Forme</th><th>Audio</th></tr></thead>
        <tbody>
          ${rows.map(([p, f]) => `
            <tr>
              <td>${p}</td>
              <td class="pl">${f}</td>
              <td>${audioButton(stripHints(f))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// Some past-tense / future rows contain a slash like "miał/miała".
// We pick the first form for audio so the TTS reads something natural.
function stripHints(s) {
  if (!s) return '';
  const trimmed = s.replace(/\s*\(.*?\)\s*/g, '').trim();
  return trimmed.split('/')[0].trim();
}

export function renderVerbes() {
  return `
    <h1>Verbes essentiels</h1>
    <p class="lead">Une vingtaine de verbes couvrent 60 % des phrases du quotidien.
       Maîtrise-les à fond avant tout le reste.</p>

    <div class="grid cols-3">
      ${verbs.map(v => `
        <a class="card linkcard" href="#/verbes/${v.id}">
          <span class="tag">${v.aspect}</span>
          <h3>${v.inf}</h3>
          <p><strong>${v.fr}</strong></p>
          <small>${v.partner ? 'Couple aspectuel avec : ' + v.partner : 'Pas de pair perfectif fixe'} · groupe ${v.group}</small>
        </a>
      `).join('')}
    </div>
  `;
}

export function renderVerbe(id) {
  const v = getVerb(id);
  if (!v) return `<h1>Verbe introuvable</h1><p><a href="#/verbes">← Retour</a></p>`;

  return `
    <p><a href="#/verbes">← Tous les verbes</a></p>
    <h1>${v.inf} — <span style="color:var(--muted)">${v.fr}</span></h1>
    <p>
      <span class="tag" style="background:var(--red);color:#fff;display:inline-block;padding:.2rem .6rem;border-radius:999px;font-size:.8rem;font-weight:600;">${v.aspect}</span>
      <span class="tag" style="background:#f3efe6;color:var(--ink);display:inline-block;padding:.2rem .6rem;border-radius:999px;font-size:.8rem;font-weight:600;">groupe ${v.group}</span>
      ${v.partner ? `<span class="tag" style="background:#eef7ff;color:#18406b;display:inline-block;padding:.2rem .6rem;border-radius:999px;font-size:.8rem;font-weight:600;">partenaire perfectif : ${v.partner}</span>` : ''}
    </p>

    ${conjTable('Présent', v.present)}
    ${conjTable('Passé — masculin', v.past.m)}
    ${conjTable('Passé — féminin', v.past.f)}
    ${conjTable('Futur', v.future)}

    <section class="section">
      <h2>Exemples</h2>
      <div class="wordlist">
        ${v.examples.map(ex => `
          <div class="word">
            <div class="pl">${ex.pl}</div>
            <div class="fr">${ex.fr}</div>
            ${audioButton(ex.pl)}
          </div>
        `).join('')}
      </div>
    </section>
  `;
}
