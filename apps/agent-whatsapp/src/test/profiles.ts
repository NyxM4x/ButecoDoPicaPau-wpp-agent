import type { RestaurantProfile } from '@/lib/restaurant/profile';

const everyDay = (opens: string, closes: string) => Array.from({ length: 7 }, () => ({ opens, closes }));

/**
 * El restaurante con el que nacieron las pruebas del agente.
 *
 * Todas corren con este perfil (ver `setup.ts`): así siguen afirmando textos y
 * reglas concretas —un horario, una dirección, sin retiro ni efectivo— en vez
 * de comprobar plantillas vacías.
 */
export const DON_ZARCO_PROFILE: RestaurantProfile = {
  name: 'Don Zarco',
  description: 'un local de trancapechos cochabambinos en Santa Cruz, Bolivia',
  locale: 'es-BO',
  timezone: 'America/La_Paz',
  currency: { code: 'BOB', symbol: 'Bs' },
  phone: null,
  address: 'sobre la avenida Doble Vía La Guardia, frente al Hipermaxi Las Palmas',
  mapsUrl: 'https://maps.app.goo.gl/NL8foBoiySELVKMr8?g_st=ic',
  hoursText: 'todos los días, de siete de la tarde a cuatro de la madrugada',
  weekly: everyDay('19:00', '04:00'),
  ordersPaused: false,
  pickupEnabled: false,
  deliveryEnabled: true,
  paymentMethods: ['qr'],
  greeting: null,
  farewell: null,
  menuVideoUrl: 'https://demorestaurantagente.vercel.app/tutorialPedido.mp4?v=2',
  menuImageUrl: 'https://sarco-restaurant.vercel.app/menu/menu-cover.jpeg',
  logoUrl: '/brand/logo-don-zarco.png',
  reservationsEnabled: false,
};

/**
 * Un restaurante distinto en todo: otro nombre, otro país, otra moneda, otro
 * horario, con retiro y efectivo, y cerrado un día. Sirve para probar que nada
 * de Don Zarco quedó escrito en el código.
 */
export const OTHER_PROFILE: RestaurantProfile = {
  name: 'Buteco do Pica-Pau',
  description: 'un bar de comida brasileña en São Paulo',
  locale: 'pt-BR',
  timezone: 'America/Sao_Paulo',
  currency: { code: 'BRL', symbol: 'R$' },
  phone: '+5511900000000',
  address: 'Rua das Flores 100, Vila Madalena',
  mapsUrl: 'https://maps.example/buteco',
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
};
