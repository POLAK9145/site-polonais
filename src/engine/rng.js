/**
 * Générateur pseudo-aléatoire déterministe.
 *
 * Tout le hasard du jeu passe par ici. Conséquences :
 *  - une seed identique produit un monde identique (§42, §37 défi quotidien) ;
 *  - l'état du RNG est sérialisé dans la sauvegarde, donc recharger une partie
 *    ne permet pas de « re-tirer » un résultat (§79 anti-exploit).
 */

/** Hash string -> uint32. Sert à dériver des sous-flux nommés stables. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Normalise une seed utilisateur (texte ou nombre) en uint32. */
export function normalizeSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  return hashString(String(seed ?? Date.now()));
}

export class RNG {
  constructor(seed = 1) {
    this.state = normalizeSeed(seed) || 1;
  }

  static fromState(state) {
    const r = new RNG(1);
    r.state = state >>> 0;
    return r;
  }

  /** mulberry32 : rapide, bonne distribution, état tenant sur un uint32. */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Sous-flux nommé et reproductible (worldgen, événements, matchs...). */
  fork(label) {
    return new RNG((this.state ^ hashString(label)) >>> 0);
  }

  /** Entier dans [min, max] inclus. */
  int(min, max) {
    if (max < min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Flottant dans [min, max). */
  float(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }

  /** true avec la probabilité p (clampée). */
  chance(p) {
    return this.next() < clamp01(p);
  }

  pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Retire et retourne un élément au hasard (mute le tableau). */
  take(arr) {
    if (!arr || arr.length === 0) return undefined;
    const i = Math.floor(this.next() * arr.length);
    return arr.splice(i, 1)[0];
  }

  /**
   * Tirage pondéré. weightFn peut retourner 0 (candidat exclu).
   * Retourne undefined si tous les poids sont nuls — l'appelant doit gérer
   * ce cas plutôt que de forcer un événement inadapté (§2).
   */
  weighted(items, weightFn) {
    let total = 0;
    const weights = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const w = Math.max(0, weightFn(items[i], i) || 0);
      weights[i] = w;
      total += w;
    }
    if (total <= 0) return undefined;
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Loi normale (Box-Muller), bornée à ±3 écarts-types. */
  gauss(mean = 0, sd = 1) {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + clamp(z, -3, 3) * sd;
  }

  /** Gaussienne bornée : utile pour générer des stats crédibles. */
  gaussClamped(mean, sd, min, max) {
    return clamp(this.gauss(mean, sd), min, max);
  }

  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Tire n éléments distincts. */
  sample(arr, n) {
    return this.shuffle(arr).slice(0, Math.min(n, arr.length));
  }
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v) {
  return clamp(v, 0, 1);
}

/** Interpolation linéaire. */
export function lerp(a, b, t) {
  return a + (b - a) * clamp01(t);
}

/** Ramène une valeur d'un intervalle vers [0,1]. */
export function norm(v, min, max) {
  if (max === min) return 0;
  return clamp01((v - min) / (max - min));
}
