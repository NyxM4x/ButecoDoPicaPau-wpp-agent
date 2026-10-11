import { handleGatewayTelegramAlert } from '@/lib/central/gateway';
import { buildGatewayDeps } from '@/lib/central/gateway-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/gateway/telegram/alerts — el backend central avisa al grupo del personal. Ver `lib/central/gateway`. */
export async function POST(request: Request): Promise<Response> {
  return handleGatewayTelegramAlert(request, buildGatewayDeps());
}
