import React, { useState } from 'react';
import { actions, useStore } from '../store.js';
import {
  headerView,
  profileView,
  teamView,
  offersView,
  goalsView,
  timelineView,
  careerChartView,
  loadView,
  routineOutlook,
  relationsView,
  rivalryView,
  formatMoney,
} from '../../engine/view.js';
import { ACTIVITIES, SLOTS_PER_WEEK } from '../../data/training.js';
import { LIFESTYLES } from '../../engine/career.js';
import { canSeekTeam, canFoundTeam, SEEK_COOLDOWN_WEEKS } from '../../engine/simulation.js';
import Bar from '../components/Bar.jsx';
import EventModal from '../components/EventModal.jsx';
import WeekReport from '../components/WeekReport.jsx';
import CareerChart from '../components/CareerChart.jsx';

/** Écran principal (§64). Volontairement dense mais hiérarchisé. */
export default function CareerScreen() {
  const state = useStore();
  const session = state.session;
  const [tab, setTab] = useState('semaine');

  const head = headerView(session);
  const prof = profileView(session);
  const team = teamView(session);
  const offers = offersView(session);
  const goals = goalsView(session);

  return (
    <div className="screen career">
      <HeaderPanel head={head} session={session} />

      {/* Ce qui sépare le niveau acquis de celui du jour (étape 9H). Le joueur
          voyait « Niveau 69 » et jouait à 59 sans que rien ne le dise. */}
      {head.ratingDuJour != null && Math.abs(head.ratingEcart) >= 1 && (
        <div className={`forme-jour ${head.ratingEcart < 0 ? 'moins' : 'plus'}`}>
          <strong>
            Vous jouez actuellement à {head.ratingDuJour}
            {' '}({head.ratingEcart > 0 ? `+${head.ratingEcart}` : head.ratingEcart})
          </strong>
          <span className="causes">
            {head.ratingCauses.map((c) => (
              <span key={c.cle} className={c.delta > 0 ? 'plus' : 'moins'}>
                {c.label} {c.delta > 0 ? `+${c.delta}` : c.delta}
              </span>
            ))}
          </span>
        </div>
      )}

      {state.notice && (
        <div className="notice" onClick={actions.clearNotice}>
          {state.notice} <span className="muted">(toucher pour fermer)</span>
        </div>
      )}

      {offers.length > 0 && <OffersPanel offers={offers} />}

      <nav className="tabs">
        {['semaine', 'profil', 'équipe', 'relations', 'carrière'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      {tab === 'semaine' && (
        <WeekTab state={state} head={head} goals={goals} team={team} session={session} />
      )}
      {tab === 'profil' && <ProfileTab prof={prof} head={head} session={session} />}
      {tab === 'équipe' && <TeamTab team={team} session={session} />}
      {tab === 'relations' && <RelationsTab session={session} />}
      {tab === 'carrière' && <TimelineTab session={session} />}

      {state.pendingEvent && (
        <EventModal
          event={state.pendingEvent}
          outcome={state.eventOutcome}
          consequences={state.eventConsequences}
        />
      )}
    </div>
  );
}

/**
 * L'en-tête, repliable (étape 10B).
 *
 * LE DÉFAUT, SIGNALÉ PAR UN JOUEUR
 * --------------------------------
 * « Sur le téléphone c'est un peu fouillis, y a beaucoup d'informations donc tu
 * dois pas mal descendre. »
 *
 * Mesuré sur un écran de 390 × 844 : l'onglet « semaine » faisait 2,5 écrans de
 * haut, et l'en-tête à lui seul en occupait un et demi. Le bouton « Semaine
 * suivante » arrivait à 722 px, au ras du bord, et le rapport de la semaine —
 * ce qui vient réellement de se passer — se trouvait sous la ligne de
 * flottaison. La boucle du jeu était donc : descendre pour cliquer, descendre
 * pour lire, remonter pour recliquer.
 *
 * CE QUI EST FAIT, ET CE QUI NE L'EST PAS
 * ---------------------------------------
 * Rien n'est supprimé — le joueur l'a demandé explicitement et il a raison :
 * ces chiffres servent. Le détail est simplement replié derrière une ligne qui
 * garde l'essentiel visible en permanence : qui vous êtes, quand, à quel niveau
 * vous jouez aujourd'hui. Un geste l'ouvre, et le choix est mémorisé.
 *
 * Replié par défaut sur écran étroit seulement : sur un grand écran, tout tient
 * sans gêner personne.
 */
const CLE_ENTETE = 'circuit:entete-ouverte';

function entetePreferee() {
  try {
    const v = localStorage.getItem(CLE_ENTETE);
    if (v === 'oui') return true;
    if (v === 'non') return false;
  } catch {
    // Stockage indisponible (navigation privée) : on retombe sur la largeur.
  }
  try {
    return window.matchMedia('(min-width: 720px)').matches;
  } catch {
    return true;
  }
}

function HeaderPanel({ head, session }) {
  const [ouvert, setOuvert] = useState(entetePreferee);

  function basculer() {
    setOuvert((v) => {
      try { localStorage.setItem(CLE_ENTETE, v ? 'non' : 'oui'); } catch { /* sans mémoire */ }
      return !v;
    });
  }

  return (
    <header className={`header ${ouvert ? '' : 'replie'}`}>
      <div className="header-main">
        <div>
          <h1>{head.nick}</h1>
          <p className="muted">
            {head.fullName} · {head.age} ans · {head.country}
          </p>
        </div>
        <div className="header-date">
          <strong>{head.date}</strong>
          <span className="muted">{head.phase}</span>
          {head.transferWindow && <span className="badge">Mercato ouvert</span>}
        </div>
      </div>

      {/* Replié, l'en-tête garde ce qu'on regarde à chaque semaine : le niveau
          du jour, l'équipe, la forme. Le reste est à un geste. */}
      {!ouvert && (
        <div className="header-resume">
          <span>
            <strong>{head.ratingDuJour ?? head.rating}</strong> de niveau aujourd’hui
          </span>
          <span className="muted">{head.team ?? 'Sans équipe'}</span>
          <span className="muted">Moral {head.morale} · Fatigue {head.fatigue}</span>
        </div>
      )}

      <button className="entete-bascule" onClick={basculer} aria-expanded={ouvert}>
        {ouvert ? 'Masquer le détail' : 'Voir le détail'}
      </button>

      {ouvert && (
      <>
      <div className="header-grid">
        <Stat label="Jeu" value={head.gameShort} sub={`patch ${head.patch}`} />
        <Stat label="Équipe" value={head.team ?? 'Sans équipe'} sub={head.teamTier ?? head.status} />
        <Stat
          label="Niveau"
          value={head.rating}
          sub={
            head.ratingDuJour != null && Math.abs(head.ratingEcart) >= 1
              ? `aujourd’hui ${head.ratingDuJour}`
              : `méta : ${head.meta}`
          }
          ton={head.ratingEcart <= -1 ? 'bad' : head.ratingEcart >= 1 ? 'good' : ''}
        />
        <Stat
          label="Forme"
          value={head.form > 0 ? `+${head.form}` : head.form}
          sub={head.form > 4 ? 'en confiance' : head.form < -4 ? 'en difficulté' : 'stable'}
        />
        <Stat label="Argent" value={head.moneyLabel} sub={head.salary ? `${formatMoney(head.salary)}/an` : 'aucun salaire'} />
        <Stat label="Audience" value={head.followersLabel} sub="abonnés" />
      </div>

      <div className="gauges">
        <Bar label="Moral" value={head.morale} />
        <Bar label="Fatigue" value={head.fatigue} invert />
        <Bar label="Stress" value={head.stress} invert />
      </div>

      <ChargeBloc session={session} />
      </>
      )}
    </header>
  );
}

/**
 * La charge accumulée (étape 8A).
 *
 * Elle décidait de la progression, du moral et de la fin de carrière sans
 * jamais s'afficher. Ce bloc dit trois choses, et rien d'autre : où vous en
 * êtes, où votre rythme actuel vous emmène, et ce qui pèse.
 */
function ChargeBloc({ session }) {
  const charge = loadView(session);
  const [ouvert, setOuvert] = useState(false);
  if (!charge) return null;

  const fleche = charge.tendance === 'monte' ? '▲' : charge.tendance === 'descend' ? '▼' : '—';

  return (
    <div className={`charge ${charge.eleve ? 'charge-haute' : ''}`}>
      <div className="charge-tete">
        <span className="charge-label">Charge</span>
        <strong className="charge-etat">{charge.label}</strong>
        <span className="charge-tendance" title={`la charge ${charge.tendance}`}>{fleche}</span>
        <span className="muted charge-valeur">{charge.valeur}</span>
      </div>

      <div className="bar-track charge-track">
        <div
          className={`bar-fill ${charge.valeur > 63 ? 'bad' : charge.valeur > 46 ? 'warn' : 'good'}`}
          style={{ width: `${charge.valeur}%` }}
        />
        {/* Repère : là où le rythme actuel vous stabilise, si rien ne change. */}
        <div className="charge-cible" style={{ left: `${charge.cible}%` }} title={`à ce rythme : ${charge.cible} — ${charge.labelCible}`} />
      </div>

      <p className={`charge-conseil ${charge.tenable ? '' : 'alerte'}`}>{charge.conseil}</p>

      {charge.risqueRupture > 0 && (
        <p className="charge-risque">
          Risque de rupture : {charge.risqueRupture} % par semaine
          {charge.serieChargee > 0 && ` · ${charge.serieChargee} semaines chargées d’affilée`}
        </p>
      )}

      <button className="lien" onClick={() => setOuvert((v) => !v)}>
        {ouvert ? 'Masquer le détail' : 'Qu’est-ce qui pèse ?'}
      </button>

      {ouvert && (
        <div className="charge-detail">
          <ul>
            {charge.facteurs.map((f) => (
              <li key={f.key}>
                <span>{f.label}</span>
                {f.delta ? <strong>{f.delta > 0 ? `+${f.delta}` : f.delta}</strong> : null}
              </li>
            ))}
          </ul>
          <p className="muted">
            À ce rythme, votre charge se stabilise vers {charge.cible} ({charge.labelCible}).
            {charge.episodes > 0 && ` Vous avez déjà craqué ${charge.episodes} fois.`}
            {charge.pic > charge.valeur && ` Maximum atteint : ${charge.pic}.`}
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, ton = '' }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className={`stat-sub ${ton}`}>{sub}</span>}
    </div>
  );
}

function WeekTab({ state, head, goals, team, session }) {
  const person = session.world.persons[session.career.personId];
  const seekGate = canSeekTeam(session);
  const foundGate = canFoundTeam(session);
  const hasRealTeam = team && !team.isSelf;

  // Une carrière terminée ne se poursuit pas (étape 9C). L'écran continuait
  // d'afficher « Semaine suivante », une routine hebdomadaire et des objectifs
  // à un joueur retraité — vérifié en jouant, et impossible à défendre : le
  // moteur refusait déjà d'avancer, l'interface faisait semblant du contraire.
  if (session.career.retired) {
    return (
      <>
        <section className="card">
          <h2>Carrière terminée</h2>
          <p className="muted">
            Vous ne jouez plus. Ce qui a été fait est fait, et c’est sur la page
            de fin de carrière que ça se lit.
          </p>
          <button className="primary" onClick={() => actions.setScreen('legacy')}>
            Ouvrir la fin de carrière
          </button>
        </section>
        <WeekReport reports={state.lastReports} />
        <section className="card">
          <h2>Le monde continue</h2>
          <p className="muted">
            Les compétitions se jouent toujours, sans vous. L’onglet Monde les
            suit.
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <section className="card">
        <div className="advance-row">
          <button className="primary big" onClick={() => actions.advance(1)}>
            Semaine suivante
          </button>
          <button className="secondary big" onClick={() => actions.advance(12)}>
            Avancer jusqu’au prochain moment
          </button>
        </div>
        <p className="hint">
          L’avance rapide s’arrête dès qu’un match vous concerne ou qu’une décision
          vous attend.
        </p>
      </section>

      {!hasRealTeam && (
        <section className="card">
          <h2>Vous êtes sans équipe</h2>
          <p className="muted">
            Personne ne viendra vous chercher tout seul. Démarchez les structures de
            votre scène, ou montez votre propre roster.
          </p>
          <div className="actions">
            <button className="secondary" disabled={!seekGate.ok} onClick={() => actions.seekTeam()}>
              {seekGate.ok
                ? 'Démarcher des équipes'
                : `Démarcher (${seekGate.remaining ?? SEEK_COOLDOWN_WEEKS} sem.)`}
            </button>
            <button className="secondary" disabled={!foundGate.ok} onClick={() => actions.foundTeam()}>
              Monter votre équipe
            </button>
          </div>
          {!foundGate.ok && <p className="hint">Monter une équipe : {foundGate.reason}</p>}
        </section>
      )}

      <WeekReport reports={state.lastReports} />

      <section className="card">
        <h2>Routine hebdomadaire</h2>
        <RoutineEditor session={session} />
      </section>

      <section className="card">
        <h2>Objectifs</h2>
        <ul className="goals">
          {goals.map((g, i) => (
            <li key={i} className={g.done ? 'done' : ''}>
              <span>{g.label}</span>
              {g.hint && <span className="muted"> — {g.hint}</span>}
            </li>
          ))}
          {goals.length === 0 && <li className="muted">Plus rien à prouver pour l’instant.</li>}
        </ul>
      </section>

      <section className="card">
        <h2>Train de vie</h2>
        <div className="chips">
          {Object.values(LIFESTYLES).map((l) => (
            <button
              key={l.id}
              className={`chip ${session.career.lifestyle === l.id ? 'active' : ''}`}
              onClick={() => actions.setLifestyle(l.id)}
            >
              {l.label} · {formatMoney(l.cost)}/mois
            </button>
          ))}
        </div>
      </section>

      {!session.career.retired && person.stats.matches > 20 && (
        <section className="card danger-zone">
          <h2>Fin de carrière</h2>
          <p className="muted">
            Vous pouvez arrêter quand vous voulez. Le bilan sera construit à partir de
            ce qui s’est réellement passé.
          </p>
          <button className="ghost danger" onClick={() => actions.retire()}>
            Mettre un terme à votre carrière
          </button>
        </section>
      )}
    </>
  );
}

function RoutineEditor({ session }) {
  const routine = session.career.routine;
  const person = session.world.persons[session.career.personId];
  const hasTeam = !!person.teamId;

  function setSlot(index, activityId) {
    const next = [...routine];
    next[index] = activityId;
    actions.setRoutine(next);
  }

  return (
    <div className="routine">
      {Array.from({ length: SLOTS_PER_WEEK }).map((_, i) => (
        <div key={i} className="slot">
          <span className="slot-label">Créneau {i + 1}</span>
          <select value={routine[i] ?? 'rest'} onChange={(e) => setSlot(i, e.target.value)}>
            {ACTIVITIES.map((a) => (
              <option key={a.id} value={a.id} disabled={a.requiresTeam && !hasTeam}>
                {a.icon} {a.label}
                {a.requiresTeam && !hasTeam ? ' (équipe requise)' : ''}
              </option>
            ))}
          </select>
          <span className="muted small">
            {ACTIVITIES.find((a) => a.id === (routine[i] ?? 'rest'))?.desc}
          </span>
        </div>
      ))}
      <RoutineCout session={session} routine={routine} />
    </div>
  );
}

/**
 * Ce que la routine choisie coûte, annoncé AVANT de la subir (étape 8A).
 *
 * C'est ici que se prend la décision — quatre créneaux par semaine — et c'est
 * ici que le joueur n'avait aucune information. Un joueur qui se détruit doit
 * pouvoir le lire sur l'écran où il choisit, pas le découvrir cinq ans plus
 * tard dans son bilan de carrière.
 */
function RoutineCout({ session, routine }) {
  const projection = routineOutlook(session, routine);
  if (!projection) return null;
  const ton = projection.dangereux ? 'alerte' : projection.tenable ? '' : 'attention';
  return (
    <div className={`routine-cout ${ton}`}>
      <strong>
        À ce rythme : {projection.cible} · {projection.labelCible}
      </strong>
      <span className="muted small">
        {projection.ecart > 3
          ? `soit ${projection.ecart} points de charge de plus qu’aujourd’hui`
          : projection.ecart < -3
            ? `soit ${-projection.ecart} points de moins qu’aujourd’hui`
            : 'à peu près là où vous en êtes'}
        {' · '}à contexte égal (matchs et pression inchangés)
        {projection.creneauxIgnores > 0 &&
          ` · ${projection.creneauxIgnores} créneau(x) sans effet faute d’équipe`}
      </span>
    </div>
  );
}

/**
 * Le fil rouge d'une carrière (étape 8E).
 *
 * Le moteur suit la rivalité en détail et archive celles qui se sont éteintes ;
 * le bilan final en fait un paragraphe. Mais pendant la carrière, rien ne
 * l'affichait : le rival n'était qu'une bordure de couleur dans une liste.
 */
function RivaliteBloc({ rivalite }) {
  if (!rivalite) return null;
  const { enCours, passees, finieMaisRecente } = rivalite;

  const bilan = (c, v) => {
    if (!c) return 'jamais affronté';
    const d = c - v;
    return `${c} confrontation${c > 1 ? 's' : ''} · ${v} victoire${v > 1 ? 's' : ''}, ${d} défaite${d > 1 ? 's' : ''}`;
  };

  return (
    <section className="card rivalite">
      <div className="section-tete">
        <h2>Rivalités</h2>
        <span className="muted small">
          {rivalite.total} depuis le début de votre carrière
        </span>
      </div>

      {enCours ? (
        <div className="rivalite-active">
          <div className="rivalite-tete">
            <strong>{enCours.nick}</strong>
            <span className="chip static">{enCours.label}</span>
          </div>
          <p className="muted small">
            Depuis {enCours.depuis}
            {enCours.annees >= 1 && ` · ${enCours.annees} ans`}
            {enCours.equipe ? ` · ${enCours.equipe}` : ' · sans équipe'}
            {' · niveau '}{enCours.niveau}
            {/* L'égalité parfaite est le fait le PLUS parlant d'une rivalité —
                `rivalCandidate` choisit quelqu'un de votre niveau — et une
                première version la passait sous silence en ne testant que
                l'écart non nul. */}
            <strong className={enCours.ecart > 0 ? 'devant' : enCours.ecart < 0 ? 'derriere' : 'egalite'}>
              {enCours.ecart > 0
                ? ` — il a ${enCours.ecart} point${enCours.ecart > 1 ? 's' : ''} d’avance sur vous`
                : enCours.ecart < 0
                  ? ` — vous avez ${-enCours.ecart} point${-enCours.ecart > 1 ? 's' : ''} d’avance sur lui`
                  : ' — exactement votre niveau'}
            </strong>
          </p>
          <p className="small">{bilan(enCours.confrontations, enCours.victoires)}</p>
        </div>
      ) : (
        <p className="muted small">
          {finieMaisRecente
            ? `Plus de rivalité en cours — ${finieMaisRecente.nick} : ${finieMaisRecente.raison}.`
            : 'Plus de rivalité en cours.'}
        </p>
      )}

      {passees.length > 0 && (
        <ul className="rivalite-passees">
          {passees.map((r, i) => (
            <li key={i}>
              <strong>{r.nick}</strong>
              <span className="muted">
                {' '}· {r.annee}
                {r.duree ? ` · ${r.duree} ans` : ''} · {RAISONS[r.raison] ?? r.raison}
              </span>
              <span className="muted small"> — {bilan(r.confrontations, r.victoires)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Comment une rivalité s'éteint, dite avec des mots plutôt qu'un code. */
const RAISONS = {
  'retraité': 'il a raccroché',
  'autre scène': 'il est parti jouer à autre chose',
  'réconciliée': 'la tension est retombée',
  'disparu': 'on a perdu sa trace',
};

function ProfileTab({ prof, head, session }) {
  return (
    <>
      <section className="card">
        <h2>Potentiel estimé</h2>
        <p className="stars">{prof.potentialStars}</p>
        <p className="hint">
          Estimation basée sur {prof.potentialConfidence}% d’observations. Elle se
          précisera à mesure que vous jouerez — le chiffre réel ne vous sera jamais
          montré.
        </p>
        <p className="muted">
          Familiarité avec {head.gameShort} : {prof.familiarity}%
          {prof.metaShock > 0 && ` · Adaptation au dernier patch en cours (−${prof.metaShock})`}
          {prof.role && ` · Rôle : ${prof.role}`}
        </p>
      </section>

      <section className="card">
        <h2>Caractéristiques</h2>
        {prof.groups.map((g) => (
          <div key={g.id} className="attr-group">
            <div className="attr-group-head">
              <strong>{g.label}</strong>
              <span className="muted">{g.value}</span>
              <span className="weight">{g.weightInGame}% du niveau sur ce jeu</span>
            </div>
            <div className="attr-list">
              {g.attrs.map((a) => (
                <div key={a.id} className={`attr ${a.key ? 'key' : ''}`}>
                  <span>{a.label}</span>
                  <span className="attr-value">{a.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Traits</h2>
        <div className="list">
          {prof.traits.map((t) => (
            <div key={t.id} className="list-item static">
              <strong>{t.label}</strong>
              <span className="muted">{t.desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Réputation</h2>
        {prof.reputationBars.map((r) => (
          <Bar key={r.label} label={r.label} value={r.value} invert={r.negative} />
        ))}
      </section>
    </>
  );
}

function TeamTab({ team, session }) {
  if (!team) {
    return (
      <section className="card">
        <h2>Aucune équipe</h2>
        <p className="muted">Vous n’appartenez à aucune structure pour le moment.</p>
      </section>
    );
  }
  return (
    <>
      <section className="card">
        <h2>
          {team.orgName} {team.foundedByPlayer && <span className="badge">votre structure</span>}
        </h2>
        <p className="muted">
          {team.tierLabel} · {team.philosophy} · {team.division}
          {team.coach && ` · Coach : ${team.coach}`}
        </p>
        <div className="header-grid">
          <Stat label="Force" value={team.strength} />
          <Stat label="Cohésion" value={team.synergy} sub={team.synergyLabel} />
          <Stat label="Saison" value={`${team.season.wins}V — ${team.season.losses}D`} />
          <Stat label="Titres" value={team.titles} />
        </div>
        {team.benched && <p className="warning">Vous êtes actuellement remplaçant.</p>}
      </section>

      <section className="card">
        <h2>Effectif</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Joueur</th>
              <th>Rôle</th>
              <th>Âge</th>
              <th>Niv.</th>
              <th>Relation</th>
            </tr>
          </thead>
          <tbody>
            {team.roster.map((p) => (
              <tr key={p.id} className={p.isPlayer ? 'me' : ''}>
                <td>{p.nick}</td>
                <td className="muted">{p.role}</td>
                <td>{p.age}</td>
                <td>{p.rating}</td>
                <td className="muted">{p.isPlayer ? '—' : p.relation.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {team.competitions.map((c) => (
        <section key={c.id} className="card">
          <h2>{c.name}</h2>
          {c.standings ? (
            <table className="table">
              <tbody>
                {c.standings.map((s) => (
                  <tr key={s.rank} className={s.isMine ? 'me' : ''}>
                    <td>{s.rank}</td>
                    <td>{s.team}</td>
                    <td>
                      {s.wins}—{s.losses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Tournoi à élimination directe en cours.</p>
          )}
        </section>
      ))}
    </>
  );
}

function RelationsTab({ session }) {
  const relations = relationsView(session);
  const rivalite = rivalryView(session);
  if (relations.length === 0 && !rivalite) {
    return (
      <section className="card">
        <h2>Aucune relation marquante</h2>
        <p className="muted">
          Les relations se construisent en jouant, en gagnant, et en se disputant.
        </p>
      </section>
    );
  }
  return (
    <>
      <RivaliteBloc rivalite={rivalite} />
      {relations.map((r) => (
        <section key={r.id} className={`card relation ${r.isRival ? 'rival' : ''}`}>
          <div className="relation-head">
            <div>
              <strong>{r.nick}</strong>
              <span className="muted"> — {r.label}</span>
            </div>
            <span className="muted small">
              {r.age} ans · {r.team ?? 'sans équipe'} · {r.game}
            </span>
          </div>
          {r.tags.length > 0 && (
            <div className="chips small">
              {r.tags.map((t) => (
                <span key={t} className="chip static">
                  {t}
                </span>
              ))}
            </div>
          )}
          <ul className="history">
            {r.history.map((h, i) => (
              <li key={i} className={h.important ? 'important' : ''}>
                <span className="muted">{h.date}</span> {h.text}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function TimelineTab({ session }) {
  const timeline = timelineView(session);
  const courbe = careerChartView(session);
  return (
    <>
    {/* La courbe pendant qu'on la vit, pas seulement à la retraite : c'est en
        cours de carrière qu'elle sert à décider (étape 9G). */}
    {courbe && (
      <section className="card">
        <h2>Votre progression</h2>
        <CareerChart chart={courbe} />
        <p className="muted">
          Meilleure saison : {courbe.pic.annee} à {courbe.pic.niveau} de niveau
          {courbe.titresTotal > 0 && ` · ${courbe.titresTotal} titre${courbe.titresTotal > 1 ? 's' : ''}`}
        </p>
      </section>
    )}
    <section className="card">
      <h2>Votre histoire</h2>
      {timeline.length === 0 && <p className="muted">Rien de notable pour l’instant.</p>}
      {timeline.map((year) => (
        <div key={year.year} className="timeline-year">
          <h3>{year.year}</h3>
          <ul className="timeline">
            {year.entries.map((e, i) => (
              <li key={i} className={`${e.kind} ${e.important ? 'important' : ''}`}>
                {e.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
    </>
  );
}

function OffersPanel({ offers }) {
  return (
    <section className="card offers">
      <h2>Propositions ({offers.length})</h2>
      <p className="hint">
        Vous ne connaissez pas tout. Les indications ci-dessous sont ce qu’un joueur
        pourrait raisonnablement savoir avant de signer.
      </p>
      {offers.map((o) => (
        <div key={o.index} className="offer">
          <div className="offer-head">
            <strong>{o.orgName}</strong>
            <span className="badge">{o.roleLabel}</span>
          </div>
          <ul className="offer-details">
            <li>{o.salaryLabel} · {o.years} an(s)</li>
            <li>{o.levelHint}</li>
            <li>{o.synergyHint}</li>
            <li>Philosophie : {o.philosophy}</li>
            <li>Objectif : {o.objective} · {o.pressureLabel}</li>
          </ul>
          <details>
            <summary>Pourquoi vous ?</summary>
            <ul className="factors">
              {o.factors.map((f, i) => (
                <li key={i} className={f.delta >= 0 ? 'pos' : 'neg'}>
                  {f.label} <span>{f.delta > 0 ? `+${f.delta}` : f.delta}</span>
                </li>
              ))}
            </ul>
          </details>
          <button className="primary" onClick={() => actions.acceptOffer(o.index)}>
            Signer avec {o.orgName}
          </button>
        </div>
      ))}
      <button className="ghost" onClick={() => actions.declineOffers()}>
        Tout décliner
      </button>
    </section>
  );
}
