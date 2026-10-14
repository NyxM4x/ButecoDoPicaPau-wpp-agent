import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QrCheckoutService } from './qr-checkout.service';
import { QrPaymentsService } from './qr-payments.service';

/**
 * El barrido de pedidos por QR del modo «sin POS», cada minuto.
 *
 * Reintenta los QR que el banco no entregó y cancela los pedidos que nadie
 * pagó. Con un POS las dos pasadas no hacen nada: ahí lo resuelve el cajero.
 *
 * Va aparte de `OrdersMaintenanceCron` porque cada pedido le cuesta una
 * consulta al banco, y un banco lento no debe frenar el barrido del efectivo.
 */
@Injectable()
export class QrOrdersMaintenanceCron {
  private readonly logger = new Logger(QrOrdersMaintenanceCron.name);
  /** Una pasada lenta no se pisa con la siguiente. */
  private running = false;

  constructor(
    private readonly qrCheckout: QrCheckoutService,
    private readonly qrPayments: QrPaymentsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const retried = await this.qrCheckout.retryUndelivered();
      if (retried.retried > 0) {
        this.logger.log(
          `Reintentados ${retried.retried} QR sin generar (${retried.delivered} enviados).`,
        );
      }
      const expired = await this.qrPayments.expireUnpaidOrders();
      if (expired.unpaid + expired.neverGenerated > 0) {
        this.logger.log(
          `Cancelados ${expired.unpaid + expired.neverGenerated} pedidos por QR (${expired.unpaid} sin pagar, ${expired.neverGenerated} sin QR generado).`,
        );
      }
    } catch (error) {
      this.logger.warn(`El barrido de pedidos por QR falló: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
