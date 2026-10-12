/**
 * Gateway de salida: lo que el backend central le pide ENVIAR al agente.
 *
 * El backend decide qué decirle al cliente (pedido recibido, QR de pago, pago
 * confirmado, pedido listo) y cuándo; el agente es quien tiene WhatsApp y
 * Telegram. Estos tres manejadores son ese puente, con el contrato de
 * `apps/backend/docs/gateway-integration.md` §3.
 *
 * Sin `server-only` y con los envíos inyectados: se prueban sin Kapso.
 *
 * El backend reintenta con espera creciente cuando recibe un error, así que la
 * regla es simple: si el mensaje no salió, se responde con error — nunca un 200
 * "por si acaso", que haría que el backend lo diera por entregado.
 */
import { safeCompare } from '@/lib/security/compare';

/** Un botón de respuesta tal como lo manda el backend. */
export interface GatewayReplyButton {
  id: string;
  title: string;
}

/** Límites de WhatsApp para `interactive.type = 'button'`. */
const MAX_BUTTONS = 3;
const MAX_BUTTON_TITLE = 20;
const MAX_BUTTON_ID = 256;

/**
 * Los botones del cuerpo, o `null` si no vino ninguno. `'invalid'` si vinieron
 * mal: reintentar no los arregla, así que es un 400 y no un envío a medias.
 */
function readButtons(value: unknown): GatewayReplyButton[] | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BUTTONS) return 'invalid';
  const buttons: GatewayReplyButton[] = [];
  for (const raw of value) {
    const b = raw as { id?: unknown; title?: unknown } | null;
    if (!b || !nonEmpty(b.id) || !nonEmpty(b.title)) return 'invalid';
    if (b.id.length > MAX_BUTTON_ID || [...b.title].length > MAX_BUTTON_TITLE) return 'invalid';
    buttons.push({ id: b.id, title: b.title });
  }
  return buttons;
}

/** Resultado de un envío por WhatsApp, reducido a lo que hace falta aquí. */
export type GatewaySendResult = { ok: true; wamid: string } | { ok: false; error: string; status?: number };

export interface GatewayDeps {
  /** `GATEWAY_AUTH_TOKEN`: el mismo valor que tiene configurado el backend. */
  authToken: string | undefined;
  sendText(to: string, text: string): Promise<GatewaySendResult>;
  sendImage(to: string, imageUrl: string, caption: string): Promise<GatewaySendResult>;
  /** Texto con botones de respuesta: el `id` del que toque vuelve por el webhook. */
  sendButtons(to: string, text: string, buttons: GatewayReplyButton[]): Promise<GatewaySendResult>;
  sendLocationRequest(to: string): Promise<GatewaySendResult>;
  /** `true` si Telegram aceptó el mensaje. */
  sendTelegram(text: string): Promise<boolean>;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

/** El backend manda `Authorization: Bearer <GATEWAY_AUTH_TOKEN>` en cada llamada. */
function authorized(request: Request, deps: GatewayDeps): boolean {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  // Sin token configurado no se acepta NADA: una variable olvidada no puede
  // convertir esto en un envío de WhatsApp abierto a cualquiera.
  return Boolean(deps.authToken) && safeCompare(token, deps.authToken as string);
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Un fallo del envío, como respuesta para el backend.
 *
 * Teléfono o texto inválidos son 422: reintentar no los arregla. El resto
 * —Kapso caído, tiempo agotado— es 502, y el backend volverá a intentarlo.
 */
function sendFailure(result: { error: string; status?: number }): Response {
  const permanent = result.error.startsWith('invalid_') && result.error !== 'invalid_response';
  return json(permanent ? 422 : 502, { code: 'whatsapp_send_failed', message: result.error });
}

/**
 * POST /gateway/whatsapp/messages — texto, imagen con el texto como pie, o
 * texto con botones de respuesta (el desglose del pedido en efectivo).
 */
export async function handleGatewayMessage(request: Request, deps: GatewayDeps): Promise<Response> {
  if (!authorized(request, deps)) return json(401, { code: 'unauthorized', message: 'Token inválido.' });

  const body = await readBody(request);
  if (!body || !nonEmpty(body.to) || !nonEmpty(body.text)) {
    return json(400, { code: 'validation_error', message: 'Se requieren "to" y "text".' });
  }

  const buttons = readButtons(body.buttons);
  if (buttons === 'invalid') {
    return json(400, {
      code: 'validation_error',
      message: `"buttons" admite de 1 a ${MAX_BUTTONS} botones con "id" y "title" (máximo ${MAX_BUTTON_TITLE} caracteres).`,
    });
  }

  const result = buttons
    ? await deps.sendButtons(body.to, body.text, buttons)
    : nonEmpty(body.imageUrl)
      ? await deps.sendImage(body.to, body.imageUrl, body.text)
      : await deps.sendText(body.to, body.text);

  if (!result.ok) return sendFailure(result);
  // El backend guarda este id para reconocer cuándo el cliente RESPONDE a este
  // mensaje (así asocia un comprobante al pedido correcto).
  return json(200, { externalMessageId: result.wamid });
}

/** POST /gateway/whatsapp/location-requests — pide la ubicación para el delivery. */
export async function handleGatewayLocationRequest(
  request: Request,
  deps: GatewayDeps,
): Promise<Response> {
  if (!authorized(request, deps)) return json(401, { code: 'unauthorized', message: 'Token inválido.' });

  const body = await readBody(request);
  if (!body || !nonEmpty(body.to)) {
    return json(400, { code: 'validation_error', message: 'Se requiere "to".' });
  }

  const result = await deps.sendLocationRequest(body.to);
  if (!result.ok) return sendFailure(result);
  return new Response(null, { status: 204 });
}

/**
 * POST /gateway/telegram/alerts — aviso al grupo del personal.
 *
 * Los botones llegan como etiqueta + acción. Aquí se envían como texto: quien
 * decide (aceptar un pedido que entró con la caja cerrada, por ejemplo) lo hace
 * desde el POS, que es donde esa acción queda registrada con su usuario.
 */
export async function handleGatewayTelegramAlert(
  request: Request,
  deps: GatewayDeps,
): Promise<Response> {
  if (!authorized(request, deps)) return json(401, { code: 'unauthorized', message: 'Token inválido.' });

  const body = await readBody(request);
  if (!body || !nonEmpty(body.text)) {
    return json(400, { code: 'validation_error', message: 'Se requiere "text".' });
  }

  const labels = Array.isArray(body.buttons)
    ? body.buttons
        .map((button) => (button as { label?: unknown })?.label)
        .filter(nonEmpty)
    : [];
  const text =
    labels.length > 0 ? `${body.text}\n\nResolver en el POS → Pedidos (${labels.join(' / ')}).` : body.text;

  const sent = await deps.sendTelegram(text);
  if (!sent) return json(502, { code: 'telegram_send_failed', message: 'Telegram no aceptó el mensaje.' });
  return json(200, { externalMessageId: `tg-${Date.now()}` });
}
