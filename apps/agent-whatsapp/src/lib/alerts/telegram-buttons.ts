/**
 * Mensajes de Telegram con BOTONES — sin `server-only`, con el `fetch` inyectable.
 *
 * El aviso de un pedido al grupo del personal lleva botones (Listo, Salió,
 * Entregado). Aquí están las tres llamadas a la API de Telegram que eso pide:
 * mandar un mensaje con botones, reemplazarlo cuando alguien toca uno, y
 * contestarle el toque a quien lo hizo.
 *
 * Es aparte de `telegram.ts` a propósito: aquel es el envío de alertas de texto,
 * con sus reintentos y su clasificación de fallos, y no cambia.
 *
 * El token del bot va en la URL, como pide Telegram: por eso ningún error de
 * aquí lleva la URL ni el mensaje del proveedor.
 */

const DEFAULT_BASE_URL = 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;

/** Telegram admite hasta 64 bytes en `callback_data`. */
export const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64;

export interface TelegramButton {
  label: string;
  /** Lo que vuelve cuando alguien toca el botón. */
  action: string;
}

export interface TelegramButtonsConfig {
  botToken: string;
  chatId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Una fila con todos los botones: son tres como mucho y así se leen de un vistazo. */
function keyboard(buttons: TelegramButton[]) {
  return {
    inline_keyboard:
      buttons.length > 0 ? [buttons.map((button) => ({ text: button.label, callback_data: button.action }))] : [],
  };
}

async function call(
  config: TelegramButtonsConfig,
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  try {
    const response = await (config.fetchImpl ?? fetch)(`${base}/bot${config.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return response.ok && json?.ok === true ? json : null;
  } catch {
    return null;
  }
}

/** ¿Caben todas las acciones en un botón de Telegram? */
export function buttonsFitTelegram(buttons: TelegramButton[]): boolean {
  return buttons.every(
    (button) =>
      button.label.trim() !== '' &&
      button.action !== '' &&
      new TextEncoder().encode(button.action).length <= TELEGRAM_CALLBACK_DATA_MAX_BYTES,
  );
}

/** Manda el mensaje con sus botones. Devuelve el id del mensaje, o `null` si no salió. */
export async function sendTelegramWithButtons(
  config: TelegramButtonsConfig,
  text: string,
  buttons: TelegramButton[],
): Promise<string | null> {
  const json = await call(config, 'sendMessage', {
    chat_id: config.chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: keyboard(buttons),
  });
  const id = (json?.result as { message_id?: unknown } | undefined)?.message_id;
  return typeof id === 'number' ? String(id) : null;
}

/**
 * Reemplaza el texto y los botones de un mensaje ya enviado. Sin botones, el
 * mensaje se queda solo con el texto.
 *
 * Devuelve `false` si Telegram no lo aceptó. Que el texto sea idéntico al que
 * ya estaba también es un `false` para Telegram, y no pasa nada: el mensaje ya
 * dice lo que tenía que decir.
 */
export async function editTelegramMessage(
  config: TelegramButtonsConfig,
  messageId: number,
  text: string,
  buttons: TelegramButton[],
): Promise<boolean> {
  const json = await call(config, 'editMessageText', {
    chat_id: config.chatId,
    message_id: messageId,
    text,
    disable_web_page_preview: true,
    reply_markup: keyboard(buttons),
  });
  return json !== null;
}

/**
 * Le contesta el toque a quien lo hizo: sin esto el botón se queda con el
 * relojito girando. `alert: true` lo muestra como ventana, para un error.
 */
export async function answerTelegramCallback(
  config: TelegramButtonsConfig,
  callbackQueryId: string,
  text: string,
  alert = false,
): Promise<void> {
  await call(config, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text.slice(0, 190),
    show_alert: alert,
  });
}
