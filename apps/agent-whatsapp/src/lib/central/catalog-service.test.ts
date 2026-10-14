import { describe, expect, it } from 'vitest';
import { fetchCentralProductImage, loadCentralCatalog, loadCentralCatalogForModel } from './catalog-service';
import type { CentralRestaurantProfile } from './contract';

const config = { baseUrl: 'http://pos.test', token: 'tok' };

const PROFILE: CentralRestaurantProfile = {
  contractVersion: 'v1',
  name: '  Buteco do Pica-Pau  ',
  description: null,
  locale: 'es-BO',
  timezone: 'America/La_Paz',
  currency: { code: 'BOB', symbol: 'Bs' },
  phone: null,
  location: { address: null, mapsUrl: null, latitude: null, longitude: null },
  hours: { text: null, weekly: Array.from({ length: 7 }, () => ({ opens: '19:00', closes: '04:00' })) },
  ordering: { paused: true, pickupEnabled: true, deliveryEnabled: false, paymentMethods: ['qr'] },
  messages: { greeting: null, farewell: null },
  menuMedia: { videoUrl: null, imageUrl: null },
};

/** Un POS falso: responde por ruta, o 500 si la ruta está en `caidas`. */
function fakePos(bodies: Record<string, unknown>, caidas: string[] = []) {
  const paths: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(config.baseUrl, '');
    paths.push(path);
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
    if (caidas.includes(path)) return new Response('{"code":"internal_error"}', { status: 500 });
    return Response.json(bodies[path] ?? []);
  }) as typeof fetch;
  return { fetchImpl, paths };
}

const CATALOG = {
  '/categories': [{ id: 'c1', name: 'Bebidas', sortOrder: 10, isActive: true }],
  '/products': [
    {
      id: 'p1',
      code: 'caipirinha',
      name: 'Caipirinha',
      description: null,
      categoryId: 'c1',
      price: 25,
      isActive: true,
      isAvailable: true,
      sortOrder: 10,
      imageUrl: null,
    },
  ],
};

describe('catálogo del menú web leído del POS', () => {
  it('toma del perfil el nombre, la pausa y qué se puede pedir', async () => {
    const { fetchImpl, paths } = fakePos({ ...CATALOG, '/restaurant/profile': PROFILE });
    const catalog = await loadCentralCatalog({ fetchImpl, config });

    expect(paths.sort()).toEqual(['/categories', '/products', '/promotions', '/restaurant/profile']);
    expect(catalog.items.map((item) => item.code)).toEqual(['caipirinha']);
    expect(catalog).toMatchObject({
      restaurantName: 'Buteco do Pica-Pau',
      ordersPaused: true,
      pickupEnabled: true,
      deliveryEnabled: false,
      paymentMethods: ['qr'],
    });
  });

  it('sin perfil ni promociones el menú se abre igual, con lo de siempre', async () => {
    const { fetchImpl } = fakePos(CATALOG, ['/restaurant/profile', '/promotions']);
    const catalog = await loadCentralCatalog({ fetchImpl, config });

    expect(catalog.items).toHaveLength(1);
    expect(catalog).toMatchObject({
      promotions: [],
      restaurantName: null,
      ordersPaused: false,
      // El recojo no se promete sin que el POS lo diga; el envío y los dos
      // pagos son lo que el POS aceptaba antes de existir el perfil.
      pickupEnabled: false,
      deliveryEnabled: true,
      paymentMethods: ['cash', 'qr'],
    });
  });

  it('sin productos no hay menú: el error sube', async () => {
    const { fetchImpl } = fakePos(CATALOG, ['/products']);
    await expect(loadCentralCatalog({ fetchImpl, config })).rejects.toMatchObject({ status: 500 });
  });

  it('el asistente de IA recibe solo lo que se puede pedir ahora, con la categoría real', async () => {
    const productos = [
      ...CATALOG['/products'],
      { ...CATALOG['/products'][0], id: 'p2', code: 'feijoada', name: 'Feijoada', price: 40, isAvailable: false },
      { ...CATALOG['/products'][0], id: 'p3', code: 'guarana', name: 'Guaraná', price: 8, description: 'Bien fría.' },
    ];
    const { fetchImpl } = fakePos({ ...CATALOG, '/products': productos });

    const { items, promotions } = await loadCentralCatalogForModel({ fetchImpl, config });

    expect(items).toEqual([
      { name: 'Caipirinha', price: 25, category: 'Bebidas' },
      // Sin la Feijoada: está agotada, y el asistente no puede ofrecerla.
      { name: 'Guaraná', price: 8, category: 'Bebidas', description: 'Bien fría.' },
    ]);
    expect(promotions).toEqual([]);
  });

  it('si el POS no responde, el asistente se entera: no recibe un menú vacío', async () => {
    const { fetchImpl } = fakePos(CATALOG, ['/categories']);
    await expect(loadCentralCatalogForModel({ fetchImpl, config })).rejects.toMatchObject({ status: 500 });
  });

  it('la foto se pide a la ruta del contrato', async () => {
    const { fetchImpl, paths } = fakePos({});
    await fetchCentralProductImage('p1', { fetchImpl, config });
    expect(paths).toEqual(['/products/p1/image']);
  });
});
