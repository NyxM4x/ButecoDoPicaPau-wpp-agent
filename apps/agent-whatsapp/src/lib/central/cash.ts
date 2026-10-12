/**
 * CONFIRMAR / CANCELAR del pedido en efectivo cuando el pedido vive en el
 * backend central.
 *
 * El backend manda el desglose con los dos botones al cotizar el envío (o al
 * crear un pedido para retirar). Cuando el cliente toca uno, el webhook decide
 * con `decideDefaultReply`, que necesita ver el pedido como `openOrder` con
 * `awaitingCashConfirm`. Las tablas del agente ya no tienen ese pedido, así que
 * aquí se le pregunta al backend (`active-order`) y la decisión se le entrega a
 * él (`cash/confirm` o `cash/cancel`). La respuesta al cliente la manda el
 * backend; el agente no contesta nada por su cuenta.
 *
 * El pedido del backend solo se pone en el estado del cliente mientras espera
 * su CONFIRMAR. Con él, un texto suelto del cliente recibe los botones otra vez
 * en vez del menú. Fuera de ese momento el estado queda como estaba: los demás
 * caminos (nota de cocina, cambio de pedido…) todavía leen las tablas del
 * agente y no sabrían qué hacer con un pedido del backend.
 *
 * Sin `server-only`, con la petición inyectada.
 */
import type { CustomerStateSnapshot, OpenOrderSnapshot } from '@/lib/webhook/default-reply';
import type { DeliveryType } from '@/types';
import { toE164, type CentralRequestFn } from './orders';

interface ActiveOrderContext {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  totalAmount: number;
  subtotalAmount: number;
  deliveryType: string;
  cashConfirmed: boolean;
  locationReceived: boolean;
  proofReceived: boolean;
}

const EMPTY_STATE: CustomerStateSnapshot = {
  paused: false,
  openOrder: null,
  proofRemindedRecently: false,
};

/** El pedido en efectivo del cliente que espera su CONFIRMAR, o `null`. */
export async function findCentralCashOrderAwaitingConfirm(
  customerPhoneDigits: string,
  deps: { request: CentralRequestFn },
): Promise<OpenOrderSnapshot | null> {
  if (!customerPhoneDigits) return null;

  const customer = await deps.request<{ id: string }>('/customers/find-or-create', {
    method: 'POST',
    body: { phone: toE164(customerPhoneDigits) },
  });
  const active = await deps.request<ActiveOrderContext | null>(
    `/customers/${customer.body.id}/active-order`,
  );
  const order = active.body;
  if (!order || !order.orderId) return null;
  if (order.paymentMethod !== 'cash' || order.status !== 'confirmed' || order.cashConfirmed) {
    return null;
  }

  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    status: 'confirmed',
    totalAmount: Number(order.totalAmount) || 0,
    foodAmount: Number(order.subtotalAmount) || 0,
    payment: 'not_required',
    proofReceived: order.proofReceived === true,
    paymentMethod: 'cash',
    awaitingCashConfirm: true,
    cashConfirmed: false,
    deliveryType: order.deliveryType === 'delivery' || order.deliveryType === 'pickup'
      ? (order.deliveryType as DeliveryType)
      : null,
    locationReceived: order.locationReceived === true,
  };
}

/**
 * El estado del cliente con su pedido en efectivo del backend, si hay uno
 * esperando CONFIRMAR. NUNCA lanza: si el backend no responde, el estado queda
 * como lo dejó la consulta de siempre.
 */
export async function withCentralCashOrder(
  state: CustomerStateSnapshot | null,
  customerPhoneDigits: string,
  deps: { request: CentralRequestFn },
): Promise<CustomerStateSnapshot | null> {
  // Con una persona al mando no se toca nada: la pausa manda.
  if (state?.paused) return state;

  try {
    const order = await findCentralCashOrderAwaitingConfirm(customerPhoneDigits, deps);
    if (!order) return state;
    return { ...(state ?? EMPTY_STATE), openOrder: order };
  } catch {
    return state;
  }
}

/**
 * Entrega al backend lo que tocó el cliente. NUNCA lanza.
 *
 * `ok: false` = no se pudo, y el mensaje sigue su camino en el webhook. El
 * backend rechaza cancelar un pedido ya confirmado (`cash_order_already_confirmed`)
 * y confirmar sin caja abierta: en los dos casos al cliente no se le dice nada
 * que no sea cierto.
 */
export async function decideCentralCashOrder(
  input: { orderId: string; decision: 'confirm' | 'cancel' },
  deps: { request: CentralRequestFn },
): Promise<{ ok: boolean }> {
  try {
    await deps.request(`/orders/${input.orderId}/cash/${input.decision}`, { method: 'POST' });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
