import { useEffect } from 'react';
import { RESTAURANT_NAME } from './format';
import { useSettings } from './queries';
import { useSession } from './session';

const STORAGE_KEY = 'pos-restaurant-name';

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Nombre del local. Vive en la configuración del backend, así cambia solo al
 * cargar otra demo. Se recuerda en el dispositivo porque la pantalla de login
 * todavía no puede consultar el backend.
 */
export function useRestaurantName(): string {
  const loggedIn = useSession((state) => state.token !== null);
  const name = useSettings(loggedIn).data?.restaurantName;

  useEffect(() => {
    if (!name) return;
    document.title = `${name} · POS`;
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // Sin almacenamiento (modo privado): solo se pierde el nombre en el login.
    }
  }, [name]);

  return name ?? remembered() ?? RESTAURANT_NAME;
}
