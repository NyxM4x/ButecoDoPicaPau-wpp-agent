import 'server-only';
import { isCentralEnabled, loadCentralProfile } from '@/lib/central';
import { log } from '@/lib/log';
import { profileFromCentral, restaurantProfile, setRestaurantProfile, type RestaurantProfile } from './profile';

/**
 * Trae el perfil del POS y lo deja vigente (`restaurantProfile()`).
 *
 * Se llama al entrar cada petición que le habla al cliente: el webhook, los
 * trabajadores, el menú. Con la copia fresca no hace red, así que llamarla de
 * más no cuesta nada.
 *
 * ── Por qué un minuto ────────────────────────────────────────────────────────
 *
 * El perfil lleva la pausa de pedidos, que el local enciende cuando la cocina
 * no da abasto: tiene que notarse pronto. Lo demás (nombre, horario) casi
 * nunca cambia, pero una sola lectura por minuto y por instancia es barata.
 */
const FRESH_MS = 60_000;
/** Tras un fallo se reintenta antes: lo vigente puede ser el respaldo del entorno. */
const RETRY_MS = 10_000;
/** Corto: de esto depende contestarle al cliente, y si falla hay respaldo. */
const TIMEOUT_MS = 4_000;

let checkAgainAt = 0;
let inflight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  try {
    setRestaurantProfile(profileFromCentral(await loadCentralProfile({ timeoutMs: TIMEOUT_MS })));
    checkAgainAt = Date.now() + FRESH_MS;
  } catch (error) {
    // Se queda el perfil que había: el último bueno, o el del entorno.
    log.warn('restaurant.profile_unavailable', {
      code: (error as { code?: unknown } | null)?.code ?? 'unknown',
    });
    checkAgainAt = Date.now() + RETRY_MS;
  }
}

/** El perfil vigente, refrescado si hace falta. NUNCA lanza. */
export async function ensureRestaurantProfile(): Promise<RestaurantProfile> {
  if (isCentralEnabled() && Date.now() >= checkAgainAt) {
    inflight ??= refresh().finally(() => {
      inflight = null;
    });
    await inflight;
  }
  return restaurantProfile();
}
