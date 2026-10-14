import { OrderDeliveryType, OrderStatus } from '../database/types';

/**
 * Lo que el personal puede hacer con un pedido desde el aviso de Telegram.
 *
 * En modo «sin POS» no hay pantalla de cocina: el aviso del pedido lleva tres
 * botones —Listo, Salió, Entregado— y cada toque mueve el pedido y le avisa al
 * cliente. Sigue el esquema de botones del backend central: cada botón es una
 * etiqueta y una `action`, que es la ruta de este backend que el agente llama
 * cuando alguien lo toca.
 *
 * Módulo puro: decide, no escribe.
 */

export type StaffAction = 'ready' | 'out' | 'delivered';

export const STAFF_ACTIONS: readonly StaffAction[] = ['ready', 'out', 'delivered'];

export interface StaffButton {
  label: string;
  /** Ruta relativa de este backend: el agente hace `POST /<action>`. */
  action: string;
}

const LABELS: Record<StaffAction, string> = {
  ready: '✅ Listo',
  out: '🛵 Salió',
  delivered: '📦 Entregado',
};

/** A qué estado lleva cada acción. */
const TARGET: Record<StaffAction, OrderStatus> = {
  ready: 'ready',
  out: 'out_for_delivery',
  delivered: 'delivered',
};

/** El recorrido de un pedido firme, en orden. */
const PROGRESS: OrderStatus[] = [
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
];

export function staffActionPath(orderId: string, action: StaffAction): string {
  return `orders/${orderId}/staff/${action}`;
}

/**
 * Los botones que todavía tienen sentido para un pedido.
 *
 * Solo los pasos que le quedan por delante: un pedido ya «Listo» no vuelve a
 * ofrecer «Listo». «Salió» es solo para envíos. Un pedido cerrado no ofrece
 * ninguno.
 */
export function staffButtonsFor(order: {
  id: string;
  status: OrderStatus;
  delivery_type: OrderDeliveryType;
}): StaffButton[] {
  const at = PROGRESS.indexOf(order.status);
  if (at < 0) return [];
  return STAFF_ACTIONS.filter((action) => {
    if (action === 'out' && order.delivery_type !== 'delivery') return false;
    return PROGRESS.indexOf(TARGET[action]) > at;
  }).map((action) => ({ label: LABELS[action], action: staffActionPath(order.id, action) }));
}

export type StaffActionDecision =
  /** Mover el pedido a `to`. */
  | { kind: 'advance'; from: OrderStatus; to: OrderStatus }
  /** Ya estaba ahí o más adelante: no se hace nada y no es un error. */
  | { kind: 'noop' }
  | { kind: 'reject'; code: 'order_not_firm' | 'invalid_state_transition'; message: string };

/**
 * Qué hacer cuando alguien toca un botón.
 *
 * ── Se puede saltar pasos ───────────────────────────────────────────────────
 *
 * Sin pantalla de cocina nadie marca «en preparación», y hay locales que solo
 * van a tocar «Entregado». Cualquier paso hacia adelante vale.
 *
 * ── Tocar dos veces no es un error ──────────────────────────────────────────
 *
 * Dos personas del grupo pueden tocar «Listo» a la vez, y Telegram puede
 * reenviar un toque. El segundo no hace nada: el pedido ya está ahí.
 *
 * ── Solo pedidos firmes ─────────────────────────────────────────────────────
 *
 * Un pedido que el cliente no confirmó o no pagó no se prepara. El aviso con
 * los botones solo sale de un pedido firme, así que esto no debería pasar; la
 * guarda está por si el pedido cambió después.
 */
export function decideStaffAction(
  order: {
    status: OrderStatus;
    delivery_type: OrderDeliveryType;
    payment_method: string;
    payment_status: string;
    cash_confirmed_at: Date | string | null;
  },
  action: StaffAction,
): StaffActionDecision {
  if (order.status === 'cancelled') {
    return {
      kind: 'reject',
      code: 'invalid_state_transition',
      message: 'El pedido está cancelado.',
    };
  }
  const at = PROGRESS.indexOf(order.status);
  if (at < 0) {
    return {
      kind: 'reject',
      code: 'invalid_state_transition',
      message: `El pedido está en ${order.status} y todavía no se puede mover.`,
    };
  }
  if (action === 'out' && order.delivery_type !== 'delivery') {
    return {
      kind: 'reject',
      code: 'invalid_state_transition',
      message: 'El pedido no es de envío: no sale a reparto.',
    };
  }

  const target = TARGET[action];
  if (PROGRESS.indexOf(target) <= at) return { kind: 'noop' };

  const firm =
    (order.payment_method === 'cash' && order.cash_confirmed_at !== null) ||
    order.payment_status === 'paid';
  if (!firm) {
    return {
      kind: 'reject',
      code: 'order_not_firm',
      message: 'El pedido todavía no está confirmado ni pagado.',
    };
  }
  return { kind: 'advance', from: order.status, to: target };
}

/** Cómo se dice cada estado en el aviso del personal. */
const STATUS_LABEL: Partial<Record<OrderStatus, string>> = {
  ready: 'LISTO',
  out_for_delivery: 'SALIÓ A REPARTO',
  delivered: 'ENTREGADO',
  cancelled: 'CANCELADO',
};

/**
 * La línea de estado que se agrega al aviso cuando alguien tocó un botón:
 * `➡️ LISTO · Juan · 21:05`. Vacía mientras nadie haya movido el pedido.
 */
export function staffStatusLine(input: {
  status: OrderStatus;
  actor: string | null;
  at: Date;
  timeZone: string;
}): string | null {
  const label = STATUS_LABEL[input.status];
  if (!label) return null;
  let hour = '';
  try {
    hour = new Intl.DateTimeFormat('es', {
      timeZone: input.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(input.at);
  } catch {
    hour = '';
  }
  return ['➡️ ' + label, input.actor, hour].filter(Boolean).join(' · ');
}

/**
 * Lo que se le dice al cliente en cada paso, o `null` si no se le dice nada.
 *
 * «Entregado» solo manda la despedida propia del local, si escribió una: el
 * cliente ya tiene el pedido en la mano y un mensaje genérico sobra.
 */
export function customerNoticeFor(input: {
  to: OrderStatus;
  orderNumber: string;
  deliveryType: OrderDeliveryType;
  farewell: string | null;
}): string | null {
  switch (input.to) {
    case 'ready':
      return input.deliveryType === 'delivery'
        ? `Tu pedido ${input.orderNumber} ya está listo y sale en breve hacia tu dirección 🛵`
        : `Tu pedido ${input.orderNumber} ya está listo 🙌 Puedes pasar a retirarlo.`;
    case 'out_for_delivery':
      return `Tu pedido ${input.orderNumber} ya salió y va en camino 🛵`;
    case 'delivered':
      return input.farewell?.trim() || null;
    default:
      return null;
  }
}
