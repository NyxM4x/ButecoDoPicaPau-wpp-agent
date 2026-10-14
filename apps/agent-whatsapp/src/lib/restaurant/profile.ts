/**
 * EL PERFIL DEL RESTAURANTE — módulo PURO.
 *
 * Todo lo que el agente dice o decide sobre el local —cómo se llama, dónde
 * está, cuándo atiende, en qué moneda cobra, si hay retiro o efectivo— sale de
 * aquí. Antes eran constantes de Don Zarco repartidas por el código.
 *
 * ── De dónde sale ────────────────────────────────────────────────────────────
 *
 * Del POS (`GET /restaurant/profile`, ver `docs/pos-contract.md`). Lo trae
 * `profile-loader` al entrar cada petición y lo deja aquí. Si el POS no
 * responde, o todavía no hay POS, vale el de las variables `RESTAURANT_*`.
 *
 * ── Por qué es un valor del proceso y no un parámetro ───────────────────────
 *
 * Un despliegue del agente atiende UN restaurante, así que el perfil es el
 * mismo para todo lo que pase en el proceso. Leerlo con `restaurantProfile()`
 * deja los textos y las reglas como estaban —funciones puras de sus
 * argumentos más el perfil vigente— sin pasar un parámetro nuevo por cada
 * llamada del webhook.
 *
 * Sin `server-only` ni red: lo importan también los componentes del menú, que
 * reciben el perfil del servidor (ver `components/RestaurantProfileProvider`).
 */
import type { CentralDayHours, CentralRestaurantProfile, PosPaymentMethod } from '@/lib/central/contract';

export type DayHours = CentralDayHours;

export interface RestaurantProfile {
  name: string;
  /** Qué vende y dónde, en una línea: "un bar de comida brasileña en Santa Cruz". */
  description: string | null;
  /** BCP 47. */
  locale: string;
  /** Zona IANA. */
  timezone: string;
  currency: { code: string; symbol: string };
  phone: string | null;
  address: string | null;
  mapsUrl: string | null;
  /** El horario en palabras, si el local lo escribió. Si no, se arma de `weekly`. */
  hoursText: string | null;
  /** Siete entradas, de domingo (0) a sábado (6). `null` = ese día no abre. */
  weekly: Array<DayHours | null>;
  ordersPaused: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  paymentMethods: PosPaymentMethod[];
  greeting: string | null;
  farewell: string | null;
  menuVideoUrl: string | null;
  menuImageUrl: string | null;
  /** Logo para el menú web. No viene del POS: `RESTAURANT_LOGO_URL`. */
  logoUrl: string | null;
  /**
   * ¿El menú ofrece reservar mesa? No viene del POS:
   * `RESTAURANT_RESERVATIONS_ENABLED`. Apagado si no se dice nada.
   */
  reservationsEnabled: boolean;
}

type Env = Record<string, string | undefined>;

const text = (value: string | undefined | null): string | null => value?.trim() || null;
const flag = (value: string | undefined, fallback: boolean): boolean => {
  const v = value?.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const PAYMENT_METHODS: PosPaymentMethod[] = ['cash', 'qr', 'card'];

function weeklyFromEnv(env: Env): Array<DayHours | null> {
  const opens = CLOCK.test(env.RESTAURANT_OPENS ?? '') ? (env.RESTAURANT_OPENS as string) : '00:00';
  const closes = CLOCK.test(env.RESTAURANT_CLOSES ?? '') ? (env.RESTAURANT_CLOSES as string) : opens;
  // Días cerrados: "1" o "1,2" (0 = domingo … 6 = sábado).
  const closed = new Set(
    (env.RESTAURANT_CLOSED_DAYS ?? '')
      .split(',')
      .map((day) => Number.parseInt(day.trim(), 10))
      .filter((day) => day >= 0 && day <= 6),
  );
  return Array.from({ length: 7 }, (_, day) => (closed.has(day) ? null : { opens, closes }));
}

function paymentMethodsFrom(value: unknown): PosPaymentMethod[] {
  const list = (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((method) => String(method).trim().toLowerCase())
    .filter((method): method is PosPaymentMethod => (PAYMENT_METHODS as string[]).includes(method));
  const unique = PAYMENT_METHODS.filter((method) => list.includes(method));
  return unique.length > 0 ? unique : ['cash', 'qr'];
}

/**
 * El perfil que dan las variables de entorno. Es el respaldo cuando el POS no
 * entrega el suyo, y de aquí salen SIEMPRE los datos que no son del contrato
 * (el logo).
 *
 * Sin `RESTAURANT_OPENS` el local figura abierto las 24 horas: el agente nunca
 * dice si está abierto AHORA, y quien decide si se toma un pedido es el POS.
 */
export function profileFromEnv(env: Env = process.env): RestaurantProfile {
  return {
    name: text(env.RESTAURANT_NAME) ?? 'nuestro local',
    description: text(env.RESTAURANT_DESCRIPTION),
    locale: text(env.RESTAURANT_LOCALE) ?? 'es-BO',
    timezone: text(env.RESTAURANT_TIMEZONE) ?? 'America/La_Paz',
    currency: {
      code: text(env.RESTAURANT_CURRENCY_CODE) ?? 'BOB',
      symbol: text(env.RESTAURANT_CURRENCY_SYMBOL) ?? 'Bs',
    },
    phone: text(env.RESTAURANT_PHONE),
    address: text(env.RESTAURANT_ADDRESS),
    mapsUrl: text(env.RESTAURANT_MAPS_URL),
    hoursText: text(env.RESTAURANT_HOURS),
    weekly: weeklyFromEnv(env),
    ordersPaused: false,
    pickupEnabled: flag(env.RESTAURANT_PICKUP_ENABLED, true),
    deliveryEnabled: flag(env.RESTAURANT_DELIVERY_ENABLED, true),
    paymentMethods: paymentMethodsFrom(env.RESTAURANT_PAYMENT_METHODS),
    greeting: text(env.RESTAURANT_GREETING),
    farewell: text(env.RESTAURANT_FAREWELL),
    menuVideoUrl: text(env.MENU_VIDEO_URL),
    menuImageUrl: text(env.MENU_IMAGE_URL),
    logoUrl: text(env.RESTAURANT_LOGO_URL),
    reservationsEnabled: flag(env.RESTAURANT_RESERVATIONS_ENABLED, false),
  };
}

function validWeekly(value: unknown): Array<DayHours | null> | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const days = value.map((day) => {
    if (day === null) return null;
    const d = day as Partial<DayHours> | undefined;
    return d && CLOCK.test(d.opens ?? '') && CLOCK.test(d.closes ?? '') ? { opens: d.opens!, closes: d.closes! } : undefined;
  });
  return days.includes(undefined) ? null : (days as Array<DayHours | null>);
}

/**
 * El perfil del POS convertido al del agente.
 *
 * Campo a campo: lo que el POS trae manda, y lo que deja en `null` (o trae mal)
 * cae al valor del entorno. Así un POS que todavía no tiene cargado el video
 * del menú no le borra al agente el que tiene en `MENU_VIDEO_URL`.
 */
export function profileFromCentral(central: CentralRestaurantProfile, env: Env = process.env): RestaurantProfile {
  const base = profileFromEnv(env);
  return {
    name: text(central.name) ?? base.name,
    description: text(central.description) ?? base.description,
    locale: text(central.locale) ?? base.locale,
    timezone: text(central.timezone) ?? base.timezone,
    currency: {
      code: text(central.currency?.code) ?? base.currency.code,
      symbol: text(central.currency?.symbol) ?? base.currency.symbol,
    },
    phone: text(central.phone) ?? base.phone,
    address: text(central.location?.address) ?? base.address,
    mapsUrl: text(central.location?.mapsUrl) ?? base.mapsUrl,
    hoursText: text(central.hours?.text) ?? base.hoursText,
    weekly: validWeekly(central.hours?.weekly) ?? base.weekly,
    ordersPaused: central.ordering?.paused === true,
    pickupEnabled: central.ordering ? central.ordering.pickupEnabled === true : base.pickupEnabled,
    deliveryEnabled: central.ordering ? central.ordering.deliveryEnabled !== false : base.deliveryEnabled,
    paymentMethods: central.ordering ? paymentMethodsFrom(central.ordering.paymentMethods) : base.paymentMethods,
    greeting: text(central.messages?.greeting) ?? base.greeting,
    farewell: text(central.messages?.farewell) ?? base.farewell,
    menuVideoUrl: text(central.menuMedia?.videoUrl) ?? base.menuVideoUrl,
    menuImageUrl: text(central.menuMedia?.imageUrl) ?? base.menuImageUrl,
    logoUrl: base.logoUrl,
    reservationsEnabled: base.reservationsEnabled,
  };
}

/**
 * La URL pública de ESTE agente, sin barra final.
 *
 * De aquí salen el enlace del menú y todo lo que WhatsApp tiene que poder
 * descargar. Antes eran constantes con el dominio de la demo. En Vercel, si
 * falta `APP_BASE_URL`, vale el dominio de producción del proyecto.
 *
 * En local es `http://localhost:3000`, que un teléfono no puede abrir: para
 * probar con WhatsApp de verdad hay que publicar o usar un túnel, y poner esa
 * URL en `APP_BASE_URL`.
 */
export function publicAppUrl(env: Env = process.env): string {
  const explicit = text(env.APP_BASE_URL)?.replace(/\/+$/, '');
  if (explicit) return explicit;
  const vercel = text(env.VERCEL_PROJECT_PRODUCTION_URL);
  return vercel ? `https://${vercel}` : 'http://localhost:3000';
}

// ── El perfil vigente ───────────────────────────────────────────────────────

let current: RestaurantProfile | null = null;

/** El perfil con el que se atiende ahora. Nunca lanza. */
export function restaurantProfile(): RestaurantProfile {
  current ??= profileFromEnv();
  return current;
}

/** Lo fija `profile-loader` (servidor), el proveedor del menú (navegador) y las pruebas. */
export function setRestaurantProfile(profile: RestaurantProfile): void {
  current = profile;
}

// ── Lo que se pregunta del perfil ───────────────────────────────────────────

export function cashEnabled(profile: RestaurantProfile = restaurantProfile()): boolean {
  return profile.paymentMethods.includes('cash');
}

export function qrEnabled(profile: RestaurantProfile = restaurantProfile()): boolean {
  return profile.paymentMethods.includes('qr');
}

/** Un monto como lo ve el cliente: `Bs. 18`, `R$ 18,50`. */
export function money(amount: number, profile: RestaurantProfile = restaurantProfile()): string {
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  // "Bs." lleva punto por costumbre local; el resto de los símbolos, no.
  const symbol = profile.currency.symbol === 'Bs' ? 'Bs.' : profile.currency.symbol;
  return `${symbol} ${rounded}`;
}

/**
 * Las palabras con las que un cliente nombra al local ("zarco", "don zarco").
 * Sirven para reconocer un saludo que solo dice el nombre.
 */
export function nameKeywords(profile: RestaurantProfile = restaurantProfile()): string[] {
  const plain = profile.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return [];
  // El nombre entero y sus palabras "de verdad": ni artículos ni preposiciones.
  const words = plain.split(" ").filter((word) => word.length >= 5);
  return [...new Set([plain, ...words])];
}
