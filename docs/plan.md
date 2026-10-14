# Plan: Buteco do Pica-Pau

Última actualización: 2026-10-13.

Objetivo: un agente de WhatsApp que venda y tome pedidos para Buteco, listo
para conectarse sin cambios de código al POS multi-tenant cuando exista.
Mientras tanto, el backend de este repo hace de POS, sin pantallas.

Las fases 1 a 4 no dependen de los datos del restaurante y se pueden avanzar
ya. La 5 necesita la información del cliente (lista al final).

**Por dónde seguir:** el pago por QR ya funciona contra el ambiente de pruebas
del banco. Falta ver **un pago**, que solo se puede hacer con las credenciales
de producción (ver [Pago por QR](#pago-por-qr-banco-económico-2026-10-13)):
hay que conseguir la dirección de producción y completar los datos. Mientras
tanto, el resto de la [Fase 4](#fase-4--el-agente-solo-habla-con-el-pos),
empezando por el estado del cliente.

Decisiones del 2026-10-13 que valen para todo el proyecto:

| Tema | Decisión |
|---|---|
| POS futuro | Usará **el mismo esquema del backend central** que ya tenemos (Rocha). Por eso lo que hace falta se construye en `apps/backend` y queda escrito en el contrato |
| Cloudflare | **No se usa.** Esas cuentas son de otros proyectos. Al agente lo despierta el backend |
| Avisos de «listo» y «salió» | Con botones en Telegram: se va a producción así |
| Pago por QR | Con la API de **Banco Económico**, el banco del cliente (servicio «BEC QR Connect»). Integrado y probado contra el ambiente de pruebas del banco; falta ver un pago y los datos de producción |

Nada de lo hecho el 2026-10-13 está en un commit: está en el árbol de trabajo,
para revisarlo antes.

| Fase | Qué | Estado |
|---|---|---|
| 0 | Separar el proyecto de la demo | a medias |
| 1 | Contrato del POS + prueba de conformidad | **hecha** (2026-10-13) |
| 2 | Datos del restaurante fuera del código | **hecha** (2026-10-13) |
| 3 | Backend en modo «sin POS» | **hecha** (2026-10-13) |
| 4 | El agente solo habla con el POS | **a medias**: 2 de 7 puntos (2026-10-13) |
| 5 | Cargar Buteco, publicar y probar | espera datos del cliente |
| 6 | Conectar el POS multi-tenant | cuando exista |

## Fase 0 — Separar el proyecto

Hecho el 2026-10-13:

- Carpeta `CLIENTES/ButecoDoPicaPau/buteco-do-pica-pau`, copiada con su
  historial del proyecto de demo (`1b81500`). Sin enlace a aquel repositorio:
  el único remoto es `origin`.
- Este plan y el README.
- **Entorno local propio.** El agente en local usa el puerto **3300**
  (`npx next dev -p 3300`): el 3000 lo ocupa otro proyecto en esta PC. Su
  `.env.local` (fuera de git) apunta al backend local.
- **Base local propia.** La demo corre en esta misma PC (base en el puerto
  54329, backend en el 3100, POS en el 5180), y `scripts/dev-db.ps1` usaba ese
  mismo puerto: encontraba la base de la demo ya arriba y las migraciones de
  Buteco habrían caído en ella. Ahora Buteco usa el **54330** (base
  `buteco_dev`, datos en `.local/`) y el backend local el **3200**
  (`apps/backend/.env.dev`, fuera de git, con tokens propios generados al azar).

Cómo quedó la base local el 2026-10-13: las 34 migraciones aplicadas, el modo
sin POS encendido, el nombre «Buteco do Pica-Pau» y, como **datos de prueba**,
el menú de ejemplo de la demo (`demos/don-zarco`, 15 productos). No es el menú
de Buteco: ese se carga en la Fase 5. Usuario `admin`, con la clave de
`DEV_ADMIN_PASSWORD`.

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
| Telegram (bot y grupo del personal) | avisos de pedidos, con los botones Listo / Salió / Entregado | **obligatorio en el modo sin POS** (Fase 3) |

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

### Hecho (2026-10-13)

| Entregable | Dónde | Estado |
|---|---|---|
| Contrato para personas | [`docs/pos-contract.md`](pos-contract.md) | v1 |
| Tipos, rutas y códigos | `apps/agent-whatsapp/src/lib/central/contract.ts` | lo usan todos los módulos de `central/` |
| Prueba de conformidad | `scripts/check-pos-contract.mjs` | pasa contra el backend local: 23 comprobaciones en solo lectura y 49 con `--write` |
| `GET /restaurant/profile` | `apps/backend` (migración 33) | el menú web ya lo lee en vez de `/operational-settings` |

Además:

- **La frontera es real.** El resto del agente solo puede importar
  `@/lib/central` (funciones) y `@/lib/central/contract` (tipos); ESLint
  rechaza cualquier otro archivo de esa carpeta.
- **El perfil se guarda en `operational_settings`** y se edita con
  `PATCH /operational-settings` (administrador). `scripts/load-demo.mjs` lo
  carga desde `restaurant` y `settings` del `menu.json`.
- **Dos rechazos nuevos en el backend**: `delivery_disabled` y
  `payment_method_disabled`. El perfil dice qué se ofrece y el backend lo hace
  cumplir al crear el pedido. El mostrador (canal `pos`) vende igual.
- **Arreglo**: al adjuntar una ubicación, el agente esperaba códigos de error
  que el backend nunca devolvía (`status_conflict`,
  `order_not_awaiting_location`). Con un pedido que ya no esperaba ubicación,
  el error subía sin traducir. Ahora usa los del contrato
  (`location_not_expected`, `location_conflict`).

Lo que el contrato deja para después:

- **Horario por día.** El contrato admite un horario distinto cada día y días
  cerrados (`hours.weekly`). El backend provisional guarda un solo par de horas
  y devuelve los siete días iguales. Si Buteco cierra algún día, hay que
  ampliarlo (ver Fase 3).
- **La ampliación de la v1** (comprobantes, cambiar pedido, nota de cocina,
  pasar a retiro, cotizar un punto) está documentada y con tipos, pero el
  script todavía no la comprueba: se agrega con la Fase 4.

Lo que encontró la prueba de conformidad: **sin caja abierta el backend no
valida el carrito**. Acepta con `202` un pedido con productos que no existen y
lo deja como solicitud. Es el modo «en revisión» de la demo; lo cambia la
Fase 3.

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
3. Las URL fijas salen de `APP_BASE_URL` o del perfil. **Hoy apuntan a los
   despliegues de la demo** y hay que cambiarlas antes de publicar Buteco:
   - `src/lib/kapso/messages.ts`: `MENU_URL`, `MENU_VIDEO_URL`,
     `MENU_COVER_URL`, `PAYMENT_QR_URL`.
   - `src/lib/menu/session-service.ts`: valor por defecto de `APP_BASE_URL`.
   - `cloudflare/recovery-cron/wrangler.jsonc` y `.dev.vars.example`:
     `APP_BASE_URL`. *(La carpeta se retiró: ver «Hecho».)*
4. Prueba: con el perfil de Buteco, ninguna respuesta del agente dice «Zarco».

Ojo con el idioma y la moneda: el agente habla en español de Bolivia y cobra en
Bs. Si Buteco atiende en otro país o idioma, esto crece (ver preguntas).

### Hecho (2026-10-13)

**El agente ya no tiene escrito ningún restaurante.** Todo sale del perfil:

| Pieza | Dónde |
|---|---|
| El perfil y de dónde sale | `apps/agent-whatsapp/src/lib/restaurant/profile.ts` |
| Horario semanal y zona horaria | `src/lib/restaurant/hours.ts` |
| Lo trae del POS al entrar cada petición (copia de 1 minuto) | `src/lib/restaurant/profile-loader.ts` |
| Lo lleva al navegador, para el menú web | `src/components/RestaurantProfileProvider.tsx` |
| Variables de respaldo `RESTAURANT_*` | `apps/agent-whatsapp/.env.example` |

Qué salió del código:

- **Nombre, descripción, dirección, enlace de Maps y horario**: el prompt del
  asistente, el saludo del menú, «dónde quedan», los avisos al personal y las
  descripciones de las herramientas de la IA.
- **Idioma y país del asistente**: «en español, con el trato que se usa en
  Bolivia» ahora sale de `locale`.
- **Moneda**: todos los montos (`formatBs`, `formatMoney` y los avisos que
  escribían «Bs» a mano).
- **Zona horaria**: el desfase fijo de Bolivia (UTC−4) pasó a ser la zona del
  perfil, en jornada, promociones y comprobantes.
- **Avisos de horario del menú** («Estamos abriendo», «Estamos cerrados»): las
  franjas se calculan del horario semanal, con días cerrados.
- **Dos reglas de Don Zarco que eran constantes**: `CASH_ENABLED = false` y
  `PICKUP_ENABLED = false`. Ahora son `paymentMethods` y `pickupEnabled` del
  perfil. El menú web esconde también el envío y el QR si están apagados, y el
  prompt explica al asistente qué se ofrece y qué no.
- **URL fijas de la demo**: `MENU_URL`, `MENU_VIDEO_URL`, `MENU_COVER_URL` y
  `PAYMENT_QR_URL` salen de `APP_BASE_URL` (o del dominio de Vercel) y del
  perfil. Sin video ni imagen, el botón del menú se manda solo con el texto.
- **Cron de Cloudflare: retirado.** El agente heredó un Worker
  (`sarco-recovery-cron`) que lo despertaba cada minuto desde una cuenta de
  Cloudflare que es de otros proyectos, apuntando a la demo. Se borró la
  carpeta `apps/agent-whatsapp/cloudflare/`. Ahora lo despierta el backend
  (`apps/backend/src/agent-wake`, variable `AGENT_INTERNAL_TOKEN`): cada
  minuto llama a las mismas cuatro rutas internas. Una prueba del agente
  (`src/lib/security/worker-tenancy.test.ts`) falla si vuelve a aparecer la
  configuración de un Worker.

Dos textos de Don Zarco se volvieron neutros porque no eran datos sino
decisiones suyas: el motivo de no aceptar efectivo («tuvimos muchos problemas
con los pagos en efectivo») y «el envío se le paga al repartidor».

La prueba del punto 4 es
`src/lib/restaurant/no-hardcoded-restaurant.test.ts`: pone un restaurante
distinto en todo (otro nombre, país, moneda, horario y un día cerrado), recorre
lo que el agente le dice al cliente, al modelo y al personal, y falla si aparece
algo del anterior. Además revisa que el código de `src/` no nombre a ningún
restaurante.

Comprobado de verdad, además de las pruebas: el menú web del agente local
contra el backend local muestra «Buteco do Pica-Pau» en el título y la
cabecera, sin ninguna mención a la demo en el HTML.

Las 4287 pruebas del agente siguen corriendo con los datos de Don Zarco como
perfil de ejemplo (`src/test/profiles.ts`): por eso todavía se lo nombra ahí.

### Lo que queda de esta fase

| Qué | Por qué no se hizo | Cuándo |
|---|---|---|
| **Los mensajes fijos están solo en español** (con voseo boliviano). El perfil cambia el idioma del asistente de IA, no el de las plantillas | Traducirlas es un trabajo aparte, y solo hace falta si Buteco atiende en otro idioma | Al saber el país y el idioma |
| ~~Archivos de Don Zarco en `apps/agent-whatsapp/public/`~~ | Borrados el 2026-10-14 (logo, video y el QR de **su** cuenta), con `demos/don-zarco`. Ver [flujos-buteco.md](flujos-buteco.md#lo-que-se-quitó-de-la-demo-anterior-2026-10-14) | — |
| ~~Colores del menú web~~ | Hecho el 2026-10-13: la carta nueva, ver [Fase 5](#hecho-2026-10-13-la-carta-del-menú-web). Falta el logo | — |
| El almacenamiento de comprobantes del agente (`PAYMENT_PROOF_*` en su `.env.example`) trae de ejemplo Cloudflare R2 | Solo lo usa el modo sin POS; con el POS conectado los comprobantes van al POS. No hay que configurarlo | — |
| `RESTAURANT_LOGO_URL` | El logo no está en el contrato del POS: es una variable del agente | Fase 5 |

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

### Hecho (2026-10-13)

Un solo ajuste enciende el modo: **`requiresCashRegister: false`**
(`PATCH /operational-settings`, o `settings` del `menu.json`). Por defecto vale
`true` y el backend se comporta exactamente como antes (migración 34).

| Punto | Con el ajuste apagado | Dónde |
|---|---|---|
| 1. Caja | El horario decide: abierto = el pedido se crea (`201`), cerrado = `409 closed`. Ya no hay pedidos «en revisión». `cash/confirm` y aceptar un pago no piden caja | `orders.service.ts`, `cash-register.service.ts` (`sessionIdForPayment`) |
| 2. Aviso al personal | Cuando el pedido queda firme (efectivo confirmado o pago aceptado), el grupo de Telegram recibe el pedido entero: productos, combos desarmados, nota, cliente y teléfono, enlace a Maps con los km, envío, total y si hay que cobrar o ya está pagado. Una vez por pedido | `src/staff-notice/` |
| 3. Estados sin pantalla | Cierre automático: pasados `autoCompleteMinutes` desde que se confirmó, el pedido firme pasa a `delivered`. Vacío = no se cierra solo | `autoCompleteOrders` |
| 4. Barrido | Corre cada minuto dentro del backend: cancela el efectivo sin confirmar a los 20 minutos y el envío sin ubicación a los 45, y hace el cierre automático | `orders-maintenance.cron.ts` |

Además:

- **La moneda de los mensajes del backend** (desglose en efectivo, QR,
  confirmación) sale de `currencySymbol`; antes decían «Bs» siempre.
- **El horario usa la zona horaria del restaurante** (`restaurantTimezone`),
  no siempre la de Bolivia.

Comprobado contra el backend local en modo sin POS y **sin ninguna caja
abierta**: el script de conformidad pasa las 54 comprobaciones con
`--write --confirm-cash`; el aviso al personal queda en la cola con el texto
completo; y un pedido envejecido cuatro horas se cerró solo en la pasada
siguiente del barrido.

### Botones del personal en Telegram (2026-10-13)

El aviso del pedido lleva tres botones: **Listo**, **Salió** (solo envíos) y
**Entregado**. Cada toque mueve el pedido, le avisa al cliente por WhatsApp y
reemplaza el mensaje del grupo por su versión actual, con quién lo tocó, la
hora y solo los botones que quedan.

```text
Telegram ──toque──► Agente (/api/telegram/webhook)
                      │  comprueba el secreto y que sea el grupo del personal
                      ▼
                    Backend  POST /orders/:id/staff/ready | out | delivered
                      │  mueve el pedido y devuelve el aviso actualizado
                      ├──► WhatsApp al cliente: «ya está listo», «ya salió»
                      ▼
                    Agente reemplaza el mensaje en Telegram
```

| Pieza | Dónde |
|---|---|
| Qué botones lleva cada pedido, qué hace cada toque y qué se le dice al cliente | `apps/backend/src/staff-notice/staff-actions.ts` |
| La ruta y el cambio de estado | `OrdersService.staffAction`, `POST /orders/:id/staff/:action` |
| Mandar el aviso con botones, editarlo y contestar el toque | `apps/agent-whatsapp/src/lib/alerts/telegram-buttons.ts` |
| Recibir el toque | `src/lib/alerts/telegram-callback.ts`, `src/app/api/telegram/webhook/route.ts` |
| Llamar al POS, solo con acciones del contrato | `src/lib/central/staff-actions.ts` |
| Registrar el webhook en Telegram | `scripts/set-telegram-webhook.mjs` |

Reglas que conviene conocer:

- **Se puede saltar pasos**: un local que solo toque «Entregado» funciona.
- **Tocar dos veces no hace nada**: ni error ni segundo aviso al cliente.
- **«Entregado» solo le escribe al cliente la despedida propia del local**
  (`farewellMessage`), si tiene una.
- **El agente solo ejecuta esas tres acciones.** Un botón con otra ruta sale
  como texto, y un toque falsificado no llega al backend.
- **El webhook rechaza todo sin su secreto** (`TELEGRAM_WEBHOOK_SECRET`) y los
  toques que no vengan del grupo del personal. Sin el secreto configurado, los
  avisos salen sin botones.
- **El cierre automático sigue**: si nadie toca «Entregado», el pedido se
  cierra solo pasados `autoCompleteMinutes` (hay que fijarlo, por ejemplo 180:
  viene vacío).

Comprobado contra el backend local: el script de conformidad pasa 67
comprobaciones con `--write --confirm-cash`, incluidas las de estos botones, y
en la cola quedan los avisos al cliente en orden (recibido, desglose,
confirmado, «ya está listo»). **No se probó con un bot de Telegram real**: no
hay credenciales. La primera prueba de verdad es en la Fase 5.

### Pago por QR: Banco Económico (2026-10-13)

El banco de Buteco es **Banco Económico**, el mismo para el que el backend ya
traía un adaptador (`apps/backend/src/baneco`, `src/bank-qr`). El banco
entregó el manual «API Market» v1.3.0 y los datos del ambiente de pruebas. El
adaptador estaba escrito contra una versión anterior del manual, y al
compararlos salieron dos fallos que habrían dejado el QR sin funcionar:

| Fallo | Qué habría pasado | Arreglo |
|---|---|---|
| La consulta de estado mandaba el `qrId` en el cuerpo de un GET, y `fetch` no deja enviarlo: la llamada fallaba antes de salir | Ningún pago se habría confirmado, ni por consulta ni por el aviso del banco (que también consulta) | La ruta v2 del manual, `GET /v2/statusQR/{id}` |
| El backend manda la imagen del QR como una ruta suya que pide token (`/orders/:id/qr-image`), y el agente se la pasaba a WhatsApp como si fuera un enlace público | WhatsApp no puede abrirla: el cliente no habría recibido el QR | El agente la descarga con su token y sube la imagen a WhatsApp (Media API de Kapso) |

El segundo arreglo sale del proyecto de Zarco, que cobra por QR con este mismo
banco en producción (`CLIENTES/ZarcoNewVersion/agent-pedilo`, el agente; se
leyó como referencia, sin copiar código). Ahí la ruta protegida es a propósito:
el backend central nunca publica el QR, y es el agente quien lo descarga y lo
sube. El agente de Buteco viene de otra rama y no lo hacía. Es también la forma
que usará el POS futuro, así que el backend no cambió: sigue mandando la ruta.
(Primero se probó darle a la imagen una dirección pública en el backend; se
quitó al ver cómo lo resuelve el proyecto que ya funciona.)

Lo que se agregó para el modo «sin POS», donde nadie puede revisar una captura
ni cerrar un pedido a mano:

- **Un QR sin pagar cancela el pedido a los 30 minutos.** Antes de cancelar,
  el backend le pregunta al banco y anula el QR allá: un pedido que pudo
  haberse pagado no se cancela nunca. Si el pago entró justo al final, se
  aplica. Si el banco no contesta, el pedido queda como está y se reintenta
  al minuto. El mensaje del QR le dice al cliente que vence en 30 minutos.
- **Si el banco no entrega el QR**, el cliente recibe «estamos generando tu
  QR» (una sola vez) y el backend reintenta cada minuto. A los 10 minutos sin
  QR, cancela el pedido, se disculpa con el cliente y avisa al personal por
  Telegram de que el banco está fallando.
- **El vencimiento del QR cruza la medianoche.** El banco solo acepta una
  fecha, y se le pedía la de hoy: un pedido de las 23:50 recibía un QR que
  moría a los diez minutos.
- **El cliente del banco**: el token dura 30 minutos y se renueva antes de
  vencer; cada llamada espera 15 segundos como máximo (una llamada colgada
  dejaba detenida la consulta de pagos); admite la dirección con barra final,
  como la entrega el banco; y dice qué variable falta si no está configurado.

```text
pedido por QR con el total definitivo
   │
   ▼
Backend ──► Banco: genera el QR (vence en 30 min)
   │
   ├──► Agente: recibe la ruta del QR, la descarga con su token
   │            y la sube a WhatsApp con el monto
   │                                    (si el banco falla: «estamos generando
   │                                     tu QR», y el backend reintenta)
   ▼
cada 5 s le pregunta al banco, y además el banco avisa (notifyPaymentQR)
   │
   ├─ pagado ──► pedido pagado ──► «Tu pago fue confirmado»
   │                              └► Telegram: el pedido, con Listo / Salió / Entregado
   │
   └─ 30 min sin pagar ──► anula el QR en el banco ──► pedido cancelado ──► aviso
```

| Pieza | Dónde |
|---|---|
| Hablar con el banco | `apps/backend/src/baneco/baneco-client.service.ts` |
| Generar, consultar, aplicar el pago y vencer | `src/bank-qr/qr-payments.service.ts` |
| Qué se le manda al cliente, y el reintento | `src/bank-qr/qr-checkout.service.ts` |
| Los plazos (30 y 10 minutos) | `src/bank-qr/qr-expiry.ts` |
| El barrido de cada minuto | `src/bank-qr/qr-orders-maintenance.cron.ts` |
| La ruta protegida de la imagen y el aviso del banco | `src/bank-qr/bank-qr.controller.ts` |
| Agente: descargar la imagen del POS y mandarla | `apps/agent-whatsapp/src/lib/central/pos-image.ts` |
| Agente: subir una imagen a Kapso y enviarla por su id | `src/lib/kapso/transport.ts` (`uploadImage`, `sendImageById`) |
| Probar las credenciales contra el banco | `apps/backend/scripts/check-baneco.mjs` (`npm run baneco:check`) |
| Un banco simulado para trabajar en local | `scripts/mock-baneco.mjs` |
| El recorrido completo, con el banco simulado | `scripts/check-qr-flow.mjs` |

Con un POS nada de esto cambia: un QR sin pagar lo resuelve el cajero, y si el
banco falla el cliente recibe las instrucciones para mandar la captura.

**Comprobado**, contra el backend local y un banco simulado
(`node scripts/check-qr-flow.mjs`, 26 comprobaciones): el aviso del QR lleva
la ruta protegida, que se descarga con el token y sin él no; al pagar, el pedido queda
pagado solo y el personal lo recibe en Telegram; el aviso del banco lo confirma
en el momento, y un aviso falso no marca nada como pagado; el QR sin pagar se
anula y cancela el pedido; uno pagado justo al vencer no se cancela; con el
banco caído sale el aviso de demora, el QR llega cuando el banco vuelve, y si
no vuelve el pedido se cancela y el personal se entera.

**Comprobado contra el ambiente de pruebas del banco** (2026-10-13, con las
cinco `BANECO_*` de pruebas en `apps/backend/.env.dev`):

- `npm run baneco:check` (en `apps/backend`): las credenciales sirven, y el
  banco genera un QR, lo da por pendiente, lo anula y lo da por anulado, con
  las respuestas que dice el manual.
- `node scripts/check-qr-flow.mjs --real-bank` (13 comprobaciones): el mismo
  recorrido por el backend, con el banco de pruebas en vez del simulado. El QR
  del banco se descarga con el token (un PNG de unos 25 KB), la consulta de
  cada 5 segundos no da errores, un aviso de pago falso no marca nada, y al
  vencer el pedido se cancela y el banco deja el QR anulado.

Dos datos que el manual no dice y el banco contestó: acepta dos QR con el
mismo `transactionId`, y un QR sin pagar trae `payment: []` (una lista vacía).

**No comprobado**, dos cosas:

- **Un pago.** Desde aquí no se puede simular, y un QR del ambiente de pruebas
  no se puede pagar con un celular: el usuario lo escaneó con la aplicación de
  su banco y respondió «no se pudo leer los datos del Pago Simple» (la
  aplicación trabaja contra producción, donde ese QR no existe; es la lectura
  más probable, no la confirmó el banco). El primer pago de verdad se verá con
  las credenciales de producción.
- **La subida de la imagen a Kapso.** Tiene la misma forma que usa el agente de
  Zarco en producción y está cubierta por pruebas, pero no se probó contra
  Kapso: Buteco todavía no tiene número. Se ve en la prueba con teléfono.

Lo que falta, en orden:

1. **Los datos de producción del banco.** El banco entregó una segunda llave
   que, por el correo, parece la de producción, junto al usuario. Faltan la
   dirección de producción (el manual solo trae la de pruebas), la contraseña
   y el número de cuenta de Buteco. La dirección la conoce quien publicó el
   backend central de Zarco (Rocha): es su variable `BANECO_BASE_URL`. No
   está en la carpeta de Zarco de esta PC, que es solo el agente.
2. **Probar esas credenciales**: en un `.env` aparte,
   `node --env-file=<archivo> scripts/check-baneco.mjs` (genera un QR de Bs 1 y
   lo anula). Ahí se sabe si el usuario de producción, que el correo describe
   como «a solo consultas», puede generar QR.
3. **Un pago de Bs 1 en producción**:
   `node --env-file=<archivo> scripts/check-baneco.mjs --keep` deja el QR vivo
   y guarda su imagen en `.local/`; se paga con el celular y
   `--status <qrId>` debe decir «pagado», con los datos del pago.
4. **El pago pasando por el backend**, con un pedido: en la prueba con
   teléfono de la Fase 5.
5. **Avisarle al banco la dirección del aviso de pago**:
   `https://<dominio del backend>/api/qrsimple/notifyPaymentQR`. Es opcional:
   sin él, el pago se confirma igual por la consulta de cada 5 s.
6. **La carta de solicitud** para habilitar el servicio, que firma el cliente.

En el ambiente de pruebas quedó un QR vivo de Bs 1
(`qrId 26101301016843000139`, vence el 2026-10-18). Solo sirve si el banco
acepta pagarlo desde su lado; si no, vence solo.

Los dos documentos del banco están en la raíz del repo, sin agregar a git
(`Api Market Baneco v1.3.0.pdf` y `Cobros QR - Baneco (1).pptx`). No traen
credenciales, solo ejemplos.

Hasta ver un pago confirmado y tener los datos de producción, lo seguro sigue
siendo publicar con **solo efectivo**: `enabledPaymentMethods: ["cash"]`.

### Lo que queda de esta fase

- **Horario por día y días cerrados.** El backend guarda una sola hora de
  apertura y una de cierre para toda la semana. Si Buteco cierra un día o
  cambia de horario el fin de semana, hay que ampliarlo (el contrato y el
  agente ya lo admiten).
- **Conciliar contra el banco.** El manual trae la lista de QR pagados de un
  día (`GET /v2/paidQR/{fecha}`). Un barrido diario detectaría cualquier pago
  que la consulta y el aviso hubieran perdido. No está hecho.
- **Un solo grupo de Telegram.** El backend distingue `staff-group` y
  `delivery-group`; el agente manda todo al mismo chat (`TELEGRAM_CHAT_ID`).

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

### Hecho (2026-10-13)

| Punto | Qué | Dónde |
|---|---|---|
| 5 | **El asistente de IA lee el menú del POS.** `get_menu_items` consultaba la tabla `menu_items` del agente, que con Buteco está vacía: no habría podido decir un solo precio. Ahora recibe los productos que se pueden pedir (sin los agotados) y las promociones, con la categoría real del POS. Una lectura por turno | `agent/service.ts`, `central/catalog-service.ts` (`loadCentralCatalogForModel`) |
| 4 (parte) | **Cotizar un punto sin pedido.** El cliente manda su ubicación para saber cuánto sale el envío, que es lo que el asistente le pide hacer. Antes medía el agente con Mapbox y su propio tarifario; ahora cotiza el POS (`POST /delivery/quotes`). Fuera del tarifario se contesta «fuera de la zona». Si el local no hace envíos, lo dice sin cotizar | `central/location.ts` (`quoteCentralLocation`), `delivery/quote-request-service.ts` |

El menú que se manda por chat (la otra mitad del punto 5) ya iba por el POS:
el enlace abre el menú web, que lee su catálogo.

### Lo que falta, y en qué orden

Los puntos 2, 3 y 4 no son independientes: los tres cuelgan de la **respuesta
por defecto** del webhook (`src/lib/webhook/default-reply.ts`), que decide qué
hacer con un mensaje según el pedido que el cliente tiene abierto. Hoy ese
pedido se busca en las tablas del agente, donde ya no hay ninguno; solo se
consulta al POS cuando hay un pago en efectivo esperando CONFIRMAR
(`central/cash.ts`).

Esa decisión tiene 16 acciones, y cada una ejecuta un puerto que hoy escribe
en las tablas del agente. Darle el pedido del POS sin cambiar los puertos
haría, por ejemplo, que «quiero cambiar mi pedido» mande el enlace y al
confirmar cree un segundo pedido. Por eso van juntos, y por eso no se hizo a
medias:

| Orden | Punto | Qué hay que hacer |
|---|---|---|
| 1 | 2. Estado del cliente | Convertir `GET /customers/:id/active-order` en el `openOrder` completo (no solo el del efectivo). Revisar acción por acción de `decideDefaultReply` cuáles solo contestan un texto (recordatorios, «en qué va») y cuáles ejecutan algo |
| 2 | 4. Nota de cocina y pasar a retiro | Puertos nuevos a `POST /orders/:id/kitchen-note` y `/switch-to-pickup`. Los tipos y las rutas ya están en `contract.ts` |
| 3 | 3. «Cambiar mi pedido» | El enlace de cambio guarda el pedido a reemplazar en la sesión del menú. Hay que cargar el carrito desde `GET /orders/:id` y, al confirmar, llamar a `POST /orders/:id/replace` en vez de `POST /orders` |
| 4 | 7. Tope de recordatorios del efectivo | Contar en la memoria del agente los recordatorios de botones ya mandados |
| 5 | 1. Comprobantes de pago | `POST /payment-proofs` con la foto en base64, y `/analysis` con lo que lea la visión. Con la API del banco el pago se confirma solo y esto deja de ser urgente: ver [Pago por QR](#pago-por-qr-banco-económico-2026-10-13) |
| 6 | 6. Retirar `/cocina` y el panel de pedidos del agente | Con el POS conectado muestran las tablas del agente, que están vacías. Borrarlos es una decisión del usuario |

Mientras tanto, **qué nota el cliente**: el pedido completo funciona (menú,
carrito, pedido, ubicación, cotización, CONFIRMAR y CANCELAR). Lo que falta es
el contexto después de pedir: si escribe «sin cebolla por favor» o «quiero
cambiar algo», el asistente no sabe que ya tiene un pedido y le contesta como a
cualquier consulta. Las preguntas por un pedido ya hecho («¿en cuánto llega?»)
sí se derivan a una persona, porque eso lo decide el asistente.

También queda de esta fase:

- Agregar al script de conformidad las llamadas de la ampliación
  (`replace`, `kitchen-note`, `switch-to-pickup`, `payment-proofs`); hoy solo
  comprueba el núcleo. `delivery/quotes` se probó a mano contra el backend
  local: responde como dice el contrato.
- El tope de consultas de envío (2 cada 12 horas por cliente) era de las tablas
  del agente; con el POS no hay tope.

## Fase 5 — Buteco en marcha

1. `demos/buteco-do-pica-pau/menu.json` + `images/`, cargado con
   `scripts/load-demo.mjs`.
2. Perfil del restaurante (Fase 2) con sus datos.
3. Video o imagen del botón del menú (MP4 H.264 Baseline, ver `MENU_VIDEO_URL`).
4. Publicar: backend en Railway, agente en Vercel, webhook de Kapso. Sin
   Cloudflare. Tres cosas que se olvidan fácil:
   - `AGENT_INTERNAL_TOKEN` en el backend, igual al `INTERNAL_API_TOKEN` del
     agente: sin él el backend no despierta al agente.
   - `TELEGRAM_WEBHOOK_SECRET` en el agente, y registrar el webhook una vez:
     `node scripts/set-telegram-webhook.mjs https://<dominio-del-agente>`.
   - El bot de Telegram tiene que estar en el grupo del personal.
   - Para cobrar por QR: las cinco `BANECO_*` de **producción** en el backend,
     probadas antes con `check-baneco.mjs`. Sin ellas, cada pedido por QR se
     cancela a los 10 minutos. El agente no necesita ninguna variable nueva:
     descarga el QR con el `CENTRAL_API_TOKEN` que ya tiene.
5. Prueba con teléfono: menú, pedido con envío en efectivo y por QR, retiro,
   ubicación, CONFIRMAR / CANCELAR, aviso al personal, y los botones Listo /
   Salió / Entregado con los mensajes que recibe el cliente. Por QR: que la
   imagen llegue, pagarla, y dejar vencer otra.

### Hecho (2026-10-13): la carta del menú web

El menú web se rehízo con la referencia que dio el cliente (la carta de «La
Llajta»): fondo oscuro y cálido, un solo acento naranja, el nombre de cada
sección a lo grande, y cada plato con su foto ocupando el ancho. La foto entra
creciendo la primera vez que llega a la pantalla.

| Qué | Cómo quedó | Dónde |
|---|---|---|
| Una sola página | La barra fija lleva a cada sección y marca la que se está viendo. Antes las pestañas filtraban el catálogo | `components/menu/MenuStore.tsx`, `CategoryTabs.tsx` |
| **Un plato con opciones** | La «Tabla» tiene seis carnes y las mismas guarniciones: es UNA tarjeta con las carnes para elegir, y la foto, la descripción y el precio cambian con la elección. Sin esto serían seis tarjetas casi iguales | `lib/menu/variants.ts`, `components/menu/ProductCard.tsx` |
| Combos | Sección «Combos» arriba de todo, con lo que trae cada uno renglón por renglón, el precio y el ahorro. Son las promociones del POS; sin fecha de fin son combos fijos | `components/menu/PromoCard.tsx` |
| Reserva de mesas | Formulario (día, hora, personas, nombre, nota) que abre el chat de WhatsApp del local con la reserva escrita. **Apagada**: se enciende con `RESTAURANT_RESERVATIONS_ENABLED=true` | `components/menu/ReservationSection.tsx`, `lib/menu/reservation.ts` |
| Sin foto | Un producto sin foto (una gaseosa) es una fila compacta, no un hueco | `ProductCard.tsx` |
| Colores y letras | En un solo lugar: `globals.css` (`--color-menu-*`) y `layout.tsx`. El carrito y el formulario del pedido tomaron la misma paleta | `app/globals.css`, `app/layout.tsx` |

**Cómo se arma un plato con opciones.** Por el nombre, sin tocar el contrato
del POS: dos o más productos de la misma categoría cuyo nombre empieza igual y
sigue con ` - ` (también ` · `, ` — ` o ` | `, siempre con espacios).

```text
Tabla - Pollo crocante   ┐
Tabla - Costilla         ├─►  un plato «Tabla», con tres opciones
Tabla - Carne de res     ┘
Coca-Cola                ──►  un producto normal (el guion no lleva espacios)
```

Cada opción sigue siendo un producto del POS, con su precio, su foto y su
«agotado». El carrito, la cocina y los mensajes de WhatsApp ven el nombre
completo («Tabla - Costilla»). Si las opciones cuestan distinto, cada una
muestra su precio. Funciona con cualquier POS: no pide ningún campo nuevo.

**Las fotos.** No van en `apps/agent-whatsapp/public/`: se cargan en el POS.
Los originales se dejan en cualquier carpeta y se preparan con
`node scripts/prepare-menu-images.mjs buteco-do-pica-pau <carpeta>`, que
recorta el margen vacío y las pasa a WebP en `demos/buteco-do-pica-pau/images/`
(de 1 MB a unos 60 KB). Después `load-demo.mjs` las sube.

**Lo que hay cargado en local es un BORRADOR**
(`demos/buteco-do-pica-pau/menu.json`): las fotos de las tablas son las del
cliente, y todo lo demás —nombres de las carnes, descripciones, precios,
bebidas y el combo— es de relleno para ver el diseño. El cliente entregó cuatro
fotos y dos son la misma (`Tablita1` y `Tablita3`): hay tres carnes con foto y
faltan tres.

**Comprobado**: el menú local contra el backend local, en un navegador con
tamaño de celular (390 px) y de escritorio: sin errores en consola ni desborde
horizontal; elegir otra carne cambia la foto, la descripción y lo que se agrega
al carrito; el combo, las bebidas sin foto y el formulario de reserva se ven
bien. Las 4358 pruebas del agente pasan. **No comprobado**: en un teléfono de
verdad ni dentro de WhatsApp (el navegador de WhatsApp en iPhone es el que más
sorpresas da).

Para verlo: `scripts\dev-db.ps1 start`, `npm run start:local` en
`apps/backend`, y en `apps/agent-whatsapp`
`$env:RESTAURANT_RESERVATIONS_ENABLED='true'; npx next dev -p 3300`. Abrir
`http://localhost:3300/menu`.

### Lo que falta de la carta

- **La carta real**: las seis carnes con su nombre, foto y precio; qué trae la
  tabla; el resto de las categorías; los combos fijos con su precio.
- **Logo** (`RESTAURANT_LOGO_URL`): con logo, la barra lo muestra siempre; sin
  logo muestra el nombre.
- **Decidir cómo se atienden las reservas.** Hoy el formulario solo deja el
  mensaje escrito en WhatsApp, y el asistente todavía no sabe que un pedido de
  reserva hay que pasárselo a una persona: por eso está apagada. Dos caminos:
  que el asistente derive la reserva al personal por Telegram (poco trabajo), o
  una reserva de verdad en el backend, con Confirmar / Rechazar en Telegram y
  respuesta automática al cliente (más trabajo, y hay que agregarlo al contrato
  del POS).
- **Dirección, descripción y horario** del local: la portada los muestra cuando
  estén en el perfil.

### Hecho (2026-10-13): la maqueta de la tabla por capas

Al usuario le gustó que la foto cambie al elegir la carne, y quiso llevarlo más
lejos: **la misma tabla (arroz y plátano) fija, y encima solo la carne
recortada**. Una carne para las tablitas, y 2 o 3 juntas sobre la misma tabla
para las tablas para compartir. Pidió primero una maqueta con pocas imágenes,
antes de cargar todo.

Está en **`/menu/maqueta`** (solo en desarrollo: en producción es un 404). No
lee el POS ni deja pedir: tiene la Tablita (elige la carne, y para 1 o para 2),
la Tabla de Zeus (2 carnes) y la Hércules (3), con los precios del volante.

| Qué | Cómo quedó | Dónde |
|---|---|---|
| Las capas | La base y cada carne sin el margen vacío, en WebP: de 4,5 MB a 280 KB las cuatro | `scripts/prepare-board-layers.mjs` → `public/menu/capas/` |
| El acomodo | Cada hueco son tres números en % de la base: el centro, dónde se apoya y el ancho. 1 carne: la punta ancha de la tabla. 2: atrás a la izquierda y delante del plátano. 3: además, delante del arroz. La tablita para 2 es el mismo hueco con más porción | `src/lib/menu/board-layers.ts` |
| La tabla en pantalla | Base fija y una capa por hueco; lo que está más abajo en la foto se pinta encima. Al cambiar, la carne vieja se levanta y la nueva cae con su sombra. Un hueco vacío muestra su número sobre la tabla | `src/components/menu/BoardStage.tsx`, animaciones `board-*` en `globals.css` |
| Elegir N carnes | Hueco por hueco, con contador «1 de 2»; tocar un hueco elegido deja cambiarlo. El «+» espera a que estén todas, y la maqueta muestra la línea que llegaría a la cocina | `src/app/menu/maqueta/BoardMockup.tsx` |
| Que nada se corte | Una prueba pone cada carne en cada hueco y falla si se sale del cuadro | `src/lib/menu/board-layers.test.ts` |

Para mover un hueco: cambiar sus tres números en `board-layers.ts` y mirar
`/menu/maqueta`, que se recarga sola. Si cambia la foto de la base, hay que
volver a medirlos. Los originales (`tablaPrincipal.png`, `carnes/*.png`)
quedaron fuera de git, como las `Tablita*.png`.

**Comprobado** contra el agente local, en Chrome sin ventana a 390 px: sin
errores en consola ni desborde horizontal; elegir carne, pasar de 1 a 2
personas, llenar Zeus y Hércules, repetir una carne y el «+». Las capas que
salen se retiran al terminar su animación. **No comprobado**: en un teléfono
de verdad.

Lo que la maqueta deja ver y falta decidir:

- **Tablas de 4 a 7 carnes** (Dioses, Super Tabla L y XL): en esta tabla no
  caben. Piden otra base, más grande, o mostrarlas de otra forma.
- **Faltan 5 recortes**: keperí, alitas, chicharrón de chancho, chicharrón de
  pollo y cola de lagarto. Conviene pedirlos con el mismo ángulo y la misma luz
  que la base: la costilla está fotografiada de frente y la tabla desde arriba
  (a este tamaño se nota poco).
- **Si las carnes se pueden repetir** en una tabla para compartir: la maqueta
  lo deja.
- **Dónde viven las capas** cuando la carta sea real: un producto del POS tiene
  una sola foto. La carne recortada puede ser la foto de «Tablita - Costilla»,
  pero la base no tiene sitio en el contrato; puede quedarse en el agente.
- **Pasarlo a la carta real** (`ProductCard`): la Tablita sirve ya con las
  variantes de hoy; las tablas para compartir necesitan que las carnes elegidas
  lleguen a la cocina (ver abajo).

### Hecho (2026-10-14): la bienvenida con tres opciones

El usuario no quiere la carta en una sola página: es un recorrido eterno para
el cliente. Tomó como referencia la bienvenida de «Pollo Loco», que hace
elegir la sucursal con tres botones grandes, y pidió lo mismo para **elegir qué
viene a hacer el cliente**. Cada opción abre SOLO lo suyo:

| Opción | Qué muestra |
|---|---|
| **Tablitas para 1 y 2** | Las tablitas + Bebidas + Extras |
| **Para compartir** | Las tablas para compartir (Zeus, Hércules, Spartacus) + Bebidas + Extras |
| **Reservar mesa** | El formulario de reserva + los combos de cumpleaños |

Cómo funciona la maqueta:

- **La bienvenida** entra en una pantalla de celular: el nombre del local (o su
  logo, si hay `RESTAURANT_LOGO_URL`), «¡Bienvenido!», las tres opciones con su
  ícono y su línea de color, y una tabla con carnes asomando abajo.
- **La opción va en la dirección** (`?ver=para-1-y-2`, `para-compartir`,
  `reservar`): el «atrás» del celular vuelve a la bienvenida, y **el bot puede
  mandar el enlace directo a una opción**. Se cambia sin volver a pedir la
  página (`history.pushState`, que `useSearchParams` de Next sigue), y conserva
  los demás parámetros (la `session` del bot).
- **Adentro**, la barra fija lleva «‹ Inicio» y las secciones de esa opción
  (`CategoryTabs`, el de la carta). Debajo del título, las otras dos opciones
  a un toque, sin volver al inicio.
- **Un solo pedido** para todas las opciones: una tablita y después una
  bebida. En la maqueta es un carrito de mentira (`mock-cart.tsx`) que muestra
  cada línea con el nombre que llegaría a la cocina y avisa la espera de 30 a
  40 minutos.
- **Los cumpleaños, dentro de «Reservar mesa»**: no se compran en el carrito,
  se reservan. Los dos combos del volante con lo que trae cada uno y la
  condición del carnet. «Reservar con este combo» sube al formulario con la
  nota ya escrita, que llega en el mensaje de WhatsApp. Para eso el formulario
  real (`ReservationSection`) acepta ahora una nota desde fuera (`presetNote`);
  en la carta de hoy no cambia nada.

Todos los textos, opciones, bebidas, extras, precios y combos están en
`src/app/menu/maqueta/data.ts`.

**Comprobado** en Chrome sin ventana a 390 px: sin errores ni desborde; la
bienvenida mide justo una pantalla; elegir una opción, agregar una tablita y
una limonada, ver el pedido, volver con «Inicio» y con el «atrás» del
navegador, pasar a «Para compartir» con el pedido intacto, y el combo que deja
la nota en la reserva.

Falta decidir:

- **La descripción de «Para compartir»**: el usuario pidió «para más de 3
  personas, entre 3 y 8 carnes», pero el volante dice otra cosa (Zeus: 2 carnes
  para 2 a 3 personas; la XL: 7 carnes para 20 a 30). Está así en la maqueta
  hasta que lo confirme.
- **Los extras**: en el volante solo está la sopa de maní (sábados y
  domingos). Falta la lista del local (porciones, salsas…) con precios. Y de
  las bebidas, la medida del vino y del copo sujo.
- **Los combos de cumpleaños**: si van incluidos en el precio de la tabla o se
  cobran aparte, qué es la «tablita cumpleañera», y con cuánta anticipación se
  reservan. En el volante no hay otros combos; si los hubiera (tabla + bebida),
  irían en la sección «Combos» que la carta ya arma con las promociones del POS.

**Propuesta de carta que se le presentó** (falta que la confirme):

| Sección | Qué lleva | Cómo se elige |
|---|---|---|
| Para 1 y 2 | Una tarjeta «Tablita» con las 7 carnes, y la sopa de maní aparte | La carne (cambia la imagen) y el tamaño: para 1 o para 2 |
| Para compartir | Zeus, Hércules, Spartacus, Dioses, Super Tabla L y XL | La tabla según cuántos son, y tantas carnes como permite |
| Bebidas | Limonada, maracuyá, copuazú, Coca-Cola, vino, copo sujo | El tamaño (como hoy) |
| Cumpleaños | Los dos paquetes del combo cumpleañero | No se compra: lleva a la reserva con «Es un cumpleaños» marcado |
| Reservas | El formulario de siempre | — |

Las carnes de una tabla para compartir tienen que llegar a la cocina. Hoy el
pedido solo tiene una nota general y el carrito cuenta por producto. Camino
rápido propuesto: escribir las carnes elegidas en la nota del pedido. Camino
correcto: que cada línea lleve sus opciones (backend, carrito y contrato;
hay que acordarlo con Rocha).

**La carta real, leída de los volantes del cliente** (2026-10-14):

- *Tablitas para 1 y 2 personas* (arroz, plátano, salsa de ajo y ají):
  keperí 70; alitas agridulce 60; chicharrón de chancho 70 y 110 (con limón);
  chicharrón de pollo 50 y 100; chicharrón de pescado 75 y 120; costilla 75 y
  120; cola de lagarto 75 y 120. Sopa de maní 15, solo sábados y domingos.
- *Tablitas especiales* (arroz, plátano, salsa de ajo y limón; carnes a
  elección): Super Tabla XL, 7 carnes, 20 a 30 personas, 1600; Super Tabla L,
  5 carnes, 15 a 17, 950; Tabla de los Dioses, 4 carnes, 5 a 8, 450; Tabla
  Spartacus, 3 carnes, 4 a 5, 350; Tabla Hércules, 3 carnes, 3 a 4, 250;
  Tabla de Zeus, 2 carnes, 2 a 3, 175.
- *Bebidas*: limonada 1 L 15 / 2 L 25; maracuyá 15 / 30; copuazú 25 / 35;
  Coca-Cola 2 L 25; vino 60; copo sujo 25.
- *Combo cumpleañero* (el festejado presenta su carnet el día del evento):
  con Super Tabla L o XL, video editado, fotos con los invitados, cumpleaños
  feliz, vela lluvia de oro, tablita cumpleañera, banda y vino para los
  invitados; con una tablita mixta mediana (Dioses, Spartacus, Hércules o
  Zeus), cumpleaños feliz, vela lluvia de oro, jarra de limonada de 2 L y
  fotos.
- Reservas: 695 95015. Instagram @buteco.do.picapau.scz (Santa Cruz).
  «Comida preparada al momento, espera de 30 a 40 minutos»: mostrarlo en el
  carrito, antes de confirmar.

Preguntas que se le hicieron y siguen sin respuesta: si keperí y alitas
vienen solo en un tamaño; si las carnes de las tablas para compartir son las
mismas 7 y si se pueden repetir; si la L y la XL se piden por delivery o solo
con reserva, y con cuánta anticipación; si el 695 95015 es el WhatsApp de
reservas y el bot usa otro número; si la sopa de maní se bloquea entre semana;
«Spartacus» o «Sportacus» (los volantes no coinciden). Las carnes recortadas
que mandó se llaman «biffe», «chicharrón de pescado» y «costilla de res»:
«biffe» no está en el volante.

### Hecho (2026-10-14): fuera la demo anterior, y los flujos de Buteco

Revisión completa en **[`docs/flujos-buteco.md`](flujos-buteco.md)**: qué hace
el agente con cada cosa que puede escribir un cliente de Buteco, qué ya sirve y
qué falta. Lo hecho:

- **Sin rastros de Don Zarco** en el código del agente ni del backend: sus
  productos, descripciones, fotos, colores, nombres de paquete, ejemplos de los
  comentarios y los textos que lee la IA. Borrados su carta de demo, su logo, su
  video y la imagen del QR de su cuenta bancaria, que quedaba publicada. Una
  prueba (`no-hardcoded-restaurant.test.ts`) falla si vuelve a aparecer en
  `src/`, también en comentarios.
- **Base del agente**: migración `0040_retira_carta_de_la_demo.sql` (probada en
  un Postgres de prueba) y `seed.sql` vacío. En la base local del backend se
  borraron sus productos y su combo.
- **Pruebas**: el restaurante de las pruebas es Buteco (dirección y horario de
  ejemplo) y los productos de ejemplo, tablas, keperí, alitas. Pasan las 4373.
- **`RESTAURANT_FACTS`**: lo que el local quiere que el asistente sepa, una
  frase por línea. Entra al prompt junto al horario y la ubicación. La de Buteco
  (del volante) está en el `.env.local` y en `flujos-buteco.md`.
- **Dos reglas nuevas del prompt**: para cuántas personas es una tabla se puede
  decir si está escrito; una reserva nunca se confirma.
- **Evals**: seis casos nuevos de preguntas del local (reservar, qué trae la
  tablita, cuánto tarda, cumpleaños). **No se corrieron**: no hay
  `OPENAI_API_KEY` en el `.env.local`.

Hallazgo: **las tarifas de envío del backend son de otro proyecto** (migración
`1700000011000`, Bs 10 el primer km…). Hay que cargar las de Buteco antes de
publicar.

Lo más urgente que falta decidir: **el flujo de las reservas** (si el 695 95015
es el número del bot o no) y **cómo llegan a la cocina las carnes** de una
tabla para compartir.

## Fase 6 — Conectar el POS multi-tenant

El contrato de Buteco (`docs/pos-contract.md`) salió del backend que hay en
este repo, que es una copia de hace un tiempo del backend central. El agente
de Zarco, que habla con el backend central de hoy, documenta un contrato que
ya cambió (`docs/backend-central-http-contract.md` en su repo, leído el
2026-10-13). Diferencias que hay que resolver con Rocha antes de conectar: o
el POS nuevo cumple el contrato de Buteco, o el agente de Buteco se adapta.

| Tema | Contrato de Buteco | Backend central de hoy (según el agente de Zarco) |
|---|---|---|
| Avisos al cliente | El POS manda el texto ya escrito (`text`) | Manda un tipo y sus datos (`messageType`, `context`) y el agente escribe el texto; el `text` suelto sigue aceptado |
| Teléfono del cliente | Viene en `to` | No viene: el agente lo pide con `GET /customers/:id` |
| Imagen del QR | Ruta protegida del POS o URL https | Solo ruta protegida del POS (ya compatible) |
| Pedido vencido sin pagar | El POS avisa al cliente | El aviso existe (`order_expired_unpaid`) pero el agente lo calla, por decisión del negocio |
| Ubicación | `POST /orders/:id/location` | `POST /internal/agent/locations/attach`, por teléfono del cliente |
| Grupos de Telegram | Uno solo | `staff-group` y `delivery-group`, cada uno con su chat |

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
- Formas de pago: efectivo, QR (Banco Económico: ya entregó el manual y los
  datos de prueba), otras.
- Del banco: la carta de solicitud firmada, y los datos de producción
  (dirección, usuario, contraseña, llave y número de cuenta).
- Retiro en el local: sí o no.
- Número de WhatsApp que se usará (no puede estar en uso en la app de WhatsApp
  normal) y nombre que verá el cliente.
- Quién recibe los pedidos y por dónde (grupo de Telegram o WhatsApp).
- Video o imagen para el botón del menú; logo y colores para el menú web.
