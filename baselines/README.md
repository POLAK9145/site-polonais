# Baselines

Références **immuables** de comportement du moteur. Elles servent à comparer
objectivement l'avant et l'après de chaque correction (phase 2).

## `baseline-v1.json`

- Suite : 1400 carrières × 20 ans + 2 mondes de 30 ans sans joueur + 120
  trajectoires de PNJ suivies sur 20 ans.
- Empreinte des entrées : `25ba811283ffa763`
- Moteur mesuré : commit `48c87c4`, c'est-à-dire **avant** l'étape 1
  « renouvellement des scènes ».

  Précision nécessaire à qui relira l'historique : le fichier de baseline a
  été *commité* dans `b017b23`, lequel contient aussi le code de l'étape 1
  (`src/engine/scene.js`). Ce n'est pas une contradiction — l'enregistrement
  tournait déjà lorsque ces fichiers ont été écrits sur le disque, et Node
  avait importé ses modules au démarrage du processus. Les mesures reflètent
  donc bien le moteur d'avant correction, ce que confirment à la fois le champ
  `engineCommit` du JSON (`48c87c4`) et ses chiffres : 2 et 3 scènes vivantes
  à l'année 30, là où le moteur corrigé en conserve 9.

## Ce qui est reproductible, et ce qui ne l'est pas

Les **entrées** le sont strictement : seed, configuration de personnage,
politique de décision et paramètres de chaque carrière sont dérivés du seul
index dans la suite (`buildSuiteTasks`). L'empreinte SHA-256 le vérifie.

Les **sorties individuelles** ne le sont pas d'une version du moteur à
l'autre : toute modification déplace le flux aléatoire, et la carrière n° 37
ne raconte plus la même histoire. C'est attendu. On compare des
**distributions** sur les 1400 carrières, jamais des carrières une à une.

## Usage

```bash
node tools/baseline.js run --out=/tmp/apres.json
node tools/baseline.js compare --before=baselines/baseline-v1.json --after=/tmp/apres.json
```

`record` refuse d'écraser un fichier existant. Un baseline ne se remplace pas :
si la suite change, sa version change et un nouveau fichier est créé.
