import 'server-only';
import type { AttachLocationResult } from '@/lib/orders/attach-location';
import { centralRequest, isCentralEnabled } from './client';
import { attachCentralLocation, type CentralLocationInput } from './location';

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
