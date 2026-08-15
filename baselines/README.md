# Baselines

Références **immuables** de comportement du moteur. Elles servent à comparer
objectivement l'avant et l'après de chaque correction (phase 2).

## `baseline-v1.json`

- Suite : 1400 carrières × 20 ans + 2 mondes de 30 ans sans joueur + 120
  trajectoires de PNJ suivies sur 20 ans.
- Empreinte des entrées : `25ba811283ffa763`
- Moteur : commit `48c87c4` (**avant** l'étape 1 « renouvellement des scènes »).
  Le champ `engineDirty` vaut `true` : au moment de l'enregistrement, les
  fichiers de l'étape 1 étaient déjà écrits sur le disque mais **pas chargés**
  par le processus, qui avait importé ses modules au démarrage. Le baseline
  reflète donc bien le moteur d'avant correction — ce que confirment ses
  chiffres (2 et 3 scènes vivantes à l'année 30).

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
