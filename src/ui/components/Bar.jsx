import React from 'react';

/** Jauge simple. `invert` colore en rouge quand la valeur est haute. */
export default function Bar({ label, value, invert = false, max = 100 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const level = invert
    ? pct > 70 ? 'bad' : pct > 45 ? 'warn' : 'good'
    : pct > 65 ? 'good' : pct > 35 ? 'warn' : 'bad';
  return (
    <div className="bar">
      <div className="bar-head">
        <span>{label}</span>
        <span className="muted">{Math.round(value)}</span>
      </div>
      <div className="bar-track">
        <div className={`bar-fill ${level}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
