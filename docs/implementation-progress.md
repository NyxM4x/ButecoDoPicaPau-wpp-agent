# Avance de implementación

Última actualización: 2026-10-11.

## Dónde estamos

**Hay una demo que funciona de punta a punta en local, sin WhatsApp real:**
backend + POS + cargador de demos, y desde el 2026-10-11 el menú web del agente
lee el catálogo del backend y crea ahí los pedidos (Fase 5, primera mitad).
Falta probarlo con WhatsApp de verdad: hacen falta las credenciales del agente.

El plan maestro pedía contratos primero (Fase 1) y POS después (Fase 4). El
usuario pidió el 2026-10-02 una demo usable ya: menús, fotos y datos
cambiables en segundos, y la cocina del POS mostrando lo que entra por
WhatsApp. Por eso se construyó primero el POS contra el contrato real del
backend, y `packages/contracts` queda para cuando el agente también lo use.

## Reorganización del 2026-10-02: repo nuevo `restaurant-demos`

El repo `NyxM4x/Demo_MonoRepoRestaurant` desapareció de GitHub (404), igual
que `rochayoan/backend-central-zarco-dev`. Se armó un repo nuevo, **privado**,
`NyxM4x/restaurant-demos`, **con historial limpio** (un commit inicial). El
historial anterior (359 commits) quedó en un `.zip` local.

Qué entró:

- `apps/backend` ← árbol de `33a9da7` de `backend-central-zarco-dev`.
- `apps/agent-whatsapp` ← `NyxM4x/sarcoRestaurant` @ `main` **`5cb2943`**
  (2026-09-28). Trae el efectivo apagado (solo QR) y «hoy no atendemos» con la
  pausa. Lo de «solo QR» debe volverse una opción por restaurante.
- `docs/` y `docs/CLAUDE_MONOREPO_CONTEXT.md` (el plan maestro).

Qué quedó afuera a propósito: la colección de Postman (tenía `adminPassword`
y `posToken`), el PDF de Baneco, las carpetas `fotos_*` (el código no las
usa), los workflows `.github` del backend (corrían sobre otra rama y en una
subcarpeta GitHub no los ejecuta) y `READMEZARCOV01.md`.

## Qué se hizo el 2026-10-02

### Entorno local (sesión de la madrugada, cortada por un fallo de red)

- Dependencias instaladas en backend y agente.
- `.gitattributes` con `eol=lf`: con CRLF fallaba `migration-0039.test.ts`
  del agente, que lee una migración SQL como texto.
- La base de Supabase de demos no existe más → `scripts/dev-db.ps1` levanta un
  PostgreSQL aislado en el puerto 54329 (datos en `.local/`, ignorado por git).
- `apps/backend/.env.dev` (fuera de git) y `npm run start:local`.
- `demos/don-zarco` y `demos/cafe-central` + `scripts/load-demo.mjs`: carga un
  perfil por la misma API que usa el POS. Ida y vuelta entre demos: 2 s.
- La sesión se cortó al instalar el POS (error de certificado SSL contra la
  API de Claude, de las 09:07 a las 10:06 UTC). Quedó solo
  `apps/pos/package.json`.

### POS (`apps/pos`)

Vite + React 19 + TypeScript + Tailwind 4 + React Router + TanStack Query +
Zustand. Sin shadcn ni react-hook-form: los componentes base son propios y
viven en `src/components/ui.tsx`.

| Pantalla | Qué hace | Roles |
|---|---|---|
| Cocina | Tablero Nuevos / En preparación / Listos, etiqueta de canal (WhatsApp, POS, Web), reloj por pedido, combos desarmados, nota, campana, refresco cada 5 s | todos (mueven: cocina y admin) |
| Venta | Catálogo con fotos, carrito que sobrevive a un refresco, efectivo con vuelto, QR con confirmación manual, ticket imprimible | caja y admin |
| Pedidos | Todos los canales, filtros (en curso, sin cobrar, cuadre con motos…), cobrar, anular cobro, cancelar, y la cola de pedidos que entraron con la caja cerrada | todos |
| Caja | Abrir, totales en vivo, cerrar con arqueo, cierres anteriores | caja y admin |
| Menú | Categorías, productos, precio editable en la fila, disponible/agotado, foto | admin (cocina: solo agotado) |
| Promociones | Combos de 2 o más productos, activar, archivar | admin |
| Configuración | Nombre del local, horario, pausa de pedidos, retiro, lluvia, ubicación | admin |
| Usuarios | Alta y baja de administradores, caja y cocina | admin |

Decisiones:

- El POS llama a `/api`, que Vite reenvía al backend (`POS_BACKEND_URL`). Así
  en desarrollo no depende de `CORS_ORIGINS`. En producción se compila con
  `VITE_API_URL`.
- Solo JWT de staff; nunca un token de servicio en el navegador.
- La clave de idempotencia nace al abrir el carrito. Si un envío falla y el
  carrito cambia, se genera otra (misma clave con otro cuerpo da 409).
- El QR del banco (Baneco) no está configurado en local y responde 502: la
  pantalla lo intenta y deja el botón «Confirmar pago manualmente».
- En Menú, las categorías apagadas (las de otra demo) quedan plegadas abajo.

### Backend (2 cambios, con pruebas)

- **Misma hora de apertura y de cierre = abierto las 24 horas.** Antes esa
  combinación dejaba el local siempre cerrado. La caja sigue decidiendo si el
  pedido se confirma o se encola. `load-demo.mjs --24h` lo usa.
- **`restaurantName` en `operational_settings`** (migración
  `1700000031000`). El POS y el ticket lo leen de ahí; `load-demo.mjs` lo
  toma de `restaurant.name`.
- `npm run migrate:local`: migra la base de `.env.dev`.

### Simulador

`scripts/simulate-whatsapp-order.mjs` crea un pedido con canal `whatsapp` con
el token del gateway, como lo hará el agente.

## Qué se hizo el 2026-10-11 — Fase 5, primera mitad

El agente tiene un **modo backend central**, que se enciende con
`CENTRAL_API_BASE_URL` + `CENTRAL_API_TOKEN`. Sin esas variables no cambia
nada: sigue con sus tablas de Supabase, y sus 4222 pruebas de antes pasan igual.
Todo lo nuevo está en `apps/agent-whatsapp/src/lib/central/`.

| Qué | Cómo queda con el backend central | Probado |
|---|---|---|
| Menú web (`/menu`) | Categorías, productos, precios, descripciones, fotos, promociones, nombre del local, pausa y recojo salen del backend (lo que se edita en el POS). Las pestañas dejan de ser Platos/Extras/Bebidas fijas. No usa Supabase si se abre sin enlace de sesión | navegador, con Don Zarco y Café Central |
| Fotos | `GET /api/menu/image/:id` las pide al backend con el token del servidor (el navegador nunca lo ve) | 8/8 cargan |
| Pedido (`POST /api/store/orders`) | Cliente por teléfono → `POST /orders` canal `whatsapp`. Una clave de idempotencia por enlace: mismo carrito = mismo pedido; otro carrito con el mismo enlace = «enlace ya utilizado» | contra el backend local real |
| Ubicación entrante | `POST /orders/:id/location` al pedido activo del cliente; el backend cotiza y confirma | contra el backend local real: ORD-000007, envío Bs 14, confirmado y visible en Cocina del POS |
| Avisos al cliente | El backend los pide a `/api/gateway/whatsapp/messages`, `/location-requests` y `/telegram/alerts` (Bearer `GATEWAY_AUTH_TOKEN`), que envían por Kapso y Telegram | solo pruebas unitarias: no hay credenciales de Kapso |

Reglas de Don Zarco que **no** aplican en modo backend central (eran constantes
en el código): efectivo apagado, recojo apagado y la «noche de promoción». El
recojo lo decide Configuración del POS; el efectivo se ofrece siempre porque el
backend todavía no tiene ese interruptor.

**Falta de la Fase 5** (el webhook tiene ~30 puertos; se migraron los de
ubicación):

1. Comprobantes de pago: `POST /payment-proofs` y su análisis. Hoy se guardan
   en las tablas del agente y el backend no se entera.
2. Estado del cliente para la respuesta por defecto (`lookupCustomerState` →
   `GET /customers/:id/active-order`).
3. «Cambiar mi pedido» (`POST /orders/:id/replace`): hoy un enlace de cambio
   crea un pedido nuevo sin cancelar el anterior.
4. CONFIRMO/CANCELAR de efectivo, cambio a recojo, nota de cocina por chat y
   cotización de un pin suelto (`POST /delivery/quotes`).
5. Herramientas del agente de IA (`get_menu_items`) y el menú que se envía por
   chat: todavía leen `menu_items`. Los datos del local en `facts.ts`
   (nombre, horario, dirección) siguen escritos en el código.
6. Sin caja abierta el backend responde 202 (solicitud en revisión): el menú lo
   muestra como aviso, no como pantalla propia.
7. Retirar `/cocina` y el dashboard de pedidos del agente.
8. Base del agente: sus tablas propias en un esquema aparte (ver más abajo).

### Base del agente y preparación para publicar (2026-10-11)

- **El agente comparte el Supabase de demos (`gkhvijhcyysasofrukbr`) con el
  backend**, en un esquema propio: `agent`. `scripts/agent-db.mjs` aplica las
  39 migraciones del agente sin editarlas, cambiando `public` por `agent` al
  vuelo, y lleva la cuenta en `agent.schema_migrations`. El agente lo usa con
  `SUPABASE_DB_SCHEMA=agent`. Aplicado y comprobado por la API: 22 tablas en
  `agent`, `public` idéntico a antes.
- Se borraron `apps/backend/.env` (clave vieja, no conectaba) y
  `apps/backend/.db-clean.js` (vaciaba todas las tablas; nada lo usaba).
- Usuario `admin` creado en la base de Supabase (clave en
  `apps/backend/.env.supabase`, fuera de git).
- Variables de producción listas para pegar, fuera de git:
  `apps/backend/.env.railway`, `apps/agent-whatsapp/.env.vercel`,
  `apps/pos/.env.vercel`. Tokens nuevos, distintos de los de desarrollo.
- `apps/pos/vercel.json`: build de Vite y rutas de React Router.
- El número de Kapso configurado es el **Sandbox**: solo escribe a teléfonos
  registrados en ese sandbox.

**Pendiente al publicar:** el backend guarda las fotos de producto en disco
(`storage/`), y en Railway ese disco se pierde en cada despliegue. Hasta que
se configure un bucket (`PAYMENT_PROOFS_S3_*`) o un volumen, hay que volver a
correr `load-demo.mjs` después de cada despliegue del backend.

## Primera prueba con WhatsApp real (2026-10-11, 20:06) y arreglo del 2026-10-12

Menú, enlace, pedido y ubicación funcionaron: ORD-000001 se cotizó con Mapbox
(4,08 km, envío Bs 18, total Bs 72) y quedó en Cocina. Pero el cliente no
recibió nada después de mandar la ubicación: el backend solo avisaba al
cotizar si el pago era por QR, y en efectivo se quedaba callado.

Arreglo (decisión del usuario: en efectivo, botones CONFIRMAR / CANCELAR):

- **Backend:** al cotizar el envío (o al crear un pedido para retirar), si es
  en efectivo manda el desglose —productos, envío con km, total— con los dos
  botones (`cash_order_review`, `src/orders/cash-review-message.ts`). El
  mensaje del gateway acepta `buttons`. El aviso de `cash/confirm` al cliente
  ahora dice que el pedido pasa a cocina y cuánto paga.
- **Agente:** el gateway envía los botones por Kapso. Al tocar uno, el estado
  del cliente toma del backend el pedido que espera confirmación y la decisión
  va a `POST /orders/:id/cash/confirm|cancel` (`src/lib/central/cash.ts`). La
  respuesta al cliente la manda el backend.
- **POS:** en Cocina, un pedido en efectivo de WhatsApp o web sin confirmar
  muestra «Esperando que el cliente confirme» y no se puede empezar.

Pendientes que deja: `cash/confirm` marca el pedido como pagado (así venía
el backend), así que un delivery confirmado deja de figurar como «cobra el
repartidor»; nadie llama todavía a `expireStaleOrders`, así que un pedido sin
confirmar no se cancela solo a los 20 minutos; y el tope de dos recordatorios
de botones no cuenta en modo backend central.

## Fase actual

**Fase 4 (POS y cocina): hecha contra el backend actual.** Pendiente de esa
fase: impresión térmica real (hoy es `window.print()` con CSS de 72 mm) y la
pantalla de reportes (`GET /reports/*` ya existe en el backend).

**Fase 5 (agente): a medias.** Menú, pedido, ubicación y gateway ya van por el
backend (ver arriba). Falta lo listado ahí y una prueba con WhatsApp real.

## Tests ejecutados (2026-10-02)

| Dónde | Comando | Resultado |
|---|---|---|
| `apps/backend` | `npx jest` | 25 suites, **108 tests pasan** (105 + 3 del horario 24 h) |
| `apps/backend` | `npx tsc --noEmit`, `npm run build` | sin errores |
| `apps/backend` | `npx eslint` | fallan reglas de prettier que **ya venían** del origen; no se tocaron |
| `apps/backend` | `scripts/staging-http-smoke.mjs` | pasa (sesión de la madrugada) |
| `apps/agent-whatsapp` | `npx vitest run` | 181 archivos, **4256 tests pasan** (2026-10-11: 4222 + 34 del modo backend central) |
| `apps/agent-whatsapp` | `tsc`, `eslint`, `npm run build` | sin errores |
| `apps/pos` | `npx vitest run` | 3 archivos, **27 tests pasan** |
| `apps/pos` | `npx tsc --noEmit`, `npx vite build` | sin errores (JS 380 kB, 115 kB gzip) |
| `apps/pos` | recorrido en Chrome sin ventana, 3 roles | pasa |

El recorrido en el navegador (hecho con `puppeteer-core` en una carpeta
temporal; no está en el repo):

- **Administrador:** entrar, abrir caja, vender 2 productos y 1 promoción,
  cobrar en efectivo con vuelto, ver el ticket, simular un delivery de
  WhatsApp, verlo en Cocina con su etiqueta, mover el pedido del POS a
  preparación y a listo, abrir Pedidos, Menú, Promociones, Configuración y
  Usuarios, cambiar un precio y devolverlo, y la vista de celular. Sin errores
  de consola ni respuestas 4xx/5xx.
- **Cocina:** solo ve Cocina, Pedidos y Menú; inicia un pedido de WhatsApp
  (delivery en efectivo, sin pagar); marca un producto agotado y lo rehabilita;
  no puede editar precios; `/venta` lo devuelve a Cocina.
- **Caja:** solo ve Cocina, Venta, Pedidos y Caja; vende en Mesa con QR y
  confirma el pago a mano; ve la cocina sin botones para mover pedidos.

No probado: QR real del banco, impresora térmica, subir una foto desde el POS
(sí por el cargador, que usa el mismo endpoint), cierre de caja en el
navegador, y el agente contra el backend.

## Migraciones aplicadas

Las 32 del backend, en las dos bases (2026-10-02):

| Base | Qué es | Estado |
|---|---|---|
| PostgreSQL local, puerto 54329 | desarrollo | 32 migraciones, con datos de prueba |
| Supabase `gkhvijhcyysasofrukbr`, esquema `public` | demos publicadas, backend | 32 migraciones; sin menú cargado todavía, con el usuario `admin` creado |
| Supabase `gkhvijhcyysasofrukbr`, esquema `agent` | demos publicadas, agente | 39 migraciones del agente (2026-10-11) |
| Supabase `rgoesdoqmhlurpclacha` | backend central del POS de producción | **solo lectura**, no se tocó |

- `gkhvijhcyysasofrukbr` no estaba borrada sino pausada: de madrugada no
  resolvía por DNS y horas después volvió. La cadena de conexión está en
  `apps/backend/.env.supabase` (fuera de git). `apps/backend/.env` tenía la clave vieja y se borró el 2026-10-11.
- **Migración 32 (`enable-rls-on-later-tables`), nueva:** la 18 activaba RLS
  solo en las tablas que existían entonces. `cash_register_sessions` y
  `bank_qr_charges` se crearon después y quedaron sin RLS y con permisos para
  `anon`: con la clave pública de Supabase se podían leer y escribir. Ahora
  las 20 tablas tienen RLS. **El backend de producción (`rgoesdoqmhlurpclacha`)
  viene del mismo código y probablemente tiene el mismo hueco: revisarlo.**
- `scripts/check-database.mjs` (`npm run db:check`): revisa una base sin
  escribir y dice si está vacía, al día o es de otro sistema.
- Las 39 migraciones del agente se aplicaron en el esquema `agent` con
  `scripts/agent-db.mjs`, no en `public`: 9 de sus tablas se llaman igual que
  las del backend (`orders`, `order_items`, `order_promotions`,
  `promotions`, `promotion_items`, `payment_attempts`, `payment_proofs`,
  `delivery_quote_requests`, `dashboard_users`).

## Errores y riesgos pendientes

- La base local tiene pedidos de prueba (ORD-000001 a 000005) y una caja
  abierta con Bs 100 de las pruebas.
- `CLIENTES/SasS_Restaurante/restauranteAI/.git/config` tiene un token de
  GitHub incrustado en el remote (fuera de este proyecto): revocarlo.
- Las coordenadas de `demos/don-zarco` son aproximadas: ajustarlas antes de
  cotizar delivery de verdad.
- Upstream de producción `julico155/backend-central-zarco`: falta compararlo
  con este backend para saber si tiene cambios que aquí no están.

## Decisiones necesarias (del usuario)

1. **Dónde corre el backend.** La prueba gratis de Railway de la cuenta
   `NyxM4x` está agotada. Opciones vistas el 2026-10-11: plan Hobby (5 USD al
   mes) en esa cuenta, otra cuenta de Railway (riesgo: «Limited Trial» sin
   salida de red), u otro servicio con plan gratis. Sin decidir.
2. **OpenAI y Telegram** para el agente: opcionales, todavía sin configurar.
   Sin OpenAI el bot manda el menú y toma pedidos, pero no conversa.
3. **Dónde se guardan las fotos en producción** (bucket R2/S3 o volumen): hoy
   se pierden en cada despliegue del backend.
4. Conflictos C3, C5, C8 y C13 de `docs/data-mapping.md` §9. Siguen con las
   propuestas por defecto.

## Próxima sesión: por dónde seguir

1. **Publicado** (backend, agente, POS, demo cargada y webhook de Kapso), según
   `docs/deploy.md`. Si se trabaja desde otra carpeta, copiar antes los
   archivos que no están en git (la lista está en ese documento).
2. **Primera prueba con WhatsApp real** y arreglar lo que salga. Lo que nunca
   se ejecutó de verdad: envío por Kapso, enlace de sesión del menú, y las
   llamadas del backend a `/api/gateway/*`.
3. **Resto de la Fase 5** (lista completa en «Qué se hizo el 2026-10-11»):
   comprobantes de pago, «Cambiar mi pedido», estado del cliente para la
   respuesta por defecto, CONFIRMO/CANCELAR de efectivo, el menú que usa el
   agente de IA, y los datos del local que siguen en `facts.ts`.
4. Fotos en un bucket, pantalla de reportes en el POS y `packages/contracts`.
