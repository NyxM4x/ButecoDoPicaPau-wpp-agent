import { buildGatewayDeps, handleGatewayTelegramAlert } from '@/lib/central';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/gateway/telegram/alerts — el backend central avisa al grupo del personal. Ver `lib/central/gateway`. */
export async function POST(request: Request): Promise<Response> {
  return handleGatewayTelegramAlert(request, buildGatewayDeps());
}
