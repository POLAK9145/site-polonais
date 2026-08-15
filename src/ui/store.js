/**
 * Store minimal (§53 : le moteur ne connaît pas React).
 *
 * Le moteur est mutable et volumineux ; on ne le copie donc pas à chaque
 * rendu. On expose un simple compteur de version que React observe via
 * useSyncExternalStore, et toutes les mutations passent par des actions.
 */

import { useSyncExternalStore } from 'react';
import {
  createSession,
  advanceWeek,
  resolveDecision,
  acceptOffer,
  declineOffers,
  setRoutine,
  setLifestyle,
  seekTeam,
  canSeekTeam,
  foundTeam,
  canFoundTeam,
  retireCareer,
} from '../engine/simulation.js';
import { saveSession, loadSession, listSaves, deleteSave, exportSave, importSave } from '../engine/save.js';

const state = {
  session: null,
  version: 0,
  screen: 'home',
  lastReports: [],
  pendingEvent: null,
  eventOutcome: null,
  notice: null,
  autosaveError: null,
};

const listeners = new Set();

function notify() {
  state.version++;
  for (const l of listeners) l();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore() {
  useSyncExternalStore(subscribe, () => state.version, () => state.version);
  return state;
}

export function getState() {
  return state;
}

const AUTOSAVE_SLOT = 'auto';

function autosave() {
  if (!state.session) return;
  const res = saveSession(state.session, AUTOSAVE_SLOT);
  state.autosaveError = res.ok ? null : res.reason;
}

export const actions = {
  newCareer(config) {
    state.session = createSession(config);
    state.screen = 'career';
    state.lastReports = [];
    state.pendingEvent = null;
    state.eventOutcome = null;
    state.notice = null;
    autosave();
    notify();
  },

  /**
   * Avance d'une ou plusieurs semaines.
   * S'arrête dès qu'une décision est requise ou qu'un match du joueur a eu
   * lieu : le joueur ne doit jamais « rater » un moment important.
   */
  advance(weeks = 1) {
    if (!state.session || state.session.career.retired) return;
    const reports = [];
    for (let i = 0; i < weeks; i++) {
      if (state.session.pendingDecision) break;
      const report = advanceWeek(state.session);
      reports.push(report);
      if (report.retired) break;
      if (state.session.pendingDecision) {
        state.pendingEvent = state.session.pendingDecision.presented;
        break;
      }
      if (report.decision?.resolved) {
        state.pendingEvent = { ...report.decision, resolvedOnly: true };
        break;
      }
      if (report.matches.length > 0 && weeks > 1) break;
    }
    state.lastReports = reports;
    state.eventOutcome = null;
    autosave();
    notify();
  },

  chooseEvent(choiceId) {
    if (!state.session) return;
    const result = resolveDecision(state.session, choiceId);
    state.eventOutcome = result?.outcome ?? null;
    state.pendingEvent = null;
    autosave();
    notify();
  },

  dismissEvent() {
    state.pendingEvent = null;
    state.eventOutcome = null;
    notify();
  },

  acceptOffer(index) {
    const res = acceptOffer(state.session, index);
    state.notice = res.ok ? `Vous avez signé chez ${res.org.name}.` : res.reason;
    autosave();
    notify();
    return res;
  },

  declineOffers() {
    declineOffers(state.session);
    state.notice = 'Vous avez décliné les propositions.';
    autosave();
    notify();
  },

  setRoutine(routine) {
    setRoutine(state.session, routine);
    autosave();
    notify();
  },

  setLifestyle(id) {
    setLifestyle(state.session, id);
    autosave();
    notify();
  },

  seekTeam() {
    const gate = canSeekTeam(state.session);
    if (!gate.ok) {
      state.notice = gate.reason;
      notify();
      return gate;
    }
    const res = seekTeam(state.session);
    if (res.offers?.length > 0) {
      state.notice = `${res.offers.length} structure(s) répondent favorablement.`;
    } else if (res.refusal) {
      state.notice = `Personne ne donne suite. Le plus proche était ${res.refusal.orgName} — frein principal : ${res.refusal.mainReason.toLowerCase()}.`;
    } else {
      state.notice = 'Aucune structure de votre scène ne cherche quelqu’un actuellement.';
    }
    autosave();
    notify();
    return res;
  },

  foundTeam(name) {
    const gate = canFoundTeam(state.session);
    if (!gate.ok) {
      state.notice = gate.reason;
      notify();
      return gate;
    }
    const res = foundTeam(state.session, name || null);
    state.notice = res.ok
      ? `${res.org.name} est née. ${res.recruits.length} joueur(s) vous rejoignent.`
      : res.reason;
    autosave();
    notify();
    return res;
  },

  retire() {
    retireCareer(state.session, 'décision personnelle');
    state.screen = 'legacy';
    autosave();
    notify();
  },

  setScreen(screen) {
    state.screen = screen;
    notify();
  },

  clearNotice() {
    state.notice = null;
    notify();
  },

  loadAutosave() {
    const session = loadSession(AUTOSAVE_SLOT);
    if (!session) return false;
    state.session = session;
    state.pendingEvent = session.pendingDecision?.presented ?? null;
    state.screen = session.career.retired ? 'legacy' : 'career';
    state.lastReports = [];
    notify();
    return true;
  },

  hasSave() {
    return listSaves().some((s) => s.slotId === AUTOSAVE_SLOT);
  },

  saveInfo() {
    return listSaves().find((s) => s.slotId === AUTOSAVE_SLOT) ?? null;
  },

  deleteSave() {
    deleteSave(AUTOSAVE_SLOT);
    notify();
  },

  exportSave() {
    return state.session ? exportSave(state.session) : null;
  },

  importSave(json) {
    try {
      state.session = importSave(json);
      state.screen = state.session.career.retired ? 'legacy' : 'career';
      state.pendingEvent = state.session.pendingDecision?.presented ?? null;
      autosave();
      notify();
      return { ok: true };
    } catch (err) {
      state.notice = 'Fichier de sauvegarde illisible.';
      notify();
      return { ok: false, reason: String(err) };
    }
  },

  quitToHome() {
    state.screen = 'home';
    notify();
  },
};
