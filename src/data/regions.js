/**
 * Régions compétitives et viviers de noms.
 *
 * Les régions ne sont pas cosmétiques : elles portent une force de scène,
 * une densité de talent et un niveau de structure qui pèsent sur la
 * génération des joueurs et sur les opportunités (§44 : naître dans une
 * petite région est objectivement plus dur).
 */

export const REGIONS = [
  {
    id: 'weu',
    label: 'Europe de l’Ouest',
    short: 'WEU',
    strength: 0.92,
    talentDensity: 0.9,
    infrastructure: 0.9,
    countries: ['France', 'Allemagne', 'Belgique', 'Pays-Bas', 'Espagne', 'Portugal', 'Royaume-Uni', 'Italie'],
    firstNames: ['Lucas', 'Théo', 'Nils', 'Mathis', 'Jonas', 'Enzo', 'Adrien', 'Killian', 'Léo', 'Rayan', 'Marc', 'Diego', 'Tom', 'Sander', 'Louis', 'Noah', 'Elias', 'Gabriel', 'Hugo', 'Milan'],
    lastNames: ['Delaunay', 'Verhoeven', 'Schneider', 'Moreau', 'Fischer', 'Garrido', 'Bakker', 'Renard', 'Costa', 'Lambert', 'Rossi', 'Vidal', 'Hoffmann', 'Marchand', 'Silva', 'Dumont', 'Keller', 'Bianchi', 'Leroy', 'Peeters'],
  },
  {
    id: 'neu',
    label: 'Europe du Nord',
    short: 'NEU',
    strength: 0.88,
    talentDensity: 0.82,
    infrastructure: 0.94,
    countries: ['Suède', 'Danemark', 'Finlande', 'Norvège', 'Islande'],
    firstNames: ['Emil', 'Oskar', 'Mikkel', 'Aleksi', 'Viktor', 'Rasmus', 'Elias', 'Joona', 'Anton', 'Kasper', 'Nikolaj', 'Frej', 'Sten', 'Ivar', 'Alvar'],
    lastNames: ['Lindqvist', 'Sørensen', 'Virtanen', 'Berg', 'Holm', 'Nyström', 'Dahl', 'Koskinen', 'Aalto', 'Munch', 'Sandberg', 'Ek', 'Halvorsen', 'Rask', 'Lund'],
  },
  {
    id: 'eeu',
    label: 'Europe de l’Est',
    short: 'EEU',
    strength: 0.85,
    talentDensity: 0.95,
    infrastructure: 0.58,
    countries: ['Pologne', 'Ukraine', 'Roumanie', 'Tchéquie', 'Serbie', 'Bulgarie', 'Hongrie'],
    firstNames: ['Kamil', 'Bartek', 'Dmytro', 'Andrei', 'Nikola', 'Marek', 'Radu', 'Wiktor', 'Oleh', 'Milos', 'Tomasz', 'Ivan', 'Pavel', 'Stefan', 'Jakub'],
    lastNames: ['Kowalczyk', 'Bondarenko', 'Popescu', 'Novák', 'Jovanović', 'Zieliński', 'Kravets', 'Marinov', 'Dvořák', 'Wójcik', 'Petrov', 'Horvath', 'Szabó', 'Lisowski', 'Ilić'],
  },
  {
    id: 'na',
    label: 'Amérique du Nord',
    short: 'NA',
    strength: 0.87,
    talentDensity: 0.75,
    infrastructure: 0.96,
    countries: ['États-Unis', 'Canada', 'Mexique'],
    firstNames: ['Tyler', 'Jordan', 'Marcus', 'Devon', 'Ethan', 'Cole', 'Xavier', 'Brandon', 'Aaron', 'Elijah', 'Mason', 'Reid', 'Damien', 'Isaiah', 'Wesley', 'Andres'],
    lastNames: ['Whitaker', 'Nguyen', 'Carter', 'Ramirez', 'Brooks', 'Sullivan', 'Park', 'Delgado', 'Hayes', 'Fontaine', 'Okafor', 'Bennett', 'Alvarez', 'Reyes', 'Sinclair'],
  },
  {
    id: 'sa',
    label: 'Amérique du Sud',
    short: 'SA',
    strength: 0.78,
    talentDensity: 0.88,
    infrastructure: 0.55,
    countries: ['Brésil', 'Argentine', 'Chili', 'Colombie', 'Pérou'],
    firstNames: ['Gabriel', 'Matheus', 'Thiago', 'Rodrigo', 'Felipe', 'Santiago', 'Bruno', 'Caio', 'Lucas', 'Emiliano', 'Vinícius', 'Joaquín', 'Renan', 'Iker'],
    lastNames: ['Almeida', 'Fernández', 'Ribeiro', 'Gutiérrez', 'Cardoso', 'Vargas', 'Moraes', 'Quiroga', 'Pinheiro', 'Ferreira', 'Sosa', 'Barbosa', 'Mendoza', 'Cabral'],
  },
  {
    id: 'ea',
    label: 'Asie de l’Est',
    short: 'EA',
    strength: 0.96,
    talentDensity: 0.98,
    infrastructure: 0.93,
    countries: ['Corée du Sud', 'Chine', 'Japon', 'Taïwan'],
    firstNames: ['Jihoon', 'Minseok', 'Haoran', 'Yuto', 'Seungmin', 'Zhen', 'Kenta', 'Junhao', 'Daeun', 'Ryo', 'Chenglei', 'Sora', 'Youngjae', 'Weiming'],
    lastNames: ['Kim', 'Park', 'Zhang', 'Tanaka', 'Choi', 'Wang', 'Sato', 'Liu', 'Jung', 'Chen', 'Yamamoto', 'Huang', 'Lee', 'Xu'],
  },
  {
    id: 'sea',
    label: 'Asie du Sud-Est',
    short: 'SEA',
    strength: 0.74,
    talentDensity: 0.86,
    infrastructure: 0.6,
    countries: ['Philippines', 'Indonésie', 'Vietnam', 'Thaïlande', 'Malaisie', 'Singapour'],
    firstNames: ['Rizal', 'Bayu', 'Minh', 'Somchai', 'Aiman', 'Duy', 'Arif', 'Kiet', 'Rendra', 'Jomar', 'Wisnu', 'Chai', 'Fadil'],
    lastNames: ['Santos', 'Wijaya', 'Nguyen', 'Chaiyaporn', 'Rahman', 'Tran', 'Pratama', 'Lim', 'Bautista', 'Setiawan', 'Phan', 'Tan'],
  },
  {
    id: 'oce',
    label: 'Océanie',
    short: 'OCE',
    strength: 0.62,
    talentDensity: 0.6,
    infrastructure: 0.7,
    countries: ['Australie', 'Nouvelle-Zélande'],
    firstNames: ['Riley', 'Callum', 'Jesse', 'Hayden', 'Lachlan', 'Nate', 'Toby', 'Flynn', 'Cody'],
    lastNames: ['Whitfield', 'Marsh', 'Doyle', 'Kingsley', 'Palmer', 'Rhodes', 'Vaughan', 'Hale', 'Crawford'],
  },
];

export const REGIONS_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

/** Fragments de pseudos : combinés, ils donnent des dizaines de milliers de tags. */
export const NICK_PREFIXES = [
  'Nex', 'Zar', 'Kryo', 'Vex', 'Sol', 'Ashe', 'Riven', 'Onyx', 'Halo', 'Kane',
  'Volt', 'Nyx', 'Ryu', 'Sable', 'Quill', 'Drex', 'Lume', 'Fenn', 'Karo', 'Zephy',
  'Mako', 'Nova', 'Ghost', 'Prism', 'Vail', 'Odin', 'Trace', 'Sear', 'Wisp', 'Cobalt',
  'Juno', 'Rune', 'Skarn', 'Tempo', 'Vero', 'Yuki', 'Zen', 'Arc', 'Brix', 'Cinder',
];

export const NICK_SUFFIXES = [
  '', '', '', '', 'ka', 'os', 'ix', 'en', 'ar', 'yn', 'oo', 'is', 'ax', 'er', 'ie',
];

export const NICK_TAGS = [
  '', '', '', '', '', 'x', 'z', '1', '7', '99', 'tv', 'gg', '_', 'y',
];
