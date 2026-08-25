import React from 'react';

/**
 * La courbe d'une carrière (étape 9G).
 *
 * SVG écrit à la main : le projet n'a aucune dépendance d'exécution, et une
 * bibliothèque de graphiques pour une seule courbe en coûterait plus qu'elle
 * n'apporte.
 *
 * Chaque point est un fait enregistré à la fin de sa saison — jamais reconstitué.
 */
const L = 44;   // marge gauche, pour l'échelle
const R = 12;
const H = 190;
const HAUT = 16;
const BAS = 34;  // place pour les années

export default function CareerChart({ chart }) {
  if (!chart) return null;
  const { points, bas, haut } = chart;
  const largeur = Math.max(320, points.length * 46 + L + R);
  const tracable = largeur - L - R;
  const hauteur = H - HAUT - BAS;

  const x = (i) => L + (points.length === 1 ? tracable / 2 : (i / (points.length - 1)) * tracable);
  const y = (v) => HAUT + hauteur - ((v - bas) / (haut - bas)) * hauteur;

  const ligne = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.niveau).toFixed(1)}`).join(' ');
  const aire = `${ligne} L ${x(points.length - 1).toFixed(1)} ${HAUT + hauteur} L ${x(0).toFixed(1)} ${HAUT + hauteur} Z`;

  // Trois graduations suffisent : la courbe raconte une forme, pas des valeurs
  // au dixième près.
  const graduations = [bas, Math.round((bas + haut) / 2), haut];

  return (
    <div className="career-chart">
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${largeur} ${H}`} width={largeur} height={H} role="img"
             aria-label={`Niveau par saison, de ${points[0].annee} à ${points[points.length - 1].annee}`}>
          {graduations.map((g) => (
            <g key={g}>
              <line x1={L} y1={y(g)} x2={largeur - R} y2={y(g)} className="chart-grid" />
              <text x={L - 8} y={y(g) + 4} className="chart-axis" textAnchor="end">{g}</text>
            </g>
          ))}

          <path d={aire} className="chart-area" />
          <path d={ligne} className="chart-line" />

          {points.map((p, i) => (
            <g key={p.annee}>
              {/* Un transfert change la lecture de tout ce qui suit : on le
                  marque sur l'axe plutôt que dans une légende à part. */}
              {p.transfert && (
                <line x1={x(i)} y1={HAUT} x2={x(i)} y2={HAUT + hauteur} className="chart-transfer" />
              )}
              <circle
                cx={x(i)} cy={y(p.niveau)}
                r={p.titres > 0 ? 5 : 3}
                className={`chart-dot ${p.titres > 0 ? 'titre' : ''}`}
              >
                <title>
                  {`${p.annee} — niveau ${p.niveau}`}
                  {p.org ? ` · ${p.org}` : ''}
                  {p.matchs > 0 ? ` · ${p.matchs} matchs` : ' · aucun match'}
                  {p.titres > 0 ? ` · ${p.titres} titre${p.titres > 1 ? 's' : ''}` : ''}
                  {p.transfert ? ` · signature chez ${p.transfert}` : ''}
                </title>
              </circle>
              {/* Une année sur deux quand la carrière est longue, sinon
                  l'axe devient illisible. */}
              {(points.length <= 12 || i % 2 === 0) && (
                <text x={x(i)} y={H - 12} className="chart-axis" textAnchor="middle">
                  {String(p.annee).slice(2)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      <p className="chart-legend">
        <span className="chart-key titre" /> saison avec titre
        <span className="chart-key transfert" /> changement de structure
        {chart.tronquee && <span className="muted"> · les 30 dernières saisons</span>}
      </p>
    </div>
  );
}
