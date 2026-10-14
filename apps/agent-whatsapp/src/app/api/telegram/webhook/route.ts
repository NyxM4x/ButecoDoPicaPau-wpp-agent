import { handleTelegramWebhook } from '@/lib/alerts/telegram-callback';
import { buildTelegramCallbackDeps } from '@/lib/alerts/telegram-callback-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/telegram/webhook — alguien del personal tocó un botón de un aviso
 * (Listo / Salió / Entregado). Ver `lib/alerts/telegram-callback`.
 */
export async function POST(request: Request): Promise<Response> {
  return handleTelegramWebhook(request, buildTelegramCallbackDeps());
}
