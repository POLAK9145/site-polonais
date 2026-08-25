import React from 'react';
import { useStore } from '../store.js';
import { statsView } from '../../engine/view.js';

/** Page Statistiques et succès (§67, §36). */
export default function StatsScreen() {
  const { session } = useStore();
  const s = statsView(session);

  return (
    <div className="screen stats">
      <h1>Statistiques</h1>

      <section className="card">
        <div className="header-grid">
          <Cell label="Matchs" value={s.matches} />
          <Cell label="Victoires" value={s.wins} />
          <Cell label="Défaites" value={s.losses} />
          <Cell label="Taux de victoire" value={`${s.winRate}%`} />
          <Cell label="Titres" value={s.titles} />
          <Cell label="Tournois d’entrée" value={s.minorTitles} />
          <Cell label="Finales" value={s.finals} />
          <Cell label="MVP" value={s.mvps} />
          <Cell label="Titres internationaux" value={s.internationalTitles} />
          <Cell label="Gains" value={s.earnings} />
          <Cell label="Meilleur niveau" value={s.peakRating} sub={s.peakYear ? `en ${s.peakYear}` : ''} />
          <Cell label="Saisons pro" value={s.seasonsPro} />
          <Cell label="Organisations" value={s.orgs} />
          <Cell label="Jeux" value={s.games.join(', ') || '—'} />
          <Cell label="Décisions prises" value={s.decisions} />
          <Cell label="Fois écarté" value={s.timesReleased} />
          <Cell label="Abonnés" value={s.followers} />
        </div>
      </section>

      <section className="card">
        <h2>Succès obtenus ({s.achievements.length})</h2>
        {s.achievements.length === 0 && <p className="muted">Aucun pour l’instant.</p>}
        <div className="list">
          {s.achievements.map((a) => (
            <div key={a.id} className="list-item static unlocked">
              <strong>{a.label} <span className="muted">· {a.year}</span></strong>
              <span className="muted">{a.desc}</span>
              <span className={`rarity ${a.rarity.replace(/\s/g, '-')}`}>{a.rarity}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>À débloquer</h2>
        {/* Ce qu'on ne nomme pas (§35, étape 9M) : dire lesquels reviendrait à
            ne pas les cacher. */}
        {s.hiddenRemaining > 0 && (
          <p className="secrets">
            <strong>{s.hiddenRemaining}</strong>{' '}
            {s.hiddenRemaining > 1 ? 'succès restent à découvrir' : 'succès reste à découvrir'}.
            {' '}<span className="muted">
              Ils ne récompensent pas des objectifs, mais des chemins.
            </span>
          </p>
        )}
        {s.hiddenTotal > 0 && s.hiddenRemaining === 0 && (
          <p className="secrets trouve">
            <strong>Vous les avez tous trouvés.</strong>
          </p>
        )}
        <div className="list">
          {s.lockedAchievements.map((a) => (
            <div key={a.id} className="list-item static locked">
              <strong>{a.label}</strong>
              <span className="muted">{a.desc}</span>
              <span className={`rarity ${a.rarity.replace(/\s/g, '-')}`}>{a.rarity}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Cell({ label, value, sub }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
