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
import {
  IDEMPOTENCY_HEADER,
  POS_ERROR,
  POS_ROUTES,
  type CentralActiveOrder,
  type CentralAttachLocationBody,
  type CentralCustomer,
  type CentralDeliveryQuote,
  type CentralDeliveryQuoteBody,
  type CentralOrder,
} from './contract';
import { toE164, type CentralRequestFn } from './orders';

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

  const customer = await deps.request<CentralCustomer>(POS_ROUTES.findOrCreateCustomer, {
    method: 'POST',
    body: { phone: toE164(input.customerPhoneDigits) },
  });

  const active = await deps.request<CentralActiveOrder | null>(POS_ROUTES.activeOrder(customer.body.id));
  const order = active.body;
  // Sin pedido en curso, el pin es una consulta suelta: lo dice `not_found`.
  if (!order || !order.orderId) return { result: 'not_found' };

  const view = { id: order.orderId, order_number: order.orderNumber, status: toAgentStatus(order.status) };

  if (order.status !== 'awaiting_location') {
    // Ya tenía ubicación: el cliente la reenvió. No es un error.
    return order.locationReceived ? { result: 'already_attached', order: view } : { result: 'invalid_status' };
  }

  try {
    const body: CentralAttachLocationBody = { latitude: input.latitude, longitude: input.longitude };
    const updated = await deps.request<CentralOrder>(POS_ROUTES.orderLocation(order.orderId), {
      method: 'POST',
      body,
    });
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
    // Otro pin llegó entre la lectura y la escritura: transitorio.
    if (code === POS_ERROR.locationConflict) return { result: 'concurrent_update' };
    if (code === POS_ERROR.locationAlreadyAttached) return { result: 'already_attached', order: view };
    // El pedido dejó de esperar ubicación (se canceló, pasó a retiro…).
    if (code === POS_ERROR.locationNotExpected) return { result: 'invalid_status' };
    throw error;
  }
}

// ── Cotizar un punto sin pedido ─────────────────────────────────────────────

export type CentralQuoteResult =
  | { result: 'quoted'; amount: number }
  /** Fuera del tarifario del POS: no hay un precio que darle al cliente. */
  | { result: 'out_of_coverage' }
  | { result: 'failed'; error: string };

export interface CentralQuoteInput {
  customerPhoneDigits: string;
  /** Id del mensaje de WhatsApp con la ubicación: es la clave de idempotencia. */
  sourceMessageId: string;
  latitude: number;
  longitude: number;
}

/**
 * "¿Cuánto sale el envío hasta aquí?", preguntado al POS (`POST /delivery/quotes`).
 *
 * El cliente mandó su ubicación sin tener un pedido. Cotiza el POS, con su
 * tarifario y las coordenadas de su perfil: el agente no mide ni calcula.
 *
 * La clave sale del mensaje, así que un webhook entregado dos veces devuelve la
 * misma cotización en vez de medir de nuevo. NUNCA lanza: un POS caído es un
 * `failed`, y el cliente recibe "no pude calcularlo" en vez de silencio.
 */
export async function quoteCentralLocation(
  input: CentralQuoteInput,
  deps: { request: CentralRequestFn },
): Promise<CentralQuoteResult> {
  if (!input.customerPhoneDigits) return { result: 'failed', error: 'missing_phone' };

  try {
    const customer = await deps.request<CentralCustomer>(POS_ROUTES.findOrCreateCustomer, {
      method: 'POST',
      body: { phone: toE164(input.customerPhoneDigits) },
    });
    const body: CentralDeliveryQuoteBody = {
      customerId: customer.body.id,
      latitude: input.latitude,
      longitude: input.longitude,
    };
    const quote = await deps.request<CentralDeliveryQuote>(POS_ROUTES.deliveryQuotes, {
      method: 'POST',
      headers: { [IDEMPOTENCY_HEADER]: `quote:${input.sourceMessageId}` },
      body,
    });

    const { status, feeAmount, errorCode } = quote.body;
    if (status === 'quoted' && typeof feeAmount === 'number' && Number.isFinite(feeAmount)) {
      return { result: 'quoted', amount: feeAmount };
    }
    if (status === 'manual_quote') return { result: 'out_of_coverage' };
    return { result: 'failed', error: errorCode ?? 'quote_failed' };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { result: 'failed', error: typeof code === 'string' ? code : 'unknown' };
  }
}
