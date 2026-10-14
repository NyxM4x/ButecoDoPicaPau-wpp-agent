import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrdersService } from './orders.service';

/**
 * El barrido de pedidos, cada minuto.
 *
 * `expireStaleOrders` existía pero nadie la llamaba: un pedido en efectivo que
 * el cliente no confirmaba, o uno con envío sin ubicación, se quedaba abierto
 * para siempre. Aquí se cancelan a los 20 y a los 45 minutos.
 *
 * `autoCompleteOrders` es del modo «sin POS»: cierra los pedidos firmes que
 * nadie va a marcar como entregados.
 */
@Injectable()
export class OrdersMaintenanceCron {
  private readonly logger = new Logger(OrdersMaintenanceCron.name);
  /** Una pasada lenta no se pisa con la siguiente. */
  private running = false;

  constructor(private readonly orders: OrdersService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.orders.expireStaleOrders();
      if (expired.cancelled > 0) {
        this.logger.log(
          `Cancelados ${expired.cancelled} pedidos vencidos (${expired.cashUnconfirmed} sin confirmar efectivo, ${expired.awaitingLocation} sin ubicación).`,
        );
      }
      const closed = await this.orders.autoCompleteOrders();
      if (closed.completed > 0) {
        this.logger.log(`Cerrados ${closed.completed} pedidos como entregados (modo sin POS).`);
      }
    } catch (error) {
      this.logger.warn(`El barrido de pedidos falló: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
