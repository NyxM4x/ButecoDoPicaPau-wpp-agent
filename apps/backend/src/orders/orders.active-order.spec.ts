import { Kysely } from 'kysely';
import { Database } from '../database/types';
import { OrdersService } from './orders.service';

function queryResult(result: unknown) {
  const builder: Record<string, unknown> = {};
  builder.select = jest.fn(() => builder);
  builder.where = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.limit = jest.fn(() => builder);
  builder.executeTakeFirst = jest.fn().mockResolvedValue(result);
  return builder;
}

function makeService(input?: { withOrder?: boolean; withProof?: boolean }) {
  const customer = queryResult({ id: 'customer-1' });
  const order = queryResult(
    input?.withOrder === false
      ? undefined
      : {
          id: 'order-1',
          order_number: 'ORD-000001',
          status: 'awaiting_location',
          payment_status: 'pending_review',
          payment_method: 'qr',
          total_amount: '62.00',
          subtotal_amount: '50.00',
          delivery_type: 'delivery',
          delivery_quote_status: 'quoted',
          cash_confirmed_at: null,
          delivery_latitude: -17.75,
          created_at: new Date('2026-09-19T01:00:00.000Z'),
        },
  );
  const attempt = queryResult({
    review_status: 'pending_review',
    reviewed_at: null,
  });
  const proof = queryResult(input?.withProof === false ? undefined : { id: 'proof-1' });

  const db = {
    selectFrom: jest.fn((table: string) => {
      if (table === 'customers') return customer;
      if (table === 'orders') return order;
      if (table === 'payment_attempts') return attempt;
      if (table === 'payment_proofs') return proof;
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as Kysely<Database>;

  const service = new OrdersService(
    db,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, db };
}

describe('OrdersService.findActiveOrderContext', () => {
  it('returns the channel-safe facts for the latest active order', async () => {
    const { service } = makeService();

    await expect(service.findActiveOrderContext('customer-1')).resolves.toEqual({
      orderId: 'order-1',
      orderNumber: 'ORD-000001',
      status: 'awaiting_location',
      paymentStatus: 'pending_review',
      paymentMethod: 'qr',
      totalAmount: 62,
      subtotalAmount: 50,
      deliveryType: 'delivery',
      deliveryQuoteStatus: 'quoted',
      cashConfirmed: false,
      locationReceived: true,
      proofReceived: true,
      latestPaymentAttempt: {
        reviewStatus: 'pending_review',
        reviewedAt: null,
      },
      createdAt: '2026-09-19T01:00:00.000Z',
    });
  });

  it('returns null when the customer has no active order', async () => {
    const { service } = makeService({ withOrder: false });

    await expect(service.findActiveOrderContext('customer-1')).resolves.toBeNull();
  });

  it('distinguishes a missing proof from payment attempt state', async () => {
    const { service } = makeService({ withProof: false });

    const result = await service.findActiveOrderContext('customer-1');
    expect(result?.proofReceived).toBe(false);
    expect(result?.latestPaymentAttempt?.reviewStatus).toBe('pending_review');
  });
});
