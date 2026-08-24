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
- le récit final ne mentionne jamais un titre qui n'a pas été gagné.

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
