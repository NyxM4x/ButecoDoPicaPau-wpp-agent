import { ensureRestaurantProfile } from '@/lib/restaurant/profile-loader';
import { handleListRequest, type DashboardHandlerDeps } from '@/lib/dashboard/orders-handler';
import { createOrdersRepository } from '@/lib/dashboard/orders-repository';
import { createSupabaseOrdersDataSource } from '@/lib/dashboard/data-source';
import { isRequestAuthorized } from '@/lib/dashboard/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function deps(): DashboardHandlerDeps {
  return {
    isAuthorized: isRequestAuthorized,
    repo: createOrdersRepository(createSupabaseOrdersDataSource()),
    now: () => Date.now(),
  };
}

export async function GET(request: Request): Promise<Response> {
  // El perfil del restaurante vigente para todo lo que se diga en esta petición.
  await ensureRestaurantProfile();
  return handleListRequest(request, deps());
}
