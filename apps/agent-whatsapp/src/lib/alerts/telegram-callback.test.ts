import { describe, expect, it, vi } from 'vitest';
import {
  answerTelegramCallback,
  buttonsFitTelegram,
  editTelegramMessage,
  sendTelegramWithButtons,
} from './telegram-buttons';
import { handleTelegramWebhook, TELEGRAM_SECRET_HEADER, type TelegramCallbackDeps } from './telegram-callback';

const ID = '11111111-1111-4111-8111-111111111111';
const READY = `orders/${ID}/staff/ready`;
const DELIVERED = `orders/${ID}/staff/delivered`;
const CHAT = '-1001234567890';

// ── El webhook: un toque del personal ───────────────────────────────────────

function deps(over: Partial<TelegramCallbackDeps> = {}): TelegramCallbackDeps {
  return {
    webhookSecret: 'secreto-telegram',
    chatId: CHAT,
    runAction: vi.fn(async () => ({
      ok: true as const,
      text: 'PEDIDO ORD-000123\n\n➡️ LISTO · Juan · 21:05',
      buttons: [{ label: '📦 Entregado', action: DELIVERED }],
    })),
    edit: vi.fn(async () => true),
    answer: vi.fn(async () => undefined),
    ...over,
  };
}

function tap(data: string, options: { secret?: string | null; chatId?: string | number; from?: unknown } = {}): Request {
  const secret = options.secret === undefined ? 'secreto-telegram' : options.secret;
  return new Request('https://agente.test/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { [TELEGRAM_SECRET_HEADER]: secret } : {}) },
    body: JSON.stringify({
      update_id: 1,
      callback_query: {
        id: 'cb-1',
        from: options.from ?? { id: 7, first_name: 'Juan', last_name: 'Pérez', username: 'juanp' },
        message: { message_id: 42, chat: { id: options.chatId ?? Number(CHAT) } },
        data,
      },
    }),
  });
}

describe('webhook de Telegram: el personal toca un botón', () => {
  it('entrega la acción al POS, reemplaza el aviso y contesta el toque', async () => {
    const d = deps();
    const response = await handleTelegramWebhook(tap(READY), d);

    expect(response.status).toBe(200);
    expect(d.runAction).toHaveBeenCalledWith(READY, 'Juan Pérez');
    // El mensaje queda con el aviso que devolvió el POS y solo los botones que faltan.
    expect(d.edit).toHaveBeenCalledWith(42, 'PEDIDO ORD-000123\n\n➡️ LISTO · Juan · 21:05', [
      { label: '📦 Entregado', action: DELIVERED },
    ]);
    expect(d.answer).toHaveBeenCalledWith('cb-1', 'Hecho ✔');
  });

  it('sin el secreto, con uno equivocado o sin secreto configurado: 401 y no se toca nada', async () => {
    for (const [request, d] of [
      [tap(READY, { secret: null }), deps()],
      [tap(READY, { secret: 'otro' }), deps()],
      // Una variable olvidada no puede dejar el webhook abierto.
      [tap(READY), deps({ webhookSecret: undefined })],
    ] as const) {
      const response = await handleTelegramWebhook(request, d);
      expect(response.status).toBe(401);
      expect(d.runAction).not.toHaveBeenCalled();
      expect(d.edit).not.toHaveBeenCalled();
    }
  });

  it('un toque desde otro chat no mueve ningún pedido', async () => {
    const d = deps();
    const response = await handleTelegramWebhook(tap(READY, { chatId: -100999 }), d);
    expect(response.status).toBe(200);
    expect(d.runAction).not.toHaveBeenCalled();
    expect(d.answer).toHaveBeenCalledWith('cb-1', expect.stringContaining('grupo del personal'), true);
  });

  it('si el POS dice que no, se le explica a quien tocó y el aviso no cambia', async () => {
    const casos = [
      ['invalid_state_transition', 'ya no admite'],
      ['order_not_firm', 'todavía no está confirmado'],
      ['not_found', 'ya no existe'],
      ['central_unreachable', 'Intenta de nuevo'],
    ] as const;
    for (const [code, texto] of casos) {
      const d = deps({ runAction: vi.fn(async () => ({ ok: false as const, code })) });
      const response = await handleTelegramWebhook(tap(READY), d);
      // 200 siempre: un error HTTP haría que Telegram reintente el toque durante horas.
      expect(response.status, code).toBe(200);
      expect(d.edit).not.toHaveBeenCalled();
      expect(d.answer).toHaveBeenCalledWith('cb-1', expect.stringContaining(texto), true);
    }
  });

  it('lo que no es un toque de botón se ignora con 200', async () => {
    const d = deps();
    const mensaje = new Request('https://agente.test/api/telegram/webhook', {
      method: 'POST',
      headers: { [TELEGRAM_SECRET_HEADER]: 'secreto-telegram' },
      body: JSON.stringify({ update_id: 2, message: { text: 'hola', chat: { id: Number(CHAT) } } }),
    });
    expect((await handleTelegramWebhook(mensaje, d)).status).toBe(200);

    const roto = new Request('https://agente.test/api/telegram/webhook', {
      method: 'POST',
      headers: { [TELEGRAM_SECRET_HEADER]: 'secreto-telegram' },
      body: 'esto no es json',
    });
    expect((await handleTelegramWebhook(roto, d)).status).toBe(200);
    expect(d.runAction).not.toHaveBeenCalled();
  });

  it('quien no tiene nombre en Telegram queda registrado por su usuario', async () => {
    const d = deps();
    await handleTelegramWebhook(tap(READY, { from: { id: 7, username: 'cocina_buteco' } }), d);
    expect(d.runAction).toHaveBeenCalledWith(READY, 'cocina_buteco');
  });
});

// ── Las llamadas a la API de Telegram ───────────────────────────────────────

describe('API de Telegram para botones', () => {
  function fakeTelegram(result: unknown = { ok: true, result: { message_id: 42 } }, status = 200) {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json(result, { status });
    }) as typeof fetch;
    return { config: { botToken: 'TOKEN', chatId: CHAT, fetchImpl, baseUrl: 'https://tg.test' }, calls };
  }
  const buttons = [
    { label: '✅ Listo', action: READY },
    { label: '📦 Entregado', action: DELIVERED },
  ];

  it('manda el mensaje con una fila de botones y devuelve su id', async () => {
    const { config, calls } = fakeTelegram();
    expect(await sendTelegramWithButtons(config, 'PEDIDO', buttons)).toBe('42');
    expect(calls[0].url).toBe('https://tg.test/botTOKEN/sendMessage');
    expect(calls[0].body).toMatchObject({
      chat_id: CHAT,
      text: 'PEDIDO',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Listo', callback_data: READY },
            { text: '📦 Entregado', callback_data: DELIVERED },
          ],
        ],
      },
    });
  });

  it('reemplaza el mensaje; sin botones lo deja solo con el texto', async () => {
    const { config, calls } = fakeTelegram();
    expect(await editTelegramMessage(config, 42, 'ENTREGADO', [])).toBe(true);
    expect(calls[0].url).toBe('https://tg.test/botTOKEN/editMessageText');
    expect(calls[0].body).toMatchObject({ message_id: 42, text: 'ENTREGADO', reply_markup: { inline_keyboard: [] } });
  });

  it('contesta el toque, como aviso o como ventana de error', async () => {
    const { config, calls } = fakeTelegram();
    await answerTelegramCallback(config, 'cb-1', 'Hecho ✔');
    await answerTelegramCallback(config, 'cb-2', 'No se pudo', true);
    expect(calls[0].body).toEqual({ callback_query_id: 'cb-1', text: 'Hecho ✔', show_alert: false });
    expect(calls[1].body).toMatchObject({ callback_query_id: 'cb-2', show_alert: true });
  });

  it('un rechazo de Telegram o un corte de red no lanzan', async () => {
    const rechazado = fakeTelegram({ ok: false, description: 'chat not found' }, 400);
    expect(await sendTelegramWithButtons(rechazado.config, 'x', buttons)).toBeNull();
    expect(await editTelegramMessage(rechazado.config, 1, 'x', [])).toBe(false);

    const caido = { botToken: 'TOKEN', chatId: CHAT, fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch };
    expect(await sendTelegramWithButtons(caido, 'x', buttons)).toBeNull();
  });

  it('las acciones del contrato caben en un botón (64 bytes)', () => {
    expect(buttonsFitTelegram(buttons)).toBe(true);
    expect(buttonsFitTelegram([{ label: 'x', action: 'a'.repeat(65) }])).toBe(false);
  });
});
