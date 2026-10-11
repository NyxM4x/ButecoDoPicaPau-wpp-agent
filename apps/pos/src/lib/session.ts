import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Role, StaffUser } from './types';

interface SessionState {
  token: string | null;
  user: StaffUser | null;
  login: (token: string, user: StaffUser) => void;
  logout: () => void;
}

// El JWT dura 8 h (un turno) y no hay refresh: se guarda en el dispositivo
// para que un refresco a mitad de la venta no saque al cajero.
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'pos-session' },
  ),
);

export interface NavEntry {
  to: string;
  label: string;
  roles: Role[];
}

export const NAV: NavEntry[] = [
  { to: '/cocina', label: 'Cocina', roles: ['admin', 'kitchen', 'cashier'] },
  { to: '/venta', label: 'Venta', roles: ['admin', 'cashier'] },
  { to: '/pedidos', label: 'Pedidos', roles: ['admin', 'cashier', 'kitchen'] },
  { to: '/caja', label: 'Caja', roles: ['admin', 'cashier'] },
  { to: '/menu', label: 'Menú', roles: ['admin', 'kitchen'] },
  { to: '/promociones', label: 'Promociones', roles: ['admin'] },
  { to: '/configuracion', label: 'Configuración', roles: ['admin'] },
  { to: '/usuarios', label: 'Usuarios', roles: ['admin'] },
];

export function homeFor(role: Role): string {
  return role === 'cashier' ? '/venta' : '/cocina';
}

export function canAccess(role: Role, path: string): boolean {
  const entry = NAV.find((item) => item.to === path);
  return entry ? entry.roles.includes(role) : false;
}
