import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY } from '../database/database.module';
import { Database } from '../database/types';
import { NotFoundDomainError } from '../common/exceptions/domain-exception';
import { NotificationsOutService } from '../notifications-out/notifications-out.service';
import { QrPaymentsService } from './qr-payments.service';

export type QrCheckoutNotificationResult = 'skipped' | 'notified';

@Injectable()
export class QrCheckoutService {
  private readonly logger = new Logger(QrCheckoutService.name);

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly qrPayments: QrPaymentsService,
    private readonly notifications: NotificationsOutService,
  ) {}

  async notifyIfReady(orderId: string): Promise<QrCheckoutNotificationResult> {
    const order = await this.db
      .selectFrom('orders')
      .select([
        'id',
        'order_number',
        'customer_id',
        'delivery_type',
        'delivery_quote_status',
        'payment_method',
        'payment_status',
        'total_amount',
      ])
      .where('id', '=', orderId)
      .executeTakeFirst();

    if (!order) throw new NotFoundDomainError('order', orderId);
    if (!order.customer_id || order.payment_method !== 'qr' || order.payment_status === 'paid') {
      return 'skipped';
    }
    if (order.delivery_type === 'delivery' && order.delivery_quote_status !== 'quoted') {
      return 'skipped';
    }

    const existingNotification = await this.db
      .selectFrom('notification_jobs')
      .select('status')
      .where('kind', '=', 'qr_confirmation')
      .where('target_ref', '=', order.id)
      .executeTakeFirst();
    if (
      existingNotification &&
      ['pending', 'sending', 'sent'].includes(existingNotification.status)
    ) {
      return 'skipped';
    }

    let payload: { customerId: string; text: string; imageUrl?: string };
    try {
      const charge = await this.qrPayments.generateForOrder(order.id);
      payload = {
        customerId: order.customer_id,
        text: `Tu pedido ${order.order_number} es Bs ${Number(order.total_amount).toFixed(2)}. Escaneá el QR para pagar.`,
        imageUrl: charge.qrImageUrl,
      };
    } catch (error) {
      this.logger.warn(
        `No se pudo generar el QR real para ${order.id}, cae a captura: ${(error as Error).message}`,
      );
      payload = {
        customerId: order.customer_id,
        text: `Tu pedido ${order.order_number} es Bs ${Number(order.total_amount).toFixed(2)}. Cuando pagues, responde a este mensaje con la captura.`,
      };
    }

    await this.notifications.notifyNow({
      channel: 'whatsapp',
      kind: 'qr_confirmation',
      targetRef: order.id,
      payload,
    });
    return 'notified';
  }
}
