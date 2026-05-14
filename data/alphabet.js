// The 32 letters of the Polish alphabet, plus the digraphs (dwuznaki).
// Each entry: letter, name in Polish, IPA, French approximation, example word + meaning.

export const alphabet = [
  { l: 'A',  name: 'a',        ipa: '/a/',     fr: 'comme « a » dans « papa »',                       ex: 'auto',     trans: 'voiture' },
  { l: 'Ą',  name: 'a z ogonkiem', ipa: '/ɔ̃/', fr: 'voyelle nasale, proche du « on » français',       ex: 'mąż',      trans: 'mari' },
  { l: 'B',  name: 'be',       ipa: '/b/',     fr: 'comme « b » français',                            ex: 'brat',     trans: 'frère' },
  { l: 'C',  name: 'ce',       ipa: '/t͡s/',   fr: 'comme « ts » dans « tsé-tsé »',                   ex: 'co',       trans: 'quoi' },
  { l: 'Ć',  name: 'cie',      ipa: '/t͡ɕ/',   fr: '« ts » mouillé, plus doux qu’en français',        ex: 'ćma',      trans: 'papillon de nuit' },
  { l: 'D',  name: 'de',       ipa: '/d/',     fr: 'comme « d » français',                            ex: 'dom',      trans: 'maison' },
  { l: 'E',  name: 'e',        ipa: '/ɛ/',     fr: 'comme « è » dans « père »',                       ex: 'ekran',    trans: 'écran' },
  { l: 'Ę',  name: 'e z ogonkiem', ipa: '/ɛ̃/', fr: 'voyelle nasale, proche du « in » français',      ex: 'gęś',      trans: 'oie' },
  { l: 'F',  name: 'ef',       ipa: '/f/',     fr: 'comme « f » français',                            ex: 'film',     trans: 'film' },
  { l: 'G',  name: 'gie',      ipa: '/ɡ/',     fr: 'toujours dur, comme dans « gare »',               ex: 'góra',     trans: 'montagne' },
  { l: 'H',  name: 'ha',       ipa: '/x/',     fr: '« h » fortement aspiré, comme la jota espagnole', ex: 'herbata',  trans: 'thé' },
  { l: 'I',  name: 'i',        ipa: '/i/',     fr: 'comme « i » français ; mouille la consonne précédente', ex: 'iść', trans: 'aller' },
  { l: 'J',  name: 'jot',      ipa: '/j/',     fr: 'comme « y » dans « yaourt »',                     ex: 'ja',       trans: 'je' },
  { l: 'K',  name: 'ka',       ipa: '/k/',     fr: 'comme « k » français',                            ex: 'kot',      trans: 'chat' },
  { l: 'L',  name: 'el',       ipa: '/l/',     fr: 'comme « l » français',                            ex: 'las',      trans: 'forêt' },
  { l: 'Ł',  name: 'eł',       ipa: '/w/',     fr: 'comme « w » anglais (« ou » très court)',         ex: 'łoś',      trans: 'élan' },
  { l: 'M',  name: 'em',       ipa: '/m/',     fr: 'comme « m » français',                            ex: 'mama',     trans: 'maman' },
  { l: 'N',  name: 'en',       ipa: '/n/',     fr: 'comme « n » français',                            ex: 'noc',      trans: 'nuit' },
  { l: 'Ń',  name: 'eń',       ipa: '/ɲ/',     fr: 'comme « gn » dans « agneau »',                    ex: 'koń',      trans: 'cheval' },
  { l: 'O',  name: 'o',        ipa: '/ɔ/',     fr: 'comme « o » ouvert dans « porte »',               ex: 'okno',     trans: 'fenêtre' },
  { l: 'Ó',  name: 'o z kreską / o kreskowane', ipa: '/u/', fr: 'se prononce comme « u » de « cou » (= U polonais)', ex: 'góra', trans: 'montagne' },
  { l: 'P',  name: 'pe',       ipa: '/p/',     fr: 'comme « p » français',                            ex: 'pies',     trans: 'chien' },
  { l: 'R',  name: 'er',       ipa: '/r/',     fr: 'r roulé apical (comme en espagnol/italien)',      ex: 'ryba',     trans: 'poisson' },
  { l: 'S',  name: 'es',       ipa: '/s/',     fr: 'comme « s » français',                            ex: 'syn',      trans: 'fils' },
  { l: 'Ś',  name: 'eś',       ipa: '/ɕ/',     fr: '« ch » très doux, mouillé',                       ex: 'śnieg',    trans: 'neige' },
  { l: 'T',  name: 'te',       ipa: '/t/',     fr: 'comme « t » français',                            ex: 'tak',      trans: 'oui' },
  { l: 'U',  name: 'u',        ipa: '/u/',     fr: 'comme « ou » dans « cou »',                       ex: 'ulica',    trans: 'rue' },
  { l: 'W',  name: 'wu',       ipa: '/v/',     fr: 'se prononce « v » français',                      ex: 'woda',     trans: 'eau' },
  { l: 'Y',  name: 'igrek',    ipa: '/ɨ/',     fr: 'voyelle centrale, entre « i » et « eu » fermé',   ex: 'syn',      trans: 'fils' },
  { l: 'Z',  name: 'zet',      ipa: '/z/',     fr: 'comme « z » français',                            ex: 'zima',     trans: 'hiver' },
  { l: 'Ź',  name: 'ziet',     ipa: '/ʑ/',     fr: '« j » de « jus » très doux, mouillé',             ex: 'źle',      trans: 'mal' },
  { l: 'Ż',  name: 'żet',      ipa: '/ʐ/',     fr: '« j » dur, comme dans « jour » mais plus tendu',  ex: 'żona',     trans: 'épouse' },
];

// Letters that don't exist natively in Polish.
export const foreignLetters = ['Q','V','X'];

// Digraphs (dwuznaki) — combinaisons à connaître absolument.
export const digraphs = [
  { d: 'CH', ipa: '/x/',  fr: 'identique à H (h aspiré, jota espagnole)',            ex: 'chleb',  trans: 'pain' },
  { d: 'CZ', ipa: '/t͡ʂ/', fr: '« tch » dur, comme « tch » dans « match »',         ex: 'czarny', trans: 'noir' },
  { d: 'SZ', ipa: '/ʂ/',  fr: '« ch » dur, comme « ch » de « chat »',                ex: 'szkoła', trans: 'école' },
  { d: 'RZ', ipa: '/ʐ/',  fr: 'identique à Ż (« j » dur)',                           ex: 'rzeka',  trans: 'rivière' },
  { d: 'DZ', ipa: '/d͡z/', fr: '« dz » prononcé d’un seul coup',                    ex: 'dzwon',  trans: 'cloche' },
  { d: 'DŹ', ipa: '/d͡ʑ/', fr: '« dz » mouillé, très doux',                         ex: 'dźwig',  trans: 'grue (engin)' },
  { d: 'DŻ', ipa: '/d͡ʐ/', fr: '« dj » dur, comme « dj » de « djembé »',            ex: 'dżem',   trans: 'confiture' },
];

// Notes-clés sur la prononciation — règles que tout débutant doit maîtriser.
export const pronunciationRules = [
  {
    title: "Accent tonique régulier",
    body: "En polonais, l'accent tombe presque toujours sur l'avant-dernière syllabe (penultième). Exceptions : certains mots savants d'origine grecque/latine (matematyka), et la 1re/2e personne du pluriel au passé.",
    examples: ['kawiarnia', 'uniwersytet', 'czekolada']
  },
  {
    title: "Voyelles nasales Ą et Ę",
    body: "Ą se prononce comme « on » français, Ę comme « in » français — mais avec quelques règles : devant b, p elles se dénasalisent en « om/em » ; en fin de mot, Ę est souvent prononcé comme un E ordinaire (relâchement).",
    examples: ['dąb (dombe)', 'gęba (guemba)', 'idę (idè)']
  },
  {
    title: "Le couple Ó / U",
    body: "Ó et U se prononcent exactement de la même façon : /u/, comme « ou » en français. La différence est purement orthographique (et historique). Ne te laisse pas piéger : ó vient souvent d'un O dans les formes parentes (góra → górski).",
    examples: ['ósmy', 'usta', 'mórz / morze']
  },
  {
    title: "Les paires douces / dures",
    body: "Le polonais distingue systématiquement les consonnes douces (ć, ś, ź, ń, dź) et leurs équivalents durs (cz, sz, ż, n, dż). Les formes douces sont notées soit avec un accent aigu, soit avec un I qui suit la consonne : ci = ć, si = ś, etc.",
    examples: ['cisza (ciche) vs czysty (propre)', 'siano (foin) vs szansa (chance)']
  },
  {
    title: "Le L et le Ł",
    body: "L (sans barre) = « l » français clair. Ł (avec barre) = « w » anglais, comme dans « water ». Attention, beaucoup de débutants confondent visuellement ces deux lettres.",
    examples: ['las (forêt) — lasse', 'łoś (élan) — wosch']
  },
  {
    title: "RZ et Ż : identiques à l'oral",
    body: "Les deux digraphes se prononcent /ʐ/, comme un « j » français très tendu. Seule l'orthographe diffère, héritée de l'histoire de la langue.",
    examples: ['rzeka (rivière)', 'żaba (grenouille)']
  },
  {
    title: "H et CH : identiques à l'oral",
    body: "H et CH se prononcent tous deux /x/, un son guttural comme la « jota » espagnole ou le « ch » allemand de « Bach ». L'orthographe seule diffère.",
    examples: ['herbata (thé)', 'chleb (pain)']
  },
  {
    title: "Dévoisement final et assimilation",
    body: "En fin de mot, les consonnes voisées deviennent sourdes : chleb se prononce « chlep », Bóg se prononce « buk ». Dans un groupe, les consonnes s'alignent les unes sur les autres (assimilation régressive).",
    examples: ['chleb → chlep', 'Bóg → buk', 'prośba → próźba']
  },
];
