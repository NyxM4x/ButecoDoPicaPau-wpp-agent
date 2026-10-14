import { fetchCentralProductImage, isCentralEnabled } from '@/lib/central';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * GET /api/menu/image/:id — la foto de un producto del backend central.
 *
 * El backend solo entrega las fotos con un token, y ese token no puede ir al
 * navegador. Esta ruta la pide con el token del servidor y la reenvía: para el
 * cliente es una imagen más del menú, que es público.
 *
 * Solo deja pasar un id con forma de UUID y solo reenvía imágenes: no es un
 * proxy general hacia el backend.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!isCentralEnabled() || !UUID.test(id)) return new Response(null, { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetchCentralProductImage(id);
  } catch {
    return new Response(null, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type')?.split(';')[0].trim() ?? '';
  if (!upstream.ok || !IMAGE_TYPES.has(contentType)) {
    return new Response(null, { status: upstream.status === 404 ? 404 : 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      // Corto a propósito: una foto cambiada en el POS se ve en el menú en un
      // minuto, sin tener que versionar la ruta.
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
