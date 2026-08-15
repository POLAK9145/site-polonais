import React from 'react';
import { actions, useStore } from './store.js';
import HomeScreen from './screens/HomeScreen.jsx';
import CreateScreen from './screens/CreateScreen.jsx';
import CareerScreen from './screens/CareerScreen.jsx';
import WorldScreen from './screens/WorldScreen.jsx';
import StatsScreen from './screens/StatsScreen.jsx';
import LegacyScreen from './screens/LegacyScreen.jsx';

const IN_GAME = ['career', 'world', 'stats', 'legacy'];

export default function App() {
  const state = useStore();
  const hasSession = !!state.session;
  const screen = hasSession ? state.screen : state.screen === 'create' ? 'create' : 'home';

  return (
    <div className="app">
      <main>
        {screen === 'home' && <HomeScreen />}
        {screen === 'create' && <CreateScreen />}
        {screen === 'career' && hasSession && <CareerScreen />}
        {screen === 'world' && hasSession && <WorldScreen />}
        {screen === 'stats' && hasSession && <StatsScreen />}
        {screen === 'legacy' && hasSession && <LegacyScreen />}
      </main>

      {hasSession && IN_GAME.includes(screen) && (
        <nav className="bottom-nav">
          <NavButton id="career" label="Carrière" icon="🎮" screen={screen} />
          <NavButton id="world" label="Monde" icon="🌍" screen={screen} />
          <NavButton id="stats" label="Stats" icon="📊" screen={screen} />
          <NavButton
            id="legacy"
            label={state.session.career.retired ? 'Legacy' : 'Bilan'}
            icon="🏆"
            screen={screen}
          />
          <button onClick={() => actions.quitToHome()}>
            <span className="nav-icon">⏏️</span>
            <span>Menu</span>
          </button>
        </nav>
      )}

      {state.autosaveError && (
        <div className="save-warning">Sauvegarde impossible : {state.autosaveError}</div>
      )}
    </div>
  );
}

function NavButton({ id, label, icon, screen }) {
  return (
    <button className={screen === id ? 'active' : ''} onClick={() => actions.setScreen(id)}>
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
