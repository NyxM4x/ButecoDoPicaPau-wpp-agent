/**
 * Lo que dice la maqueta (`/menu/maqueta`), en un solo lugar: las tres
 * opciones de la bienvenida, platos, bebidas, extras, precios y combos de
 * cumpleaños. Todavía no está en el POS. Los precios y lo que trae cada combo
 * salen del volante del cliente.
 */

/** Las secciones que puede tener una opción. */
export type MockupSectionId = 'tablitas' | 'compartir' | 'bebidas' | 'extras' | 'reserva' | 'cumpleanos';

/** El nombre de cada sección en la barra fija: corto, para que quepan en un celular. */
export const SECTION_TABS: Readonly<Record<MockupSectionId, string>> = {
  tablitas: 'Tablitas',
  compartir: 'Tablas',
  bebidas: 'Bebidas',
  extras: 'Extras',
  reserva: 'Reserva',
  cumpleanos: 'Cumpleaños',
};

export type MockupModeId = 'para-1-y-2' | 'para-compartir' | 'reservar';

/**
 * Una de las tres opciones de la bienvenida. Cada una abre SOLO lo suyo: así
 * nadie recorre la carta entera buscando lo que vino a pedir.
 */
export interface MockupMode {
  /** Va en la dirección: `/menu?ver=para-compartir`. El bot puede mandar el enlace directo. */
  id: MockupModeId;
  title: string;
  /** La línea de color debajo del título, en la bienvenida. */
  subtitle: string;
  /** Debajo del título, ya adentro. */
  description: string;
  sections: readonly MockupSectionId[];
}

export const MODES: readonly MockupMode[] = [
  {
    id: 'para-1-y-2',
    title: 'Tablitas para 1 y 2',
    subtitle: 'Una carne a elección, con arroz y plátano',
    description: 'Una carne a elección, con arroz y plátano. Suma tu bebida y algún extra.',
    sections: ['tablitas', 'bebidas', 'extras'],
  },
  {
    id: 'para-compartir',
    title: 'Para compartir',
    // Como lo pidió el usuario (2026-10-14). OJO: el volante dice otra cosa
    // (Zeus: 2 carnes para 2 a 3 personas; la XL: 7 carnes). Falta que lo confirme.
    subtitle: 'Para más de 3 personas, entre 3 y 8 carnes para elegir',
    description: 'Para más de 3 personas, entre 3 y 8 carnes para elegir. Suma bebidas y extras.',
    sections: ['compartir', 'bebidas', 'extras'],
  },
  {
    id: 'reservar',
    title: 'Reservar mesa',
    subtitle: 'Y combos para tu cumpleaños',
    description: 'Elige día, hora y cuántos son. Te confirmamos por WhatsApp.',
    sections: ['reserva', 'cumpleanos'],
  },
];

export function modeById(id: string | null): MockupMode | null {
  return MODES.find((mode) => mode.id === id) ?? null;
}

export interface MockupItem {
  id: string;
  name: string;
  /** Debajo del nombre: «Solo sábados y domingos». */
  note?: string;
  /** Una sola = sin elegir tamaño (su nombre puede ser `null`). */
  sizes: readonly { label: string | null; price: number }[];
}

/** Las bebidas del volante. Del vino y el copo sujo no dice la medida. */
export const DRINKS: readonly MockupItem[] = [
  { id: 'limonada', name: 'Limonada', sizes: [{ label: '1 L', price: 15 }, { label: '2 L', price: 25 }] },
  { id: 'maracuya', name: 'Maracuyá', sizes: [{ label: '1 L', price: 15 }, { label: '2 L', price: 30 }] },
  { id: 'copuazu', name: 'Copuazú', sizes: [{ label: '1 L', price: 25 }, { label: '2 L', price: 35 }] },
  { id: 'coca-cola', name: 'Coca-Cola', sizes: [{ label: '2 L', price: 25 }] },
  { id: 'vino', name: 'Vino', sizes: [{ label: null, price: 60 }] },
  { id: 'copo-sujo', name: 'Copo sujo', sizes: [{ label: null, price: 25 }] },
];

/** El único extra del volante. Falta la lista del local (porciones, salsas…). */
export const EXTRAS: readonly MockupItem[] = [
  { id: 'sopa-de-mani', name: 'Sopa de maní', note: 'Solo sábados y domingos', sizes: [{ label: null, price: 15 }] },
];

/** Tablita: para 1 y para 2. El biffe no está en el volante: sin precio. */
export const TABLITA_PRICES: Readonly<Record<string, readonly [number, number] | null>> = {
  biffe: null,
  'chicharron-de-pescado': [75, 120],
  'costilla-res': [75, 120],
};

export interface ShareBoard {
  id: string;
  name: string;
  meats: number;
  people: string;
  price: number;
}

/**
 * Las tablas para compartir que caben en la tabla de base (hasta 3 carnes).
 * La de los Dioses (4), la Super Tabla L (5) y la XL (7) piden otra base.
 */
export const SHARE_BOARDS: readonly ShareBoard[] = [
  { id: 'zeus', name: 'Tabla de Zeus', meats: 2, people: 'Para 2 a 3 personas', price: 175 },
  { id: 'hercules', name: 'Tabla Hércules', meats: 3, people: 'Para 3 a 4 personas', price: 250 },
  { id: 'spartacus', name: 'Tabla Spartacus', meats: 3, people: 'Para 4 a 5 personas', price: 350 },
];

export interface BirthdayCombo {
  id: string;
  name: string;
  /** Con qué tablas va. */
  boards: string;
  people: string;
  includes: readonly string[];
  /** Lo que queda escrito en la nota de la reserva. */
  note: string;
}

/** El combo cumpleañero del volante: no se compra en el carrito, se reserva. */
export const BIRTHDAY_COMBOS: readonly BirthdayCombo[] = [
  {
    id: 'grande',
    name: 'Combo cumpleañero grande',
    boards: 'Con Super Tabla L o XL',
    people: 'De 15 a 30 personas',
    includes: [
      'Video editado',
      'Fotos con los invitados',
      'Cumpleaños feliz',
      'Vela lluvia de oro',
      'Tablita cumpleañera',
      'Banda',
      'Vino para los invitados',
    ],
    note: 'Es un cumpleaños: combo con Super Tabla L o XL.',
  },
  {
    id: 'mediano',
    name: 'Combo cumpleañero mediano',
    boards: 'Con una tablita mixta mediana: Dioses, Spartacus, Hércules o Zeus',
    people: 'De 2 a 8 personas',
    includes: ['Cumpleaños feliz', 'Vela lluvia de oro', 'Jarra de limonada de 2 L', 'Fotos'],
    note: 'Es un cumpleaños: combo con tablita mixta mediana.',
  },
];

/** La condición del volante, que vale para los dos. */
export const BIRTHDAY_CONDITION = 'El festejado presenta su carnet el día del evento.';
