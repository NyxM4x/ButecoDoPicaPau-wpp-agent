'use client';

import type { ReactNode } from 'react';
import { setRestaurantProfile, type RestaurantProfile } from '@/lib/restaurant/profile';

/**
 * Lleva el perfil del restaurante al navegador.
 *
 * Los textos y los montos del menú leen `restaurantProfile()`. En el servidor
 * lo deja `profile-loader`; el navegador tiene su propia copia del módulo, y es
 * esta la que la llena. Se fija DURANTE el render, no en un efecto: un padre se
 * renderiza antes que sus hijos, así que cuando cualquier componente de dentro
 * pinta un precio el perfil ya está.
 *
 * El perfil no trae secretos: es lo mismo que el menú enseña.
 */
export function RestaurantProfileProvider({
  profile,
  children,
}: {
  profile: RestaurantProfile;
  children: ReactNode;
}) {
  setRestaurantProfile(profile);
  return <>{children}</>;
}
