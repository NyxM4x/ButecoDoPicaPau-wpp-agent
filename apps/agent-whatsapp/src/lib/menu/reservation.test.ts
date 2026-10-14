import { describe, expect, it } from 'vitest';
import {
  EMPTY_RESERVATION,
  MAX_PARTY_SIZE,
  reservationDayLabel,
  reservationMessage,
  reservationUrl,
  todayIn,
  validateReservation,
  type ReservationFields,
} from './reservation';

const TODAY = '2026-10-14';
const valid: ReservationFields = { name: 'Ana Rojas', date: '2026-10-17', time: '20:30', people: 4, notes: '' };

describe('validateReservation', () => {
  it('un formulario completo no tiene errores', () => {
    expect(validateReservation(valid, TODAY)).toEqual({});
  });

  it('el formulario vacío pide nombre, día y hora', () => {
    expect(Object.keys(validateReservation(EMPTY_RESERVATION, TODAY)).sort()).toEqual(['date', 'name', 'time']);
  });

  it('se puede reservar para hoy, no para ayer', () => {
    expect(validateReservation({ ...valid, date: TODAY }, TODAY)).toEqual({});
    expect(validateReservation({ ...valid, date: '2026-10-13' }, TODAY).date).toBe('Ese día ya pasó.');
  });

  it('las personas son un entero de 1 al tope', () => {
    expect(validateReservation({ ...valid, people: 0 }, TODAY).people).toBeDefined();
    expect(validateReservation({ ...valid, people: 2.5 }, TODAY).people).toBeDefined();
    expect(validateReservation({ ...valid, people: MAX_PARTY_SIZE }, TODAY)).toEqual({});
    expect(validateReservation({ ...valid, people: MAX_PARTY_SIZE + 1 }, TODAY).people).toContain('escríbenos');
  });

  it('rechaza una hora o una nota que no sirven', () => {
    expect(validateReservation({ ...valid, time: '25:00' }, TODAY).time).toBeDefined();
    expect(validateReservation({ ...valid, notes: 'x'.repeat(201) }, TODAY).notes).toBeDefined();
  });
});

describe('el mensaje de la reserva', () => {
  it('dice el día con su nombre, en el idioma del local', () => {
    expect(reservationDayLabel('2026-10-17', 'es-BO')).toBe('sábado, 17 de octubre');
    // Una fecha que no se entiende viaja tal cual, no como «Invalid Date».
    expect(reservationDayLabel('pronto', 'es-BO')).toBe('pronto');
  });

  it('lleva todo lo que el local necesita para confirmar', () => {
    expect(reservationMessage({ ...valid, notes: '  Es un cumpleaños ' }, 'es-BO')).toBe(
      [
        'Hola, quiero reservar una mesa.',
        'Día: sábado, 17 de octubre',
        'Hora: 20:30',
        'Para: 4 personas',
        'A nombre de: Ana Rojas',
        'Nota: Es un cumpleaños',
      ].join('\n'),
    );
  });

  it('sin nota no deja la línea vacía, y una persona va en singular', () => {
    const message = reservationMessage({ ...valid, people: 1 }, 'es-BO');
    expect(message).toContain('Para: 1 persona\n');
    expect(message).not.toContain('Nota');
  });

  it('el enlace abre el chat con el mensaje escrito', () => {
    const url = reservationUrl('https://wa.me/59170010001', 'Hola, quiero reservar una mesa.\nDía: sábado');
    expect(url).toBe(
      'https://wa.me/59170010001?text=Hola%2C%20quiero%20reservar%20una%20mesa.%0AD%C3%ADa%3A%20s%C3%A1bado',
    );
  });
});

describe('todayIn', () => {
  it('es el día en la zona del local, no en la del navegador', () => {
    // 02:30 UTC del 14 son las 22:30 del 13 en La Paz.
    const instant = Date.UTC(2026, 9, 14, 2, 30);
    expect(todayIn('America/La_Paz', instant)).toBe('2026-10-13');
    expect(todayIn('UTC', instant)).toBe('2026-10-14');
  });

  it('una zona desconocida no rompe el formulario', () => {
    expect(todayIn('Marte/Olimpo', Date.UTC(2026, 9, 14, 12))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
