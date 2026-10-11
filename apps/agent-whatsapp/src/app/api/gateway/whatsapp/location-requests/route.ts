import { handleGatewayLocationRequest } from '@/lib/central/gateway';
import { buildGatewayDeps } from '@/lib/central/gateway-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/gateway/whatsapp/location-requests — el backend central pide la ubicación al cliente. Ver `lib/central/gateway`. */
export async function POST(request: Request): Promise<Response> {
  return handleGatewayLocationRequest(request, buildGatewayDeps());
}
