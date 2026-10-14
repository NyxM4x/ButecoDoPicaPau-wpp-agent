# Contrato del POS — versión v1

Última actualización: 2026-10-13.

Este documento es para quien construya o mantenga un POS al que se conecte el
agente de WhatsApp. Describe **todo** lo que viaja entre los dos. Un POS que lo
cumple se conecta al agente cambiando dos variables (`CENTRAL_API_BASE_URL` y
`CENTRAL_API_TOKEN`), sin tocar código del agente.

Son tres piezas que dicen lo mismo y se cambian juntas:

| Pieza | Para qué |
|---|---|
| Este documento | Leerlo |
| [`apps/agent-whatsapp/src/lib/central/contract.ts`](../apps/agent-whatsapp/src/lib/central/contract.ts) | Los mismos tipos, rutas y códigos, para el compilador |
| [`scripts/check-pos-contract.mjs`](../scripts/check-pos-contract.mjs) | Comprobar un POS de verdad ([cómo](#comprobar-un-pos)) |

La implementación de referencia es `apps/backend` de este repositorio.

## Quién hace qué

```text
  Cliente ──WhatsApp──► Agente ──────── (1) llamadas del agente ───────► POS
                          ▲                                               │
                          └──────── (2) gateway: mensajes a enviar ───────┘
```

- **El POS es el dueño del negocio**: catálogo, precios, totales, horario,
  envío, estados del pedido y del pago. Decide también **qué** se le dice al
  cliente sobre su pedido y **cuándo**.
- **El agente es el dueño de la conversación**: recibe los mensajes, muestra el
  menú, arma el carrito y entrega al POS lo que el cliente decidió. No calcula
  precios ni totales y no confirma pagos.
- El agente **tiene** WhatsApp y Telegram; el POS no. Cuando el POS necesita
  avisar algo, se lo pide al agente por el gateway (sentido 2).

Un agente atiende **un** restaurante. Un POS multi-tenant guarda, por cada
restaurante: el token que le dio a su agente, y la URL y el token del gateway
de ese agente.

## Reglas generales

1. **El restaurante sale del token.** Ninguna ruta ni cuerpo lleva
   `restaurantId`. Con el token de un restaurante no se puede leer ni tocar
   nada de otro: sus ids responden `404 not_found`.
2. **Autenticación**: `Authorization: Bearer <token>` en las dos direcciones,
   con dos tokens distintos (uno por sentido). Sin token o con uno inválido:
   `401`.
3. **Formato**: JSON en UTF-8, campos en `camelCase`.
4. **Dinero**: números (`18`, `18.5`), nunca texto. En la moneda del perfil.
5. **Fechas**: ISO 8601 en UTC (`2026-10-13T07:45:14.436Z`).
6. **Ids**: UUID. Un id con otra forma responde `400`.
7. **Teléfonos**: E.164 con `+` (`+59170010001`).
8. **Campos de más**: el POS puede devolver campos que este documento no
   nombra; el agente los ignora. Los que sí nombra son obligatorios.
9. **Tiempo de respuesta**: el agente espera 8 segundos. Pasado eso trata la
   llamada como fallida.
10. **Errores**: siempre con esta forma y el estado HTTP que corresponda.

    ```json
    { "code": "product_unavailable", "message": "…", "details": { } }
    ```

    El agente decide por `code` y por el estado; `message` es para depurar y
    nunca se le muestra al cliente. `details` puede ser `null`. Un `400` es
    siempre «el cuerpo no es válido», tenga el `code` que tenga.

### Idempotencia

`POST /orders`, `POST /orders/:id/replace` y `POST /delivery/quotes` exigen la
cabecera `Idempotency-Key` (sin ella, `400`).

| Caso | Respuesta |
|---|---|
| Clave nueva | Se ejecuta. `201` |
| Misma clave y mismo cuerpo | No se ejecuta de nuevo: devuelve lo de la primera vez. `200` |
| Misma clave y otro cuerpo | `409 idempotency_key_reused` |
| Misma clave mientras la primera sigue en curso | `409 idempotency_in_progress` |
| La primera vez falló (por ejemplo `product_unavailable`) | La clave **no** queda usada: se puede corregir y reintentar |

El agente usa una clave por enlace de menú (`menu-session:<id>`): un enlace, un
pedido.

## 1. Lo que el agente llama en el POS

Base: `CENTRAL_API_BASE_URL`. Token: `CENTRAL_API_TOKEN`.

| Llamada | Cuándo la usa el agente |
|---|---|
| [`GET /restaurant/profile`](#get-restaurantprofile) | Al abrir el menú y al armar lo que dice del local |
| [`GET /categories`](#get-categories), [`GET /products`](#get-products), [`GET /promotions`](#get-promotions) | Cada vez que alguien abre el menú o envía un pedido |
| [`GET /products/:id/image`](#get-productsidimage) | Al mostrar la foto de un producto |
| `GET` de la ruta que venga en `imageUrl` (`/orders/:id/qr-image`) | Al enviar el QR de pago: responde la imagen (`image/png` o `image/jpeg`) con el mismo token |
| [`POST /customers/find-or-create`](#post-customersfind-or-create) | Antes de cualquier llamada que necesite al cliente |
| [`GET /customers/:id/active-order`](#get-customersidactive-order) | Cuando llega un mensaje y hay que saber en qué está su pedido |
| [`POST /orders`](#post-orders) | El cliente confirma el carrito |
| [`POST /orders/:id/location`](#post-ordersidlocation) | El cliente manda su ubicación |
| [`POST /orders/:id/cash/confirm`](#post-ordersidcashconfirm-y-cancel) y `/cancel` | El cliente toca CONFIRMAR o CANCELAR |
| [`POST /orders/:id/staff/ready`](#acciones-del-personal-post-ordersidstaffaction), `/out` y `/delivered` | El personal toca un botón del aviso en Telegram |
| [Ampliación](#ampliación-de-la-v1) | Comprobantes, cambiar el pedido, nota de cocina, pasar a retiro, cotizar un punto |

### `GET /restaurant/profile`

Lo que el agente dice del local. No lleva parámetros.

```json
{
  "contractVersion": "v1",
  "name": "Buteco do Pica-Pau",
  "description": "bar y cocina brasileña en Santa Cruz",
  "locale": "es-BO",
  "timezone": "America/La_Paz",
  "currency": { "code": "BOB", "symbol": "Bs" },
  "phone": "+59170000000",
  "location": {
    "address": "Av. Ejemplo 123, frente a la plaza",
    "mapsUrl": "https://maps.app.goo.gl/…",
    "latitude": -17.7833,
    "longitude": -63.1821
  },
  "hours": {
    "text": "de martes a domingo, de siete de la tarde a dos de la madrugada",
    "weekly": [
      { "opens": "19:00", "closes": "02:00" },
      null,
      { "opens": "19:00", "closes": "02:00" },
      { "opens": "19:00", "closes": "02:00" },
      { "opens": "19:00", "closes": "02:00" },
      { "opens": "19:00", "closes": "02:00" },
      { "opens": "19:00", "closes": "02:00" }
    ]
  },
  "ordering": {
    "paused": false,
    "pickupEnabled": true,
    "deliveryEnabled": true,
    "paymentMethods": ["cash", "qr"]
  },
  "messages": { "greeting": null, "farewell": null },
  "menuMedia": { "videoUrl": null, "imageUrl": null }
}
```

| Campo | Tipo | Notas |
|---|---|---|
| `contractVersion` | texto | `"v1"` |
| `name` | texto | No vacío |
| `description` | texto o `null` | Qué vende y dónde, en una línea. El agente lo usa para presentarse |
| `locale` | texto | BCP 47. Idioma en que se le habla al cliente |
| `timezone` | texto | Zona IANA. Las horas de `weekly` están en esta zona |
| `currency.code` / `.symbol` | texto | ISO 4217 y el símbolo tal como lo ve el cliente |
| `phone` | texto o `null` | Teléfono del local para el cliente, E.164 |
| `location.address` | texto o `null` | En palabras. Con `null` el agente solo pasa el enlace |
| `location.mapsUrl` | texto o `null` | Enlace de Google Maps |
| `location.latitude` / `.longitude` | número o `null` | Obligatorias si `deliveryEnabled` es `true` |
| `hours.text` | texto o `null` | El horario en palabras, para repetirlo tal cual. Con `null` el agente lo arma de `weekly` |
| `hours.weekly` | lista de 7 | De domingo (índice 0) a sábado (6). Cada entrada es `{ opens, closes }` en `HH:MM` de 24 horas, o `null` si ese día no abre. `closes` menor que `opens` = termina al día siguiente. Iguales = 24 horas |
| `ordering.paused` | booleano | Pausa temporal de pedidos nuevos (cocina saturada) |
| `ordering.pickupEnabled` | booleano | Se ofrece pasar a retirar |
| `ordering.deliveryEnabled` | booleano | Se ofrece envío a domicilio |
| `ordering.paymentMethods` | lista | Subconjunto no vacío de `cash`, `qr`, `card`, en el orden a mostrar |
| `messages.greeting` / `.farewell` | texto o `null` | Saludo y despedida propios del local. Con `null` el agente usa los suyos |
| `menuMedia.videoUrl` / `.imageUrl` | texto o `null` | Cabecera del mensaje del menú. URL pública con https. El video, MP4 H.264 Baseline |

Lo que diga el perfil y lo que el POS acepte tienen que coincidir: si el perfil
dice `deliveryEnabled: false`, `POST /orders` con envío responde
`409 delivery_disabled`. El perfil solo decide qué se le ofrece al cliente; la
regla la aplica el POS al crear el pedido.

### `GET /categories`

Solo las activas, ordenadas por `sortOrder`.

```json
[{ "id": "…", "name": "Bebidas", "sortOrder": 10, "isActive": true }]
```

### `GET /products`

Solo los activos. Un producto **agotado** llega con `isAvailable: false`: el
menú lo enseña en gris y no deja pedirlo.

```json
[{
  "id": "…", "code": "caipirinha", "name": "Caipirinha",
  "description": "Cachaça, limón y azúcar.", "categoryId": "…", "price": 25,
  "isActive": true, "isAvailable": true, "sortOrder": 10,
  "imageUrl": "/products/<id>/image"
}]
```

- `code`: código estable y legible, único en el restaurante. El carrito del
  agente habla en `code`; el pedido se manda con `id`.
- `imageUrl`: `null`, o exactamente la ruta `/products/<id>/image`. Nunca una
  URL pública.
- Un producto cuya categoría no está en `GET /categories` no aparece en el menú.

### `GET /promotions`

Todas las que no estén archivadas pueden venir (activas, apagadas, programadas
o vencidas): el agente decide cuál mostrar con `isActive`, `startsAt` y
`endsAt`. Las archivadas (`archivedAt` con fecha) se ignoran.

```json
[{
  "id": "…", "name": "Combo pareja", "description": null, "promoPrice": 50,
  "isActive": true, "archivedAt": null, "startsAt": null, "endsAt": null,
  "sortOrder": 10, "imageUrl": null, "revision": 3,
  "items": [{ "productId": "…", "productName": "Caipirinha", "quantity": 2, "unitPrice": 25 }]
}]
```

`revision` aumenta cada vez que cambian el precio o los componentes. El agente
la devuelve en `POST /orders`; si ya no coincide, el POS rechaza la promoción
para no cobrar términos que el cliente no vio.

**Platos con opciones (solo presentación).** El menú web junta en una sola
tarjeta los productos de una misma categoría cuyo `name` empieza igual y sigue
con ` - ` (o ` · `, ` — `, ` | `, con espacios): «Tabla - Pollo» y «Tabla -
Costilla» se muestran como un plato «Tabla» con dos opciones. No es parte del
contrato: cada opción sigue siendo un producto, con su `id`, su precio y su
`isAvailable`, y así se pide. Un POS que no quiera ese agrupado solo tiene que
no usar ese separador en los nombres.

### `GET /products/:id/image`

Los bytes de la foto, con `Content-Type` `image/jpeg`, `image/png` o
`image/webp`. Con el mismo token que el resto (el agente la reenvía al
navegador; el token nunca sale del servidor).

- Producto sin foto: `404 product_image_not_set`.
- Producto que no existe: `404 not_found`.

### `POST /customers/find-or-create`

```json
{ "phone": "+59170010001", "name": "María" }
```

`name` es opcional. Responde `200` o `201`:

```json
{ "id": "…", "name": "María", "phone": "+59170010001", "email": null }
```

El mismo teléfono devuelve siempre el mismo `id`. El agente no guarda ese id:
lo pide cada vez.

### `GET /customers/:id/active-order`

El pedido en curso del cliente: el más reciente en `awaiting_location`,
`confirmed`, `preparing`, `ready` u `out_for_delivery`. Responde `200` con
`null` si no tiene ninguno.

```json
{
  "orderId": "…", "orderNumber": "ORD-000123",
  "status": "confirmed", "paymentStatus": "unpaid", "paymentMethod": "cash",
  "totalAmount": 72, "subtotalAmount": 54,
  "deliveryType": "delivery", "deliveryQuoteStatus": "quoted",
  "cashConfirmed": false, "locationReceived": true, "proofReceived": false,
  "latestPaymentAttempt": null,
  "createdAt": "2026-10-13T01:00:00.000Z"
}
```

Son hechos, no instrucciones: el POS dice en qué está el pedido y el agente
decide qué contestar. No trae coordenadas ni datos de otros clientes.

- Cliente que no existe: `404 not_found`.

### `POST /orders`

Cabecera `Idempotency-Key` obligatoria.

```json
{
  "customerId": "…",
  "channel": "whatsapp",
  "customerName": "María",
  "deliveryType": "delivery",
  "paymentMethod": "cash",
  "notes": "sin cebolla",
  "items": [{ "productId": "…", "quantity": 2 }],
  "promotions": [{ "promotionId": "…", "quantity": 1, "revision": 3 }]
}
```

| Campo | Notas |
|---|---|
| `channel` | El agente manda siempre `whatsapp` |
| `customerName` | 1 a 100 caracteres |
| `deliveryType` | `delivery` o `pickup` (`dine_in` existe para el mostrador) |
| `paymentMethod` | `cash`, `qr` o `card` |
| `notes` | Opcional, hasta 500 caracteres |
| `items` | Hasta 20, sin productos repetidos, `quantity` de 1 a 10 |
| `promotions` | Opcional, hasta 10, sin repetir |

El carrito no puede ir vacío. **Los precios no viajan**: el POS calcula todo
con su catálogo.

Respuestas:

| Estado | Significado | Qué hace el agente |
|---|---|---|
| `201` | Pedido creado. Cuerpo: el [pedido](#el-pedido) | Le muestra al cliente su número de pedido |
| `200` | Reintento de la misma clave: el pedido de antes | Lo mismo, sin tratarlo como nuevo |
| `202` | **No** se creó: quedó esperando a que una persona lo acepte. Cuerpo: `{ requestId, requestNumber, status: "pending", subtotalAmount, expiresAt }` | Le dice que está en revisión, nunca que está confirmado |
| `409 closed` | Fuera del horario | «Estamos cerrados» |
| `409 orders_paused` | Pedidos nuevos en pausa | «Vuelve a intentarlo en unos minutos» |
| `409 pickup_disabled` | El retiro está apagado | Le pide elegir envío |
| `409 delivery_disabled` | El envío está apagado | Le pide elegir retiro |
| `409 payment_method_disabled` | Esa forma de pago está apagada. `details.enabled` trae las activas | Le pide elegir otra |
| `409 product_unavailable` | Un producto se apagó o se agotó. `details.unavailableProductIds` | Le pide revisar el carrito |
| `409 promotion_unavailable` | Una promoción ya no se puede vender (apagada, vencida, cambió, o un componente se agotó). `details.promotionId`, `details.reason` | Le pide recargar el menú |
| `409 idempotency_key_reused` | Ese enlace ya se usó para otro carrito | «Este enlace ya fue utilizado» |
| `400` | Cuerpo inválido | Error genérico |

Estado inicial del pedido:

- `pickup`: nace en `confirmed`. El total ya es definitivo.
- `delivery`: nace en `awaiting_location` con `deliveryQuoteStatus: "pending"`.
  El total todavía no incluye el envío.

Al crear el pedido, el POS pone en marcha los [avisos al cliente](#qué-avisa-el-pos-y-cuándo).

#### El pedido

Lo devuelven `POST /orders`, `POST /orders/:id/location`, las dos de efectivo y
`GET /orders/:id`.

```json
{
  "id": "…", "orderNumber": "ORD-000123", "customerId": "…", "channel": "whatsapp",
  "customerName": "María", "deliveryType": "delivery", "paymentMethod": "cash",
  "paymentStatus": "unpaid", "status": "confirmed", "notes": "sin cebolla",
  "subtotalAmount": 54, "deliveryBaseAmount": 18, "deliverySurchargeAmount": 0, "totalAmount": 72,
  "deliveryQuoteStatus": "quoted", "deliveryDistanceMeters": 4080,
  "cashConfirmedAt": null, "createdAt": "2026-10-13T01:00:00.000Z",
  "items": [{
    "productId": "…", "productCodeSnapshot": "caipirinha", "productNameSnapshot": "Caipirinha",
    "unitPriceSnapshot": 25, "quantity": 2, "subtotal": 50
  }],
  "promotions": []
}
```

- `orderNumber` es el número que ve el cliente.
- `totalAmount = subtotalAmount + deliveryBaseAmount + deliverySurchargeAmount`.
- `status`: `draft`, `awaiting_location`, `confirmed`, `preparing`, `ready`,
  `out_for_delivery`, `delivered`, `cancelled`.
- `paymentStatus`: `unpaid`, `pending_review`, `paid`, `rejected`,
  `paid_unapplied`, `refunded`.
- `deliveryQuoteStatus`: `null` (no es envío), `pending`, `quoted`,
  `pending_manual` (lo cotiza una persona) o `failed`.

### `POST /orders/:id/location`

```json
{ "latitude": -17.7812, "longitude": -63.1795 }
```

El POS guarda el punto, **cotiza el envío** y cierra el total, todo en esta
llamada. Responde con el [pedido](#el-pedido) ya actualizado: normalmente en
`confirmed` con `deliveryQuoteStatus: "quoted"`.

| Estado | Significado |
|---|---|
| `200`/`201` | Guardada. También si se reenvía **la misma** ubicación |
| `409 location_already_attached` | El pedido ya tiene otra ubicación |
| `409 location_not_expected` | El pedido ya no espera ubicación (se canceló, pasó a retiro) |
| `409 location_conflict` | Otra ubicación llegó al mismo tiempo. Transitorio |
| `400` | Coordenadas fuera de rango, o el pedido no es de envío |
| `404 not_found` | El pedido no existe |

A qué pedido pertenece una ubicación lo decide el POS: el agente pregunta
`active-order` y manda el punto a ese pedido.

### `POST /orders/:id/cash/confirm` y `/cancel`

Sin cuerpo. El cliente tocó uno de los dos botones del
[desglose en efectivo](#qué-avisa-el-pos-y-cuándo). Las dos responden con el
[pedido](#el-pedido).

| Llamada | Efecto | Errores |
|---|---|---|
| `/cash/confirm` | El pedido queda confirmado por el cliente (`cashConfirmedAt` con fecha) y ya puede prepararse. Repetirla no es un error | `409 cash_register_closed` si el POS exige caja abierta y no la hay |
| `/cash/cancel` | El pedido pasa a `cancelled`. Repetirla no es un error | `409 cash_order_already_confirmed` si el cliente ya había confirmado; `409 cash_order_not_cancellable` si ya está en preparación o más adelante |

En las dos: `400` si el pedido no es en efectivo y `404 not_found` si no existe.

El agente no le contesta nada al cliente por su cuenta: la respuesta la manda
el POS por el gateway.

### Acciones del personal: `POST /orders/:id/staff/:action`

El personal toca un botón del [aviso de un pedido](#post-gatewaytelegramalerts)
en Telegram. `:action` es `ready` (listo), `out` (salió a reparto) o
`delivered` (entregado).

```json
{ "actor": "Juan Pérez" }
```

`actor` es opcional: el nombre en Telegram de quien tocó, solo para el
registro. Responde `200` con **el aviso tal como queda**, que el agente pone en
lugar del mensaje anterior:

```json
{
  "text": "🆕 PEDIDO ORD-000123\n…\n\n➡️ LISTO · Juan Pérez · 21:05",
  "buttons": [{ "label": "📦 Entregado", "action": "orders/<id>/staff/delivered" }]
}
```

El POS mueve el pedido, le avisa al cliente y decide qué botones siguen
teniendo sentido. Reglas:

| Regla | Detalle |
|---|---|
| Se puede saltar pasos | De confirmado a entregado directo vale: sin pantalla nadie marca «en preparación» |
| Repetir no es un error | Un toque sobre un paso ya dado responde `200` sin cambiar nada ni volver a avisar al cliente |
| «Salió» es solo para envíos | En un pedido para retirar: `409 invalid_state_transition` |
| Solo pedidos firmes | Efectivo que el cliente confirmó, o pago aceptado. Si no: `409 order_not_firm` |
| Un pedido cancelado no se mueve | `409 invalid_state_transition` |
| Un POS con pantallas propias puede no aceptarlas | `409 staff_actions_disabled` |

`404 not_found` si el pedido o la acción no existen.

## 2. Gateway: lo que el POS llama en el agente

Base: la URL del gateway de ese restaurante (en este agente,
`<URL del agente>/api`). Token: el `GATEWAY_AUTH_TOKEN` de ese agente.

Regla para los tres: **si el mensaje no salió, se responde con error**. Nunca
un `200` «por si acaso». El POS reintenta con espera creciente (la
implementación de referencia, hasta 8 veces).

| Estado | Significado | Reintentar |
|---|---|---|
| `200` / `204` | Enviado | — |
| `400 validation_error` | Falta un campo o viene mal | No |
| `401 unauthorized` | Token inválido | No |
| `422 whatsapp_send_failed` | WhatsApp lo rechazó para siempre (número inválido) | No |
| `502 whatsapp_send_failed` / `telegram_send_failed` | Fallo del proveedor | Sí |

### `POST /gateway/whatsapp/messages`

Un texto, una imagen con el texto como pie, o un texto con botones.

```json
{
  "customerId": "…",
  "to": "+59170010001",
  "text": "Recibimos tu pedido ORD-000123.",
  "imageUrl": "https://…/qr.png",
  "buttons": [
    { "id": "cash_confirm:ORD-000123", "title": "✅ CONFIRMAR" },
    { "id": "cash_cancel:ORD-000123", "title": "❌ CANCELAR" }
  ]
}
```

| Campo | Notas |
|---|---|
| `to` | Obligatorio, E.164. El agente no busca el teléfono por su cuenta |
| `text` | Obligatorio |
| `customerId` | Opcional; solo para correlación |
| `imageUrl` | Opcional. PNG o JPEG de hasta 5 MB. Dos formas: una **ruta del propio POS** que empieza con `/` (por ejemplo `/orders/<id>/qr-image`), que el agente descarga con su token y sube a WhatsApp, o una URL pública con `https`, que WhatsApp descarga por su cuenta. El QR de pago va de la primera forma: nunca tiene dirección pública. No se combina con `buttons` |
| `buttons` | Opcional. De 1 a 3; `title` de hasta 20 caracteres; `id` de hasta 256 |

Responde `200 { "externalMessageId": "…" }`: el id del mensaje en WhatsApp. El
POS lo guarda para reconocer cuándo el cliente **responde a ese mensaje** (así
asocia un comprobante al pedido correcto).

**Ids de botones que el agente reconoce** (el número de pedido va dentro, para
que un botón de un mensaje viejo no decida sobre el pedido de hoy):

| `id` | Qué hace el agente cuando el cliente lo toca |
|---|---|
| `cash_confirm:<orderNumber>` | `POST /orders/:id/cash/confirm` |
| `cash_cancel:<orderNumber>` | `POST /orders/:id/cash/cancel` |

Cualquier otro `id` se trata como un mensaje más del cliente.

### `POST /gateway/whatsapp/location-requests`

Le pide al cliente su ubicación con el botón nativo de WhatsApp.

```json
{ "customerId": "…", "orderId": "…", "to": "+59170010001", "reason": "delivery_location" }
```

Solo `to` es obligatorio. Responde `204` sin cuerpo.

### `POST /gateway/telegram/alerts`

Un aviso al grupo del personal.

```json
{
  "chatRef": "staff-group",
  "text": "Pedido ORD-000123 confirmado en efectivo.",
  "buttons": [{ "label": "Aceptar", "action": "late-order-requests/<id>/accept" }]
}
```

Solo `text` es obligatorio. `chatRef` es `staff-group` o `delivery-group`.
Responde `200 { "externalMessageId": "…" }`.

**Botones.** Cada botón es `{ label, action }`, y `action` es la ruta del POS
que el agente llama por `POST` cuando alguien lo toca. El agente solo ejecuta
las [acciones del personal](#acciones-del-personal-post-ordersidstaffaction):

| `action` | Sale como |
|---|---|
| `orders/<id>/staff/ready`, `/out`, `/delivered` | Botón de verdad. El toque llega al POS y el mensaje se reemplaza por el aviso que el POS devuelve |
| Cualquier otra | Texto: «Resolver en el POS → …». El agente no llama a rutas que el contrato no nombra |

Si un solo botón del aviso no es de la tabla, todo el aviso sale como texto.
`action` no puede pasar de 64 bytes (límite de Telegram).

El agente manda todos los avisos al mismo grupo, sea cual sea `chatRef`.

## El despertador: lo que el POS llama cada minuto

El agente corre en Vercel y solo trabaja cuando lo llaman. Cuatro tareas suyas
no nacen de un mensaje del cliente sino del paso del tiempo, y **quien las
despierta es el POS**: cada minuto, un `POST` sin cuerpo a cada una.

Base: la misma URL del gateway. Token: el `INTERNAL_API_TOKEN` del agente
(`AGENT_INTERNAL_TOKEN` en el backend), que no es el del gateway.

| Ruta | Qué reintenta el agente |
|---|---|
| `/internal/webhook-events/worker/tick` | Mensajes entrantes que quedaron sin procesar |
| `/internal/order-notifications/worker/tick` | Avisos al cliente que no llegaron a salir |
| `/internal/telegram-alerts/worker/tick` | Alertas al personal pendientes |
| `/internal/orders/expiry/worker/tick` | Pedidos y carritos vencidos del lado del agente |

- Las cuatro **en paralelo**, cada una con hasta 55 segundos: una pasada puede
  incluir varios turnos del asistente, y que una tarde no puede frenar a las
  otras.
- Son idempotentes: llamarlas de más no duplica nada.
- Lo que respondan no le importa al POS; si una falla, se vuelve a llamar al
  minuto siguiente.

Sin esto el agente contesta igual los mensajes que le llegan, pero no recupera
nada de lo que falle. No se usa ningún servicio externo para despertarlo.

## Qué avisa el POS y cuándo

El agente manda el menú y conversa. Todo lo que se le dice al cliente **sobre
su pedido** lo decide y lo redacta el POS, en el idioma y la moneda del perfil,
y lo envía por el gateway:

| Momento | Aviso |
|---|---|
| Se crea el pedido | Texto: «Recibimos tu pedido ORD-…» |
| Pedido con envío, recién creado | `location-requests`: pide la ubicación |
| El total ya es definitivo y el pago es en **efectivo** | Texto con el desglose (productos, envío, total) y los botones `cash_confirm:` y `cash_cancel:` |
| El total ya es definitivo y el pago es por **QR** | Imagen del QR (`imageUrl` con la ruta protegida del POS) con el monto y cuánto dura. Si el POS tiene quien revise comprobantes, puede mandar en su lugar las instrucciones para enviar la captura |
| El QR no se pudo generar todavía | Texto: se está generando y llega en unos minutos (una sola vez) |
| El cliente confirmó el efectivo | Texto: el pedido pasa a cocina y cuánto paga |
| El cliente canceló | Texto: el pedido fue cancelado |
| El pago por QR se confirmó o se rechazó | Texto con el resultado |
| El pedido venció sin confirmarse | Texto: se canceló por falta de confirmación |
| El QR venció sin pagarse, o nunca se pudo generar | Texto: el pedido se canceló y por qué |
| El personal marca el pedido como **listo** | Texto: «ya está listo, puedes pasar a retirarlo», o «ya está listo y sale en breve» si es con envío |
| El personal marca que **salió** | Texto: «ya salió y va en camino» |
| El personal marca **entregado** | La despedida propia del local (`messages.farewell` del perfil), si tiene una. Si no, nada |

«El total ya es definitivo»: al crearse un pedido para retirar, o al cotizarse
el envío en `POST /orders/:id/location`.

Si el POS no manda el desglose en efectivo, el cliente nunca ve los botones y
el pedido no se confirma: ese aviso no es opcional.

## El recorrido completo

```text
Retiro en efectivo
  POST /orders ─► 201 confirmed
        POS ─► «Recibimos tu pedido»  +  desglose con CONFIRMAR / CANCELAR
  cliente toca CONFIRMAR
  POST /orders/:id/cash/confirm ─► POS ─► «Tu pedido pasa a cocina»

Envío en efectivo
  POST /orders ─► 201 awaiting_location
        POS ─► «Recibimos tu pedido»  +  pide la ubicación
  cliente manda la ubicación
  GET  /customers/:id/active-order ─► el pedido que la espera
  POST /orders/:id/location ─► 200 confirmed, cotizado
        POS ─► desglose con el envío y CONFIRMAR / CANCELAR
  cliente toca CONFIRMAR
  POST /orders/:id/cash/confirm ─► POS ─► «Tu pedido pasa a cocina»

Pago por QR
  igual hasta que el total es definitivo; entonces
        POS ─► QR con el monto
  el POS confirma el pago con el banco ─► «Pago recibido»
  si nadie paga ─► el POS anula el QR, cancela el pedido y avisa
```

El agente no interviene en el pago por QR: no genera el QR, no consulta al
banco y no decide cuándo vence. Solo entrega los mensajes del POS.

## Todos los códigos de error

| `code` | HTTP | Dónde |
|---|---|---|
| `not_found` | 404 | Cualquier id que no existe en ese restaurante |
| `closed` | 409 | `POST /orders` |
| `orders_paused` | 409 | `POST /orders`, `/replace` |
| `pickup_disabled` | 409 | `POST /orders`, `/replace`, `/switch-to-pickup` |
| `delivery_disabled` | 409 | `POST /orders`, `/replace` |
| `payment_method_disabled` | 409 | `POST /orders`, `/replace` |
| `product_unavailable` | 409 | `POST /orders`, `/replace` |
| `promotion_unavailable` | 409 | `POST /orders`, `/replace` |
| `idempotency_key_reused` | 409 | Llamadas con `Idempotency-Key` |
| `idempotency_in_progress` | 409 | Llamadas con `Idempotency-Key` |
| `customer_identity_conflict` | 409 | `POST /customers/find-or-create` |
| `location_already_attached` | 409 | `POST /orders/:id/location` |
| `location_not_expected` | 409 | `POST /orders/:id/location` |
| `location_conflict` | 409 | `POST /orders/:id/location` |
| `cash_order_already_confirmed` | 409 | `POST /orders/:id/cash/cancel` |
| `cash_order_not_cancellable` | 409 | `POST /orders/:id/cash/cancel` |
| `cash_register_closed` | 409 | `POST /orders/:id/cash/confirm` |
| `order_not_replaceable` | 409 | `POST /orders/:id/replace` |
| `order_payment_in_progress` | 409 | `POST /orders/:id/replace` |
| `kitchen_note_locked` | 409 | `POST /orders/:id/kitchen-note` |
| `kitchen_note_conflict` | 409 | `POST /orders/:id/kitchen-note` |
| `delivery_already_quoted` | 409 | `POST /orders/:id/switch-to-pickup` |
| `payment_proof_no_match` | 422 | `POST /payment-proofs` |
| `payment_proof_analysis_already_recorded` | 409 | `POST /payment-proofs/:id/analysis` |
| `product_image_not_set` | 404 | `GET /products/:id/image` |
| `order_not_firm` | 409 | `POST /orders/:id/staff/:action` |
| `invalid_state_transition` | 409 | `POST /orders/:id/staff/:action` |
| `staff_actions_disabled` | 409 | `POST /orders/:id/staff/:action` |

El POS puede devolver otros `code`; el agente los trata como un fallo genérico.

## Ampliación de la v1

Son parte de la v1, pero el agente todavía no las usa: las adopta en la
[Fase 4](plan.md#fase-4--el-agente-solo-habla-con-el-pos). Un POS puede pasar
el script de conformidad sin ellas; para conectarse a un agente con la Fase 4
terminada, las necesita.

| Llamada | Cuerpo | Responde | Para qué |
|---|---|---|---|
| `POST /orders/:id/replace` (con `Idempotency-Key`) | Como `POST /orders`, sin `customerId` ni `customerName` | `201 { replacedOrderId, order }` | El cliente rearma un pedido en `awaiting_location` o `confirmed`. El POS cancela el anterior y crea el nuevo en una sola operación. `409 order_not_replaceable` si el estado ya no lo permite; `409 order_payment_in_progress` si hay pago, comprobante o QR en curso |
| `POST /orders/:id/kitchen-note` | `{ "note": "sin cebolla" }` (1 a 500) | El pedido | Una nota que el cliente manda por chat. Solo en `confirmed`; después, `409 kitchen_note_locked` |
| `POST /orders/:id/switch-to-pickup` | — | El pedido | El cliente pasa a retirar un pedido con envío todavía sin cotizar. `409 delivery_already_quoted` si ya se cotizó |
| `POST /delivery/quotes` (con `Idempotency-Key`) | `{ "customerId"?, "latitude", "longitude" }` | `{ id, status, distanceMeters, feeAmount, errorCode }` | «¿Cuánto sale el envío hasta aquí?», sin pedido. `status`: `quoted`, `manual_quote` o `failed` |
| `POST /payment-proofs` | `{ customerId, sourceMessageId, contextMessageId?, mimeType, fileBase64?, receivedAt? }` | El comprobante guardado | La foto del comprobante. El POS decide a qué pedido pertenece (por el mensaje al que respondió el cliente, o su único pedido por QR abierto). `sourceMessageId` es la barrera de idempotencia. `422 payment_proof_no_match` si no hay a qué asociarlo |
| `POST /payment-proofs/:id/analysis` | `{ status: "ok", verdict, reasons, amount?, … }` o `{ status: "failed" }` | El comprobante | Lo que leyó la visión del agente. Informa, no decide: nunca acepta ni rechaza un pago |

Los cuerpos exactos están en `contract.ts`.

## Lo que queda fuera del contrato

- **Pantallas y gestión**: crear productos, abrir caja, mover un pedido a
  «listo». Es cosa del POS; el agente no llama a nada de eso.
- **Confirmar un pago**. El agente entrega comprobantes y decisiones del
  cliente; nunca marca un pedido como pagado.
- **Cómo cotiza el POS el envío** (tarifario, Mapbox, zonas): el agente solo
  ve el resultado.
- **La conversación**: memoria del chat, pausas, derivación a una persona. Vive
  en la base del agente.

## Comprobar un POS

```powershell
# Solo lectura: no crea nada. Sirve contra producción.
node scripts/check-pos-contract.mjs --url https://pos.ejemplo.com --token <token>

# Crea un cliente y pedidos de prueba y los cancela. SOLO en un restaurante de
# prueba, y con un teléfono propio: el POS puede escribirle por WhatsApp.
node scripts/check-pos-contract.mjs --url … --token … --write --phone +59170000000

# El otro sentido: las tres rutas del gateway de un agente. No envía mensajes.
node scripts/check-pos-contract.mjs --gateway https://agente.ejemplo.com/api --gateway-token <token>
```

Sin `--url` ni `--token` usa el backend local de `apps/backend/.env.dev`.
`--help` lista todas las opciones. Sale con código 0 si todo cumple y 1 si algo
falla.

Qué comprueba y qué no:

| Modo | Comprueba |
|---|---|
| Solo lectura | Autenticación, perfil, catálogo, fotos, forma de los errores y las validaciones que no guardan nada |
| `--write` | Cliente, pedido para retirar, pedido con envío con su cotización, idempotencia, cancelación y carritos rechazados |
| `--write --confirm-cash` | Además, CONFIRMAR en efectivo y las acciones del personal (Listo, Entregado), que cierran el pedido de prueba |
| `--write --other-token <token>` | Además, que otro restaurante no ve los datos de este |
| `--gateway` | `401` sin token y `400` con cuerpos inválidos en las tres rutas |

No comprueba: los [avisos](#qué-avisa-el-pos-y-cuándo) (hay que mirar el
teléfono), el [despertador](#el-despertador-lo-que-el-pos-llama-cada-minuto),
el pago por QR, ni la [ampliación](#ampliación-de-la-v1).

El pago por QR del backend de este repo tiene su propia prueba,
`scripts/check-qr-flow.mjs`: levanta un backend local con un banco simulado y
recorre el pago, el vencimiento y la caída del banco.

Si el POS responde `202` a los pedidos (los deja esperando a una persona), el
script lo da por válido pero no puede comprobar el resto: hay que repetirlo
con el local atendiendo.

## Cambios de versión

- **Compatible** (sigue siendo v1): agregar un campo a una respuesta, agregar
  una llamada, agregar un `code` de error en una llamada nueva.
- **Incompatible** (v2): quitar o renombrar un campo, cambiar un tipo, cambiar
  el significado de un estado o de un `code`, exigir un campo nuevo en un
  cuerpo.

Un cambio incompatible sube `contractVersion` y se anota aquí, con la fecha.

| Fecha | Versión | Cambio |
|---|---|---|
| 2026-10-13 | v1 | Primera versión. Respecto de lo que el agente usaba en la demo: se agrega `GET /restaurant/profile` (reemplaza a `GET /operational-settings`) y los rechazos `delivery_disabled` y `payment_method_disabled` |
| 2026-10-13 | v1 | Se agregan las acciones del personal (`POST /orders/:id/staff/:action`), los botones de verdad en `POST /gateway/telegram/alerts` y el despertador. Compatible: son llamadas nuevas |
