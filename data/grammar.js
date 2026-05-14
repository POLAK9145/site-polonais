// Polish grammar essentials: the 7 cases, gender system, verb aspect, conjugation patterns.
// Designed for self-study from beginner to upper intermediate.

export const grammarTopics = [
  {
    id: 'genre',
    title: 'Le genre des noms',
    intro: "Le polonais distingue trois genres au singulier : masculin, féminin et neutre. Au pluriel, on distingue deux groupes : « hommes » (męskoosobowy) et « tout le reste » (niemęskoosobowy). Cette distinction conditionne adjectifs, verbes au passé, et déclinaisons.",
    sections: [
      {
        h: 'Comment reconnaître le genre',
        p: "On reconnaît le genre essentiellement à la terminaison du nominatif singulier.",
        table: {
          headers: ['Genre', 'Terminaison typique', 'Exemple', 'Sens'],
          rows: [
            ['Masculin', 'consonne (souvent)', 'dom', 'maison'],
            ['Masculin', 'consonne', 'kot', 'chat'],
            ['Féminin', '-a', 'kobieta', 'femme'],
            ['Féminin', '-i / -consonne molle', 'pani', 'madame'],
            ['Neutre', '-o', 'okno', 'fenêtre'],
            ['Neutre', '-e', 'morze', 'mer'],
            ['Neutre', '-ę', 'imię', 'prénom'],
            ['Neutre (savant)', '-um', 'muzeum', 'musée'],
          ]
        }
      },
      {
        h: 'Sous-catégories du masculin',
        p: "Crucial : on distingue masculin personnel (homme), masculin animé non-personnel (animal mâle), et masculin inanimé (objet). Ça change l'accusatif singulier et les pluriels.",
        table: {
          headers: ['Sous-genre', 'Exemple', 'Acc. sg.', 'Nom. plur.'],
          rows: [
            ['Masc. personnel', 'student', 'studenta', 'studenci'],
            ['Masc. animé (animal)', 'pies (chien)', 'psa', 'psy'],
            ['Masc. inanimé', 'stół (table)', 'stół', 'stoły'],
          ]
        }
      }
    ]
  },

  {
    id: 'cas',
    title: 'Les 7 cas — vue d’ensemble',
    intro: "Le polonais utilise 7 cas qui modifient la terminaison des noms, adjectifs et pronoms. Chaque cas a une fonction principale. Voici le panorama.",
    sections: [
      {
        h: 'Les sept cas et leur rôle',
        table: {
          headers: ['Cas', 'Question', 'Usage principal'],
          rows: [
            ['Mianownik (Nominatif)', 'kto? co? (qui? quoi?)', 'Sujet de la phrase'],
            ['Dopełniacz (Génitif)', 'kogo? czego?', 'Possession, négation, après beaucoup de prépositions (bez, dla, do, od)'],
            ['Celownik (Datif)', 'komu? czemu?', 'Complément d’attribution (donner à), avec dzięki, ku'],
            ['Biernik (Accusatif)', 'kogo? co?', 'COD direct, après mieć, lubić, znać, prépositions na, w (mouvement)'],
            ['Narzędnik (Instrumental)', 'kim? czym?', 'Moyen (« avec »), profession (jestem nauczycielem), prép. z (avec), za, pod'],
            ['Miejscownik (Locatif)', 'o kim? o czym?', 'Toujours après w, na, o, przy, po (lieu fixe)'],
            ['Wołacz (Vocatif)', '—', 'Pour interpeller quelqu’un (Aniu! Marku!)'],
          ]
        }
      },
      {
        h: 'Astuce de mémorisation',
        p: "Apprends chaque cas par sa fonction et ses prépositions associées, pas seulement par sa terminaison. La majorité des erreurs viennent du choix du mauvais cas, pas de la mauvaise terminaison."
      }
    ]
  },

  {
    id: 'nominatif',
    title: 'Le Nominatif (Mianownik)',
    intro: "Le cas du sujet. C'est la forme du dictionnaire.",
    sections: [
      {
        h: 'Usage',
        p: "Sujet d'un verbe, attribut du sujet avec « to » (Janek to student → Jean est étudiant)."
      },
      {
        h: 'Pluriel : terminaisons typiques',
        table: {
          headers: ['Genre', 'Sg.', 'Plur.', 'Remarques'],
          rows: [
            ['Masc. personnel', 'student', 'studenci', 'alternance c/k, l/ł, etc.'],
            ['Masc. non-personnel', 'kot', 'koty', '-y / -i après k, g'],
            ['Féminin', 'kobieta', 'kobiety', '-y / -i'],
            ['Féminin (en -i)', 'pani', 'panie', '-e'],
            ['Neutre', 'okno', 'okna', '-a'],
          ]
        }
      }
    ]
  },

  {
    id: 'genitif',
    title: 'Le Génitif (Dopełniacz)',
    intro: "Le cas le plus polyvalent : possession, négation d'un COD, après beaucoup de prépositions et après les nombres ≥ 5.",
    sections: [
      {
        h: 'Quand l’utiliser',
        p: "1) Possession : książka Anny (le livre d'Anna). 2) Après la négation : nie mam czasu (je n'ai pas le temps). 3) Après les prépositions bez, dla, do, od, u, z (= depuis), bliżej, obok, koło. 4) Quantité : dużo wody, mało czasu. 5) Avec les nombres 5+ : pięć książek."
      },
      {
        h: 'Terminaisons singulier',
        table: {
          headers: ['Genre', 'Terminaison', 'Exemple', 'Sens'],
          rows: [
            ['Masc. animé', '-a', 'kot → kota', 'du chat'],
            ['Masc. inanimé', '-u (parfois -a)', 'dom → domu', 'de la maison'],
            ['Féminin', '-y / -i', 'kobieta → kobiety', 'de la femme'],
            ['Neutre', '-a', 'okno → okna', 'de la fenêtre'],
          ]
        }
      },
      {
        h: 'Terminaisons pluriel',
        p: "Le pluriel du génitif a souvent une « terminaison zéro » (rien après le radical), avec souvent insertion d'un e mobile : matka → matek, okno → okien."
      }
    ]
  },

  {
    id: 'datif',
    title: 'Le Datif (Celownik)',
    intro: "Le cas du complément indirect : à qui on donne, dit, achète…",
    sections: [
      {
        h: 'Quand l’utiliser',
        p: "1) Avec les verbes de donner/dire/aider : dać, powiedzieć, pomagać, mówić. 2) Avec dzięki (grâce à), ku (vers — littéraire). 3) Constructions impersonnelles : podoba mi się (ça me plaît), zimno mi (j'ai froid)."
      },
      {
        h: 'Terminaisons',
        table: {
          headers: ['Genre', 'Sg.', 'Plur.'],
          rows: [
            ['Masc.', '-owi (-u pour quelques mots)', '-om'],
            ['Féminin', '-(i)e / -y / -i', '-om'],
            ['Neutre', '-u', '-om'],
          ]
        }
      },
      {
        h: 'Exemples',
        p: "Daję bratu prezent (je donne un cadeau à mon frère). Pomagam mamie (j'aide maman). Dzięki tobie (grâce à toi)."
      }
    ]
  },

  {
    id: 'accusatif',
    title: 'L’Accusatif (Biernik)',
    intro: "Le cas du COD à la forme affirmative. Beaucoup de verbes courants l'exigent : mieć, lubić, znać, widzieć, jeść, pić, kupować…",
    sections: [
      {
        h: 'Règle clé',
        p: "1) Masc. inanimé et neutre : forme identique au nominatif. 2) Masc. animé : forme identique au génitif (kot → kota). 3) Féminin en -a : -ę (kobieta → kobietę). 4) À la négation, l'accusatif devient génitif."
      },
      {
        h: 'Tableau récap',
        table: {
          headers: ['Genre', 'Sg. (affirmatif)', 'Exemple'],
          rows: [
            ['Masc. animé', '= génitif', 'mam kota'],
            ['Masc. inanimé', '= nominatif', 'mam długopis'],
            ['Féminin -a', '-ę', 'mam kobietę / Annę'],
            ['Féminin -i / consonne', '= nominatif', 'mam noc, mam panią'],
            ['Neutre', '= nominatif', 'mam okno'],
          ]
        }
      },
      {
        h: 'Avec prépositions',
        p: "Na, w, o, po, pod, nad, przed peuvent prendre l'accusatif quand il y a mouvement vers (Idę na pocztę — je vais à la poste)."
      }
    ]
  },

  {
    id: 'instrumental',
    title: 'L’Instrumental (Narzędnik)',
    intro: "Le cas du « avec » et du « moyen ». Aussi utilisé pour exprimer la profession ou l'identité.",
    sections: [
      {
        h: 'Quand l’utiliser',
        p: "1) Pour dire « avec » : z bratem (avec mon frère). 2) Pour la profession : Jestem nauczycielem (je suis enseignant). 3) Pour le moyen : Jadę autobusem (j'y vais en bus). 4) Après pod, nad, przed, za, między (sans mouvement)."
      },
      {
        h: 'Terminaisons',
        table: {
          headers: ['Genre', 'Sg.', 'Plur.'],
          rows: [
            ['Masc.', '-em (-iem après k/g)', '-ami'],
            ['Féminin', '-ą', '-ami'],
            ['Neutre', '-em', '-ami'],
          ]
        }
      },
      {
        h: 'Piège fréquent',
        p: "Ne pas confondre : « z bratem » (avec mon frère — instrumental) vs « z brata » (de mon frère — génitif). « Z » a deux sens selon le cas qui suit."
      }
    ]
  },

  {
    id: 'locatif',
    title: 'Le Locatif (Miejscownik)',
    intro: "Le seul cas qui ne s'emploie jamais seul : toujours après une préposition (w, na, o, przy, po).",
    sections: [
      {
        h: 'Quand l’utiliser',
        p: "Localisation fixe : w Warszawie (à Varsovie), na stole (sur la table). Sujet de discussion : o tobie (à propos de toi). Après przy (à côté de) et po (après / dans, dans le sens de « parler en »)."
      },
      {
        h: 'Terminaisons (avec alternance consonantique fréquente)',
        table: {
          headers: ['Genre', 'Sg.', 'Plur.'],
          rows: [
            ['Masc. / Neutre', '-e (alternance) ou -u', '-ach'],
            ['Féminin', '-(i)e ou -y / -i', '-ach'],
          ]
        }
      },
      {
        h: 'Exemples',
        p: "w Krakowie (à Cracovie), w domu (à la maison), o pracy (à propos du travail), mówię po polsku (je parle (en) polonais)."
      }
    ]
  },

  {
    id: 'vocatif',
    title: 'Le Vocatif (Wołacz)',
    intro: "Le cas pour appeler quelqu’un — peu utilisé à l'oral familier, mais essentiel à la forme écrite et formelle.",
    sections: [
      {
        h: 'Exemples',
        table: {
          headers: ['Nominatif', 'Vocatif', 'Sens'],
          rows: [
            ['Anna', 'Anno!', 'Anna !'],
            ['Marek', 'Marku!', 'Marc !'],
            ['pan', 'panie!', 'Monsieur !'],
            ['pani', 'pani!', 'Madame !'],
            ['mama', 'mamo!', 'Maman !'],
            ['Bóg', 'Boże!', 'Mon Dieu !'],
          ]
        }
      },
      {
        h: 'Bon à savoir',
        p: "À l'oral courant, beaucoup de Polonais utilisent le nominatif à la place du vocatif pour les prénoms (« Anna, chodź tu! » au lieu de « Anno! »). Le vocatif reste obligatoire dans les lettres et les contextes formels."
      }
    ]
  },

  {
    id: 'aspect',
    title: 'L’aspect verbal : perfectif vs imperfectif',
    intro: "Concept central et étranger au français. Chaque verbe polonais existe presque toujours en paire : imperfectif (action en cours / habituelle / sans fin) et perfectif (action ponctuelle, achevée, à résultat).",
    sections: [
      {
        h: 'Comment ça marche',
        p: "L'imperfectif décrit le déroulement ; le perfectif décrit le résultat. Le perfectif n'a pas de présent — sa forme « présente » a un sens futur. Les paires se forment par préfixation, suffixation ou suppléance (verbes différents)."
      },
      {
        h: 'Paires fréquentes à connaître',
        table: {
          headers: ['Imperfectif', 'Perfectif', 'Sens'],
          rows: [
            ['robić', 'zrobić', 'faire'],
            ['pisać', 'napisać', 'écrire'],
            ['czytać', 'przeczytać', 'lire'],
            ['kupować', 'kupić', 'acheter'],
            ['mówić', 'powiedzieć', 'dire / parler'],
            ['widzieć', 'zobaczyć', 'voir'],
            ['brać', 'wziąć', 'prendre'],
            ['dawać', 'dać', 'donner'],
            ['iść', 'pójść', 'aller (à pied)'],
            ['jeść', 'zjeść', 'manger'],
          ]
        }
      },
      {
        h: 'Règle pratique',
        p: "Imperfectif : « je suis en train de… », « je fais souvent… », « je faisais… (action prolongée) ». Perfectif : « j'ai fait (et c'est fini) », « je ferai (une fois, jusqu'au bout) »."
      }
    ]
  },

  {
    id: 'conjugaison',
    title: 'Les groupes de conjugaison',
    intro: "Au présent, les verbes polonais se répartissent en 4 grands groupes selon la terminaison de la 1re personne du singulier.",
    sections: [
      {
        h: 'Les 4 groupes',
        table: {
          headers: ['Groupe', '1sg', '2sg', 'Modèle', 'Sens'],
          rows: [
            ['I (-ę / -esz)', 'piszę', 'piszesz', 'pisać', 'écrire'],
            ['II (-ę / -isz/-ysz)', 'mówię', 'mówisz', 'mówić', 'parler'],
            ['III (-am / -asz)', 'czytam', 'czytasz', 'czytać', 'lire'],
            ['IV (-em / -esz)', 'jem', 'jesz', 'jeść', 'manger'],
          ]
        }
      },
      {
        h: 'Pronoms personnels',
        p: "Les pronoms sont souvent omis (la terminaison verbale suffit). On les utilise pour insister : ja (je), ty (tu), on / ona / ono (il/elle/neutre), my (nous), wy (vous), oni / one (ils/elles, distinction selon présence d'hommes)."
      }
    ]
  },

  {
    id: 'passe',
    title: 'Le passé',
    intro: "Le passé en polonais est un casse-tête au début car il s'accorde en genre (et en nombre) avec le sujet.",
    sections: [
      {
        h: 'Formation',
        p: "Radical de l'infinitif (sans -ć / -c) + suffixe -ł- (masculin), -ła- (féminin), -ło- (neutre), -li- / -ły- (pluriel) + terminaisons personnelles."
      },
      {
        h: 'Exemple : robić (faire)',
        table: {
          headers: ['Personne', 'Masculin', 'Féminin'],
          rows: [
            ['ja', 'robiłem', 'robiłam'],
            ['ty', 'robiłeś', 'robiłaś'],
            ['on/ona/ono', 'robił / robiła / robiło', '—'],
            ['my', 'robiliśmy', 'robiłyśmy'],
            ['wy', 'robiliście', 'robiłyście'],
            ['oni / one', 'robili (avec homme)', 'robiły (sans homme)'],
          ]
        }
      },
      {
        h: 'Accent',
        p: "Au passé, l'accent reste sur la même syllabe qu'à l'infinitif : robíliśmy (et non robilíśmy)."
      }
    ]
  },

  {
    id: 'futur',
    title: 'Le futur',
    intro: "Deux façons de former le futur, selon l'aspect du verbe.",
    sections: [
      {
        h: 'Futur perfectif = présent du perfectif',
        p: "Très simple : tu conjugues le perfectif au présent et tu obtiens automatiquement le futur. Napiszę list = j'écrirai (et terminerai) une lettre."
      },
      {
        h: 'Futur imperfectif = être + infinitif ou L-participe',
        p: "On utilise « być » au futur (będę, będziesz, będzie, będziemy, będziecie, będą) + l'infinitif (forme courante moderne) ou + le L-participe au passé. « Będę pisać » = « będę pisał/pisała » = j'écrirai (action en cours / habituelle dans le futur)."
      }
    ]
  },

  {
    id: 'pronoms',
    title: 'Les pronoms personnels et leurs déclinaisons',
    intro: "Indispensable : les formes du « me/te/lui/leur » à tous les cas.",
    sections: [
      {
        h: 'Tableau complet',
        table: {
          headers: ['Cas', 'ja', 'ty', 'on', 'ona', 'my', 'wy', 'oni'],
          rows: [
            ['Nom.', 'ja', 'ty', 'on', 'ona', 'my', 'wy', 'oni / one'],
            ['Gen./Acc.', 'mnie / mię', 'ciebie / cię', 'jego / go / niego', 'jej / niej', 'nas', 'was', 'ich / nich'],
            ['Dat.', 'mnie / mi', 'tobie / ci', 'jemu / mu / niemu', 'jej / niej', 'nam', 'wam', 'im / nim'],
            ['Instr.', 'mną', 'tobą', 'nim', 'nią', 'nami', 'wami', 'nimi'],
            ['Loc.', 'mnie', 'tobie', 'nim', 'niej', 'nas', 'was', 'nich'],
          ]
        }
      },
      {
        h: 'Formes longues vs courtes',
        p: "Mnie/mi, ciebie/cię, jego/go, etc. : la forme longue se met en début de phrase ou pour l'emphase, la forme courte ailleurs. Daj mi to! (court) vs Mnie to dałeś! (long, emphase)."
      }
    ]
  },

  {
    id: 'politesse',
    title: 'La politesse : tu / vous formel (pan / pani)',
    intro: "En polonais, le vouvoiement passe par les mots « pan » (monsieur) et « pani » (madame), suivis du verbe à la 3e personne.",
    sections: [
      {
        h: 'Règles',
        p: "À une femme : Pani mówi po angielsku? — Parlez-vous anglais ? (litt. Madame parle anglais ?) À un homme : Pan jest z Polski? — Êtes-vous de Pologne ? Au pluriel : panie (mesdames), panowie (messieurs), państwo (mesdames et messieurs)."
      },
      {
        h: 'À éviter',
        p: "Ne pas dire « wy » (vous pluriel) à une seule personne pour vouvoyer — c'est ressenti comme communiste/désuet. Toujours pan/pani + verbe à la 3e personne."
      }
    ]
  },

  {
    id: 'nombres',
    title: 'Les nombres et leur grammaire',
    intro: "Les nombres polonais imposent un cas particulier au nom qui suit. Une des règles les plus surprenantes pour les étrangers.",
    sections: [
      {
        h: 'Règle d’or',
        p: "1 → nominatif singulier. 2, 3, 4 → nominatif pluriel. 5 et plus → génitif pluriel."
      },
      {
        h: 'Exemple : jabłko (pomme)',
        table: {
          headers: ['Nombre', 'Forme', 'Cas du nom'],
          rows: [
            ['1', 'jedno jabłko', 'nom. sg.'],
            ['2', 'dwa jabłka', 'nom. plur.'],
            ['3', 'trzy jabłka', 'nom. plur.'],
            ['4', 'cztery jabłka', 'nom. plur.'],
            ['5', 'pięć jabłek', 'gén. plur.'],
            ['10', 'dziesięć jabłek', 'gén. plur.'],
            ['22', 'dwadzieścia dwa jabłka', 'nom. plur. (le 2 final mande !)'],
            ['25', 'dwadzieścia pięć jabłek', 'gén. plur.'],
          ]
        }
      }
    ]
  }
];

export function getTopic(id) {
  return grammarTopics.find(t => t.id === id);
}
