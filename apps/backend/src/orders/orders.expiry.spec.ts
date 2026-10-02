import { Kysely, Transaction } from 'kysely';
import { Database } from '../database/types';
import { NotificationsOutService } from '../notifications-out/notifications-out.service';
import { OrdersService } from './orders.service';

function updateChain(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  builder.set = jest.fn(() => builder);
  builder.where = jest.fn(() => builder);
  builder.returning = jest.fn(() => builder);
  builder.execute = jest.fn().mockResolvedValue(rows);
  return builder;
}

describe('OrdersService.expireStaleOrders', () => {
  it('cancels stale cash and awaiting-location orders centrally', async () => {
    const cash = updateChain([
      { id: 'cash-1', order_number: 'ORD-CASH', customer_id: 'customer-1' },
    ]);
    const location = updateChain([
      { id: 'loc-1', order_number: 'ORD-LOC', customer_id: 'customer-2' },
    ]);
    let updateCall = 0;

    const trx = {
      updateTable: jest.fn(() => {
        updateCall += 1;
        return updateCall === 1 ? cash : location;
      }),
    } as unknown as Transaction<Database>;

    const db = {
      transaction: () => ({
        execute: async <T>(fn: (inner: Transaction<Database>) => Promise<T>) => fn(trx),
      }),
    } as unknown as Kysely<Database>;

    const notifyNow = jest.fn().mockResolvedValue(undefined);
    const service = new OrdersService(
      db,
      {} as never,
      {} as never,
      {} as never,
      { notifyNow } as unknown as NotificationsOutService,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.expireStaleOrders(new Date('2026-09-19T06:00:00.000Z'));

    expect(result).toEqual({
      cancelled: 2,
      cashUnconfirmed: 1,
      awaitingLocation: 1,
    });
    expect(notifyNow).toHaveBeenCalledTimes(1);
    expect(notifyNow).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'cash_expired_customer_notice',
        targetRef: 'cash-1',
      }),
    );
  });
});
