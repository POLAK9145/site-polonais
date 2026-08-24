import React from 'react';

/** Ce qui s'est passé pendant les semaines simulées. */
export default function WeekReport({ reports }) {
  if (!reports || reports.length === 0) return null;
  const matches = reports.flatMap((r) => r.matches ?? []);
  const messages = reports.flatMap((r) => r.messages ?? []);
  const comps = reports.flatMap((r) => r.finishedCompetitions ?? []);
  const news = reports.flatMap((r) => r.news ?? []);
  const saisons = reports.map((r) => r.season).filter(Boolean);
  if (matches.length + messages.length + comps.length + news.length + saisons.length === 0) {
    return (
      <section className="card quiet">
        <p className="muted">Semaine calme. Entraînement, routine, rien de notable.</p>
      </section>
    );
  }
  return (
    <>
      {saisons.map((b, i) => (
        <BilanSaison key={i} bilan={b} />
      ))}

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
    </>
  );
}

/**
 * Le bilan d'une saison (étape 9A).
 *
 * Une carrière de vingt ans, c'est vingt saisons. Sans bilan, ce sont mille
 * semaines qui se ressemblent : le joueur ne pouvait ni se souvenir d'une
 * saison, ni les comparer, ni savoir s'il avait progressé. Tout ce qui est
 * affiché ici est une DIFFÉRENCE entre le début et la fin de la saison, pas un
 * compteur parallèle — le total cumulé reste la seule source.
 */
function BilanSaison({ bilan }) {
  const { objective } = bilan;
  return (
    <section className="card bilan-saison">
      <div className="bilan-tete">
        <span className="bilan-annee">Saison {bilan.year}</span>
        {bilan.club && <span className="muted">{bilan.club}</span>}
      </div>

      <blockquote className="bilan-titre">« {bilan.headline} »</blockquote>

      <div className="bilan-chiffres">
        <Chiffre valeur={bilan.matches} libelle={bilan.matches > 1 ? 'matchs' : 'match'} />
        <Chiffre valeur={bilan.wins} libelle={bilan.wins > 1 ? 'victoires' : 'victoire'} />
        <Chiffre valeur={bilan.winRate == null ? '—' : `${bilan.winRate} %`} libelle="réussite" />
        <Chiffre
          valeur={bilan.progression == null ? '—' : bilan.progression > 0 ? `+${bilan.progression}` : bilan.progression}
          libelle="niveau"
          ton={bilan.progression > 0 ? 'good' : bilan.progression < 0 ? 'bad' : ''}
        />
      </div>

      {(bilan.titles > 0 || bilan.finals > 0 || bilan.mvps > 0) && (
        <p className="bilan-ligne bon">
          {bilan.titles > 0 && `🏆 ${bilan.titles} titre${bilan.titles > 1 ? 's' : ''}`}
          {bilan.finals > 0 && `${bilan.titles > 0 ? ' · ' : ''}${bilan.finals} finale${bilan.finals > 1 ? 's' : ''}`}
          {bilan.mvps > 0 && ` · ${bilan.mvps} MVP`}
        </p>
      )}

      {objective && objective.tenu !== null && (
        <p className={`bilan-ligne ${objective.tenu ? 'bon' : 'mauvais'}`}>
          {objective.tenu ? '✅' : '❌'} Objectif de la structure : {objective.label}
          {objective.tenu && objective.prime > 0 && (
            <strong> — prime {objective.prime.toLocaleString('fr-FR')} €</strong>
          )}
        </p>
      )}

      {/* Manquer de temps de jeu suppose d'avoir une équipe. Sans club, zéro
          match n'est pas une alerte : c'est la situation, et la première
          version félicitait le joueur de travailler loin des projecteurs tout
          en l'alertant dans la phrase suivante. */}
      {bilan.club && bilan.matches <= 4 && bilan.weeks > 30 && (
        <p className="bilan-ligne alerte">⚠️ Très peu de temps de jeu cette saison.</p>
      )}

      {bilan.earnings > 0 && (
        <p className="bilan-ligne argent">
          💰 {bilan.earnings.toLocaleString('fr-FR')} € gagnés
          {bilan.followersGained > 500 && ` · +${bilan.followersGained.toLocaleString('fr-FR')} abonnés`}
        </p>
      )}

      {bilan.orgEnd && bilan.orgStart && bilan.orgEnd !== bilan.orgStart && (
        <p className="bilan-ligne muted">Vous avez quitté {bilan.orgStart} pour {bilan.orgEnd}.</p>
      )}
    </section>
  );
}

function Chiffre({ valeur, libelle, ton = '' }) {
  return (
    <div className="bilan-chiffre">
      <strong className={ton}>{valeur}</strong>
      <span>{libelle}</span>
    </div>
  );
}
