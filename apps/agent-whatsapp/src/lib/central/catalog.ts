/**
 * Traducción del catálogo del backend central al modelo del menú web — PURO.
 *
 * El menú web (`/menu`, el carrito, las promociones) se escribió contra la
 * tabla `menu_items` del agente. En vez de reescribirlo, aquí se le entrega el
 * catálogo del backend con la misma forma, más lo que `menu_items` nunca tuvo:
 * descripción, foto y el nombre real de la categoría.
 *
 * Sin red ni `server-only`: recibe lo que devolvió la API y devuelve datos.
 */
import type { MenuCategory, MenuItem } from '@/types';
import type { Promotion, PromotionComponent } from '@/lib/promotions/promotion';

// ── Lo que devuelve el backend (solo los campos que se usan) ────────────────

export interface CentralCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CentralProduct {
  id: string;
  code: string;
  name: string;
  description: string | null;
  categoryId: string;
  price: number;
  isActive: boolean;
  isAvailable: boolean;
  sortOrder: number;
  imageUrl: string | null;
}

export interface CentralPromotion {
  id: string;
  name: string;
  description: string | null;
  promoPrice: number;
  isActive: boolean;
  archivedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  imageUrl: string | null;
  revision: number;
  items: Array<{ productId: string; productName: string; quantity: number; unitPrice: number }>;
}

// ── Tipo de categoría ───────────────────────────────────────────────────────

/** Minúsculas y sin acentos, para reconocer "Cafés" y "cafes" por igual. */
function plain(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const DRINK_HINTS = ['bebida', 'jugo', 'cafe', 'refresco', 'gaseosa', 'soda', 'licuado', 'batido', 'trago', 'cerveza', 'vino', 'te '];
const EXTRA_HINTS = ['extra', 'adicional', 'acompan', 'guarnicion', 'salsa'];

/**
 * A cuál de los tres tipos del menú web pertenece una categoría del POS.
 *
 * El backend tiene categorías libres ("Cafés", "Panadería"); el menú web usa
 * el tipo solo para cosas de presentación: el color del marcador sin foto, el
 * emoji de respaldo y qué sección acompaña a un combo. Para AGRUPAR y para las
 * pestañas se usa el nombre real, no esto — así que equivocarse aquí cambia un
 * color, nunca dónde aparece un producto.
 */
export function categoryKindOf(name: string): MenuCategory {
  const n = `${plain(name)} `;
  if (EXTRA_HINTS.some((hint) => n.includes(hint))) return 'extra';
  if (DRINK_HINTS.some((hint) => n.includes(hint))) return 'bebida';
  return 'plato';
}

// ── Productos ───────────────────────────────────────────────────────────────

/** Ruta, en este mismo sitio, que sirve la foto de un producto del backend. */
export function menuImagePath(productId: string): string {
  return `/api/menu/image/${productId}`;
}

/**
 * Productos del backend con la forma de `menu_items`.
 *
 * `is_active` significa aquí "se puede pedir ahora": el backend ya filtra los
 * productos apagados, y el que está AGOTADO llega con `isAvailable: false` — el
 * menú lo enseña en gris y no lo deja entrar al carrito, igual que antes.
 *
 * El orden final es categoría y después producto, que es el orden en que el
 * menú web recorre la lista.
 */
export function toMenuItems(categories: CentralCategory[], products: CentralProduct[]): MenuItem[] {
  const categoryById = new Map(categories.filter((c) => c.isActive).map((c) => [c.id, c]));

  return products
    .filter((product) => product.isActive && categoryById.has(product.categoryId))
    .map((product) => {
      const category = categoryById.get(product.categoryId)!;
      return {
        id: product.id,
        code: product.code,
        name: product.name,
        category: categoryKindOf(category.name),
        price: product.price,
        is_active: product.isAvailable,
        sort_order: product.sortOrder,
        created_at: '',
        updated_at: '',
        description: product.description,
        image_url: product.imageUrl ? menuImagePath(product.id) : null,
        category_label: category.name,
        category_order: category.sortOrder,
      } satisfies MenuItem;
    })
    .sort(
      (a, b) =>
        (a.category_order ?? 0) - (b.category_order ?? 0) ||
        (a.category_label ?? '').localeCompare(b.category_label ?? '') ||
        a.sort_order - b.sort_order,
    );
}

// ── Promociones ─────────────────────────────────────────────────────────────

/**
 * Promociones del backend con la forma que usa el menú web.
 *
 * Las archivadas no llegan: para el cliente no existen. El resto —apagadas,
 * programadas, vencidas— sí, porque decidir cuál se puede comprar es trabajo de
 * `evaluatePromotion`, con el reloj del servidor.
 *
 * Un componente que ya no está en el catálogo (se apagó o se agotó) llega como
 * no disponible, y eso tumba el combo: no se vende una promoción a medias.
 */
export function toPromotions(promotions: CentralPromotion[], menuItems: MenuItem[]): Promotion[] {
  const itemById = new Map(menuItems.map((item) => [item.id, item]));

  return promotions
    .filter((promotion) => promotion.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((promotion) => ({
      id: promotion.id,
      name: promotion.name,
      description: promotion.description,
      promoPrice: promotion.promoPrice,
      imageUrl: promotion.imageUrl,
      startsAt: promotion.startsAt,
      endsAt: promotion.endsAt,
      isActive: promotion.isActive,
      revision: promotion.revision,
      updatedAt: '',
      components: promotion.items.map((component): PromotionComponent => {
        const item = itemById.get(component.productId);
        return {
          menuItemId: component.productId,
          code: item?.code ?? component.productId,
          name: item?.name ?? component.productName,
          category: item?.category ?? 'plato',
          unitPrice: item?.price ?? component.unitPrice,
          quantity: component.quantity,
          isActive: item?.is_active ?? false,
        };
      }),
    }));
}
