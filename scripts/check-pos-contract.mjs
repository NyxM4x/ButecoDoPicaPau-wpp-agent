#!/usr/bin/env node
// Comprueba si un POS cumple el contrato que usa el agente de WhatsApp
// (docs/pos-contract.md, versión v1). Se corre contra cualquier URL + token y
// dice, llamada por llamada, qué cumple y qué no. Sin dependencias (Node >= 20).
//
//   node scripts/check-pos-contract.mjs                       # solo lectura, contra el backend local
//   node scripts/check-pos-contract.mjs --url https://pos.ejemplo.com --token XXXX
//   node scripts/check-pos-contract.mjs --write --phone +59170000000
//   node scripts/check-pos-contract.mjs --gateway https://agente.ejemplo.com/api --gateway-token YYYY
//
// Por defecto NO crea nada: solo lee el perfil y el catálogo y provoca errores
// que el POS debe rechazar sin guardar datos.
//
// --write   Crea un cliente y pedidos de prueba, y los cancela al terminar.
//           SOLO en un restaurante de prueba: los pedidos aparecen en cocina, y
//           si el POS tiene su gateway conectado le escribe por WhatsApp al
//           teléfono de --phone. Por eso --phone es obligatorio: tiene que ser
//           un número tuyo.
// --confirm-cash   Con --write: prueba además CONFIRMAR en efectivo y los
//           botones del personal (Listo, Entregado), que cierran el pedido. Si
//           el POS no acepta esos botones (tiene pantallas propias), queda un
//           pedido CONFIRMADO que hay que cerrar a mano desde el POS, y hasta
//           entonces ese teléfono no sirve para otra corrida.
// --other-token T   Con --write: token de OTRO restaurante, para comprobar que
//           no puede ver al cliente recién creado (el restaurante sale del token).
// --gateway URL --gateway-token T   Comprueba el otro sentido del contrato: las
//           tres rutas que el agente expone al POS. No envía ningún mensaje.
// --json    Resultado en JSON, para usarlo desde otro programa.
//
// Destino y credenciales (opciones o variables de entorno):
//   --url    / POS_URL     por defecto http://localhost:<PORT de apps/backend/.env.dev>
//   --token  / POS_TOKEN   por defecto el de "whatsapp-gateway" en apps/backend/.env.dev
//
// Sale con código 0 si todo lo comprobado cumple, 1 si algo falla y 2 si no se
// pudo ni empezar.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_VERSION = 'v1';
const TIMEOUT_MS = 15_000;

// ── Opciones ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : undefined;
};

if (flag('help') || flag('h')) {
  const source = await readFile(fileURLToPath(import.meta.url), 'utf8');
  const header = source.split('\n').slice(1).filter((line) => line.startsWith('//'));
  console.log(header.slice(0, header.findIndex((line) => line.includes('Sale con código')) + 2).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}

/** Lee un archivo KEY=VALUE sin evaluar nada; devuelve {} si no existe. */
async function readEnvFile(file) {
  try {
    const text = await readFile(file, 'utf8');
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}

const devEnv = await readEnvFile(path.join(ROOT, 'apps', 'backend', '.env.dev'));
const devToken = (devEnv.SERVICE_AUTH_TOKENS ?? '')
  .split(',')
  .map((pair) => pair.trim().split(':'))
  .find(([client]) => client === 'whatsapp-gateway')?.[1];

const baseUrl = (option('url') ?? process.env.POS_URL ?? `http://localhost:${devEnv.PORT ?? 3100}`).replace(/\/+$/, '');
const token = option('token') ?? process.env.POS_TOKEN ?? devToken;
const writeMode = flag('write');
const phone = option('phone');
const otherToken = option('other-token');
const confirmCash = flag('confirm-cash');
const gatewayUrl = option('gateway')?.replace(/\/+$/, '');
const gatewayToken = option('gateway-token') ?? process.env.GATEWAY_AUTH_TOKEN;
const asJson = flag('json');

if (!token) {
  console.error('Falta el token: --token, POS_TOKEN, o apps/backend/.env.dev con SERVICE_AUTH_TOKENS.');
  process.exit(2);
}
if (writeMode && !/^\+\d{8,15}$/.test(phone ?? '')) {
  console.error('--write necesita --phone con un número TUYO en formato E.164 (+59170000000): el POS puede escribirle por WhatsApp.');
  process.exit(2);
}

// ── Resultados ──────────────────────────────────────────────────────────────

/** @type {Array<{section: string, name: string, status: 'ok'|'fail'|'skip', detail: string}>} */
const results = [];
let section = '';

function record(status, name, detail = '') {
  results.push({ section, name, status, detail });
  if (asJson) return;
  const mark = status === 'ok' ? '  ✔' : status === 'fail' ? '  ✖' : '  –';
  console.log(`${mark} ${name}${detail ? `\n      ${detail.split('\n').join('\n      ')}` : ''}`);
}
const ok = (name, detail) => record('ok', name, detail);
const fail = (name, detail) => record('fail', name, detail);
const skip = (name, detail) => record('skip', name, detail);

function begin(title) {
  section = title;
  if (!asJson) console.log(`\n${title}`);
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/** Llama y devuelve estado, cuerpo JSON (o null) y cabeceras. Nunca lanza por un 4xx/5xx. */
async function call(method, route, { body, headers = {}, auth = token, base = baseUrl } = {}) {
  let response;
  try {
    response = await fetch(`${base}${route}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { status: 0, json: null, text: '', headers: new Headers(), networkError: error?.cause?.code ?? error?.name ?? String(error) };
  }
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  const text = isJson || response.status >= 400 ? await response.text() : '';
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!text) await response.arrayBuffer().catch(() => undefined);
  return { status: response.status, json, text, headers: response.headers };
}

const describeResponse = (res) =>
  res.networkError
    ? `sin respuesta (${res.networkError})`
    : `respondió ${res.status}${res.text ? `: ${res.text.slice(0, 240)}` : ''}`;

// ── Validación de formas ────────────────────────────────────────────────────

const typeOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

/**
 * Compara un objeto con su forma. `spec` es campo → tipos admitidos separados
 * por `|` (`string`, `number`, `boolean`, `null`, `array`, `object`), o una
 * función que devuelve una lista de problemas. Los campos de más no importan:
 * el POS puede devolver lo que quiera además de lo que pide el contrato.
 */
function shapeProblems(value, spec, where = '') {
  if (typeOf(value) !== 'object') return [`${where || 'el cuerpo'} debería ser un objeto y es ${typeOf(value)}`];
  const problems = [];
  for (const [field, expected] of Object.entries(spec)) {
    const at = where ? `${where}.${field}` : field;
    if (!(field in value)) {
      problems.push(`falta ${at}`);
      continue;
    }
    if (typeof expected === 'function') {
      problems.push(...expected(value[field], at));
    } else if (!expected.split('|').includes(typeOf(value[field]))) {
      problems.push(`${at} debería ser ${expected} y es ${typeOf(value[field])} (${JSON.stringify(value[field])?.slice(0, 60)})`);
    }
  }
  return problems;
}

const oneOf = (...allowed) => (value, at) =>
  allowed.includes(value) ? [] : [`${at} debería ser uno de ${allowed.join(', ')} y es ${JSON.stringify(value)}`];
const nullable = (check) => (value, at) => (value === null ? [] : check(value, at));
const nested = (spec) => (value, at) => shapeProblems(value, spec, at);
const listOf = (spec) => (value, at) =>
  Array.isArray(value)
    ? value.slice(0, 50).flatMap((item, index) => shapeProblems(item, spec, `${at}[${index}]`))
    : [`${at} debería ser una lista y es ${typeOf(value)}`];
const isoDate = (value, at) =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? [] : [`${at} debería ser una fecha ISO 8601 y es ${JSON.stringify(value)}`];
const amount = (value, at) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? []
    : [`${at} debería ser un número (no texto) mayor o igual a 0 y es ${JSON.stringify(value)}`];

const DELIVERY_TYPES = ['delivery', 'pickup', 'dine_in'];
const PAYMENT_METHODS = ['cash', 'qr', 'card'];
const ORDER_STATUSES = ['draft', 'awaiting_location', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'pending_review', 'paid', 'rejected', 'paid_unapplied', 'refunded'];
const QUOTE_STATUSES = ['pending', 'quoted', 'pending_manual', 'failed'];

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const weekly = (value, at) => {
  if (!Array.isArray(value) || value.length !== 7) return [`${at} debería tener 7 entradas (domingo a sábado) y tiene ${Array.isArray(value) ? value.length : typeOf(value)}`];
  return value.flatMap((day, index) => {
    if (day === null) return [];
    if (typeOf(day) !== 'object' || !CLOCK.test(day.opens ?? '') || !CLOCK.test(day.closes ?? '')) {
      return [`${at}[${index}] debería ser null o { opens: "HH:MM", closes: "HH:MM" } y es ${JSON.stringify(day)}`];
    }
    return [];
  });
};

const PROFILE_SHAPE = {
  contractVersion: (value, at) => (value === CONTRACT_VERSION ? [] : [`${at} debería ser "${CONTRACT_VERSION}" y es ${JSON.stringify(value)}`]),
  name: (value, at) => (typeof value === 'string' && value.trim() ? [] : [`${at} debería ser un texto no vacío`]),
  description: 'string|null',
  locale: (value, at) => (typeof value === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value) ? [] : [`${at} debería ser BCP 47 (es-BO) y es ${JSON.stringify(value)}`]),
  timezone: (value, at) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return typeof value === 'string' ? [] : [`${at} debería ser una zona IANA`];
    } catch {
      return [`${at} debería ser una zona IANA (America/La_Paz) y es ${JSON.stringify(value)}`];
    }
  },
  currency: nested({
    code: (value, at) => (/^[A-Z]{3}$/.test(value ?? '') ? [] : [`${at} debería ser ISO 4217 (BOB) y es ${JSON.stringify(value)}`]),
    symbol: 'string',
  }),
  phone: nullable((value, at) => (/^\+\d{8,15}$/.test(value) ? [] : [`${at} debería ser E.164 (+591…) y es ${JSON.stringify(value)}`])),
  location: nested({ address: 'string|null', mapsUrl: 'string|null', latitude: 'number|null', longitude: 'number|null' }),
  hours: nested({ text: 'string|null', weekly }),
  ordering: nested({
    paused: 'boolean',
    pickupEnabled: 'boolean',
    deliveryEnabled: 'boolean',
    paymentMethods: (value, at) =>
      Array.isArray(value) && value.length > 0 && value.every((method) => PAYMENT_METHODS.includes(method))
        ? []
        : [`${at} debería ser una lista no vacía de ${PAYMENT_METHODS.join(', ')} y es ${JSON.stringify(value)}`],
  }),
  messages: nested({ greeting: 'string|null', farewell: 'string|null' }),
  menuMedia: nested({ videoUrl: 'string|null', imageUrl: 'string|null' }),
};

const CATEGORY_SHAPE = { id: 'string', name: 'string', sortOrder: 'number', isActive: 'boolean' };
const PRODUCT_SHAPE = {
  id: 'string',
  code: 'string',
  name: 'string',
  description: 'string|null',
  categoryId: 'string',
  price: amount,
  isActive: 'boolean',
  isAvailable: 'boolean',
  sortOrder: 'number',
  imageUrl: 'string|null',
};
const PROMOTION_SHAPE = {
  id: 'string',
  name: 'string',
  description: 'string|null',
  promoPrice: amount,
  isActive: 'boolean',
  archivedAt: 'string|null',
  startsAt: 'string|null',
  endsAt: 'string|null',
  sortOrder: 'number',
  imageUrl: 'string|null',
  revision: 'number',
  items: listOf({ productId: 'string', productName: 'string', quantity: 'number', unitPrice: amount }),
};
const CUSTOMER_SHAPE = { id: 'string', name: 'string|null', phone: 'string|null' };
const ORDER_SHAPE = {
  id: 'string',
  orderNumber: 'string',
  customerId: 'string|null',
  customerName: 'string',
  deliveryType: oneOf(...DELIVERY_TYPES),
  paymentMethod: oneOf(...PAYMENT_METHODS),
  paymentStatus: oneOf(...PAYMENT_STATUSES),
  status: oneOf(...ORDER_STATUSES),
  notes: 'string|null',
  subtotalAmount: amount,
  deliveryBaseAmount: amount,
  deliverySurchargeAmount: amount,
  totalAmount: amount,
  deliveryQuoteStatus: nullable(oneOf(...QUOTE_STATUSES)),
  deliveryDistanceMeters: 'number|null',
  cashConfirmedAt: 'string|null',
  createdAt: isoDate,
  items: listOf({ productId: 'string', productNameSnapshot: 'string', unitPriceSnapshot: amount, quantity: 'number', subtotal: amount }),
  promotions: 'array',
};
const PENDING_REQUEST_SHAPE = { requestId: 'string', requestNumber: 'string', status: oneOf('pending'), subtotalAmount: amount, expiresAt: isoDate };
const ACTIVE_ORDER_SHAPE = {
  orderId: 'string',
  orderNumber: 'string',
  status: oneOf(...ORDER_STATUSES),
  paymentStatus: oneOf(...PAYMENT_STATUSES),
  paymentMethod: oneOf(...PAYMENT_METHODS),
  totalAmount: amount,
  subtotalAmount: amount,
  deliveryType: oneOf(...DELIVERY_TYPES),
  deliveryQuoteStatus: nullable(oneOf(...QUOTE_STATUSES)),
  cashConfirmed: 'boolean',
  locationReceived: 'boolean',
  proofReceived: 'boolean',
  createdAt: isoDate,
};
const ERROR_SHAPE = { code: 'string', message: 'string|array' };
/** Lo que devuelve una acción del personal: el aviso tal como queda. */
const STAFF_NOTICE_SHAPE = {
  text: (value, at) => (typeof value === 'string' && value.trim() ? [] : [`${at} debería ser un texto no vacío`]),
  buttons: listOf({ label: 'string', action: 'string' }),
};
const STAFF_ACTION = /^orders\/[0-9a-f-]{36}\/staff\/(ready|out|delivered)$/i;

// ── Comprobaciones reutilizables ────────────────────────────────────────────

/** Estado esperado + forma. Devuelve el cuerpo si cumple, o null. */
function expectShape(name, res, statuses, shape) {
  if (!statuses.includes(res.status)) {
    fail(name, `se esperaba ${statuses.join(' o ')} y ${describeResponse(res)}`);
    return null;
  }
  const problems = shape ? shapeProblems(res.json, shape) : [];
  if (problems.length > 0) {
    fail(name, problems.slice(0, 8).join('\n'));
    return null;
  }
  ok(name);
  return res.json;
}

function expectList(name, res, shape) {
  if (res.status !== 200 || !Array.isArray(res.json)) {
    fail(name, `se esperaba 200 con una lista y ${describeResponse(res)}`);
    return null;
  }
  const problems = res.json.slice(0, 200).flatMap((item, index) => shapeProblems(item, shape, `[${index}]`));
  if (problems.length > 0) {
    fail(name, problems.slice(0, 8).join('\n'));
    return null;
  }
  ok(name, `${res.json.length} elemento(s)`);
  return res.json;
}

/** Un error del contrato: estado HTTP, `{ code, message }` y, si se indica, ese `code` exacto. */
function expectError(name, res, status, code) {
  const statuses = Array.isArray(status) ? status : [status];
  if (!statuses.includes(res.status)) {
    fail(name, `se esperaba ${statuses.join(' o ')}${code ? ` con code "${code}"` : ''} y ${describeResponse(res)}`);
    return false;
  }
  const problems = shapeProblems(res.json, ERROR_SHAPE);
  if (problems.length > 0) {
    fail(name, `el error no tiene la forma { code, message, details }: ${problems.join('; ')}`);
    return false;
  }
  if (code && res.json.code !== code) {
    fail(name, `se esperaba code "${code}" y llegó "${res.json.code}"`);
    return false;
  }
  ok(name);
  return true;
}

// ── 1. Acceso ───────────────────────────────────────────────────────────────

async function checkAccess() {
  begin('Acceso');
  const first = await call('GET', '/restaurant/profile');
  if (first.networkError) {
    fail(`conectar con ${baseUrl}`, `sin respuesta (${first.networkError})`);
    return false;
  }
  ok(`conectar con ${baseUrl}`);

  expectError('sin token responde 401', await call('GET', '/products', { auth: null }), 401);
  expectError('con un token que no existe responde 401', await call('GET', '/products', { auth: `no-existe-${randomUUID()}` }), 401);
  return true;
}

// ── 2. Lectura: perfil y catálogo ───────────────────────────────────────────

async function checkReads() {
  begin('Perfil del restaurante');
  const profile = expectShape('GET /restaurant/profile', await call('GET', '/restaurant/profile'), [200], PROFILE_SHAPE);
  if (profile) {
    const { latitude, longitude } = profile.location;
    if (profile.ordering.deliveryEnabled && (latitude === null || longitude === null)) {
      fail('con envío activo, el perfil trae las coordenadas del local', 'location.latitude y location.longitude están en null: no se puede cotizar un envío.');
    } else {
      ok('las coordenadas del local son coherentes con el envío');
    }
    if (!profile.ordering.deliveryEnabled && !profile.ordering.pickupEnabled) {
      fail('se puede pedir de alguna forma', 'deliveryEnabled y pickupEnabled están los dos apagados.');
    }
  }

  begin('Catálogo');
  const categories = expectList('GET /categories', await call('GET', '/categories'), CATEGORY_SHAPE);
  const products = expectList('GET /products', await call('GET', '/products'), PRODUCT_SHAPE);
  const promotions = expectList('GET /promotions', await call('GET', '/promotions'), PROMOTION_SHAPE);

  if (products) {
    const codes = products.map((product) => product.code);
    const repeated = codes.filter((code, index) => codes.indexOf(code) !== index);
    if (repeated.length > 0) fail('los códigos de producto no se repiten', `repetidos: ${[...new Set(repeated)].join(', ')}`);
    else ok('los códigos de producto no se repiten');

    if (products.some((product) => product.isActive === false)) {
      fail('GET /products solo trae productos activos', 'llegó al menos uno con isActive: false.');
    } else {
      ok('GET /products solo trae productos activos');
    }

    if (categories) {
      const known = new Set(categories.map((category) => category.id));
      const orphans = products.filter((product) => !known.has(product.categoryId));
      // No es un fallo: un producto de una categoría apagada simplemente no se muestra.
      if (orphans.length > 0) skip('todos los productos están en una categoría activa', `${orphans.length} producto(s) quedan fuera del menú por estar en una categoría apagada.`);
      else ok('todos los productos están en una categoría activa');
    }

    const badImageUrl = products.find((product) => product.imageUrl !== null && product.imageUrl !== `/products/${product.id}/image`);
    if (badImageUrl) fail('imageUrl es null o la ruta /products/:id/image', `el producto ${badImageUrl.code} trae ${badImageUrl.imageUrl}`);
    else ok('imageUrl es null o la ruta /products/:id/image');

    const withImage = products.find((product) => product.imageUrl);
    if (withImage) {
      const image = await call('GET', `/products/${withImage.id}/image`);
      const type = image.headers.get('content-type')?.split(';')[0].trim() ?? '';
      if (image.status === 200 && ['image/jpeg', 'image/png', 'image/webp'].includes(type)) ok('GET /products/:id/image devuelve la foto', type);
      else fail('GET /products/:id/image devuelve la foto', `se esperaba 200 con image/jpeg, image/png o image/webp y llegó ${image.status} ${type}`);
      expectError('la foto no se entrega sin token', await call('GET', `/products/${withImage.id}/image`, { auth: null }), 401);
    } else {
      skip('GET /products/:id/image devuelve la foto', 'ningún producto tiene foto.');
    }

    const withoutImage = products.find((product) => !product.imageUrl);
    if (withoutImage) {
      expectError('un producto sin foto responde 404 product_image_not_set', await call('GET', `/products/${withoutImage.id}/image`), 404, 'product_image_not_set');
    }
  }

  if (promotions && products) {
    const productIds = new Set(products.map((product) => product.id));
    const live = promotions.filter((promotion) => promotion.archivedAt === null && promotion.isActive);
    const broken = live.filter((promotion) => promotion.items.length < 1);
    if (broken.length > 0) fail('toda promoción activa tiene componentes', broken.map((promotion) => promotion.name).join(', '));
    else ok('toda promoción activa tiene componentes');
    const missing = live.filter((promotion) => promotion.items.some((item) => !productIds.has(item.productId)));
    // Tampoco es un fallo: con un componente apagado la promoción no se vende.
    if (missing.length > 0) skip('los componentes de las promociones activas están en el catálogo', `${missing.map((promotion) => promotion.name).join(', ')} no se pueden vender ahora.`);
  }

  return { profile, products: products ?? [], promotions: promotions ?? [] };
}

// ── 3. Errores que no guardan nada ──────────────────────────────────────────

async function checkRejections() {
  begin('Rechazos (no crean datos)');
  const ghost = randomUUID();

  expectError('un cliente que no existe responde 404 not_found', await call('GET', `/customers/${ghost}/active-order`), 404, 'not_found');
  expectError('un pedido que no existe responde 404 not_found', await call('POST', `/orders/${ghost}/cash/confirm`), 404, 'not_found');
  expectError(
    'una ubicación para un pedido que no existe responde 404 not_found',
    await call('POST', `/orders/${ghost}/location`, { body: { latitude: -17.78, longitude: -63.18 } }),
    404,
    'not_found',
  );
  expectError('un id que no es UUID responde 400', await call('GET', '/customers/no-es-un-uuid/active-order'), 400);
  expectError(
    'POST /orders con un cuerpo vacío responde 400',
    await call('POST', '/orders', { body: {}, headers: { 'idempotency-key': randomUUID() } }),
    400,
  );
  expectError(
    'POST /orders sin Idempotency-Key responde 400',
    await call('POST', '/orders', {
      body: { channel: 'whatsapp', customerName: 'Prueba', deliveryType: 'pickup', paymentMethod: 'cash', items: [] },
    }),
    400,
  );
  expectError(
    'una ubicación fuera de rango responde 400',
    await call('POST', `/orders/${ghost}/location`, { body: { latitude: 999, longitude: 999 } }),
    400,
  );
  expectError('POST /customers/find-or-create sin datos responde 400', await call('POST', '/customers/find-or-create', { body: {} }), 400);
}

// ── 4. Escritura: cliente y pedidos de prueba ───────────────────────────────

/** Cancela un pedido de prueba sin registrar nada: es limpieza. */
async function cancelQuietly(orderId) {
  if (orderId) await call('POST', `/orders/${orderId}/cash/cancel`);
}

async function checkWrites({ profile, products, promotions }) {
  begin('Cliente');
  const firstCustomer = await call('POST', '/customers/find-or-create', { body: { phone, name: 'Prueba de contrato' } });
  const customer = expectShape('POST /customers/find-or-create crea o encuentra al cliente', firstCustomer, [200, 201], CUSTOMER_SHAPE);
  if (!customer) return;

  const again = await call('POST', '/customers/find-or-create', { body: { phone } });
  if (again.json?.id === customer.id) ok('el mismo teléfono devuelve el mismo cliente');
  else fail('el mismo teléfono devuelve el mismo cliente', `primero ${customer.id}, después ${again.json?.id ?? describeResponse(again)}`);

  if (otherToken) {
    expectError(
      'otro restaurante no ve a este cliente (el restaurante sale del token)',
      await call('GET', `/customers/${customer.id}/active-order`, { auth: otherToken }),
      404,
      'not_found',
    );
  } else {
    skip('otro restaurante no ve a este cliente', 'pasa --other-token con el token de otro restaurante para comprobarlo.');
  }

  const before = await call('GET', `/customers/${customer.id}/active-order`);
  if (before.status === 200 && before.json === null) {
    ok('GET /customers/:id/active-order responde null sin pedido en curso');
  } else if (before.status === 200 && shapeProblems(before.json, ACTIVE_ORDER_SHAPE).length === 0) {
    fail('el cliente de prueba no tiene pedidos en curso', `tiene ${before.json.orderNumber} en ${before.json.status}. Cancélalo o usa otro --phone: las comprobaciones siguientes darían resultados confusos.`);
    return;
  } else {
    fail('GET /customers/:id/active-order responde null sin pedido en curso', describeResponse(before));
  }

  begin('Pedido');
  const sellable = products.filter((product) => product.isActive && product.isAvailable);
  if (sellable.length === 0) {
    skip('crear un pedido', 'no hay ningún producto disponible en el catálogo.');
    return;
  }
  const cheapest = [...sellable].sort((a, b) => a.price - b.price)[0];
  const payment = profile?.ordering.paymentMethods.includes('cash') ? 'cash' : (profile?.ordering.paymentMethods[0] ?? 'cash');
  const orderBody = (deliveryType) => ({
    customerId: customer.id,
    channel: 'whatsapp',
    customerName: 'Prueba de contrato',
    deliveryType,
    paymentMethod: payment,
    notes: 'PEDIDO DE PRUEBA (check-pos-contract): no preparar',
    items: [{ productId: cheapest.id, quantity: 1 }],
  });

  const canPickup = profile ? profile.ordering.pickupEnabled : true;
  const canDeliver = profile ? profile.ordering.deliveryEnabled : true;

  /**
   * Rechazos de carrito y de configuración: no guardan nada y no consumen la
   * clave. Solo se prueban si el POS está creando pedidos de verdad: uno que
   * los deja en revisión (202) valida el carrito recién cuando una persona lo
   * acepta, y aquí solo se llenaría de solicitudes de prueba.
   */
  async function checkCartRejections() {
    begin('Rechazos de carrito');
    // Con un tipo de entrega que el local sí ofrece, para que el rechazo sea el del carrito.
    const offered = canPickup ? 'pickup' : 'delivery';
    expectError(
      'un producto que no existe responde 409 product_unavailable',
      await call('POST', '/orders', {
        body: { ...orderBody(offered), items: [{ productId: randomUUID(), quantity: 1 }] },
        headers: { 'idempotency-key': randomUUID() },
      }),
      409,
      'product_unavailable',
    );
    expectError(
      'una promoción que no existe responde 409 promotion_unavailable',
      await call('POST', '/orders', {
        body: { ...orderBody(offered), promotions: [{ promotionId: randomUUID(), quantity: 1, revision: 1 }] },
        headers: { 'idempotency-key': randomUUID() },
      }),
      409,
      'promotion_unavailable',
    );
    const livePromotion = promotions.find((promotion) => promotion.isActive && promotion.archivedAt === null);
    if (livePromotion) {
      expectError(
        'una promoción con la revisión vieja responde 409 promotion_unavailable',
        await call('POST', '/orders', {
          body: { ...orderBody(offered), items: [], promotions: [{ promotionId: livePromotion.id, quantity: 1, revision: livePromotion.revision + 1000 }] },
          headers: { 'idempotency-key': randomUUID() },
        }),
        409,
        'promotion_unavailable',
      );
    }

    if (profile && !canPickup) {
      expectError(
        'con el retiro apagado, un pedido para retirar responde 409 pickup_disabled',
        await call('POST', '/orders', { body: orderBody('pickup'), headers: { 'idempotency-key': randomUUID() } }),
        409,
        'pickup_disabled',
      );
    }
    if (profile && !canDeliver) {
      expectError(
        'con el envío apagado, un pedido con envío responde 409 delivery_disabled',
        await call('POST', '/orders', { body: orderBody('delivery'), headers: { 'idempotency-key': randomUUID() } }),
        409,
        'delivery_disabled',
      );
    }
    const disabledMethod = profile ? PAYMENT_METHODS.find((method) => method !== 'card' && !profile.ordering.paymentMethods.includes(method)) : undefined;
    if (disabledMethod) {
      expectError(
        `con ${disabledMethod} apagado, pagar así responde 409 payment_method_disabled`,
        await call('POST', '/orders', {
          body: { ...orderBody(offered), paymentMethod: disabledMethod },
          headers: { 'idempotency-key': randomUUID() },
        }),
        409,
        'payment_method_disabled',
      );
    }
  }

  /**
   * Los botones del aviso al personal (Listo, Salió, Entregado), sobre un pedido
   * para retirar ya confirmado. Devuelve `true` si el pedido quedó cerrado.
   *
   * Un POS con pantallas propias responde `409 staff_actions_disabled`: mueve los
   * pedidos desde ahí, y eso también cumple.
   */
  async function checkStaffActions(orderId, orderNumber, customerId) {
    begin('Acciones del personal (botones de Telegram)');
    const staff = (action) => call('POST', `/orders/${orderId}/staff/${action}`, { body: { actor: 'check-pos-contract' } });

    const ready = await staff('ready');
    if (ready.status === 409 && ready.json?.code === 'staff_actions_disabled') {
      ok('POST /orders/:id/staff/ready responde 409 staff_actions_disabled', 'este POS mueve los pedidos desde sus pantallas, no desde Telegram.');
      return false;
    }
    const notice = expectShape('POST /orders/:id/staff/ready devuelve el aviso actualizado', ready, [200], STAFF_NOTICE_SHAPE);
    if (!notice) return false;

    if (notice.text.includes(orderNumber)) ok('el aviso nombra el pedido');
    else fail('el aviso nombra el pedido', `no aparece ${orderNumber} en el texto.`);

    const actions = notice.buttons.map((button) => button.action);
    if (actions.every((action) => STAFF_ACTION.test(action) && action.includes(orderId))) ok('los botones traen acciones del contrato, de este pedido');
    else fail('los botones traen acciones del contrato, de este pedido', actions.join(', '));
    if (!actions.some((action) => action.endsWith('/staff/ready'))) ok('un pedido «listo» ya no ofrece «Listo»');
    else fail('un pedido «listo» ya no ofrece «Listo»', actions.join(', '));
    if (!actions.some((action) => action.endsWith('/staff/out'))) ok('un pedido para retirar no ofrece «Salió»');
    else fail('un pedido para retirar no ofrece «Salió»', actions.join(', '));

    const active = await call('GET', `/customers/${customerId}/active-order`);
    if (active.json?.status === 'ready') ok('active-order dice que el pedido está listo');
    else fail('active-order dice que el pedido está listo', describeResponse(active));

    const again = await staff('ready');
    if (again.status === 200) ok('tocar «Listo» dos veces no es un error');
    else fail('tocar «Listo» dos veces no es un error', describeResponse(again));

    expectError('«Salió» en un pedido para retirar responde 409 invalid_state_transition', await staff('out'), 409, 'invalid_state_transition');
    expectError('una acción que no existe responde 404', await staff('explotar'), 404);
    expectError('las acciones del personal no se aceptan sin token', await call('POST', `/orders/${orderId}/staff/delivered`, { auth: null }), 401);

    const delivered = expectShape('POST /orders/:id/staff/delivered cierra el pedido', await staff('delivered'), [200], STAFF_NOTICE_SHAPE);
    if (!delivered) return false;
    if (delivered.buttons.length === 0) ok('un pedido entregado no ofrece más botones');
    else fail('un pedido entregado no ofrece más botones', JSON.stringify(delivered.buttons));

    const after = await call('GET', `/customers/${customerId}/active-order`);
    if (after.status === 200 && after.json === null) {
      ok('un pedido entregado deja de ser el pedido en curso');
      return true;
    }
    fail('un pedido entregado deja de ser el pedido en curso', describeResponse(after));
    return false;
  }

  let orderId = null;
  let deliveryOrderId = null;
  /** ¿El POS respondió 201 a algún pedido válido? */
  let accepting = false;
  try {
    // ── Retiro: nace confirmado ──
    if (canPickup) {
      const key = randomUUID();
      const created = await call('POST', '/orders', { body: orderBody('pickup'), headers: { 'idempotency-key': key } });

      if (created.status === 202) {
        expectShape('POST /orders responde 202 cuando una persona tiene que aceptarlo', created, [202], PENDING_REQUEST_SHAPE);
        skip('el resto del pedido para retirar', 'el POS dejó el pedido en revisión (202): acéptalo o recházalo a mano. Con el local atendiendo debería responder 201.');
      } else if (created.status === 409 && ['closed', 'orders_paused'].includes(created.json?.code)) {
        ok(`POST /orders responde 409 ${created.json.code}`, 'el local no está tomando pedidos ahora: repite la prueba dentro del horario para comprobar el resto.');
      } else {
        const order = expectShape('POST /orders crea un pedido para retirar (201)', created, [201], ORDER_SHAPE);
        if (order) {
          orderId = order.id;
          accepting = true;
          if (order.status === 'confirmed') ok('un pedido para retirar nace en confirmed');
          else fail('un pedido para retirar nace en confirmed', `nació en ${order.status}`);
          const expectedTotal = cheapest.price;
          if (Math.abs(order.subtotalAmount - expectedTotal) < 0.005 && Math.abs(order.totalAmount - expectedTotal) < 0.005) ok('el total lo calcula el POS con el precio del catálogo');
          else fail('el total lo calcula el POS con el precio del catálogo', `precio ${expectedTotal}, subtotal ${order.subtotalAmount}, total ${order.totalAmount}`);

          const retry = await call('POST', '/orders', { body: orderBody('pickup'), headers: { 'idempotency-key': key } });
          if (retry.status === 200 && retry.json?.id === order.id) ok('repetir la misma Idempotency-Key devuelve el mismo pedido (200)');
          else fail('repetir la misma Idempotency-Key devuelve el mismo pedido (200)', describeResponse(retry));

          expectError(
            'la misma Idempotency-Key con otro carrito responde 409 idempotency_key_reused',
            await call('POST', '/orders', {
              body: { ...orderBody('pickup'), items: [{ productId: cheapest.id, quantity: 2 }] },
              headers: { 'idempotency-key': key },
            }),
            409,
            'idempotency_key_reused',
          );

          const active = await call('GET', `/customers/${customer.id}/active-order`);
          const context = expectShape('GET /customers/:id/active-order describe el pedido en curso', active, [200], ACTIVE_ORDER_SHAPE);
          if (context) {
            if (context.orderId === order.id && context.cashConfirmed === false) ok('active-order apunta al pedido recién creado');
            else fail('active-order apunta al pedido recién creado', JSON.stringify(context));
          }

          const full = await call('GET', `/orders/${order.id}`);
          expectShape('GET /orders/:id devuelve el pedido completo', full, [200], ORDER_SHAPE);

          const cancelled = await call('POST', `/orders/${order.id}/cash/cancel`);
          if (payment !== 'cash') {
            skip('POST /orders/:id/cash/cancel cancela el pedido en efectivo', 'el efectivo no está entre las formas de pago: cancela a mano el pedido de prueba.');
          } else {
            const body = expectShape('POST /orders/:id/cash/cancel cancela el pedido en efectivo', cancelled, [200, 201], ORDER_SHAPE);
            if (body) {
              if (body.status === 'cancelled') {
                ok('el pedido cancelado queda en cancelled');
                orderId = null;
              } else {
                fail('el pedido cancelado queda en cancelled', `quedó en ${body.status}`);
              }
              const twice = await call('POST', `/orders/${order.id}/cash/cancel`);
              if ([200, 201].includes(twice.status) && twice.json?.status === 'cancelled') ok('cancelar dos veces no es un error');
              else fail('cancelar dos veces no es un error', describeResponse(twice));
              const after = await call('GET', `/customers/${customer.id}/active-order`);
              if (after.status === 200 && after.json === null) ok('un pedido cancelado deja de ser el pedido en curso');
              else fail('un pedido cancelado deja de ser el pedido en curso', describeResponse(after));
            }
          }
        }
      }
    } else {
      skip('pedido para retirar', 'el retiro está apagado en el perfil.');
    }

    // ── Envío: espera la ubicación, se cotiza al recibirla ──
    begin('Pedido con envío');
    const { latitude, longitude } = profile?.location ?? {};
    if (!canDeliver) {
      skip('pedido con envío', 'el envío está apagado en el perfil.');
    } else if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      skip('pedido con envío', 'el perfil no trae las coordenadas del local.');
    } else if (payment !== 'cash') {
      skip('pedido con envío', 'sin efectivo no se puede cancelar el pedido de prueba desde aquí.');
    } else {
      const created = await call('POST', '/orders', { body: orderBody('delivery'), headers: { 'idempotency-key': randomUUID() } });
      if (created.status === 202 || (created.status === 409 && ['closed', 'orders_paused'].includes(created.json?.code))) {
        skip('pedido con envío', `el local no está tomando pedidos ahora (${created.status} ${created.json?.code ?? 'en revisión'}).`);
      } else {
        const order = expectShape('POST /orders crea un pedido con envío (201)', created, [201], ORDER_SHAPE);
        if (order) {
          deliveryOrderId = order.id;
          accepting = true;
          if (order.status === 'awaiting_location' && order.deliveryQuoteStatus === 'pending') ok('un pedido con envío nace en awaiting_location, sin cotizar');
          else fail('un pedido con envío nace en awaiting_location, sin cotizar', `status ${order.status}, deliveryQuoteStatus ${order.deliveryQuoteStatus}`);

          // A unos 900 m del local: cerca, para que cualquier tarifario lo cubra.
          const pin = { latitude: Number((latitude + 0.006).toFixed(6)), longitude: Number((longitude + 0.006).toFixed(6)) };
          const located = await call('POST', `/orders/${order.id}/location`, { body: pin });
          const quoted = expectShape('POST /orders/:id/location guarda el punto y devuelve el pedido', located, [200, 201], ORDER_SHAPE);
          if (quoted) {
            if (quoted.deliveryQuoteStatus === 'quoted') {
              const sum = quoted.subtotalAmount + quoted.deliveryBaseAmount + quoted.deliverySurchargeAmount;
              if (quoted.status === 'confirmed' && Math.abs(sum - quoted.totalAmount) < 0.005) ok('al recibir la ubicación el pedido queda cotizado y confirmado', `envío ${quoted.deliveryBaseAmount + quoted.deliverySurchargeAmount}, total ${quoted.totalAmount}`);
              else fail('al recibir la ubicación el pedido queda cotizado y confirmado', `status ${quoted.status}; subtotal + envío = ${sum}, total = ${quoted.totalAmount}`);
            } else if (quoted.deliveryQuoteStatus === 'pending_manual') {
              ok('la cotización quedó para que la fije una persona (pending_manual)');
            } else {
              fail('al recibir la ubicación el pedido queda cotizado', `deliveryQuoteStatus ${quoted.deliveryQuoteStatus}`);
            }

            const same = await call('POST', `/orders/${order.id}/location`, { body: pin });
            if ([200, 201].includes(same.status)) ok('reenviar la misma ubicación no es un error');
            else fail('reenviar la misma ubicación no es un error', describeResponse(same));

            expectError(
              'otra ubicación para el mismo pedido responde 409 location_already_attached',
              await call('POST', `/orders/${order.id}/location`, { body: { latitude: pin.latitude + 0.01, longitude: pin.longitude } }),
              409,
              'location_already_attached',
            );

            const active = await call('GET', `/customers/${customer.id}/active-order`);
            if (active.json?.orderId === order.id && active.json?.locationReceived === true) ok('active-order dice que la ubicación ya llegó');
            else fail('active-order dice que la ubicación ya llegó', describeResponse(active));
          }

          const cancelled = await call('POST', `/orders/${order.id}/cash/cancel`);
          if ([200, 201].includes(cancelled.status) && cancelled.json?.status === 'cancelled') {
            ok('el pedido con envío se cancela antes de confirmarse');
            deliveryOrderId = null;
          } else {
            fail('el pedido con envío se cancela antes de confirmarse', describeResponse(cancelled));
          }
        }
      }
    }

    // ── Efectivo: confirmar, y que después no se pueda cancelar ──
    begin('Efectivo');
    if (!confirmCash) {
      skip('POST /orders/:id/cash/confirm y las acciones del personal', 'confirman un pedido de verdad: pídelo con --confirm-cash.');
    } else if (payment !== 'cash' || !canPickup) {
      skip('POST /orders/:id/cash/confirm', 'hace falta efectivo y retiro activos para probarlo.');
    } else {
      const created = await call('POST', '/orders', { body: orderBody('pickup'), headers: { 'idempotency-key': randomUUID() } });
      if (created.status !== 201) {
        skip('CONFIRMAR en efectivo', `no se pudo crear el pedido de prueba (${created.status} ${created.json?.code ?? ''}).`);
      } else {
        orderId = created.json.id;
        const confirmed = await call('POST', `/orders/${orderId}/cash/confirm`);
        if (confirmed.status === 409 && confirmed.json?.code === 'cash_register_closed') {
          ok('POST /orders/:id/cash/confirm responde 409 cash_register_closed', 'el POS exige una caja abierta para confirmar: abre caja para comprobar el resto.');
        } else {
          const body = expectShape('POST /orders/:id/cash/confirm confirma el pedido', confirmed, [200, 201], ORDER_SHAPE);
          if (body) {
            if (body.cashConfirmedAt) ok('el pedido confirmado trae cashConfirmedAt');
            else fail('el pedido confirmado trae cashConfirmedAt', 'llegó en null');
            const twice = await call('POST', `/orders/${orderId}/cash/confirm`);
            if ([200, 201].includes(twice.status)) ok('confirmar dos veces no es un error');
            else fail('confirmar dos veces no es un error', describeResponse(twice));
            const active = await call('GET', `/customers/${customer.id}/active-order`);
            if (active.json?.cashConfirmed === true) ok('active-order dice que el efectivo ya se confirmó');
            else fail('active-order dice que el efectivo ya se confirmó', describeResponse(active));
            expectError('un pedido ya confirmado no se cancela (409 cash_order_already_confirmed)', await call('POST', `/orders/${orderId}/cash/cancel`), 409, 'cash_order_already_confirmed');
            const closed = await checkStaffActions(orderId, body.orderNumber, customer.id);
            if (!closed) skip('limpieza', `el pedido ${body.orderNumber} quedó CONFIRMADO: ciérralo o cancélalo desde el POS.`);
            orderId = null;
          }
        }
      }
    }

    if (accepting) {
      await checkCartRejections();
    } else {
      begin('Rechazos de carrito');
      skip('productos, promociones y formas de pago rechazados', 'el POS no creó ningún pedido en esta corrida, así que no se le mandaron carritos inválidos.');
    }
  } finally {
    await cancelQuietly(orderId);
    await cancelQuietly(deliveryOrderId);
  }
}

// ── 5. Gateway: lo que el agente le expone al POS ───────────────────────────

async function checkGateway() {
  begin(`Gateway del agente (${gatewayUrl})`);
  const routes = ['/gateway/whatsapp/messages', '/gateway/whatsapp/location-requests', '/gateway/telegram/alerts'];
  const first = await call('POST', routes[0], { base: gatewayUrl, auth: null, body: {} });
  if (first.networkError) {
    fail(`conectar con ${gatewayUrl}`, `sin respuesta (${first.networkError})`);
    return;
  }
  for (const route of routes) {
    expectError(`POST ${route} sin token responde 401`, await call('POST', route, { base: gatewayUrl, auth: null, body: {} }), 401, 'unauthorized');
  }
  if (!gatewayToken) {
    skip('cuerpos inválidos', 'pasa --gateway-token para comprobar las validaciones.');
    return;
  }
  // Cuerpos vacíos: se rechazan ANTES de enviar nada, así que no sale ningún mensaje.
  for (const route of routes) {
    expectError(`POST ${route} con un cuerpo vacío responde 400 validation_error`, await call('POST', route, { base: gatewayUrl, auth: gatewayToken, body: {} }), 400, 'validation_error');
  }
  expectError(
    'más de 3 botones responde 400 validation_error',
    await call('POST', routes[0], {
      base: gatewayUrl,
      auth: gatewayToken,
      body: { to: '+59170000000', text: 'x', buttons: [1, 2, 3, 4].map((n) => ({ id: `b${n}`, title: `B${n}` })) },
    }),
    400,
    'validation_error',
  );
}

// ── Principal ───────────────────────────────────────────────────────────────

if (!asJson) {
  console.log(`Contrato del POS ${CONTRACT_VERSION} — ${baseUrl}`);
  console.log(writeMode ? `Modo escritura: crea pedidos de prueba para ${phone}.` : 'Modo solo lectura: no crea nada. Usa --write en un restaurante de prueba para comprobar los pedidos.');
}

const reachable = await checkAccess();
if (reachable) {
  const catalog = await checkReads();
  await checkRejections();
  if (writeMode) await checkWrites(catalog);
}
if (gatewayUrl) await checkGateway();

const count = (status) => results.filter((result) => result.status === status).length;
const summary = { contractVersion: CONTRACT_VERSION, url: baseUrl, write: writeMode, passed: count('ok'), failed: count('fail'), skipped: count('skip') };

if (asJson) {
  console.log(JSON.stringify({ ...summary, results }, null, 2));
} else {
  console.log(`\n${summary.passed} cumplen, ${summary.failed} fallan, ${summary.skipped} sin comprobar.`);
  if (summary.failed > 0) {
    console.log('\nNo cumple:');
    for (const result of results.filter((r) => r.status === 'fail')) console.log(`  ✖ [${result.section}] ${result.name}`);
  } else if (reachable) {
    console.log(writeMode ? 'El POS cumple el contrato en todo lo comprobado.' : 'El POS cumple el contrato en lo que se puede comprobar sin escribir.');
    if (summary.skipped > 0) console.log('Revisa las líneas marcadas con –: no fallaron, pero tampoco se comprobaron.');
  }
}

process.exit(!reachable ? 2 : summary.failed > 0 ? 1 : 0);
