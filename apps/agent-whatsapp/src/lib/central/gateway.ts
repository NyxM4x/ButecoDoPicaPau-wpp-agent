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

/** Resultado de un envío por WhatsApp, reducido a lo que hace falta aquí. */
export type GatewaySendResult = { ok: true; wamid: string } | { ok: false; error: string; status?: number };

export interface GatewayDeps {
  /** `GATEWAY_AUTH_TOKEN`: el mismo valor que tiene configurado el backend. */
  authToken: string | undefined;
  sendText(to: string, text: string): Promise<GatewaySendResult>;
  sendImage(to: string, imageUrl: string, caption: string): Promise<GatewaySendResult>;
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

/** POST /gateway/whatsapp/messages — texto, o imagen con el texto como pie. */
export async function handleGatewayMessage(request: Request, deps: GatewayDeps): Promise<Response> {
  if (!authorized(request, deps)) return json(401, { code: 'unauthorized', message: 'Token inválido.' });

  const body = await readBody(request);
  if (!body || !nonEmpty(body.to) || !nonEmpty(body.text)) {
    return json(400, { code: 'validation_error', message: 'Se requieren "to" y "text".' });
  }

  const result = nonEmpty(body.imageUrl)
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
