import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { OrdersService, OrderResponse } from './orders.service';

const order: OrderResponse = {
  id: 'order-1',
  orderNumber: 'ORD-000001',
  customerId: null,
  channel: 'pos',
  customerName: 'Mostrador',
  deliveryType: 'dine_in',
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
  createdAt: '2026-09-19T01:00:00.000Z',
  items: [],
  promotions: [],
};

describe('OrdersService operational pause', () => {
  it('blocks new web/WhatsApp orders before idempotent checkout execution', async () => {
    const idempotency = { run: jest.fn() } as unknown as IdempotencyService;
    const service = new OrdersService(
      {} as never,
      idempotency,
      { getRow: jest.fn().mockResolvedValue({ orders_paused: true }) } as never,
      {} as never,
      {} as never,
      { isOpen: jest.fn() } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.create(
        {
          channel: 'web',
          customerName: 'Juan',
          deliveryType: 'delivery',
          paymentMethod: 'qr',
          items: [],
          promotions: [],
        },
        'idem-1',
        'web',
      ),
    ).rejects.toMatchObject({ code: 'orders_paused' });

    expect(idempotency.run).not.toHaveBeenCalled();
  });

  it('blocks pickup creation when pickup is disabled centrally', async () => {
    const idempotency = { run: jest.fn() } as unknown as IdempotencyService;
    const service = new OrdersService(
      {} as never,
      idempotency,
      {
        getRow: jest.fn().mockResolvedValue({
          orders_paused: false,
          pickup_enabled: false,
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.create(
        {
          channel: 'web',
          customerName: 'Juan',
          deliveryType: 'pickup',
          paymentMethod: 'qr',
          items: [],
          promotions: [],
        },
        'idem-pickup',
        'web',
      ),
    ).rejects.toMatchObject({ code: 'pickup_disabled' });

    expect(idempotency.run).not.toHaveBeenCalled();
  });

  it('blocks switching an existing delivery to pickup when pickup is disabled', async () => {
    const service = new OrdersService(
      {} as never,
      {} as never,
      {
        getRow: jest.fn().mockResolvedValue({
          pickup_enabled: false,
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.switchToPickup('order-1')).rejects.toMatchObject({
      code: 'pickup_disabled',
    });
  });

  function serviceWithSettings(settings: Record<string, unknown>) {
    const idempotency = {
      run: jest.fn().mockResolvedValue({ body: order, status: 201, created: true }),
    } as unknown as IdempotencyService;
    const service = new OrdersService(
      {} as never,
      idempotency,
      { getRow: jest.fn().mockResolvedValue(settings) } as never,
      {} as never,
      { notifyNow: jest.fn().mockResolvedValue(undefined) } as never,
      { isOpen: jest.fn().mockResolvedValue(true) } as never,
      { notifyIfReady: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    );
    return { service, idempotency };
  }

  const OPEN_ALL_DAY = {
    orders_paused: false,
    pickup_enabled: true,
    business_opens_hour: 0,
    business_closes_hour: 0,
  };

  it('blocks a customer delivery order when delivery is disabled', async () => {
    const { service, idempotency } = serviceWithSettings({
      ...OPEN_ALL_DAY,
      delivery_enabled: false,
      enabled_payment_methods: ['cash', 'qr'],
    });

    await expect(
      service.create(
        {
          channel: 'whatsapp',
          customerName: 'Juan',
          deliveryType: 'delivery',
          paymentMethod: 'cash',
          items: [],
          promotions: [],
        },
        'idem-delivery-off',
        'whatsapp-gateway',
      ),
    ).rejects.toMatchObject({ code: 'delivery_disabled' });

    expect(idempotency.run).not.toHaveBeenCalled();
  });

  it('blocks a customer order paid with a method the restaurant turned off', async () => {
    const { service, idempotency } = serviceWithSettings({
      ...OPEN_ALL_DAY,
      delivery_enabled: true,
      enabled_payment_methods: ['qr'],
    });

    await expect(
      service.create(
        {
          channel: 'whatsapp',
          customerName: 'Juan',
          deliveryType: 'pickup',
          paymentMethod: 'cash',
          items: [],
          promotions: [],
        },
        'idem-cash-off',
        'whatsapp-gateway',
      ),
    ).rejects.toMatchObject({
      code: 'payment_method_disabled',
      details: { paymentMethod: 'cash', enabled: ['qr'] },
    });

    expect(idempotency.run).not.toHaveBeenCalled();
  });

  it('lets the counter sell with delivery and payment methods turned off for customers', async () => {
    const { service, idempotency } = serviceWithSettings({
      ...OPEN_ALL_DAY,
      delivery_enabled: false,
      enabled_payment_methods: ['qr'],
    });

    await expect(
      service.create(
        {
          channel: 'pos',
          customerName: 'Mostrador',
          deliveryType: 'delivery',
          paymentMethod: 'cash',
          items: [],
          promotions: [],
          bypassHoursGate: true,
        },
        'idem-pos-delivery',
        'pos',
      ),
    ).resolves.toMatchObject({ httpStatus: 201 });

    expect(idempotency.run).toHaveBeenCalledTimes(1);
  });

  it('does not block POS orders when digital orders are paused', async () => {
    const idempotency = {
      run: jest.fn().mockResolvedValue({ body: order, status: 201, created: true }),
    } as unknown as IdempotencyService;
    const service = new OrdersService(
      {} as never,
      idempotency,
      { getRow: jest.fn().mockResolvedValue({ orders_paused: true }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.create(
        {
          channel: 'pos',
          customerName: 'Mostrador',
          deliveryType: 'dine_in',
          paymentMethod: 'cash',
          items: [],
          promotions: [],
          bypassHoursGate: true,
        },
        'idem-pos',
        'pos',
      ),
    ).resolves.toMatchObject({ httpStatus: 201, body: order });

    expect(idempotency.run).toHaveBeenCalledTimes(1);
  });
});
