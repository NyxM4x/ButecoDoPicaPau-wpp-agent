import 'server-only';
import { getServerEnv } from '@/lib/env/env';
import { getKapsoClient } from '@/lib/kapso/client';
import { createTelegramAlertSender } from '@/lib/alerts/telegram';
import type { GatewayDeps } from './gateway';

/** Envíos reales (Kapso y Telegram) para las rutas del gateway. */
export function buildGatewayDeps(): GatewayDeps {
  return {
    authToken: process.env.GATEWAY_AUTH_TOKEN?.trim() || undefined,
    sendText: (to, text) => getKapsoClient().sendText(to, text),
    sendImage: (to, imageUrl, caption) => getKapsoClient().sendImage(to, imageUrl, caption),
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
