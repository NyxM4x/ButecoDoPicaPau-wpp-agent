# Buteco do Pica-Pau

Agente de WhatsApp que vende y toma pedidos para el restaurante **Buteco do
Pica-Pau**, con un backend que guarda catálogo y pedidos mientras llega el POS
multi-tenant.

Este repo nació el **2026-10-13** como copia, con su historial, del proyecto de
demo de restaurantes (Don Zarco), para no empezar de cero. Es independiente: no
está enlazado a aquel repositorio y no recibe ni envía cambios de él. Lo que
se construya aquí debe servir para cualquier restaurante, y Buteco es el
primero.

> **Estado (2026-10-13):** hechas las fases 1 a 3 y parte de la 4. El agente ya
> no tiene escrito ningún restaurante: el nombre, el horario, la moneda y lo que
> se puede pedir salen del perfil del POS. Nada está publicado. El plan y lo que
> sigue están en [`docs/plan.md`](docs/plan.md).

## Decisiones (2026-10-13)

| Tema | Decisión |
|---|---|
| Repositorio | Propio e independiente, con el historial de la demo como punto de partida. |
| Agente | **Uno por restaurante**: un despliegue en Vercel con sus variables (número de WhatsApp, token del POS, datos del local). |
| POS | **Todavía no hay.** El backend de este repo hace de POS provisional, sin pantallas: el personal recibe los pedidos por Telegram o WhatsApp. |
| POS futuro | Un POS **multi-tenant**, aparte, con **el mismo esquema del backend central** de este repo. El agente se conectará a él cambiando `CENTRAL_API_BASE_URL` y `CENTRAL_API_TOKEN`, siempre que cumpla [el contrato](docs/pos-contract.md). El restaurante se identifica por el token, nunca por un parámetro. |
| Servicios | Railway (backend), Vercel (agente), Supabase, Kapso, Telegram. **Sin Cloudflare**: al agente lo despierta el backend. |
| Personal | Recibe cada pedido en Telegram con botones **Listo / Salió / Entregado**, que le avisan al cliente por WhatsApp. |
| Pago por QR | Con la API del banco del cliente, que se integra más adelante. Mientras tanto, efectivo. |

## Cómo encaja

```text
  Cliente ──WhatsApp──► Kapso ──webhook──► Agente (apps/agent-whatsapp, Vercel)
                                             │   ▲
                       catálogo, pedidos,    │   │  mensajes para el cliente
                       ubicación, efectivo   ▼   │  y avisos al personal
                                          POS / backend
                     hoy:   apps/backend (Railway), una base por restaurante
                     luego: POS multi-tenant, mismo contrato
```

El agente solo habla con el POS desde `apps/agent-whatsapp/src/lib/central/`.
Esa carpeta es la frontera: nada fuera de ella debe saber qué POS hay detrás.

## Carpetas

| Carpeta | Qué es | En este proyecto |
|---|---|---|
| `apps/agent-whatsapp` | Agente de IA para WhatsApp y menú web | **el producto** |
| `apps/backend` | Backend central (NestJS + PostgreSQL) | POS provisional, sin pantallas |
| `apps/pos` | POS de la demo (venta, cocina, caja) | **no se despliega**; queda de referencia |
| `demos/` | Perfiles de la demo (`don-zarco`, `cafe-central`) | aquí irá `demos/buteco-do-pica-pau` |
| `scripts/` | Base local, cargador de menú, simulador de pedidos | se usan igual |
| `docs/` | Plan, contrato y la documentación heredada de la demo | ver abajo |

Documentos:

- [`docs/plan.md`](docs/plan.md): **por dónde vamos y qué sigue.** Empezar aquí.
- [`docs/pos-contract.md`](docs/pos-contract.md): **el contrato del POS**, lo
  que se le entrega a quien construya el POS multi-tenant. Se comprueba con
  `node scripts/check-pos-contract.mjs`.
- `docs/implementation-progress.md`, `docs/deploy.md`: bitácora y publicación
  **de la demo**, hasta el 2026-10-13. Sirven de historia y de guía técnica.
- `docs/canonical-contract-proposal.md`, `docs/data-mapping.md`: base del
  contrato del POS.

## Repositorio

Un solo remoto, `origin`:
[`NyxM4x/ButecoDoPicaPau-wpp-agent`](https://github.com/NyxM4x/ButecoDoPicaPau-wpp-agent).

Clonarlo en otra máquina:

```powershell
git clone https://github.com/NyxM4x/ButecoDoPicaPau-wpp-agent.git buteco-do-pica-pau
```

## Trabajar en local

Node 20+ y PostgreSQL instalado (se usan sus binarios, no su servicio). Los
puertos son propios de Buteco, para convivir con la demo en la misma PC:

| Qué | Puerto |
|---|---|
| Base local (`buteco_dev`, datos en `.local/`) | 54330 |
| Backend | 3200 |
| Agente | 3300 |

```powershell
.\scripts\dev-db.ps1 start
cd apps\backend;          npm ci; npm run migrate:local; npm run start:local
cd apps\agent-whatsapp;   npm ci; npx next dev -p 3300
node scripts\check-pos-contract.mjs     # comprueba el backend local contra el contrato
```

`apps/backend/.env.dev` y `apps/agent-whatsapp/.env.local` no están en git.

Las variables (`.env.local`, `.env.dev`…) **no se copian de la demo**: Buteco
tiene su propio número de WhatsApp, su base y sus tokens. Las claves están en
cada `.env.example`; la lista de lo que hay que crear está en la
[Fase 0](docs/plan.md#fase-0--separar-el-proyecto).
