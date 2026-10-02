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
