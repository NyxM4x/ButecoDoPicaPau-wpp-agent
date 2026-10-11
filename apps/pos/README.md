# POS

Venta de mostrador, cocina (KDS), caja, pedidos y administración del menú.
Es un cliente del backend central (`apps/backend`): no guarda datos propios ni
recalcula precios ni totales.

```powershell
npm ci
npm run dev        # http://localhost:5180, con el backend en http://localhost:3100
npm test           # pruebas unitarias (vitest)
npm run typecheck
npm run build      # deja el sitio estático en dist/
```

## Configuración

| Variable | Para qué |
|---|---|
| `POS_BACKEND_URL` | Desarrollo: a dónde reenvía Vite las llamadas a `/api`. Por defecto `http://localhost:3100`. |
| `VITE_API_URL` | Producción: URL pública del backend. Ese origen debe estar en `CORS_ORIGINS` del backend. |
| `VITE_RESTAURANT_NAME` | Nombre de respaldo. El real se cambia en Configuración y vive en el backend. |

## Cómo está armado

- `src/lib/api.ts`: cliente HTTP. Manda el JWT, deja los errores en una sola
  forma y cierra la sesión ante un 401.
- `src/lib/cart.ts`: carrito (Zustand, sobrevive a un refresco) y el cuerpo
  exacto de `POST /orders`.
- `src/lib/kitchen.ts`: reglas del tablero de cocina, sin React.
- `src/lib/queries.ts`: consultas compartidas (TanStack Query). No hay
  websockets: la cocina consulta cada 5 s.
- `src/pages/`: una pantalla por archivo. `src/components/ui.tsx`: botones,
  campos, modal y avisos.

El contrato del backend y sus trampas están en
`apps/backend/docs/pos-integration.md` y `pos-frontend-handoff.md`.

## Roles

| Rol | Ve |
|---|---|
| `admin` | todo |
| `cashier` | Cocina (sin mover pedidos), Venta, Pedidos, Caja |
| `kitchen` | Cocina, Pedidos, Menú (solo marcar agotado) |

Ocultar una pantalla es comodidad: el permiso real lo decide el backend.
