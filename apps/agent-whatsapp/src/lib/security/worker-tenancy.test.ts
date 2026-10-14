import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * PRUEBA ARQUITECTÓNICA DEL REPOSITORIO — quién despierta al agente.
 *
 * El agente corre en Vercel y solo trabaja cuando lo llaman. Cuatro rutas
 * internas reintentan lo que quedó pendiente, y alguien tiene que llamarlas
 * cada minuto.
 *
 * ── Por qué ya no hay ningún Worker ─────────────────────────────────────────
 *
 * En la demo de la que nació este repositorio las llamaba un Worker de
 * Cloudflare, en una cuenta compartida con otros restaurantes del mismo
 * operador. Esa cuenta no es de este proyecto, y un `wrangler deploy` desde
 * aquí podía pisar el Worker de otro (dos proyectos con el mismo `name` son el
 * mismo Worker). Desde el 2026-10-13 las despierta el propio backend
 * (`apps/backend/src/agent-wake`): este proyecto no usa Cloudflare.
 *
 * Esta prueba impide las dos formas de romper eso: que alguien vuelva a meter
 * la configuración de un Worker, y que el backend despierte una ruta que el
 * agente no tiene.
 */

const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPO_ROOT = path.resolve(AGENT_ROOT, '..', '..');
const IGNORED_DIRS = new Set(['node_modules', '.next', '.git', '.local', 'dist', 'storage']);

/** Todos los archivos del repositorio, sin lo generado ni lo instalado. */
function repoFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (IGNORED_DIRS.has(name)) return [];
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? repoFiles(full) : [full];
  });
}

describe('este proyecto no usa Cloudflare', () => {
  const files = repoFiles(REPO_ROOT);
  const relative = (file: string) => path.relative(REPO_ROOT, file).replace(/\\/g, '/');

  it('no hay configuración de ningún Worker en el repositorio', () => {
    const workers = files.filter((file) => /(^|[\\/])wrangler\.(jsonc?|toml)$/.test(file)).map(relative);
    expect(workers).toEqual([]);
  });

  it('no queda ninguna carpeta `cloudflare/`', () => {
    const inside = files.filter((file) => /[\\/]cloudflare[\\/]/.test(file)).map(relative);
    expect(inside).toEqual([]);
  });

  it('ningún package.json depende de `wrangler`', () => {
    const offenders = files
      .filter((file) => path.basename(file) === 'package.json')
      .filter((file) => {
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string> | undefined>;
        return ['dependencies', 'devDependencies'].some((key) => pkg[key] && 'wrangler' in pkg[key]!);
      })
      .map(relative);
    expect(offenders).toEqual([]);
  });
});

describe('el backend despierta rutas que el agente sí tiene', () => {
  const wakeSource = path.join(REPO_ROOT, 'apps', 'backend', 'src', 'agent-wake', 'agent-wake.ts');

  /** Las rutas que llama el despertador, leídas de su código. */
  function wokenPaths(): string[] {
    const source = readFileSync(wakeSource, 'utf8');
    return [...source.matchAll(/path:\s*'(\/internal\/[^']+)'/g)].map((match) => match[1]);
  }

  it('son exactamente las cuatro de recuperación', () => {
    expect(wokenPaths().sort()).toEqual([
      '/internal/order-notifications/worker/tick',
      '/internal/orders/expiry/worker/tick',
      '/internal/telegram-alerts/worker/tick',
      '/internal/webhook-events/worker/tick',
    ]);
  });

  it('cada una existe en la app, y responde a POST', () => {
    for (const wokenPath of wokenPaths()) {
      // El gateway del agente es `<agente>/api`: `/internal/x` es `src/app/api/internal/x/route.ts`.
      const route = path.join(AGENT_ROOT, 'src', 'app', 'api', ...wokenPath.split('/').filter(Boolean), 'route.ts');
      expect(existsSync(route), `${wokenPath} no existe en la app`).toBe(true);
      expect(readFileSync(route, 'utf8'), wokenPath).toMatch(/export async function POST\(/);
    }
  });
});
