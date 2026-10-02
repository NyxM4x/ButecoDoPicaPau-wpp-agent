# Matriz de equivalencias y conflictos — Fase 0

Origen A = agente (`sarcoRestaurant`, Supabase). Origen B = backend central
(`backend-central-zarco-dev`, `main` + `feat/sarco-integration`).
Destino = modelo canónico propuesto en `canonical-contract-proposal.md`.

Leyenda: **=** igual · **≈** equivalente con transformación · **+** nuevo en el
destino · **✗** se descarta o se queda en la base del agente.

## 1. Catálogo

| A `menu_items` | B `products` / `categories` | Destino | Regla de migración |
|---|---|---|---|
| `id` | `products.id` | `products.id` | ≈ se conserva el UUID de A para mantener las FK de `order_items` históricos |
| `code` | `products.code` | `products.code` | = único **por restaurante** |
| `name` | `products.name` | = | = |
| `category` ∈ plato/bebida/extra | `category_id` → `categories` | `category_id` | ≈ crear categorías "Platos" y "Bebidas"; `extra` pasa a `product_options` (ver abajo) |
| `price` | `price` | = | = |
| `is_active` | `is_active` + `is_available` | ambos | ≈ `is_available = is_active` |
| `sort_order` | `sort_order` | = | = |
| — | `description`, `image_key`, `image_mime_type` | = | + |
| — | — | `restaurant_id` | + |

**Extras.** A modela los extras como productos sueltos (`category = 'extra'`) que
el cliente agrega como líneas independientes. B no tiene extras. El destino usa
`product_option_groups` + `product_options` (precio ≥ 0, se admite 0) y
`order_item_options` con snapshot. **Decisión necesaria (C8):** los extras
históricos de A se migran como líneas `order_items` normales (no se pueden
asignar a un producto padre); los extras nuevos se venden como opciones.

## 2. Promociones

| A | B | Destino |
|---|---|---|
| `promotions` (sin `archived_at`, sin `sort_order`, descripción ≤ 300) | `promotions` (+ `archived_at`, `sort_order`, descripción ≤ 200, precio ≤ 5000) | B + `restaurant_id` · descripción ≤ 300 para no truncar A |
| `promotion_items` | `promotion_items` | = |
| `order_promotions` | `order_promotions` (`components_snapshot` ≥ 2) | = · la rama upstream ya aceptó combos de 1 producto: revisar el `check` |
| `revision` + trigger | `revision` en servicio | = |

## 3. Clientes

| A | B | Destino |
|---|---|---|
| no hay tabla: `orders.customer_phone`, `customer_name`; `agent_conversations.customer_phone` (8–15 dígitos) | `customers(phone único, email único, name)` | `customers` + `restaurant_id`; `unique(restaurant_id, phone)` |

Regla: normalizar teléfono a E.164 sin `+` (solo dígitos, igual que A); crear un
`customer` por teléfono distinto; `name` = el `customer_name` no vacío más
reciente. `agent_conversations` se queda en la base del agente y guarda
`central_customer_id` (+).

## 4. Pedidos

| A `orders` | B `orders` | Destino | Regla |
|---|---|---|---|
| `id` | `id` | `id` | ≈ se conserva el UUID de A |
| `order_number` `ORD-YYMMDD-NNN` (diario) | `ORD-000123` (global) | `ORD-YYMMDD-NNN` por restaurante | ≈ los de A se conservan tal cual; ver C3 |
| `customer_phone`, `customer_name` | `customer_id`, `customer_name` | ambos | ≈ `customer_id` por teléfono |
| — | `channel` | = | A → `whatsapp` |
| `delivery_type` delivery/pickup | delivery/pickup/dine_in | = | = |
| `payment_method` cash/qr/null | qr/cash/card | = | null → `qr` (el default histórico) + marca en `source_metadata` |
| no existe (se deriva de `payment_attempts`) | `payment_status` | + `paid_unapplied`, `refunded` | ≈ derivar: attempt `accepted` → `paid`; `pending_review` → `pending_review`; `rejected` → `rejected`; efectivo con `cash_confirmed_at` y entregado → ver C5 |
| `status` con `on_the_way` | `status` con `out_for_delivery` | `out_for_delivery` | ≈ renombrar |
| `notes` (cliente + cocina mezclados) | `notes` (cliente + cocina mezclados) | `customer_notes` + `kitchen_notes` | ≈ histórico va entero a `customer_notes` (C6) |
| `subtotal_amount` | = | = | = |
| `delivery_amount` | `delivery_base_amount` + `delivery_surcharge_amount` | B | ≈ todo a `delivery_base_amount` (A no guarda el recargo por separado) |
| `total_amount` | = | = | validar `= subtotal + delivery` |
| `currency` BOB | — | `restaurants.currency` | ✗ |
| `delivery_pricing`, `delivery_quote_status`, `delivery_distance_meters`, lat/long | = | = | = |
| `delivery_address`, `delivery_location_name` | — | = | + |
| `delivery_fee_paid` (nullable) + `delivery_fee_paid_at` | `delivery_fee_paid` not null | B + `delivery_fee_paid_at` | null → false |
| `cash_confirmed_at` | = | = | = |
| `delivery_notice_sent_at` | — (lo gestiona `notification_jobs`) | ✗ | se conserva en `source_metadata` |
| `source_message_id`, `location_request_message_id`, `flow_token`, `raw_flow_response`, `menu_session_id`, `checkout_fingerprint` | — | `source_metadata` (jsonb) | ≈ |
| — | `register_session_id` | `cash_register_session_id` | histórico de A → `null` (no había caja) |
| — | `replaces_order_id` (rama) | = | ≈ desde `menu_sessions.replaces_order_id` + el pedido cancelado |
| — | `status_updated_by` | = | = |
| — | — | `restaurant_id`, `table_number`, `modification_count`, `cancelled_reason`, `cancelled_by` | + |
| `confirmed_at`, `created_at`, `updated_at` | = | = | = |

`order_items`: A `menu_item_id`, `product_code` → B `product_id`,
`product_code_snapshot`; el resto es igual. Destino agrega `kitchen_status`
(`pending|fired|ready|voided`) y la relación con `order_item_options`.

## 5. Pagos, comprobantes y QR

| Concepto | A | B | Destino |
|---|---|---|---|
| Intento de cobro | `payment_attempts` (sin `customer_id`, sin `opened_as`) | + `customer_id`, `opened_as` | B |
| Comprobante: asociación | `association_method` (5 valores) | `match_method` (7 valores) | B · mapa: `reply_to_qr`, `single_open_qr_order`, `duplicate`, `ambiguous`, `unresolved` son subconjunto |
| Comprobante: archivo | `declared/verified_mime_type`, `safe_filename`, `content_sha256`, `storage_namespace`, `storage_expires_at`, `claim_token` | `mime_type`, `sha256_hex`, `byte_size` | B + `storage_expires_at` (retención de A) |
| Comprobante: análisis | `analysis_*` (verdict, reasons, amount, reference, model, destination_*) | igual en la rama (0029) | = |
| `analysis_status` | pending/done/failed | pending/ok/failed | `done` → `ok` |
| QR bancario | no existe | `bank_qr_charges` | B |
| Pago posterior al cierre | no existe | `bank_qr_charges.status = paid_unapplied` | B, y reflejarlo en `orders.payment_status` (C4) |

## 6. Caja

A no tiene caja. B tiene `cash_register_sessions` (una sola abierta, totales
congelados al cierre, `register_session_id` en `orders`). El destino es B más:
`restaurant_id`, `forced_close_reason`, `forced_close_by`,
`pending_review_count_at_close`. Los pagos (`payment_attempts`) también guardan
`cash_register_session_id`.

## 7. Cocina

| | A (`/cocina`) | B (`PATCH /orders/:id/status`) | Destino |
|---|---|---|---|
| Etapas | `new`, `in_progress`, `done`, `cancelled` | estados del pedido | columnas POS \| WHATSAPP \| PREPARANDO + panel LISTOS |
| Acciones | `start`, `complete`, `return`, `recall`, **`cancel`** | cualquier transición legal, **incluida `cancelled`**, roles kitchen/admin | `start`, `complete`, `recall` (volver de listo a preparando), `note`; **sin `cancel`** |
| Pago antes de cocinar | total del KDS cuenta solo lo confirmado | `409 payment_required` salvo delivery + efectivo | B |
| Campana | `chime.ts` + `arrivals.ts` | — | se porta a `apps/kitchen` |

## 8. Configuración

| A | B | Destino `restaurant_settings` |
|---|---|---|
| `delivery_settings.rain_surcharge_active` (+3 Bs fijos en código) | `rain_surcharge_enabled`, `rain_surcharge_amount` | B |
| `delivery_settings.orders_paused` | `orders_paused` (rama) | = |
| `PICKUP_ENABLED = false` (constante en código) | `pickup_enabled` (rama) | = |
| `RESTAURANT_LAT/LNG` (env) | `restaurant_latitude/longitude` | = |
| horario en `facts.ts` (texto) | `business_opens_hour`, `business_closes_hour`, `late_review_closes_hour` | = |
| — | — | + `queue_enabled`, `kitchen_active_orders_limit`, `promotion_active_orders_limit`, `retry_after_minutes`, mensajes operativos, métodos de pago habilitados |

## 9. Conflictos que requieren decisión

| # | Conflicto | Propuesta |
|---|---|---|
| C1 | **Base del backend**: `main` o `feat/sarco-integration`. | Rama de integración: ya resuelve reemplazo, pausa, pickup, expiración y pedido activo, con tests y CI. |
| C2 | **Upstream de producción** (`julico155`) puede tener commits posteriores; la rama descartó su "numeración por caja". | Clonar el upstream y compararlo antes de la Fase 2. |
| C3 | **Número de pedido**: diario en A (`ORD-260923-007`, se muestra `#7`, jornada con corte a las 12:00), global en B, y por caja en el upstream. | Diario por restaurante con el corte de jornada de A. Es lo que pidió el dueño y lo que el documento de contexto fija. |
| C4 | `orders.payment_status` en B no admite `paid_unapplied` ni `refunded` (solo existen en `bank_qr_charges`). | Ampliar el `check` de `orders.payment_status`. |
| C5 | Pedidos históricos de A en efectivo: no hay registro de cobro, solo `cash_confirmed_at` (confirmación del cliente, no del pago). | Migrar como `unpaid` si no están `delivered`; como `paid` si están `delivered`, marcados `source_metadata.payment_inferred = true`. |
| C6 | **Nota de cocina** se concatena a `notes` en A y en B: se mezcla con la nota del cliente y compite por el límite de 500. | Separar `customer_notes` y `kitchen_notes` (nota operativa de cocina con autor y hora en `order_events`). |
| C7 | **Cocina puede cancelar** en A (acción `cancel`) y en B (`PATCH status → cancelled` con rol kitchen). El plan lo prohíbe. | Quitar `cancelled` a kitchen; cancelar va por `POST /orders/:id/cancel` (cashier/admin/owner, motivo obligatorio). |
| C8 | **Extras**: en A son líneas sueltas, en B no existen. | Opciones por producto en el destino; histórico de A como líneas. |
| C9 | **Menú web del agente** (`/menu` + `menu_sessions`) crea pedidos llamando al RPC de A. | El carrito web sigue en el agente, pero el checkout llama `POST /orders` del backend; `menu_sessions` solo guarda la sesión. |
| C10 | **Cierre de caja** en B no revisa comprobantes `pending_review`. | Bloquear el cierre (`409 cash_register_close_blocked` con la lista) y permitir `force` con motivo (admin/owner). |
| C11 | **Caja única**: el índice `uq_cash_register_sessions_single_open` es global. | Pasar a `unique(restaurant_id) where status = 'open'`. |
| C12 | **Estado `ready` → `cancelled`** está permitido en B. Un pedido listo ya consumió insumos. | Mantener, pero solo admin/owner y con motivo. |
| C13 | **Modificar pedido "una sola vez"**: B solo garantiza un reemplazo por pedido (`unique replaces_order_id`), pero una cadena A→B→C sigue siendo posible. | `modification_count` en la raíz de la cadena; rechazar el segundo reemplazo con `409 modification_limit_reached`. |
| C14 | **Capacidad de cocina**: no existe en ninguno. | Evaluarla en `POST /orders` antes de confirmar; `409 kitchen_saturated` con `retryAfterMinutes`. |
| C15 | **`restaurant_id`**: no existe en ninguno. `operational_settings` es fila única con `id boolean`. | Tabla `restaurants`; restaurante por defecto para los datos actuales; `restaurant_settings` 1:1. |
| C16 | **Roles**: no existe `owner`; A no tiene `cashier`. | `owner`, `admin`, `cashier`, `kitchen`; los admins actuales pasan a `owner` solo si se decide así usuario por usuario. |
| C17 | **Dos bases de producción distintas** (Supabase del agente y Postgres del backend). | La migración de la Fase 3 copia de A a B; A queda en solo lectura para negocio. |

## 10. Validaciones de la migración (Fase 3)

Por cada pedido migrado: `Σ order_items.subtotal + Σ order_promotions.subtotal =
subtotal_amount`; `subtotal + delivery = total`; mismo número de líneas;
cliente resuelto; `order_number` único por restaurante. El script debe ser
idempotente (upsert por `id`) y producir un reporte de diferencias.
