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
import { retirementView } from '../engine/view.js';
import {
  archiveCareer, listArchive, deleteArchived, compareCareers,
  careerRecord, careerRecords, recordsBattus,
} from '../engine/archive.js';

const state = {
  session: null,
  version: 0,
  screen: 'home',
  lastReports: [],
  pendingEvent: null,
  eventOutcome: null,
  eventConsequences: [],
  careerEnd: null,
  archiveError: null,
  recordsBattus: [],
  compare: null,
  replaySeed: null,
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

/**
 * Conduit le joueur à la fin de sa carrière (étape 9C).
 *
 * Le moteur a déjà tout enregistré — la raison, l'année, l'âge, le récit. Il
 * restait à l'amener sous les yeux du joueur au lieu de l'attendre derrière un
 * bouton de navigation.
 */
function finirCarriere() {
  state.careerEnd = retirementView(state.session);
  state.screen = 'legacy';
  state.pendingEvent = null;
  state.eventOutcome = null;
  state.eventConsequences = [];
  // Les records se mesurent AVANT l'archivage (étape 9L) : après, la carrière
  // se comparerait à elle-même et battrait tous ses propres records.
  const fiche = careerRecord(state.session);
  state.recordsBattus = fiche ? recordsBattus(fiche, listArchive()) : [];

  // La fiche est prise MAINTENANT, tant que le monde qui l'a produite est
  // encore là (étape 9K). Reconstituée plus tard, elle donnerait des chiffres
  // que le joueur n'a jamais vus.
  const res = archiveCareer(state.session);
  state.archiveError = res.ok ? null : res.reason;
}

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
    state.eventConsequences = [];
    state.careerEnd = null;
    state.recordsBattus = [];
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
    // La réponse de la semaine précédente ne doit pas déborder sur celle-ci.
    state.eventConsequences = [];
    const reports = [];
    for (let i = 0; i < weeks; i++) {
      if (state.session.pendingDecision) break;
      const report = advanceWeek(state.session);
      reports.push(report);
      if (report.retired) {
        // La carrière vient de se terminer sans que le joueur l'ait décidé
        // (étape 9C). L'ancienne version se contentait de sortir de la boucle :
        // l'écran restait celui d'un joueur en activité, avec sa routine et ses
        // objectifs, et la page de fin de carrière — pourtant complète — ne
        // s'ouvrait que si on pensait à la chercher.
        finirCarriere();
        break;
      }
      if (state.session.pendingDecision) {
        state.pendingEvent = state.session.pendingDecision.presented;
        break;
      }
      if (report.decision?.resolved) {
        state.pendingEvent = { ...report.decision, resolvedOnly: true };
        state.eventConsequences = report.decision.consequences ?? [];
        break;
      }
      if (report.matches.length > 0 && weeks > 1) break;
    }
    state.lastReports = reports;
    state.eventOutcome = null;
    autosave();
    notify();
  },

  /**
   * Applique le choix du joueur — et LUI RÉPOND (étape 9B).
   *
   * La version précédente refermait la fenêtre au moment du clic : le joueur
   * tranchait un dilemme et le jeu ne disait rien. Ni la phrase de résultat,
   * pourtant écrite pour chaque choix, ni ce que sa décision avait changé. Une
   * décision qui n'obtient pas de réponse n'a aucun poids.
   */
  chooseEvent(choiceId) {
    if (!state.session) return;
    const result = resolveDecision(state.session, choiceId);
    state.eventOutcome = result?.outcome ?? null;
    state.eventConsequences = result?.consequences ?? [];
    state.pendingEvent = { ...state.pendingEvent, resolved: true };
    autosave();
    notify();
  },

  dismissEvent() {
    state.pendingEvent = null;
    state.eventOutcome = null;
    state.eventConsequences = [];
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
    finirCarriere();
    autosave();
    notify();
  },

  /** Le joueur a lu la fin de sa carrière : on ne la lui repousse plus. */
  acknowledgeCareerEnd() {
    state.careerEnd = null;
    state.recordsBattus = [];
    notify();
  },

  /** Les carrières terminées, la plus récente d'abord (étape 9K). */
  archive() {
    return listArchive();
  },

  /** Les records personnels détenus (§68, étape 9L). */
  records() {
    return careerRecords();
  },

  /** Met deux carrières côte à côte. `null` referme la comparaison. */
  compareCareers(idA, idB) {
    if (!idA || !idB || idA === idB) {
      state.compare = null;
      notify();
      return null;
    }
    const fiches = listArchive();
    const a = fiches.find((f) => f.id === idA);
    const b = fiches.find((f) => f.id === idB);
    state.compare = a && b ? compareCareers(a, b) : null;
    notify();
    return state.compare;
  },

  closeComparison() {
    state.compare = null;
    notify();
  },

  /**
   * Rejouer le monde d'une carrière terminée (§39, étape 9N).
   *
   * C'est le « et si » honnête : la graine est conservée dans la fiche, donc
   * le monde renaît identique — mêmes équipes, mêmes joueurs, mêmes métas — et
   * les décisions repartent de zéro. On ne rejoue pas depuis un point de la
   * carrière : le moteur ne conserve pas ses états intermédiaires, et prétendre
   * le contraire serait mentir sur ce qui est rejoué.
   */
  replayWorld(id) {
    const fiche = listArchive().find((f) => f.id === id);
    if (!fiche) return null;
    state.replaySeed = fiche.seed;
    state.screen = 'create';
    notify();
    return fiche.seed;
  },

  clearReplaySeed() {
    state.replaySeed = null;
    notify();
  },

  deleteArchived(id) {
    deleteArchived(id);
    if (state.compare && (state.compare.a.id === id || state.compare.b.id === id)) {
      state.compare = null;
    }
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
    // Reprendre une partie n'est pas apprendre la nouvelle : on ne rejoue pas
    // l'annonce de fin de carrière à chaque chargement.
    state.careerEnd = null;
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
      state.careerEnd = null;
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
