import React, { useState } from 'react';
import { actions, useStore } from '../store.js';
import { computeLegacy, buildNarrative, buildShareCard, careerStats, postCareerOptions } from '../../engine/legacy.js';
import { timelineView, memoriesView, formatMoney } from '../../engine/view.js';
import Bar from '../components/Bar.jsx';

/** Page LEGACY (§48). Construite uniquement à partir de faits survenus. */
export default function LegacyScreen() {
  const { session } = useStore();
  const [copied, setCopied] = useState(false);
  const legacy = computeLegacy(session.world, session.career);
  const narrative = buildNarrative(session.world, session.career, legacy);
  const card = buildShareCard(session.world, session.career, legacy);
  const stats = careerStats(session.world, session.career);
  const timeline = timelineView(session);
  const memories = memoriesView(session);
  const options = postCareerOptions(session.world, session.career);
  const person = session.world.persons[session.career.personId];

  const cardText = ['━━━━━━━━━━━━━━━━━━━━', ...card, '━━━━━━━━━━━━━━━━━━━━'].join('\n');

  async function copyCard() {
    try {
      await navigator.clipboard.writeText(cardText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="screen legacy">
      <h1>{person.nick}</h1>
      <p className="archetype">{legacy.archetype.label}</p>
      <p className="lede">{legacy.archetype.desc}</p>

      <section className="card">
        <h2>Score de carrière</h2>
        <div className="legacy-global">{legacy.global}<span>/100</span></div>
        <Bar label="Grandeur compétitive" value={legacy.dimensions.competitive} />
        <Bar label="Longévité" value={legacy.dimensions.longevity} />
        <Bar label="Impact" value={legacy.dimensions.impact} />
        <Bar label="Popularité" value={legacy.dimensions.popularity} />
        <Bar label="Innovation" value={legacy.dimensions.innovation} />
        <Bar label="Leadership" value={legacy.dimensions.leadership} />
        <Bar label="Légende" value={legacy.dimensions.legend} />
        <p className="hint">
          Le score global n’est pas une note de réussite : une carrière modeste avec
          une vraie histoire vaut mieux qu’un palmarès sans relief.
        </p>
      </section>

      <section className="card">
        <h2>Votre histoire</h2>
        {narrative.map((p, i) => (
          <p key={i} className="narrative">{p}</p>
        ))}
      </section>

      <section className="card">
        <h2>Chiffres</h2>
        <div className="header-grid">
          <Cell label="Durée" value={`${legacy.careerYears} ans`} />
          <Cell label="Matchs" value={stats.matches} />
          <Cell label="Victoires" value={`${Math.round(stats.winRate * 100)}%`} />
          <Cell label="Titres" value={stats.titles} />
          <Cell label="Finales" value={stats.finals} />
          <Cell label="MVP" value={stats.mvps} />
          <Cell label="Gains" value={formatMoney(stats.earnings)} />
          <Cell label="Meilleur niveau" value={stats.peakRating} />
          <Cell label="Jeux" value={stats.games.join(', ')} />
          <Cell label="Organisations" value={stats.orgs} />
        </div>
      </section>

      {memories.length > 0 && (
        <section className="card">
          <h2>Moments marquants</h2>
          {memories.map((m, i) => (
            <div key={i} className="memory">
              <strong>{m.title} <span className="muted">· {m.year}</span></strong>
              <p className="muted">{m.text}</p>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2>Carte de carrière</h2>
        <pre className="share-card">{cardText}</pre>
        <button className="secondary" onClick={copyCard}>
          {copied ? 'Copié !' : 'Copier la carte'}
        </button>
      </section>

      <section className="card">
        <h2>Timeline complète</h2>
        {timeline.map((year) => (
          <div key={year.year} className="timeline-year">
            <h3>{year.year}</h3>
            <ul className="timeline">
              {year.entries.map((e, i) => (
                <li key={i} className={`${e.kind} ${e.important ? 'important' : ''}`}>{e.text}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Et maintenant ?</h2>
        <p className="muted">
          Ces reconversions ne sont pas encore implémentées comme modes de jeu. Elles
          sont listées ici parce que votre profil les rendrait crédibles.
        </p>
        <ul className="goals">
          {options.map((o) => (
            <li key={o.id}>
              <strong>{o.label}</strong> <span className="muted">— {o.desc}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="actions sticky">
        <button className="ghost" onClick={() => actions.setScreen('home')}>Menu</button>
        <button className="primary" onClick={() => actions.setScreen('create')}>Nouvelle carrière</button>
      </div>
    </div>
  );
}

function Cell({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
    </div>
  );
}
