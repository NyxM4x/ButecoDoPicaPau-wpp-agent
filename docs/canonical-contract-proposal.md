# Propuesta de contrato canónico — para revisión

Base: el contrato actual del backend central (rama `feat/sarco-integration`).
Se propone **ampliarlo**, no reescribirlo: el POS ya consume ese contrato en
producción. Todo lo marcado **(nuevo)** no existe hoy. Nada de esto está
implementado; es el insumo de `packages/contracts` en la Fase 1.

## 1. Principios

1. Un pedido, un `orders.id`. El canal es un atributo, no una tabla.
2. Estado del pedido (`status`) y estado del pago (`paymentStatus`) son
   máquinas independientes, unidas solo por guardas explícitas.
3. Toda regla vive en el backend. POS, cocina y agente muestran y piden; no
   calculan precios, totales, cierres ni transiciones.
4. Todo lo multi-restaurante lleva `restaurantId`; en la API se resuelve por el
   token (usuario o `api_client`), nunca por un parámetro que el cliente elija.

## 2. Enumeraciones

```ts
Channel        = 'pos' | 'whatsapp' | 'web'
DeliveryType   = 'pickup' | 'dine_in' | 'delivery'
PaymentMethod  = 'cash' | 'qr' | 'card'
OrderStatus    = 'draft' | 'awaiting_location' | 'confirmed' | 'preparing'
               | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled'
PaymentStatus  = 'unpaid' | 'pending_review' | 'paid' | 'rejected'
               | 'paid_unapplied' | 'refunded'            // (nuevo en orders)
ItemKitchenStatus = 'pending' | 'fired' | 'ready' | 'voided'   // (nuevo)
Role           = 'owner' | 'admin' | 'cashier' | 'kitchen'     // owner (nuevo)
CashSessionStatus = 'open' | 'closing' | 'closed'              // closing (nuevo, bloqueo)
DataOrigin     = 'real' | 'demo' | 'test'                      // (nuevo)
```

Nombres visibles (solo UI): `confirmed` → "Nuevo", `preparing` → "Preparando",
`ready` → "Listo", `out_for_delivery` → "En camino", `delivered` → "Entregado";
`pickup` → "Para llevar", `dine_in` → "Mesa", `delivery` → "Delivery".

## 3. Máquina de estados del pedido

```text
draft ──► awaiting_location ──► confirmed ──► preparing ──► ready ──► out_for_delivery ──► delivered
  │               │                 │             │           │  └──────────────────────────►┘
  └───────────────┴─────────────────┴─────────────┴───────────┴──────────► cancelled
```

| Desde → hasta | Quién | Guardas |
|---|---|---|
| `draft → awaiting_location` | sistema | `deliveryType = delivery` |
| `draft → confirmed` | sistema | pickup/dine_in; caja abierta; capacidad disponible |
| `awaiting_location → confirmed` | sistema | cotización aplicada; capacidad disponible |
| `confirmed → preparing` ("Iniciar") | kitchen, admin, owner | `paymentStatus = paid`, salvo delivery + cash |
| `preparing → ready` ("Completar") | kitchen, admin, owner | — |
| `ready → preparing` ("Recuperar") **(nuevo)** | kitchen, admin, owner | solo si no salió a reparto |
| `ready → out_for_delivery` | cashier, admin, owner | `deliveryType = delivery` |
| `ready → delivered` | cashier, admin, owner | pickup/dine_in |
| `out_for_delivery → delivered` | cashier, admin, owner | — |
| `* → cancelled` antes de `preparing` | cashier, admin, owner, sistema (expiración), cliente vía agente | motivo obligatorio |
| `preparing/ready/out_for_delivery → cancelled` | admin, owner | motivo obligatorio |

- **kitchen nunca cancela** (hoy puede: conflicto C7).
- CAS optimista (`where status = <anterior>`) → `409 status_conflict`.
- Cada transición escribe `order_events` **(nuevo)**: `from`, `to`, `actor`,
  `reason`, `at`. Resuelve también la falta de tiempos por etapa en reportes.

**Modificación del pedido (cliente):** permitida en `draft`,
`awaiting_location` y `confirmed`, **una vez por cadena**
(`modification_count`), y nunca después de `preparing`. Se implementa con el
reemplazo atómico que ya existe en la rama (`POST /orders/:id/replace`).

## 4. Máquina de estados del pago

| Desde → hasta | Disparador |
|---|---|
| `unpaid → pending_review` | llega un comprobante asociado |
| `unpaid → paid` | `cash/confirm` o QR confirmado por el banco o simulado |
| `pending_review → paid / rejected` | decisión de staff (CAS de `payment_attempts`) |
| `rejected → pending_review` | nuevo comprobante |
| `unpaid / pending_review → paid_unapplied` | pago detectado con la sesión original ya cerrada (tras el margen de 10 min) |
| `paid_unapplied → paid` | admin lo aplica a la **sesión original**, con motivo |
| `paid / paid_unapplied → refunded` | admin registra la devolución manual |

Un pago nunca cambia de `cash_register_session_id` en silencio.

## 5. Caja

- Una sesión abierta por restaurante; varias sesiones por día.
- `orders.cash_register_session_id` y `payment_attempts.cash_register_session_id`.
- Cierre transaccional:
  1. `select … for update` sobre la sesión y paso a `closing`.
  2. Contar comprobantes `pending_review` de pedidos de la sesión o creados
     durante ella sin sesión.
  3. Si hay alguno y no viene `force` → `409 cash_register_close_blocked` con
     `details.pendingProofs[] {orderId, orderNumber, customerName, amount, proofId}`;
     la sesión vuelve a `open`.
  4. `force: true` exige rol admin/owner y `forceReason` (auditado en la sesión).
  5. Calcular y congelar totales; `closed`.
- Un pedido sin comprobante no bloquea.

## 6. Capacidad de cocina **(nuevo)**

`restaurant_settings`: `queueEnabled`, `kitchenActiveOrdersLimit`,
`promotionActiveOrdersLimit`, `retryAfterMinutes`.

Se evalúa en `POST /orders` **antes de confirmar** (activos = `confirmed` +
`preparing`, con bloqueo por restaurante). Sin cupo:

- canal whatsapp/web → `409 kitchen_saturated` con
  `details.retryAfterMinutes`; no se crea el pedido ni se genera el QR.
- canal pos → mismo error, y admin/owner puede reenviar con `overrideCapacity: true`.

## 7. Entidades (forma de respuesta, camelCase)

```ts
Restaurant { id, slug, name, timezone, currency, origin: DataOrigin, isActive }

RestaurantSettings { restaurantId, businessOpensHour, businessClosesHour,
  lateReviewClosesHour, ordersPaused, pickupEnabled, dineInEnabled,
  rainSurchargeEnabled, rainSurchargeAmount, latitude, longitude,
  enabledPaymentMethods: PaymentMethod[], paymentProvider: 'baneco'|'mock',
  queueEnabled, kitchenActiveOrdersLimit, promotionActiveOrdersLimit,
  retryAfterMinutes, messages: { closed, saturated, paused } }

Category { id, restaurantId, name, sortOrder, isActive }

Product { id, restaurantId, categoryId, code, name, description, price,
  isActive, isAvailable, sortOrder, imageUrl: string|null,
  optionGroups: ProductOptionGroup[] }

ProductOptionGroup { id, productId, name, minSelect, maxSelect, sortOrder,
  options: ProductOption[] }
ProductOption { id, groupId, name, price /* >= 0 */, isAvailable, sortOrder }

Promotion { id, name, description, promoPrice, isActive, startsAt, endsAt,
  sortOrder, imageUrl, archivedAt, revision, status, items[] }

Customer { id, restaurantId, name, phone, email }

Order { id, restaurantId, orderNumber, displayNumber, channel, deliveryType,
  tableNumber, paymentMethod, paymentStatus, status, customerId, customerName,
  customerNotes, kitchenNotes, subtotalAmount, deliveryBaseAmount,
  deliverySurchargeAmount, totalAmount, cashRegisterSessionId,
  replacesOrderId, modificationCount, cancelledReason, cancelledBy,
  sourceMetadata, confirmedAt, cashConfirmedAt, createdAt, updatedAt,
  items: OrderItem[], promotions: OrderPromotion[] }

OrderItem { id, productId, productCodeSnapshot, productNameSnapshot,
  unitPriceSnapshot, quantity, subtotal, kitchenStatus,
  options: { optionId, groupNameSnapshot, nameSnapshot, priceSnapshot }[] }

KitchenTicket   // vista reducida: sin precios, teléfonos ni datos de pago
{ orderId, displayNumber, channel, deliveryType, tableNumber, status,
  customerNotes, kitchenNotes, createdAt, startedAt,
  lines: { name, quantity, options: string[], kitchenStatus }[],
  combos: { name, quantity, components: { name, quantity }[] }[] }

PaymentAttempt { id, orderId, cashRegisterSessionId, openedAs, reviewStatus,
  method, amount, reviewedAt, reviewedBy }

CashRegisterSession { id, restaurantId, status, openedAt, openedBy,
  openingAmount, closedAt, closedBy, countedCashAmount, expectedCashAmount,
  cashDifference, totalCashSalesAmount, totalQrSalesAmount, totalSalesAmount,
  forcedClose: { reason, by, pendingProofCount } | null, liveTotals? }
```

`totalAmount = subtotalAmount + deliveryBaseAmount + deliverySurchargeAmount`;
`subtotalAmount = Σ items.subtotal + Σ promotions.subtotal`;
`item.subtotal = (unitPrice + Σ option.price) × quantity`.

## 8. Endpoints: qué se conserva y qué se agrega

Se conserva todo lo del inventario. Se agregan:

| Endpoint | Rol | Para |
|---|---|---|
| `POST /orders/:id/start` · `/complete` · `/recall` | kitchen+ | acciones del KDS (atajos de `PATCH /status`) |
| `POST /orders/:id/kitchen-note` | kitchen+ | escribe en `kitchenNotes` (hoy mezcla con `notes`) |
| `POST /orders/:id/cancel` `{reason}` | cashier+ | cancelación autorizada |
| `GET /kitchen/tickets?status=` | kitchen+ | `KitchenTicket[]` sin datos sensibles |
| `POST /cash-register/sessions/close` `{countedCashAmount, notes?, force?, forceReason?}` | cashier+; `force` admin+ | cierre con bloqueo |
| `GET /cash-register/sessions/current/blockers` | cashier+ | previsualizar comprobantes pendientes |
| `GET /capacity` | cualquiera autenticado | estado de saturación |
| `PATCH /restaurant-settings` | admin+; campos críticos owner | configuración |
| CRUD `/products/:id/option-groups`, `/option-groups/:id/options` | admin+ | extras |
| `POST /demo/payments/:orderId/simulate-qr` | admin+, solo `paymentProvider = mock` | QR simulado |
| `POST /demo/restaurants/:slug/load` · `/reset` · `/fake-orders` · `DELETE /demo/test-orders` | owner | demos; solo toca filas `origin ≠ real` |

## 9. Roles y permisos

| Acción | owner | admin | cashier | kitchen | servicio `whatsapp-gateway` |
|---|---|---|---|---|---|
| Usuarios, configuración crítica, restaurar demo | ✓ | — | — | — | — |
| Catálogo, promociones, configuración operativa | ✓ | ✓ | — | disponibilidad | — |
| Crear pedido | ✓ | ✓ | ✓ | — | ✓ |
| Cobrar, abrir y cerrar caja | ✓ | ✓ | ✓ | — | — |
| Forzar cierre, aplicar o devolver `paid_unapplied` | ✓ | ✓ | — | — | — |
| Cancelar antes de preparar | ✓ | ✓ | ✓ | — | ✓ (a pedido del cliente) |
| Cancelar después de preparar | ✓ | ✓ | — | — | — |
| Iniciar, completar, recuperar, nota operativa | ✓ | ✓ | — | ✓ | — |
| Ver precios y datos de pago | ✓ | ✓ | ✓ | — | ✓ (solo su cliente) |
| Confirmar un pago | ✓ | ✓ | ✓ | — | **nunca** |

## 10. Errores

Forma: `{ code, message, details }`. Códigos existentes que se conservan:
`validation_error`, `not_found`, `closed`, `product_unavailable`,
`promotion_unavailable`, `payment_required`, `status_conflict`,
`invalid_state_transition`, `cash_register_closed`,
`customer_identity_conflict`, `payment_proof_no_match`. Nuevos:

| Código | HTTP | Cuándo |
|---|---|---|
| `kitchen_saturated` | 409 | sin capacidad; `details.retryAfterMinutes` |
| `orders_paused` | 409 | pausa operativa; ya existe en la rama y no afecta al canal `pos` |
| `modification_limit_reached` | 409 | segundo cambio del cliente |
| `order_not_modifiable` | 409 | cambio después de `preparing` |
| `cash_register_close_blocked` | 409 | comprobantes pendientes; `details.pendingProofs` |
| `force_reason_required` | 400 | `force` sin motivo |
| `forbidden_transition_for_role` | 403 | p. ej. kitchen intentando cancelar |
| `demo_operation_on_real_data` | 409 | reset/limpieza que tocaría filas `origin = real` |
| `payment_provider_not_mock` | 409 | simular QR en un restaurante con banco real |

## 11. Contrato con el agente (dirección backend → agente)

Se conserva el de `docs/gateway-integration.md`:
`POST /gateway/whatsapp/messages`, `POST /gateway/whatsapp/location-requests`,
`POST /gateway/telegram/alerts`. Se agrega en el payload `restaurantId` y un
`kind` estable (`order_confirmed`, `order_ready`, `payment_confirmed`,
`kitchen_saturated`, `store_closed`, …) para que el agente elija la plantilla
sin interpretar texto.

## 12. Pruebas mínimas de `packages/state-machine` (Fase 1)

- Todas las transiciones legales e ilegales de pedido y de pago (tabla completa).
- Guarda de pago en `confirmed → preparing`, con la excepción delivery + efectivo.
- kitchen no puede cancelar; cashier no puede cancelar después de `preparing`.
- Modificación: una sola vez y nunca después de `preparing`.
- `ready → out_for_delivery` solo para delivery.
- Cierre: bloqueado con `pending_review`, permitido sin comprobante, `force`
  solo con rol y motivo.
- Aritmética de totales con extras de precio 0 y combos.
