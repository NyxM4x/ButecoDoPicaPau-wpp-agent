# Contexto maestro para Claude Code: Restaurant Demos Monorepo

## Rol de Claude

Actua como ingeniero principal de implementacion. El usuario define el comportamiento del negocio y este documento define la arquitectura inicial. No fusiones codigo a ciegas ni crees una segunda fuente de verdad.

Antes de modificar codigo:

1. Lee este archivo completo.
2. Revisa README, AGENTS.md, CLAUDE.md y documentacion local de cada proyecto.
3. Inspecciona migraciones, rutas, endpoints y contratos actuales.
4. Localiza el repositorio real del POS si no esta en el workspace.
5. Crea una matriz de equivalencias antes de migrar datos.
6. Haz cambios pequenos y verificables.
7. Ejecuta tests, lint y build de la aplicacion modificada.

No modifiques produccion. No borres tablas ni funcionalidades existentes sin plan de migracion. No hagas commits automaticamente.

## Objetivo

Combinar dos sistemas independientes en una plataforma reutilizable para demos de restaurantes:

1. Agente de IA para WhatsApp.
2. Sistema POS con caja, cocina y administracion.

El resultado debe permitir cambiar desde la aplicacion el restaurante, productos, categorias, precios, imagenes, extras, promociones, horarios, tarifas de delivery, metodos de pago, capacidad de cocina y mensajes operativos.

No se crearan bases separadas por demo. La arquitectura debe soportar multiples restaurantes mediante `restaurant_id`, aunque inicialmente se utilice una sola demo activa.

## Proyectos de origen

### Agente

Ruta actual: `Agente_restaurant/sarcoRestaurant`

Tecnologias: Next.js, React, TypeScript, Supabase y Vitest.

Conservar:

- Webhooks de WhatsApp.
- Historial de mensajes.
- Conversaciones.
- Pausas y derivacion a humano.
- Acciones de IA.
- Envio de menu.
- Solicitud de ubicacion.
- Comprobantes.
- Notificaciones WhatsApp.
- Alertas Telegram.
- Evaluaciones y pruebas del agente.

Migrar al backend central:

- Catalogo.
- Precios.
- Productos.
- Categorias.
- Promociones.
- Creacion de pedidos.
- Estados de pedidos.
- Pagos.
- Delivery.
- Caja.
- Disponibilidad.

El agente no sera propietario de esos datos ni tendra acceso directo a la base central. Sera un cliente HTTP.

### Backend central

Ruta actual: `backend-central-zarco-dev`

Tecnologias: NestJS, TypeScript, PostgreSQL, Kysely, SQL migrations, JWT, service tokens, Swagger/OpenAPI y Jest.

Ya contiene modulos de auth, roles, categorias, productos, clientes, promociones, pedidos, delivery, payment attempts, payment proofs, Banco QR, caja, settings operativos, reportes, notificaciones y late-order requests.

Este backend sera la fuente unica de verdad del negocio.

### POS

Existe un POS frontend desarrollado por separado. Si no esta en el workspace, localizarlo antes de implementar. Documentar tecnologia, rutas, estado, cliente HTTP, pantallas, cocina, caja y contrato esperado.

## Arquitectura objetivo

```text
POS ----------\
Kitchen -------+--> HTTP --> Backend NestJS --> PostgreSQL
Admin ---------/
Agent WhatsApp /
```

Estructura objetivo:

```text
restaurant-demos/
  apps/
    backend/
    pos/
    kitchen/
    admin/
    agent-whatsapp/
  packages/
    contracts/
    api-client/
    state-machine/
    ui/
    demo-tools/
  database/
    migrations/
    seeds/
  demos/
    don-zarco/
      restaurant.json
      seed.json
      images/
  docs/
    architecture.md
    migration-plan.md
    api-contract.md
    data-mapping.md
```

## Fuente unica de verdad

El backend central es propietario de restaurants, settings, categorias, productos, extras, promociones, clientes, pedidos, items, pagos, comprobantes, caja, delivery y reportes.

El agente puede conservar sus tablas de conversaciones, mensajes, runs, control events, webhooks, menu send deliveries y Telegram outbox. Esas tablas representan integracion, no negocio principal.

## Pedido canonico

Cada pedido tiene un solo ID tecnico:

```text
orders.id = UUID
orders.order_number = ORD-260923-001
orders.channel = pos | whatsapp | web
orders.delivery_type = pickup | dine_in | delivery
orders.payment_method = cash | qr | card
orders.payment_status = unpaid | pending_review | paid | rejected | paid_unapplied | refunded
orders.customer_id
orders.cash_register_session_id
orders.table_number
orders.notes
orders.source_metadata
```

No crear IDs o tablas de pedidos separadas por canal.

## Estados

Pedido:

```text
draft
awaiting_location
confirmed
preparing
ready
out_for_delivery
delivered
cancelled
```

Flujo principal:

```text
confirmed -> preparing -> ready -> out_for_delivery -> delivered
```

Para pedidos presenciales normalmente termina en `ready`.

Los items pueden tener estado sencillo:

```text
pending
fired
ready
voided
```

No implementar tracking de cada unidad, `prepared_quantity` ni `served_quantity` en esta fase. El flujo de cocina es por ficha/pedido.

## Cocina

El KDS tendra tres zonas:

```text
PRESENCIAL | WHATSAPP | PREPARANDO
```

No habra columna permanente Confirmado.

- Pedido nuevo: aparece en POS o WHATSAPP.
- `Iniciar`: cambia a `preparing`.
- Pedido en preparacion: aparece en PREPARANDO.
- `Completar`: cambia a `ready`.
- Desaparece del tablero principal.
- `LISTOS` es un panel desplegable para ver pedidos completados.
- La ficha muestra numero, canal, productos, cantidades, notas y tipo de entrega o mesa.
- Cocina no ve precios, telefonos ni datos bancarios.
- Agregar sonido tipo timbre de celular, con opcion de silenciar.
- Cocina puede agregar nota operativa.
- Cocina no cancela, no modifica productos y no confirma pagos.

## POS y caja

Flujo POS:

```text
Abrir caja -> crear pedido -> elegir efectivo o QR -> confirmar pago -> enviar a cocina
```

El QR se simula para demos mediante configuracion, por ejemplo `PAYMENT_PROVIDER=mock`.

POS y WhatsApp comparten una sola caja, pero puede haber varias sesiones durante el mismo dia. Cada pedido y pago conserva `cash_register_session_id`.

El cierre de caja debe ser transaccional:

1. Bloquear temporalmente la sesion.
2. Buscar comprobantes de WhatsApp `pending_review` vinculados a la sesion.
3. Bloquear cierre si existen.
4. Calcular totales.
5. Guardar cierre atomicamente.

Un pedido sin comprobante no bloquea el cierre. Un comprobante enviado y pendiente de revision si lo bloquea. Un admin puede forzar el cierre dejando motivo auditado.

Pagos detectados despues del cierre no pasan silenciosamente a la caja siguiente. Deben conservar su sesion original y entrar a cola administrativa como `paid_unapplied` cuando corresponda.

## WhatsApp

El agente debe usar el backend para:

```text
GET /categories
GET /products
GET /promotions
POST /customers/find-or-create
POST /orders
POST /orders/:id/location
POST /payment-proofs
GET /orders/:id
```

Reglas:

- El cliente modifica su pedido una sola vez.
- Despues de `preparing` no se modifican productos.
- Reclamos, quejas y notas olvidadas pueden derivarse a humano.
- Tres ciclos de botones sin armar pedido pueden generar derivacion.
- Con caja cerrada WhatsApp informa que el local esta cerrado.
- Con cocina saturada solicita reintentar aproximadamente en 5 minutos.
- El agente nunca confirma pagos directamente.

## Capacidad

Configuracion por restaurante:

```text
queue_enabled
kitchen_active_orders_limit
promotion_active_orders_limit
retry_after_minutes
```

Al alcanzar capacidad no se confirman nuevos pedidos automaticamente. WhatsApp recibe el mensaje configurado y nuevamente el boton de menu. POS y administracion muestran la condicion.

## Catalogo, extras e imagenes

Usar:

```text
categories
products
product_option_groups
product_options
```

Los extras aceptan precio cero. Cada pedido conserva snapshots de nombres y precios.

Imagenes:

```text
POST /products/:id/image
GET /products/:id/image
```

Validar PNG, JPG y WebP. Priorizar PNG transparente para productos recortados. No depender de nombres manuales de archivos.

## Roles

```text
owner
admin
cashier
kitchen
```

- `owner`: todo, usuarios, configuracion critica y restauracion.
- `admin`: gestion completa del negocio.
- `cashier`: POS, cobros, caja y cancelaciones autorizadas.
- `kitchen`: KDS, iniciar, completar y notas.

## Demos

Cada demo puede cargar restaurante, configuracion, categorias, productos, precios, imagenes, extras, promociones, horarios, tarifas, capacidad, mensajes y pedidos ficticios.

Funciones:

```text
Cargar demo
Restaurar demo
Crear pedidos ficticios
Limpiar pedidos de prueba
Simular pago QR
Simular cierre de caja
Simular saturacion
```

Restaurar demo nunca debe borrar datos reales. Separar datos de demo, operativos e historicos.

## Orden obligatorio

### Fase 0: inventario

No cambiar logica. Crear `docs/repository-inventory.md` y `docs/data-mapping.md`. Documentar proyectos, tecnologias, rutas, tablas, migraciones, endpoints, variables, duplicaciones y funcionalidades a conservar.

### Fase 1: contratos

Crear `packages/contracts` y `packages/state-machine` con tipos y pruebas para Order, OrderItem, Product, Customer, Payment, CashRegisterSession, KitchenTicket, roles y transiciones.

### Fase 2: backend

Adaptar primero el backend central: restaurant_id, mesas, extras, estados, notas, cancelacion autorizada, bloqueo de cierre, QR simulado y capacidad.

### Fase 3: migracion

Migrar menu_items a products, unificar clientes por telefono, migrar pedidos historicos preservando snapshots y migrar datos del agente. Crear script repetible.

### Fase 4: POS y cocina

Conectar POS y KDS al backend canonico. Implementar etiquetas, Iniciar, Completar, Listos, timbre, notas y cobro simulado.

### Fase 5: agente

Eliminar lectura local de catalogo y creacion local de pedidos. Usar cliente HTTP. Mantener conversaciones, mensajes, comprobantes, derivaciones y Telegram.

### Fase 6: demos

Implementar seeds, carga, reset, pedidos ficticios, simuladores y escenarios de presentacion.

### Fase 7: validacion

Validar POS efectivo, POS QR simulado, WhatsApp, comprobantes, cierre bloqueado, cierre forzado, varias cajas, producto agotado, cambios de precio, extras, saturacion y restauracion.

## Primera tarea obligatoria

Antes de escribir funcionalidades:

1. Confirmar rutas reales de todos los repositorios.
2. Leer documentacion local.
3. Localizar el POS.
4. Crear `docs/repository-inventory.md`.
5. Crear `docs/data-mapping.md`.
6. Comparar orders, order_items, menu_items, products, customers, pagos, caja, notificaciones y cocina.
7. No migrar tablas todavia.
8. No borrar tablas todavia.
9. Entregar conflictos y propuesta de contrato.

La primera entrega debe ser documentacion y analisis verificable. La implementacion empieza despues de revisar la matriz.
