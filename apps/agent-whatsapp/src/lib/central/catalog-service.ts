import 'server-only';
import type { MenuItem } from '@/types';
import type { Promotion } from '@/lib/promotions/promotion';
import { centralFetchFile, centralRequest, type CentralRequestInit } from './client';
import { toMenuItems, toModelItems, toPromotions, type CentralItemForModel } from './catalog';
import {
  POS_ROUTES,
  type CentralCategory,
  type CentralProduct,
  type CentralPromotion,
  type CentralRestaurantProfile,
  type PosPaymentMethod,
} from './contract';

type Transport = Pick<CentralRequestInit, 'fetchImpl' | 'config' | 'timeoutMs'>;

export interface CentralCatalog {
  items: MenuItem[];
  /** Vacío si las promociones no se pudieron leer: el menú se abre igual. */
  promotions: Promotion[];
  /** Nombre del local tal como está en el POS, o `null`. */
  restaurantName: string | null;
  ordersPaused: boolean;
  /** ¿Se ofrece pasar a recoger? Lo que diga el POS. */
  pickupEnabled: boolean;
  /** ¿Se ofrece envío a domicilio? Lo que diga el POS. */
  deliveryEnabled: boolean;
  /** Formas de pago que se le ofrecen al cliente, en el orden a mostrar. */
  paymentMethods: PosPaymentMethod[];
}

/** La foto de un producto, pedida al POS con el token del servidor. */
export function fetchCentralProductImage(productId: string, transport: Transport = {}): Promise<Response> {
  return centralFetchFile(POS_ROUTES.productImage(productId), transport);
}

/**
 * El catálogo para el asistente de IA: los productos que se pueden pedir ahora
 * y las promociones tal como las tiene el POS. Lanza si el POS no responde: el
 * asistente tiene que saber que no pudo leer el menú, no creer que está vacío.
 */
export async function loadCentralCatalogForModel(
  transport: Transport = {},
): Promise<{ items: CentralItemForModel[]; promotions: Promotion[] }> {
  const catalog = await loadCentralCatalog(transport);
  return { items: toModelItems(catalog.items), promotions: catalog.promotions };
}

/** `GET /restaurant/profile`, tal como lo entrega el POS. Lanza si no responde. */
export async function loadCentralProfile(transport: Transport = {}): Promise<CentralRestaurantProfile> {
  return (await centralRequest<CentralRestaurantProfile>(POS_ROUTES.restaurantProfile, transport)).body;
}

/**
 * Qué se ofrece cuando el perfil no se pudo leer.
 *
 * El envío y los dos pagos de siempre: es lo que el POS aceptaba antes de que
 * existiera el perfil. Si en realidad alguno está apagado, el POS rechaza el
 * pedido al crearlo (`delivery_disabled`, `payment_method_disabled`): aquí solo
 * se decide qué botones pintar.
 */
const FALLBACK_PAYMENT_METHODS: PosPaymentMethod[] = ['cash', 'qr'];

/**
 * El catálogo completo del menú web, leído del POS.
 *
 * Categorías y productos son obligatorios: sin ellos no hay menú, y el error
 * sube para que la página muestre "no pudimos cargar el menú". Promociones y
 * perfil son opcionales: su fallo no puede tumbar un catálogo que sí cargó.
 */
export async function loadCentralCatalog(transport: Transport = {}): Promise<CentralCatalog> {
  const [categories, products, promotions, profile] = await Promise.all([
    centralRequest<CentralCategory[]>(POS_ROUTES.categories, transport),
    centralRequest<CentralProduct[]>(POS_ROUTES.products, transport),
    centralRequest<CentralPromotion[]>(POS_ROUTES.promotions, transport).catch(() => null),
    centralRequest<CentralRestaurantProfile>(POS_ROUTES.restaurantProfile, transport).catch(() => null),
  ]);

  const items = toMenuItems(categories.body, products.body);
  const ordering = profile?.body.ordering;

  return {
    items,
    promotions: promotions ? toPromotions(promotions.body, items) : [],
    restaurantName: profile?.body.name?.trim() || null,
    ordersPaused: ordering?.paused === true,
    pickupEnabled: ordering?.pickupEnabled === true,
    deliveryEnabled: ordering ? ordering.deliveryEnabled !== false : true,
    paymentMethods:
      ordering && Array.isArray(ordering.paymentMethods) && ordering.paymentMethods.length > 0
        ? ordering.paymentMethods
        : FALLBACK_PAYMENT_METHODS,
  };
}
