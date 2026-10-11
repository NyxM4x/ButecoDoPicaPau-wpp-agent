# restaurant-demos

Plataforma para demos de restaurantes: un backend central, un POS con venta,
cocina, caja y administración, y un agente de WhatsApp. El menú, las fotos y
los datos del local se cambian en segundos, desde el POS o cargando un perfil
de demo.

| Carpeta | Qué es | Stack | Estado |
|---|---|---|---|
| `apps/backend` | Backend central: catálogo, pedidos, pagos, caja | NestJS + PostgreSQL | funciona |
| `apps/pos` | POS: venta, cocina (KDS), caja, pedidos y administración | Vite + React + Tailwind | funciona |
| `apps/agent-whatsapp` | Agente de IA para WhatsApp y menú web del cliente | Next.js + Supabase | menú, pedido y ubicación ya van por el backend; falta probarlo con WhatsApp real |
| `demos/` | Perfiles de demo: `menu.json` + fotos por restaurante | JSON | 2 perfiles |
| `scripts/` | Base local, cargador de demos y simulador de pedidos | Node / PowerShell | funciona |
| `docs/` | Plan maestro, inventario, mapeo de datos y avance | — | — |

Empieza por `docs/implementation-progress.md` (en qué quedamos), sigue con
`docs/deploy.md` (cómo se publica y qué archivos no están en git) y
`docs/CLAUDE_MONOREPO_CONTEXT.md` (arquitectura y fases).

Cada app tiene su propio `package.json` y `package-lock.json`: se instala y se
prueba dentro de su carpeta.

## Levantar la demo en tu máquina

Requisitos: Node 20 o superior y PostgreSQL instalado (se usan sus binarios, no
su servicio).

```powershell
# 1. Base de datos local (puerto 54329, datos en .local/, no toca nada remoto)
.\scripts\dev-db.ps1 start

# 2. Backend (puerto 3100)
cd apps\backend
npm ci
npm run migrate:local     # aplica las migraciones a la base de .env.dev
npm run start:local

# 3. POS (http://localhost:5180)
cd apps\pos
npm ci
npm run dev

# 4. Cargar un restaurante
node scripts\load-demo.mjs don-zarco --replace --with-staff --24h
```

`apps/backend/.env.dev` no está en git. Si no lo tienes, créalo con estas
claves: `DATABASE_URL` (`postgres://postgres@localhost:54329/restaurant_demos_dev`),
`PORT=3100`, `CORS_ORIGINS`, `SERVICE_AUTH_TOKENS` (forma
`whatsapp-gateway:<token>,pos:<token>,web:<token>`), `GATEWAY_BASE_URL`,
`GATEWAY_AUTH_TOKEN`, `JWT_SECRET`, `JWT_EXPIRES_IN=8h`, `DEV_ADMIN_USER` y
`DEV_ADMIN_PASSWORD`. El primer administrador se crea con
`ADMIN_PASSWORD=<clave> npx ts-node scripts/create-admin.ts <usuario>` dentro de
`apps/backend`.

Se entra al POS con ese administrador. Con `--with-staff` se crean además los
usuarios `cocina` y `caja`, con la misma contraseña.

## Cambiar de restaurante

Un perfil de demo es una carpeta en `demos/<nombre>/` con un `menu.json`
(nombre del local, horario, categorías, productos, promociones) y una carpeta
`images/` con las fotos.

```powershell
node scripts\load-demo.mjs cafe-central --replace   # pasa a otro restaurante
node scripts\load-demo.mjs don-zarco --replace      # y vuelve
```

- Sin `--replace` solo agrega o actualiza. Con `--replace` apaga lo que no sea
  de esa demo. Nunca borra: los pedidos viejos siguen apuntando a algo que existe.
- `--24h` deja el local abierto todo el día. Sin eso rige el horario del
  `menu.json`, y fuera de ese horario el backend rechaza los pedidos de WhatsApp
  y web (el POS vende siempre).
- Se puede correr las veces que haga falta. Para una demo nueva, copia una
  carpeta de `demos/` y edita su `menu.json`.

Los cambios sueltos (un precio, una foto, marcar algo agotado, pausar pedidos)
se hacen desde el POS, en **Menú**, **Promociones** y **Configuración**.

## Probar un pedido de WhatsApp sin WhatsApp

```powershell
node scripts\simulate-whatsapp-order.mjs                    # delivery, paga al recibir
node scripts\simulate-whatsapp-order.mjs --pickup --qr      # retira en el local, paga por QR
node scripts\simulate-whatsapp-order.mjs --nota "sin cebolla"
```

Crea el pedido en el backend con el token del gateway, igual que lo hará el
agente, y aparece en la **Cocina** del POS con la etiqueta WHATSAPP. Con la
caja cerrada el pedido no se confirma: queda esperando en **Pedidos** hasta que
alguien abra la caja y lo acepte.

## Bases de datos

| Base | Qué es |
|---|---|
| PostgreSQL local, puerto 54329 | desarrollo y demos en esta máquina |
| Supabase `gkhvijhcyysasofrukbr` | la demo publicada: el backend en el esquema `public` y el agente en el esquema `agent` |
| Supabase `rgoesdoqmhlurpclacha` | backend central del POS de producción: **solo lectura** |

Las tablas del agente van en un esquema aparte porque 9 se llaman igual que las
del backend. Se crean y se actualizan con `scripts/agent-db.mjs`, y el agente
las usa con `SUPABASE_DB_SCHEMA=agent`.

Para saber si una base sirve antes de migrarla (solo lee, no escribe nada):

```powershell
cd apps\backend
node --env-file=.env.supabase scripts\check-database.mjs
```

`.env.supabase` (fuera de git) lleva el `DATABASE_URL` de esa base (pooler de
sesión, puerto 5432) y la clave del administrador de producción.

## Publicar

Backend en Railway, agente y POS en Vercel. El paso a paso, las variables de
cada servicio y la lista de archivos que hay que copiar a mano están en
`docs/deploy.md`.

## El agente con el backend central

Con `CENTRAL_API_BASE_URL` y `CENTRAL_API_TOKEN`, el menú web del agente lee
categorías, productos, fotos y promociones del backend, y los pedidos se crean
allí: aparecen en la Cocina del POS. Sin esas variables el agente funciona con
sus propias tablas, como antes. El código está en
`apps/agent-whatsapp/src/lib/central/`.

```powershell
cd apps\agent-whatsapp
npm ci
npm run dev        # http://localhost:3000/menu  (lee .env.local)
```
