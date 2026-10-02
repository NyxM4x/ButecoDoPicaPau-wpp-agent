# Integración con el agente de WhatsApp

Este documento es para quien implemente el agente de WhatsApp (`saas_smarky`
o su reemplazo). El backend central ya tiene toda la lógica de negocio
(pedidos, pagos, delivery, promociones) — el agente **no debe reimplementar
nada de eso**, solo:

1. Recibir mensajes de WhatsApp y traducirlos a llamadas HTTP hacia este
   backend (dirección **agente → backend**, sección 2).
2. Exponer 3 endpoints propios para que este backend le pida enviar
   mensajes salientes (dirección **backend → agente**, sección 3).

## 0. Autenticación

Dos bearer tokens completamente independientes, nunca en el mismo header:

- **Agente → backend**: `Authorization: Bearer <SERVICE_AUTH_TOKENS del api_client "whatsapp-gateway">`. Te lo pasamos aparte (no va en este doc ni en el repo).
- **Backend → agente**: el backend manda `Authorization: Bearer <GATEWAY_AUTH_TOKEN>` en cada llamada a tus endpoints. Debes validar ese valor exacto — también te lo pasamos aparte.

Todas las llamadas en ambas direcciones son JSON (`Content-Type: application/json`).

## 1. Base URL

`https://<a-confirmar-tras-el-deploy-en-railway>`

## 2. Lo que el agente llama hacia el backend

### 2.0 Estado operativo

```
GET /operational-settings
```

Entre otros campos devuelve:

```json
{ "ordersPaused": false }
```

`ordersPaused: true` significa que los pedidos digitales nuevos están
pausados temporalmente por saturación. El agente/menú puede usarlo para
mostrar el aviso antes del checkout, pero Backend Central también lo valida:
`POST /orders` y `POST /orders/:id/replace` responden
`409 orders_paused` para canales `web` y `whatsapp`.

Los pedidos existentes siguen su curso y POS no se bloquea con esta bandera.

### 2.1 Resolver/crear cliente

```
POST /customers/find-or-create
{ "phone": "+59171234567", "name": "Juan Pérez" }
→ 200/201 { "id": "<customerId>", "name": "...", "phone": "...", "email": null }
```

Guarda ese `customerId` — lo necesitas para todo lo demás.

### 2.2 Consultar menú (para armar el catálogo que le muestras al cliente)

```
GET /categories
GET /products
GET /promotions
```

Cada producto trae `imageUrl` — `null` si no tiene foto, o una ruta relativa
(`/products/:id/image`) si tiene. Para mandarla por WhatsApp: pedila con
`GET <baseUrl><imageUrl>` con tu mismo bearer de servicio, y subí los bytes
que te devuelve a la Media API de WhatsApp (no es una URL pública que
puedas pasarle directo a Meta).

### 2.3 Crear pedido

```
POST /orders
Idempotency-Key: <uuid único por intento — SIEMPRE, ver nota abajo>
{
  "customerId": "<customerId>",
  "channel": "whatsapp",
  "customerName": "Juan Pérez",
  "deliveryType": "delivery" | "pickup" | "dine_in",   // pickup = para llevar, dine_in = comer en el local
  "paymentMethod": "qr" | "cash" | "card",
  "notes": "sin cebolla" ,           // opcional
  "items": [ { "productId": "<uuid>", "quantity": 2 } ],
  "promotions": [ { "promotionId": "<uuid>", "quantity": 1, "revision": 3 } ] // opcional; revision = el que te devolvió GET /promotions
}
```

Respuestas posibles:
- **200/201** — pedido creado. `200` si repetiste la misma `Idempotency-Key` con el mismo cuerpo (no se duplicó, te devuelve el mismo pedido de antes).
- **202** — el pedido queda pendiente de que un humano lo acepte (`late_order_request`). Pasa cada vez que no hay staff con la caja abierta en ese momento — puede ser tarde en la noche, pero también temprano si todavía no abrieron, o si cerraron antes de lo habitual esa noche en particular (el horario real varía). Avísale al cliente que su pedido está "en revisión", nunca que está confirmado — vence solo a los 10 minutos si nadie lo revisa.
- **409 `closed`** — fuera de cualquier horario plausible del local (ej. de madrugada/mañana), no se puede pedir.
- **409 `product_unavailable`** / **`promotion_unavailable`** — algo del carrito ya no está disponible; el `details` trae qué producto/promo fue.

**Sobre `Idempotency-Key`**: generá un UUID nuevo por cada intento REAL del usuario de confirmar su pedido, y **reusá el mismo UUID** si estás reintentando la misma request por un timeout/error de red — así nunca se duplica el pedido. No generes uno nuevo en cada reintento automático.

### 2.3.1 Reemplazar un pedido todavía modificable

Si el cliente quiere rearmar un pedido existente, el agente **no** cancela
primero y después crea otro con dos requests independientes. Usa una sola
operación idempotente:

```
POST /orders/:id/replace
Idempotency-Key: <uuid único para este reemplazo>
{
  "channel": "web" | "whatsapp",
  "deliveryType": "delivery" | "pickup" | "dine_in",
  "paymentMethod": "qr" | "cash" | "card",
  "notes": "sin cebolla",
  "items": [ { "productId": "<uuid>", "quantity": 2 } ],
  "promotions": [ { "promotionId": "<uuid>", "quantity": 1, "revision": 3 } ]
}
```

El backend mantiene el mismo cliente del pedido anterior y ejecuta en una
sola transacción: valida el pedido viejo, crea/revalida el carrito nuevo,
marca el anterior como `cancelled` y guarda `replaces_order_id`.

Solo se reemplazan automáticamente pedidos en `awaiting_location` o
`confirmed` que no tengan pago, comprobante, QR activo, efectivo confirmado
ni delivery ya pagado. Si hay dinero o comprobante en curso responde
`409 order_payment_in_progress`; si el estado ya no admite cambios responde
`409 order_not_replaceable`.

Si el pedido anterior ya tenía un delivery cotizado y el nuevo sigue siendo
delivery, el backend conserva ubicación/tarifa y recalcula el total con el
nuevo subtotal. Si el nuevo pedido necesita una ubicación nueva, vuelve a
`awaiting_location`.

### 2.4 Delivery: pedir y adjuntar ubicación

```
POST /orders/:id/location-request     // le pide la ubicación al cliente (dispara aviso de WhatsApp)
POST /orders/:id/location
{ "latitude": -16.5, "longitude": -68.15 }
```

Adjuntar la ubicación dispara la cotización automáticamente (distancia real
por calle, tarifa, recargo por lluvia si aplica). La respuesta trae el
pedido actualizado con `totalAmount` ya con el delivery incluido — ahí es
cuando le confirmás el total final al cliente.

### 2.5 Pago QR

Para pedidos con `paymentMethod: "qr"`, el backend genera y envía el QR
automáticamente cuando el total del pedido ya es definitivo:

- `pickup` / `dine_in`: después de crear el pedido.
- `delivery`: **no** se genera al crear el pedido. Primero se adjunta la
  ubicación y se congela la cotización de delivery; recién con
  `deliveryQuoteStatus: "quoted"` se genera el QR por el total final.
- Si el delivery queda en `pending_manual`, el QR espera hasta que el staff
  fije la tarifa manual.

El QR llega al gateway como un mensaje normal
(`POST /gateway/whatsapp/messages` con `imageUrl`) — el agente no debe
solicitarlo ni calcular su monto. La confirmación del pago también es
automática: el backend consulta al banco y, cuando se confirma, manda otro
mensaje saliente al cliente.

Si por algún motivo el banco falla al generar el QR, el backend cae a pedir
la captura como antes (mismo mecanismo de `payment-proofs` de abajo) — el
agente no necesita distinguir un caso del otro, ambos llegan como mensajes
salientes normales.

#### Comprobante de pago (fallback si el cliente paga por fuera y manda foto igual)

Cuando el cliente manda la foto del comprobante:

```
POST /payment-proofs
{
  "customerId": "<customerId>",
  "sourceMessageId": "<id del mensaje de WhatsApp de la foto — único, es la barrera de idempotencia>",
  "contextMessageId": "<id del mensaje AL QUE el cliente respondió, si fue una respuesta directa — si no, omitir>",
  "mimeType": "image/jpeg",
  "fileBase64": "<contenido del archivo en base64>"
}
```

El backend decide solo a qué pedido pertenece (por respuesta directa al
mensaje del QR, o único pedido QR abierto reciente del cliente). Si no
puede decidir, responde `422 payment_proof_no_match` o deja una
`routingException` explícita para revisión humana.

Si el análisis visual corre en el gateway, después de guardar el comprobante
envía su resultado a Backend Central:

```
POST /payment-proofs/:proofId/analysis

{
  "status": "ok",
  "verdict": "ok" | "suspicious" | "unreadable",
  "reasons": ["account_mismatch"],
  "amount": 48,
  "amountLabel": "pago_total" | "pago_productos" | "revisar_monto",
  "reference": "TX-123",
  "model": "gpt-5-mini",
  "destinationAccount": "...",
  "destinationHolder": "...",
  "destinationBank": "..."
}
```

Si visión/modelo falla:

```
POST /payment-proofs/:proofId/analysis
{ "status": "failed" }
```

El análisis es **informativo**: no acepta ni rechaza el pago y no cambia
`payment_status` ni `review_status`. Un resultado exitoso es inmutable:
repetir exactamente el mismo resultado es idempotente; intentar reemplazarlo
por otro devuelve `409 payment_proof_analysis_already_recorded`. Un
`failed` sí puede reintentarse después con un resultado `ok`.

### 2.6 Consultar contexto del pedido activo del cliente

Cuando el agente recibe un mensaje espontáneo y conoce al cliente pero no
tiene un `orderId` confiable en memoria, usa:

```
GET /customers/:customerId/active-order
```

Responde `null` si el cliente no tiene un pedido activo. Si existe uno,
devuelve solo hechos de negocio necesarios para que el canal decida qué
respuesta conversacional dar, por ejemplo:

```json
{
  "orderId": "<uuid>",
  "orderNumber": "ORD-000123",
  "status": "awaiting_location",
  "paymentStatus": "pending_review",
  "paymentMethod": "qr",
  "totalAmount": 62,
  "subtotalAmount": 50,
  "deliveryType": "delivery",
  "deliveryQuoteStatus": "quoted",
  "cashConfirmed": false,
  "locationReceived": true,
  "proofReceived": true,
  "latestPaymentAttempt": {
    "reviewStatus": "pending_review",
    "reviewedAt": null
  },
  "createdAt": "2026-09-19T01:00:00.000Z"
}
```

El backend decide qué pedido está activo; el agente decide qué decirle al
cliente. El endpoint no expone coordenadas ni requiere acceso directo a
Postgres/Supabase.

Si ya tienes un `orderId` específico y necesitas el pedido completo, sigue
disponible:

```
GET /orders/:id
```

## 3. Lo que el agente debe exponer (el backend te llama a vos)

Estos 3 endpoints son responsabilidad del agente. El backend reintenta
automáticamente con backoff si fallan (hasta 8 intentos), así que
devolver un error HTTP ante un fallo real (en vez de colgarse) es correcto.

### 3.1 Enviar mensaje de WhatsApp

```
POST /gateway/whatsapp/messages
{ "customerId": "<uuid>", "to": "+59171234567", "text": "Recibimos tu pedido ORD-000123.", "imageUrl": "..." }  // imageUrl opcional
→ 200 { "externalMessageId": "<id del mensaje que devuelve la API de WhatsApp>" }
```

`externalMessageId` es importante: el backend lo guarda y lo usa después
para reconocer cuándo un cliente **responde directamente** a ese mensaje
(por ejemplo, para asociar un comprobante al pedido correcto sin
ambigüedad). Si tu proveedor de WhatsApp no te da un id de mensaje,
devolvé cualquier string único y estable para ese envío.

`to` es el teléfono E.164 ya resuelto por Backend Central. El gateway **no**
debe consultar la tabla `customers` ni mantener un cache `customerId -> phone`.
`customerId` viaja además como correlación/auditoría; `to` es el destino
de transporte que se entrega a Kapso/Meta.

### 3.2 Pedir ubicación al cliente

```
POST /gateway/whatsapp/location-requests
{ "customerId": "<uuid>", "to": "+59171234567", "reason": "delivery_location" }
→ 204 (sin body)
```

### 3.3 Alerta a Telegram (grupo de staff)

```
POST /gateway/telegram/alerts
{
  "chatRef": "staff-group",
  "text": "Solicitud fuera de horario SOL-000045 — Juan Pérez, total 45.00.",
  "editMessageId": "<opcional — si viene, editá el mensaje existente en vez de mandar uno nuevo>",
  "buttons": [
    { "label": "Aceptar", "action": "late-order-requests/<id>/accept" },
    { "label": "Rechazar", "action": "late-order-requests/<id>/reject" }
  ]
}
→ 200 { "externalMessageId": "<id del mensaje de Telegram>" }
```

Los botones son solo texto/acción para que vos armes el teclado inline de
Telegram — el backend no sabe nada de la UI de Telegram, solo te pasa
label+action.

## 4. Errores

Todos los errores de este backend tienen esta forma (nunca texto crudo de
Postgres ni stack traces):

```json
{ "code": "product_unavailable", "message": "...", "details": { "...": "..." } }
```

Usá `code` para decidir programáticamente qué decirle al cliente; `message`
es para vos (debug), no está pensado para mostrárselo tal cual al usuario final.
