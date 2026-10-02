# Inventario técnico de repositorios — Fase 0

Fecha: 2026-09-23. Solo lectura: no se modificó código, migraciones, ramas ni
bases de datos. Las dependencias (`node_modules`) no están instaladas en ninguno
de los dos repos, así que los tests no se ejecutaron en esta fase.

## 1. Ubicaciones reales

| Proyecto | Ruta local | Remote | Rama / SHA de referencia |
|---|---|---|---|
| Backend central | `DEMO_RESTAURANT/backend-central-zarco-dev` | `github.com/rochayoan/backend-central-zarco-dev` (fork) | `main` = `af20b02` (2026-09-18) |
| Backend — rama de integración | misma | misma | `origin/feat/sarco-integration` = `33a9da7` (2026-09-19), 120 commits sobre `main` |
| Backend — upstream en producción | no clonado | `github.com/julico155/backend-central-zarco` (según `docs/pos-frontend-handoff.md`) | desconocido: puede tener commits posteriores a `af20b02` |
| Agente WhatsApp | `DEMO_RESTAURANT/Agente_restaurant/sarcoRestaurant` | `github.com/NyxM4x/sarcoRestaurant` | `main` = `420b8ef` (2026-09-22) |
| Agente — copia de producción | `CLIENTES/ZarcoTrancaPechos/sarcoRestaurant` | mismo remote | `5787fe8` (2026-09-18), **atrasada** respecto de `420b8ef` |
| POS frontend | **no está en disco** | repo separado (Vite + React), URL no documentada | — |

Estos SHAs son las "etiquetas" de partida. No se crearon tags ni la rama
`integration/monorepo` porque `DEMO_RESTAURANT` todavía no es un repositorio
propio (el git que lo contiene es el del directorio de usuario
`C:/Users/adali`). Ver §7.

## 2. Backend central (`backend-central-zarco-dev`)

**Stack:** NestJS 10, TypeScript, PostgreSQL (Supabase como proveedor), Kysely,
migraciones SQL con `node-pg-migrate`, JWT + bcrypt, `@nestjs/schedule`,
Swagger/OpenAPI (`/docs`, `/docs-json`), Jest, S3/R2 para archivos.
Despliegue: Railway (auto-deploy desde GitHub; las migraciones se aplican a mano).

### 2.1 Tablas (main + rama de integración)

| Tabla | Propósito | Notas |
|---|---|---|
| `categories` | categorías del menú | `sort_order`, `is_active` |
| `products` | productos | `code` único, `price >= 0`, `is_active`, `is_available`, `image_key`, `image_mime_type`, `description` |
| `customers` | clientes | `phone` único, `email` único |
| `idempotency_keys` | idempotencia genérica | `(api_client, endpoint, key)` + hash del body |
| `orders` | pedido único para todos los canales | ver matriz en `data-mapping.md` |
| `order_items` | líneas con snapshot | `quantity` 1–10 |
| `promotions`, `promotion_items`, `order_promotions` | combos con snapshot de componentes | `revision` para detectar carritos viejos |
| `late_order_requests` | pedidos fuera de horario / sin caja | expiran a los 10 min |
| `delivery_tariff_bands`, `delivery_quote_requests` | 16 bandas por distancia | Mapbox o línea recta |
| `payment_attempts` | intento de cobro por pedido | índice único parcial `uq_payment_attempts_live` |
| `payment_proofs` | comprobantes + asociación + análisis | la rama agrega columnas de análisis (0029) |
| `bank_qr_charges` | QR real Banco Económico | `paid_unapplied`, `refunded` |
| `cash_register_sessions` | caja/turno | **una sola abierta** (índice único parcial) |
| `operational_settings` | fila única de configuración | horario, lluvia, coordenadas; la rama agrega `orders_paused`, `pickup_enabled` |
| `dashboard_users` | staff | roles `admin`, `kitchen`, `cashier` |
| `notification_jobs` | salida hacia WhatsApp/Telegram con reintentos | dedupe `(kind, target_ref)` |

Migraciones: `1700000001000` … `1700000026000` en `main`; la rama agrega
`027_orders-replacement`, `028_orders-paused`, `029_payment-proof-analysis`,
`030_pickup-enabled`.

### 2.2 Endpoints

Guardas: **S** = token de servicio, **J** = JWT de staff (rol entre paréntesis),
**S|J** = cualquiera de los dos.

| Dominio | Endpoints |
|---|---|
| Auth | `POST /auth/login`; `POST/GET /auth/users`, `PATCH /auth/users/:id/active` (J admin) |
| Catálogo | `GET /categories`, `GET /products`, `GET /promotions[/:id]`, `GET /products/:id/image` (S\|J); escritura J admin; `PATCH /products/:id/availability` (J admin, kitchen); promociones: `active`, `archived`, `duplicate`, `move` |
| Clientes | `POST /customers/find-or-create`, `GET /customers[/:id]` (S\|J) |
| Pedidos | `POST /orders`, `GET /orders/:id`, `POST /orders/:id/kitchen-note`, `cash/confirm`, `cash/cancel` (S\|J); `GET /orders` (J kitchen, cashier, admin); `PATCH /orders/:id/status` (J kitchen, admin); `location-request`, `location`, `switch-to-pickup` (S) |
| Pedidos (rama) | `GET /customers/:customerId/active-order`, `POST /orders/:id/replace`, `POST /internal/orders/expiry/tick` (S) |
| Delivery | `POST /delivery/quotes`, `POST /orders/:id/delivery/quote[/manual]` (S) |
| Pagos | `GET /orders/:id/payment-attempts` (S\|J), `POST /payment-attempts/:id/decide` (S), `POST /orders/:id/payment-attempts/confirm-presencial` (J cashier, admin) |
| Comprobantes | `GET/POST /payment-proofs`, `GET /payment-proofs/:id/file`, `POST /payment-proofs/:id/assign` (S); rama: `POST :id/analysis-context`, `POST :id/analysis` |
| QR bancario | `POST /orders/:id/qr/generate` (J), `GET /orders/:id/qr-image` (S\|J), cola `GET /bank-qr/unapplied-payments`, `…/:id/apply`, `…/:id/refunded`, webhook `POST /api/qrsimple/notifyPaymentQR` |
| Caja | `POST /cash-register/sessions/open`, `…/close`, `GET …/current`, `GET …`, `GET …/:id` |
| Tardíos | `GET /late-order-requests[/:id]` (S\|J), `POST …/:id/accept`, `…/:id/reject` (J admin, cashier) |
| Configuración | `GET /operational-settings` (S\|J), `PATCH` (J admin) |
| Reportes | `/reports/kpis`, `sales/timeseries`, `sales/orders[/:id]`, `products/top`, `cash-sessions` (J admin) |
| Salud (rama) | `GET /health` |

Errores con forma uniforme `{code, message, details}`.
`forbidNonWhitelisted: true`: un campo de más en el body da 400.

### 2.3 Variables de entorno

`DATABASE_URL`, `PORT`, `CORS_ORIGINS`, `SERVICE_AUTH_TOKENS`
(`whatsapp-gateway:…,pos:…,web:…`), `GATEWAY_BASE_URL`, `GATEWAY_AUTH_TOKEN`,
`JWT_SECRET`, `JWT_EXPIRES_IN`, `MAPBOX_ACCESS_TOKEN`,
`PAYMENT_PROOFS_S3_{BUCKET,REGION,ACCESS_KEY_ID,SECRET_ACCESS_KEY,ENDPOINT}`,
`BANECO_{BASE_URL,USERNAME,PASSWORD,AES_KEY,ACCOUNT}`.
No existe todavía `PAYMENT_PROVIDER=mock`.

### 2.4 Qué contiene la rama `feat/sarco-integration`

Hecha por el mismo equipo para conectar el agente; **ninguna rama del agente la
consume todavía**.

- Reemplazo atómico de pedido (`orders.replaces_order_id`, `POST /orders/:id/replace`).
- Pausa de pedidos digitales (`operational_settings.orders_paused`).
- `pickup_enabled` central.
- Pedido activo por cliente para el agente (`GET /customers/:id/active-order`).
- Expiración central de pedidos en efectivo y sin ubicación (`/internal/orders/expiry/tick`).
- Contexto y resultado del análisis de comprobantes.
- QR diferido hasta que el total de delivery sea final.
- Teléfono resuelto en los avisos salientes (el agente ya no necesita buscarlo).
- CI de migraciones y smoke HTTP contra PostgreSQL limpio; seed de staging.
- Retiró deliberadamente la "numeración por caja" del upstream (ver conflicto C3).

## 3. Agente WhatsApp (`sarcoRestaurant`)

**Stack:** Next.js 16 (App Router, con cambios incompatibles: leer
`node_modules/next/dist/docs/` antes de tocarlo), React 19, TypeScript, Supabase
con `service_role` (acceso directo a la base), Zod, Tailwind 4, Vitest (180
archivos de test) y evals del agente. Proveedor de WhatsApp: Kapso. IA: OpenAI.
Crons: Cloudflare Workers. Despliegue: Vercel.

### 3.1 Tablas (39 migraciones Supabase)

| Grupo | Tablas | Destino |
|---|---|---|
| **Negocio (duplican el backend)** | `menu_items`, `orders`, `order_items`, `promotions`, `promotion_items`, `order_promotions`, `payment_attempts`, `payment_proofs`, `delivery_quote_requests`, `delivery_settings`, `order_daily_counters`, `dashboard_users` | migrar al backend y retirar |
| Notificaciones de pedido | `order_notifications` + ~20 RPC de claim/retry | sustituir por `notification_jobs` del backend + endpoints gateway |
| Integración (se quedan) | `agent_conversations`, `agent_messages`, `agent_runs`, `agent_control_events`, `webhook_events`, `menu_send_deliveries`, `telegram_alerts` | se conservan en la base del agente |
| Menú web | `menu_sessions` | se conserva como sesión de canal, pero sin crear pedidos (ver C9) |

### 3.2 Rutas

| Tipo | Rutas |
|---|---|
| Webhook | `POST /api/kapso/webhook` |
| Menú web y checkout | `/menu`, `POST /api/store/orders` (llama RPC `create_order_web_v4`), `POST /api/flow/order-summary` |
| Cocina | `/cocina`, `GET /api/kitchen/orders` |
| Dashboard | `/dashboard`, `/dashboard/configuracion`, `/dashboard/login`, `GET /api/dashboard/orders[/detail]`, `GET /api/dashboard/proofs/file` |
| Workers internos | `/api/internal/cron/tick`, `order-notifications/{worker/tick,retry,reconcile}`, `orders/expiry/worker/tick`, `telegram-alerts/worker/tick`, `webhook-events/worker/tick`, `agent/resume`, `{delivery,menu}/config-check` |
| Salud | `/api/health` |

### 3.3 Acceso directo a tablas de negocio (lo que la Fase 5 debe eliminar)

| Tabla | Archivos que la leen o escriben |
|---|---|
| `orders` | 19 archivos: `orders/{service,order-cart,order-replacement,cash-confirm-service,kitchen-note-service,pickup-switch-service,unpaid-order-service,abandoned-cart-service,notifications/service}`, `kitchen/data-source`, `dashboard/{data-source,proofs-data-source}`, `delivery/quote-service`, `menu/session-repository`, `payment-proof/{analysis-data-source,expiry-service,intake-data-source}`, `alerts/delivery-notice-service`, `webhook/customer-state-service`, `agent/handoff/stuck-customer-service` |
| `menu_items` | `menu/repository`, `kitchen/data-source` |
| `promotions`, `promotion_items` | `promotions/repository` |
| `payment_attempts`, `payment_proofs` | `payment-proof/*`, `dashboard/*`, `kitchen/data-source`, `orders/{unpaid-order-service,order-replacement}`, `webhook/customer-state-service` |
| RPC de negocio | `create_order_web_v4`, `apply_delivery_quote`, `mark_delivery_quote_result`, `decide_payment_attempt` |

### 3.4 Variables de entorno

Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), `APP_BASE_URL`,
`MENU_SESSION_SECRET`, `DASHBOARD_SESSION_SECRET`, R2 (`R2_*`),
`PAYMENT_PROOF_CAPTURE_ENABLED`, `PAYMENT_PROOF_ANALYSIS_{ENABLED,MODEL}`,
`PAYMENT_PROOF_ACCOUNT_{BANK,BANK_ALIASES,NUMBER,HOLDER,HOLDER_ALIASES}`,
`MAPBOX_ACCESS_TOKEN`, `RESTAURANT_{LAT,LNG}`, `MAPBOX_DIRECTIONS_TIMEOUT_MS`,
Kapso (`KAPSO_{API_KEY,PHONE_NUMBER_ID,WEBHOOK_SECRET,API_BASE_URL}`,
`WHATSAPP_BUSINESS_NUMBER`), `INTERNAL_API_TOKEN`,
`TELEGRAM_{BOT_TOKEN,CHAT_ID,HANDOFF_CHAT_ID}`,
`AI_{ENABLED,ACCESS_MODE,TEST_PHONES,VISION_MODEL}`, `OPENAI_{API_KEY,MODEL}`,
`HUMAN_TAKEOVER_PAUSE_MINUTES`, `WEBHOOK_ASYNC_ACK`.

Faltan para la Fase 5: `CENTRAL_API_BASE_URL`, `CENTRAL_API_TOKEN` (token
`whatsapp-gateway`) y `GATEWAY_AUTH_TOKEN` (para validar las llamadas del backend).

### 3.5 Funcionalidades a conservar

Webhook durable de Kapso, historial y conversaciones, pausa y derivación a
humano (explícita, por señal de problema y por cliente atascado), herramientas
de IA con evals, envío de menú con ledger, solicitud de ubicación, intake,
clasificación y análisis de comprobantes (con su puerta de privacidad), avisos a
Telegram (outbox), botón "Cambiar mi pedido", confirmación de efectivo por
chat ("CONFIRMO / CANCELAR"), barridos de carrito abandonado y pedido impago,
campana del KDS (`kitchen/chime.ts`, `arrivals.ts`).

## 4. POS frontend

No se encontró en disco (se buscó en `Desktop`, `Documents` y `CLIENTES`). Lo
que se sabe viene de `backend-central-zarco-dev/docs/pos-frontend-handoff.md` y
`docs/pos-integration.md`:

- Vite + React + TypeScript, React Router, TanStack Query, Zustand (carrito
  persistido), Tailwind + shadcn/ui, react-hook-form + zod.
- Solo JWT de staff; tipos de request generados con `openapi-typescript`.
- Incluye venta, cocina y admin en el mismo repo.
- Impresión térmica Epson TM-T20III vía Chrome `--kiosk-printing`.
- Ya habla con el backend central: ya usa el mismo `POST /orders` que WhatsApp.

**Bloqueante para la Fase 4:** hace falta la URL del repo del POS.

## 5. Duplicaciones detectadas

| Capacidad | Agente | Backend | Decisión propuesta |
|---|---|---|---|
| Catálogo | `menu_items` (enum plato/bebida/extra) | `categories` + `products` | backend |
| Creación de pedido | RPC `create_order_web_v4` | `POST /orders` (porta la v5) | backend |
| Número de pedido | diario `ORD-YYMMDD-NNN` | global `ORD-000123` | backend con formato diario (C3) |
| Promociones | tablas propias | tablas propias + `archived_at`, `sort_order` | backend |
| Comprobantes y asociación | `payment-proof/*` + tablas | `payment-proofs` (algoritmo portado) | backend decide; el agente solo recibe y envía el archivo |
| Delivery | `delivery_settings` + función de tarifa | `delivery_tariff_bands` + `operational_settings` | backend |
| Pausa de pedidos | `delivery_settings.orders_paused` | `operational_settings.orders_paused` (rama) | backend |
| Expiración | crons del agente (efectivo 20 min, impago 2 h, carrito 45 min) | `/internal/orders/expiry/tick` (rama) | backend; el agente solo avisa |
| Reemplazo de pedido | `menu_sessions.replaces_order_id` + cancelar | `orders.replaces_order_id` atómico (rama) | backend |
| Nota de cocina | `kitchen-note-service` (600 caracteres) | `POST /orders/:id/kitchen-note` (500 caracteres) | backend, en un campo separado (C6) |
| KDS | `/cocina` en el agente | pantalla de cocina en el POS | un solo KDS en `apps/kitchen` |
| Usuarios de staff | `dashboard_users` (admin, kitchen) | `dashboard_users` (admin, kitchen, cashier) | backend + rol `owner` |
| Avisos salientes | `order_notifications` + RPC | `notification_jobs` → gateway del agente | backend decide; el agente envía |

## 6. Riesgos de seguridad vistos de paso (fuera del alcance, sin tocar)

- `CLIENTES/SasS_Restaurante/restauranteAI/.git/config` tiene un **token de
  GitHub incrustado** en la URL del remote. Conviene revocarlo y quitarlo del
  remote.
- `backend-central-zarco-dev/postman/` está en disco con la colección de
  certificación de Baneco; el upstream la excluyó del repo por tener
  credenciales.
- Credenciales de Baneco: el PDF del manual está en la raíz del backend.

## 7. Pendiente de la Fase 0 que requiere decisión

1. **Dónde vive el monorepo.** `DEMO_RESTAURANT` está dentro del git del
   directorio de usuario. Propuesta: `git init` propio en `DEMO_RESTAURANT` (o un
   repo nuevo `restaurant-demos`) e importar los tres proyectos con historial
   (`git subtree add`), en la rama `integration/monorepo`.
2. **Base del backend:** `feat/sarco-integration` (recomendado) frente a `main`.
3. **Upstream de producción:** clonar `julico155/backend-central-zarco` para
   saber si tiene commits posteriores a `af20b02`.
4. **URL del repo del POS.**
