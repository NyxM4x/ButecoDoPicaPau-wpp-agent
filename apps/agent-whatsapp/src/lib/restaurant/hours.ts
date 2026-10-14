/**
 * EL HORARIO DEL RESTAURANTE — módulo PURO.
 *
 * La hora local del negocio y su horario semanal, leídos del perfil. Antes eran
 * el desfase fijo de Bolivia y las horas de la demo.
 *
 * El instante llega siempre como argumento: una función que consulta el reloj
 * por su cuenta no se puede probar, y aquí hay que poder afirmar qué pasa el
 * minuto antes y el minuto después de cada frontera.
 */
import { restaurantProfile, type DayHours, type RestaurantProfile } from './profile';

const MINUTES_PER_DAY = 1440;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/**
 * Cuánto hay que RESTARLE a un instante UTC para leerlo como hora local del
 * negocio (Bolivia: 4 horas). Se calcula por instante porque hay países con
 * horario de verano. Una zona que el entorno no conoce cae a Bolivia, que es
 * lo que el código asumía antes.
 */
export function utcOffsetMs(ms: number, profile: RestaurantProfile = restaurantProfile()): number {
  try {
    const parts = formatterFor(profile.timezone).formatToParts(new Date(ms));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
    const offset = Math.floor(ms / 1000) * 1000 - asUtc;
    return Number.isFinite(offset) ? offset : 4 * 3_600_000;
  } catch {
    return 4 * 3_600_000;
  }
}

/** Día de la semana (0 = domingo) y minutos desde medianoche, en hora del negocio. */
export function localClock(ms: number, profile: RestaurantProfile = restaurantProfile()): { weekday: number; minutes: number } {
  const local = new Date(ms - utcOffsetMs(ms, profile));
  return { weekday: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

const toMinutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** Cuánto dura el turno que abre ese día. Misma hora de apertura y cierre = 24 horas. */
function shiftLength(day: DayHours): number {
  return (toMinutes(day.closes) - toMinutes(day.opens) + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
}

interface Shift {
  /** Minutos desde la medianoche de HOY (negativo = empezó ayer). */
  start: number;
  end: number;
  opens: string;
  closes: string;
}

/** Los turnos de ayer, hoy y mañana, en minutos relativos a la medianoche de hoy. */
function shiftsAround(weekday: number, profile: RestaurantProfile): Shift[] {
  const shifts: Shift[] = [];
  for (const offset of [-1, 0, 1]) {
    const day = profile.weekly[(weekday + offset + 7) % 7];
    if (!day) continue;
    const start = offset * MINUTES_PER_DAY + toMinutes(day.opens);
    shifts.push({ start, end: start + shiftLength(day), opens: day.opens, closes: day.closes });
  }
  return shifts;
}

const covers = (shifts: Shift[], minute: number): boolean => shifts.some((shift) => minute >= shift.start && minute < shift.end);

export type ServiceMoment =
  /** Se está atendiendo. */
  | { kind: 'open' }
  /** Falta media hora o menos para abrir. */
  | { kind: 'opening'; opens: string }
  /** El cierre está encima, o acaba de pasar: puede que todavía alcance. */
  | { kind: 'after_hours'; closes: string }
  /**
   * Cerrado. `opens` es la hora de la próxima apertura y `opensInDays` cuántos
   * días faltan (0 = hoy, 1 = mañana). `opens: null` = no abre ningún día.
   */
  | { kind: 'closed'; opens: string | null; opensInDays: number; opensWeekday: number };

/** Media hora antes de abrir ya se puede ir armando el pedido. */
export const OPENING_MARGIN_MINUTES = 30;
/** El aviso de cierre empieza diez minutos antes y dura un cuarto de hora después. */
export const CLOSING_SOON_MINUTES = 10;
export const AFTER_CLOSE_MINUTES = 15;

/**
 * En qué momento del servicio cae un instante.
 *
 * Las franjas son cerradas por abajo y abiertas por arriba: a la hora exacta de
 * apertura el local ya abrió. Y se tocan sin dejar un minuto mudo: fuera del
 * servicio siempre hay algo que decirle al cliente.
 */
export function serviceMomentAt(ms: number, profile: RestaurantProfile = restaurantProfile()): ServiceMoment {
  const { weekday, minutes } = localClock(ms, profile);
  const shifts = shiftsAround(weekday, profile);
  const openNow = covers(shifts, minutes);

  if (openNow && covers(shifts, minutes + CLOSING_SOON_MINUTES)) return { kind: 'open' };

  const upcoming = shifts.find((shift) => shift.start > minutes && shift.start - minutes <= OPENING_MARGIN_MINUTES);
  if (!openNow && upcoming) return { kind: 'opening', opens: upcoming.opens };

  const closing = shifts.find(
    (shift) => minutes >= shift.end - CLOSING_SOON_MINUTES && minutes < shift.end + AFTER_CLOSE_MINUTES,
  );
  if (closing) return { kind: 'after_hours', closes: closing.closes };

  // La próxima apertura puede estar a varios días: un local que cierra lunes y
  // martes abre "el miércoles", no "mañana".
  for (let days = 0; days <= 7; days += 1) {
    const day = profile.weekly[(weekday + days) % 7];
    if (day && (days > 0 || toMinutes(day.opens) > minutes)) {
      return { kind: 'closed', opens: day.opens, opensInDays: days, opensWeekday: (weekday + days) % 7 };
    }
  }
  return { kind: 'closed', opens: null, opensInDays: 0, opensWeekday: weekday };
}

// ── El horario en palabras ──────────────────────────────────────────────────

export const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const sameHours = (a: DayHours | null, b: DayHours | null): boolean =>
  a === b || (a !== null && b !== null && a.opens === b.opens && a.closes === b.closes);
const range = (day: DayHours): string => (day.opens === day.closes ? 'las 24 horas' : `de ${day.opens} a ${day.closes}`);

/**
 * El horario como lo dice un mensaje automático: `todos los días de 19:00 a
 * 04:00`, o `martes a domingo de 19:00 a 02:00 (lunes cerrado)`.
 *
 * Se DERIVA del horario semanal en vez de escribirse aparte: una copia a mano
 * se queda desactualizada el día que cambia la hora.
 */
export function scheduleSentence(profile: RestaurantProfile = restaurantProfile()): string {
  const open = profile.weekly.map((day, index) => ({ day, index })).filter((entry) => entry.day !== null);
  if (open.length === 0) return 'sin horario de atención por ahora';

  const first = open[0].day as DayHours;
  const uniform = open.every((entry) => sameHours(entry.day, first));
  const closed = profile.weekly.map((day, index) => (day === null ? DAY_NAMES[index] : null)).filter(Boolean);

  if (uniform && closed.length === 0) {
    return first.opens === first.closes ? 'todos los días, las 24 horas' : `todos los días ${range(first)}`;
  }
  if (uniform) {
    const cerrado = closed.length === 1 ? `${closed[0]} cerrado` : `${closed.slice(0, -1).join(', ')} y ${closed.at(-1)} cerrado`;
    return `${openDaysLabel(profile.weekly)} ${range(first)} (${cerrado})`;
  }
  // Horas distintas según el día: se dice día por día, de lunes a domingo.
  return [1, 2, 3, 4, 5, 6, 0]
    .map((index) => {
      const day = profile.weekly[index];
      return `${DAY_NAMES[index]} ${day ? range(day) : 'cerrado'}`;
    })
    .join('; ');
}

/** "martes a domingo" si los días abiertos son seguidos (la semana empieza en lunes); si no, la lista. */
function openDaysLabel(weekly: Array<DayHours | null>): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const openPositions = order.map((index, position) => (weekly[index] ? position : -1)).filter((position) => position >= 0);
  const names = openPositions.map((position) => DAY_NAMES[order[position]]);
  const consecutive = openPositions.every((position, i) => i === 0 || position === openPositions[i - 1] + 1);
  if (names.length === 1) return `los ${names[0]}`;
  if (consecutive && names.length > 2) return `de ${names[0]} a ${names.at(-1)}`;
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

/**
 * El horario como lo REPITE el asistente al conversar: el texto que escribió el
 * local, o el derivado si no escribió ninguno.
 */
export function hoursInWords(profile: RestaurantProfile = restaurantProfile()): string {
  return profile.hoursText ?? scheduleSentence(profile);
}
