import { wakeAgent } from './agent-wake';

/** Un agente falso: responde por ruta. */
function fakeAgent(byPath: Record<string, () => Promise<Response> | Response> = {}) {
  const calls: Array<{ url: string; method?: string; authorization: string | null }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    const path = String(url).replace('https://agente.test/api', '');
    const handler = byPath[path];
    return handler ? handler() : Response.json({ ok: true });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const input = { baseUrl: 'https://agente.test/api/', token: 'secreto-interno' };

describe('wakeAgent (el despertador del agente)', () => {
  it('llama por POST a las cuatro rutas internas, con el token del agente', async () => {
    const { fetchImpl, calls } = fakeAgent();

    const results = await wakeAgent({ ...input, fetchImpl });

    expect(calls.map((call) => call.url).sort()).toEqual([
      'https://agente.test/api/internal/order-notifications/worker/tick',
      'https://agente.test/api/internal/orders/expiry/worker/tick',
      'https://agente.test/api/internal/telegram-alerts/worker/tick',
      'https://agente.test/api/internal/webhook-events/worker/tick',
    ]);
    expect(calls.every((call) => call.method === 'POST')).toBe(true);
    expect(calls.every((call) => call.authorization === 'Bearer secreto-interno')).toBe(true);
    expect(results).toHaveLength(4);
    expect(results.every((result) => result.ok && result.status === 200)).toBe(true);
  });

  it('que una ruta falle no impide que las otras tres corran', async () => {
    const { fetchImpl } = fakeAgent({
      '/internal/webhook-events/worker/tick': () => new Response('boom', { status: 500 }),
      '/internal/telegram-alerts/worker/tick': () => {
        throw new TypeError('fetch failed');
      },
    });

    const results = await wakeAgent({ ...input, fetchImpl });
    const byName = Object.fromEntries(results.map((result) => [result.name, result]));

    expect(byName.webhook_events).toEqual({
      name: 'webhook_events',
      ok: false,
      status: 500,
      error: 'http_500',
    });
    expect(byName.telegram_alerts).toEqual({
      name: 'telegram_alerts',
      ok: false,
      status: 0,
      error: 'unreachable',
    });
    expect(byName.order_notifications.ok).toBe(true);
    expect(byName.order_expiry.ok).toBe(true);
  });

  it('una ruta que no responde a tiempo es un timeout, no un cuelgue', async () => {
    const { fetchImpl } = fakeAgent({
      '/internal/orders/expiry/worker/tick': () =>
        new Promise<Response>((_resolve, reject) => {
          const error = new Error('se agotó el tiempo');
          error.name = 'TimeoutError';
          setTimeout(() => reject(error), 5);
        }),
    });

    const results = await wakeAgent({ ...input, fetchImpl, timeoutMs: 1000 });

    expect(results.find((result) => result.name === 'order_expiry')).toEqual({
      name: 'order_expiry',
      ok: false,
      status: 0,
      error: 'timeout',
    });
  });

  it('nunca devuelve el cuerpo de la respuesta: puede traer datos de clientes', async () => {
    const { fetchImpl } = fakeAgent({
      '/internal/webhook-events/worker/tick': () =>
        new Response('{"phone":"+59170010001","error":"detalle interno"}', { status: 502 }),
    });

    const results = await wakeAgent({ ...input, fetchImpl });

    expect(JSON.stringify(results)).not.toContain('59170010001');
    expect(JSON.stringify(results)).not.toContain('detalle interno');
  });
});
