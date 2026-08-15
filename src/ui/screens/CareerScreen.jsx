import React, { useState } from 'react';
import { actions, useStore } from '../store.js';
import {
  headerView,
  profileView,
  teamView,
  offersView,
  goalsView,
  timelineView,
  relationsView,
  formatMoney,
} from '../../engine/view.js';
import { ACTIVITIES, SLOTS_PER_WEEK } from '../../data/training.js';
import { LIFESTYLES } from '../../engine/career.js';
import { canSeekTeam, canFoundTeam, SEEK_COOLDOWN_WEEKS } from '../../engine/simulation.js';
import Bar from '../components/Bar.jsx';
import EventModal from '../components/EventModal.jsx';
import WeekReport from '../components/WeekReport.jsx';

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
      <HeaderPanel head={head} />

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

      {state.pendingEvent && <EventModal event={state.pendingEvent} outcome={state.eventOutcome} />}
    </div>
  );
}

function HeaderPanel({ head }) {
  return (
    <header className="header">
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

      <div className="header-grid">
        <Stat label="Jeu" value={head.gameShort} sub={`patch ${head.patch}`} />
        <Stat label="Équipe" value={head.team ?? 'Sans équipe'} sub={head.teamTier ?? head.status} />
        <Stat label="Niveau" value={head.rating} sub={`méta : ${head.meta}`} />
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
    </header>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

function WeekTab({ state, head, goals, team, session }) {
  const person = session.world.persons[session.career.personId];
  const seekGate = canSeekTeam(session);
  const foundGate = canFoundTeam(session);
  const hasRealTeam = team && !team.isSelf;

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
    </div>
  );
}

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
  if (relations.length === 0) {
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
  return (
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
