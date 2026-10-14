/**
 * Formateo de presentacion — modulo PURO (seguro en cliente). Sin datos tecnicos.
 * Solo transforma la PRESENTACION: nunca modifica los datos almacenados ni los
 * contratos internos (la moneda en base sigue siendo 'BOB').
 *
 * El idioma, la zona horaria y la moneda salen del perfil del restaurante.
 */
import { restaurantProfile } from '@/lib/restaurant/profile';

/** Los formateadores de `Intl` son caros de crear: uno por configuración. */
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function moneyFormat(): Intl.NumberFormat {
  const { locale } = restaurantProfile();
  const key = `money|${locale}`;
  let format = formatters.get(key) as Intl.NumberFormat | undefined;
  if (!format) {
    format = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formatters.set(key, format);
  }
  return format;
}

/**
 * Fechas en la zona DEL LOCAL. Sin `timeZone` explícito se usaría la del
 * navegador: el mismo instante se leería distinto según dónde esté quien mira.
 */
function dateFormat(kind: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const { locale, timezone } = restaurantProfile();
  const key = `${kind}|${locale}|${timezone}`;
  let format = formatters.get(key) as Intl.DateTimeFormat | undefined;
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone });
    formatters.set(key, format);
  }
  return format;
}

/** Simbolo visual de una moneda que no es la del local. 'BOB' se muestra como 'Bs'. */
const CURRENCY_SYMBOL: Record<string, string> = { BOB: 'Bs' };

/** El símbolo de la moneda del local, o el de otra moneda si se pide una. */
export function currencySymbol(currency?: string): string {
  const own = restaurantProfile().currency;
  if (currency === undefined || currency === own.code) return own.symbol;
  return CURRENCY_SYMBOL[currency] ?? currency;
}

/** Formatter monetario centralizado: `Bs 86,00`. Solo presentacion. */
export function formatMoney(amount: number, currency?: string): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return `${currencySymbol(currency)} ${moneyFormat().format(value)}`;
}

/**
 * Normaliza SOLO visualmente el nombre del cliente: si viene todo en MAYUSCULAS
 * lo pasa a Capitalizacion por palabra. Cualquier otro caso se deja intacto. No
 * altera datos almacenados, numeros de pedido ni referencias.
 */
export function formatCustomerName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  if (trimmed === '') return null;
  const hasLetters = /\p{L}/u.test(trimmed);
  // Solo se transforma cuando esta completamente en mayusculas (grito de datos).
  if (hasLetters && trimmed === trimmed.toUpperCase()) {
    return trimmed
      .toLocaleLowerCase('es-BO')
      .replace(/\p{L}[\p{L}\p{M}'’-]*/gu, (w) => w.charAt(0).toLocaleUpperCase('es-BO') + w.slice(1));
  }
  return trimmed;
}

/**
 * Formatea SOLO visualmente un telefono. Cuando el valor es inequivocamente
 * boliviano —codigo 591 + movil de 8 digitos que empieza en 6 o 7— lo muestra
 * como `+591 76543210`. Cualquier otro formato se devuelve tal cual (sanitizado
 * con trim). No altera el dato almacenado, las APIs, WhatsApp ni Supabase.
 */
export function formatPhone(phone: string | null | undefined): string | null {
  if (phone == null) return null;
  const trimmed = phone.trim();
  if (trimmed === '') return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('591') && /^[67]/.test(digits.slice(3))) {
    return `+591 ${digits.slice(3)}`;
  }
  return trimmed;
}

const TIME = () => dateFormat('time', { hour: '2-digit', minute: '2-digit' });
const DATE = () => dateFormat('date', { day: '2-digit', month: 'short' });
const DATE_LONG = () =>
  dateFormat('date-long', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
/** Fecha Y hora: en un negocio que cierra de madrugada, la zona importa. */
const DATE_TIME = () =>
  dateFormat('date-time', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function parse(iso: string): Date | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : null;
}

export function formatTime(iso: string): string {
  const d = parse(iso);
  return d ? TIME().format(d) : '--:--';
}

export function formatDate(iso: string): string {
  const d = parse(iso);
  return d ? DATE().format(d) : '';
}

export function formatDateTime(iso: string): string {
  const d = parse(iso);
  return d ? DATE_TIME().format(d) : '';
}

export function formatLongDate(nowMs: number): string {
  return DATE_LONG().format(new Date(nowMs));
}

export function deliveryTypeLabel(t: string): string {
  return t === 'delivery' ? 'Delivery' : 'Recojo';
}

/**
 * Formatea una distancia de ruta (metros enteros de la base) a kilómetros con
 * dos decimales, p. ej. `1627 → "1.63 km"`, `6169 → "6.17 km"`. Solo presentación
 * (información operativa del detalle). Defensivo: `null`/`undefined`/`NaN`/negativo
 * devuelven `null` para que la UI simplemente no muestre la fila (sin lanzar).
 */
export function formatDistanceKm(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return null;
  return `${(meters / 1000).toFixed(2)} km`;
}
