import type { RestaurantProfile } from '@/lib/restaurant/profile';

const everyDay = (opens: string, closes: string) => Array.from({ length: 7 }, () => ({ opens, closes }));

/**
 * El restaurante con el que corren las pruebas del agente.
 *
 * Todas corren con este perfil (ver `setup.ts`): así siguen afirmando textos y
 * reglas concretas —un horario, una dirección, sin retiro ni efectivo— en vez
 * de comprobar plantillas vacías.
 *
 * El nombre es el del cliente; la dirección, el enlace y el horario son de
 * EJEMPLO (todavía no los tenemos). Las reglas —sin retiro, solo QR, abierto
 * de noche hasta la madrugada— son las que las pruebas necesitan ejercitar.
 */
export const BASE_PROFILE: RestaurantProfile = {
  name: 'Buteco do Pica-Pau',
  description: 'un buteco de tablas y carnes en Santa Cruz, Bolivia',
  locale: 'es-BO',
  timezone: 'America/La_Paz',
  currency: { code: 'BOB', symbol: 'Bs' },
  phone: null,
  address: 'sobre la avenida Banzer, a media cuadra del tercer anillo',
  mapsUrl: 'https://maps.app.goo.gl/EjemploButeco123?g_st=ic',
  hoursText: 'todos los días, de siete de la tarde a cuatro de la madrugada',
  weekly: everyDay('19:00', '04:00'),
  ordersPaused: false,
  pickupEnabled: false,
  deliveryEnabled: true,
  paymentMethods: ['qr'],
  greeting: null,
  farewell: null,
  menuVideoUrl: 'https://agente-buteco.example/tutorial.mp4?v=2',
  menuImageUrl: 'https://agente-buteco.example/menu/menu-cover.jpeg',
  logoUrl: '/brand/logo.png',
  reservationsEnabled: false,
  facts: [],
};

/**
 * Un restaurante distinto en todo: otro nombre, otro país, otra moneda, otro
 * horario, con retiro y efectivo, y cerrado un día. Sirve para probar que nada
 * del perfil de arriba quedó escrito en el código.
 */
export const OTHER_PROFILE: RestaurantProfile = {
  name: 'Bar do Zé',
  description: 'un bar de comida brasileña en São Paulo',
  locale: 'pt-BR',
  timezone: 'America/Sao_Paulo',
  currency: { code: 'BRL', symbol: 'R$' },
  phone: '+5511900000000',
  address: 'Rua das Flores 100, Vila Madalena',
  mapsUrl: 'https://maps.example/bar-do-ze',
  hoursText: null,
  weekly: [{ opens: '18:00', closes: '02:00' }, null, ...everyDay('18:00', '02:00').slice(2)],
  ordersPaused: false,
  pickupEnabled: true,
  deliveryEnabled: true,
  paymentMethods: ['cash', 'qr'],
  greeting: null,
  farewell: null,
  menuVideoUrl: null,
  menuImageUrl: null,
  logoUrl: null,
  reservationsEnabled: true,
  facts: ['Las mesas se reservan por WhatsApp; las confirma una persona del bar.'],
};
