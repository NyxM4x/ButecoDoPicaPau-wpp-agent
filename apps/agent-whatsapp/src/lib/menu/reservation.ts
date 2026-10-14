/**
 * Reserva de mesa desde el menú — módulo PURO.
 *
 * El formulario no guarda nada: arma un mensaje y abre el chat de WhatsApp del
 * local con ese texto escrito. La reserva queda pedida cuando el cliente toca
 * «enviar» en WhatsApp, y la confirma una persona del local. Aquí viven la
 * validación del formulario y la redacción del mensaje.
 */

export interface ReservationFields {
  name: string;
  /** `YYYY-MM-DD`, como lo entrega un `<input type="date">`. */
  date: string;
  /** `HH:mm`, como lo entrega un `<input type="time">`. */
  time: string;
  people: number;
  notes: string;
}

export type ReservationErrors = Partial<Record<keyof ReservationFields, string>>;

/** Más que esto ya no es una mesa: es un evento, y se conversa. */
export const MAX_PARTY_SIZE = 30;
export const MAX_NOTES_LENGTH = 200;

export const EMPTY_RESERVATION: ReservationFields = { name: '', date: '', time: '', people: 2, notes: '' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** La fecha de hoy (`YYYY-MM-DD`) en la zona del local: es el mínimo que se puede reservar. */
export function todayIn(timezone: string, now: Date | number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(now);
  }
}

/** Lo que le falta al formulario para poder enviarse. Vacío = está completo. */
export function validateReservation(fields: ReservationFields, today: string): ReservationErrors {
  const errors: ReservationErrors = {};
  if (fields.name.trim().length < 2) errors.name = 'Dinos a nombre de quién va la reserva.';
  if (!DATE.test(fields.date)) errors.date = 'Elige el día.';
  else if (fields.date < today) errors.date = 'Ese día ya pasó.';
  if (!TIME.test(fields.time)) errors.time = 'Elige la hora.';
  if (!Number.isInteger(fields.people) || fields.people < 1) errors.people = 'Dinos cuántas personas son.';
  else if (fields.people > MAX_PARTY_SIZE) {
    errors.people = `Para más de ${MAX_PARTY_SIZE} personas escríbenos y lo coordinamos.`;
  }
  if (fields.notes.length > MAX_NOTES_LENGTH) errors.notes = `Hasta ${MAX_NOTES_LENGTH} caracteres.`;
  return errors;
}

/** «sábado 18 de octubre», en el idioma del local. */
export function reservationDayLabel(date: string, locale: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return date;
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(day);
}

/**
 * El mensaje que queda escrito en WhatsApp. Empieza diciendo qué se quiere:
 * es lo que lee primero quien atiende el chat.
 */
export function reservationMessage(fields: ReservationFields, locale: string): string {
  const people = `${fields.people} ${fields.people === 1 ? 'persona' : 'personas'}`;
  const notes = fields.notes.trim();
  return [
    'Hola, quiero reservar una mesa.',
    `Día: ${reservationDayLabel(fields.date, locale)}`,
    `Hora: ${fields.time}`,
    `Para: ${people}`,
    `A nombre de: ${fields.name.trim()}`,
    ...(notes ? [`Nota: ${notes}`] : []),
  ].join('\n');
}

/** El chat del local con el mensaje ya escrito. `chatUrl` es un enlace `wa.me`. */
export function reservationUrl(chatUrl: string, message: string): string {
  return `${chatUrl}${chatUrl.includes('?') ? '&' : '?'}text=${encodeURIComponent(message)}`;
}
