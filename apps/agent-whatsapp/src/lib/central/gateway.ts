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
import {
  GATEWAY_ERROR,
  GATEWAY_MAX_BUTTON_ID as MAX_BUTTON_ID,
  GATEWAY_MAX_BUTTON_TITLE as MAX_BUTTON_TITLE,
  GATEWAY_MAX_BUTTONS as MAX_BUTTONS,
  STAFF_ACTION_PATTERN,
  type GatewayAlertButton,
  type GatewayMessageResult,
  type GatewayReplyButton,
} from './contract';

import { isPosImagePath } from './pos-image';

export type { GatewayReplyButton };

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
  /** Imagen con dirección pública (https): WhatsApp la descarga por su cuenta. */
  sendImage(to: string, imageUrl: string, caption: string): Promise<GatewaySendResult>;
  /**
   * Imagen que el POS guarda bajo llave (`/orders/:id/qr-image`): el agente la
   * descarga con su token y la sube a WhatsApp. Ver `pos-image.ts`.
   */
  sendPosImage(to: string, path: string, caption: string): Promise<GatewaySendResult>;
  /** Texto con botones de respuesta: el `id` del que toque vuelve por el webhook. */
  sendButtons(to: string, text: string, buttons: GatewayReplyButton[]): Promise<GatewaySendResult>;
  sendLocationRequest(to: string): Promise<GatewaySendResult>;
  /** `true` si Telegram aceptó el mensaje. */
  sendTelegram(text: string): Promise<boolean>;
  /**
   * Aviso con botones que el personal puede tocar. Devuelve el id del mensaje
   * en Telegram, o `null` si no salió. Ausente = no hay webhook de Telegram
   * configurado, y los botones se mandan como texto.
   */
  sendTelegramButtons?(text: string, buttons: GatewayAlertButton[]): Promise<string | null>;
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
  return json(permanent ? 422 : 502, { code: GATEWAY_ERROR.whatsappSendFailed, message: result.error });
}

/**
 * POST /gateway/whatsapp/messages — texto, imagen con el texto como pie, o
 * texto con botones de respuesta (el desglose del pedido en efectivo).
 */
export async function handleGatewayMessage(request: Request, deps: GatewayDeps): Promise<Response> {
  if (!authorized(request, deps)) return json(401, { code: GATEWAY_ERROR.unauthorized, message: 'Token inválido.' });

  const body = await readBody(request);
  if (!body || !nonEmpty(body.to) || !nonEmpty(body.text)) {
    return json(400, { code: GATEWAY_ERROR.validation, message: 'Se requieren "to" y "text".' });
  }

  const buttons = readButtons(body.buttons);
  if (buttons === 'invalid') {
    return json(400, {
      code: GATEWAY_ERROR.validation,
      message: `"buttons" admite de 1 a ${MAX_BUTTONS} botones con "id" y "title" (máximo ${MAX_BUTTON_TITLE} caracteres).`,
    });
  }

  // Dos formas de imagen: una ruta del propio POS (protegida; es como manda el
  // QR de pago) o una dirección pública. Cualquier otra cosa no se puede enviar.
  const image = nonEmpty(body.imageUrl) ? body.imageUrl.trim() : null;
  const fromPos = image !== null && isPosImagePath(image);
  if (image !== null && !fromPos && !/^https:\/\//i.test(image)) {
    return json(400, {
      code: GATEWAY_ERROR.validation,
      message: '"imageUrl" debe ser una ruta del POS (empieza con "/") o una dirección https.',
    });
  }

  const result = buttons
    ? await deps.sendButtons(body.to, body.text, buttons)
    : image === null
      ? await deps.sendText(body.to, body.text)
      : fromPos
        ? await deps.sendPosImage(body.to, image, body.text)
        : await deps.sendImage(body.to, image, body.text);

  if (!result.ok) return sendFailure(result);
  // El backend guarda este id para reconocer cuándo el cliente RESPONDE a este
  // mensaje (así asocia un comprobante al pedido correcto).
  return json(200, { externalMessageId: result.wamid } satisfies GatewayMessageResult);
}

/** POST /gateway/whatsapp/location-requests — pide la ubicación para el delivery. */
export async function handleGatewayLocationRequest(
  request: Request,
  deps: GatewayDeps,
): Promise<Response> {
  if (!authorized(request, deps)) return json(401, { code: GATEWAY_ERROR.unauthorized, message: 'Token inválido.' });

  const body = await readBody(request);
  if (!body || !nonEmpty(body.to)) {
    return json(400, { code: GATEWAY_ERROR.validation, message: 'Se requiere "to".' });
  }

  const result = await deps.sendLocationRequest(body.to);
  if (!result.ok) return sendFailure(result);
  return new Response(null, { status: 204 });
}

/**
 * Los botones, si TODOS se pueden tocar. Con uno solo que no, `null`: un aviso
 * con la mitad de los botones vivos confunde más que uno sin ninguno.
 */
function readTappableButtons(value: unknown): GatewayAlertButton[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const buttons: GatewayAlertButton[] = [];
  for (const raw of value) {
    const button = raw as { label?: unknown; action?: unknown } | null;
    if (!button || !nonEmpty(button.label) || !nonEmpty(button.action)) return null;
    if (!STAFF_ACTION_PATTERN.test(button.action)) return null;
    buttons.push({ label: button.label, action: button.action });
  }
  return buttons;
}

/**
 * POST /gateway/telegram/alerts — aviso al grupo del personal.
 *
 * Los botones llegan como etiqueta + acción. Si TODAS las acciones son de las
 * que el agente sabe ejecutar (`STAFF_ACTION_PATTERN`: Listo, Salió, Entregado)
 * salen como botones de verdad, y el toque vuelve por `/api/telegram/webhook`.
 *
 * Las demás se envían como texto: quien decide (aceptar un pedido que entró con
 * la caja cerrada, por ejemplo) lo hace desde el POS, que es donde esa acción
 * queda registrada con su usuario.
 */
export async function handleGatewayTelegramAlert(
  request: Request,
  deps: GatewayDeps,
): Promise<Response> {
  if (!authorized(request, deps)) return json(401, { code: GATEWAY_ERROR.unauthorized, message: 'Token inválido.' });

  const body = await readBody(request);
  if (!body || !nonEmpty(body.text)) {
    return json(400, { code: GATEWAY_ERROR.validation, message: 'Se requiere "text".' });
  }

  const tappable = readTappableButtons(body.buttons);
  if (tappable && deps.sendTelegramButtons) {
    const messageId = await deps.sendTelegramButtons(body.text, tappable);
    if (!messageId) {
      return json(502, { code: GATEWAY_ERROR.telegramSendFailed, message: 'Telegram no aceptó el mensaje.' });
    }
    return json(200, { externalMessageId: `tg-${messageId}` } satisfies GatewayMessageResult);
  }

  const labels = Array.isArray(body.buttons)
    ? body.buttons
        .map((button) => (button as { label?: unknown })?.label)
        .filter(nonEmpty)
    : [];
  const text =
    labels.length > 0 ? `${body.text}\n\nResolver en el POS → Pedidos (${labels.join(' / ')}).` : body.text;

  const sent = await deps.sendTelegram(text);
  if (!sent) {
    return json(502, { code: GATEWAY_ERROR.telegramSendFailed, message: 'Telegram no aceptó el mensaje.' });
  }
  return json(200, { externalMessageId: `tg-${Date.now()}` } satisfies GatewayMessageResult);
}
