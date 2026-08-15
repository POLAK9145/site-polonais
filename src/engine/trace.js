/**
 * Traçage de causalité (§35) et mode debug de simulation (§36).
 *
 * Objectif : pouvoir répondre à « pourquoi cela est-il arrivé ? » sans
 * deviner. Le moteur enregistre, pour les décisions importantes, la liste des
 * facteurs qui les ont produites — recrutement accepté, recrutement refusé,
 * événement déclenché, événement écarté.
 *
 * Contrainte de conception : **coût nul quand le traçage est désactivé.**
 * Chaque point de trace commence par un test booléen, et rien n'est alloué
 * si le traçage est éteint. C'est indispensable : ces chemins sont appelés
 * des centaines de milliers de fois par carrière.
 */

let enabled = false;
let sink = null;
let limit = 20000;
let count = 0;

/** Catégories de traces, pour filtrer à la lecture. */
export const TRACE = {
  RECRUIT: 'recruit',
  RECRUIT_REFUSED: 'recruit_refused',
  EVENT_FIRED: 'event_fired',
  EVENT_SKIPPED: 'event_skipped',
  MATCH: 'match',
  RETIREMENT: 'retirement',
  ORG: 'org',
  HIERARCHY: 'hierarchy',
  CONTRACT: 'contract',
  NPC_CAREER: 'npc_career',
  META: 'meta',
  DEFERRED: 'deferred',
};

export function isTracing() {
  return enabled;
}

/**
 * Active le traçage. `onRecord` reçoit chaque entrée ; si absent, les entrées
 * sont accumulées en mémoire et récupérables via `takeTrace()`.
 */
export function startTrace({ onRecord = null, max = 20000 } = {}) {
  enabled = true;
  sink = onRecord;
  limit = max;
  count = 0;
  buffer.length = 0;
}

export function stopTrace() {
  enabled = false;
  sink = null;
}

const buffer = [];

/**
 * Enregistre une entrée. Les appelants doivent tester `isTracing()` avant de
 * construire un objet coûteux — c'est le contrat qui garantit le coût nul.
 */
export function trace(kind, week, data) {
  if (!enabled) return;
  if (count >= limit) return;
  count++;
  const entry = { kind, week, ...data };
  if (sink) sink(entry);
  else buffer.push(entry);
}

export function takeTrace() {
  const out = buffer.slice();
  buffer.length = 0;
  return out;
}

export function traceCount() {
  return count;
}

/**
 * Formate une trace de recrutement en explication lisible.
 * Sert au mode debug et aux rapports d'audit.
 */
export function explainRecruit(entry) {
  const lines = [];
  lines.push(
    `S${entry.week} — ${entry.orgName} ${entry.accepted ? 'recrute' : 'renonce à'} ${entry.nick}` +
      ` (score d'intérêt ${Math.round(entry.score)})`,
  );
  for (const f of entry.factors ?? []) {
    const sign = f.delta >= 0 ? '+' : '';
    lines.push(`    ${f.label} : ${sign}${Math.round(f.delta)}`);
  }
  if (entry.refusalReason) lines.push(`    refus du joueur : ${entry.refusalReason}`);
  return lines.join('\n');
}

export function explainEvent(entry) {
  if (entry.kind === TRACE.EVENT_SKIPPED) {
    return `S${entry.week} — ${entry.eventId} écarté (${entry.reason})`;
  }
  return `S${entry.week} — ${entry.eventId} déclenché (poids ${entry.weight?.toFixed?.(2) ?? '?'}` +
    `, ${entry.eligible} candidats éligibles)`;
}
