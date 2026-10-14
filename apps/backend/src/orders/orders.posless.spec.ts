import { CashRegisterService } from '../cash-register/cash-register.service';
import { classifyServiceWindow } from '../common/time/service-window';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { OrdersService, OrderResponse } from './orders.service';

/**
 * Modo «sin POS» (`requires_cash_register = false`): el restaurante no tiene
 * pantallas de caja ni de cocina. El horario decide si se toma un pedido, los
 * cobros no piden caja y los pedidos firmes se cierran solos.
 */

const order: OrderResponse = {
  id: 'order-1',
  orderNumber: 'ORD-000001',
  customerId: null,
  channel: 'whatsapp',
  customerName: 'Juan',
  deliveryType: 'pickup',
  paymentMethod: 'cash',
  paymentStatus: 'unpaid',
  status: 'confirmed',
  notes: null,
  subtotalAmount: 50,
  deliveryBaseAmount: 0,
  deliverySurchargeAmount: 0,
  totalAmount: 50,
  deliveryQuoteStatus: null,
  deliveryDistanceMeters: null,
  cashConfirmedAt: null,
  statusUpdatedBy: null,
  createdAt: '2026-10-13T01:00:00.000Z',
  items: [],
  promotions: [],
};

const SETTINGS = {
  orders_paused: false,
  pickup_enabled: true,
  delivery_enabled: true,
  enabled_payment_methods: ['cash', 'qr'],
  restaurant_timezone: 'America/La_Paz',
  // Abierto las 24 horas: lo que se prueba aquí es la caja, no el horario.
  business_opens_hour: 0,
  business_closes_hour: 0,
};

const dto = {
  channel: 'whatsapp' as const,
  customerName: 'Juan',
  deliveryType: 'pickup' as const,
  paymentMethod: 'cash' as const,
  items: [],
  promotions: [],
};

function service(settings: Record<string, unknown>, cashRegisterOpen: boolean) {
  const idempotency = {
    run: jest.fn().mockResolvedValue({ body: order, status: 201, created: true }),
  } as unknown as IdempotencyService;
  const isOpen = jest.fn().mockResolvedValue(cashRegisterOpen);
  // Un `db` que encuentra una solicitud ya guardada: así la rama «en revisión»
  // devuelve su 202 sin necesitar una base de verdad.
  const lateRequest = {
    id: 'req-1',
    request_number: 'SOL-000001',
    subtotal_amount: '50.00',
    expires_at: new Date('2026-10-13T01:10:00.000Z'),
  };
  const builder: Record<string, unknown> = {};
  for (const method of ['selectAll', 'where']) builder[method] = jest.fn(() => builder);
  builder.executeTakeFirst = jest.fn().mockResolvedValue(lateRequest);
  const db = { selectFrom: jest.fn(() => builder) };

  const orders = new OrdersService(
    db as never,
    idempotency,
    { getRow: jest.fn().mockResolvedValue(settings) } as never,
    {} as never,
    { notifyNow: jest.fn().mockResolvedValue(undefined) } as never,
    { isOpen } as never,
    { notifyIfReady: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
  );
  return { orders, idempotency, isOpen };
}

describe('crear un pedido sin caja', () => {
  it('con caja obligatoria y sin caja abierta, el pedido queda en revisión (202)', async () => {
    const { orders, idempotency } = service({ ...SETTINGS, requires_cash_register: true }, false);
    await expect(orders.create(dto, 'idem-1', 'whatsapp-gateway')).resolves.toMatchObject({
      httpStatus: 202,
    });
    expect(idempotency.run).not.toHaveBeenCalled();
  });

  it('en modo sin POS se crea de verdad (201), sin mirar la caja', async () => {
    const { orders, idempotency, isOpen } = service(
      { ...SETTINGS, requires_cash_register: false },
      false,
    );
    await expect(orders.create(dto, 'idem-2', 'whatsapp-gateway')).resolves.toMatchObject({
      httpStatus: 201,
      body: { id: 'order-1' },
    });
    expect(idempotency.run).toHaveBeenCalledTimes(1);
    expect(isOpen).not.toHaveBeenCalled();
  });

  it('en modo sin POS el horario sigue mandando: fuera de hora responde closed', async () => {
    // Un horario de una sola hora, calculado para que AHORA quede fuera.
    const horaActual = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/La_Paz',
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(new Date()),
    );
    const opens = (horaActual + 2) % 24;
    const { orders, idempotency } = service(
      {
        ...SETTINGS,
        requires_cash_register: false,
        business_opens_hour: opens,
        business_closes_hour: (opens + 1) % 24,
      },
      false,
    );
    await expect(orders.create(dto, 'idem-3', 'whatsapp-gateway')).rejects.toMatchObject({
      code: 'closed',
    });
    expect(idempotency.run).not.toHaveBeenCalled();
  });
});

describe('el horario usa la zona del restaurante', () => {
  // 2026-01-15 23:30 UTC = 19:30 en La Paz (UTC−4) y 20:30 en São Paulo (UTC−3).
  const instante = new Date(Date.UTC(2026, 0, 15, 23, 30));
  const horario = { opensHour: 20, closesHour: 23 };

  it('el mismo instante está cerrado en una zona y abierto en la otra', () => {
    expect(classifyServiceWindow(instante, { ...horario, timeZone: 'America/La_Paz' })).toBe(
      'closed',
    );
    expect(classifyServiceWindow(instante, { ...horario, timeZone: 'America/Sao_Paulo' })).toBe(
      'open',
    );
  });

  it('sin zona vale Bolivia, como siempre', () => {
    expect(classifyServiceWindow(instante, horario)).toBe('closed');
  });

  it('una zona que no existe no rompe nada: cae a Bolivia', () => {
    expect(classifyServiceWindow(instante, { ...horario, timeZone: 'Marte/Base' })).toBe('closed');
  });
});

describe('a qué caja va un cobro', () => {
  /** `tablas`: lo que devuelve la primera fila de cada tabla. */
  function cashRegister(tablas: Record<string, unknown>) {
    const db = {
      selectFrom: jest.fn((tabla: string) => {
        const builder: Record<string, unknown> = {};
        for (const method of ['select', 'where']) builder[method] = jest.fn(() => builder);
        builder.executeTakeFirst = jest.fn().mockResolvedValue(tablas[tabla]);
        return builder;
      }),
    };
    return { service: new CashRegisterService(db as never), db };
  }

  it('con caja obligatoria y sin caja abierta, no se cobra', async () => {
    const { service, db } = cashRegister({
      operational_settings: { requires_cash_register: true },
    });
    await expect(service.sessionIdForPayment(db as never)).rejects.toMatchObject({
      code: 'cash_register_closed',
    });
  });

  it('con caja obligatoria y caja abierta, el cobro va a esa caja', async () => {
    const { service, db } = cashRegister({
      operational_settings: { requires_cash_register: true },
      cash_register_sessions: { id: 'caja-1' },
    });
    await expect(service.sessionIdForPayment(db as never)).resolves.toBe('caja-1');
  });

  it('en modo sin POS el cobro se acepta sin caja', async () => {
    const { service, db } = cashRegister({
      operational_settings: { requires_cash_register: false },
    });
    await expect(service.sessionIdForPayment(db as never)).resolves.toBeNull();
  });

  it('en modo sin POS, si alguien sí abrió caja, el cobro va ahí', async () => {
    const { service, db } = cashRegister({
      operational_settings: { requires_cash_register: false },
      cash_register_sessions: { id: 'caja-1' },
    });
    await expect(service.sessionIdForPayment(db as never)).resolves.toBe('caja-1');
  });
});

describe('cierre automático de pedidos', () => {
  function ordersWithSettings(settings: Record<string, unknown>) {
    const execute = jest.fn().mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]);
    const builder: Record<string, unknown> = {};
    for (const method of ['set', 'where', 'returning']) builder[method] = jest.fn(() => builder);
    builder.execute = execute;
    const db = { updateTable: jest.fn(() => builder) };
    const orders = new OrdersService(
      db as never,
      {} as never,
      { getRow: jest.fn().mockResolvedValue(settings) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { orders, db, builder };
  }

  it('con POS no toca nada: el estado lo mueve una persona', async () => {
    const { orders, db } = ordersWithSettings({
      requires_cash_register: true,
      auto_complete_minutes: 180,
    });
    await expect(orders.autoCompleteOrders()).resolves.toEqual({ completed: 0 });
    expect(db.updateTable).not.toHaveBeenCalled();
  });

  it('sin minutos configurados tampoco: el cierre automático es opcional', async () => {
    const { orders, db } = ordersWithSettings({
      requires_cash_register: false,
      auto_complete_minutes: null,
    });
    await expect(orders.autoCompleteOrders()).resolves.toEqual({ completed: 0 });
    expect(db.updateTable).not.toHaveBeenCalled();
  });

  it('en modo sin POS cierra como entregados los pedidos firmes y viejos', async () => {
    const { orders, builder } = ordersWithSettings({
      requires_cash_register: false,
      auto_complete_minutes: 180,
    });
    const ahora = new Date('2026-10-13T12:00:00.000Z');

    await expect(orders.autoCompleteOrders(ahora)).resolves.toEqual({ completed: 2 });

    expect(builder.set).toHaveBeenCalledWith({
      status: 'delivered',
      status_updated_by: 'auto_complete',
      updated_at: ahora,
    });
    // Tres horas antes: lo confirmado después de eso todavía puede estar en camino.
    expect(builder.where).toHaveBeenCalledWith(
      'confirmed_at',
      '<',
      new Date('2026-10-13T09:00:00.000Z'),
    );
  });
});
