import React, { useMemo, useState } from 'react';
import { GAMES } from '../../data/games.js';
import { REGIONS } from '../../data/regions.js';
import { ORIGINS, FAMILY_PROFILES } from '../../data/origins.js';
import { DIFFICULTIES } from '../../engine/career.js';
import { RNG } from '../../engine/rng.js';
import { generatePersonName, generateNickname } from '../../engine/names.js';
import { actions } from '../store.js';

/**
 * Création de personnage (§4).
 * Chaque choix modifie réellement les statistiques de départ, la familiarité,
 * l'argent et les événements accessibles — l'aperçu affiché est calculé à
 * partir des mêmes données que le moteur.
 */
export default function CreateScreen() {
  const [seedInput, setSeedInput] = useState('');
  const [regionId, setRegionId] = useState('weu');
  const [gameId, setGameId] = useState('vanguard');
  const [originId, setOriginId] = useState('child_competitor');
  const [familyId, setFamilyId] = useState('supportive');
  const [difficulty, setDifficulty] = useState('standard');
  const [identity, setIdentity] = useState(() => rollIdentity('weu', 1));
  const [age, setAge] = useState(17);

  const origin = ORIGINS.find((o) => o.id === originId);
  const family = FAMILY_PROFILES.find((f) => f.id === familyId);
  const region = REGIONS.find((r) => r.id === regionId);
  const game = GAMES.find((g) => g.id === gameId);

  const ageBounds = origin.startAge;
  const clampedAge = Math.min(Math.max(age, ageBounds[0]), ageBounds[1]);

  const preview = useMemo(() => {
    const bias = origin.attrBias;
    return Object.entries(bias)
      .filter(([, v]) => v !== 0)
      .sort((a, b) => b[1] - a[1]);
  }, [origin]);

  function reroll(nextRegion = regionId) {
    setIdentity(rollIdentity(nextRegion, Math.floor(Math.random() * 1e9)));
  }

  function start() {
    const seed = seedInput.trim() === '' ? Date.now() : seedInput.trim();
    actions.newCareer({
      seed,
      startYear: 2030,
      difficulty,
      player: {
        firstName: identity.firstName,
        lastName: identity.lastName,
        nick: identity.nick,
        country: identity.country,
        regionId,
        gameId,
        age: clampedAge,
        baseLevel: 44,
        attrBias: origin.attrBias,
        potentialBias: origin.potentialBias,
        familiarity: origin.familiarity,
        money: origin.money,
        startFollowers: origin.startFollowers ?? 0,
        originId,
        familyId,
      },
    });
  }

  return (
    <div className="screen create">
      <h1>Nouvelle carrière</h1>
      <p className="lede">
        Ces choix ne sont pas décoratifs : ils déterminent votre niveau de départ,
        votre marge de progression, votre argent et les situations que vous
        rencontrerez.
      </p>

      <section className="card">
        <h2>Identité</h2>
        <div className="row">
          <label>
            Prénom
            <input
              value={identity.firstName}
              onChange={(e) => setIdentity({ ...identity, firstName: e.target.value })}
            />
          </label>
          <label>
            Nom
            <input
              value={identity.lastName}
              onChange={(e) => setIdentity({ ...identity, lastName: e.target.value })}
            />
          </label>
        </div>
        <div className="row">
          <label>
            Pseudo
            <input value={identity.nick} onChange={(e) => setIdentity({ ...identity, nick: e.target.value })} />
          </label>
          <label>
            Âge de départ ({ageBounds[0]}–{ageBounds[1]})
            <input
              type="number"
              min={ageBounds[0]}
              max={ageBounds[1]}
              value={clampedAge}
              onChange={(e) => setAge(Number(e.target.value))}
            />
          </label>
        </div>
        <button className="ghost" onClick={() => reroll()}>Générer une autre identité</button>
      </section>

      <section className="card">
        <h2>Région</h2>
        <div className="chips">
          {REGIONS.map((r) => (
            <button
              key={r.id}
              className={`chip ${regionId === r.id ? 'active' : ''}`}
              onClick={() => {
                setRegionId(r.id);
                reroll(r.id);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="hint">
          {region.label} — densité de talent {pct(region.talentDensity)}, structuration{' '}
          {pct(region.infrastructure)}. Une région dense est plus difficile, mais mieux
          exposée.
        </p>
      </section>

      <section className="card">
        <h2>Jeu de départ</h2>
        <div className="game-grid">
          {GAMES.map((g) => (
            <button
              key={g.id}
              className={`game-tile ${gameId === g.id ? 'active' : ''}`}
              onClick={() => setGameId(g.id)}
            >
              <strong>{g.name}</strong>
              <span className="tag">{g.teamSize > 1 ? `${g.teamSize}v${g.teamSize}` : 'Solo'}</span>
              <span className="muted">{g.description}</span>
            </button>
          ))}
        </div>
        <p className="hint">
          {game.name} valorise :{' '}
          {Object.entries(game.weights)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([k, v]) => `${groupLabel(k)} (${Math.round(v * 100)}%)`)
            .join(', ')}
          .
        </p>
      </section>

      <section className="card">
        <h2>Origine</h2>
        <div className="list">
          {ORIGINS.map((o) => (
            <button
              key={o.id}
              className={`list-item ${originId === o.id ? 'active' : ''}`}
              onClick={() => setOriginId(o.id)}
            >
              <strong>{o.label}</strong>
              <span className="muted">{o.desc}</span>
            </button>
          ))}
        </div>
        <p className="hint">
          Effets sur vos débuts :{' '}
          {preview.map(([k, v]) => `${groupLabel(k)} ${v > 0 ? '+' : ''}${v}`).join(' · ')} ·
          familiarité {Math.round(origin.familiarity * 100)}% · {origin.money} €
        </p>
      </section>

      <section className="card">
        <h2>Situation familiale</h2>
        <div className="list">
          {FAMILY_PROFILES.map((f) => (
            <button
              key={f.id}
              className={`list-item ${familyId === f.id ? 'active' : ''}`}
              onClick={() => setFamilyId(f.id)}
            >
              <strong>{f.label}</strong>
              <span className="muted">{f.desc}</span>
            </button>
          ))}
        </div>
        <p className="hint">
          Soutien {pct(family.support)} · Pression {pct(family.pressure)} · Stabilité
          financière {pct(family.stability)}
        </p>
      </section>

      <section className="card">
        <h2>Difficulté</h2>
        <div className="chips">
          {Object.values(DIFFICULTIES).map((d) => (
            <button
              key={d.id}
              className={`chip ${difficulty === d.id ? 'active' : ''}`}
              onClick={() => setDifficulty(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="hint">{DIFFICULTIES[difficulty].desc}</p>
      </section>

      <section className="card">
        <h2>Seed</h2>
        <input
          placeholder="Laisser vide pour un monde aléatoire"
          value={seedInput}
          onChange={(e) => setSeedInput(e.target.value)}
        />
        <p className="hint">
          Une même seed régénère exactement le même monde : mêmes équipes, mêmes
          joueurs, mêmes trajectoires de départ.
        </p>
      </section>

      <div className="actions sticky">
        <button className="ghost" onClick={() => actions.setScreen('home')}>
          Retour
        </button>
        <button className="primary" onClick={start}>
          Commencer la carrière
        </button>
      </div>
    </div>
  );
}

function rollIdentity(regionId, seed) {
  const rng = new RNG(seed);
  const name = generatePersonName(rng, regionId);
  return { ...name, nick: generateNickname(rng, new Set()) };
}

function pct(v) {
  return `${Math.round(v * 100)}%`;
}

const GROUP_LABELS = {
  mechanical: 'mécanique',
  gameSense: 'intelligence de jeu',
  social: 'social',
  mental: 'mental',
  professional: 'professionnalisme',
  media: 'médiatique',
};

function groupLabel(id) {
  return GROUP_LABELS[id] ?? id;
}
