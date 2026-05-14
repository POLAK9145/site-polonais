// localStorage-backed progress tracking with a simple spaced-repetition system.

const KEY = 'mowpopolsku.v1';

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function writeAll(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

function defaultState() {
  return {
    srs: {},          // { cardId: { ease, interval, due, reps, lapses } }
    lessons: {},      // { lessonId: { done: true } }
    quizStats: {},    // { mode: { plays, correct, total, bestPct } }
    streak: { current: 0, longest: 0, lastDay: null },
    settings: { rate: 0.95 },
  };
}

export function getState() { return readAll(); }
export function setState(patch) {
  const state = readAll();
  const next = { ...state, ...patch };
  writeAll(next);
  return next;
}

export function resetAll() {
  writeAll(defaultState());
}

// ---- Streak (one tick per calendar day of any study activity) ----
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function diffDays(a, b) {
  const A = new Date(a + 'T00:00:00');
  const B = new Date(b + 'T00:00:00');
  return Math.round((B - A) / 86400000);
}
export function tickStreak() {
  const state = readAll();
  const today = todayKey();
  const s = state.streak || { current: 0, longest: 0, lastDay: null };
  if (s.lastDay === today) {
    writeAll(state);
    return s;
  }
  if (!s.lastDay) {
    s.current = 1;
  } else {
    const gap = diffDays(s.lastDay, today);
    s.current = gap === 1 ? s.current + 1 : 1;
  }
  s.longest = Math.max(s.longest || 0, s.current);
  s.lastDay = today;
  state.streak = s;
  writeAll(state);
  return s;
}

// ---- Lessons completed ----
export function markLessonDone(id) {
  const state = readAll();
  state.lessons[id] = { done: true, at: new Date().toISOString() };
  writeAll(state);
}
export function lessonDone(id) {
  const state = readAll();
  return !!(state.lessons[id] && state.lessons[id].done);
}

// ---- Quiz stats ----
export function recordQuizResult(mode, correct, total) {
  const state = readAll();
  const pct = total ? Math.round((correct / total) * 100) : 0;
  const prev = state.quizStats[mode] || { plays: 0, correct: 0, total: 0, bestPct: 0 };
  prev.plays += 1;
  prev.correct += correct;
  prev.total += total;
  prev.bestPct = Math.max(prev.bestPct, pct);
  state.quizStats[mode] = prev;
  writeAll(state);
}

// ---- SRS (simplified SM-2) ----
// quality: 0 = again, 1 = hard, 2 = good, 3 = easy
export function reviewCard(id, quality) {
  const state = readAll();
  const now = Date.now();
  const card = state.srs[id] || { ease: 2.5, interval: 0, due: now, reps: 0, lapses: 0 };

  if (quality === 0) {
    card.lapses += 1;
    card.reps = 0;
    card.interval = 0;
    card.ease = Math.max(1.3, card.ease - 0.2);
  } else {
    card.reps += 1;
    if (card.reps === 1) card.interval = quality === 3 ? 3 : 1;
    else if (card.reps === 2) card.interval = quality === 3 ? 6 : 3;
    else card.interval = Math.round(card.interval * card.ease);
    const easeDelta = quality === 1 ? -0.15 : quality === 2 ? 0 : 0.1;
    card.ease = Math.max(1.3, Math.min(3.0, card.ease + easeDelta));
  }
  card.due = now + card.interval * 86400000;
  state.srs[id] = card;
  writeAll(state);
  return card;
}

export function getDueCards(allCards) {
  const state = readAll();
  const now = Date.now();
  const due = [];
  const fresh = [];
  for (const c of allCards) {
    const rec = state.srs[c.id];
    if (!rec) fresh.push(c);
    else if (rec.due <= now) due.push(c);
  }
  return { due, fresh, all: allCards.length, learned: Object.keys(state.srs).length };
}

export function cardStats() {
  const state = readAll();
  const recs = Object.values(state.srs);
  const now = Date.now();
  return {
    seen: recs.length,
    mastered: recs.filter(r => r.reps >= 4 && r.interval >= 14).length,
    dueNow: recs.filter(r => r.due <= now).length,
  };
}

export function settings() { return readAll().settings; }
export function updateSettings(patch) {
  const state = readAll();
  state.settings = { ...state.settings, ...patch };
  writeAll(state);
  return state.settings;
}
