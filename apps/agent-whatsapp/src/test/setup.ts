import { beforeEach } from 'vitest';
import { setRestaurantProfile } from '@/lib/restaurant/profile';
import { BASE_PROFILE } from './profiles';

// La URL pública y el QR fijo con los que se escribieron las pruebas.
process.env.APP_BASE_URL = 'https://buteco-agente.vercel.app';
process.env.PAYMENT_QR_URL = 'https://buteco-agente.vercel.app/payment/qr-2026.jpeg';

// Cada prueba empieza con el mismo restaurante. La que necesite otro lo fija
// ella misma con `setRestaurantProfile` y no tiene que restaurar nada.
setRestaurantProfile(BASE_PROFILE);
beforeEach(() => setRestaurantProfile(BASE_PROFILE));
