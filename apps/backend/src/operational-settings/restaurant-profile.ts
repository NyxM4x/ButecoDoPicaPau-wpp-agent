import { OrderPaymentMethod } from '../database/types';

/**
 * Perfil del restaurante tal como lo define el contrato del POS
 * (`docs/pos-contract.md`, `GET /restaurant/profile`).
 *
 * Es lo que el agente de WhatsApp dice del local: quién es, dónde está, cuándo
 * atiende, en qué idioma y moneda habla y qué se puede pedir. Antes estaba
 * escrito a mano en el código del agente.
 */
export const POS_CONTRACT_VERSION = 'v1';

export interface RestaurantDayHours {
  /** `HH:MM`, 24 horas, en la zona horaria del restaurante. */
  opens: string;
  /** `HH:MM`. Menor o igual que `opens` = termina al día siguiente. */
  closes: string;
}

export interface RestaurantProfileResponse {
  contractVersion: typeof POS_CONTRACT_VERSION;
  name: string;
  description: string | null;
  locale: string;
  timezone: string;
  currency: { code: string; symbol: string };
  phone: string | null;
  location: {
    address: string | null;
    mapsUrl: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  hours: {
    text: string | null;
    /** Siete entradas, de domingo (0) a sábado (6). `null` = ese día no abre. */
    weekly: Array<RestaurantDayHours | null>;
  };
  ordering: {
    paused: boolean;
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
    paymentMethods: OrderPaymentMethod[];
  };
  messages: { greeting: string | null; farewell: string | null };
  menuMedia: { videoUrl: string | null; imageUrl: string | null };
}

export interface RestaurantProfileRow {
  restaurant_name: string;
  restaurant_description: string | null;
  restaurant_phone: string | null;
  restaurant_address: string | null;
  restaurant_maps_url: string | null;
  restaurant_timezone: string;
  restaurant_locale: string;
  currency_code: string;
  currency_symbol: string;
  hours_text: string | null;
  business_opens_hour: number;
  business_closes_hour: number;
  restaurant_latitude: number | null;
  restaurant_longitude: number | null;
  orders_paused: boolean;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  enabled_payment_methods: OrderPaymentMethod[];
  greeting_message: string | null;
  farewell_message: string | null;
  menu_video_url: string | null;
  menu_image_url: string | null;
}

/** El orden en que se le ofrecen al cliente, sin importar cómo se guardaron. */
const PAYMENT_METHOD_ORDER: OrderPaymentMethod[] = ['cash', 'qr', 'card'];

function clock(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * Este backend guarda un solo par de horas para toda la semana, así que los
 * siete días salen iguales. El contrato admite horarios distintos por día y
 * días cerrados (`null`): eso lo dará el POS multi-tenant.
 */
function weeklyHours(opensHour: number, closesHour: number): RestaurantDayHours[] {
  return Array.from({ length: 7 }, () => ({ opens: clock(opensHour), closes: clock(closesHour) }));
}

export function toRestaurantProfile(row: RestaurantProfileRow): RestaurantProfileResponse {
  return {
    contractVersion: POS_CONTRACT_VERSION,
    name: row.restaurant_name,
    description: row.restaurant_description,
    locale: row.restaurant_locale,
    timezone: row.restaurant_timezone,
    currency: { code: row.currency_code, symbol: row.currency_symbol },
    phone: row.restaurant_phone,
    location: {
      address: row.restaurant_address,
      mapsUrl: row.restaurant_maps_url,
      latitude: row.restaurant_latitude,
      longitude: row.restaurant_longitude,
    },
    hours: {
      text: row.hours_text,
      weekly: weeklyHours(row.business_opens_hour, row.business_closes_hour),
    },
    ordering: {
      paused: row.orders_paused,
      pickupEnabled: row.pickup_enabled,
      deliveryEnabled: row.delivery_enabled,
      paymentMethods: PAYMENT_METHOD_ORDER.filter((method) =>
        row.enabled_payment_methods.includes(method),
      ),
    },
    messages: { greeting: row.greeting_message, farewell: row.farewell_message },
    menuMedia: { videoUrl: row.menu_video_url, imageUrl: row.menu_image_url },
  };
}
