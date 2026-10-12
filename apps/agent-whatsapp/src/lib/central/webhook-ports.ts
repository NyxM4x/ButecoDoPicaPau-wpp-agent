import 'server-only';
import type { AttachLocationResult } from '@/lib/orders/attach-location';
import { centralRequest, isCentralEnabled } from './client';
import { attachCentralLocation, type CentralLocationInput } from './location';
import { decideCentralCashOrder, withCentralCashOrder } from './cash';
import type { CustomerStateSnapshot } from '@/lib/webhook/default-reply';

type AttachPort = (input: CentralLocationInput) => Promise<AttachLocationResult>;

/**
 * Los puertos de ubicación del webhook cuando el pedido vive en el backend
 * central, o `null` si no está activado (y entonces mandan los de siempre).
 *
 * `quoteDynamicDelivery` va en `undefined` a propósito: el backend cotiza al
 * adjuntar la ubicación, así que el webhook no tiene nada que cotizar después.
 */
export function centralLocationPorts(): {
  attachOrderLocation: AttachPort;
  attachLooseLocation: AttachPort;
  quoteDynamicDelivery: undefined;
} | null {
  if (!isCentralEnabled()) return null;
  const attach: AttachPort = (input) => attachCentralLocation(input, { request: centralRequest });
  return { attachOrderLocation: attach, attachLooseLocation: attach, quoteDynamicDelivery: undefined };
}

type LookupCustomerState = (phone: string) => Promise<CustomerStateSnapshot | null>;

/**
 * Los puertos del CONFIRMAR / CANCELAR en efectivo cuando el pedido vive en el
 * backend central, o `null` si no está activado. Ver `central/cash.ts`.
 *
 * `lookupCustomerState` envuelve la consulta de siempre: la pausa y la memoria
 * del chat siguen saliendo de las tablas del agente, y solo se le suma el
 * pedido del backend que espera la confirmación.
 */
export function centralCashPorts(lookupCustomerState: LookupCustomerState): {
  lookupCustomerState: LookupCustomerState;
  decideCashOrder: (input: { orderId: string; decision: 'confirm' | 'cancel' }) => Promise<{ ok: boolean }>;
} | null {
  if (!isCentralEnabled()) return null;
  const deps = { request: centralRequest };
  return {
    lookupCustomerState: async (phone) =>
      withCentralCashOrder(await lookupCustomerState(phone), phone, deps),
    decideCashOrder: (input) => decideCentralCashOrder(input, deps),
  };
}
