import type { WhatsappReplyButton } from '../gateway-client/gateway-client.service';

/**
 * Desglose del pedido en efectivo, con los botones CONFIRMAR / CANCELAR.
 *
 * Sale cuando el total ya es definitivo: al cotizar el envío (delivery) o al
 * crearse el pedido (retiro en el local). Hasta que el cliente toca CONFIRMAR
 * el pedido no se prepara, y si no toca nada el barrido de 20 minutos de
 * `expireStaleOrders` lo cancela.
 *
 * Los ids de los botones son un contrato con el agente de WhatsApp
 * (`CASH_CONFIRM_BUTTON_PREFIX` / `CASH_CANCEL_BUTTON_PREFIX` en
 * `apps/agent-whatsapp/src/lib/kapso/messages.ts`): llevan el número de pedido
 * para que un botón de un mensaje viejo no decida sobre el pedido de hoy.
 */
export const CASH_CONFIRM_BUTTON_PREFIX = 'cash_confirm:';
export const CASH_CANCEL_BUTTON_PREFIX = 'cash_cancel:';

/** Límite de WhatsApp para el cuerpo de un mensaje con botones, con margen. */
const BODY_MAX = 1000;

export interface CashReviewLine {
  name: string;
  quantity: number;
  subtotal: number;
}

export interface CashReviewInput {
  orderNumber: string;
  deliveryType: string;
  lines: CashReviewLine[];
  deliveryAmount: number;
  deliveryDistanceMeters: number | null;
  totalAmount: number;
}

function bs(amount: number): string {
  return `Bs ${amount.toFixed(2)}`;
}

function distance(meters: number | null): string {
  if (meters === null || meters <= 0) return '';
  return ` (${(meters / 1000).toFixed(1)} km)`;
}

export function cashReviewButtons(orderNumber: string): WhatsappReplyButton[] {
  return [
    { id: `${CASH_CONFIRM_BUTTON_PREFIX}${orderNumber}`, title: '✅ CONFIRMAR' },
    { id: `${CASH_CANCEL_BUTTON_PREFIX}${orderNumber}`, title: '❌ CANCELAR' },
  ];
}

export function cashReviewText(input: CashReviewInput): string {
  const isDelivery = input.deliveryType === 'delivery';
  const head = [`Tu pedido ${input.orderNumber} quedó así 👇`, ''];
  const tail = [
    ...(isDelivery && input.deliveryAmount > 0
      ? [`Envío: ${bs(input.deliveryAmount)}${distance(input.deliveryDistanceMeters)}`]
      : []),
    `*Total: ${bs(input.totalAmount)}*, pagás en efectivo ${isDelivery ? 'al recibirlo' : 'al retirarlo'}.`,
    '',
    '¿Lo confirmamos? Tocá un botón 👇',
  ];

  const lines = input.lines.map((l) => `• ${l.quantity}x ${l.name} — ${bs(l.subtotal)}`);

  // Un pedido enorme no puede dejar sin botones al cliente: se recortan las
  // líneas, nunca el total ni la pregunta.
  const fixedLength = [...head, ...tail].join('\n').length + 1;
  const kept: string[] = [];
  let used = fixedLength;
  for (const [index, line] of lines.entries()) {
    const remaining = lines.length - index - 1;
    const reserve = remaining > 0 ? 20 : 0;
    if (used + line.length + 1 + reserve > BODY_MAX) {
      kept.push(`…y ${lines.length - index} más`);
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }

  return [...head, ...kept, ...tail].join('\n');
}

/** Respuesta al CONFIRMAR: el pedido ya puede prepararse. */
export function cashConfirmedText(input: {
  orderNumber: string;
  deliveryType: string;
  totalAmount: number;
}): string {
  const when = input.deliveryType === 'delivery' ? 'al recibirlo' : 'al retirarlo';
  return `¡Listo! Tu pedido ${input.orderNumber} está confirmado y ya pasa a cocina 🙌 Pagás ${bs(input.totalAmount)} en efectivo ${when}.`;
}
