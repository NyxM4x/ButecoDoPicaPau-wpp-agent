import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Toaster } from './components/ui';
import { canAccess, homeFor, useSession } from './lib/session';
import { CashRegisterPage } from './pages/CashRegister';
import { KitchenPage } from './pages/Kitchen';
import { LoginPage } from './pages/Login';
import { OrdersPage } from './pages/Orders';
import { SalePage } from './pages/Sale';
import { MenuPage } from './pages/admin/Menu';
import { PromotionsPage } from './pages/admin/Promotions';
import { SettingsPage } from './pages/admin/Settings';
import { StaffPage } from './pages/admin/Staff';

const PAGES = [
  { path: '/cocina', element: <KitchenPage /> },
  { path: '/venta', element: <SalePage /> },
  { path: '/pedidos', element: <OrdersPage /> },
  { path: '/caja', element: <CashRegisterPage /> },
  { path: '/menu', element: <MenuPage /> },
  { path: '/promociones', element: <PromotionsPage /> },
  { path: '/configuracion', element: <SettingsPage /> },
  { path: '/usuarios', element: <StaffPage /> },
];

export function App() {
  const user = useSession((state) => state.user);

  return (
    <>
      {user ? (
        <Routes>
          <Route element={<Layout />}>
            {/* Ocultar una ruta es comodidad, no seguridad: el backend igual responde 403. */}
            {PAGES.filter((page) => canAccess(user.role, page.path)).map((page) => (
              <Route key={page.path} path={page.path} element={page.element} />
            ))}
            <Route path="*" element={<Navigate to={homeFor(user.role)} replace />} />
          </Route>
        </Routes>
      ) : (
        <LoginPage />
      )}
      <Toaster />
    </>
  );
}
