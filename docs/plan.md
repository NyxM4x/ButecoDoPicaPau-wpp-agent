# Plan: Buteco do Pica-Pau

Última actualización: 2026-10-13.

Objetivo: un agente de WhatsApp que venda y tome pedidos para Buteco, listo
para conectarse sin cambios de código al POS multi-tenant cuando exista.
Mientras tanto, el backend de este repo hace de POS, sin pantallas.

Las fases 1 a 4 no dependen de los datos del restaurante y se pueden avanzar
ya. La 5 necesita la información del cliente (lista al final).

| Fase | Qué | Estado |
|---|---|---|
| 0 | Separar el proyecto de la demo | a medias |
| 1 | Contrato del POS + prueba de conformidad | pendiente |
| 2 | Datos del restaurante fuera del código | pendiente |
| 3 | Backend en modo «sin POS» | pendiente |
| 4 | El agente solo habla con el POS | pendiente |
| 5 | Cargar Buteco, publicar y probar | espera datos del cliente |
| 6 | Conectar el POS multi-tenant | cuando exista |

## Fase 0 — Separar el proyecto

Hecho el 2026-10-13:

- Carpeta `CLIENTES/ButecoDoPicaPau/buteco-do-pica-pau`, clonada con historial
  de `restaurant-demos` (`1b81500`).
- Remoto `demos` para traer arreglos, con el push desactivado.
- Este plan y el README.

Falta, y son cuentas que crea el usuario:

| Qué | Para qué | Nota |
|---|---|---|
| ~~Repo en GitHub (`origin`)~~ | código del proyecto | hecho: `NyxM4x/ButecoDoPicaPau-wpp-agent` |
| Proyecto en Supabase | base del backend (`public`) y del agente (`agent`) | **no** reutilizar `gkhvijhcyysasofrukbr`, que es la demo |
| Servicio en Railway | backend | decidir plan: la prueba gratis de la demo ya se usó |
| Proyecto en Vercel | agente | Root Directory `apps/agent-whatsapp` |
| Número en Kapso | WhatsApp de Buteco | número propio, no el Sandbox |
| Mapbox | cotizar envíos | puede ser el mismo token |
| OpenAI (opcional) | que el bot converse | sin clave solo manda el menú |
| Telegram (grupo del personal) | avisos de pedidos | **obligatorio en el modo sin POS** (Fase 3) |

Los tokens entre agente y backend (`CENTRAL_API_TOKEN`, `GATEWAY_AUTH_TOKEN`,
`SERVICE_AUTH_TOKENS`) se generan nuevos; no se copian de la demo.

## Fase 1 — Contrato del POS

Es lo que se le entrega a quien construya el POS multi-tenant. Si lo cumple,
el agente se conecta cambiando dos variables.

Entregables:

1. `docs/pos-contract.md`: cada llamada con método, ruta, cuerpo, respuesta,
   errores (`code`) y cuándo la usa el agente. Versionado (`v1`).
2. `scripts/check-pos-contract.mjs`: se corre contra cualquier URL + token y
   dice qué cumple y qué no, sin crear datos reales (o en un restaurante de
   prueba).
3. Tipos compartidos en `apps/agent-whatsapp/src/lib/central/contract.ts`,
   que es lo único que el resto del agente importa.

Lo que el agente usa hoy (salió de revisar `src/lib/central/`):

| El agente llama al POS | El POS llama al agente |
|---|---|
| `GET /categories`, `GET /products`, `GET /promotions`, `GET /products/:id/image` | `POST /gateway/whatsapp/messages` (texto, imagen o botones) |
| `POST /customers/find-or-create` | `POST /gateway/whatsapp/location-requests` |
| `GET /customers/:id/active-order` | `POST /gateway/telegram/alerts` |
| `POST /orders`, `POST /orders/:id/location`, `POST /orders/:id/cash/confirm` y `/cancel` | |

Se agrega **(nuevo)**:

- `GET /restaurant/profile`: nombre, horario, dirección y coordenadas,
  teléfono, moneda, métodos de pago activos, retiro y envío activos, mensajes
  propios (saludo, despedida) y URL del video o imagen del menú. Es lo que hoy
  está escrito en el código (Fase 2).
- Lo que pida la Fase 4 (comprobantes, cambiar pedido, nota de cocina, pasar a
  retiro), ya diseñado en `docs/canonical-contract-proposal.md`.

Regla del contrato: el restaurante sale del token. Ninguna llamada lleva
`restaurantId` en la ruta ni en el cuerpo.

## Fase 2 — Datos del restaurante fuera del código

Archivos del agente con datos de Don Zarco escritos a mano (2026-10-13):

```text
src/lib/agent/business/facts.ts        src/lib/delivery/fee.ts
src/lib/agent/business/prompt.ts       src/lib/delivery/quote-order.ts
src/lib/agent/service.ts               src/lib/kapso/messages.ts
src/lib/agent/tools/answer-directly.ts src/lib/kitchen/collect-breakdown.ts
src/lib/agent/tools/menu-tools.ts      src/lib/menu/service-hours.ts
src/lib/agent/tools/request-human.ts   src/lib/menu/session-service.ts
src/lib/agent/handoff/problem-signal.ts src/lib/orders/abandoned-cart.ts
src/lib/agent/handoff/stuck-customer.ts src/lib/orders/business-day.ts
src/lib/alerts/handoff-notice.ts       src/lib/orders/notifications/notify-text.ts
src/lib/env/env.ts                     src/app/api/health/route.ts
```

Cómo:

1. Un solo módulo, `src/lib/restaurant/profile.ts`, que entrega el perfil del
   restaurante. Fuente: `GET /restaurant/profile` del POS (con caché corta);
   si el POS no lo tiene todavía, variables de entorno (`RESTAURANT_NAME`,
   `RESTAURANT_HOURS`…).
2. Cada archivo de la lista lee del perfil en vez de su constante.
3. Las URL fijas (`MENU_URL`, `MENU_VIDEO_URL`, `MENU_COVER_URL`) salen de
   `APP_BASE_URL` o del perfil.
4. Prueba: con el perfil de Buteco, ninguna respuesta del agente dice «Zarco».

Ojo con el idioma y la moneda: el agente habla en español de Bolivia y cobra en
Bs. Si Buteco atiende en otro país o idioma, esto crece (ver preguntas).

## Fase 3 — Backend en modo «sin POS»

Hoy el backend supone que alguien usa el POS. Sin él, se traba:

- **Sin caja abierta, no confirma pedidos**: los guarda como solicitud fuera de
  horario (`202`, `late_order_requests`) y alguien tiene que aceptarlos desde el
  POS. `cash/confirm` también exige caja abierta.
- **Nadie mueve el pedido** de `confirmed` a `preparing`, `ready` y
  `delivered`, así que el agente cree que todos siguen en curso.
- **El aviso al personal es una línea** («Pedido X confirmado en efectivo»):
  sin pantalla de cocina, tiene que llevar el pedido completo.

Qué hacer:

1. Ajuste por restaurante `requires_cash_register` (o similar) en
   `operational_settings`. Apagado: los pedidos se confirman sin caja y
   `cash/confirm` no la exige.
2. Aviso al grupo de Telegram del personal con el pedido entero: productos,
   nota, cliente, teléfono, dirección con enlace a Maps, envío, total y forma
   de pago. Sale cuando el pedido queda firme (efectivo confirmado, QR pagado o
   retiro).
3. Estados sin pantalla: botones en el aviso de Telegram («Listo», «Salió»,
   «Entregado») o un cierre automático por tiempo. Decidir con el cliente.
4. Barrido de `expireStaleOrders` programado (hoy nadie lo llama), para que un
   pedido sin confirmar no quede abierto.

Cuando llegue el POS multi-tenant, todo esto lo hará el POS; por eso va detrás
de un ajuste y no reemplaza el comportamiento actual.

## Fase 4 — El agente solo habla con el POS

Es el resto de la Fase 5 de la demo (`docs/implementation-progress.md`). Hoy,
en modo backend central, el agente todavía lee sus propias tablas para:

1. Comprobantes de pago (`POST /payment-proofs`).
2. Estado del cliente para la respuesta por defecto (`active-order`); hoy solo
   se usa para el efectivo pendiente.
3. «Cambiar mi pedido» (`POST /orders/:id/replace`): hoy crea uno nuevo sin
   cancelar el anterior.
4. Pasar a retiro, nota de cocina por chat, cotizar un pin suelto.
5. Herramientas de la IA (`get_menu_items`) y el menú que se manda por chat.
6. Retirar `/cocina` y el dashboard de pedidos del agente.
7. El tope de dos recordatorios de botones del efectivo.

Al terminar, las tablas de pedidos del agente (`agent.orders` y compañía)
dejan de usarse; el agente solo guarda conversación, memoria y eventos.

## Fase 5 — Buteco en marcha

1. `demos/buteco-do-pica-pau/menu.json` + `images/`, cargado con
   `scripts/load-demo.mjs`.
2. Perfil del restaurante (Fase 2) con sus datos.
3. Video o imagen del botón del menú (MP4 H.264 Baseline, ver `MENU_VIDEO_URL`).
4. Publicar: backend en Railway, agente en Vercel, webhook de Kapso.
5. Prueba con teléfono: menú, pedido con envío en efectivo y por QR, retiro,
   ubicación, CONFIRMAR / CANCELAR, aviso al personal.

## Fase 6 — Conectar el POS multi-tenant

1. Correr `scripts/check-pos-contract.mjs` contra el POS nuevo.
2. Pedir un token para Buteco.
3. En Vercel: `CENTRAL_API_BASE_URL` y `CENTRAL_API_TOKEN` nuevos.
4. Migrar catálogo, clientes y pedidos abiertos del backend provisional.
5. Apagar el backend provisional.

## Lo que hay que pedirle a Buteco

- País, idioma del chat y moneda.
- Menú con precios, categorías, extras, combos y fotos.
- Horario por día; si cierra algún día.
- Dirección y ubicación exacta del local.
- Envío: zonas o tarifas por distancia, monto mínimo, si cobra el repartidor.
- Formas de pago: efectivo, QR (de qué banco), otras.
- Retiro en el local: sí o no.
- Número de WhatsApp que se usará (no puede estar en uso en la app de WhatsApp
  normal) y nombre que verá el cliente.
- Quién recibe los pedidos y por dónde (grupo de Telegram o WhatsApp).
- Video o imagen para el botón del menú; logo y colores para el menú web.
