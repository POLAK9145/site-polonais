/**
 * Génération de noms (personnes, pseudos, organisations).
 * Déterministe : même seed = mêmes noms.
 */

import { REGIONS_BY_ID, NICK_PREFIXES, NICK_SUFFIXES, NICK_TAGS } from '../data/regions.js';

export function generatePersonName(rng, regionId) {
  const region = REGIONS_BY_ID[regionId] ?? REGIONS_BY_ID.weu;
  return {
    firstName: rng.pick(region.firstNames),
    lastName: rng.pick(region.lastNames),
    country: rng.pick(region.countries),
  };
}

/**
 * Pseudo unique dans le monde. On tente des combinaisons jusqu'à trouver un
 * tag libre, puis on suffixe par un nombre — deux joueurs ne peuvent jamais
 * porter le même pseudo, ce qui casserait tout le récit.
 */
export function generateNickname(rng, taken = new Set()) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const nick =
      rng.pick(NICK_PREFIXES) + rng.pick(NICK_SUFFIXES) + rng.pick(NICK_TAGS);
    const key = nick.toLowerCase();
    if (nick.length >= 3 && !taken.has(key)) {
      taken.add(key);
      return nick;
    }
  }
  let n = 2;
  let base = rng.pick(NICK_PREFIXES);
  while (taken.has(`${base}${n}`.toLowerCase())) n++;
  const nick = `${base}${n}`;
  taken.add(nick.toLowerCase());
  return nick;
}

const ORG_PREFIXES = [
  'Aurora', 'Meridian', 'Vantage', 'Kestrel', 'Obsidian', 'Halcyon', 'Ronin',
  'Cascade', 'Titan', 'Pharos', 'Zenith', 'Basilisk', 'Nimbus', 'Ironwood',
  'Solaris', 'Vertex', 'Crimson', 'Northwind', 'Aegis', 'Lantern', 'Quasar',
  'Sentinel', 'Vanta', 'Ember', 'Polaris', 'Granite', 'Mirage', 'Nocturne',
];

const ORG_SUFFIXES = [
  'Esports', 'Gaming', 'Collective', 'Union', 'Athletic', 'Syndicate', 'Club',
  '', '', '', 'Academy', 'Project', 'Division',
];

export function generateOrgName(rng, taken = new Set()) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const prefix = rng.pick(ORG_PREFIXES);
    const suffix = rng.pick(ORG_SUFFIXES);
    const name = suffix ? `${prefix} ${suffix}` : prefix;
    const key = name.toLowerCase();
    if (!taken.has(key)) {
      taken.add(key);
      return name;
    }
  }
  let n = 2;
  const base = rng.pick(ORG_PREFIXES);
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  const name = `${base} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}

/** Tag court d'une organisation (3-4 lettres). */
export function orgTag(name, taken = new Set()) {
  const words = name.split(/\s+/).filter(Boolean);
  let candidate =
    words.length > 1
      ? words.map((w) => w[0]).join('').toUpperCase()
      : name.slice(0, 3).toUpperCase();
  if (candidate.length < 2) candidate = name.slice(0, 3).toUpperCase();
  let tag = candidate;
  let i = 1;
  while (taken.has(tag)) {
    tag = (candidate + i).slice(0, 4);
    i++;
  }
  taken.add(tag);
  return tag;
}
