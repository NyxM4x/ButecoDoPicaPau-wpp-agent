import { NotificationsOutService } from '../notifications-out/notifications-out.service';
import { notifyStaffOrderFirm, STAFF_ORDER_NOTICE_KIND } from './notify-order-firm';
import { mapsLink, staffOrderNoticeText, StaffOrderNoticeInput } from './staff-order-notice';

const base: StaffOrderNoticeInput = {
  orderNumber: 'ORD-000123',
  deliveryType: 'delivery',
  paymentMethod: 'cash',
  paid: false,
  customerName: 'María Flores',
  customerPhone: '+59170010001',
  lines: [
    { name: 'Caipirinha', quantity: 2, subtotal: 50 },
    {
      name: 'Combo pareja',
      quantity: 2,
      subtotal: 100,
      components: [
        { name: 'Feijoada', quantity: 1 },
        { name: 'Guaraná', quantity: 2 },
      ],
    },
  ],
  notes: ' sin cebolla ',
  latitude: -17.7812,
  longitude: -63.1795,
  deliveryDistanceMeters: 4080,
  subtotalAmount: 150,
  deliveryAmount: 18,
  totalAmount: 168,
  currencySymbol: 'Bs',
};

describe('staffOrderNoticeText (la comanda por Telegram)', () => {
  it('lleva todo lo que hace falta para preparar, entregar y cobrar', () => {
    expect(staffOrderNoticeText(base)).toBe(
      [
        '🆕 PEDIDO ORD-000123',
        'ENVÍO A DOMICILIO · EFECTIVO',
        '👤 María Flores — +59170010001',
        '',
        '• 2x Caipirinha — Bs 50.00',
        '• 2x Combo pareja — Bs 100.00',
        // Dos combos: las cantidades de adentro ya vienen multiplicadas.
        '     2x Feijoada',
        '     4x Guaraná',
        '📝 sin cebolla',
        '',
        '📍 https://www.google.com/maps?q=-17.7812,-63.1795 (4.1 km)',
        'Productos: Bs 150.00',
        'Envío: Bs 18.00',
        'TOTAL: Bs 168.00 — COBRAR al entregar',
      ].join('\n'),
    );
  });

  it('un pedido ya pagado por QR dice que NO se cobra', () => {
    const text = staffOrderNoticeText({ ...base, paymentMethod: 'qr', paid: true });
    expect(text).toContain('ENVÍO A DOMICILIO · QR (pagado)');
    expect(text).toContain('TOTAL: Bs 168.00 — YA PAGADO, no cobrar');
    expect(text).not.toContain('COBRAR al');
  });

  it('para retirar no hay ubicación ni envío, y se cobra al retirar', () => {
    const text = staffOrderNoticeText({
      ...base,
      deliveryType: 'pickup',
      latitude: null,
      longitude: null,
      deliveryAmount: 0,
      totalAmount: 150,
      notes: null,
    });
    expect(text).toContain('RETIRA EN EL LOCAL · EFECTIVO');
    expect(text).toContain('TOTAL: Bs 150.00 — COBRAR al retirar');
    expect(text).not.toContain('📍');
    expect(text).not.toContain('Envío:');
    expect(text).not.toContain('📝');
  });

  it('usa la moneda del restaurante', () => {
    const text = staffOrderNoticeText({ ...base, currencySymbol: 'R$' });
    expect(text).toContain('TOTAL: R$ 168.00');
    expect(text).not.toContain('Bs');
  });

  it('un envío sin ubicación lo dice, en vez de mandar un enlace roto', () => {
    const text = staffOrderNoticeText({ ...base, latitude: null, longitude: null });
    expect(text).toContain('📍 Sin ubicación: pedírsela al cliente.');
  });

  it('un pedido enorme recorta las líneas, nunca el total ni la dirección', () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({
      name: `Producto con un nombre bastante largo número ${i}`,
      quantity: 1,
      subtotal: 10,
    }));
    const text = staffOrderNoticeText({ ...base, lines });
    expect(text.length).toBeLessThanOrEqual(3600);
    expect(text).toMatch(/…y \d+ líneas más/);
    expect(text).toContain('TOTAL: Bs 168.00 — COBRAR al entregar');
    expect(text).toContain(mapsLink(-17.7812, -63.1795));
  });
});

// ── Cuándo se manda ─────────────────────────────────────────────────────────

/** Base falsa: cada tabla devuelve lo que se le configura. */
function fakeDb(tables: Record<string, unknown>) {
  const selectFrom = jest.fn((table: string) => {
    const result = tables[table];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'selectAll', 'where']) builder[method] = jest.fn(() => builder);
    builder.executeTakeFirst = jest
      .fn()
      .mockResolvedValue(Array.isArray(result) ? result[0] : result);
    builder.execute = jest.fn().mockResolvedValue(Array.isArray(result) ? result : []);
    return builder;
  });
  return { selectFrom } as never;
}

const POSLESS = { requires_cash_register: false, currency_symbol: 'Bs' };
const ORDER = {
  id: 'order-1',
  order_number: 'ORD-000123',
  status: 'confirmed',
  payment_method: 'cash',
  payment_status: 'paid',
  cash_confirmed_at: new Date(),
  delivery_type: 'pickup',
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
};
const ITEMS = [{ product_name_snapshot: 'Caipirinha', quantity: 2, subtotal: '50.00' }];

function notifier() {
  const notifyNow = jest.fn().mockResolvedValue(undefined);
  return { notifications: { notifyNow } as unknown as NotificationsOutService, notifyNow };
}

describe('notifyStaffOrderFirm (cuándo recibe el personal el pedido)', () => {
  it('en modo sin POS manda el pedido firme al grupo del personal, una vez', async () => {
    const { notifications, notifyNow } = notifier();
    const db = fakeDb({
      operational_settings: POSLESS,
      orders: ORDER,
      order_items: ITEMS,
      order_promotions: [],
      customers: { phone: '+59170010001' },
    });

    await expect(notifyStaffOrderFirm(db, notifications, 'order-1')).resolves.toBe('sent');

    expect(notifyNow).toHaveBeenCalledTimes(1);
    const job = notifyNow.mock.calls[0][0];
    // La cola deduplica por tipo + pedido: un reintento no duplica la comanda.
    expect(job).toMatchObject({
      channel: 'telegram',
      kind: STAFF_ORDER_NOTICE_KIND,
      targetRef: 'order-1',
    });
    expect(job.payload.chatRef).toBe('staff-group');
    expect(job.payload.text).toContain('🆕 PEDIDO ORD-000123');
    expect(job.payload.text).toContain('👤 María Flores — +59170010001');
    expect(job.payload.text).toContain('TOTAL: Bs 50.00 — COBRAR al retirar');
  });

  it('con POS no manda nada: el pedido ya está en la pantalla de cocina', async () => {
    const { notifications, notifyNow } = notifier();
    const db = fakeDb({
      operational_settings: { ...POSLESS, requires_cash_register: true },
      orders: ORDER,
    });
    await expect(notifyStaffOrderFirm(db, notifications, 'order-1')).resolves.toBe('skipped');
    expect(notifyNow).not.toHaveBeenCalled();
  });

  it.each([
    [
      'efectivo que el cliente todavía no confirmó',
      { cash_confirmed_at: null, payment_status: 'unpaid' },
    ],
    ['QR sin pagar', { payment_method: 'qr', payment_status: 'unpaid', cash_confirmed_at: null }],
    ['pedido cancelado', { status: 'cancelled' }],
    ['pedido que espera la ubicación', { status: 'awaiting_location' }],
  ])('no avisa de un pedido que todavía no es firme: %s', async (_caso, cambios) => {
    const { notifications, notifyNow } = notifier();
    const db = fakeDb({ operational_settings: POSLESS, orders: { ...ORDER, ...cambios } });
    await expect(notifyStaffOrderFirm(db, notifications, 'order-1')).resolves.toBe('skipped');
    expect(notifyNow).not.toHaveBeenCalled();
  });

  it('un QR ya pagado sí es firme, y se anuncia como pagado', async () => {
    const { notifications, notifyNow } = notifier();
    const db = fakeDb({
      operational_settings: POSLESS,
      orders: { ...ORDER, payment_method: 'qr', payment_status: 'paid', cash_confirmed_at: null },
      order_items: ITEMS,
      order_promotions: [],
      customers: { phone: null },
    });
    await expect(notifyStaffOrderFirm(db, notifications, 'order-1')).resolves.toBe('sent');
    expect(notifyNow.mock.calls[0][0].payload.text).toContain('YA PAGADO, no cobrar');
  });

  it('nunca lanza: si la cola falla, el cobro que ya se hizo no se deshace', async () => {
    const notifications = {
      notifyNow: jest.fn().mockRejectedValue(new Error('telegram caído')),
    } as unknown as NotificationsOutService;
    const db = fakeDb({
      operational_settings: POSLESS,
      orders: ORDER,
      order_items: ITEMS,
      order_promotions: [],
      customers: { phone: null },
    });
    await expect(notifyStaffOrderFirm(db, notifications, 'order-1')).resolves.toBe('skipped');
  });
});
