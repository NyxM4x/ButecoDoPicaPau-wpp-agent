import { Kysely } from 'kysely';
import { BanecoClientService } from '../baneco/baneco-client.service';
import { Database } from '../database/types';
import { NotificationsOutService } from '../notifications-out/notifications-out.service';
import { PaymentAttemptsService } from '../payment-attempts/payment-attempts.service';
import { QrPaymentsService } from './qr-payments.service';

function makeDb() {
  const executeTakeFirst = jest.fn().mockResolvedValue({
    id: 'order-1',
    order_number: 'ORD-000001',
    payment_method: 'qr',
    payment_status: 'unpaid',
    total_amount: '50.00',
    customer_id: 'customer-1',
    delivery_type: 'delivery',
    delivery_quote_status: 'pending',
  });
  const where = jest.fn().mockReturnValue({ executeTakeFirst });
  const select = jest.fn().mockReturnValue({ where });
  const selectFrom = jest.fn().mockReturnValue({ select });
  return { selectFrom } as unknown as Kysely<Database>;
}

describe('QrPaymentsService delivery total guard', () => {
  it('rejects QR generation before the delivery quote is final', async () => {
    const service = new QrPaymentsService(
      makeDb(),
      {} as BanecoClientService,
      {} as PaymentAttemptsService,
      {} as NotificationsOutService,
    );

    await expect(service.generateForOrder('order-1')).rejects.toMatchObject({
      code: 'delivery_quote_required',
    });
  });
});
