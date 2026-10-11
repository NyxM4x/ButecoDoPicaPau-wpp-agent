# Publicar la demo

Tres servicios del mismo repositorio y una base de datos. Estado al
2026-10-11: **base lista, servicios todavía sin publicar.**

| Pieza | Dónde | Carpeta raíz | Estado |
|---|---|---|---|
| Base de datos | Supabase `gkhvijhcyysasofrukbr` | — | lista: backend en `public` (32 migraciones), agente en `agent` (39) |
| Backend | Railway | `apps/backend` | por publicar |
| Agente de WhatsApp | Vercel | `apps/agent-whatsapp` | por publicar |
| POS | Vercel | `apps/pos` | por publicar |

El backend tiene que estar en internet: el agente publicado en Vercel no puede
hablar con un backend que corre en una máquina local, y el backend necesita
llamar al agente para enviar los WhatsApp.

## Dos repositorios

El mismo código está en dos repos privados de GitHub, porque la prueba gratis
de Railway de la primera cuenta se agotó:

| Remoto de git | Repositorio | Para qué |
|---|---|---|
|  |  | el principal |
|  |  | el que despliega Railway, con la cuenta nueva |

Cada cambio se sube a los dos:  y .
Si solo se sube a uno, el otro servicio se queda con la versión vieja.

## Lo que NO está en git

Un `git clone` no trae nada de esto. Si se trabaja desde otra carpeta u otra
máquina, hay que **copiar estos archivos a mano** desde la carpeta original:

| Archivo | Qué lleva |
|---|---|
| `apps/backend/.env.railway` | variables de producción del backend (tokens generados) |
| `apps/agent-whatsapp/.env.vercel` | variables de producción del agente (Supabase, Kapso, tokens) |
| `apps/pos/.env.vercel` | variable de producción del POS |
| `apps/backend/.env.supabase` | conexión a la base de Supabase y la clave del `admin` de producción |
| `apps/backend/.env.dev` | entorno local del backend y su `admin` de pruebas |
| `apps/agent-whatsapp/.env.local` | entorno local del agente |
| `.local/` | la base PostgreSQL local (se puede recrear, ver README) |

`CENTRAL_API_TOKEN` (agente) es el token `whatsapp-gateway` de
`SERVICE_AUTH_TOKENS` (backend), y `GATEWAY_AUTH_TOKEN` es el mismo valor en
los dos. Si se regenera uno, hay que cambiar el otro.

## Orden de publicación

En cada archivo de variables solo se cambian las líneas marcadas `CAMBIAR`.

1. **Backend en Railway.** Proyecto nuevo desde el repo, Root Directory
   `apps/backend`. Variables: el contenido de `.env.railway`. Generar un
   dominio público. `GET <url>/health` debe responder 200.
   - Sin enlazar GitHub: `railway login` y, dentro de `apps/backend`,
     `railway up`.
   - Las migraciones no corren solas: ya están aplicadas en Supabase. Una
     migración nueva se aplica con `npm run migrate:up` y el `DATABASE_URL` de
     `.env.supabase`.
2. **Agente en Vercel.** Root Directory `apps/agent-whatsapp`. Variables: el
   contenido de `.env.vercel`, con la URL de Railway en
   `CENTRAL_API_BASE_URL`. Tras el primer despliegue, poner su propia URL en
   `APP_BASE_URL` y volver a desplegar.
3. **POS en Vercel.** Otro proyecto, Root Directory `apps/pos`.
   `VITE_API_URL` = URL de Railway. `apps/pos/vercel.json` ya trae el build y
   las rutas.
4. **Volver a Railway** y completar `GATEWAY_BASE_URL` (URL del agente +
   `/api`) y `CORS_ORIGINS` (URL del POS).
5. **Cargar la demo en producción** (menú, fotos y usuarios de cocina y caja):

   ```powershell
   $env:API_URL = 'https://<backend>'
   $env:ADMIN_USER = 'admin'
   $env:ADMIN_PASSWORD = '<PROD_ADMIN_PASSWORD de apps/backend/.env.supabase>'
   node scripts\load-demo.mjs don-zarco --replace --with-staff --24h
   ```

6. **Webhook en Kapso**: URL `<agente>/api/kapso/webhook`, eventos
   `whatsapp.message.received` y `whatsapp.message.sent`, payload `v2`. El
   secreto que entrega va en `KAPSO_WEBHOOK_SECRET` de Vercel; volver a
   desplegar el agente.
7. **Probar**: escribir «menú» al número desde un teléfono, abrir el enlace,
   pedir con envío y mandar la ubicación. Debe aparecer en Cocina del POS.

## Cosas a saber

- **El número de Kapso configurado es el Sandbox**: solo escribe a teléfonos
  registrados en ese sandbox.
- **Fotos de producto**: el backend las guarda en disco (`storage/`) y Railway
  borra ese disco en cada despliegue. Hasta configurar un bucket
  (`PAYMENT_PROOFS_S3_*`) o un volumen, repetir el paso 5 después de cada
  despliegue del backend.
- **Cuenta de Railway en prueba gratis**: una cuenta sin verificar queda en
  «Limited Trial», con la salida de red restringida. Si el backend despliega
  pero no conecta con Supabase, es eso.
- **Tablas del agente**: se actualizan con
  `DATABASE_URL=<...> node scripts/agent-db.mjs` (repetible; aplica solo lo
  pendiente). El agente necesita `SUPABASE_DB_SCHEMA=agent`.
- **Sin probar todavía**: el envío real por Kapso y Telegram, el menú abierto
  con enlace de sesión, y el despliegue en sí.
