import { BankQrChargeStatus } from '../database/types';

/**
 * Cuánto tiene el cliente para pagar un QR en modo «sin POS», contado desde
 * que se le generó. Pasado ese tiempo el pedido se cancela solo: sin pantalla
 * de caja nadie más lo va a cerrar, y quedaría «en curso» para siempre.
 *
 * 30 minutos: más que los 20 del efectivo sin confirmar, porque pagar pide
 * abrir la aplicación del banco.
 */
export const QR_PAYMENT_WINDOW_MINUTES = 30;
export const QR_PAYMENT_WINDOW_MS = QR_PAYMENT_WINDOW_MINUTES * 60_000;

/**
 * Cuánto se insiste en generar un QR que el banco no entregó (caído, o sin
 * configurar). Pasado ese tiempo el pedido se cancela y se avisa: un cliente
 * no se queda media hora esperando un QR que no llega.
 */
export const QR_GENERATION_GRACE_MS = 10 * 60_000;

export type QrExpiryDecision =
  /** Todavía tiene tiempo. */
  | 'wait'
  /** Hay plata de por medio (cobrado, o cobrado sin aplicar): no se cancela solo. */
  | 'hold'
  /** Tuvo su QR y no lo pagó a tiempo. */
  | 'expire_unpaid'
  /** Nunca se le pudo generar el QR. */
  | 'expire_never_generated';

export interface QrExpiryCharge {
  status: BankQrChargeStatus;
  createdAt: Date;
}

const MONEY_RECEIVED: BankQrChargeStatus[] = ['confirmed', 'paid_unapplied', 'refunded'];

/**
 * Qué hacer con un pedido por QR que sigue sin pagar. `confirmedAt` es cuando
 * su total quedó definitivo, que es cuando se le debió mandar el QR.
 *
 * Una fecha ilegible no vence nada: ante la duda, no se cancela un pedido.
 */
export function decideQrExpiry(input: {
  now: Date;
  confirmedAt: Date;
  charges: QrExpiryCharge[];
}): QrExpiryDecision {
  const { now, confirmedAt, charges } = input;
  if (charges.some((charge) => MONEY_RECEIVED.includes(charge.status))) return 'hold';

  if (charges.length === 0) {
    const waited = now.getTime() - confirmedAt.getTime();
    if (!Number.isFinite(waited)) return 'wait';
    return waited >= QR_GENERATION_GRACE_MS ? 'expire_never_generated' : 'wait';
  }

  const pending = charges.filter((charge) => charge.status === 'pending');
  // Sin ninguno vivo, los que tuvo ya están vencidos o anulados: no hay con qué pagar.
  if (pending.length === 0) return 'expire_unpaid';

  const newest = Math.max(...pending.map((charge) => charge.createdAt.getTime()));
  const elapsed = now.getTime() - newest;
  if (!Number.isFinite(elapsed)) return 'wait';
  return elapsed >= QR_PAYMENT_WINDOW_MS ? 'expire_unpaid' : 'wait';
}
