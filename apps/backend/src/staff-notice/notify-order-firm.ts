import { Logger } from '@nestjs/common';
import { Kysely } from 'kysely';
import { Database } from '../database/types';
import { NotificationsOutService } from '../notifications-out/notifications-out.service';
import { StaffButton, staffButtonsFor, staffStatusLine } from './staff-actions';
import { staffOrderNoticeText } from './staff-order-notice';

export const STAFF_ORDER_NOTICE_KIND = 'order_firm_staff_notice';

/** Con qué prefijo queda registrado quién movió un pedido desde Telegram. */
export const TELEGRAM_ACTOR_PREFIX = 'telegram:';

const logger = new Logger('StaffOrderNotice');

export interface StaffNotice {
  /** El aviso completo, con la línea de estado si alguien ya movió el pedido. */
  text: string;
  /** Los botones que todavía tienen sentido. */
  buttons: StaffButton[];
}

/**
 * El aviso del pedido tal como está AHORA: lo usa el primer envío y lo vuelve a
 * usar cada toque de botón, que reemplaza el mensaje por su versión actual.
 *
 * `null` si el pedido no existe o el modo «sin POS» está apagado.
 */
export async function loadStaffNotice(
  db: Kysely<Database>,
  orderId: string,
): Promise<(StaffNotice & { firm: boolean }) | null> {
  const settings = await db
    .selectFrom('operational_settings')
    .select(['requires_cash_register', 'currency_symbol', 'restaurant_timezone'])
    .where('id', '=', true)
    .executeTakeFirst();
  if (!settings || settings.requires_cash_register) return null;

  const order = await db
    .selectFrom('orders')
    .selectAll()
    .where('id', '=', orderId)
    .executeTakeFirst();
  if (!order) return null;

  const paid = order.payment_status === 'paid' && order.payment_method !== 'cash';
  const cashConfirmed = order.payment_method === 'cash' && order.cash_confirmed_at !== null;

  const [items, promotions, customer] = await Promise.all([
    db.selectFrom('order_items').selectAll().where('order_id', '=', orderId).execute(),
    db.selectFrom('order_promotions').selectAll().where('order_id', '=', orderId).execute(),
    order.customer_id
      ? db
          .selectFrom('customers')
          .select('phone')
          .where('id', '=', order.customer_id)
          .executeTakeFirst()
      : Promise.resolve(undefined),
  ]);

  const body = staffOrderNoticeText({
    orderNumber: order.order_number,
    deliveryType: order.delivery_type,
    paymentMethod: order.payment_method,
    paid,
    customerName: order.customer_name,
    customerPhone: customer?.phone ?? null,
    lines: [
      ...items.map((item) => ({
        name: item.product_name_snapshot,
        quantity: item.quantity,
        subtotal: Number(item.subtotal),
      })),
      ...promotions.map((promotion) => ({
        name: promotion.promotion_name_snapshot,
        quantity: promotion.combo_quantity,
        subtotal: Number(promotion.subtotal),
        components: promotion.components_snapshot.map((component) => ({
          name: component.name,
          quantity: component.quantity,
        })),
      })),
    ],
    notes: order.notes,
    latitude: order.delivery_latitude,
    longitude: order.delivery_longitude,
    deliveryDistanceMeters: order.delivery_distance_meters,
    subtotalAmount: Number(order.subtotal_amount),
    deliveryAmount: Number(order.delivery_base_amount) + Number(order.delivery_surcharge_amount),
    totalAmount: Number(order.total_amount),
    currencySymbol: settings.currency_symbol,
  });

  const movedBy = order.status_updated_by ?? '';
  const statusLine = staffStatusLine({
    status: order.status,
    // Solo se nombra a quien tocó un botón; «auto_complete» o un vencimiento no son nadie.
    actor: movedBy.startsWith(TELEGRAM_ACTOR_PREFIX)
      ? movedBy.slice(TELEGRAM_ACTOR_PREFIX.length) || null
      : null,
    at: new Date(order.updated_at),
    timeZone: settings.restaurant_timezone,
  });

  return {
    text: statusLine ? `${body}\n\n${statusLine}` : body,
    buttons: staffButtonsFor(order),
    firm: order.status === 'confirmed' && (paid || cashConfirmed),
  };
}

/**
 * Avisa al personal, por Telegram, de un pedido que ya quedó FIRME.
 *
 * Solo en modo «sin POS» (`requires_cash_register = false`): con un POS, el
 * pedido ya está en la pantalla de cocina y este mensaje sobraría.
 *
 * «Firme» es que ya no depende del cliente: confirmó el efectivo, o el pago
 * por QR entró. Antes de eso el pedido puede caerse solo, y avisar a cocina de
 * un pedido que después se cancela es peor que avisar un minuto más tarde.
 *
 * El aviso lleva los botones Listo / Salió / Entregado (`staff-actions.ts`).
 *
 * NUNCA lanza: el pedido ya está guardado y cobrado, y un fallo aquí no puede
 * deshacer eso. Si Telegram no responde, el trabajo queda en cola y
 * `NotificationRecoveryCron` lo reintenta. Una sola vez por pedido: la cola
 * deduplica por tipo de aviso y pedido.
 *
 * Es una función y no un servicio inyectable porque la llaman dos módulos
 * (pedidos y cobros) que ya tienen la base y la cola de avisos a mano.
 */
export async function notifyStaffOrderFirm(
  db: Kysely<Database>,
  notifications: NotificationsOutService,
  orderId: string,
): Promise<'sent' | 'skipped'> {
  try {
    const notice = await loadStaffNotice(db, orderId);
    if (!notice || !notice.firm) return 'skipped';

    await notifications.notifyNow({
      channel: 'telegram',
      kind: STAFF_ORDER_NOTICE_KIND,
      targetRef: orderId,
      payload: { chatRef: 'staff-group', text: notice.text, buttons: notice.buttons },
    });
    return 'sent';
  } catch (error) {
    logger.warn(`No se pudo avisar al personal del pedido ${orderId}: ${(error as Error).message}`);
    return 'skipped';
  }
}
