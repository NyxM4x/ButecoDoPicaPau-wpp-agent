import 'server-only';
import type { AttachLocationResult } from '@/lib/orders/attach-location';
import { centralRequest, isCentralEnabled } from './client';
import {
  attachCentralLocation,
  quoteCentralLocation,
  type CentralLocationInput,
  type CentralQuoteInput,
  type CentralQuoteResult,
} from './location';
import { decideCentralCashOrder, withCentralCashOrder } from './cash';
import { runCentralStaffAction, type CentralStaffActionOutcome } from './staff-actions';
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

/** Cotiza en el POS el envío hasta un punto, sin pedido. Nunca lanza. */
export function quoteCentralDelivery(input: CentralQuoteInput): Promise<CentralQuoteResult> {
  return quoteCentralLocation(input, { request: centralRequest });
}

/** Ejecuta en el POS la acción de un botón del personal. Nunca lanza. */
export function runStaffAction(action: string, actor: string | null): Promise<CentralStaffActionOutcome> {
  return runCentralStaffAction({ action, actor }, { request: centralRequest });
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
