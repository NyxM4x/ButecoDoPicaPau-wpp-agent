import { LogOut, Menu as MenuIcon, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ROLE_LABEL } from '../lib/format';
import { useRestaurantName } from '../lib/restaurant';
import { NAV, useSession } from '../lib/session';
import { useCashSession } from '../lib/queries';
import { cx } from './ui';

export function Layout() {
  const user = useSession((state) => state.user);
  const logout = useSession((state) => state.logout);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const cash = useCashSession();
  const restaurantName = useRestaurantName();

  if (!user) return null;
  const links = NAV.filter((entry) => entry.roles.includes(user.role));

  const exit = () => {
    logout();
    queryClient.clear();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="z-30 bg-slate-900 text-white print:hidden">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <button type="button" aria-label="Abrir menú" className="rounded-md p-2 hover:bg-white/10 lg:hidden" onClick={() => setOpen((value) => !value)}>
            {open ? <X className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
          <span className="truncate text-base font-bold tracking-tight">{restaurantName}</span>

          <nav className="ml-4 hidden items-center gap-1 lg:flex">
            {links.map((entry) => (
              <NavLink
                key={entry.to}
                to={entry.to}
                className={({ isActive }) =>
                  cx('rounded-md px-3 py-1.5 text-sm font-medium', isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white')
                }
              >
                {entry.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {cash.data !== undefined && (
              <span
                className={cx(
                  'hidden rounded-md px-2 py-1 text-xs font-semibold sm:inline',
                  cash.data ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300',
                )}
              >
                {cash.data ? 'Caja abierta' : 'Caja cerrada'}
              </span>
            )}
            <span className="hidden text-right text-xs leading-tight sm:block">
              <span className="block font-semibold">{user.username}</span>
              <span className="text-slate-400">{ROLE_LABEL[user.role]}</span>
            </span>
            <button type="button" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={exit} className="rounded-md p-2 text-slate-300 hover:bg-white/10 hover:text-white">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>

        {open && (
          <nav className="grid grid-cols-2 gap-1 border-t border-white/10 p-2 lg:hidden">
            {links.map((entry) => (
              <NavLink
                key={entry.to}
                to={entry.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cx('rounded-md px-3 py-2 text-sm font-medium', isActive ? 'bg-brand-600 text-white' : 'text-slate-200 hover:bg-white/10')
                }
              >
                {entry.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-7xl p-3 sm:p-5', className)}>{children}</div>;
}
