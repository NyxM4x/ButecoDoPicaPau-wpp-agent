/**
 * Catálogo visual del menú — lógica PURA (sin `server-only`, sin Supabase).
 *
 * Se usa desde componentes cliente (`/menu`) y desde tests. Los **nombres y
 * precios** siguen viniendo de Supabase (`menu_items`): aquí solo vive lo
 * presentacional (etiquetas de categoría, descripciones de vitrina, imagen).
 *
 * OJO: no importar este módulo desde `@/lib/menu` (ese índice es server-only).
 */
import type { MenuCategory, MenuItem } from '@/types';

// ── Categorías ──────────────────────────────────────────────────────────────

/**
 * Pestaña "Todo" + las categorías. Con `menu_items` son las 3 del esquema; con
 * el catálogo del backend central son las que se hayan creado en el POS, y su
 * id es `sectionKeyOf` (`c:<nombre>`).
 */
export type CategoryFilter = 'all' | MenuCategory | (string & {});

/**
 * Las pestañas siguen el MISMO orden que las secciones
 * (`CATEGORY_SECTION_ORDER`, 17-09-2026): platos, extras, bebidas. Si las dos
 * listas discrepan, el cliente toca "Extras" y el menú salta a un sitio que no
 * es donde estaban los extras al desplazarse.
 */
export const CATEGORY_TABS: ReadonlyArray<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: 'Todo' },
  { id: 'plato', label: 'Platos' },
  { id: 'extra', label: 'Extras' },
  { id: 'bebida', label: 'Bebidas' },
] as const;

const CATEGORY_LABELS: Record<MenuCategory, string> = {
  plato: 'Platos',
  bebida: 'Bebidas',
  extra: 'Extras',
};

/**
 * Clave de la SECCIÓN a la que pertenece un producto.
 *
 * Con el catálogo central dos categorías distintas ("Cafés" y "Jugos") pueden
 * compartir el mismo tipo (`bebida`), así que la sección se identifica por su
 * nombre. Sin nombre —`menu_items`— la sección es la categoría de siempre.
 */
export function sectionKeyOf(item: Pick<MenuItem, 'category' | 'category_label'>): string {
  return item.category_label ? `c:${item.category_label}` : item.category;
}

/**
 * Pestañas para un catálogo concreto.
 *
 * Si ningún producto trae nombre de categoría son las de siempre. Si lo traen,
 * salen de los productos, en el orden que se les dio en el POS: cambiar de demo
 * cambia las pestañas sin tocar código.
 */
export function categoryTabsFor(
  items: ReadonlyArray<Pick<MenuItem, 'category' | 'category_label' | 'category_order'>>,
): ReadonlyArray<{ id: CategoryFilter; label: string }> {
  const secciones = new Map<string, { label: string; order: number }>();
  for (const item of items) {
    if (!item.category_label) continue;
    const key = sectionKeyOf(item);
    if (!secciones.has(key)) {
      secciones.set(key, { label: item.category_label, order: item.category_order ?? 0 });
    }
  }
  if (secciones.size === 0) return CATEGORY_TABS;

  return [
    { id: 'all', label: 'Todo' },
    ...[...secciones.entries()]
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([id, { label }]) => ({ id, label })),
  ];
}

/** Etiqueta visible de una categoría del esquema (`plato` → `Platos`). */
export function categoryLabel(category: MenuCategory): string {
  return CATEGORY_LABELS[category];
}

// ── Copy de vitrina ─────────────────────────────────────────────────────────

/**
 * Descripciones de vitrina por `code`, para el catálogo propio del agente
 * (`menu_items`, que no tiene columna de descripción). Vacía: con el POS
 * conectado, cada producto trae la suya. La de la demo anterior se retiró.
 */
const PRODUCT_DESCRIPTIONS: Record<string, string> = {};

/**
 * Descripción de vitrina de un producto, o `null` si no hay copy definido.
 *
 * Acepta el producto entero: si trae descripción propia —la que se escribió en
 * el POS— gana esa. Con solo el `code` responde la tabla de arriba.
 */
export function productDescription(
  producto: string | Pick<MenuItem, 'code' | 'description'>,
): string | null {
  if (typeof producto === 'string') return PRODUCT_DESCRIPTIONS[producto] ?? null;
  if (producto.description !== undefined) return producto.description;
  return PRODUCT_DESCRIPTIONS[producto.code] ?? null;
}

// ── Imágenes ────────────────────────────────────────────────────────────────

/**
 * Foto de cada producto, mapeada por `code`.
 *
 * El `emoji` es el respaldo: si una foto falla al cargar, `ProductImage` cae
 * al placeholder (gradiente + emoji) vía `onError`.
 *
 * Para un producto nuevo sin foto, dejar `src: null`: se dibuja el placeholder
 * sin pedir ninguna imagen a la red (ver `public/menu/README.md`).
 *
 * No usar la imagen general del menú como foto de cada producto.
 */
export interface ProductImage {
  /** Ruta pública de la foto, o `null` si aún no existe (usar placeholder). */
  src: string | null;
  /** Nombre de archivo esperado en `public/menu/`. */
  file: string;
  /** Emoji del placeholder mientras no hay foto. */
  emoji: string;
}

/**
 * Fotos por `code` para el catálogo propio del agente. Vacía: con el POS
 * conectado la foto es la que se sube allí. La de la demo anterior se retiró.
 */
const PRODUCT_IMAGES: Record<string, ProductImage> = {};

const FALLBACK_EMOJI: Record<MenuCategory, string> = {
  plato: '🥪',
  bebida: '🥤',
  extra: '🍟',
};

/** Imagen (o placeholder) de un producto. Nunca devuelve `undefined`. */
export function productImage(
  item: Pick<MenuItem, 'code' | 'category' | 'image_url'>,
): ProductImage {
  // Catálogo central: la foto es la que se subió en el POS, o ninguna. No se
  // cae a la tabla de arriba: un producto de otra demo con el mismo `code`
  // heredaría una foto que no es suya.
  if (item.image_url !== undefined) {
    return {
      src: item.image_url,
      file: `${item.code.replace(/_/g, '-')}.webp`,
      emoji: FALLBACK_EMOJI[item.category] ?? '🍽️',
    };
  }
  return (
    PRODUCT_IMAGES[item.code] ?? {
      src: null,
      file: `${item.code.replace(/_/g, '-')}.webp`,
      emoji: FALLBACK_EMOJI[item.category] ?? '🍽️',
    }
  );
}

// ── Filtrado y búsqueda ─────────────────────────────────────────────────────

/** Minúsculas sin acentos, para comparar "Porción de papa" con "porcion". */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Filtra el catálogo por categoría y por texto (nombre + descripción).
 * Ambos filtros son locales: no hay ida y vuelta al servidor.
 */
export function filterMenuItems(
  items: MenuItem[],
  category: CategoryFilter,
  /**
   * Texto a buscar. Opcional desde el 17-09-2026: la vitrina retiró su
   * buscador y filtra solo por categoría. La búsqueda sigue aquí —probada— por
   * si vuelve, y porque no cuesta nada mantenerla.
   */
  query: string = '',
): MenuItem[] {
  const needle = normalizeText(query);

  return items.filter((item) => {
    if (category !== 'all' && sectionKeyOf(item) !== category) return false;
    if (needle === '') return true;

    const haystack = normalizeText(
      `${item.name} ${productDescription(item) ?? ''}`,
    );
    return haystack.includes(needle);
  });
}

/**
 * Agrupa los productos por categoría, respetando el orden recibido.
 *
 * Con una excepción: lo AGOTADO baja al final de su grupo (07-09-2026). Desde
 * que la vitrina lo enseña en gris en vez de esconderlo, el `sort_order` del
 * panel puede poner un producto que no se vende en la primera tarjeta de la
 * pantalla — y lo primero que ve quien abre el menú no puede ser lo único que
 * no puede pedir.
 *
 * El orden entre ellos NO se toca: dentro de cada mitad manda el `sort_order`
 * de siempre. Es un desempate, no una reordenación.
 */
/**
 * Orden de vitrina de los platos por `code`, para el catálogo propio del
 * agente. Vacío: con el POS conectado manda el orden que se le dio allí. Un
 * `code` que no esté aquí va con el orden de la base.
 */
const PLATO_ORDER: readonly string[] = [];

/** Posición de vitrina de un `code`; los no listados van al final. */
function ordenDeVitrina(code: string): number {
  const i = PLATO_ORDER.indexOf(code);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/**
 * Orden de las SECCIONES del menú (17-09-2026).
 *
 * Los extras van entre los platos y las bebidas: acompañan a la comida, así
 * que se ofrecen junto a ella y no al final, después de los jugos.
 *
 * Como `PLATO_ORDER`, vive aquí y no en `sort_order` porque la base es
 * producción y esto nació en un rediseño. Si se queda, baja a una migración
 * (bastaría mover los extras al rango 65-69) y esta lista se borra.
 *
 * En noche de promoción `orderSectionsForMode` sube las bebidas al principio,
 * y eso sigue mandando por encima de este orden.
 */
const CATEGORY_SECTION_ORDER: readonly MenuCategory[] = ['plato', 'extra', 'bebida'];

export function groupByCategory(
  items: MenuItem[],
): Array<{ key: string; category: MenuCategory; label: string; items: MenuItem[] }> {
  const groups = new Map<string, MenuItem[]>();

  for (const item of items) {
    const key = sectionKeyOf(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  // Con el catálogo central manda el orden que se le dio a la categoría en el
  // POS; con `menu_items`, el de `CATEGORY_SECTION_ORDER` de siempre.
  const ordenDeSeccion = (groupItems: MenuItem[]) => {
    const primero = groupItems[0];
    if (primero.category_label) return primero.category_order ?? 0;
    const i = CATEGORY_SECTION_ORDER.indexOf(primero.category);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  return [...groups.entries()]
    .sort(([, a], [, b]) => ordenDeSeccion(a) - ordenDeSeccion(b))
    .map(([key, groupItems]) => ({
      key,
      category: groupItems[0].category,
      label: groupItems[0].category_label ?? categoryLabel(groupItems[0].category),
      // `sort` sobre una copia: la lista de entrada es la del llamador.
      items: [...groupItems].sort(
        (a, b) =>
          // El agotado SIEMPRE al final, antes que cualquier otro criterio: es
          // lo que el cliente no puede pedir.
          Number(b.is_active) - Number(a.is_active) ||
          ordenDeVitrina(a.code) - ordenDeVitrina(b.code),
      ),
    }));
}
