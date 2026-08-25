import React from 'react';
import { actions } from '../store.js';

/**
 * Présentation d'un événement (§29).
 * Les événements sans choix affichent leur résolution ; les autres bloquent
 * jusqu'à ce que le joueur tranche.
 */
export default function EventModal({ event, outcome, consequences = [] }) {
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
            {/* Ce que la décision a réellement changé (étape 9B). Le moteur le
                calculait au centième près sans jamais le montrer : le joueur
                choisissait à l'aveugle et ne pouvait rien en apprendre. */}
            {consequences.length > 0 && (
              <div className="consequences">
                {consequences.map((c) => (
                  <span key={c.cle} className={`consequence ${c.delta > 0 ? 'plus' : 'moins'}`}>
                    {c.label} <strong>{c.delta > 0 ? `+${c.delta}` : c.delta}</strong>
                  </span>
                ))}
              </div>
            )}
            <button className="primary" onClick={actions.dismissEvent}>Continuer</button>
          </>
        ) : (
          <>
            {/* Ce que le joueur ressent déjà en tranchant (étape 9I).
                Mesuré : ce qui décide de la casse n'est pas le choix mais la
                charge accumulée — 8 carrières sur 12 en rupture chez qui
                s'entraîne sans relâche, 0 sur 12 chez qui se ménage. L'état
                n'est rappelé que devant un choix risqué, là où il pèse. */}
            {event.charge && event.choices.some((c) => c.risky) && (
              <p className={`etat-ressenti ${event.charge.lourde ? 'lourd' : ''}`}>
                Vous abordez ce moment {event.charge.label}.
              </p>
            )}
            <div className="choices">
              {event.choices.map((c) => (
                <button
                  key={c.id}
                  className={`choice ${c.risky ? 'risky' : ''}`}
                  onClick={() => actions.chooseEvent(c.id)}
                >
                  <strong>{c.label}</strong>
                  {c.hint && <span className="muted">{c.hint}</span>}
                  {/* « risqué » se lisait comme « moins bien tout de suite ».
                      Le vrai risque est ailleurs : 10 de ces 12 choix
                      programment une suite différée ou tirent au sort. */}
                  {c.risky && <span className="risk-tag">la suite peut coûter</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
