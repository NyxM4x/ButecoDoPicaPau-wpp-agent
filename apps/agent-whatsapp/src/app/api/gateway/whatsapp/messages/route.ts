import { buildGatewayDeps, handleGatewayMessage } from '@/lib/central';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/gateway/whatsapp/messages — el backend central pide enviar un WhatsApp. Ver `lib/central/gateway`. */
export async function POST(request: Request): Promise<Response> {
  return handleGatewayMessage(request, buildGatewayDeps());
}
