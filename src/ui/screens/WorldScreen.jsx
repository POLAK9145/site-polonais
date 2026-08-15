import React, { useState } from 'react';
import { useStore } from '../store.js';
import { worldView } from '../../engine/view.js';

/** Page Monde (§66) : la carrière existe dans un écosystème qui vit. */
export default function WorldScreen() {
  const { session } = useStore();
  const person = session.world.persons[session.career.personId];
  const [focus, setFocus] = useState(person.gameId);
  const view = worldView(session, { gameId: focus });

  return (
    <div className="screen world">
      <h1>Le monde</h1>

      <section className="card">
        <h2>Scènes</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Jeu</th>
              <th>Popularité</th>
              <th>Patch</th>
              <th>Méta</th>
            </tr>
          </thead>
          <tbody>
            {view.games.map((g) => (
              <tr
                key={g.id}
                className={`${g.isCurrent ? 'me' : ''} ${focus === g.id ? 'focused' : ''} ${!g.alive ? 'dead' : ''}`}
                onClick={() => setFocus(g.id)}
              >
                <td>
                  {g.shortName}
                  {!g.alive && <span className="muted"> (scène morte)</span>}
                </td>
                <td>{g.popularity}</td>
                <td className="muted">{g.patch}</td>
                <td className="muted">{g.meta}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Touchez un jeu pour consulter sa scène.</p>
      </section>

      <section className="card">
        <h2>Meilleures équipes</h2>
        <table className="table">
          <tbody>
            {view.teams.map((t, i) => (
              <tr key={t.id} className={t.isMine ? 'me' : ''}>
                <td>{i + 1}</td>
                <td>{t.name}</td>
                <td className="muted">{t.region}</td>
                <td>{t.strength}</td>
                <td className="muted">{t.titles} titres</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Meilleurs joueurs</h2>
        <table className="table">
          <tbody>
            {view.players.map((p, i) => (
              <tr key={p.id} className={p.isPlayer ? 'me' : ''}>
                <td>{i + 1}</td>
                <td>{p.nick}</td>
                <td className="muted">{p.team ?? 'libre'}</td>
                <td>{p.age}</td>
                <td>{p.rating}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {view.ranking.length > 0 && (
        <section className="card">
          <h2>Classement de la saison</h2>
          <table className="table">
            <tbody>
              {view.ranking.map((r, i) => (
                <tr key={i} className={r.isMine ? 'me' : ''}>
                  <td>{i + 1}</td>
                  <td>{r.name}</td>
                  <td>{r.points} pts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>Actualités</h2>
        {view.news.length === 0 && <p className="muted">Rien à signaler.</p>}
        {view.news.map((n, i) => (
          <p key={i} className={`news-item ${n.tone}`}>
            <span className="muted">{n.date}</span> <strong>{n.headline}</strong>
            {n.body && <span className="muted"> — {n.body}</span>}
          </p>
        ))}
      </section>
    </div>
  );
}
