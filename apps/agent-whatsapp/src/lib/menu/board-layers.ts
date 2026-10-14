/**
 * La tabla por capas — módulo PURO (2026-10-13, prototipo).
 *
 * Todas las tablas se sirven sobre la misma tabla de madera con arroz y
 * plátano. En vez de una foto por cada combinación de carnes, la carta pinta
 * esa tabla UNA vez y encima, en su hueco, cada carne recortada:
 *
 *   tablita            1 carne       en la punta ancha de la tabla
 *   tablita para 2     1 carne       la misma, con más porción
 *   tabla de 2 carnes  2 carnes      atrás a la izquierda y adelante del plátano
 *   tabla de 3 carnes  3 carnes      además, una delante del arroz
 *
 * Con siete carnes y tablas de 1, 2 y 3 son cientos de combinaciones: con
 * capas son ocho fotos (la base y una por carne).
 *
 * ── Cómo se ajusta ──────────────────────────────────────────────────────────
 *
 * Cada hueco son tres números, en % de la base RECORTADA (`capas/tabla.webp`,
 * la que deja `scripts/prepare-board-layers.mjs`): dónde va el centro de la
 * carne (`x`), dónde se apoya su borde de abajo (`y`) y qué tan ancha es
 * (`w`). El alto sale solo, de la forma de cada carne. Se corrige a ojo en
 * `/menu/maqueta`, y `board-layers.test.ts` avisa si una carne se sale del
 * cuadro.
 *
 * Lo que está más abajo en la foto está más cerca de quien mira, así que se
 * pinta encima: el orden de las capas sale de `y`.
 */

/** Una imagen ya recortada, con su tamaño real en píxeles. */
export interface BoardImage {
  src: string;
  width: number;
  height: number;
}

/** Una carne que se puede poner sobre la tabla. */
export interface BoardMeat extends BoardImage {
  id: string;
  name: string;
}

/** Un hueco de la tabla. Todo en % de la base. */
export interface MeatSlot {
  /** El centro de la carne, desde la izquierda: % del ancho de la base. */
  x: number;
  /** Dónde se apoya (el borde de abajo de la carne), desde arriba: % del alto de la base. */
  y: number;
  /** El ancho de la carne: % del ancho de la base. */
  w: number;
}

/** La tabla con arroz y plátano, sin carne. */
export const BOARD_BASE: BoardImage = {
  src: '/menu/capas/tabla.webp',
  width: 1147,
  height: 412,
};

/**
 * Las carnes del prototipo: los tres recortes que mandó el cliente. Cuando la
 * carta sea real, cada carne del POS traerá el suyo.
 */
export const BOARD_MEATS: readonly BoardMeat[] = [
  { id: 'biffe', name: 'Biffe', src: '/menu/capas/carnes/biffe.webp', width: 640, height: 497 },
  {
    id: 'chicharron-de-pescado',
    name: 'Chicharrón de pescado',
    src: '/menu/capas/carnes/chicharron-de-pescado.webp',
    width: 640,
    height: 380,
  },
  {
    id: 'costilla-res',
    name: 'Costilla de res',
    src: '/menu/capas/carnes/costilla-res.webp',
    width: 640,
    height: 578,
  },
];

/**
 * Lo que una carne puede asomar por encima de la base, en % de su alto. La
 * base es baja (el arroz es lo más alto), y una costilla grande sobresale: sin
 * este margen se cortaría contra el borde de la tarjeta.
 */
export const BOARD_HEADROOM = 12;

/** Los acomodos. Ver el encabezado del archivo. */
export const BOARD_LAYOUTS = {
  /** Tablita para 1: la carne ocupa la punta ancha, delante del plátano. */
  single: [{ x: 19, y: 91, w: 35 }],
  /** Tablita para 2: el mismo sitio, más porción. */
  singleLarge: [{ x: 21, y: 92, w: 40 }],
  two: [
    { x: 16, y: 81, w: 29 },
    { x: 37.5, y: 92, w: 28 },
  ],
  three: [
    { x: 15, y: 78, w: 26 },
    { x: 36, y: 92, w: 25 },
    { x: 61, y: 81, w: 24.5 },
  ],
} as const satisfies Record<string, readonly MeatSlot[]>;

/**
 * El acomodo para una tabla de N carnes, o `null` si la tabla no da para
 * tantas. La Tabla de los Dioses lleva 4 y la Super Tabla XL 7: esas piden
 * otra base, más grande.
 */
export function layoutForMeats(count: number): readonly MeatSlot[] | null {
  if (count === 1) return BOARD_LAYOUTS.single;
  if (count === 2) return BOARD_LAYOUTS.two;
  if (count === 3) return BOARD_LAYOUTS.three;
  return null;
}

/** Ancho / alto del cuadro donde se pinta todo: la base más el margen de arriba. */
export const BOARD_STAGE_RATIO = BOARD_BASE.width / (BOARD_BASE.height * (1 + BOARD_HEADROOM / 100));

/** Qué parte del alto del cuadro ocupa la base (va pegada abajo), en %. */
export const BOARD_BASE_HEIGHT = (100 / (100 + BOARD_HEADROOM)) * 100;

/** Dónde se pinta una capa, en % del cuadro, listo para `left`, `bottom` y `width`. */
export interface LayerBox {
  left: number;
  bottom: number;
  width: number;
  /** Más abajo en la foto = más cerca = encima. */
  z: number;
}

export function placeSlot(slot: MeatSlot): LayerBox {
  return {
    left: slot.x - slot.w / 2,
    bottom: ((100 - slot.y) / (100 + BOARD_HEADROOM)) * 100,
    width: slot.w,
    z: Math.round(slot.y * 10),
  };
}

/**
 * Dónde queda el borde de arriba de una carne en su hueco, en % del alto de la
 * base (negativo = asoma por encima). Para comprobar que nada se corta.
 */
export function meatTop(slot: MeatSlot, meat: BoardImage): number {
  const widthPx = (slot.w / 100) * BOARD_BASE.width;
  const heightPx = widthPx * (meat.height / meat.width);
  return slot.y - (heightPx / BOARD_BASE.height) * 100;
}
