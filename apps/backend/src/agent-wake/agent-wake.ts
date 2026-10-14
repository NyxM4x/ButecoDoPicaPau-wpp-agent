/**
 * El despertador del agente de WhatsApp.
 *
 * El agente corre en Vercel: solo trabaja cuando alguien lo llama. Cuatro de
 * sus tareas no nacen de un mensaje del cliente sino del paso del tiempo
 * —reintentar un mensaje entrante que quedó sin procesar, un aviso que no
 * salió, una alerta al personal, un pedido que venció—, y para eso expone
 * cuatro rutas internas que hay que llamar cada minuto.
 *
 * Antes las llamaba un Worker de Cloudflare, en una cuenta que es de otro
 * proyecto. Ahora las llama este backend, que ya está siempre encendido y ya
 * tiene tareas programadas: Buteco no depende de ninguna cuenta ajena.
 *
 * Módulo puro: recibe con qué llamar y devuelve qué pasó.
 */

/** Las cuatro tareas, con la ruta de cada una bajo la URL del gateway del agente. */
export const AGENT_WAKE_ROUTES = [
  /** Mensajes entrantes que quedaron sin procesar. */
  { name: 'webhook_events', path: '/internal/webhook-events/worker/tick' },
  /** Avisos al cliente que no llegaron a salir. */
  { name: 'order_notifications', path: '/internal/order-notifications/worker/tick' },
  /** Alertas al personal por Telegram pendientes. */
  { name: 'telegram_alerts', path: '/internal/telegram-alerts/worker/tick' },
  /** Pedidos y carritos vencidos del lado del agente. */
  { name: 'order_expiry', path: '/internal/orders/expiry/worker/tick' },
] as const;

export type AgentWakeRouteName = (typeof AGENT_WAKE_ROUTES)[number]['name'];

/**
 * Un turno del agente puede tardar más de diez segundos, y una pasada procesa
 * varios: se le da casi el minuto entero antes de darla por perdida.
 */
export const AGENT_WAKE_TIMEOUT_MS = 55_000;

export interface AgentWakeResult {
  name: AgentWakeRouteName;
  ok: boolean;
  /** Estado HTTP, o 0 si no hubo respuesta. */
  status: number;
  /** Solo en un fallo: `timeout`, `unreachable` o `http_<estado>`. Nunca el cuerpo. */
  error?: string;
}

export interface AgentWakeInput {
  /** URL del gateway del agente, la misma de `GATEWAY_BASE_URL` (`https://<agente>/api`). */
  baseUrl: string;
  /** El `INTERNAL_API_TOKEN` del agente. */
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Llama a las cuatro rutas EN PARALELO y espera a todas. NUNCA lanza.
 *
 * Cada una es su propia llamada, con su propio tiempo: que el inbox tarde no
 * puede impedir que salgan las alertas. Las cuatro son idempotentes del lado
 * del agente, así que una pasada repetida no duplica nada.
 */
export async function wakeAgent(input: AgentWakeInput): Promise<AgentWakeResult[]> {
  const doFetch = input.fetchImpl ?? fetch;
  const base = input.baseUrl.replace(/\/+$/, '');

  return Promise.all(
    AGENT_WAKE_ROUTES.map(async (route): Promise<AgentWakeResult> => {
      try {
        const response = await doFetch(`${base}${route.path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${input.token}` },
          signal: AbortSignal.timeout(input.timeoutMs ?? AGENT_WAKE_TIMEOUT_MS),
        });
        // El cuerpo se descarta: puede traer teléfonos o números de pedido, y
        // aquí solo interesa si la pasada corrió.
        await response.arrayBuffer().catch(() => undefined);
        return response.ok
          ? { name: route.name, ok: true, status: response.status }
          : {
              name: route.name,
              ok: false,
              status: response.status,
              error: `http_${response.status}`,
            };
      } catch (error) {
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        return {
          name: route.name,
          ok: false,
          status: 0,
          error: timedOut ? 'timeout' : 'unreachable',
        };
      }
    }),
  );
}
