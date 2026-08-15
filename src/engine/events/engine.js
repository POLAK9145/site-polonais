/**
 * DecisionEngine (§56).
 *
 * Pipeline strict, dans cet ordre :
 *  1. les chaînes en attente (une histoire commencée doit se poursuivre) ;
 *  2. les événements éligibles (conditions dures sur l'état du monde) ;
 *  3. les cooldowns et la saturation de thèmes (§43 anti-répétition) ;
 *  4. les poids contextuels ;
 *  5. le tirage ;
 *  6. la présentation des choix ;
 *  7. l'application des conséquences (immédiates ET différées) ;
 *  8. l'inscription dans l'historique.
 *
 * Un événement qui ne passe pas ses conditions n'est jamais « forcé ».
 * S'il n'y a rien de plausible à raconter cette semaine, il ne se passe
 * rien — c'est préférable à une situation absurde (§2).
 */

import { clamp } from '../rng.js';

const registry = new Map();
/** Handlers d'effets différés, adressés par type (sérialisables, §58). */
const deferredHandlers = new Map();

export function registerEvents(defs) {
  for (const def of defs) {
    if (registry.has(def.id)) {
      throw new Error(`Événement dupliqué : ${def.id}`);
    }
    registry.set(def.id, normalizeDef(def));
  }
}

export function registerDeferred(type, handler) {
  deferredHandlers.set(type, handler);
}

export function getEvent(id) {
  return registry.get(id);
}

export function allEvents() {
  return [...registry.values()];
}

export function clearRegistry() {
  registry.clear();
}

function normalizeDef(def) {
  return {
    cooldown: 80,
    once: false,
    tags: [],
    priority: 0,
    weight: () => 1,
    condition: () => true,
    ...def,
  };
}

/** Fenêtre de mémoire pour la saturation thématique. */
const TAG_MEMORY_WEEKS = 26;

export function createEventState() {
  return {
    cooldowns: {},
    fired: {},
    recentTags: [],
    pendingChains: [],
    scheduledEffects: [],
    lastEventWeek: -999,
  };
}

function onCooldown(state, def, week) {
  const until = state.cooldowns[def.id];
  if (until !== undefined && week < until) return true;
  if (def.once && state.fired[def.id]) return true;
  return false;
}

/**
 * Pénalité de répétition : si les six derniers mois ont été saturés de
 * « conflit d'équipe », un nouvel événement de conflit devient improbable.
 */
function tagPenalty(state, def, week) {
  if (def.tags.length === 0) return 1;
  let penalty = 1;
  for (const tag of def.tags) {
    const recent = state.recentTags.filter((t) => t.tag === tag && week - t.week <= TAG_MEMORY_WEEKS);
    if (recent.length === 0) continue;
    // Chaque occurrence récente divise le poids ; le plus récent pèse le plus.
    for (const r of recent) {
      const freshness = 1 - (week - r.week) / TAG_MEMORY_WEEKS;
      penalty *= clamp(1 - 0.55 * freshness, 0.12, 1);
    }
  }
  return penalty;
}

/** Sélectionne l'événement de la semaine, ou null. */
export function pickEvent(ctx) {
  const { state, world } = ctx;
  const week = world.week;

  // 1. Chaîne en cours : priorité absolue.
  const chained = takeReadyChain(ctx, week);
  if (chained) return chained;

  const eligible = [];
  for (const def of registry.values()) {
    if (def.chainOnly) continue;
    if (onCooldown(state, def, week)) continue;
    let ok = false;
    try {
      ok = def.condition(ctx);
    } catch (err) {
      // Une condition qui explose ne doit jamais casser une partie :
      // l'événement est simplement écarté.
      ok = false;
    }
    if (!ok) continue;
    eligible.push(def);
  }
  if (eligible.length === 0) return null;

  const chosen = ctx.rng.weighted(eligible, (def) => {
    let w = 0;
    try {
      w = def.weight(ctx) ?? 0;
    } catch {
      return 0;
    }
    return Math.max(0, w) * tagPenalty(state, def, week) * (1 + def.priority);
  });
  return chosen ?? null;
}

function takeReadyChain(ctx, week) {
  const { state } = ctx;
  for (let i = 0; i < state.pendingChains.length; i++) {
    const pending = state.pendingChains[i];
    if (pending.dueWeek > week) continue;
    if (pending.expiresWeek && week > pending.expiresWeek) {
      state.pendingChains.splice(i, 1);
      i--;
      continue;
    }
    const def = registry.get(pending.eventId);
    if (!def) {
      state.pendingChains.splice(i, 1);
      i--;
      continue;
    }

    // Une suite de chaîne reste soumise au cooldown de son propre événement :
    // sans cela, un conflit de vestiaire pouvait se rejouer à l'identique
    // quelques mois après le précédent (§43). On repousse au lieu de jouer.
    if (onCooldown(state, def, week)) {
      const availableAt = state.cooldowns[def.id] ?? week + 1;
      if (pending.expiresWeek && availableAt > pending.expiresWeek) {
        state.pendingChains.splice(i, 1);
        i--;
      } else {
        pending.dueWeek = availableAt;
      }
      continue;
    }

    ctx.chainData = pending.data ?? {};
    let ok = true;
    try {
      ok = def.condition(ctx);
    } catch {
      ok = false;
    }
    if (!ok) {
      // La suite de l'histoire n'a plus de sens : on l'abandonne
      // silencieusement plutôt que de raconter une incohérence (§61).
      state.pendingChains.splice(i, 1);
      i--;
      ctx.chainData = null;
      continue;
    }
    state.pendingChains.splice(i, 1);
    return def;
  }
  ctx.chainData = null;
  return null;
}

/**
 * Un événement peut « choisir » une cible pendant la rédaction de son texte
 * (`ctx.pickedMate`, `ctx.pickedRival`...). Ces choix doivent survivre au
 * temps qui sépare l'affichage de la réponse du joueur — y compris une
 * sauvegarde entre les deux. Sinon le texte parlerait d'une personne et la
 * conséquence s'appliquerait à une autre (§61).
 */
export function snapshotPicks(ctx) {
  const out = {};
  for (const key of Object.keys(ctx)) {
    if (!key.startsWith('picked')) continue;
    out[key] = packPick(ctx.world, ctx[key], 0);
  }
  return out;
}

export function restorePicks(ctx, snap) {
  if (!snap) return;
  for (const [key, packed] of Object.entries(snap)) {
    ctx[key] = unpackPick(ctx.world, packed, 0);
  }
}

function packPick(world, v, depth) {
  if (v == null || typeof v !== 'object' || depth > 3) return { k: 'raw', v: v ?? null };
  if (Array.isArray(v)) return { k: 'arr', v: v.map((x) => packPick(world, x, depth + 1)) };
  if (v.id) {
    if (world.persons[v.id]) return { k: 'person', id: v.id };
    if (world.teams[v.id]) return { k: 'team', id: v.id };
    if (world.orgs[v.id]) return { k: 'org', id: v.id };
  }
  const obj = {};
  for (const [key, value] of Object.entries(v)) obj[key] = packPick(world, value, depth + 1);
  return { k: 'obj', v: obj };
}

function unpackPick(world, packed, depth) {
  if (!packed || depth > 4) return null;
  switch (packed.k) {
    case 'raw':
      return packed.v;
    case 'person':
      return world.persons[packed.id] ?? null;
    case 'team':
      return world.teams[packed.id] ?? null;
    case 'org':
      return world.orgs[packed.id] ?? null;
    case 'arr':
      return packed.v.map((x) => unpackPick(world, x, depth + 1));
    case 'obj': {
      const out = {};
      for (const [key, value] of Object.entries(packed.v)) out[key] = unpackPick(world, value, depth + 1);
      return out;
    }
    default:
      return null;
  }
}

/** Prépare l'événement pour l'affichage : titre, texte, choix disponibles. */
export function presentEvent(def, ctx) {
  const choices = (def.choices ?? [])
    .filter((c) => (c.available ? safeBool(c.available, ctx) : true))
    .map((c) => ({
      id: c.id,
      label: typeof c.label === 'function' ? c.label(ctx) : c.label,
      hint: typeof c.hint === 'function' ? c.hint(ctx) : c.hint,
      risky: !!c.risky,
    }));
  // Le titre est produit AVANT le texte : c'est le texte qui fixe les
  // cibles (ctx.picked*), et le snapshot doit donc être pris après lui.
  const title = typeof def.title === 'function' ? def.title(ctx) : def.title;
  const text = typeof def.text === 'function' ? def.text(ctx) : def.text;
  return {
    id: def.id,
    tags: def.tags,
    title,
    text,
    choices,
    chainData: ctx.chainData ?? null,
    picks: snapshotPicks(ctx),
    auto: !def.choices?.length,
  };
}

function safeBool(fn, ctx) {
  try {
    return !!fn(ctx);
  } catch {
    return false;
  }
}

/**
 * Applique un choix et enregistre l'événement.
 * Retourne le texte de résolution montré au joueur.
 */
export function resolveEvent(def, choiceId, ctx) {
  const { state, world } = ctx;
  const week = world.week;

  let outcome = null;
  if (def.choices?.length) {
    const choice = def.choices.find((c) => c.id === choiceId) ?? def.choices[0];
    ctx.choiceId = choice.id;
    outcome = choice.apply ? choice.apply(ctx) : null;
  } else if (def.auto) {
    outcome = def.auto(ctx);
  }

  state.fired[def.id] = (state.fired[def.id] ?? 0) + 1;
  state.cooldowns[def.id] = week + (def.cooldown ?? 80);
  state.lastEventWeek = week;
  for (const tag of def.tags) state.recentTags.push({ tag, week });
  // On oublie les thèmes trop anciens pour garder l'état compact.
  state.recentTags = state.recentTags.filter((t) => week - t.week <= TAG_MEMORY_WEEKS * 2);

  return typeof outcome === 'string' ? outcome : outcome ?? null;
}

/** Programme la suite d'une chaîne narrative (§30). */
export function queueChain(ctx, eventId, { delay = 4, expires = 60, data = null } = {}) {
  ctx.state.pendingChains.push({
    eventId,
    dueWeek: ctx.world.week + delay,
    expiresWeek: ctx.world.week + delay + expires,
    data,
  });
}

/** Programme une conséquence différée, sérialisable (§58). */
export function scheduleEffect(ctx, type, { delay = 26, payload = null } = {}) {
  ctx.state.scheduledEffects.push({
    type,
    dueWeek: ctx.world.week + delay,
    payload,
  });
}

/**
 * Applique les effets différés arrivés à échéance.
 * Chaque handler peut refuser de s'appliquer (le contexte a changé) et peut
 * renvoyer un texte à afficher : c'est là que « votre discipline finit par
 * se remarquer » arrive six mois plus tard, sans avoir été annoncé.
 */
export function runScheduledEffects(ctx) {
  const { state, world } = ctx;
  const messages = [];
  const remaining = [];
  for (const eff of state.scheduledEffects) {
    if (eff.dueWeek > world.week) {
      remaining.push(eff);
      continue;
    }
    const handler = deferredHandlers.get(eff.type);
    if (!handler) continue;
    let msg = null;
    try {
      msg = handler(ctx, eff.payload);
    } catch {
      msg = null;
    }
    if (msg) messages.push(msg);
  }
  state.scheduledEffects = remaining;
  return messages;
}
