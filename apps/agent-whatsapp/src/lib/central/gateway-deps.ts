import 'server-only';
import { getServerEnv } from '@/lib/env/env';
import { getKapsoClient } from '@/lib/kapso/client';
import { createTelegramAlertSender } from '@/lib/alerts/telegram';
import { sendTelegramWithButtons } from '@/lib/alerts/telegram-buttons';
import { centralFetchFile } from './client';
import type { GatewayDeps } from './gateway';
import { sendPosImage } from './pos-image';

/** Envíos reales (Kapso y Telegram) para las rutas del gateway. */
export function buildGatewayDeps(): GatewayDeps {
  // Los botones solo sirven si Telegram puede devolver el toque: sin el secreto
  // del webhook no se ofrecen, y el aviso sale como texto.
  //
  // Directo de `process.env`, como el token de abajo: `getServerEnv` exige la
  // configuración entera, y estas rutas tienen que poder rechazar una llamada
  // sin token aunque falte lo demás.
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  const buttonsReady = Boolean(botToken && chatId && process.env.TELEGRAM_WEBHOOK_SECRET?.trim());

  return {
    ...(buttonsReady
      ? {
          sendTelegramButtons: (text, buttons) =>
            sendTelegramWithButtons({ botToken: botToken as string, chatId: chatId as string }, text, buttons),
        }
      : {}),
    authToken: process.env.GATEWAY_AUTH_TOKEN?.trim() || undefined,
    sendText: (to, text) => getKapsoClient().sendText(to, text),
    sendImage: (to, imageUrl, caption) => getKapsoClient().sendImage(to, imageUrl, caption),
    sendPosImage: (to, path, caption) =>
      sendPosImage(to, path, caption, {
        fetchFile: (filePath) => centralFetchFile(filePath),
        uploadImage: (bytes, contentType) => getKapsoClient().uploadImage(bytes, contentType),
        sendImageById: (phone, mediaId, text) => getKapsoClient().sendImageById(phone, mediaId, text),
      }),
    sendButtons: (to, text, buttons) => getKapsoClient().sendButtons(to, text, buttons),
    sendLocationRequest: (to) => getKapsoClient().sendLocationRequest(to),
    async sendTelegram(text) {
      const env = getServerEnv();
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
      const outcome = await createTelegramAlertSender({
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId: env.TELEGRAM_CHAT_ID,
      }).send(text);
      return outcome.kind === 'sent';
    },
  };
}
