import 'server-only';

/**
 * Cliente HTTP del backend central (server-only).
 *
 * El backend central es el dueño del negocio: catálogo, pedidos, pagos y caja.
 * Es lo mismo que edita y ve el POS. Cuando está configurado, el agente deja de
 * leer su propia tabla `menu_items` y de crear pedidos por su cuenta, y pasa a
 * ser un cliente más de esa API (ver `apps/backend/docs/gateway-integration.md`).
 *
 * ── Por qué no pasa por `getServerEnv` ──────────────────────────────────────
 *
 * Ese esquema exige Supabase, Kapso y el resto. El menú público solo necesita
 * estas dos variables, y debe poder abrirse aunque lo demás no esté: es lo que
 * permite enseñar una demo sin WhatsApp conectado.
 *
 * El token es el del api_client `whatsapp-gateway` y no vence: nunca sale de
 * este módulo, ni a un log ni al navegador.
 */

const DEFAULT_TIMEOUT_MS = 8000;

export interface CentralConfig {
  baseUrl: string;
  token: string;
}

/** La configuración del backend central, o `null` si no está activado. */
export function centralConfig(): CentralConfig | null {
  const baseUrl = process.env.CENTRAL_API_BASE_URL?.trim().replace(/\/+$/, '');
  const token = process.env.CENTRAL_API_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

/** ¿El catálogo y los pedidos van por el backend central? */
export function isCentralEnabled(): boolean {
  return centralConfig() !== null;
}

/** Error de negocio o de transporte del backend central. Nunca lleva el token. */
export class CentralApiError extends Error {
  constructor(
    readonly status: number,
    /** `code` del backend (`product_unavailable`, `closed`…) o uno propio de transporte. */
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'CentralApiError';
  }
}

export interface CentralResponse<T> {
  status: number;
  body: T;
}

export interface CentralRequestInit {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Se inyecta en pruebas. */
  fetchImpl?: typeof fetch;
  config?: CentralConfig;
}

function requireConfig(config?: CentralConfig): CentralConfig {
  const resolved = config ?? centralConfig();
  if (!resolved) {
    throw new CentralApiError(0, 'central_not_configured', 'El backend central no está configurado.');
  }
  return resolved;
}

/** Llama al backend central y devuelve el cuerpo JSON junto con el estado HTTP. */
export async function centralRequest<T>(
  path: string,
  init: CentralRequestInit = {},
): Promise<CentralResponse<T>> {
  const { baseUrl, token } = requireConfig(init.config);
  const doFetch = init.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      // El catálogo cambia desde el POS en cualquier momento: nunca de caché.
      cache: 'no-store',
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new CentralApiError(
      0,
      timedOut ? 'central_timeout' : 'central_unreachable',
      timedOut ? 'El backend central no respondió a tiempo.' : 'No se pudo conectar con el backend central.',
    );
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const errorBody = (parsed ?? {}) as { code?: unknown; message?: unknown; details?: unknown };
    // Los 400 de validación traen `message` como lista de textos.
    const message = Array.isArray(errorBody.message)
      ? errorBody.message.join('; ')
      : typeof errorBody.message === 'string'
        ? errorBody.message
        : `El backend central respondió ${response.status}.`;
    throw new CentralApiError(
      response.status,
      typeof errorBody.code === 'string' ? errorBody.code : 'central_http_error',
      message,
      errorBody.details ?? null,
    );
  }

  return { status: response.status, body: parsed as T };
}

/** Pide un archivo (la foto de un producto) con el mismo token de servicio. */
export async function centralFetchFile(
  path: string,
  init: Pick<CentralRequestInit, 'timeoutMs' | 'fetchImpl' | 'config'> = {},
): Promise<Response> {
  const { baseUrl, token } = requireConfig(init.config);
  return (init.fetchImpl ?? fetch)(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
}
