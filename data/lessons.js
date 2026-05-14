// Structured curriculum: a step-by-step study path from A0 to B1.
// Each lesson has an id, title, level, objectives, content (markdown-like strings),
// and "go" targets pointing to sections of the app.

export const lessons = [
  // ----- Level A0 : foundations -----
  {
    id: 'a0-1',
    level: 'A0',
    weeks: '1',
    title: 'Premiers contacts avec le polonais',
    objectives: [
      'Comprendre les bases sonores du polonais',
      'Lire et prononcer correctement chaque lettre',
      'Mémoriser une dizaine de salutations'
    ],
    body: [
      "Bienvenue ! Avant tout : laisse de côté l'idée que le polonais est 'imprononçable'. Chaque lettre a une prononciation stable. Une fois apprises, tu sauras lire n'importe quel mot.",
      "Concentre-toi cette semaine sur trois choses : (1) reconnaître les 32 lettres et leur son, (2) entendre la différence entre les 'paires douces' (ć/cz, ś/sz, ź/ż), (3) apprendre les 10 salutations les plus utilisées.",
      "Chaque jour, écoute chaque lettre 3 fois et répète à voix haute. Ce travail oral est crucial."
    ],
    targets: [
      { label: 'Alphabet complet', href: '#/alphabet' },
      { label: 'Salutations', href: '#/vocabulaire' },
    ]
  },
  {
    id: 'a0-2',
    level: 'A0',
    weeks: '1-2',
    title: 'Prononciation : les pièges à éliminer',
    objectives: [
      'Maîtriser CZ/CZ, SZ/Ś, RZ/Ż',
      'Comprendre l’accent tonique (toujours sur l’avant-dernière syllabe)',
      'Identifier les voyelles nasales Ą et Ę'
    ],
    body: [
      "Si tu fais bien la distinction entre les sons doux (ć, ś, ź) et durs (cz, sz, ż), tu auras un accent crédible. L'astuce : place ta langue plus près des dents pour les sons doux, plus en arrière pour les durs.",
      "L'accent tonique tombe presque toujours sur l'avant-dernière syllabe. Donc 'kawiarnia' = ka-WIAR-nia. Cette régularité te facilite la vie.",
      "Les voyelles nasales Ą et Ę se prononcent 'on' et 'in' à la française, mais avec des nuances selon la consonne qui suit (lit la fiche prononciation)."
    ],
    targets: [
      { label: 'Règles de prononciation', href: '#/prononciation' },
    ]
  },

  // ----- Level A1 : surviving -----
  {
    id: 'a1-1',
    level: 'A1',
    weeks: '3-4',
    title: 'Se présenter et poser des questions simples',
    objectives: [
      'Dire son prénom, son origine, son âge',
      'Demander la même chose à quelqu’un',
      'Maîtriser être (być) et avoir (mieć) au présent'
    ],
    body: [
      "Tu vas pouvoir tenir une mini-conversation. Apprends d'abord à conjuguer être (jestem, jesteś, jest…) et avoir (mam, masz, ma…).",
      "Ensuite, mémorise les questions essentielles : 'Jak masz na imię?' (comment tu t'appelles), 'Skąd jesteś?' (d'où viens-tu), 'Ile masz lat?' (quel âge as-tu).",
      "En polonais, on omet souvent le pronom personnel parce que la terminaison du verbe le rend redondant. 'Jestem z Francji' = 'Je suis de France' (pas besoin de 'ja')."
    ],
    targets: [
      { label: 'Conjuguer być et mieć', href: '#/verbes' },
      { label: 'Phrases pour se présenter', href: '#/vocabulaire' },
    ]
  },
  {
    id: 'a1-2',
    level: 'A1',
    weeks: '5-6',
    title: 'Les nombres et l’heure',
    objectives: [
      'Compter de 0 à 100',
      'Donner et demander l’heure',
      'Comprendre les jours, mois et saisons'
    ],
    body: [
      "Les nombres ouvrent des dizaines de situations : faire les courses, prendre un billet, donner son âge. Apprends d'abord 0-20 par cœur, puis les dizaines.",
      "Attention au piège grammatical : 'jeden' (1) prend le nominatif singulier ('jedno jabłko'), '2-3-4' prennent le pluriel ('trzy jabłka'), et à partir de 5, on passe au génitif pluriel ('pięć jabłek').",
      "Pour l'heure : 'Która godzina?' = quelle heure est-il ? La réponse utilise des formes féminines des nombres ordinaux (pierwsza, druga, trzecia…)."
    ],
    targets: [
      { label: 'Vocabulaire des nombres', href: '#/vocabulaire' },
      { label: 'Phrases pour le temps', href: '#/phrases' },
    ]
  },
  {
    id: 'a1-3',
    level: 'A1',
    weeks: '7-8',
    title: 'Premier cas : l’Accusatif',
    objectives: [
      'Reconnaître quand utiliser l’accusatif',
      'Former l’accusatif au singulier (masc., fém., neutre)',
      'Construire des phrases avec mieć et lubić'
    ],
    body: [
      "L'accusatif est le COD direct. 'Mam kota' (j'ai un chat), 'Lubię kawę' (j'aime le café).",
      "Règle clé : féminin en -a → -ę (kobieta → kobietę), masculin animé → -a (kot → kota), masculin inanimé et neutre → identique au nominatif (stół → stół, okno → okno).",
      "À la négation, l'accusatif disparaît et devient génitif : 'Nie mam kota' (je n'ai pas de chat — kota au génitif). Mémorise cette inversion."
    ],
    targets: [
      { label: 'Fiche : l’Accusatif', href: '#/grammaire/accusatif' },
    ]
  },

  // ----- Level A2 : daily conversations -----
  {
    id: 'a2-1',
    level: 'A2',
    weeks: '9-12',
    title: 'Au restaurant, dans les magasins',
    objectives: [
      'Commander dans un restaurant polonais',
      'Faire ses courses dans un sklep ou marché',
      'Connaître les plats typiques (pierogi, bigos, żurek)'
    ],
    body: [
      "Tu peux maintenant aborder le vrai monde : passer commande, demander l'addition, négocier un prix au marché.",
      "Les Polonais apprécient quand un étranger fait l'effort de parler — même imparfaitement. N'aie pas peur des erreurs.",
      "Memorise les structures clés : 'Poproszę…' (je voudrais, formule polie), 'Ile to kosztuje?' (combien ça coûte), 'Rachunek, proszę' (l'addition, s'il vous plaît)."
    ],
    targets: [
      { label: 'Phrases au restaurant', href: '#/phrases' },
      { label: 'Vocab. nourriture', href: '#/vocabulaire' },
    ]
  },
  {
    id: 'a2-2',
    level: 'A2',
    weeks: '13-16',
    title: 'Le passé : raconter sa journée',
    objectives: [
      'Conjuguer un verbe imperfectif au passé',
      'Accorder le verbe en genre avec le sujet',
      'Différencier passé imperfectif vs perfectif'
    ],
    body: [
      "Le passé polonais s'accorde en genre. Si tu es un homme, tu dis 'byłem' (j'étais) ; si tu es une femme, 'byłam'. C'est un point de vigilance constant.",
      "L'aspect change tout : 'czytałem książkę' (je lisais un livre, action en cours) vs 'przeczytałem książkę' (j'ai lu — et terminé — un livre).",
      "Astuce : commence par mémoriser le passé de 5 verbes très fréquents (być, mieć, robić, iść, jeść), puis étends progressivement."
    ],
    targets: [
      { label: 'Tableau du passé', href: '#/grammaire/passe' },
      { label: 'Verbes essentiels', href: '#/verbes' },
    ]
  },
  {
    id: 'a2-3',
    level: 'A2',
    weeks: '17-20',
    title: 'Le génitif et la négation',
    objectives: [
      'Maîtriser le génitif : possession, négation, après prépositions',
      'Identifier les prépositions qui le commandent (bez, dla, do, od, z)',
      'Appliquer la règle des nombres ≥ 5'
    ],
    body: [
      "Le génitif est le cas le plus polyvalent. Tu vas le rencontrer partout.",
      "Quand tu nies une phrase, le COD passe en génitif : 'Mam czas' → 'Nie mam czasu'.",
      "Cinq petites prépositions à mémoriser absolument : bez (sans), dla (pour), do (vers, à), od (de, depuis), z (depuis — origine)."
    ],
    targets: [
      { label: 'Fiche : Génitif', href: '#/grammaire/genitif' },
    ]
  },

  // ----- Level B1 : becoming autonomous -----
  {
    id: 'b1-1',
    level: 'B1',
    weeks: '21-26',
    title: 'Locatif & Instrumental — décrire et localiser',
    objectives: [
      'Utiliser le locatif après w / na / o / przy',
      'Construire les phrases d’identité avec l’instrumental (jestem nauczycielem)',
      'Décrire un trajet avec un moyen de transport (jadę autobusem)'
    ],
    body: [
      "Le locatif sert à dire 'à Varsovie' (w Warszawie), 'sur la table' (na stole), 'à propos de toi' (o tobie).",
      "L'instrumental est le cas du 'avec' et du 'par moyen de'. 'Z bratem' (avec mon frère), 'autobusem' (en bus).",
      "Important : pour dire ta profession, on emploie l'instrumental : 'Jestem inżynierem' (je suis ingénieur)."
    ],
    targets: [
      { label: 'Fiche : Locatif', href: '#/grammaire/locatif' },
      { label: 'Fiche : Instrumental', href: '#/grammaire/instrumental' },
    ]
  },
  {
    id: 'b1-2',
    level: 'B1',
    weeks: '27-32',
    title: 'Le futur et la planification',
    objectives: [
      'Former le futur perfectif (= présent du perfectif)',
      'Former le futur imperfectif avec być + infinitif',
      'Parler de projets : weekend, vacances, vie pro'
    ],
    body: [
      "Le futur perfectif est presque trop simple : tu prends un verbe perfectif et tu le conjugues au présent — ça donne le futur. 'Napiszę' = j'écrirai (et terminerai).",
      "Le futur imperfectif suit la formule : być conjugué + infinitif. 'Będę pisać' = j'écrirai (sans préciser si je termine).",
      "Distingue : 'jutro będę pracować' (demain je vais travailler — toute la journée, action continue) vs 'jutro skończę projekt' (demain je terminerai le projet — résultat ponctuel)."
    ],
    targets: [
      { label: 'Fiche : Futur', href: '#/grammaire/futur' },
    ]
  },
  {
    id: 'b1-3',
    level: 'B1',
    weeks: '33-40',
    title: 'Pluriel viril et concorde des adjectifs',
    objectives: [
      'Reconnaître le pluriel viril (męskoosobowy)',
      'Accorder les adjectifs en cas, nombre et genre',
      'Lire un texte simple et résumer'
    ],
    body: [
      "Le polonais distingue au pluriel : groupe avec au moins un homme (męskoosobowy : 'studenci', 'oni') vs groupe sans homme (niemęskoosobowy : 'studentki', 'one').",
      "Cette distinction affecte le verbe au passé et les adjectifs : 'oni byli mili' (ils étaient gentils, avec hommes), 'one były miłe' (elles étaient gentilles, sans hommes).",
      "Les adjectifs polonais ont leurs propres terminaisons (-y / -i / -a / -e) et se déclinent comme les noms. Étudie-les en parallèle des cas."
    ],
    targets: [
      { label: 'Fiche : Genre', href: '#/grammaire/genre' },
    ]
  },

  // ----- Method -----
  {
    id: 'method',
    level: 'Méthode',
    weeks: 'En continu',
    title: 'Comment travailler chaque jour',
    objectives: [
      'Fixer une routine d’apprentissage soutenable',
      'Combiner les outils de l’app de façon efficace',
      'Mesurer ses progrès et rester motivé'
    ],
    body: [
      "Cible 20 à 30 minutes par jour, plutôt que 3 heures le dimanche. La régularité bat le volume.",
      "Routine quotidienne idéale : (1) 5 min de flashcards SRS pour les mots dus, (2) 10 min sur une leçon de grammaire ou de vocab, (3) 5 min de quiz pour mesurer, (4) 5-10 min d'écoute / répétition à voix haute.",
      "Une fois par semaine, lis un dialogue de la rubrique 'Phrases' et essaie de le réciter de mémoire. Une fois par mois, écris un petit texte (5 phrases) sur ta journée.",
      "Le streak de l'app est un bon allié : un jour étudié, un point. Vise une série continue sans la rompre."
    ],
    targets: [
      { label: 'Lancer les flashcards', href: '#/flashcards' },
      { label: 'Voir mes progrès', href: '#/progres' },
    ]
  }
];

export const levels = ['A0', 'A1', 'A2', 'B1', 'Méthode'];

export function getLesson(id) {
  return lessons.find(l => l.id === id);
}
