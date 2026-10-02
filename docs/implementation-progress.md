# Avance de implementación

Última actualización: 2026-10-02.

## Reorganización del 2026-10-02: repo nuevo `restaurant-demos`

El repo `NyxM4x/Demo_MonoRepoRestaurant` desapareció de GitHub (404), igual
que `rochayoan/backend-central-zarco-dev`. Se armó un repo nuevo, **privado**,
`NyxM4x/restaurant-demos`, **con historial limpio** (un commit inicial). El
historial anterior (359 commits) quedó en un `.zip` local en `DEMO_RESTAURANT/`.

Qué entró:

- `apps/backend` ← árbol de `33a9da7` (igual que en el monorepo viejo).
- `apps/agent-whatsapp` ← `NyxM4x/sarcoRestaurant` @ `main` **`5cb2943`**
  (2026-09-28). Trae 5 commits más que `420b8ef`: efectivo apagado (solo QR)
  y «hoy no atendemos» con la pausa. Lo de «solo QR» debe volverse una opción
  por restaurante.
- `docs/` y `docs/CLAUDE_MONOREPO_CONTEXT.md` (el plan maestro, que antes
  estaba fuera de git).

Qué quedó afuera a propósito:

- `apps/backend/postman/`: tenía `adminPassword` y `posToken`.
- `apps/backend/Api Market Baneco v1.0.0.pdf`: documentación del banco.
- `apps/backend/fotos_*`: el código no las usa.
- `apps/backend/.github/`: los workflows corrían sobre `feat/sarco-integration`
  y en una subcarpeta GitHub no los ejecuta.
- `apps/agent-whatsapp/READMEZARCOV01.md`: específico de Zarco.

`apps/backend/.env` no se copió: hay que copiarlo a mano desde el respaldo.

## Fase actual

**Fase 0 (inventario): terminada.** El monorepo local está creado. La
**Fase 1 (contratos)** está lista para empezar, pero depende de dos decisiones
pendientes (ver abajo).

## Tareas completadas

- Inventario técnico de backend y agente → `docs/repository-inventory.md`.
- Matriz de equivalencias y 17 conflictos → `docs/data-mapping.md`.
- Propuesta de contrato canónico → `docs/canonical-contract-proposal.md`.
- Monorepo local `Demo_MonoRepoRestaurant` (rama `main`) con historial importado
  mediante `git subtree`:
  - `apps/backend` ← `rochayoan/backend-central-zarco-dev` @ `feat/sarco-integration` (`33a9da7`).
  - `apps/agent-whatsapp` ← `NyxM4x/sarcoRestaurant` @ `main` (`420b8ef`).
- Remote configurado: `github.com/NyxM4x/Demo_MonoRepoRestaurant` (ya
  **privado**). `main` subida el 2026-09-24.
- `apps/backend/.env` creado por el usuario (ignorado por git): `DATABASE_URL`
  (pooler de transacciones, puerto 6543) y `DIRECT_URL` (sesión, puerto 5432),
  ambos hacia `gkhvijhcyysasofrukbr`. Las migraciones deben usar `DIRECT_URL`.

## Archivos modificados

Solo archivos nuevos: `.gitignore` y `docs/*.md`. No se cambió ni una línea de
`apps/backend` ni de `apps/agent-whatsapp` respecto de su origen. Los repos
originales en `DEMO_RESTAURANT/` quedaron intactos.

## Tests ejecutados

Línea base de `apps/backend` sin cambios (2026-09-24, tras `npm ci`):

| Comando | Resultado |
|---|---|
| `npx jest` (unitarios) | 25 suites, **105 tests pasan** |
| `npm run build` | compila sin errores |
| `npm run test:e2e` | no ejecutado: usa base de datos real |
| `npx eslint`, `npx tsc --noEmit` | pendiente |
| `apps/agent-whatsapp` | pendiente: sin dependencias instaladas |

Entorno: Node v24.21.0, npm 11.19.0. Permisos de Claude Code para jest, vitest,
tsc, eslint y build ya autorizados por el usuario.

## Errores pendientes

Ninguno de código. Riesgos abiertos:

- `apps/backend` incluye el manual de la API de Baneco (PDF) y una colección de
  Postman con variables `adminPassword`, `posToken` y `jwtToken`. El repo ya es
  privado; si alguna vez se hace público, sacarlos antes del historial.
- `CLIENTES/SasS_Restaurante/restauranteAI/.git/config` tiene un token de GitHub
  incrustado en el remote (fuera de este proyecto).

## Migraciones aplicadas

Ninguna. Bases de datos:

| Ref de Supabase | Qué es | Uso permitido |
|---|---|---|
| `rgoesdoqmhlurpclacha` | base del backend central que usa el POS (según el usuario) | **solo lectura**, sin confirmar si es producción |
| `gkhvijhcyysasofrukbr` | base nueva para el monorepo y las demos | migraciones y seeds desde la Fase 2 |

Para migrar hace falta la cadena de conexión Postgres (`DATABASE_URL`), no la
URL REST.

## Decisiones necesarias

1. **POS frontend:** no está en `backend-central-zarco-dev` (ese repo solo
   tiene el backend NestJS). Hace falta el repo o la carpeta del frontend
   (Vite + React), o decidir construirlo desde cero en `apps/pos`.
2. Conflictos C3 (número de pedido), C5 (efectivo histórico), C8 (extras
   históricos) y C13 (un solo cambio de pedido) → `docs/data-mapping.md` §9.
   Mientras no haya respuesta, la Fase 1 usa las propuestas del documento como
   valores por defecto.
3. Upstream de producción `julico155/backend-central-zarco` (`master` =
   `f576967`): falta compararlo con `af20b02` para saber si tiene cambios que no
   están en el fork.

## Próxima sesión: por dónde seguir

1. **Fase 1:** crear `packages/contracts` (enums, entidades y códigos de error
   de `docs/canonical-contract-proposal.md`) y `packages/state-machine`
   (transiciones de pedido y de pago, guardas por rol, cierre de caja,
   modificación única), con pruebas en vitest. Sin base de datos.
2. Instalar dependencias de `apps/agent-whatsapp` y medir su línea base
   (`npm test`, `npm run build`, `npm run lint`).
3. Completar la línea base del backend con `eslint` y `tsc --noEmit`.
4. Comparar el upstream `julico155/backend-central-zarco` con el fork (solo
   lectura).
5. Las decisiones de arriba siguen abiertas; mientras tanto se usan las
   propuestas de `docs/data-mapping.md` y cada choque se reporta aquí.
