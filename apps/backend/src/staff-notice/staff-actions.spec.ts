import { OrdersService } from '../orders/orders.service';
import {
  customerNoticeFor,
  decideStaffAction,
  staffButtonsFor,
  staffStatusLine,
} from './staff-actions';

const ID = '11111111-1111-4111-8111-111111111111';

/** Un pedido firme en efectivo: el cliente ya tocó CONFIRMAR. */
const firm = {
  status: 'confirmed' as const,
  delivery_type: 'delivery' as const,
  payment_method: 'cash',
  payment_status: 'paid',
  cash_confirmed_at: new Date(),
};

describe('staffButtonsFor (qué botones lleva el aviso)', () => {
  const labels = (status: never, delivery_type: never) =>
    staffButtonsFor({ id: ID, status, delivery_type }).map((button) => button.label);

  it('un envío recién confirmado ofrece los tres pasos', () => {
    const buttons = staffButtonsFor({ id: ID, status: 'confirmed', delivery_type: 'delivery' });
    expect(buttons).toEqual([
      { label: '✅ Listo', action: `orders/${ID}/staff/ready` },
      { label: '🛵 Salió', action: `orders/${ID}/staff/out` },
      { label: '📦 Entregado', action: `orders/${ID}/staff/delivered` },
    ]);
  });

  it('un pedido para retirar no sale a reparto', () => {
    expect(labels('confirmed' as never, 'pickup' as never)).toEqual(['✅ Listo', '📦 Entregado']);
  });

  it('solo quedan los pasos que faltan', () => {
    expect(labels('ready' as never, 'delivery' as never)).toEqual(['🛵 Salió', '📦 Entregado']);
    expect(labels('out_for_delivery' as never, 'delivery' as never)).toEqual(['📦 Entregado']);
    expect(labels('ready' as never, 'pickup' as never)).toEqual(['📦 Entregado']);
  });

  it('un pedido cerrado, cancelado o sin confirmar no ofrece ninguno', () => {
    expect(labels('delivered' as never, 'delivery' as never)).toEqual([]);
    expect(labels('cancelled' as never, 'delivery' as never)).toEqual([]);
    expect(labels('awaiting_location' as never, 'delivery' as never)).toEqual([]);
  });

  it('la acción cabe en un botón de Telegram (64 bytes)', () => {
    for (const button of staffButtonsFor({
      id: ID,
      status: 'confirmed',
      delivery_type: 'delivery',
    })) {
      expect(Buffer.byteLength(button.action)).toBeLessThanOrEqual(64);
    }
  });
});

describe('decideStaffAction (qué pasa al tocar un botón)', () => {
  it('avanza al estado del botón', () => {
    expect(decideStaffAction(firm, 'ready')).toEqual({
      kind: 'advance',
      from: 'confirmed',
      to: 'ready',
    });
    expect(decideStaffAction(firm, 'out')).toEqual({
      kind: 'advance',
      from: 'confirmed',
      to: 'out_for_delivery',
    });
  });

  it('se puede saltar pasos: de confirmado a entregado', () => {
    expect(decideStaffAction(firm, 'delivered')).toEqual({
      kind: 'advance',
      from: 'confirmed',
      to: 'delivered',
    });
  });

  it('tocar dos veces, o un paso que ya quedó atrás, no hace nada y no es un error', () => {
    expect(decideStaffAction({ ...firm, status: 'ready' }, 'ready')).toEqual({ kind: 'noop' });
    expect(decideStaffAction({ ...firm, status: 'out_for_delivery' }, 'ready')).toEqual({
      kind: 'noop',
    });
    expect(decideStaffAction({ ...firm, status: 'delivered' }, 'delivered')).toEqual({
      kind: 'noop',
    });
  });

  it('un pedido para retirar no puede «salir»', () => {
    expect(decideStaffAction({ ...firm, delivery_type: 'pickup' }, 'out')).toMatchObject({
      kind: 'reject',
      code: 'invalid_state_transition',
    });
  });

  it('un pedido cancelado, o que todavía espera la ubicación, no se mueve', () => {
    for (const status of ['cancelled', 'awaiting_location', 'draft'] as const) {
      expect(decideStaffAction({ ...firm, status }, 'ready')).toMatchObject({
        kind: 'reject',
        code: 'invalid_state_transition',
      });
    }
  });

  it('un pedido que el cliente no confirmó ni pagó no se prepara', () => {
    const sinConfirmar = { ...firm, cash_confirmed_at: null, payment_status: 'unpaid' };
    expect(decideStaffAction(sinConfirmar, 'ready')).toMatchObject({
      kind: 'reject',
      code: 'order_not_firm',
    });

    const qrSinPagar = {
      ...firm,
      payment_method: 'qr',
      payment_status: 'unpaid',
      cash_confirmed_at: null,
    };
    expect(decideStaffAction(qrSinPagar, 'ready')).toMatchObject({
      kind: 'reject',
      code: 'order_not_firm',
    });

    const qrPagado = { ...qrSinPagar, payment_status: 'paid' };
    expect(decideStaffAction(qrPagado, 'ready').kind).toBe('advance');
  });
});

describe('lo que se le dice al cliente y al personal', () => {
  const base = { orderNumber: 'ORD-000123', farewell: null };

  it('«listo» depende de si lo retira o se lo llevan', () => {
    expect(customerNoticeFor({ ...base, to: 'ready', deliveryType: 'pickup' })).toBe(
      'Tu pedido ORD-000123 ya está listo 🙌 Puedes pasar a retirarlo.',
    );
    expect(customerNoticeFor({ ...base, to: 'ready', deliveryType: 'delivery' })).toContain(
      'sale en breve hacia tu dirección',
    );
  });

  it('«salió» avisa que va en camino', () => {
    expect(customerNoticeFor({ ...base, to: 'out_for_delivery', deliveryType: 'delivery' })).toBe(
      'Tu pedido ORD-000123 ya salió y va en camino 🛵',
    );
  });

  it('«entregado» solo manda la despedida propia del local, si la tiene', () => {
    expect(customerNoticeFor({ ...base, to: 'delivered', deliveryType: 'delivery' })).toBeNull();
    expect(
      customerNoticeFor({
        ...base,
        to: 'delivered',
        deliveryType: 'delivery',
        farewell: ' ¡Obrigado! ',
      }),
    ).toBe('¡Obrigado!');
  });

  it('la línea de estado dice qué pasó, quién y a qué hora del local', () => {
    const at = new Date('2026-10-14T01:05:00.000Z'); // 21:05 en La Paz
    expect(
      staffStatusLine({ status: 'ready', actor: 'Juan', at, timeZone: 'America/La_Paz' }),
    ).toBe('➡️ LISTO · Juan · 21:05');
    expect(
      staffStatusLine({ status: 'delivered', actor: null, at, timeZone: 'America/La_Paz' }),
    ).toBe('➡️ ENTREGADO · 21:05');
    // Recién confirmado nadie lo movió todavía: no hay nada que decir.
    expect(
      staffStatusLine({ status: 'confirmed', actor: null, at, timeZone: 'America/La_Paz' }),
    ).toBeNull();
  });
});

// ── El servicio: mover, avisar y devolver el aviso ──────────────────────────

const ORDER = {
  id: ID,
  order_number: 'ORD-000123',
  status: 'confirmed',
  delivery_type: 'pickup',
  payment_method: 'cash',
  payment_status: 'paid',
  cash_confirmed_at: new Date(),
  customer_id: 'cust-1',
  customer_name: 'María Flores',
  notes: null,
  delivery_latitude: null,
  delivery_longitude: null,
  delivery_distance_meters: null,
  subtotal_amount: '50.00',
  delivery_base_amount: '0.00',
  delivery_surcharge_amount: '0.00',
  total_amount: '50.00',
  status_updated_by: null,
  updated_at: new Date('2026-10-14T01:05:00.000Z'),
};
const SETTINGS = {
  requires_cash_register: false,
  currency_symbol: 'Bs',
  restaurant_timezone: 'America/La_Paz',
  farewell_message: null,
};

/**
 * Una base falsa con UN pedido en memoria: el `update` lo modifica de verdad,
 * así que el aviso que se devuelve refleja el estado nuevo.
 */
function harness(order: Record<string, unknown>, settings: Record<string, unknown> = SETTINGS) {
  const current = { ...order };
  const tables: Record<string, unknown> = {
    operational_settings: settings,
    order_items: [{ product_name_snapshot: 'Caipirinha', quantity: 2, subtotal: '50.00' }],
    order_promotions: [],
    customers: { phone: '+59170010001' },
  };
  const db = {
    selectFrom: jest.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'selectAll', 'where'])
        builder[method] = jest.fn(() => builder);
      const value = () => (table === 'orders' ? current : tables[table]);
      builder.executeTakeFirst = jest.fn(async () =>
        Array.isArray(value()) ? (value() as unknown[])[0] : value(),
      );
      builder.execute = jest.fn(async () => (Array.isArray(value()) ? value() : []));
      return builder;
    }),
    updateTable: jest.fn(() => {
      const builder: Record<string, unknown> = {};
      let values: Record<string, unknown> = {};
      builder.set = jest.fn((next: Record<string, unknown>) => {
        values = next;
        return builder;
      });
      builder.where = jest.fn(() => builder);
      builder.returning = jest.fn(() => builder);
      builder.executeTakeFirst = jest.fn(async () => {
        Object.assign(current, values);
        return { id: current.id };
      });
      return builder;
    }),
  };
  const notifyNow = jest.fn().mockResolvedValue(undefined);
  const orders = new OrdersService(
    db as never,
    {} as never,
    { getRow: jest.fn().mockResolvedValue(settings) } as never,
    {} as never,
    { notifyNow } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { orders, notifyNow, current };
}

describe('OrdersService.staffAction (un toque en Telegram)', () => {
  it('«Listo» mueve el pedido, avisa al cliente y devuelve el aviso con lo que falta', async () => {
    const { orders, notifyNow, current } = harness(ORDER);

    const notice = await orders.staffAction(ID, 'ready', 'Juan');

    expect(current.status).toBe('ready');
    expect(current.status_updated_by).toBe('telegram:Juan');
    expect(notifyNow).toHaveBeenCalledTimes(1);
    expect(notifyNow.mock.calls[0][0]).toMatchObject({
      channel: 'whatsapp',
      kind: 'order_ready_customer_notice',
      targetRef: ID,
      payload: {
        customerId: 'cust-1',
        text: 'Tu pedido ORD-000123 ya está listo 🙌 Puedes pasar a retirarlo.',
      },
    });
    expect(notice.text).toContain('🆕 PEDIDO ORD-000123');
    expect(notice.text).toMatch(/➡️ LISTO · Juan · \d\d:\d\d$/);
    expect(notice.buttons).toEqual([
      { label: '📦 Entregado', action: `orders/${ID}/staff/delivered` },
    ]);
  });

  it('un segundo toque no vuelve a avisar al cliente', async () => {
    const { orders, notifyNow } = harness({ ...ORDER, status: 'ready' });
    const notice = await orders.staffAction(ID, 'ready', 'Ana');
    expect(notifyNow).not.toHaveBeenCalled();
    expect(notice.buttons).toHaveLength(1);
  });

  it('«Entregado» cierra el pedido y deja el aviso sin botones', async () => {
    const { orders, notifyNow, current } = harness(ORDER);
    const notice = await orders.staffAction(ID, 'delivered', null);
    expect(current.status).toBe('delivered');
    // Sin despedida propia del local, al cliente no se le manda nada.
    expect(notifyNow).not.toHaveBeenCalled();
    expect(notice.buttons).toEqual([]);
    expect(notice.text).toContain('➡️ ENTREGADO');
  });

  it('con POS las acciones de Telegram están apagadas', async () => {
    const { orders, current } = harness(ORDER, { ...SETTINGS, requires_cash_register: true });
    await expect(orders.staffAction(ID, 'ready', 'Juan')).rejects.toMatchObject({
      code: 'staff_actions_disabled',
    });
    expect(current.status).toBe('confirmed');
  });

  it('un pedido que no es firme se rechaza sin tocarlo', async () => {
    const { orders, current, notifyNow } = harness({
      ...ORDER,
      cash_confirmed_at: null,
      payment_status: 'unpaid',
    });
    await expect(orders.staffAction(ID, 'ready', 'Juan')).rejects.toMatchObject({
      code: 'order_not_firm',
    });
    expect(current.status).toBe('confirmed');
    expect(notifyNow).not.toHaveBeenCalled();
  });
});
