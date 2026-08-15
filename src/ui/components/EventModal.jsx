import React from 'react';
import { actions } from '../store.js';

/**
 * Présentation d'un événement (§29).
 * Les événements sans choix affichent leur résolution ; les autres bloquent
 * jusqu'à ce que le joueur tranche.
 */
export default function EventModal({ event, outcome }) {
  const resolved = event.resolvedOnly || event.resolved;
  return (
    <div className="modal-backdrop">
      <div className="modal">
        {event.tags?.length > 0 && (
          <div className="chips small">
            {event.tags.map((t) => (
              <span key={t} className="chip static">{t}</span>
            ))}
          </div>
        )}
        <h2>{event.title}</h2>
        <p className="event-text">{event.text}</p>

        {resolved ? (
          <>
            {(event.outcome || outcome) && <p className="outcome">{event.outcome || outcome}</p>}
            <button className="primary" onClick={actions.dismissEvent}>Continuer</button>
          </>
        ) : (
          <div className="choices">
            {event.choices.map((c) => (
              <button
                key={c.id}
                className={`choice ${c.risky ? 'risky' : ''}`}
                onClick={() => actions.chooseEvent(c.id)}
              >
                <strong>{c.label}</strong>
                {c.hint && <span className="muted">{c.hint}</span>}
                {c.risky && <span className="risk-tag">risqué</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
