import { Kysely } from 'kysely';
import { Database } from '../database/types';
import { NotificationsOutService } from '../notifications-out/notifications-out.service';
import { QrCheckoutService } from './qr-checkout.service';
import { QrPaymentsService } from './qr-payments.service';

function makeDb(input: {
  deliveryQuoteStatus: 'pending' | 'quoted';
  existingNotificationStatus?: 'pending' | 'sending' | 'sent' | 'failed' | null;
}) {
  const order = {
    id: 'order-1',
    order_number: 'ORD-000001',
    customer_id: 'customer-1',
    delivery_type: 'delivery',
    delivery_quote_status: input.deliveryQuoteStatus,
    payment_method: 'qr',
    payment_status: 'unpaid',
    total_amount: input.deliveryQuoteStatus === 'quoted' ? '62.00' : '50.00',
  };

  const selectFrom = jest.fn((table: string) => {
    if (table === 'orders') {
      return {
        select: () => ({
          where: () => ({
            executeTakeFirst: async () => order,
          }),
        }),
      };
    }

    return {
      select: () => ({
        where: () => ({
          where: () => ({
            executeTakeFirst: async () =>
              input.existingNotificationStatus
                ? { status: input.existingNotificationStatus }
                : undefined,
          }),
        }),
      }),
    };
  });

  return { selectFrom } as unknown as Kysely<Database>;
}

function makeDeps() {
  const generateForOrder = jest.fn().mockResolvedValue({
    orderId: 'order-1',
    status: 'pending',
    qrImageUrl: '/orders/order-1/qr-image',
    dueDate: '2026-09-19',
  });
  const notifyNow = jest.fn().mockResolvedValue(undefined);

  return {
    qrPayments: { generateForOrder } as unknown as QrPaymentsService,
    notifications: { notifyNow } as unknown as NotificationsOutService,
    generateForOrder,
    notifyNow,
  };
}

describe('QrCheckoutService', () => {
  it('does not generate a QR while delivery total is still pending', async () => {
    const { qrPayments, notifications, generateForOrder, notifyNow } = makeDeps();
    const service = new QrCheckoutService(
      makeDb({ deliveryQuoteStatus: 'pending' }),
      qrPayments,
      notifications,
    );

    await expect(service.notifyIfReady('order-1')).resolves.toBe('skipped');
    expect(generateForOrder).not.toHaveBeenCalled();
    expect(notifyNow).not.toHaveBeenCalled();
  });

  it('generates and notifies only after the delivery quote is final', async () => {
    const { qrPayments, notifications, generateForOrder, notifyNow } = makeDeps();
    const service = new QrCheckoutService(
      makeDb({ deliveryQuoteStatus: 'quoted' }),
      qrPayments,
      notifications,
    );

    await expect(service.notifyIfReady('order-1')).resolves.toBe('notified');
    expect(generateForOrder).toHaveBeenCalledWith('order-1');
    expect(notifyNow).toHaveBeenCalledWith({
      channel: 'whatsapp',
      kind: 'qr_confirmation',
      targetRef: 'order-1',
      payload: {
        customerId: 'customer-1',
        text: 'Tu pedido ORD-000001 es Bs 62.00. Escaneá el QR para pagar.',
        imageUrl: '/orders/order-1/qr-image',
      },
    });
  });

  it('does not resend an already queued or sent QR notification', async () => {
    const { qrPayments, notifications, generateForOrder, notifyNow } = makeDeps();
    const service = new QrCheckoutService(
      makeDb({ deliveryQuoteStatus: 'quoted', existingNotificationStatus: 'sent' }),
      qrPayments,
      notifications,
    );

    await expect(service.notifyIfReady('order-1')).resolves.toBe('skipped');
    expect(generateForOrder).not.toHaveBeenCalled();
    expect(notifyNow).not.toHaveBeenCalled();
  });
});
