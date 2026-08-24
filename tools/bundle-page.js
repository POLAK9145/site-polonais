#!/usr/bin/env node
/**
 * Emballe le jeu compilé dans une page HTML autonome.
 *
 *   npm run build && node tools/bundle-page.js --out=/tmp/circuit.html
 *
 * POURQUOI
 * --------
 * Le jeu tourne en local avec un serveur de développement, ce qui suppose
 * d'installer Node et de lancer une commande. Cette page-là s'ouvre d'un clic :
 * tout y est — la feuille de style, le moteur, l'interface. Les sauvegardes
 * passent par le `localStorage` du navigateur et fonctionnent donc aussi.
 *
 * On n'écrit ni `<html>`, ni `<head>`, ni `<body>` : l'hôte fournit ce
 * squelette. Le jeu peint lui-même son fond, il tient donc sur n'importe lequel.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const opts = {};
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([a-zA-Z]+)(?:=(.*))?$/);
  if (m) opts[m[1]] = m[2] === undefined ? true : m[2];
}

const dist = opts.dist ?? 'dist/assets';
const fichiers = readdirSync(dist);
const css = fichiers.find((f) => f.endsWith('.css'));
const js = fichiers.find((f) => f.endsWith('.js'));
if (!css || !js) {
  console.error(`Rien à emballer dans ${dist} — lancer « npm run build » d'abord.`);
  process.exit(1);
}

const style = readFileSync(join(dist, css), 'utf8');
const script = readFileSync(join(dist, js), 'utf8');

// Une balise fermante dans une chaîne du bundle terminerait le script trop tôt.
// Aucune n'existe aujourd'hui ; on refuse plutôt que de produire une page
// silencieusement cassée si cela changeait.
for (const [nom, contenu, balise] of [['CSS', style, '</style'], ['JS', script, '</script']]) {
  if (contenu.includes(balise)) {
    console.error(`Le ${nom} contient « ${balise} » : l'inclusion en ligne le couperait.`);
    process.exit(1);
  }
}

const page = `<title>CIRCUIT</title>
<style>
${style}
</style>
<div id="root"></div>
<script type="module">
${script}
</script>
`;

const out = opts.out ?? 'dist/circuit.html';
writeFileSync(out, page);
console.log(`Écrit : ${out} (${Math.round(page.length / 1024)} Ko)`);
