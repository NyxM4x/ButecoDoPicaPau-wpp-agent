import 'server-only';
import { runStaffAction } from '@/lib/central';
import { answerTelegramCallback, editTelegramMessage, type TelegramButtonsConfig } from './telegram-buttons';
import type { TelegramCallbackDeps } from './telegram-callback';

/** Telegram y POS reales para el webhook de los botones. */
export function buildTelegramCallbackDeps(): TelegramCallbackDeps {
  // Directo de `process.env`: esta ruta tiene que poder rechazar una llamada sin
  // secreto aunque al agente le falte el resto de su configuración.
  const config: TelegramButtonsConfig = {
    botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID?.trim() ?? '',
  };
  return {
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined,
    chatId: config.chatId || undefined,
    runAction: (action, actor) => runStaffAction(action, actor),
    edit: (messageId, text, buttons) => editTelegramMessage(config, messageId, text, buttons),
    answer: (callbackQueryId, text, alert) => answerTelegramCallback(config, callbackQueryId, text, alert),
  };
}
