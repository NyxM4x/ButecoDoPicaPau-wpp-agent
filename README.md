# Buteco do Pica-Pau

Agente de WhatsApp que vende y toma pedidos para el restaurante **Buteco do
Pica-Pau**, con un backend que guarda catálogo y pedidos mientras llega el POS
multi-tenant.

Este repo nació el **2026-10-13** como copia, con su historial, del proyecto de
demo de restaurantes (Don Zarco), para no empezar de cero. Es independiente: no
está enlazado a aquel repositorio y no recibe ni envía cambios de él. Lo que
se construya aquí debe servir para cualquier restaurante, y Buteco es el
primero.

> **Estado:** el código todavía es el de la demo y dice «Don Zarco» en muchos
> sitios. Nada está publicado. El plan está en [`docs/plan.md`](docs/plan.md).

## Decisiones (2026-10-13)

| Tema | Decisión |
|---|---|
| Repositorio | Propio e independiente, con el historial de la demo como punto de partida. |
| Agente | **Uno por restaurante**: un despliegue en Vercel con sus variables (número de WhatsApp, token del POS, datos del local). |
| POS | **Todavía no hay.** El backend de este repo hace de POS provisional, sin pantallas: el personal recibe los pedidos por Telegram o WhatsApp. |
| POS futuro | Un POS **multi-tenant**, aparte. El agente se conectará a él cambiando `CENTRAL_API_BASE_URL` y `CENTRAL_API_TOKEN`, siempre que cumpla el contrato que se escribe en la [Fase 1](docs/plan.md#fase-1--contrato-del-pos). El restaurante se identifica por el token, nunca por un parámetro. |

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

Igual que en la demo (Node 20+, PostgreSQL para la base local):

```powershell
.\scripts\dev-db.ps1 start
cd apps\backend;          npm ci; npm run migrate:local; npm run start:local
cd apps\agent-whatsapp;   npm ci; npm run dev
```

Las variables (`.env.local`, `.env.dev`…) **no se copian de la demo**: Buteco
tiene su propio número de WhatsApp, su base y sus tokens. Las claves están en
cada `.env.example`; la lista de lo que hay que crear está en la
[Fase 0](docs/plan.md#fase-0--separar-el-proyecto).
