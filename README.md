# CIRCUIT — simulateur de carrière e-sport procédural

Un jeu de simulation jouable dans le navigateur. Vous ne jouez pas aux matchs :
vous jouez la vie d'un joueur professionnel, dans un monde qui existait avant
vous et qui continuera sans vous.

**État : phase 1 terminée et jouable de bout en bout.** Une carrière complète se
joue, de la chambre au bilan de fin de carrière. Voir « Ce qui n'existe pas
encore » plus bas — cette section est volontairement explicite.

---

## Lancer le projet

```bash
npm install
npm run dev      # développement
npm run build    # build statique dans dist/
npm test         # suite de tests du moteur (node --test, ~3 min)
```

Aucune API externe, aucun compte, aucun serveur. Le jeu tourne entièrement dans
le navigateur et sauvegarde en `localStorage`.

---

## Choix de stack

| Choix | Raison |
| --- | --- |
| **Vite + React 18** | Build statique, hébergeable partout, offline-first (§63). |
| **JavaScript ES modules, zéro dépendance runtime** | Le moteur tourne sous `node --test` sans navigateur : les tests peuvent jouer 300 carrières en boucle. |
| **`node --test` natif** | Pas de framework de test à maintenir. |
| **Pas de TypeScript** | Les invariants critiques (« un retraité ne joue pas ») ne sont pas des types mais des états ; ils sont couverts par `validator.js` et les tests. |

**Règle d'architecture absolue :** `src/engine/**` ne contient pas un seul
`import React`. L'interface consomme le moteur, jamais l'inverse.

---

## Architecture

```
src/
  data/                 Données statiques, modifiables sans toucher au code (§54)
    games.js            9 jeux fictifs : poids d'attributs, rôles, méta, volatilité
    regions.js          8 régions compétitives + viviers de noms
    traits.js           18 traits de personnalité, chacun avec des effets mesurables
    origins.js          10 origines + 6 situations familiales
    orgs.js             Tiers d'organisation, philosophies de recrutement, sponsors
    training.js         11 activités hebdomadaires (gains ET coûts)

  engine/               Moteur pur, sans UI
    rng.js              PRNG déterministe, sérialisable (seed → monde reproductible)
    time.js             Calendrier : semaine = tick, saison = 52 semaines
    attributes.js       34 attributs en 6 familles + plafonds cachés
    person.js           Modèle unique, partagé par le joueur ET les ~600 PNJ
    progression.js      Progression organique, fatigue, déclin lié à l'âge
    org.js / team.js    Organisations, rosters, synergie, besoins de recrutement
    relations.js        Relations avec historique daté (jamais une simple barre)
    meta.js             Patches, bascules de méta, popularité des jeux
    match.js            Simulation de match : niveau, synergie, méta, pression, hasard
    competition.js      Deux formats génériques : ligue et bracket
    season.js           Pyramide compétitive, promotions/relégations
    transfers.js        Marché explicable : chaque offre liste ses facteurs
    worldgen.js         Génération du monde à partir d'une seed
    worldSim.js         Vie du monde sans le joueur : retraites, générations, économie
    events/             DecisionEngine + définitions d'événements conditionnels
    career.js           État de carrière : timeline, mémoires, succès, drapeaux
    legacy.js           Score en 7 dimensions, archétype, récit final
    achievements.js     25 succès, tous vérifiés sur l'état réel
    validator.js        CareerConsistencyValidator (§61)
    simulation.js       SimulationEngine : orchestre la semaine
    save.js             Sauvegarde locale compacte et versionnée
    view.js             View-models : la seule chose que l'UI a le droit de lire

  ui/                   React
    store.js            Store minimal (useSyncExternalStore)
    screens/            Accueil, Création, Carrière, Monde, Stats, Legacy
    components/         Jauges, modale d'événement, rapport de semaine

tests/engine.test.js    31 tests qui jouent réellement des carrières entières
```

---

## Les principes qui gouvernent le code

### 1. Cohérence causale avant tout (§2)

Aucun événement n'est tiré « au hasard ». Chaque définition d'événement expose
une `condition(ctx)` évaluée sur l'état réel du monde, et un `weight(ctx)`
contextuel. Si rien de plausible n'est éligible cette semaine, **il ne se passe
rien** — c'est préférable à une situation absurde.

Exemple concret : `scout_notices` exige que le joueur ait été réellement
observé (`observations >= 5`), qu'il dépasse un niveau seuil, **et** qu'il
existe au moins une équipe de sa région qui cherche effectivement quelqu'un. Si
personne ne recrute, aucun recruteur n'apparaît.

### 2. Probabilités explicables (§59)

`evaluateInterest()` ne renvoie pas un nombre : il renvoie un score **et la
liste des facteurs qui le composent**. L'interface les affiche telles quelles
sous « Pourquoi vous ? ».

```
Base                            +5
Niveau au-dessus du besoin     +12
Marge de progression estimée    +8
Place libre dans l'effectif    +22
Relations dans l'équipe         +6
Salaire hors budget            -18
```

### 3. Conséquences différées (§58)

`fx.later('discipline_noticed', 40)` programme un effet 40 semaines plus tard.
Les handlers sont adressés par chaîne de caractères (donc sérialisables) et
**revalident le contexte** avant de s'appliquer : si l'équipe a disparu entre
temps, l'effet ne s'applique pas.

### 4. Le joueur est un habitant comme les autres (§86)

Le joueur et les PNJ utilisent la même structure `Person`, la même fonction de
progression, le même simulateur de match, le même marché des transferts. Les
PNJ progressent, déclinent, se font transférer, prennent leur retraite et
deviennent coachs — que le joueur regarde ou non.

### 5. Anti-exploit (§79)

L'état du PRNG est sauvegardé **avec la partie**. Recharger une sauvegarde
rejoue exactement la même semaine : on ne peut pas re-tirer un résultat. Un
test le vérifie explicitement.

### 6. Rien de faux dans l'interface (§83)

L'UI ne lit jamais le monde directement : elle consomme `view.js`. Aucun écran
ne peut afficher une donnée que le moteur ne produit pas. Les boutons
indisponibles disent **pourquoi** (« Il vous faut 150 € pour les frais
d'inscription »).

---

## Ce qui est implémenté

- **Monde par seed** : 9 scènes, ~170 équipes, ~700 personnes, régénérables à
  l'identique.
- **34 attributs** en 6 familles, avec plafonds cachés jamais affichés
  (estimation en étoiles qui se précise avec les observations).
- **9 jeux mécaniquement différents** : les poids par famille changent
  réellement qui est bon à quoi. Un IGL de VANGUARD et un spécialiste
  d'IRONFIST ne sont pas comparables.
- **Un fil d'actualité qui est celui de votre monde** : les champions couronnés,
  les carrières qui s'arrêtent, les organisations qui montent et qui meurent.
  Ce qui se passe sur une scène que vous ne jouez pas ne vous parvient que si
  c'est un championnat du monde.
- **Métas vivantes** : patches majeurs, bascules d'axe, choc d'adaptation
  proportionnel à la rigidité du joueur, popularité qui monte et descend, et
  scènes qui peuvent mourir.
- **Pyramide compétitive** : circuit amateur → ligue nationale/régionale →
  playoffs → international → mondiaux, avec promotions et relégations.
- **Simulation de match** intégrant niveau, forme, fatigue, moral, synergie,
  coaching, méta, préparation et pression, avec détection de comebacks et
  d'upsets.
- **Synergie d'équipe** : ±6 points de niveau réel. Une équipe soudée à 85 bat
  une équipe brisée à 90.
- **Marché des transferts** explicable, avec besoins réels, budgets,
  philosophies de recrutement et refus motivés.
- **Relations** avec historique daté, rivalité qui se construit sur plusieurs
  années et peut se résoudre en respect ou en rancune définitive. Le fil rouge
  d'une carrière est visible pendant qu'on le vit : depuis quand, l'écart de
  niveau avec le rival, les confrontations réellement jouées et leur bilan, et
  comment chaque rivalité passée s'est éteinte.
- **Chaînes narratives** : ascension, rivalité, duo, conflit de vestiaire,
  surcharge, changement de jeu, effondrement d'organisation.
- **Vieillissement réel** : pic vers 22-26 ans, déclin mécanique ensuite,
  compensé (ou non) par la lecture du jeu.
- **Écosystème d'après-carrière** : les joueurs qui raccrochent se reconvertissent
  en entraîneurs, les entraîneurs finissent eux aussi par partir, et les équipes
  recrutent sur le marché ainsi ouvert. Après quarante ans, les entraîneurs en
  poste sont tous d'anciens joueurs, sur la scène qu'ils connaissent.
- **Coups durs enregistrés par la simulation** : perdre son équipe et rester
  dehors, une année sans que le téléphone sonne, deux mois où plus rien n'a de
  goût. Ces moments existaient déjà dans le moteur ; ils n'étaient simplement
  jamais nommés, et le bilan racontait une carrière sans accroc à un joueur
  licencié trois fois.
- **Bilan de saison** : chaque saison se referme sur ce qu'elle a produit —
  un titre de presse tiré des faits, matchs, victoires, progression, l'objectif
  fixé par la structure tenu ou raté, et les gains. Tous les chiffres sont des
  différences entre le début et la fin de saison, jamais un compteur parallèle.
- **La fin de carrière est un moment, pas un onglet** : quand la carrière
  s'arrête — l'âge, le corps, ou plus personne qui appelle — le jeu ouvre
  lui-même la page de fin et annonce ce qui vient de se passer, avec la raison
  enregistrée par le moteur. Un joueur retraité ne se voit plus proposer une
  routine d'entraînement.
- **Fin de carrière** : score en 7 dimensions, archétype, récit généré
  uniquement à partir de faits survenus, carte de carrière partageable. Le récit
  dit aussi comment on s'est arrêté — décision, usure, corps qui lâche, ou plus
  personne qui appelle. La
  fiche résume les saisons au lieu de dérouler le journal — le titre gagné n'y
  pèse plus autant que le 312ᵉ match de poule — et le journal complet reste
  accessible d'un clic.
- **Charge accumulée visible** : l'état ressenti (frais → burnout), sa
  tendance, ce qui pèse, et surtout où la routine choisie mène si on la tient.
  La projection est l'inversion exacte de la loi d'accumulation du moteur, et
  les cinq entrées du calcul sont des faits enregistrés par la simulation, pas
  un contexte reconstitué après coup.
- **Le jeu répond aux décisions** : quand un choix est tranché, la fenêtre
  reste ouverte et dit ce qu'il a produit — la phrase de résolution, puis les
  chiffres. Le registre note ce qui a été APPLIQUÉ, après mise à l'échelle par
  la difficulté et après plafonnement : un attribut bloqué à 99 n'annonce aucun
  gain, et une famille entière modifiée donne une ligne au lieu de six.
- **La notoriété se gagne** : au-delà de ce que le niveau justifie, seuls les
  titres font monter — pour le joueur comme pour les PNJ. Un moment médiatique
  porte au-dessus de son rang, l'oubli annuel le ramène. Mesuré avant
  correction : le joueur finissait avec 25 fois l'audience des PNJ de son
  propre monde ayant la même carrière, et l'écart était le plus grand chez ceux
  qui n'avaient jamais rien gagné.
- **Se reposer change tout, et c'est mesurable** : sur 40 carrières de trente
  ans, une routine qui ne cède jamais un créneau au repos ou à la vie sociale
  laisse le moral à 10 en médiane ; la même carrière avec une routine qui insère
  du repos quand la fatigue monte le laisse à 94. Le moral multiplie la
  progression, et l'écart se lit ensuite partout : 90 % du plafond atteint
  contre 92 %, 25ᵉ de ses contemporains contre 17ᵉ. Le joueur atteint le top 10
  mondial dans environ 12 % des carrières, et a culminé 2ᵉ.
- **Deux notes, et la différence expliquée** : le niveau acquis, et celui
  auquel vous jouez aujourd'hui. Mesuré sur 6 637 semaines, l'écart entre les
  deux dépasse 3 points 43 % du temps et 6 points 31 % du temps — dans les deux
  sens : 44 % du temps il joue en votre faveur. L'écran donnait le premier, les
  matchs se jouaient sur le second. Le détail — forme, fatigue, moral — fait
  exactement la somme annoncée, parce que la décomposition EST la définition de
  la note effective, pas une explication écrite à côté.
- **La courbe d'une carrière** : dix-sept ans, ce sont dix-sept bilans qu'il
  fallait lire l'un après l'autre. La forme — la montée, le palier, le pic, le
  déclin, et à quelle saison un transfert a tout changé — se lit maintenant d'un
  coup d'œil, pendant la carrière comme à la retraite. Chaque point est le
  niveau enregistré à la clôture de sa saison, jamais reconstitué après coup, et
  l'échelle garde une amplitude minimale pour qu'une carrière plate ne se
  dessine pas comme une ascension.
- **Sauvegarde locale** compacte, versionnée, avec reprise automatique.

## Ce qui n'existe pas encore

Listé explicitement pour ne rien prétendre (§83) :

- **Modes post-carrière jouables** (coach, manager, propriétaire). La page
  Legacy liste les reconversions que votre profil rendrait crédibles, mais ce
  ne sont pas encore des modes de jeu.
- **Défi quotidien et classements** (§37) : le déterminisme par seed rend le
  mode possible, il n'est pas construit.
- **Scénarios prédéfinis** (§38) et **mode « what if »** (§39).
- **Comparaison de deux carrières** (§52).
- **Records mondiaux persistants** (§68).
- **Objectifs cachés** (§35) : seuls les objectifs visibles sont calculés.
- **Le joueur naît moins doué que les adolescents de son monde.** Le joueur et
  le monde calculent la même grandeur — la marge de progression restante à un
  âge donné — avec deux formules différentes, et celle du joueur est la plus
  sévère : `clamp(23 - âge, 0, 8)` donne 5 à 18 ans là où le monde donne 11,8,
  et tombe à 0 dès 23 ans. Le plafond d'un personnage valant son niveau actuel
  plus cette marge, le joueur est doublement pénalisé. Mesuré à la création sur
  30 mondes, avant que rien n'ait été joué : potentiel médian 76,8 pour le
  joueur contre 88,4 pour les PNJ de moins de 20 ans, et **aucun joueur sur
  trente** ne pouvait naître dans le dernier décile de sa propre génération.
  Aucune note de conception ne demande cet écart.

  La correction a été écrite et mesurée, puis **retirée** : elle relève le
  potentiel médian de 71 à 78, mais casse trois tests dont deux demandent de
  recalibrer des systèmes validés (les titres de presse de l'étape 9A, la
  divergence des carrières à talent égal). Livrer un changement d'équilibre au
  prix d'une cascade de recalibrages demande une raison plus forte que la
  cohérence des formules.

Ces manques correspondent aux phases 5 et 6 du plan de développement. La
priorité a été donnée à la profondeur des systèmes existants plutôt qu'au
nombre de fonctionnalités (§77, §87).

---

## Y jouer

```bash
npm install && npm run dev
```

Pour une page unique, sans rien installer côté joueur :

```bash
npm run build && node tools/bundle-page.js --out=circuit.html
```

Tout y est — feuille de style, moteur, interface — et les sauvegardes passent
par le `localStorage` du navigateur.

## Outils

```bash
node tools/career.js --seed=demo --policy=grinder --years=25 --narrative
node tools/fingerprint.js --out=/tmp/avant.json      # avant un changement
node tools/fingerprint.js compare --before=/tmp/avant.json --after=/tmp/apres.json
```

`career.js` joue une carrière complète et peut en produire une sauvegarde : on
inspecte les écrans de fin de partie sans jouer vingt ans à la main.

`fingerprint.js` répond à une question qui revient à chaque correction : ce
changement modifie-t-il le jeu, ou seulement ce qu'il enregistre ? Beaucoup
n'ajoutent qu'une trace et ne doivent alors RIEN déplacer. Le vérifier prend
trois minutes, contre une heure quarante pour une baseline — et la réponse est
plus nette, puisqu'on compare les carrières une à une au lieu de distributions.

## Tests

```bash
npm test
```

Les tests ne vérifient pas que le code compile : ils **jouent des carrières
entières** et contrôlent les invariants du §60.

Couverture notable :

- déterminisme du RNG et reproductibilité d'un monde par seed ;
- carrière normale, catastrophique, exceptionnelle, retraite précoce et tardive ;
- dix carrières sur dix seeds, toutes validées par le `validateWorld` complet ;
- trois stratégies de jeu produisant trois carrières mesurablement différentes ;
- organisation dissoute : tout le monde est libéré, personne ne reste inscrit ;
- personne ne peut appartenir à deux équipes ;
- jeunes qui progressent / vétérans qui déclinent ;
- le monde évolue sans le joueur (transferts, retraites, nouvelles générations) ;
- anti-répétition : aucun événement rejoué à l'intérieur de son cooldown ;
- sauvegarde/rechargement à l'identique, et impossibilité de re-tirer un résultat ;
- le récit final ne mentionne jamais un titre qui n'a pas été gagné ;
- les conséquences affichées après un choix sont celles qui ont été
  appliquées, pas celles qui étaient écrites dans l'événement — bornes et
  difficulté comprises — et la fenêtre reste ouverte pour les montrer ;
- une carrière qui s'arrête d'elle-même conduit le joueur à sa page de fin,
  et chaque raison d'arrêt possible a bien une phrase pour la dire ;
- l'audience du joueur reste du même ordre que celle des PNJ de son monde
  ayant une carrière équivalente — c'est la seule façon de vérifier qu'il
  n'est pas privilégié, et une comparaison à la moyenne générale ne le dit
  pas.

---

## Ajouter du contenu

**Un nouveau jeu** : ajoutez un objet dans `src/data/games.js` (poids par
famille, attributs clés, rôles, volatilité de méta) et une ligne dans
`GENRE_TRANSFER`. Rien d'autre.

**Un nouvel événement** : ajoutez un objet dans un fichier de
`src/engine/events/defs/`. Il doit exposer `condition`, `weight`, `title`,
`text` et soit `choices`, soit `auto`. Avant de l'ajouter, posez-vous les
questions du §85 : quelles histoires nouvelles crée-t-il, avec quels systèmes
interagit-il, peut-il créer une incohérence ?

**Un nouveau trait** : ajoutez-le dans `src/data/traits.js` avec des `mods`
réellement lus par le moteur. Un trait sans effet mesurable n'a rien à y faire.
