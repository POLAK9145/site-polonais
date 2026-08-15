import React from 'react';
import { actions, useStore } from '../store.js';

export default function HomeScreen() {
  useStore();
  const saveInfo = actions.saveInfo();

  return (
    <div className="screen home">
      <div className="home-hero">
        <h1>CIRCUIT</h1>
        <p className="tagline">Simulateur de carrière e-sport</p>
        <p className="lede">
          Vous ne jouez pas aux matchs. Vous jouez la vie d’un joueur professionnel :
          les choix, les équipes, les rivalités, les erreurs, et ce qu’il en reste
          quinze ans plus tard.
        </p>
      </div>

      <div className="home-actions">
        <button className="primary big" onClick={() => actions.setScreen('create')}>
          Nouvelle carrière
        </button>
        {saveInfo && (
          <button className="secondary big" onClick={() => actions.loadAutosave()}>
            Reprendre — {saveInfo.nick}
          </button>
        )}
      </div>

      <section className="card">
        <h2>Ce que fait la simulation</h2>
        <ul className="feature-list">
          <li>Un monde généré par seed : scènes, organisations, joueurs, métas.</li>
          <li>Des centaines de joueurs qui ont leur propre carrière, sans vous.</li>
          <li>Neuf jeux fictifs aux exigences réellement différentes.</li>
          <li>Des patches qui renversent les métas et peuvent briser une carrière.</li>
          <li>Un marché des transferts où chaque offre est explicable.</li>
          <li>Des conséquences qui n’arrivent parfois que des années plus tard.</li>
        </ul>
      </section>

      {saveInfo && (
        <section className="card">
          <h2>Sauvegarde</h2>
          <p className="muted">
            {saveInfo.nick} · semaine {saveInfo.week} · {Math.round(saveInfo.size / 1024)} Ko
          </p>
          <button className="ghost danger" onClick={() => actions.deleteSave()}>
            Supprimer la sauvegarde
          </button>
        </section>
      )}
    </div>
  );
}
