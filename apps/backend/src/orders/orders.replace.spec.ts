import { Kysely, Transaction } from 'kysely';
import { Database } from '../database/types';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { OrdersService, OrderResponse } from './orders.service';

function selectChain(result: unknown) {
  const builder: Record<string, unknown> = {};
  builder.select = jest.fn(() => builder);
  builder.selectAll = jest.fn(() => builder);
  builder.where = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.limit = jest.fn(() => builder);
  builder.forUpdate = jest.fn(() => builder);
  builder.execute = jest.fn().mockResolvedValue([]);
  builder.executeTakeFirst = jest.fn().mockResolvedValue(result);
  return builder;
}

describe('OrdersService.replace', () => {
  it('creates the replacement and cancels the old order inside one idempotent transaction', async () => {
    const oldOrder = {
      id: 'old-order',
      order_number: 'ORD-000001',
      customer_id: 'customer-1',
      customer_name: 'Juan',
      channel: 'web',
      delivery_type: 'delivery',
      payment_method: 'cash',
      payment_status: 'unpaid',
      notes: null,
      status: 'confirmed',
      subtotal_amount: '50.00',
      delivery_base_amount: '10.00',
      delivery_surcharge_amount: '2.00',
      total_amount: '62.00',
      delivery_pricing: 'dynamic',
      delivery_quote_status: 'quoted',
      delivery_distance_meters: 2500,
      delivery_latitude: -17.75,
      delivery_longitude: -63.18,
      delivery_fee_paid: false,
      cash_confirmed_at: null,
      confirmed_at: new Date('2026-09-19T01:00:00.000Z'),
      status_updated_by: null,
      register_session_id: null,
      replaces_order_id: null,
      created_at: new Date('2026-09-19T01:00:00.000Z'),
      updated_at: new Date('2026-09-19T01:00:00.000Z'),
    };

    const replacement: OrderResponse = {
      id: 'new-order',
      orderNumber: 'ORD-000002',
      customerId: 'customer-1',
      channel: 'web',
      customerName: 'Juan',
      deliveryType: 'delivery',
      paymentMethod: 'qr',
      paymentStatus: 'unpaid',
      status: 'awaiting_location',
      notes: null,
      subtotalAmount: 70,
      deliveryBaseAmount: 0,
      deliverySurchargeAmount: 0,
      totalAmount: 70,
      deliveryQuoteStatus: 'pending',
      deliveryDistanceMeters: null,
      cashConfirmedAt: null,
      statusUpdatedBy: null,
      createdAt: '2026-09-19T01:05:00.000Z',
      items: [],
      promotions: [],
    };

    const updatedReplacementRow = {
      ...oldOrder,
      id: 'new-order',
      order_number: 'ORD-000002',
      payment_method: 'qr',
      subtotal_amount: '70.00',
      total_amount: '82.00',
      status: 'confirmed',
      replaces_order_id: 'old-order',
      created_at: new Date('2026-09-19T01:05:00.000Z'),
    };

    const relationUpdates: Record<string, unknown>[] = [];
    let updateCall = 0;

    const trx = {
      selectFrom: jest.fn((table: string) => {
        if (table === 'orders') return selectChain(oldOrder);
        if (table === 'payment_proofs') return selectChain(undefined);
        if (table === 'payment_attempts') return selectChain(undefined);
        if (table === 'bank_qr_charges') return selectChain(undefined);
        if (table === 'order_items') return selectChain([]);
        if (table === 'order_promotions') return selectChain([]);
        throw new Error(`Unexpected table: ${table}`);
      }),
      updateTable: jest.fn(() => {
        updateCall += 1;
        const builder: Record<string, unknown> = {};
        builder.set = jest.fn((value: Record<string, unknown>) => {
          relationUpdates.push(value);
          return builder;
        });
        builder.where = jest.fn(() => builder);
        builder.returningAll = jest.fn(() => builder);
        builder.executeTakeFirstOrThrow = jest
          .fn()
          .mockResolvedValue(updateCall === 1 ? updatedReplacementRow : { id: 'old-order' });
        return builder;
      }),
    } as unknown as Transaction<Database>;

    const idempotency = {
      run: jest.fn(
        async (params: {
          execute: (innerTrx: Transaction<Database>) => Promise<{ status: number; body: unknown }>;
        }) => {
          const result = await params.execute(trx);
          return { ...result, created: true };
        },
      ),
    } as unknown as IdempotencyService;

    const service = new OrdersService(
      {} as Kysely<Database>,
      idempotency,
      {
        getRow: jest.fn().mockResolvedValue({ orders_paused: false, pickup_enabled: true }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    jest.spyOn(service, 'createOrderInTransaction').mockResolvedValue(replacement);
    jest
      .spyOn(
        service as unknown as { notifyOrderCreated(order: OrderResponse): Promise<void> },
        'notifyOrderCreated',
      )
      .mockResolvedValue(undefined);

    const result = await service.replace(
      'old-order',
      {
        channel: 'web',
        deliveryType: 'delivery',
        paymentMethod: 'qr',
        items: [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 2 }],
        promotions: [],
      },
      'idem-1',
      'whatsapp-gateway',
    );

    expect(result.httpStatus).toBe(201);
    expect(result.body.replacedOrderId).toBe('old-order');
    expect(result.body.order.id).toBe('new-order');
    expect(result.body.order.totalAmount).toBe(82);

    expect(relationUpdates[0]).toMatchObject({
      replaces_order_id: 'old-order',
      delivery_quote_status: 'quoted',
      delivery_base_amount: '10.00',
      delivery_surcharge_amount: '2.00',
      total_amount: '82.00',
      status: 'confirmed',
    });
    expect(relationUpdates[1]).toMatchObject({
      status: 'cancelled',
      status_updated_by: 'replacement',
    });
  });

  it('rejects replacement when a payment is already in progress', async () => {
    const oldOrder = {
      id: 'old-order',
      customer_id: 'customer-1',
      customer_name: 'Juan',
      status: 'confirmed',
      payment_status: 'pending_review',
      cash_confirmed_at: null,
      delivery_fee_paid: false,
    };

    const trx = {
      selectFrom: jest.fn(() => selectChain(oldOrder)),
    } as unknown as Transaction<Database>;

    const idempotency = {
      run: jest.fn(
        async (params: {
          execute: (innerTrx: Transaction<Database>) => Promise<{ status: number; body: unknown }>;
        }) => params.execute(trx),
      ),
    } as unknown as IdempotencyService;

    const service = new OrdersService(
      {} as Kysely<Database>,
      idempotency,
      {
        getRow: jest.fn().mockResolvedValue({ orders_paused: false, pickup_enabled: true }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.replace(
        'old-order',
        {
          channel: 'web',
          deliveryType: 'pickup',
          paymentMethod: 'qr',
          items: [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
          promotions: [],
        },
        'idem-2',
        'whatsapp-gateway',
      ),
    ).rejects.toMatchObject({ code: 'order_payment_in_progress' });
  });
});
