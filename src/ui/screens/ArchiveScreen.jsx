import React, { useState } from 'react';
import { actions, useStore } from '../store.js';
import { formatMoney, formatFollowers } from '../../engine/view.js';
import CareerChart from '../components/CareerChart.jsx';

/**
 * Le musée des carrières terminées (§52, étape 9K).
 *
 * Une carrière se terminait et disparaissait. Le jeu perdait ce qui fait
 * l'intérêt d'un simulateur rejouable : pouvoir dire « celle-là était
 * différente, et voilà en quoi ».
 */
export default function ArchiveScreen() {
  const state = useStore();
  const fiches = actions.archive();
  const [choix, setChoix] = useState([]);

  const basculer = (id) => {
    setChoix((prev) => {
      const suivant = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2);
      if (suivant.length === 2) actions.compareCareers(suivant[0], suivant[1]);
      else actions.closeComparison();
      return suivant;
    });
  };

  if (fiches.length === 0) {
    return (
      <div className="screen archive">
        <h1>Carrières terminées</h1>
        <section className="card">
          <p className="muted">
            Aucune carrière archivée pour l’instant. Chaque carrière menée
            jusqu’à son terme viendra s’inscrire ici, et vous pourrez les
            comparer deux à deux.
          </p>
          <button className="primary" onClick={() => actions.quitToHome()}>Menu</button>
        </section>
      </div>
    );
  }

  return (
    <div className="screen archive">
      <h1>Carrières terminées</h1>
      <p className="muted">
        {fiches.length} carrière{fiches.length > 1 ? 's' : ''} archivée{fiches.length > 1 ? 's' : ''}.
        {' '}Touchez-en deux pour les comparer.
      </p>

      {state.compare && <Comparaison c={state.compare} />}

      <div className="fiches">
        {fiches.map((f) => (
          <Fiche key={f.id} f={f} choisi={choix.includes(f.id)} onClick={() => basculer(f.id)} />
        ))}
      </div>

      <button className="secondary" onClick={() => actions.quitToHome()}>Menu</button>
    </div>
  );
}

function Fiche({ f, choisi, onClick }) {
  return (
    <section className={`card fiche ${choisi ? 'choisie' : ''}`} onClick={onClick}>
      <div className="fiche-tete">
        <div>
          <h2>{f.nick}</h2>
          <p className="muted">{f.archetype ?? '—'} · {f.debut}–{f.finAnnee}</p>
        </div>
        <div className="fiche-score">{f.global}<span>/100</span></div>
      </div>

      <div className="fiche-chiffres">
        <Chiffre v={`${f.annees} ans`} l="carrière" />
        <Chiffre v={f.titres} l={f.titres > 1 ? 'titres' : 'titre'} />
        <Chiffre v={f.matchs} l="matchs" />
        <Chiffre v={f.picNiveau} l="pic" />
      </div>

      {f.courbe?.length >= 2 && (
        <CareerChart chart={{
          points: f.courbe.map((p) => ({ ...p, org: null, matchs: 0, transfert: p.transfert ? '—' : null })),
          bas: Math.floor(Math.min(...f.courbe.map((p) => p.niveau)) - 6),
          haut: Math.ceil(Math.max(...f.courbe.map((p) => p.niveau)) + 6),
          tronquee: false,
        }} />
      )}

      <p className="muted small">
        {formatMoney(f.gains)} · {formatFollowers(f.abonnes)} abonnés · {f.jeux.join(', ')}
      </p>

      <button
        className="ghost danger small"
        onClick={(e) => { e.stopPropagation(); actions.deleteArchived(f.id); }}
      >
        Retirer
      </button>
    </section>
  );
}

function Chiffre({ v, l }) {
  return (
    <div className="bilan-chiffre">
      <strong>{v}</strong>
      <span>{l}</span>
    </div>
  );
}

/**
 * La comparaison. Une grandeur qui ne se classe pas — le nombre de structures
 * traversées — n'affiche pas de vainqueur : le jeu ne juge pas qu'il vaut
 * mieux bouger que rester.
 */
function Comparaison({ c }) {
  return (
    <section className="card comparaison">
      <div className="comp-tete">
        <div className="comp-nom a"><strong>{c.a.nick}</strong><span className="muted">{c.a.periode}</span></div>
        <span className="comp-vs">contre</span>
        <div className="comp-nom b"><strong>{c.b.nick}</strong><span className="muted">{c.b.periode}</span></div>
      </div>

      {c.resume.length > 0 ? (
        <p className="comp-resume">
          Ce qui les sépare :{' '}
          {c.resume.map((d, i) => (
            <span key={d.cle}>
              {i > 0 && ', '}
              <strong>{d.label.toLowerCase()}</strong>{' '}
              {d.ecart > 0 ? `+${Math.round(d.ecart)} pour ${c.a.etiquette}` : `+${Math.round(-d.ecart)} pour ${c.b.etiquette}`}
            </span>
          ))}
          .
        </p>
      ) : (
        <p className="comp-resume muted">
          Deux carrières très proches : aucune dimension ne les sépare nettement.
        </p>
      )}

      <table className="comp-table">
        <tbody>
          {c.axes.map((l) => (
            <tr key={l.cle}>
              <td className={`comp-val ${l.meilleur === 'a' ? 'gagne' : ''}`}>
                {formatValeur(l.a, l)}
              </td>
              <th>{l.label}</th>
              <td className={`comp-val ${l.meilleur === 'b' ? 'gagne' : ''}`}>
                {formatValeur(l.b, l)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="secondary" onClick={actions.closeComparison}>Fermer</button>
    </section>
  );
}

function formatValeur(v, l) {
  if (l.unite === '€') return formatMoney(v);
  if (l.cle === 'abonnes') return formatFollowers(v);
  const n = l.decimales ? v.toFixed(l.decimales) : Math.round(v).toLocaleString('fr-FR');
  return l.unite ? `${n} ${l.unite}` : n;
}
