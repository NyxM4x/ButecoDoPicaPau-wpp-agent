import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Category, CurrentCashSession, OperationalSettings, Product, Promotion } from './types';

// Claves de caché compartidas entre pantallas. No hay websockets en el
// backend: lo que tiene que verse al día se refresca por intervalo.

export const keys = {
  categories: (all: boolean) => ['categories', all] as const,
  products: (all: boolean) => ['products', all] as const,
  promotions: ['promotions'] as const,
  cashCurrent: ['cash', 'current'] as const,
  cashHistory: ['cash', 'history'] as const,
  settings: ['settings'] as const,
  kitchen: ['orders', 'kitchen'] as const,
  orders: (filter: string) => ['orders', 'list', filter] as const,
  lateRequests: ['late-order-requests'] as const,
  staff: ['staff'] as const,
};

export function useCategories(includeInactive = false) {
  return useQuery({
    queryKey: keys.categories(includeInactive),
    queryFn: ({ signal }) => api.get<Category[]>(`/categories${includeInactive ? '?includeInactive=true' : ''}`, signal),
  });
}

export function useProducts(includeInactive = false) {
  return useQuery({
    queryKey: keys.products(includeInactive),
    queryFn: ({ signal }) => api.get<Product[]>(`/products${includeInactive ? '?includeInactive=true' : ''}`, signal),
  });
}

/** `GET /promotions` no filtra: devuelve también archivadas, inactivas y vencidas. */
export function usePromotions() {
  return useQuery({ queryKey: keys.promotions, queryFn: ({ signal }) => api.get<Promotion[]>('/promotions', signal) });
}

export function useCashSession() {
  return useQuery({
    queryKey: keys.cashCurrent,
    queryFn: ({ signal }) => api.get<CurrentCashSession | null>('/cash-register/sessions/current', signal),
    refetchInterval: 30_000,
  });
}

export function useSettings(enabled = true) {
  return useQuery({
    queryKey: keys.settings,
    queryFn: ({ signal }) => api.get<OperationalSettings>('/operational-settings', signal),
    enabled,
    refetchInterval: 60_000,
  });
}

export function byOrder<T extends { sortOrder: number; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'));
}
