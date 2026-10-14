import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY } from '../database/database.module';
import { Database } from '../database/types';
import { NotFoundDomainError } from '../common/exceptions/domain-exception';
import { NotificationsOutService } from '../notifications-out/notifications-out.service';
import { QR_GENERATION_GRACE_MS, QR_PAYMENT_WINDOW_MINUTES } from './qr-expiry';
import { QrPaymentsService } from './qr-payments.service';

/** `deferred`: el QR no salió todavía y se le avisó al cliente que va a tardar. */
export type QrCheckoutNotificationResult = 'skipped' | 'notified' | 'deferred';

const QR_NOTICE_KIND = 'qr_confirmation';
const QR_DELAYED_NOTICE_KIND = 'qr_delayed_notice';

const RETRY_BATCH_SIZE = 20;
/**
 * El reintento no toca un pedido recién confirmado: el primer intento corre
 * apenas el total queda definitivo, y si los dos coinciden le piden al banco
 * dos QR para el mismo pedido.
 */
const RETRY_MIN_AGE_MS = 90_000;

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
      .where('kind', '=', QR_NOTICE_KIND)
      .where('target_ref', '=', order.id)
      .executeTakeFirst();
    if (
      existingNotification &&
      ['pending', 'sending', 'sent'].includes(existingNotification.status)
    ) {
      return 'skipped';
    }

    const settings = await this.db
      .selectFrom('operational_settings')
      .select(['currency_symbol', 'requires_cash_register'])
      .where('id', '=', true)
      .executeTakeFirst();
    const total = `${settings?.currency_symbol ?? 'Bs'} ${Number(order.total_amount).toFixed(2)}`;
    // Modo «sin POS»: no hay pantalla donde alguien acepte una captura.
    const posless = settings?.requires_cash_register === false;

    let payload: { customerId: string; text: string; imageUrl?: string };
    try {
      const charge = await this.qrPayments.generateForOrder(order.id);
      payload = {
        customerId: order.customer_id,
        text:
          `Tu pedido ${order.order_number} es ${total}. Escaneá el QR para pagar.` +
          (posless ? ` El QR vence en ${QR_PAYMENT_WINDOW_MINUTES} minutos.` : ''),
        // Una ruta de este backend, que pide token: el agente la descarga con el
        // suyo y sube la imagen a WhatsApp. El QR nunca tiene dirección pública.
        imageUrl: charge.qrImageUrl,
      };
    } catch (error) {
      if (posless) {
        this.logger.error(
          `No se pudo generar el QR de ${order.id}; se reintenta: ${(error as Error).message}`,
        );
        await this.notifyDelayedOnce(order.id, order.customer_id, order.order_number, total);
        return 'deferred';
      }
      this.logger.warn(
        `No se pudo generar el QR real para ${order.id}, cae a captura: ${(error as Error).message}`,
      );
      payload = {
        customerId: order.customer_id,
        text: `Tu pedido ${order.order_number} es ${total}. Cuando pagues, responde a este mensaje con la captura.`,
      };
    }

    await this.notifications.notifyNow({
      channel: 'whatsapp',
      kind: QR_NOTICE_KIND,
      targetRef: order.id,
      payload,
    });
    return 'notified';
  }

  /**
   * Modo «sin POS»: vuelve a intentar los QR que no se pudieron generar (el
   * banco no respondió). Con un POS no hace nada: ahí el cliente ya recibió
   * las instrucciones para mandar la captura.
   *
   * Solo insiste durante `QR_GENERATION_GRACE_MS`; después, el barrido de
   * vencidos cancela el pedido y avisa.
   */
  async retryUndelivered(now = new Date()): Promise<{ retried: number; delivered: number }> {
    const result = { retried: 0, delivered: 0 };
    const settings = await this.db
      .selectFrom('operational_settings')
      .select('requires_cash_register')
      .where('id', '=', true)
      .executeTakeFirst();
    if (settings?.requires_cash_register !== false) return result;

    const orders = await this.db
      .selectFrom('orders')
      .select('id')
      .where('payment_method', '=', 'qr')
      .where('status', '=', 'confirmed')
      .where('payment_status', '=', 'unpaid')
      .where('customer_id', 'is not', null)
      .where('confirmed_at', 'is not', null)
      .where('confirmed_at', '>', new Date(now.getTime() - QR_GENERATION_GRACE_MS))
      .where('confirmed_at', '<', new Date(now.getTime() - RETRY_MIN_AGE_MS))
      .orderBy('confirmed_at', 'asc')
      .limit(RETRY_BATCH_SIZE)
      .execute();
    if (orders.length === 0) return result;

    // Con el aviso del QR ya en la cola —enviado o fallando— no hay nada que
    // generar: de reintentar un envío fallido se ocupa la cola de avisos.
    const queued = await this.db
      .selectFrom('notification_jobs')
      .select('target_ref')
      .where('kind', '=', QR_NOTICE_KIND)
      .where(
        'target_ref',
        'in',
        orders.map((order) => order.id),
      )
      .execute();
    const alreadyQueued = new Set(queued.map((job) => job.target_ref));

    for (const order of orders) {
      if (alreadyQueued.has(order.id)) continue;
      result.retried += 1;
      try {
        if ((await this.notifyIfReady(order.id)) === 'notified') result.delivered += 1;
      } catch (error) {
        this.logger.warn(`Reintento del QR de ${order.id} falló: ${(error as Error).message}`);
      }
    }
    return result;
  }

  /** Una sola vez por pedido, por más que el QR se reintente cada minuto. */
  private async notifyDelayedOnce(
    orderId: string,
    customerId: string,
    orderNumber: string,
    total: string,
  ): Promise<void> {
    const existing = await this.db
      .selectFrom('notification_jobs')
      .select('status')
      .where('kind', '=', QR_DELAYED_NOTICE_KIND)
      .where('target_ref', '=', orderId)
      .executeTakeFirst();
    if (existing) return;

    await this.notifications.notifyNow({
      channel: 'whatsapp',
      kind: QR_DELAYED_NOTICE_KIND,
      targetRef: orderId,
      payload: {
        customerId,
        text: `Tu pedido ${orderNumber} es ${total}. Estamos generando tu QR de pago: te lo enviamos en unos minutos.`,
      },
    });
  }
}
