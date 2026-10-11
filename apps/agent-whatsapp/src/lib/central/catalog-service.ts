import 'server-only';
import type { MenuItem } from '@/types';
import type { Promotion } from '@/lib/promotions/promotion';
import { centralRequest, type CentralRequestInit } from './client';
import {
  toMenuItems,
  toPromotions,
  type CentralCategory,
  type CentralProduct,
  type CentralPromotion,
} from './catalog';

type Transport = Pick<CentralRequestInit, 'fetchImpl' | 'config' | 'timeoutMs'>;

export interface CentralCatalog {
  items: MenuItem[];
  /** Vacío si las promociones no se pudieron leer: el menú se abre igual. */
  promotions: Promotion[];
  /** Nombre del local tal como está en Configuración del POS, o `null`. */
  restaurantName: string | null;
  ordersPaused: boolean;
  /** ¿Se ofrece pasar a recoger? Lo que diga Configuración del POS. */
  pickupEnabled: boolean;
}

/**
 * El catálogo completo del menú web, leído del backend central.
 *
 * Categorías y productos son obligatorios: sin ellos no hay menú, y el error
 * sube para que la página muestre "no pudimos cargar el menú". Promociones y
 * configuración son opcionales: su fallo no puede tumbar un catálogo que sí
 * cargó.
 */
export async function loadCentralCatalog(transport: Transport = {}): Promise<CentralCatalog> {
  const [categories, products, promotions, settings] = await Promise.all([
    centralRequest<CentralCategory[]>('/categories', transport),
    centralRequest<CentralProduct[]>('/products', transport),
    centralRequest<CentralPromotion[]>('/promotions', transport).catch(() => null),
    centralRequest<{ restaurantName?: string | null; ordersPaused?: boolean; pickupEnabled?: boolean }>(
      '/operational-settings',
      transport,
    ).catch(() => null),
  ]);

  const items = toMenuItems(categories.body, products.body);

  return {
    items,
    promotions: promotions ? toPromotions(promotions.body, items) : [],
    restaurantName: settings?.body.restaurantName?.trim() || null,
    ordersPaused: settings?.body.ordersPaused === true,
    pickupEnabled: settings?.body.pickupEnabled === true,
  };
}
