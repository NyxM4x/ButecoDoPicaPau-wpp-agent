/**
 * La ubicación que el cliente manda por WhatsApp, entregada al backend central.
 *
 * Sustituye a `attachLocation` / `attachLooseLocation` cuando el pedido vive en
 * el backend. Allí adjuntar la ubicación hace todo de una vez: guarda el punto,
 * cotiza el envío, cierra el total y —si corresponde— manda el QR y confirma el
 * pedido, que es cuando aparece en la cocina del POS. Por eso aquí no hay un
 * paso de cotización aparte.
 *
 * A qué pedido pertenece el pin lo decide el backend (`active-order`), no el
 * mensaje al que el cliente respondió: el agente ya no guarda pedidos con los
 * que correlacionar.
 *
 * Sin `server-only`, con la petición inyectada.
 */
import type { AttachLocationResult } from '@/lib/orders/attach-location';
import type { OrderStatus } from '@/types';
import { toE164, type CentralRequestFn } from './orders';

interface ActiveOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  locationReceived?: boolean;
}

function toAgentStatus(status: string): OrderStatus {
  return (status === 'out_for_delivery' ? 'on_the_way' : status) as OrderStatus;
}

export interface CentralLocationInput {
  customerPhoneDigits: string;
  latitude: number;
  longitude: number;
}

export async function attachCentralLocation(
  input: CentralLocationInput,
  deps: { request: CentralRequestFn },
): Promise<AttachLocationResult> {
  if (!input.customerPhoneDigits) return { result: 'not_found' };

  const customer = await deps.request<{ id: string }>('/customers/find-or-create', {
    method: 'POST',
    body: { phone: toE164(input.customerPhoneDigits) },
  });

  const active = await deps.request<ActiveOrder | null>(`/customers/${customer.body.id}/active-order`);
  const order = active.body;
  // Sin pedido en curso, el pin es una consulta suelta: lo dice `not_found`.
  if (!order || !order.orderId) return { result: 'not_found' };

  const view = { id: order.orderId, order_number: order.orderNumber, status: toAgentStatus(order.status) };

  if (order.status !== 'awaiting_location') {
    // Ya tenía ubicación: el cliente la reenvió. No es un error.
    return order.locationReceived ? { result: 'already_attached', order: view } : { result: 'invalid_status' };
  }

  try {
    const updated = await deps.request<{ id: string; orderNumber: string; status: string }>(
      `/orders/${order.orderId}/location`,
      { method: 'POST', body: { latitude: input.latitude, longitude: input.longitude } },
    );
    return {
      result: 'attached',
      order: {
        id: updated.body.id,
        order_number: updated.body.orderNumber,
        status: toAgentStatus(updated.body.status),
      },
    };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    // Otro proceso movió el pedido entre la lectura y la escritura: transitorio.
    if (code === 'status_conflict') return { result: 'concurrent_update' };
    if (code === 'location_already_attached') return { result: 'already_attached', order: view };
    if (code === 'invalid_state_transition' || code === 'order_not_awaiting_location') {
      return { result: 'invalid_status' };
    }
    throw error;
  }
}
