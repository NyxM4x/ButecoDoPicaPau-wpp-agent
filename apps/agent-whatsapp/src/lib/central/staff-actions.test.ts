import { describe, expect, it, vi } from 'vitest';
import { handleGatewayTelegramAlert, type GatewayDeps } from './gateway';
import type { CentralRequestFn } from './orders';
import { isStaffAction, runCentralStaffAction } from './staff-actions';

const ID = '11111111-1111-4111-8111-111111111111';
const READY = `orders/${ID}/staff/ready`;
const DELIVERED = `orders/${ID}/staff/delivered`;

// ── La acción hacia el POS ──────────────────────────────────────────────────

describe('acciones del personal → POS', () => {
  it('solo acepta las tres acciones del contrato', () => {
    expect(isStaffAction(READY)).toBe(true);
    expect(isStaffAction(`orders/${ID}/staff/out`)).toBe(true);
    expect(isStaffAction(DELIVERED)).toBe(true);
    for (const falsa of [
      `orders/${ID}/cash/confirm`,
      `orders/${ID}/staff/ready/../../../auth/users`,
      `orders/no-es-uuid/staff/ready`,
      `late-order-requests/${ID}/accept`,
      `/orders/${ID}/staff/ready`,
      `orders/${ID}/staff/ready?x=1`,
      '',
    ]) {
      expect(isStaffAction(falsa), falsa).toBe(false);
    }
  });

  it('llama por POST a la ruta del botón, con quién lo tocó', async () => {
    const calls: Array<{ path: string; init?: { method?: string; body?: unknown } }> = [];
    const request = (async (path: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ path, init });
      return { status: 200, body: { text: 'aviso', buttons: [{ label: '📦 Entregado', action: DELIVERED }] } };
    }) as CentralRequestFn;

    const outcome = await runCentralStaffAction({ action: READY, actor: 'Juan' }, { request });

    expect(calls).toEqual([{ path: `/${READY}`, init: { method: 'POST', body: { actor: 'Juan' } } }]);
    expect(outcome).toEqual({ ok: true, text: 'aviso', buttons: [{ label: '📦 Entregado', action: DELIVERED }] });
  });

  it('una acción que no es del contrato no llega al POS', async () => {
    const request = vi.fn() as unknown as CentralRequestFn;
    const outcome = await runCentralStaffAction({ action: `orders/${ID}/cash/confirm`, actor: null }, { request });
    expect(outcome).toEqual({ ok: false, code: 'unknown_action' });
    expect(request).not.toHaveBeenCalled();
  });

  it('nunca lanza: el rechazo del POS vuelve como su código', async () => {
    const request = (async () => {
      throw Object.assign(new Error('no'), { status: 409, code: 'order_not_firm' });
    }) as CentralRequestFn;
    expect(await runCentralStaffAction({ action: READY, actor: null }, { request })).toEqual({
      ok: false,
      code: 'order_not_firm',
    });
  });

  it('descarta los botones que el POS devuelva y no sean del contrato', async () => {
    const request = (async () => ({
      status: 200,
      body: { text: 'aviso', buttons: [{ label: 'Borrar todo', action: 'auth/users' }, { label: '📦 Entregado', action: DELIVERED }] },
    })) as CentralRequestFn;
    const outcome = await runCentralStaffAction({ action: READY, actor: null }, { request });
    expect(outcome).toMatchObject({ ok: true, buttons: [{ label: '📦 Entregado', action: DELIVERED }] });
  });
});

// ── El gateway: cuándo un aviso sale con botones ────────────────────────────

function gatewayDeps(over: Partial<GatewayDeps> = {}): GatewayDeps {
  return {
    authToken: 'secreto',
    sendText: vi.fn(),
    sendImage: vi.fn(),
    sendButtons: vi.fn(),
    sendLocationRequest: vi.fn(),
    sendTelegram: vi.fn(async () => true),
    sendTelegramButtons: vi.fn(async () => '42'),
    ...over,
  } as GatewayDeps;
}

const alert = (body: unknown) =>
  new Request('https://agente.test/api/gateway/telegram/alerts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secreto' },
    body: JSON.stringify(body),
  });

describe('gateway: el aviso al personal con botones', () => {
  const buttons = [
    { label: '✅ Listo', action: READY },
    { label: '📦 Entregado', action: DELIVERED },
  ];

  it('las acciones del contrato salen como botones de verdad', async () => {
    const d = gatewayDeps();
    const response = await handleGatewayTelegramAlert(alert({ chatRef: 'staff-group', text: 'PEDIDO', buttons }), d);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ externalMessageId: 'tg-42' });
    expect(d.sendTelegramButtons).toHaveBeenCalledWith('PEDIDO', buttons);
    expect(d.sendTelegram).not.toHaveBeenCalled();
  });

  it('sin webhook de Telegram configurado, los botones van como texto', async () => {
    const d = gatewayDeps({ sendTelegramButtons: undefined });
    const response = await handleGatewayTelegramAlert(alert({ text: 'PEDIDO', buttons }), d);
    expect(response.status).toBe(200);
    expect(d.sendTelegram).toHaveBeenCalledWith(expect.stringContaining('PEDIDO'));
  });

  it('una acción que el agente no sabe ejecutar manda TODO el aviso como texto', async () => {
    const d = gatewayDeps();
    const mezclados = [...buttons, { label: 'Aceptar', action: `late-order-requests/${ID}/accept` }];
    await handleGatewayTelegramAlert(alert({ text: 'Solicitud', buttons: mezclados }), d);
    expect(d.sendTelegramButtons).not.toHaveBeenCalled();
    expect(d.sendTelegram).toHaveBeenCalledWith(expect.stringContaining('Resolver en el POS'));
  });

  it('si Telegram no acepta el mensaje con botones, responde 502 para que el POS reintente', async () => {
    const d = gatewayDeps({ sendTelegramButtons: vi.fn(async () => null) });
    const response = await handleGatewayTelegramAlert(alert({ text: 'PEDIDO', buttons }), d);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'telegram_send_failed' });
  });
});
