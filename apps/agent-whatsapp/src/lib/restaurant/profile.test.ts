import { describe, expect, it } from 'vitest';
import type { CentralRestaurantProfile } from '@/lib/central/contract';
import { DON_ZARCO_PROFILE, OTHER_PROFILE } from '@/test/profiles';
import { hoursInWords, localClock, scheduleSentence, serviceMomentAt, utcOffsetMs } from './hours';
import {
  cashEnabled,
  money,
  nameKeywords,
  profileFromCentral,
  profileFromEnv,
  publicAppUrl,
  restaurantProfile,
  setRestaurantProfile,
} from './profile';

const CENTRAL: CentralRestaurantProfile = {
  contractVersion: 'v1',
  name: 'Buteco do Pica-Pau',
  description: 'un bar de comida brasileña',
  locale: 'es-BO',
  timezone: 'America/La_Paz',
  currency: { code: 'BOB', symbol: 'Bs' },
  phone: null,
  location: { address: 'Calle 1', mapsUrl: 'https://maps.example/b', latitude: -17.7, longitude: -63.1 },
  hours: { text: null, weekly: [null, ...Array.from({ length: 6 }, () => ({ opens: '18:00', closes: '01:00' }))] },
  ordering: { paused: true, pickupEnabled: true, deliveryEnabled: false, paymentMethods: ['qr', 'cash'] },
  messages: { greeting: '¡Bem-vindo!', farewell: null },
  menuMedia: { videoUrl: null, imageUrl: null },
};

describe('perfil del restaurante: de dónde sale', () => {
  it('sin nada configurado hay un perfil neutro, que no nombra a nadie', () => {
    const profile = profileFromEnv({});
    expect(profile.name).toBe('nuestro local');
    expect(profile.currency).toEqual({ code: 'BOB', symbol: 'Bs' });
    expect(profile.paymentMethods).toEqual(['cash', 'qr']);
    // Sin horario declarado figura abierto siempre: quien decide si se toma un
    // pedido es el POS, no este respaldo.
    expect(profile.weekly).toHaveLength(7);
    expect(scheduleSentence(profile)).toBe('todos los días, las 24 horas');
  });

  it('las variables RESTAURANT_* arman el perfil cuando no hay POS', () => {
    const profile = profileFromEnv({
      RESTAURANT_NAME: ' Buteco ',
      RESTAURANT_OPENS: '18:00',
      RESTAURANT_CLOSES: '02:00',
      RESTAURANT_CLOSED_DAYS: '1',
      RESTAURANT_PAYMENT_METHODS: 'qr, CASH, bitcoin',
      RESTAURANT_PICKUP_ENABLED: 'false',
      RESTAURANT_CURRENCY_SYMBOL: 'R$',
    });
    expect(profile.name).toBe('Buteco');
    expect(profile.weekly[1]).toBeNull();
    expect(profile.weekly[2]).toEqual({ opens: '18:00', closes: '02:00' });
    // Siempre en el mismo orden, y sin lo que no existe.
    expect(profile.paymentMethods).toEqual(['cash', 'qr']);
    expect(profile.pickupEnabled).toBe(false);
    expect(money(18.5, profile)).toBe('R$ 18.5');
  });

  it('lo que trae el POS manda, y lo que deja vacío cae al entorno', () => {
    const profile = profileFromCentral(CENTRAL, {
      MENU_VIDEO_URL: 'https://agente.example/video.mp4',
      RESTAURANT_LOGO_URL: 'https://agente.example/logo.png',
      RESTAURANT_RESERVATIONS_ENABLED: 'true',
      RESTAURANT_ADDRESS: 'no debe usarse',
    });
    expect(profile).toMatchObject({
      name: 'Buteco do Pica-Pau',
      address: 'Calle 1',
      ordersPaused: true,
      pickupEnabled: true,
      deliveryEnabled: false,
      paymentMethods: ['cash', 'qr'],
      greeting: '¡Bem-vindo!',
      // El POS no tiene video: no le borra al agente el suyo.
      menuVideoUrl: 'https://agente.example/video.mp4',
      // El logo y las reservas no son del contrato: salen siempre del entorno.
      logoUrl: 'https://agente.example/logo.png',
      reservationsEnabled: true,
    });
    expect(profile.weekly[0]).toBeNull();
  });

  it('un horario mal formado del POS no rompe nada: vale el del entorno', () => {
    const roto = { ...CENTRAL, hours: { text: null, weekly: [{ opens: '25:00', closes: 'x' }] } } as never;
    expect(profileFromCentral(roto, { RESTAURANT_OPENS: '10:00', RESTAURANT_CLOSES: '22:00' }).weekly[3]).toEqual({
      opens: '10:00',
      closes: '22:00',
    });
  });

  it('el perfil vigente es el último que se fijó', () => {
    setRestaurantProfile(OTHER_PROFILE);
    expect(restaurantProfile().name).toBe('Buteco do Pica-Pau');
    expect(cashEnabled()).toBe(true);
    expect(money(25)).toBe('R$ 25');
    setRestaurantProfile(DON_ZARCO_PROFILE);
    expect(cashEnabled()).toBe(false);
    expect(money(57)).toBe('Bs. 57');
  });

  it('la URL pública sale de APP_BASE_URL, del dominio de Vercel o de localhost', () => {
    expect(publicAppUrl({ APP_BASE_URL: 'https://buteco.example/' })).toBe('https://buteco.example');
    expect(publicAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'buteco.vercel.app' })).toBe('https://buteco.vercel.app');
    expect(publicAppUrl({})).toBe('http://localhost:3000');
  });

  it('reconoce cómo nombra la gente al local, sin artículos ni palabras cortas', () => {
    expect(nameKeywords(DON_ZARCO_PROFILE)).toEqual(['don zarco', 'zarco']);
    expect(nameKeywords(OTHER_PROFILE)).toEqual(['buteco do pica pau', 'buteco']);
  });
});

describe('horario del restaurante', () => {
  it('la hora local sale de la zona del perfil', () => {
    const instante = Date.parse('2026-09-02T23:00:00.000Z'); // miércoles 19:00 en Bolivia, 20:00 en São Paulo
    expect(utcOffsetMs(instante, DON_ZARCO_PROFILE)).toBe(4 * 3_600_000);
    expect(localClock(instante, DON_ZARCO_PROFILE)).toEqual({ weekday: 3, minutes: 19 * 60 });
    expect(localClock(instante, OTHER_PROFILE)).toEqual({ weekday: 3, minutes: 20 * 60 });
  });

  it('dice el horario según lo que tenga el perfil', () => {
    expect(scheduleSentence(DON_ZARCO_PROFILE)).toBe('todos los días de 19:00 a 04:00');
    // El texto que escribió el local es el que repite el asistente.
    expect(hoursInWords(DON_ZARCO_PROFILE)).toBe('todos los días, de siete de la tarde a cuatro de la madrugada');
    // Sin texto propio, se arma del horario semanal, con el día cerrado.
    expect(hoursInWords(OTHER_PROFILE)).toBe('de martes a domingo de 18:00 a 02:00 (lunes cerrado)');
  });

  it('horas distintas según el día se dicen día por día', () => {
    const profile = {
      ...OTHER_PROFILE,
      weekly: OTHER_PROFILE.weekly.map((day, index) => (index === 6 ? { opens: '12:00', closes: '03:00' } : day)),
    };
    expect(scheduleSentence(profile)).toContain('sábado de 12:00 a 03:00');
    expect(scheduleSentence(profile)).toContain('lunes cerrado');
  });

  it('un día cerrado no se anuncia como "abrimos hoy"', () => {
    // Lunes 15:00 en São Paulo: el lunes no abre, el martes sí.
    const lunes = Date.parse('2026-09-07T18:00:00.000Z');
    expect(serviceMomentAt(lunes, OTHER_PROFILE)).toEqual({ kind: 'closed', opens: '18:00', opensInDays: 1, opensWeekday: 2 });
    // Pero el turno del domingo sigue hasta las 02:00 del lunes.
    const madrugadaDelLunes = Date.parse('2026-09-07T04:00:00.000Z'); // lunes 01:00
    expect(serviceMomentAt(madrugadaDelLunes, OTHER_PROFILE)).toEqual({ kind: 'open' });
  });

  it('abierto las 24 horas no tiene franjas de cierre', () => {
    const siempre = { ...OTHER_PROFILE, weekly: Array.from({ length: 7 }, () => ({ opens: '00:00', closes: '00:00' })) };
    for (let hora = 0; hora < 24; hora += 1) {
      const instante = Date.parse(`2026-09-08T${String(hora).padStart(2, '0')}:55:00.000Z`);
      expect(serviceMomentAt(instante, siempre), `hora ${hora}`).toEqual({ kind: 'open' });
    }
  });
});
