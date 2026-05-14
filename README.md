# Mów po polsku 🇵🇱 — Apprends le polonais

Application web complète pour apprendre le polonais de zéro à l'aisance conversationnelle (A0 → B1+),
**sans dépendance, sans backend, sans compte**. Tout se passe dans le navigateur.

## Ce que tu trouves dans l'app

- **Parcours guidé** A0 → B1 : 13 leçons structurées avec objectifs et liens vers les outils.
- **Alphabet complet** : les 32 lettres et tous les digraphes (cz, sz, rz, dz…) avec prononciation audio.
- **Règles de prononciation** : accent tonique, voyelles nasales, paires douces/dures, dévoisement.
- **Grammaire** : les 7 cas (nominatif, génitif, datif, accusatif, instrumental, locatif, vocatif),
  le genre, l'aspect verbal (perfectif / imperfectif), les conjugaisons, les pronoms, la politesse.
- **Vocabulaire thématique** : 17 thèmes, près de 500 mots (famille, nourriture, voyage, ville,
  maison, corps, météo, couleurs, animaux, vêtements, émotions, shopping, verbes fréquents…).
- **Verbes essentiels** : 20 verbes-clés conjugués au présent, passé (masculin/féminin), futur,
  avec exemples concrets et partenaire perfectif.
- **Phrases utiles** : 100+ phrases prêtes à l'emploi par situation (restaurant, transport,
  urgences, hôtel, shopping, smalltalk…).
- **Flashcards SRS** : système de répétition espacée pour mémoriser durablement.
- **Quiz** : 3 modes (polonais→français, français→polonais, écoute).
- **Progrès** : streak quotidien, statistiques de révision, scores.

## Audio

L'application utilise l'API **Web Speech** de ton navigateur pour prononcer chaque mot avec une
voix polonaise native (`pl-PL`). C'est gratuit et sans configuration.

- ✅ **Chrome / Edge / Safari** : voix polonaise disponible par défaut.
- ⚠️ **Firefox sous Linux** : il faut parfois installer une voix polonaise au niveau système
  (espeak, pico-tts).
- 📱 **iOS / Android** : la voix « Polonais » est généralement déjà installée.

## Lancer l'app

C'est une SPA en HTML / CSS / JavaScript vanille (modules ES). Aucun build n'est nécessaire.

### En local

```bash
python3 -m http.server 8000
# puis ouvre http://localhost:8000
```

ou avec Node :

```bash
npx serve .
```

### Sur GitHub Pages

1. Va dans **Settings → Pages** de ce dépôt.
2. Source : **Deploy from a branch**.
3. Branche : `claude/polish-learning-app-SwwU7` (ou `main` si tu fusionnes) — racine `/`.
4. Patiente ~1 minute, ton site est en ligne.

## Structure du projet

```
.
├── index.html              # Coquille de la SPA
├── styles.css              # Styles
├── js/
│   ├── app.js              # Routeur, bootstrap
│   ├── audio.js            # Wrapper Web Speech (pl-PL)
│   ├── storage.js          # localStorage, SRS, streak, stats
│   └── views/              # Une vue par page
│       ├── home.js
│       ├── parcours.js
│       ├── alphabet.js
│       ├── prononciation.js
│       ├── grammaire.js
│       ├── vocabulaire.js
│       ├── verbes.js
│       ├── phrases.js
│       ├── flashcards.js
│       ├── quiz.js
│       └── progres.js
└── data/                   # Tout le contenu pédagogique
    ├── alphabet.js
    ├── grammar.js
    ├── lessons.js
    ├── phrases.js
    ├── verbs.js
    └── vocabulary.js
```

## Méthode d'apprentissage recommandée

20-30 minutes par jour, tous les jours. Plutôt que 3h le dimanche.

1. **Semaines 1-2** : alphabet et prononciation à fond. Lis chaque lettre à voix haute.
2. **Semaines 3-6** : les 30 phrases de survie + le verbe `być` + le verbe `mieć`.
3. **Semaines 7-12** : ouverture vers le vocabulaire thématique + premier cas (accusatif).
4. **À partir de la semaine 13** : un thème de vocabulaire par semaine, un cas grammatical par 3-4 semaines.

Routine quotidienne idéale :
- 5 min de flashcards (cartes dues)
- 10 min sur une leçon de grammaire ou un nouveau thème
- 5 min de quiz pour mesurer
- 5-10 min d'écoute / répétition à voix haute

## Powodzenia ! 🍀
