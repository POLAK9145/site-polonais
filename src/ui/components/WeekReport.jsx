import React from 'react';

/** Ce qui s'est passé pendant les semaines simulées. */
export default function WeekReport({ reports }) {
  if (!reports || reports.length === 0) return null;
  const matches = reports.flatMap((r) => r.matches ?? []);
  const messages = reports.flatMap((r) => r.messages ?? []);
  const comps = reports.flatMap((r) => r.finishedCompetitions ?? []);
  const news = reports.flatMap((r) => r.news ?? []);
  if (matches.length + messages.length + comps.length + news.length === 0) {
    return (
      <section className="card quiet">
        <p className="muted">Semaine calme. Entraînement, routine, rien de notable.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>Ce qui s’est passé</h2>

      {matches.map((m, i) => (
        <div key={i} className={`match ${m.won ? 'won' : 'lost'}`}>
          <div className="match-head">
            <strong>{m.won ? 'Victoire' : 'Défaite'} {m.scoreFor}—{m.scoreAgainst}</strong>
            <span className="muted">vs {m.opponent}</span>
          </div>
          <div className="match-sub">
            <span className="muted">{m.label}</span>
            <span className={`note ${m.score >= 7 ? 'good' : m.score < 5 ? 'bad' : ''}`}>
              Votre note : {m.score.toFixed(1)}/10 {m.mvp && '· MVP'}
            </span>
          </div>
          {m.highlights.map((h, j) => (
            <p key={j} className="highlight">{h.text}</p>
          ))}
        </div>
      ))}

      {comps.map((c, i) => (
        <p key={i} className={c.champion ? 'title-line' : 'muted'}>
          {c.champion ? `🏆 Vainqueur — ${c.name}` : `${c.name} : ${c.rank ? `${c.rank}e place` : 'éliminé'}`}
        </p>
      ))}

      {messages.map((m, i) => (
        <p key={i} className="message">{m}</p>
      ))}

      {news.length > 0 && (
        <div className="news">
          {news.map((n, i) => (
            <p key={i} className={`news-item ${n.tone}`}>
              <strong>{n.headline}</strong>
              {n.body && <span className="muted"> — {n.body}</span>}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
