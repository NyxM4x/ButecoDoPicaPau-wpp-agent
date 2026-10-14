/**
 * Las acciones del personal, entregadas al POS.
 *
 * Alguien tocó un botón del aviso de un pedido en Telegram. El botón guarda la
 * `action` que mandó el POS —la ruta a la que hay que llamar—, y aquí se llama.
 * El POS mueve el pedido, le avisa al cliente y devuelve el aviso actualizado.
 *
 * ── Solo las acciones del contrato ──────────────────────────────────────────
 *
 * La `action` llega de fuera (de un botón), así que no se usa como ruta sin
 * mirarla: tiene que ser una de las que el contrato define. Sin eso, un botón
 * falsificado podría hacer que el agente llamara, con su token, a cualquier
 * ruta del POS.
 *
 * Sin `server-only`, con la petición inyectada.
 */
import {
  POS_ROUTES,
  STAFF_ACTION_PATTERN,
  type CentralStaffActionBody,
  type CentralStaffActionResult,
  type GatewayAlertButton,
} from './contract';
import type { CentralRequestFn } from './orders';

export type CentralStaffActionOutcome =
  | { ok: true; text: string; buttons: GatewayAlertButton[] }
  /** `code` del POS, o `unknown_action` / un código de transporte. */
  | { ok: false; code: string };

/** ¿Es una acción que el agente acepta ejecutar? */
export function isStaffAction(action: string): boolean {
  return STAFF_ACTION_PATTERN.test(action);
}

/** Ejecuta la acción en el POS. NUNCA lanza. */
export async function runCentralStaffAction(
  input: { action: string; actor: string | null },
  deps: { request: CentralRequestFn },
): Promise<CentralStaffActionOutcome> {
  if (!isStaffAction(input.action)) return { ok: false, code: 'unknown_action' };

  try {
    const body: CentralStaffActionBody = input.actor ? { actor: input.actor.slice(0, 60) } : {};
    const result = await deps.request<CentralStaffActionResult>(POS_ROUTES.staffAction(input.action), {
      method: 'POST',
      body,
    });
    const { text, buttons } = result.body ?? ({} as CentralStaffActionResult);
    if (typeof text !== 'string' || text.trim() === '') return { ok: false, code: 'invalid_response' };
    return {
      ok: true,
      text,
      // Solo los botones que también son acciones del contrato.
      buttons: Array.isArray(buttons)
        ? buttons.filter(
            (button) => typeof button?.label === 'string' && typeof button?.action === 'string' && isStaffAction(button.action),
          )
        : [],
    };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof code === 'string' ? code : 'unknown' };
  }
}
