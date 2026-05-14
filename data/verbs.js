// Conjugation of the most essential Polish verbs.
// Present tense + past tense (masc / fem) for each, plus aspect partner where relevant.

export const verbs = [
  {
    id: 'byc',
    inf: 'być',
    fr: 'être',
    aspect: 'imperf.',
    partner: null,
    group: 'irrégulier',
    present: {
      ja: 'jestem', ty: 'jesteś', on: 'jest', my: 'jesteśmy', wy: 'jesteście', oni: 'są'
    },
    past: {
      m: { ja: 'byłem', ty: 'byłeś', on: 'był', my: 'byliśmy', wy: 'byliście', oni: 'byli' },
      f: { ja: 'byłam', ty: 'byłaś', on: 'była', my: 'byłyśmy', wy: 'byłyście', oni: 'były' },
    },
    future: { ja: 'będę', ty: 'będziesz', on: 'będzie', my: 'będziemy', wy: 'będziecie', oni: 'będą' },
    examples: [
      { pl: 'Jestem z Polski.', fr: 'Je viens de Pologne.' },
      { pl: 'On jest moim bratem.', fr: 'C’est mon frère.' },
      { pl: 'Wczoraj byłem chory.', fr: 'Hier j’étais malade.' },
    ]
  },
  {
    id: 'miec',
    inf: 'mieć',
    fr: 'avoir',
    aspect: 'imperf.',
    partner: null,
    group: 'III (-am/-asz)',
    present: {
      ja: 'mam', ty: 'masz', on: 'ma', my: 'mamy', wy: 'macie', oni: 'mają'
    },
    past: {
      m: { ja: 'miałem', ty: 'miałeś', on: 'miał', my: 'mieliśmy', wy: 'mieliście', oni: 'mieli' },
      f: { ja: 'miałam', ty: 'miałaś', on: 'miała', my: 'miałyśmy', wy: 'miałyście', oni: 'miały' },
    },
    future: { ja: 'będę miał/miała', ty: 'będziesz miał/miała', on: 'będzie miał/miała', my: 'będziemy mieli/miały', wy: 'będziecie mieli/miały', oni: 'będą mieli/miały' },
    examples: [
      { pl: 'Mam dwa koty.', fr: 'J’ai deux chats.' },
      { pl: 'Czy masz czas?', fr: 'As-tu le temps ?' },
      { pl: 'Wczoraj miałam dużo pracy.', fr: 'Hier j’avais beaucoup de travail.' },
    ]
  },
  {
    id: 'robic',
    inf: 'robić',
    fr: 'faire',
    aspect: 'imperf.',
    partner: 'zrobić',
    group: 'II (-ę/-isz)',
    present: { ja: 'robię', ty: 'robisz', on: 'robi', my: 'robimy', wy: 'robicie', oni: 'robią' },
    past: {
      m: { ja: 'robiłem', ty: 'robiłeś', on: 'robił', my: 'robiliśmy', wy: 'robiliście', oni: 'robili' },
      f: { ja: 'robiłam', ty: 'robiłaś', on: 'robiła', my: 'robiłyśmy', wy: 'robiłyście', oni: 'robiły' },
    },
    future: { ja: 'będę robić', ty: 'będziesz robić', on: 'będzie robić', my: 'będziemy robić', wy: 'będziecie robić', oni: 'będą robić' },
    examples: [
      { pl: 'Co robisz?', fr: 'Que fais-tu ?' },
      { pl: 'Robię obiad.', fr: 'Je prépare le déjeuner.' },
      { pl: 'Wczoraj nic nie robiłem.', fr: 'Hier je n’ai rien fait.' },
    ]
  },
  {
    id: 'isc',
    inf: 'iść',
    fr: 'aller (à pied), marcher',
    aspect: 'imperf. déterminé',
    partner: 'pójść',
    group: 'I (-ę/-esz)',
    present: { ja: 'idę', ty: 'idziesz', on: 'idzie', my: 'idziemy', wy: 'idziecie', oni: 'idą' },
    past: {
      m: { ja: 'szedłem', ty: 'szedłeś', on: 'szedł', my: 'szliśmy', wy: 'szliście', oni: 'szli' },
      f: { ja: 'szłam', ty: 'szłaś', on: 'szła', my: 'szłyśmy', wy: 'szłyście', oni: 'szły' },
    },
    future: { ja: 'będę szedł/szła', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Idę do szkoły.', fr: 'Je vais à l’école.' },
      { pl: 'Idziemy na spacer.', fr: 'On va se promener.' },
      { pl: 'Wczoraj szłam piechotą.', fr: 'Hier je suis allée à pied.' },
    ]
  },
  {
    id: 'jechac',
    inf: 'jechać',
    fr: 'aller (en véhicule), rouler',
    aspect: 'imperf. déterminé',
    partner: 'pojechać',
    group: 'I',
    present: { ja: 'jadę', ty: 'jedziesz', on: 'jedzie', my: 'jedziemy', wy: 'jedziecie', oni: 'jadą' },
    past: {
      m: { ja: 'jechałem', ty: 'jechałeś', on: 'jechał', my: 'jechaliśmy', wy: 'jechaliście', oni: 'jechali' },
      f: { ja: 'jechałam', ty: 'jechałaś', on: 'jechała', my: 'jechałyśmy', wy: 'jechałyście', oni: 'jechały' },
    },
    future: { ja: 'będę jechać', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Jadę do Warszawy.', fr: 'Je vais à Varsovie.' },
      { pl: 'Jedziemy autobusem.', fr: 'On y va en bus.' },
    ]
  },
  {
    id: 'moc',
    inf: 'móc',
    fr: 'pouvoir (être capable de)',
    aspect: 'imperf.',
    partner: null,
    group: 'I irrégulier',
    present: { ja: 'mogę', ty: 'możesz', on: 'może', my: 'możemy', wy: 'możecie', oni: 'mogą' },
    past: {
      m: { ja: 'mogłem', ty: 'mogłeś', on: 'mógł', my: 'mogliśmy', wy: 'mogliście', oni: 'mogli' },
      f: { ja: 'mogłam', ty: 'mogłaś', on: 'mogła', my: 'mogłyśmy', wy: 'mogłyście', oni: 'mogły' },
    },
    future: { ja: 'będę mógł/mogła', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Czy mogę zapłacić kartą?', fr: 'Puis-je payer par carte ?' },
      { pl: 'Nie możemy iść.', fr: 'Nous ne pouvons pas y aller.' },
    ]
  },
  {
    id: 'chciec',
    inf: 'chcieć',
    fr: 'vouloir',
    aspect: 'imperf.',
    partner: null,
    group: 'I irrégulier',
    present: { ja: 'chcę', ty: 'chcesz', on: 'chce', my: 'chcemy', wy: 'chcecie', oni: 'chcą' },
    past: {
      m: { ja: 'chciałem', ty: 'chciałeś', on: 'chciał', my: 'chcieliśmy', wy: 'chcieliście', oni: 'chcieli' },
      f: { ja: 'chciałam', ty: 'chciałaś', on: 'chciała', my: 'chciałyśmy', wy: 'chciałyście', oni: 'chciały' },
    },
    future: { ja: 'będę chciał/chciała', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Chcę kawę.', fr: 'Je veux un café.' },
      { pl: 'Co chciałbyś zrobić?', fr: 'Qu’aimerais-tu faire ?' },
    ]
  },
  {
    id: 'musiec',
    inf: 'musieć',
    fr: 'devoir',
    aspect: 'imperf.',
    partner: null,
    group: 'II',
    present: { ja: 'muszę', ty: 'musisz', on: 'musi', my: 'musimy', wy: 'musicie', oni: 'muszą' },
    past: {
      m: { ja: 'musiałem', ty: 'musiałeś', on: 'musiał', my: 'musieliśmy', wy: 'musieliście', oni: 'musieli' },
      f: { ja: 'musiałam', ty: 'musiałaś', on: 'musiała', my: 'musiałyśmy', wy: 'musiałyście', oni: 'musiały' },
    },
    future: { ja: '…', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Muszę iść.', fr: 'Je dois y aller.' },
      { pl: 'Musisz spać.', fr: 'Tu dois dormir.' },
    ]
  },
  {
    id: 'mowic',
    inf: 'mówić',
    fr: 'parler, dire (imperf.)',
    aspect: 'imperf.',
    partner: 'powiedzieć',
    group: 'II',
    present: { ja: 'mówię', ty: 'mówisz', on: 'mówi', my: 'mówimy', wy: 'mówicie', oni: 'mówią' },
    past: {
      m: { ja: 'mówiłem', ty: 'mówiłeś', on: 'mówił', my: 'mówiliśmy', wy: 'mówiliście', oni: 'mówili' },
      f: { ja: 'mówiłam', ty: 'mówiłaś', on: 'mówiła', my: 'mówiłyśmy', wy: 'mówiłyście', oni: 'mówiły' },
    },
    future: { ja: 'będę mówić', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Mówię po polsku.', fr: 'Je parle polonais.' },
      { pl: 'O czym mówisz?', fr: 'De quoi parles-tu ?' },
    ]
  },
  {
    id: 'wiedziec',
    inf: 'wiedzieć',
    fr: 'savoir (un fait)',
    aspect: 'imperf.',
    partner: null,
    group: 'IV (-em/-esz)',
    present: { ja: 'wiem', ty: 'wiesz', on: 'wie', my: 'wiemy', wy: 'wiecie', oni: 'wiedzą' },
    past: {
      m: { ja: 'wiedziałem', ty: 'wiedziałeś', on: 'wiedział', my: 'wiedzieliśmy', wy: 'wiedzieliście', oni: 'wiedzieli' },
      f: { ja: 'wiedziałam', ty: 'wiedziałaś', on: 'wiedziała', my: 'wiedziałyśmy', wy: 'wiedziałyście', oni: 'wiedziały' },
    },
    future: { ja: 'będę wiedział/wiedziała', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Wiem, że to prawda.', fr: 'Je sais que c’est vrai.' },
      { pl: 'Nie wiem.', fr: 'Je ne sais pas.' },
    ]
  },
  {
    id: 'znac',
    inf: 'znać',
    fr: 'connaître (qqn/qqch)',
    aspect: 'imperf.',
    partner: null,
    group: 'III',
    present: { ja: 'znam', ty: 'znasz', on: 'zna', my: 'znamy', wy: 'znacie', oni: 'znają' },
    past: {
      m: { ja: 'znałem', ty: 'znałeś', on: 'znał', my: 'znaliśmy', wy: 'znaliście', oni: 'znali' },
      f: { ja: 'znałam', ty: 'znałaś', on: 'znała', my: 'znałyśmy', wy: 'znałyście', oni: 'znały' },
    },
    future: { ja: 'będę znał/znała', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Znam tę piosenkę.', fr: 'Je connais cette chanson.' },
      { pl: 'Znamy się od dawna.', fr: 'On se connaît depuis longtemps.' },
    ]
  },
  {
    id: 'czytac',
    inf: 'czytać',
    fr: 'lire',
    aspect: 'imperf.',
    partner: 'przeczytać',
    group: 'III',
    present: { ja: 'czytam', ty: 'czytasz', on: 'czyta', my: 'czytamy', wy: 'czytacie', oni: 'czytają' },
    past: {
      m: { ja: 'czytałem', ty: 'czytałeś', on: 'czytał', my: 'czytaliśmy', wy: 'czytaliście', oni: 'czytali' },
      f: { ja: 'czytałam', ty: 'czytałaś', on: 'czytała', my: 'czytałyśmy', wy: 'czytałyście', oni: 'czytały' },
    },
    future: { ja: 'będę czytać', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Czytam książkę.', fr: 'Je lis un livre.' },
      { pl: 'Czytaliśmy całą noc.', fr: 'Nous avons lu toute la nuit.' },
    ]
  },
  {
    id: 'pisac',
    inf: 'pisać',
    fr: 'écrire',
    aspect: 'imperf.',
    partner: 'napisać',
    group: 'I',
    present: { ja: 'piszę', ty: 'piszesz', on: 'pisze', my: 'piszemy', wy: 'piszecie', oni: 'piszą' },
    past: {
      m: { ja: 'pisałem', ty: 'pisałeś', on: 'pisał', my: 'pisaliśmy', wy: 'pisaliście', oni: 'pisali' },
      f: { ja: 'pisałam', ty: 'pisałaś', on: 'pisała', my: 'pisałyśmy', wy: 'pisałyście', oni: 'pisały' },
    },
    future: { ja: 'będę pisać', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Piszę list.', fr: 'J’écris une lettre.' },
      { pl: 'Napisałem już ten e-mail.', fr: 'J’ai déjà écrit ce mail.' },
    ]
  },
  {
    id: 'jesc',
    inf: 'jeść',
    fr: 'manger',
    aspect: 'imperf.',
    partner: 'zjeść',
    group: 'IV (-em/-esz)',
    present: { ja: 'jem', ty: 'jesz', on: 'je', my: 'jemy', wy: 'jecie', oni: 'jedzą' },
    past: {
      m: { ja: 'jadłem', ty: 'jadłeś', on: 'jadł', my: 'jedliśmy', wy: 'jedliście', oni: 'jedli' },
      f: { ja: 'jadłam', ty: 'jadłaś', on: 'jadła', my: 'jadłyśmy', wy: 'jadłyście', oni: 'jadły' },
    },
    future: { ja: 'będę jeść', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Co jesz?', fr: 'Qu’est-ce que tu manges ?' },
      { pl: 'Jemy obiad.', fr: 'Nous déjeunons.' },
    ]
  },
  {
    id: 'pic',
    inf: 'pić',
    fr: 'boire',
    aspect: 'imperf.',
    partner: 'wypić',
    group: 'I irrégulier',
    present: { ja: 'piję', ty: 'pijesz', on: 'pije', my: 'pijemy', wy: 'pijecie', oni: 'piją' },
    past: {
      m: { ja: 'piłem', ty: 'piłeś', on: 'pił', my: 'piliśmy', wy: 'piliście', oni: 'pili' },
      f: { ja: 'piłam', ty: 'piłaś', on: 'piła', my: 'piłyśmy', wy: 'piłyście', oni: 'piły' },
    },
    future: { ja: 'będę pić', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Pijesz kawę?', fr: 'Tu bois du café ?' },
      { pl: 'Piję wodę.', fr: 'Je bois de l’eau.' },
    ]
  },
  {
    id: 'spac',
    inf: 'spać',
    fr: 'dormir',
    aspect: 'imperf.',
    partner: 'pospać',
    group: 'II',
    present: { ja: 'śpię', ty: 'śpisz', on: 'śpi', my: 'śpimy', wy: 'śpicie', oni: 'śpią' },
    past: {
      m: { ja: 'spałem', ty: 'spałeś', on: 'spał', my: 'spaliśmy', wy: 'spaliście', oni: 'spali' },
      f: { ja: 'spałam', ty: 'spałaś', on: 'spała', my: 'spałyśmy', wy: 'spałyście', oni: 'spały' },
    },
    future: { ja: 'będę spać', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Śpię osiem godzin.', fr: 'Je dors huit heures.' },
      { pl: 'Dobranoc, śpij dobrze.', fr: 'Bonne nuit, dors bien.' },
    ]
  },
  {
    id: 'kupowac',
    inf: 'kupować / kupić',
    fr: 'acheter',
    aspect: 'imperf. / perf.',
    partner: 'kupić',
    group: 'I / II',
    present: { ja: 'kupuję', ty: 'kupujesz', on: 'kupuje', my: 'kupujemy', wy: 'kupujecie', oni: 'kupują' },
    past: {
      m: { ja: 'kupowałem', ty: 'kupowałeś', on: 'kupował', my: 'kupowaliśmy', wy: 'kupowaliście', oni: 'kupowali' },
      f: { ja: 'kupowałam', ty: 'kupowałaś', on: 'kupowała', my: 'kupowałyśmy', wy: 'kupowałyście', oni: 'kupowały' },
    },
    future: { ja: 'kupię (perf.)', ty: 'kupisz', on: 'kupi', my: 'kupimy', wy: 'kupicie', oni: 'kupią' },
    examples: [
      { pl: 'Kupuję chleb.', fr: 'J’achète du pain.' },
      { pl: 'Wczoraj kupiłem nowy telefon.', fr: 'Hier j’ai acheté un nouveau téléphone.' },
    ]
  },
  {
    id: 'lubic',
    inf: 'lubić',
    fr: 'aimer bien',
    aspect: 'imperf.',
    partner: null,
    group: 'II',
    present: { ja: 'lubię', ty: 'lubisz', on: 'lubi', my: 'lubimy', wy: 'lubicie', oni: 'lubią' },
    past: {
      m: { ja: 'lubiłem', ty: 'lubiłeś', on: 'lubił', my: 'lubiliśmy', wy: 'lubiliście', oni: 'lubili' },
      f: { ja: 'lubiłam', ty: 'lubiłaś', on: 'lubiła', my: 'lubiłyśmy', wy: 'lubiłyście', oni: 'lubiły' },
    },
    future: { ja: 'będę lubić', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Lubię muzykę klasyczną.', fr: 'J’aime la musique classique.' },
      { pl: 'Nie lubię się spóźniać.', fr: 'Je n’aime pas être en retard.' },
    ]
  },
  {
    id: 'rozumiec',
    inf: 'rozumieć',
    fr: 'comprendre',
    aspect: 'imperf.',
    partner: 'zrozumieć',
    group: 'IV',
    present: { ja: 'rozumiem', ty: 'rozumiesz', on: 'rozumie', my: 'rozumiemy', wy: 'rozumiecie', oni: 'rozumieją' },
    past: {
      m: { ja: 'rozumiałem', ty: 'rozumiałeś', on: 'rozumiał', my: 'rozumieliśmy', wy: 'rozumieliście', oni: 'rozumieli' },
      f: { ja: 'rozumiałam', ty: 'rozumiałaś', on: 'rozumiała', my: 'rozumiałyśmy', wy: 'rozumiałyście', oni: 'rozumiały' },
    },
    future: { ja: 'będę rozumieć', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Rozumiem cię.', fr: 'Je te comprends.' },
      { pl: 'Nie rozumiem tego słowa.', fr: 'Je ne comprends pas ce mot.' },
    ]
  },
  {
    id: 'pracowac',
    inf: 'pracować',
    fr: 'travailler',
    aspect: 'imperf.',
    partner: null,
    group: 'I',
    present: { ja: 'pracuję', ty: 'pracujesz', on: 'pracuje', my: 'pracujemy', wy: 'pracujecie', oni: 'pracują' },
    past: {
      m: { ja: 'pracowałem', ty: 'pracowałeś', on: 'pracował', my: 'pracowaliśmy', wy: 'pracowaliście', oni: 'pracowali' },
      f: { ja: 'pracowałam', ty: 'pracowałaś', on: 'pracowała', my: 'pracowałyśmy', wy: 'pracowałyście', oni: 'pracowały' },
    },
    future: { ja: 'będę pracować', ty: '…', on: '…', my: '…', wy: '…', oni: '…' },
    examples: [
      { pl: 'Pracuję w biurze.', fr: 'Je travaille au bureau.' },
      { pl: 'Gdzie pracujesz?', fr: 'Où travailles-tu ?' },
    ]
  },
];

export function getVerb(id) {
  return verbs.find(v => v.id === id);
}
