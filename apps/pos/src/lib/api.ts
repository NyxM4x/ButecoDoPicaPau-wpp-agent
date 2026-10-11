import { useSession } from './session';

const BASE_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

/** Error del backend ya normalizado: `message` siempre es un string. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * El backend responde `{code, message, details}`, salvo en los 400 de
 * class-validator, donde `message` es un arreglo. Aquí se deja una sola forma.
 */
export function normalizeError(status: number, body: unknown): ApiError {
  if (body && typeof body === 'object') {
    const { code, message, details } = body as { code?: unknown; message?: unknown; details?: unknown };
    const text = Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : '';
    return new ApiError(status, typeof code === 'string' ? code : 'http_error', text || `Error ${status}`, details ?? null);
  }
  return new ApiError(status, 'http_error', typeof body === 'string' && body ? body : `Error ${status}`);
}

interface RequestOptions {
  body?: unknown;
  /** Cuerpo ya serializado: se reusa tal cual en los reintentos idempotentes. */
  rawBody?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ApiResult<T> {
  status: number;
  data: T;
}

async function send(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
  const { token, logout } = useSession.getState();
  const payload = options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal: options.signal,
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      body: payload,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network_error', 'No se pudo conectar con el servidor.');
  }

  // El backend no distingue «vencido» de «inválido»: cualquier 401 con sesión
  // abierta manda de vuelta al login.
  if (response.status === 401 && token && path !== '/auth/login') logout();
  return response;
}

export async function requestWithStatus<T>(method: string, path: string, options?: RequestOptions): Promise<ApiResult<T>> {
  const response = await send(method, path, options);
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) throw normalizeError(response.status, parsed);
  return { status: response.status, data: parsed as T };
}

export async function request<T>(method: string, path: string, options?: RequestOptions): Promise<T> {
  return (await requestWithStatus<T>(method, path, options)).data;
}

/** Fotos y QR: se piden con el mismo `Authorization`, porque `<img src>` no manda cabeceras. */
export async function fetchBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const response = await send('GET', path, { signal });
  if (!response.ok) throw normalizeError(response.status, null);
  return response.blob();
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
};

/** Texto para el operador según el `code`; `message` del backend no está pensado para mostrarse. */
const MESSAGES: Record<string, string> = {
  network_error: 'No hay conexión con el servidor. Revisa la red e intenta de nuevo.',
  invalid_credentials: 'Usuario o contraseña incorrectos.',
  cash_register_closed: 'No hay caja abierta. Abre la caja para poder cobrar.',
  cash_register_already_open: 'Ya hay una caja abierta.',
  cash_register_not_open: 'No hay ninguna caja abierta.',
  payment_required: 'Este pedido todavía no está pagado. Hay que cobrarlo antes de prepararlo.',
  product_unavailable: 'Un producto del pedido ya no está disponible. Se actualizó el menú.',
  promotion_unavailable: 'Una promoción del pedido cambió o ya no está disponible. Se actualizó el menú.',
  status_conflict: 'Otra pantalla ya movió este pedido. Se actualizó el tablero.',
  invalid_state_transition: 'Ese cambio de estado no está permitido.',
  product_code_taken: 'Ya existe un producto con ese código.',
  username_taken: 'Ese nombre de usuario ya existe.',
  orders_paused: 'Los pedidos están en pausa.',
  not_found: 'No se encontró lo que buscabas.',
  internal_error: 'El servidor tuvo un problema. Intenta de nuevo.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Tu usuario no tiene permiso para esto.';
    return MESSAGES[error.code] ?? error.message;
  }
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
}

export function isApiError(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}
