/**
 * El webhook de Telegram: alguien del personal tocó un botón de un aviso.
 *
 * El aviso de un pedido lleva botones (Listo, Salió, Entregado). Cada botón
 * guarda una `action`, que es la ruta del POS a la que hay que llamar. Aquí
 * llega el toque: se comprueba que es de verdad de Telegram y del grupo del
 * personal, se le entrega la acción al POS y el mensaje se reemplaza por el
 * aviso actualizado que el POS devuelve.
 *
 * El agente no decide nada: qué significa cada botón, si el pedido se puede
 * mover y qué se le dice al cliente lo decide el POS.
 *
 * Sin `server-only` y con todo inyectado: se prueba sin Telegram ni POS.
 *
 * ── Siempre 200, salvo el secreto ───────────────────────────────────────────
 *
 * Telegram reintenta cualquier respuesta que no sea 2xx, y un toque reintentado
 * durante horas no arregla nada. Lo que salió mal se le dice a la persona en la
 * respuesta del botón, no a Telegram con un estado HTTP.
 */
import { safeCompare } from '@/lib/security/compare';
import type { GatewayAlertButton } from '@/lib/central/contract';

export type StaffActionOutcome =
  | { ok: true; text: string; buttons: GatewayAlertButton[] }
  | { ok: false; code: string };

export interface TelegramCallbackDeps {
  /** `TELEGRAM_WEBHOOK_SECRET`: el mismo valor que se le dio a Telegram al registrar el webhook. */
  webhookSecret: string | undefined;
  /** El chat del personal (`TELEGRAM_CHAT_ID`). Un toque desde otro chat no vale. */
  chatId: string | undefined;
  /** Le entrega la acción al POS. Nunca lanza. */
  runAction(action: string, actor: string | null): Promise<StaffActionOutcome>;
  edit(messageId: number, text: string, buttons: GatewayAlertButton[]): Promise<boolean>;
  answer(callbackQueryId: string, text: string, alert?: boolean): Promise<void>;
}

/** Cabecera con la que Telegram prueba que la llamada es suya. */
export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

interface CallbackQuery {
  id: string;
  data: string;
  messageId: number;
  chatId: string;
  actor: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** El toque, si el cuerpo trae uno bien formado. Cualquier otra cosa es `null`. */
function readCallback(body: unknown): CallbackQuery | null {
  const query = asRecord(asRecord(body)?.callback_query);
  if (!query) return null;
  const message = asRecord(query.message);
  const chat = asRecord(message?.chat);
  const from = asRecord(query.from);
  if (typeof query.id !== 'string' || typeof query.data !== 'string') return null;
  if (typeof message?.message_id !== 'number' || (typeof chat?.id !== 'number' && typeof chat?.id !== 'string')) {
    return null;
  }
  const name = [from?.first_name, from?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .trim();
  return {
    id: query.id,
    data: query.data,
    messageId: message.message_id,
    chatId: String(chat.id),
    actor: name || (typeof from?.username === 'string' ? from.username : null),
  };
}

/** Lo que lee quien tocó, según por qué el POS dijo que no. */
function refusalText(code: string): string {
  switch (code) {
    case 'invalid_state_transition':
      return 'Ese pedido ya no admite esa acción.';
    case 'order_not_firm':
      return 'Ese pedido todavía no está confirmado ni pagado.';
    case 'not_found':
      return 'Ese pedido ya no existe.';
    case 'staff_actions_disabled':
      return 'Este local mueve los pedidos desde el POS.';
    case 'unknown_action':
      return 'Ese botón ya no se usa.';
    default:
      return 'No se pudo. Intenta de nuevo en un momento.';
  }
}

const ok = (handled: string) => Response.json({ ok: true, handled });

/** `POST /api/telegram/webhook` */
export async function handleTelegramWebhook(request: Request, deps: TelegramCallbackDeps): Promise<Response> {
  // Sin secreto configurado no se acepta NADA: una variable olvidada no puede
  // dejar que cualquiera mueva pedidos con un POST.
  const secret = request.headers.get(TELEGRAM_SECRET_HEADER) ?? '';
  if (!deps.webhookSecret || !safeCompare(secret, deps.webhookSecret)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ok('ignored');
  }

  const callback = readCallback(body);
  // Mensajes, miembros que entran, ediciones: nada de eso es un botón.
  if (!callback) return ok('ignored');

  // El bot puede estar en más de un grupo: solo vale el del personal.
  if (!deps.chatId || callback.chatId !== deps.chatId.trim()) {
    await deps.answer(callback.id, 'Este botón solo funciona en el grupo del personal.', true);
    return ok('wrong_chat');
  }

  const outcome = await deps.runAction(callback.data, callback.actor);
  if (!outcome.ok) {
    await deps.answer(callback.id, refusalText(outcome.code), true);
    return ok('refused');
  }

  // Primero el mensaje, después la respuesta al toque: quien tocó ve el aviso
  // ya cambiado cuando el botón deja de girar.
  await deps.edit(callback.messageId, outcome.text, outcome.buttons);
  await deps.answer(callback.id, 'Hecho ✔');
  return ok('done');
}
