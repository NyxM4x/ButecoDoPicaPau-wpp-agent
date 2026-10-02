const baseUrl = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '');
const token = process.env.SMOKE_SERVICE_TOKEN ?? 'ci-gateway-token';

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text}`);
  }
  return { status: response.status, body };
}

const healthResponse = await fetch(`${baseUrl}/health`);
if (!healthResponse.ok) throw new Error(`health -> ${healthResponse.status}`);

const customer = await request('/customers/find-or-create', {
  method: 'POST',
  body: JSON.stringify({
    phone: '+59170000001',
    name: 'Cliente Staging CI',
  }),
});
if (!customer.body?.id) throw new Error('customer id missing');

const products = await request('/products');
const product = products.body?.find?.((item) => item.code === 'STG-PLATO-01');
if (!product?.id) throw new Error('staging product missing from API');

const idem = `staging-ci-${Date.now()}`;
const created = await request('/orders', {
  method: 'POST',
  headers: { 'idempotency-key': idem },
  body: JSON.stringify({
    customerId: customer.body.id,
    channel: 'web',
    customerName: 'Cliente Staging CI',
    deliveryType: 'delivery',
    paymentMethod: 'cash',
    items: [{ productId: product.id, quantity: 1 }],
    promotions: [],
  }),
});

if (created.status !== 201) {
  throw new Error(`expected order 201, got ${created.status}`);
}
const orderId = created.body?.id;
if (!orderId) throw new Error('order id missing');
if (created.body?.totalAmount !== 25 || created.body?.status !== 'awaiting_location') {
  throw new Error(
    `unexpected initial delivery state: total=${created.body?.totalAmount}, status=${created.body?.status}`,
  );
}

const quoted = await request(`/orders/${orderId}/location`, {
  method: 'POST',
  body: JSON.stringify({
    latitude: -17.759,
    longitude: -63.18,
  }),
});
if (
  quoted.body?.deliveryQuoteStatus !== 'quoted' ||
  !(quoted.body?.deliveryBaseAmount > 0) ||
  !(quoted.body?.totalAmount > 25)
) {
  throw new Error(
    `delivery quote was not applied: ${JSON.stringify({
      status: quoted.body?.deliveryQuoteStatus,
      delivery: quoted.body?.deliveryBaseAmount,
      total: quoted.body?.totalAmount,
    })}`,
  );
}

const active = await request(`/customers/${customer.body.id}/active-order`);
if (active.body?.orderId !== orderId) {
  throw new Error('active-order did not resolve the created order');
}

const noted = await request(`/orders/${orderId}/kitchen-note`, {
  method: 'POST',
  body: JSON.stringify({ note: 'SMOKE CI' }),
});
if (!String(noted.body?.notes ?? '').includes('SMOKE CI')) {
  throw new Error('kitchen note was not persisted');
}

const cash = await request(`/orders/${orderId}/cash/confirm`, {
  method: 'POST',
});
if (!cash.body?.cashConfirmedAt) {
  throw new Error('cash confirmation was not persisted');
}

const fetched = await request(`/orders/${orderId}`);
if (fetched.body?.id !== orderId || !fetched.body?.cashConfirmedAt) {
  throw new Error('final order state mismatch');
}

console.log(
  JSON.stringify(
    {
      ok: true,
      customerId: customer.body.id,
      orderId,
      orderNumber: fetched.body.orderNumber,
      totalAmount: fetched.body.totalAmount,
      deliveryBaseAmount: fetched.body.deliveryBaseAmount,
      cashConfirmed: true,
    },
    null,
    2,
  ),
);
