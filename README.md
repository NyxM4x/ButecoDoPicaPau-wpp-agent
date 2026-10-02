# restaurant-demos

Plataforma para demos de restaurantes: un backend central, un agente de
WhatsApp (API oficial de WhatsApp) y un POS con caja, cocina y administración,
todo multi-restaurante mediante `restaurant_id`.

| Carpeta | Qué es | Stack |
|---|---|---|
| `apps/backend` | Backend central: catálogo, pedidos, pagos, caja | NestJS + PostgreSQL (Supabase) |
| `apps/agent-whatsapp` | Agente de IA para WhatsApp | Next.js + Supabase + Vitest |
| `apps/pos` | POS, cocina (KDS) y administración — **por construir** | — |
| `packages/` | Contratos y máquina de estados compartidos — **por construir** | — |
| `docs/` | Plan maestro, inventario, mapeo de datos y avance | — |

Empieza por `docs/CLAUDE_MONOREPO_CONTEXT.md` (arquitectura y fases) y
`docs/implementation-progress.md` (en qué quedamos).

Cada app tiene su propio `package.json` y `package-lock.json`: se instala y se
prueba dentro de su carpeta.

La base de datos de las demos es la de Supabase `gkhvijhcyysasofrukbr`.
`rgoesdoqmhlurpclacha` es la del backend central que usa el POS de producción:
solo lectura.
