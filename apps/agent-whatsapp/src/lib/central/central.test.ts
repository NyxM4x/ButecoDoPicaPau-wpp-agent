import { describe, expect, it, vi } from 'vitest';
import {
  categoryKindOf,
  menuImagePath,
  toMenuItems,
  toPromotions,
  type CentralCategory,
  type CentralProduct,
  type CentralPromotion,
} from './catalog';
import {
  CENTRAL_CLOSED,
  CENTRAL_DELIVERY_DISABLED,
  CENTRAL_PAUSED,
  CENTRAL_PAYMENT_METHOD_DISABLED,
  CENTRAL_PENDING_REVIEW,
  CENTRAL_PICKUP_DISABLED,
  createCentralWebOrder,
  idempotencyKeyFor,
  toE164,
  type CentralRequestFn,
} from './orders';
import {
  handleGatewayLocationRequest,
  handleGatewayMessage,
  handleGatewayTelegramAlert,
  type GatewayDeps,
} from './gateway';
import { categoryTabsFor, filterMenuItems, groupByCategory, productDescription, productImage } from '@/lib/menu/catalog';
import { evaluatePromotion } from '@/lib/promotions/promotion';
import type { CreateOrderWebParams } from '@/lib/orders/web-checkout';

const CAT_CAFES: CentralCategory = { id: 'c1', name: 'Cafés', sortOrder: 10, isActive: true };
const CAT_PAN: CentralCategory = { id: 'c2', name: 'Panadería', sortOrder: 20, isActive: true };
const CAT_OFF: CentralCategory = { id: 'c3', name: 'Platos', sortOrder: 5, isActive: false };

function product(over: Partial<CentralProduct>): CentralProduct {
  return {
    id: 'p1',
    code: 'cafe_latte',
    name: 'Latte',
    description: 'Suave.',
    categoryId: 'c1',
    price: 16,
    isActive: true,
    isAvailable: true,
    sortOrder: 10,
    imageUrl: null,
    ...over,
  };
}

const PRODUCTS: CentralProduct[] = [
  product({ id: 'p2', code: 'pan_cunape', name: 'Cuñapé', categoryId: 'c2', price: 5, description: null }),
  product({ id: 'p1', imageUrl: '/products/p1/image' }),
  product({ id: 'p3', code: 'cafe_espresso', name: 'Espresso', sortOrder: 5, isAvailable: false }),
  product({ id: 'p4', code: 'trancapecho', name: 'Trancapecho', categoryId: 'c3' }),
];

describe('catálogo central → menú web', () => {
  it('reconoce el tipo de una categoría por su nombre', () => {
    expect(categoryKindOf('Cafés')).toBe('bebida');
    expect(categoryKindOf('Jugos')).toBe('bebida');
    expect(categoryKindOf('Extras')).toBe('extra');
    expect(categoryKindOf('Panadería')).toBe('plato');
    expect(categoryKindOf('Platos')).toBe('plato');
  });

  it('ordena por categoría y luego por producto, y deja fuera las categorías apagadas', () => {
    const items = toMenuItems([CAT_PAN, CAT_OFF, CAT_CAFES], PRODUCTS);
    expect(items.map((i) => i.code)).toEqual(['cafe_espresso', 'cafe_latte', 'pan_cunape']);
  });

  it('el agotado llega como no disponible, no desaparece', () => {
    const items = toMenuItems([CAT_CAFES, CAT_PAN], PRODUCTS);
    expect(items.find((i) => i.code === 'cafe_espresso')?.is_active).toBe(false);
    expect(items.find((i) => i.code === 'cafe_latte')?.is_active).toBe(true);
  });

  it('la foto apunta a la ruta propia, nunca al backend', () => {
    const items = toMenuItems([CAT_CAFES, CAT_PAN], PRODUCTS);
    expect(items.find((i) => i.code === 'cafe_latte')?.image_url).toBe(menuImagePath('p1'));
    expect(items.find((i) => i.code === 'pan_cunape')?.image_url).toBeNull();
  });

  it('el menú usa la descripción, la foto y las secciones del POS', () => {
    const items = toMenuItems([CAT_CAFES, CAT_PAN], PRODUCTS);
    const latte = items.find((i) => i.code === 'cafe_latte')!;
    const cunape = items.find((i) => i.code === 'pan_cunape')!;

    expect(productDescription(latte)).toBe('Suave.');
    expect(productDescription(cunape)).toBeNull();
    expect(productImage(latte).src).toBe('/api/menu/image/p1');
    expect(productImage(cunape).src).toBeNull();

    expect(categoryTabsFor(items).map((t) => t.label)).toEqual(['Todo', 'Cafés', 'Panadería']);
    expect(groupByCategory(items).map((g) => g.label)).toEqual(['Cafés', 'Panadería']);
    expect(filterMenuItems(items, 'c:Panadería').map((i) => i.code)).toEqual(['pan_cunape']);
  });

  it('un producto de otra demo con el mismo code no hereda la foto fija de Don Zarco', () => {
    const [item] = toMenuItems(
      [{ ...CAT_OFF, isActive: true }],
      [product({ id: 'p4', code: 'trancapecho', categoryId: 'c3', imageUrl: null })],
    );
    expect(productImage(item).src).toBeNull();
  });

  it('sin campos del backend, el catálogo de siempre no cambia', () => {
    const legacy = { code: 'trancapecho', category: 'plato' as const };
    expect(productImage(legacy).src).toBe('/menu/trancapecho.webp');
    expect(productDescription('trancapecho')).toContain('cochabambino');
    expect(categoryTabsFor([legacy]).map((t) => t.id)).toEqual(['all', 'plato', 'extra', 'bebida']);
  });
});

describe('promociones del backend central', () => {
  const promo: CentralPromotion = {
    id: 'pr1',
    name: 'Desayuno',
    description: null,
    promoPrice: 18,
    isActive: true,
    archivedAt: null,
    startsAt: null,
    endsAt: null,
    sortOrder: 1,
    imageUrl: null,
    revision: 3,
    items: [
      { productId: 'p1', productName: 'Latte', quantity: 1, unitPrice: 16 },
      { productId: 'p2', productName: 'Cuñapé', quantity: 1, unitPrice: 5 },
    ],
  };
  const items = toMenuItems([CAT_CAFES, CAT_PAN], PRODUCTS);

  it('se puede comprar y ahorra la diferencia con el precio vigente', () => {
    const [mapped] = toPromotions([promo], items);
    expect(mapped.revision).toBe(3);
    expect(evaluatePromotion(mapped, Date.now())).toMatchObject({
      status: 'available',
      normalPrice: 21,
      savings: 3,
    });
  });

  it('las archivadas no llegan al cliente', () => {
    expect(toPromotions([{ ...promo, archivedAt: '2026-10-01T00:00:00Z' }], items)).toEqual([]);
  });

  it('un componente agotado tumba el combo', () => {
    const conAgotado = { ...promo, items: [{ ...promo.items[0], productId: 'p3' }, promo.items[1]] };
    const [mapped] = toPromotions([conAgotado], items);
    expect(evaluatePromotion(mapped, Date.now()).status).toBe('component_unavailable');
  });
});

// ── Pedido ──────────────────────────────────────────────────────────────────

const PARAMS: CreateOrderWebParams = {
  p_menu_session_id: 'sess-1',
  p_customer_name: 'María',
  p_delivery_type: 'delivery',
  p_notes: null,
  p_items_json: [{ code: 'cafe_latte', quantity: 2 }],
  p_checkout_fingerprint: 'fp',
  p_payment_method: 'qr',
  p_promotions_json: [{ promotion_id: '11111111-1111-4111-8111-111111111111', quantity: 1, revision: 3 }],
};

const ORDER = {
  id: 'o1',
  orderNumber: 'ORD-000007',
  customerName: 'María',
  deliveryType: 'delivery',
  paymentMethod: 'qr',
  status: 'awaiting_location',
  subtotalAmount: 50,
  deliveryBaseAmount: 0,
  deliverySurchargeAmount: 0,
  totalAmount: 50,
  createdAt: '2026-10-11T12:00:00.000Z',
};

/** Backend falso: responde por ruta y guarda lo que se le pidió. */
function fakeBackend(orderResponse: { status: number; body: unknown } | Error) {
  const calls: Array<{ path: string; init?: Parameters<CentralRequestFn>[1] }> = [];
  const request = (async (path: string, init?: Parameters<CentralRequestFn>[1]) => {
    calls.push({ path, init });
    if (path === '/products') return { status: 200, body: PRODUCTS };
    if (path === '/customers/find-or-create') return { status: 201, body: { id: 'cust-1' } };
    if (orderResponse instanceof Error) throw orderResponse;
    return orderResponse;
  }) as CentralRequestFn;
  return { request, calls };
}

function centralError(status: number, code: string, details: unknown = null) {
  return Object.assign(new Error(code), { status, code, details });
}

const findSessionPhone = async () => '59170010001';

describe('pedido web por el backend central', () => {
  it('crea el pedido con el cliente por teléfono, ids de producto y una clave por enlace', async () => {
    const { request, calls } = fakeBackend({ status: 201, body: ORDER });
    const outcome = await createCentralWebOrder(PARAMS, { request, findSessionPhone });

    expect(outcome.errorCode).toBeNull();
    expect(outcome.data).toMatchObject({
      order_id: 'o1',
      order_number: 'ORD-000007',
      status: 'awaiting_location',
      delivery_type: 'delivery',
      total_amount: 50,
      created: true,
    });

    expect(calls[1].init?.body).toEqual({ phone: '+59170010001', name: 'María' });
    const order = calls[2];
    expect(order.path).toBe('/orders');
    expect(order.init?.headers).toEqual({ 'idempotency-key': idempotencyKeyFor('sess-1') });
    expect(order.init?.body).toEqual({
      customerId: 'cust-1',
      channel: 'whatsapp',
      customerName: 'María',
      deliveryType: 'delivery',
      paymentMethod: 'qr',
      items: [{ productId: 'p1', quantity: 2 }],
      promotions: [{ promotionId: '11111111-1111-4111-8111-111111111111', quantity: 1, revision: 3 }],
    });
  });

  it('un reintento con el mismo carrito devuelve el pedido sin marcarlo como nuevo', async () => {
    const { request } = fakeBackend({ status: 200, body: ORDER });
    const outcome = await createCentralWebOrder(PARAMS, { request, findSessionPhone });
    expect(outcome.data?.created).toBe(false);
  });

  it('sesión sin teléfono = sesión inválida, sin llamar al backend', async () => {
    const { request, calls } = fakeBackend({ status: 201, body: ORDER });
    const outcome = await createCentralWebOrder(PARAMS, { request, findSessionPhone: async () => null });
    expect(outcome.errorCode).toBe('P1001');
    expect(calls).toHaveLength(0);
  });

  it('un código que ya no está en el catálogo es un producto no disponible', async () => {
    const { request, calls } = fakeBackend({ status: 201, body: ORDER });
    const outcome = await createCentralWebOrder(
      { ...PARAMS, p_items_json: [{ code: 'ya_no_existe', quantity: 1 }] },
      { request, findSessionPhone },
    );
    expect(outcome.errorCode).toBe('P1002');
    expect(calls.map((c) => c.path)).toEqual(['/products']);
  });

  it.each([
    ['product_unavailable', 'P1002'],
    ['idempotency_key_reused', 'P1003'],
    ['closed', CENTRAL_CLOSED],
    ['orders_paused', CENTRAL_PAUSED],
    ['pickup_disabled', CENTRAL_PICKUP_DISABLED],
    ['delivery_disabled', CENTRAL_DELIVERY_DISABLED],
    ['payment_method_disabled', CENTRAL_PAYMENT_METHOD_DISABLED],
  ])('traduce %s del backend a %s', async (code, expected) => {
    const { request } = fakeBackend(centralError(409, code));
    const outcome = await createCentralWebOrder(PARAMS, { request, findSessionPhone });
    expect(outcome.errorCode).toBe(expected);
  });

  it('una promoción rechazada conserva cuál fue y por qué', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const { request } = fakeBackend(
      centralError(409, 'promotion_unavailable', { promotionId: id, reason: 'expired' }),
    );
    const outcome = await createCentralWebOrder(PARAMS, { request, findSessionPhone });
    expect(outcome).toMatchObject({ errorCode: 'P1004', errorMessage: `promotion_rejected:expired:${id}` });
  });

  it('sin caja abierta el pedido queda en revisión, no confirmado', async () => {
    const { request } = fakeBackend({ status: 202, body: { requestId: 'r1' } });
    const outcome = await createCentralWebOrder(PARAMS, { request, findSessionPhone });
    expect(outcome).toMatchObject({ data: null, errorCode: CENTRAL_PENDING_REVIEW });
  });

  it('un fallo de red no se disfraza de rechazo: sube', async () => {
    const { request } = fakeBackend(centralError(0, 'central_unreachable'));
    await expect(createCentralWebOrder(PARAMS, { request, findSessionPhone })).rejects.toThrow();
  });

  it('el teléfono sale en E.164', () => {
    expect(toE164('59170010001')).toBe('+59170010001');
    expect(toE164('+591 700-10001')).toBe('+59170010001');
  });
});

// ── Gateway ─────────────────────────────────────────────────────────────────

function gatewayDeps(over: Partial<GatewayDeps> = {}): GatewayDeps {
  return {
    authToken: 'secreto',
    sendText: vi.fn(async () => ({ ok: true as const, wamid: 'wamid.T' })),
    sendImage: vi.fn(async () => ({ ok: true as const, wamid: 'wamid.I' })),
    sendPosImage: vi.fn(async () => ({ ok: true as const, wamid: 'wamid.P' })),
    sendButtons: vi.fn(async () => ({ ok: true as const, wamid: 'wamid.B' })),
    sendLocationRequest: vi.fn(async () => ({ ok: true as const, wamid: 'wamid.L' })),
    sendTelegram: vi.fn(async () => true),
    ...over,
  };
}

function post(body: unknown, token: string | null = 'secreto'): Request {
  return new Request('http://agente.test/api/gateway', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe('gateway: lo que el backend pide enviar', () => {
  it('rechaza sin token, con token incorrecto y sin token configurado', async () => {
    const body = { to: '+59170010001', text: 'Hola' };
    expect((await handleGatewayMessage(post(body, null), gatewayDeps())).status).toBe(401);
    expect((await handleGatewayMessage(post(body, 'otro'), gatewayDeps())).status).toBe(401);

    const sinConfigurar = gatewayDeps({ authToken: undefined });
    expect((await handleGatewayMessage(post(body, ''), sinConfigurar)).status).toBe(401);
    expect(sinConfigurar.sendText).not.toHaveBeenCalled();
  });

  it('envía texto y devuelve el id del mensaje', async () => {
    const deps = gatewayDeps();
    const res = await handleGatewayMessage(post({ customerId: 'c', to: '+59170010001', text: 'Hola' }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ externalMessageId: 'wamid.T' });
    expect(deps.sendText).toHaveBeenCalledWith('+59170010001', 'Hola');
  });

  it('con imageUrl envía la imagen con el texto como pie', async () => {
    const deps = gatewayDeps();
    const res = await handleGatewayMessage(
      post({ to: '+59170010001', text: 'Tu QR', imageUrl: 'https://x.test/qr.png' }),
      deps,
    );
    expect(await res.json()).toEqual({ externalMessageId: 'wamid.I' });
    expect(deps.sendImage).toHaveBeenCalledWith('+59170010001', 'https://x.test/qr.png', 'Tu QR');
    expect(deps.sendPosImage).not.toHaveBeenCalled();
  });

  it('con una ruta del POS en imageUrl (el QR de pago) la descarga y la sube, no la manda como enlace', async () => {
    const deps = gatewayDeps();
    const res = await handleGatewayMessage(
      post({ to: '+59170010001', text: 'Tu QR', imageUrl: '/orders/o-1/qr-image' }),
      deps,
    );
    expect(await res.json()).toEqual({ externalMessageId: 'wamid.P' });
    expect(deps.sendPosImage).toHaveBeenCalledWith('+59170010001', '/orders/o-1/qr-image', 'Tu QR');
    expect(deps.sendImage).not.toHaveBeenCalled();
  });

  it('rechaza una imageUrl que no es ni ruta del POS ni https, sin enviar nada', async () => {
    const deps = gatewayDeps();
    for (const imageUrl of ['http://x.test/qr.png', '//otro.test/qr.png', 'qr.png', '/orders/../secreto']) {
      const res = await handleGatewayMessage(post({ to: '+59170010001', text: 'Tu QR', imageUrl }), deps);
      expect(res.status).toBe(400);
    }
    expect(deps.sendImage).not.toHaveBeenCalled();
    expect(deps.sendPosImage).not.toHaveBeenCalled();
    expect(deps.sendText).not.toHaveBeenCalled();
  });

  it('si el POS no entrega la imagen pide reintento; si entrega algo que no es una imagen, no', async () => {
    const posCaido = gatewayDeps({ sendPosImage: vi.fn(async () => ({ ok: false as const, error: 'pos_image_unavailable' })) });
    const noEsImagen = gatewayDeps({ sendPosImage: vi.fn(async () => ({ ok: false as const, error: 'invalid_image' })) });
    const body = { to: '+59170010001', text: 'Tu QR', imageUrl: '/orders/o-1/qr-image' };

    expect((await handleGatewayMessage(post(body), posCaido)).status).toBe(502);
    expect((await handleGatewayMessage(post(body), noEsImagen)).status).toBe(422);
  });

  it('con buttons envía el texto con los botones de respuesta', async () => {
    const deps = gatewayDeps();
    const buttons = [
      { id: 'cash_confirm:ORD-000001', title: '✅ CONFIRMAR' },
      { id: 'cash_cancel:ORD-000001', title: '❌ CANCELAR' },
    ];
    const res = await handleGatewayMessage(post({ to: '+59170010001', text: 'Desglose', buttons }), deps);
    expect(await res.json()).toEqual({ externalMessageId: 'wamid.B' });
    expect(deps.sendButtons).toHaveBeenCalledWith('+59170010001', 'Desglose', buttons);
    expect(deps.sendText).not.toHaveBeenCalled();
  });

  it('rechaza botones mal formados sin enviar nada', async () => {
    const deps = gatewayDeps();
    const malos = [
      [],
      [{ id: 'a' }],
      [{ id: 'a', title: 'un título que pasa de veinte' }],
      [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: `B${n}` })),
    ];
    for (const buttons of malos) {
      expect((await handleGatewayMessage(post({ to: '+591700', text: 'x', buttons }), deps)).status).toBe(400);
    }
    expect(deps.sendButtons).not.toHaveBeenCalled();
  });

  it('si WhatsApp falla responde error para que el backend reintente', async () => {
    const caido = gatewayDeps({ sendText: vi.fn(async () => ({ ok: false as const, error: 'timeout' })) });
    expect((await handleGatewayMessage(post({ to: '+591700', text: 'Hola' }), caido)).status).toBe(502);

    const telefonoMalo = gatewayDeps({
      sendText: vi.fn(async () => ({ ok: false as const, error: 'invalid_phone' })),
    });
    expect((await handleGatewayMessage(post({ to: 'x', text: 'Hola' }), telefonoMalo)).status).toBe(422);
  });

  it('valida el cuerpo', async () => {
    expect((await handleGatewayMessage(post({ to: '+591700' }), gatewayDeps())).status).toBe(400);
    expect((await handleGatewayLocationRequest(post({}), gatewayDeps())).status).toBe(400);
    expect((await handleGatewayTelegramAlert(post({}), gatewayDeps())).status).toBe(400);
  });

  it('pide la ubicación y responde 204', async () => {
    const deps = gatewayDeps();
    const res = await handleGatewayLocationRequest(post({ to: '+59170010001', reason: 'delivery_location' }), deps);
    expect(res.status).toBe(204);
    expect(deps.sendLocationRequest).toHaveBeenCalledWith('+59170010001');
  });

  it('el aviso a Telegram manda a resolver en el POS', async () => {
    const deps = gatewayDeps();
    const res = await handleGatewayTelegramAlert(
      post({ chatRef: 'staff-group', text: 'Solicitud SOL-1', buttons: [{ label: 'Aceptar', action: 'a' }] }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(deps.sendTelegram).toHaveBeenCalledWith(expect.stringContaining('Solicitud SOL-1'));
    expect(deps.sendTelegram).toHaveBeenCalledWith(expect.stringContaining('POS'));

    const caido = gatewayDeps({ sendTelegram: vi.fn(async () => false) });
    expect((await handleGatewayTelegramAlert(post({ text: 'x' }), caido)).status).toBe(502);
  });
});

// ── Ubicación ───────────────────────────────────────────────────────────────

describe('ubicación de WhatsApp → backend central', () => {
  const input = { customerPhoneDigits: '59170010001', latitude: -17.8, longitude: -63.19 };

  /** Backend falso con un pedido activo configurable. */
  function backend(active: unknown, location: { status: number; body: unknown } | Error) {
    const paths: string[] = [];
    const request = (async (path: string) => {
      paths.push(path);
      if (path === '/customers/find-or-create') return { status: 201, body: { id: 'cust-1' } };
      if (path.endsWith('/active-order')) return { status: 200, body: active };
      if (location instanceof Error) throw location;
      return location;
    }) as CentralRequestFn;
    return { request, paths };
  }

  const waiting = { orderId: 'o1', orderNumber: 'ORD-000007', status: 'awaiting_location', locationReceived: false };

  it('adjunta al pedido que la esperaba y devuelve el estado ya cotizado', async () => {
    const { attachCentralLocation } = await import('./location');
    const { request, paths } = backend(waiting, {
      status: 201,
      body: { id: 'o1', orderNumber: 'ORD-000007', status: 'confirmed' },
    });
    expect(await attachCentralLocation(input, { request })).toEqual({
      result: 'attached',
      order: { id: 'o1', order_number: 'ORD-000007', status: 'confirmed' },
    });
    expect(paths).toEqual(['/customers/find-or-create', '/customers/cust-1/active-order', '/orders/o1/location']);
  });

  it('sin pedido en curso es una consulta suelta', async () => {
    const { attachCentralLocation } = await import('./location');
    const { request, paths } = backend(null, new Error('no debe llamarse'));
    expect(await attachCentralLocation(input, { request })).toEqual({ result: 'not_found' });
    expect(paths).toHaveLength(2);
  });

  it('un pin reenviado a un pedido que ya la tenía no es un error', async () => {
    const { attachCentralLocation } = await import('./location');
    const { request } = backend({ ...waiting, status: 'confirmed', locationReceived: true }, new Error('x'));
    expect((await attachCentralLocation(input, { request })).result).toBe('already_attached');
  });

  it('un pedido para recoger no acepta ubicación', async () => {
    const { attachCentralLocation } = await import('./location');
    const { request } = backend({ ...waiting, status: 'confirmed' }, new Error('x'));
    expect((await attachCentralLocation(input, { request })).result).toBe('invalid_status');
  });

  it('traduce los rechazos del contrato; lo demás sube', async () => {
    const { attachCentralLocation } = await import('./location');
    // Los tres `code` que `POST /orders/:id/location` puede devolver con 409.
    const casos = [
      ['location_conflict', 'concurrent_update'],
      ['location_not_expected', 'invalid_status'],
      ['location_already_attached', 'already_attached'],
    ] as const;
    for (const [code, esperado] of casos) {
      const { request } = backend(waiting, centralError(409, code));
      expect((await attachCentralLocation(input, { request })).result, code).toBe(esperado);
    }

    const caido = backend(waiting, centralError(0, 'central_unreachable'));
    await expect(attachCentralLocation(input, { request: caido.request })).rejects.toThrow();
  });
});

describe('cotizar un punto sin pedido → POST /delivery/quotes', () => {
  const input = { customerPhoneDigits: '59170010001', sourceMessageId: 'wamid.PIN', latitude: -17.8, longitude: -63.19 };

  function backend(quote: { status: number; body: unknown } | Error) {
    const calls: Array<{ path: string; init?: { headers?: Record<string, string>; body?: unknown } }> = [];
    const request = (async (path: string, init?: { headers?: Record<string, string>; body?: unknown }) => {
      calls.push({ path, init });
      if (path === '/customers/find-or-create') return { status: 201, body: { id: 'cust-1' } };
      if (quote instanceof Error) throw quote;
      return quote;
    }) as CentralRequestFn;
    return { request, calls };
  }

  it('devuelve el monto que cotizó el POS, con una clave por mensaje', async () => {
    const { quoteCentralLocation } = await import('./location');
    const { request, calls } = backend({
      status: 201,
      body: { id: 'q1', status: 'quoted', distanceMeters: 4080, feeAmount: 18, errorCode: null },
    });

    expect(await quoteCentralLocation(input, { request })).toEqual({ result: 'quoted', amount: 18 });

    expect(calls[1].path).toBe('/delivery/quotes');
    // La misma ubicación entregada dos veces por el webhook no se mide dos veces.
    expect(calls[1].init?.headers).toEqual({ 'idempotency-key': 'quote:wamid.PIN' });
    expect(calls[1].init?.body).toEqual({ customerId: 'cust-1', latitude: -17.8, longitude: -63.19 });
  });

  it('fuera del tarifario no hay precio: es fuera de cobertura', async () => {
    const { quoteCentralLocation } = await import('./location');
    const { request } = backend({
      status: 201,
      body: { id: 'q1', status: 'manual_quote', distanceMeters: 30000, feeAmount: null, errorCode: 'manual_quote' },
    });
    expect(await quoteCentralLocation(input, { request })).toEqual({ result: 'out_of_coverage' });
  });

  it('nunca lanza: un POS caído o una medición fallida son un failed', async () => {
    const { quoteCentralLocation } = await import('./location');
    const fallida = backend({ status: 201, body: { id: 'q1', status: 'failed', feeAmount: null, errorCode: 'distance_unavailable' } });
    expect(await quoteCentralLocation(input, { request: fallida.request })).toEqual({
      result: 'failed',
      error: 'distance_unavailable',
    });

    const caido = backend(centralError(0, 'central_unreachable'));
    expect(await quoteCentralLocation(input, { request: caido.request })).toEqual({
      result: 'failed',
      error: 'central_unreachable',
    });

    // Un "quoted" sin monto no es una cotización: no se le dice un precio al cliente.
    const sinMonto = backend({ status: 201, body: { id: 'q1', status: 'quoted', feeAmount: null, errorCode: null } });
    expect((await quoteCentralLocation(input, { request: sinMonto.request })).result).toBe('failed');
  });
});

describe('efectivo: CONFIRMAR / CANCELAR con el backend central', () => {
  const awaiting = {
    orderId: 'o1',
    orderNumber: 'ORD-000001',
    status: 'confirmed',
    paymentMethod: 'cash',
    totalAmount: 72,
    subtotalAmount: 54,
    deliveryType: 'delivery',
    cashConfirmed: false,
    locationReceived: true,
    proofReceived: false,
  };

  function backend(active: unknown, decision?: Error) {
    const paths: string[] = [];
    const request = (async (path: string) => {
      paths.push(path);
      if (path === '/customers/find-or-create') return { status: 201, body: { id: 'cust-1' } };
      if (path.endsWith('/active-order')) return { status: 200, body: active };
      if (decision) throw decision;
      return { status: 201, body: {} };
    }) as CentralRequestFn;
    return { request, paths };
  }

  const base = { paused: false, openOrder: null, proofRemindedRecently: false };

  it('el pedido que espera CONFIRMAR pasa al estado del cliente y el botón lo decide', async () => {
    const { withCentralCashOrder } = await import('./cash');
    const { decideDefaultReply } = await import('@/lib/webhook/default-reply');
    const state = await withCentralCashOrder(base, '59170010001', backend(awaiting));

    expect(state?.openOrder).toMatchObject({
      orderId: 'o1',
      orderNumber: 'ORD-000001',
      awaitingCashConfirm: true,
      totalAmount: 72,
    });
    const decision = decideDefaultReply({
      buttonPress: { decision: 'confirm', orderNumber: 'ORD-000001' },
      text: null,
      isBatchAnchor: true,
      menuAlreadySent: false,
      explicitIntent: false,
      state,
    });
    expect(decision).toMatchObject({ action: 'cash_confirm', order: { orderId: 'o1' } });
  });

  it('un botón de otro pedido no decide nada', async () => {
    const { withCentralCashOrder } = await import('./cash');
    const { decideDefaultReply } = await import('@/lib/webhook/default-reply');
    const state = await withCentralCashOrder(base, '59170010001', backend(awaiting));
    const decision = decideDefaultReply({
      buttonPress: { decision: 'cancel', orderNumber: 'ORD-000099' },
      text: null,
      isBatchAnchor: true,
      menuAlreadySent: false,
      explicitIntent: false,
      state,
    });
    expect(decision).toMatchObject({ action: 'none', reason: 'stale_button' });
  });

  it('fuera de la espera el estado queda como estaba', async () => {
    const { withCentralCashOrder } = await import('./cash');
    const casos = [
      null,
      { ...awaiting, cashConfirmed: true },
      { ...awaiting, paymentMethod: 'qr' },
      { ...awaiting, status: 'awaiting_location' },
    ];
    for (const active of casos) {
      expect(await withCentralCashOrder(base, '59170010001', backend(active))).toBe(base);
    }
  });

  it('con una pausa no consulta al backend, y si el backend cae no rompe', async () => {
    const { withCentralCashOrder } = await import('./cash');
    const pausado = { ...base, paused: true };
    const espia = backend(awaiting);
    expect(await withCentralCashOrder(pausado, '59170010001', espia)).toBe(pausado);
    expect(espia.paths).toHaveLength(0);

    const caido = (async () => {
      throw centralError(0, 'central_unreachable');
    }) as CentralRequestFn;
    expect(await withCentralCashOrder(base, '59170010001', { request: caido })).toBe(base);
  });

  it('la decisión va al backend; si la rechaza, ok es false', async () => {
    const { decideCentralCashOrder } = await import('./cash');
    const bien = backend(awaiting);
    expect(await decideCentralCashOrder({ orderId: 'o1', decision: 'confirm' }, bien)).toEqual({ ok: true });
    expect(await decideCentralCashOrder({ orderId: 'o1', decision: 'cancel' }, bien)).toEqual({ ok: true });
    expect(bien.paths).toEqual(['/orders/o1/cash/confirm', '/orders/o1/cash/cancel']);

    const rechazo = backend(awaiting, centralError(409, 'cash_order_already_confirmed'));
    expect(await decideCentralCashOrder({ orderId: 'o1', decision: 'cancel' }, rechazo)).toEqual({ ok: false });
  });
});
