#!/usr/bin/env node
// Recorre el pago por QR de punta a punta contra el backend LOCAL, con un banco
// simulado (scripts/mock-baneco.mjs): generar el QR, pagarlo, que venza sin
// pagar y qué pasa si el banco no responde. Es el modo «sin POS».
//
//   .\scripts\dev-db.ps1 start
//   npm --prefix apps/backend run build
//   node scripts/check-qr-flow.mjs
//   node scripts/check-qr-flow.mjs --verbose     # además, el registro del backend
//
// Levanta su propio backend en un puerto libre, con el banco y el agente
// simulados: no usa el backend que tengas corriendo ni manda ningún mensaje.
//
// Escribe en la base: crea clientes y pedidos de prueba, les cambia la fecha
// para no esperar media hora, y enciende por un rato el modo sin POS, el pago
// por QR y el horario de 24 horas. Al terminar deja todo como estaba. Por eso
// SOLO corre contra una base en localhost.
//
// --real-bank   En vez del banco simulado usa el de las BANECO_* de
//           apps/backend/.env.dev (el ambiente de pruebas del banco). Recorre
//           lo que se puede sin pagar: el QR de verdad llega al cliente, y al
//           vencer se anula en el banco. Un pago no se puede simular desde
//           aquí: eso se prueba con apps/backend/scripts/check-baneco.mjs --keep.
//
// Sale con código 0 si todo cumple, 1 si algo falla y 2 si no pudo empezar.
// Tarda unos dos minutos: espera a que corra el barrido de cada minuto.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockBaneco } from './mock-baneco.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(ROOT, 'apps', 'backend');
const ENV_FILE = path.join(BACKEND, '.env.dev');
const MARKER = 'PEDIDO DE PRUEBA (check-qr-flow): no preparar';
const verbose = process.argv.includes('--verbose');
const realBank = process.argv.includes('--real-bank');

function abort(message) {
  console.error(message);
  process.exit(2);
}

// ── Resultados ──────────────────────────────────────────────────────────────

let failures = 0;
function begin(title) {
  console.log(`\n${title}`);
}
function check(name, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`  ${passed ? '✔' : '✖'} ${name}${!passed && detail ? `\n      ${detail}` : ''}`);
  return passed;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera a que `probe` devuelva algo; `undefined` si se acaba el tiempo. */
async function waitFor(probe, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) return undefined;
    await sleep(intervalMs);
  }
}

// ── Entorno ─────────────────────────────────────────────────────────────────

async function readEnvFile(file) {
  const text = await readFile(file, 'utf8').catch(() => '');
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
  );
}

const devEnv = await readEnvFile(ENV_FILE);
const databaseUrl = devEnv.DATABASE_URL;
if (!databaseUrl) abort(`Falta DATABASE_URL en ${ENV_FILE}.`);
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
  abort('Este script cambia datos: solo corre contra una base en localhost.');
}
const serviceToken = (devEnv.SERVICE_AUTH_TOKENS ?? '')
  .split(',')
  .map((pair) => pair.trim().split(':'))
  .find(([client]) => client === 'whatsapp-gateway')?.[1];
if (!serviceToken) abort(`Falta el token de "whatsapp-gateway" en SERVICE_AUTH_TOKENS (${ENV_FILE}).`);
if (!existsSync(path.join(BACKEND, 'dist', 'bank-qr', 'qr-orders-maintenance.cron.js'))) {
  abort('El backend no está compilado con estos cambios: npm --prefix apps/backend run build');
}

const { Client } = createRequire(path.join(BACKEND, 'package.json'))('pg');
const db = new Client({ connectionString: databaseUrl });
try {
  await db.connect();
} catch (error) {
  abort(`No se pudo conectar a la base local (${error.message}). ¿Corriste .\\scripts\\dev-db.ps1 start?`);
}
const query = async (text, values = []) => (await db.query(text, values)).rows;

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

// ── El agente simulado: guarda lo que el backend le manda decir ─────────────

/** @type {Array<{route: string, body: any}>} */
const sent = [];
const gateway = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  sent.push({ route: request.url ?? '', body });
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ externalMessageId: `sim-${sent.length}` }));
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));

const whatsappTo = (phone) =>
  sent.filter((m) => m.route === '/gateway/whatsapp/messages' && m.body.to === phone).map((m) => m.body);
const telegramAbout = (orderNumber) =>
  sent
    .filter((m) => m.route === '/gateway/telegram/alerts' && String(m.body.text).includes(orderNumber))
    .map((m) => m.body);

// ── Banco y backend ─────────────────────────────────────────────────────────

const BANECO_KEYS = ['BANECO_BASE_URL', 'BANECO_USERNAME', 'BANECO_PASSWORD', 'BANECO_AES_KEY', 'BANECO_ACCOUNT'];
const bank = realBank ? null : await startMockBaneco({ port: 0, quiet: !verbose });
/** Con --real-bank: el cliente del backend, para preguntarle al banco qué ve. */
let realBankClient = null;
if (realBank) {
  const unquote = (value) => (value ?? '').replace(/^(["'])(.*)\1$/, '$2');
  const missing = BANECO_KEYS.filter((key) => !unquote(devEnv[key]));
  if (missing.length > 0) abort(`--real-bank necesita en ${ENV_FILE}: ${missing.join(', ')}.`);
  for (const key of BANECO_KEYS) process.env[key] = unquote(devEnv[key]);
  const backendRequire = createRequire(path.join(BACKEND, 'package.json'));
  const { BanecoClientService } = backendRequire('./dist/baneco/baneco-client.service.js');
  const appConfig = backendRequire('./dist/config/configuration.js').default();
  realBankClient = new BanecoClientService({ get: (key) => appConfig[key] });
}
const backendPort = await freePort();
const backendUrl = `http://127.0.0.1:${backendPort}`;

let backendLog = '';
const backend = spawn(process.execPath, [`--env-file=${ENV_FILE}`, path.join('dist', 'main.js')], {
  cwd: BACKEND,
  env: {
    ...process.env,
    PORT: String(backendPort),
    GATEWAY_BASE_URL: `http://127.0.0.1:${gateway.address().port}`,
    GATEWAY_AUTH_TOKEN: 'check-qr-flow',
    // Sin despertador: aquí no hay un agente de verdad al que llamar.
    AGENT_INTERNAL_TOKEN: '',
    // Con --real-bank quedan las BANECO_* de .env.dev.
    ...(bank
      ? {
          BANECO_BASE_URL: bank.url,
          BANECO_USERNAME: 'prueba',
          BANECO_PASSWORD: 'prueba',
          BANECO_AES_KEY: 'prueba',
          BANECO_ACCOUNT: '1234567890',
        }
      : {}),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [backend.stdout, backend.stderr]) {
  stream.on('data', (chunk) => {
    backendLog += chunk;
    if (verbose) process.stdout.write(chunk);
  });
}

async function api(method, route, { body, auth = serviceToken, headers = {} } = {}) {
  const response = await fetch(`${backendUrl}${route}`, {
    method,
    headers: {
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // No todas las respuestas son JSON.
  }
  return { status: response.status, json, text };
}

// ── Lo que se deja como estaba ──────────────────────────────────────────────

const SETTINGS_COLUMNS = [
  'requires_cash_register',
  'enabled_payment_methods',
  'pickup_enabled',
  'orders_paused',
  'business_opens_hour',
  'business_closes_hour',
];
let savedSettings;

async function closeTestOrders() {
  // Los QR de prueba dejan de consultarse, y los pedidos dejan de estar en curso.
  await query(
    `update bank_qr_charges set status = 'cancelled', updated_at = now()
     where status = 'pending' and order_id in (select id from orders where notes = $1)`,
    [MARKER],
  );
  await query(
    `update orders set status = 'delivered', status_updated_by = 'check-qr-flow', updated_at = now()
     where notes = $1 and payment_status = 'paid' and status not in ('delivered', 'cancelled')`,
    [MARKER],
  );
  await query(
    `update orders set status = 'cancelled', status_updated_by = 'check-qr-flow', updated_at = now()
     where notes = $1 and status not in ('delivered', 'cancelled')`,
    [MARKER],
  );
}

async function cleanup() {
  backend.kill();
  try {
    await closeTestOrders();
    if (savedSettings) {
      const assignments = SETTINGS_COLUMNS.map((column, index) => `${column} = $${index + 1}`);
      await query(
        `update operational_settings set ${assignments.join(', ')} where id = true`,
        SETTINGS_COLUMNS.map((column) => savedSettings[column]),
      );
    }
  } finally {
    await db.end();
    await bank?.close();
    await new Promise((resolve) => gateway.close(resolve));
  }
}

// ── Pedidos de prueba ───────────────────────────────────────────────────────

let productId;

async function placeOrder(label, phone) {
  const customer = await api('POST', '/customers/find-or-create', {
    body: { phone, name: `Prueba QR ${label}` },
  });
  const created = await api('POST', '/orders', {
    headers: { 'idempotency-key': randomUUID() },
    body: {
      customerId: customer.json?.id,
      channel: 'whatsapp',
      customerName: `Prueba QR ${label}`,
      deliveryType: 'pickup',
      paymentMethod: 'qr',
      notes: MARKER,
      items: [{ productId, quantity: 1 }],
    },
  });
  if (created.status !== 201) {
    throw new Error(`POST /orders (${label}) respondió ${created.status}: ${created.text.slice(0, 300)}`);
  }
  return { id: created.json.id, number: created.json.orderNumber, total: created.json.totalAmount, phone };
}

const orderRow = async (id) =>
  (await query('select status, payment_status, status_updated_by from orders where id = $1', [id]))[0];
const chargeRow = async (orderId) =>
  (await query('select id, qr_id, status from bank_qr_charges where order_id = $1', [orderId]))[0];
const qrMessage = (order) => whatsappTo(order.phone).find((message) => message.imageUrl);
const textTo = (order, fragment) =>
  whatsappTo(order.phone).find((message) => !message.imageUrl && message.text.includes(fragment));

/**
 * Lo que hace el agente con el `imageUrl` del aviso: es una ruta del backend
 * que pide token, así que la descarga con el suyo (y después la sube a
 * WhatsApp, que aquí no se prueba).
 */
async function checkQrImage(order, message) {
  const expected = `/orders/${order.id}/qr-image`;
  check('el aviso lleva la ruta protegida del QR, como el backend central', message.imageUrl === expected, message.imageUrl);

  const image = await fetch(`${backendUrl}${expected}`, { headers: { authorization: `Bearer ${serviceToken}` } });
  const bytes = Buffer.from(await image.arrayBuffer());
  check('el agente la descarga con su token y es un PNG',
    image.status === 200 && image.headers.get('content-type') === 'image/png' && bytes.subarray(1, 4).toString() === 'PNG',
    `${image.status} ${image.headers.get('content-type')}`);
  const anonymous = await fetch(`${backendUrl}${expected}`);
  check('sin token no se obtiene la imagen', anonymous.status === 401, String(anonymous.status));
  return bytes.length;
}

/** Como si hubieran pasado `minutes` desde que el total quedó definitivo y salió el QR. */
async function age(order, minutes) {
  await query(`update orders set confirmed_at = now() - make_interval(mins => $2) where id = $1`, [order.id, minutes]);
  await query(`update bank_qr_charges set created_at = now() - make_interval(mins => $2) where order_id = $1`, [order.id, minutes]);
}

// ── Recorrido ───────────────────────────────────────────────────────────────

async function run() {
  begin('Preparación');
  const up = await waitFor(
    async () => (await fetch(`${backendUrl}/health`).catch(() => null))?.ok,
    60_000,
  );
  if (!check('el backend de prueba arranca', Boolean(up), backendLog.slice(-1500))) return;

  savedSettings = (await query(`select ${SETTINGS_COLUMNS.join(', ')} from operational_settings where id = true`))[0];
  await closeTestOrders();
  await query(
    `update operational_settings set requires_cash_register = false, enabled_payment_methods = $1,
       pickup_enabled = true, orders_paused = false, business_opens_hour = 0, business_closes_hour = 0
     where id = true`,
    [['cash', 'qr']],
  );

  const products = await api('GET', '/products');
  const sellable = (products.json ?? []).filter((product) => product.isActive && product.isAvailable);
  if (!check('hay un producto para pedir', sellable.length > 0, 'Carga un menú: node scripts/load-demo.mjs')) return;
  productId = [...sellable].sort((a, b) => a.price - b.price)[0].id;

  if (realBank) await runRealBank();
  else await runSimulated();
}

/** Contra el ambiente de pruebas del banco: todo menos el pago. */
async function runRealBank() {
  begin('El cliente pide con QR (banco de pruebas, de verdad)');
  const order = await placeOrder('R', '+59170000997');
  const message = await waitFor(() => qrMessage(order), 60_000);
  check('el cliente recibe el QR', Boolean(message), `mensajes: ${JSON.stringify(whatsappTo(order.phone))}\n${backendLog.slice(-1500)}`);
  if (!message) return;
  check('el mensaje dice el monto y cuánto dura el QR',
    /vence en 30 minutos/.test(message.text) && message.text.includes(Number(order.total).toFixed(2)), message.text);

  console.log(`      ${await checkQrImage(order, message)} bytes`);

  const charge = await chargeRow(order.id);
  const fresh = await realBankClient.statusQR(charge.qr_id);
  check('el banco tiene ese QR como pendiente de pago', fresh.statusQrCode === 0, JSON.stringify(fresh.raw));
  console.log(`      qrId: ${charge.qr_id}`);

  const forged = await api('POST', '/api/qrsimple/notifyPaymentQR', { auth: null, body: { payment: { qrId: charge.qr_id } } });
  check('un aviso de pago falso no marca el pedido como pagado: el banco dice que no está pagado',
    forged.json?.responseCode === 0 && (await orderRow(order.id)).payment_status === 'unpaid',
    `${forged.text} ${JSON.stringify(await orderRow(order.id))}`);

  // La consulta de cada 5 segundos ya corrió varias veces contra el banco.
  await sleep(12_000);
  check('consultarle al banco cada 5 segundos no rompe nada',
    (await chargeRow(order.id)).status === 'pending' && !/statusQR falló/.test(backendLog),
    backendLog.slice(-1500));

  begin('Vencimiento (espera al barrido de cada minuto)');
  await age(order, 31);
  const cancelled = await waitFor(async () => (await orderRow(order.id)).status === 'cancelled', 100_000, 2_000);
  const row = await orderRow(order.id);
  check('el QR que nadie pagó cancela el pedido a los 30 minutos',
    Boolean(cancelled) && row.status_updated_by === 'expiry_qr_unpaid', `${JSON.stringify(row)}\n${backendLog.slice(-1500)}`);
  const retired = await realBankClient.statusQR(charge.qr_id);
  check('y el banco lo tiene anulado: ya no se puede pagar', retired.statusQrCode === 9, JSON.stringify(retired.raw));
  check('el cliente se entera de por qué se canceló', Boolean(await waitFor(() => textTo(order, 'no recibimos el pago por QR a tiempo'), 10_000)));

  console.log('\n  – No se prueba aquí: el pago. Para eso, en apps/backend:');
  console.log('      node --env-file=.env.dev scripts/check-baneco.mjs --keep');
}

/** Contra el banco simulado: todo, incluidos el pago y la caída del banco. */
async function runSimulated() {
  // ── A ──
  begin('El cliente pide con QR y paga');
  const paid = await placeOrder('A', '+59170000991');
  const paidQr = await waitFor(() => qrMessage(paid), 20_000);
  check('el cliente recibe el QR', Boolean(paidQr), `mensajes: ${JSON.stringify(whatsappTo(paid.phone))}`);
  check('el mensaje dice el monto y cuánto dura el QR', /vence en 30 minutos/.test(paidQr?.text ?? '') && (paidQr?.text ?? '').includes(Number(paid.total).toFixed(2)), paidQr?.text);

  const generated = bank.calls.find((call) => call.path === '/api/qrsimple/generateQR' && call.body.transactionId === paid.number);
  check('el banco recibió el pedido como identificador, el monto y una fecha de vencimiento',
    generated?.body.amount === Number(paid.total) && /^\d{4}-\d{2}-\d{2}$/.test(generated?.body.dueDate ?? '') && generated?.body.singleUse === true && generated?.body.modifyAmount === false,
    JSON.stringify(generated?.body));

  if (paidQr) await checkQrImage(paid, paidQr);

  const paidCharge = await chargeRow(paid.id);
  await bank.pay(paidCharge.qr_id);
  const becamePaid = await waitFor(async () => (await orderRow(paid.id)).payment_status === 'paid', 20_000);
  check('al pagar, el pedido queda pagado sin que nadie lo toque', Boolean(becamePaid), JSON.stringify(await orderRow(paid.id)));
  check('el cliente recibe la confirmación del pago', Boolean(await waitFor(() => textTo(paid, 'Tu pago fue confirmado'), 10_000)));
  const staffNotice = await waitFor(() => telegramAbout(paid.number)[0], 10_000);
  check('el personal recibe el pedido por Telegram, con sus botones', (staffNotice?.buttons ?? []).length > 0, JSON.stringify(staffNotice));

  // ── B ──
  begin('El banco avisa del pago (notifyPaymentQR)');
  const notified = await placeOrder('B', '+59170000992');
  await waitFor(() => qrMessage(notified), 20_000);
  const notifiedCharge = await chargeRow(notified.id);
  const forged = await api('POST', '/api/qrsimple/notifyPaymentQR', { auth: null, body: { payment: { qrId: notifiedCharge.qr_id, amount: 1 } } });
  check('un aviso de un QR que nadie pagó no marca el pedido como pagado',
    forged.json?.responseCode === 0 && (await orderRow(notified.id)).payment_status === 'unpaid',
    `${forged.text} ${JSON.stringify(await orderRow(notified.id))}`);
  await bank.pay(notifiedCharge.qr_id);
  const real = await api('POST', '/api/qrsimple/notifyPaymentQR', { auth: null, body: { payment: { qrId: notifiedCharge.qr_id } } });
  check('con el aviso de un pago real, el pedido queda pagado en el momento',
    real.json?.responseCode === 0 && (await orderRow(notified.id)).payment_status === 'paid',
    `${real.text} ${JSON.stringify(await orderRow(notified.id))}`);
  const empty = await api('POST', '/api/qrsimple/notifyPaymentQR', { auth: null, body: {} });
  check('un aviso sin qrId se contesta como error, sin romper nada', empty.status === 200 && empty.json?.responseCode === 1, empty.text);

  // ── C, D, E, F: se preparan juntos y se resuelven en una pasada del barrido ──
  begin('Vencimientos y banco caído (espera al barrido de cada minuto)');
  const unpaid = await placeOrder('C', '+59170000993');
  const lastMinute = await placeOrder('D', '+59170000994');
  await waitFor(() => qrMessage(unpaid) && qrMessage(lastMinute), 20_000);

  bank.setFailing(true);
  const late = await placeOrder('E', '+59170000995');
  const never = await placeOrder('F', '+59170000996');
  const delayedLate = await waitFor(() => textTo(late, 'Estamos generando tu QR'), 20_000);
  const delayedNever = await waitFor(() => textTo(never, 'Estamos generando tu QR'), 20_000);
  check('con el banco caído, el cliente recibe un aviso de demora y no una captura que nadie puede revisar',
    Boolean(delayedLate && delayedNever) && !textTo(late, 'captura') && !qrMessage(late),
    JSON.stringify(whatsappTo(late.phone)));
  bank.setFailing(false);

  await age(unpaid, 31);
  await age(lastMinute, 31);
  await bank.pay((await chargeRow(lastMinute.id)).qr_id);
  await age(late, 2);
  await age(never, 11);

  const settled = await waitFor(
    async () =>
      (await orderRow(unpaid.id)).status === 'cancelled' &&
      (await orderRow(never.id)).status === 'cancelled' &&
      Boolean(qrMessage(late)),
    100_000,
    2_000,
  );
  check('el barrido corrió', Boolean(settled), backendLog.slice(-1500));

  const unpaidRow = await orderRow(unpaid.id);
  const unpaidCharge = await chargeRow(unpaid.id);
  check('el QR que nadie pagó cancela el pedido a los 30 minutos',
    unpaidRow.status === 'cancelled' && unpaidRow.status_updated_by === 'expiry_qr_unpaid', JSON.stringify(unpaidRow));
  check('y el QR queda anulado en el banco: ya no se puede pagar',
    bank.qrs.get(unpaidCharge.qr_id)?.status === 9 && unpaidCharge.status === 'expired',
    `banco: ${bank.qrs.get(unpaidCharge.qr_id)?.status}, cobro: ${unpaidCharge.status}`);
  check('el cliente se entera de por qué se canceló', Boolean(await waitFor(() => textTo(unpaid, 'no recibimos el pago por QR a tiempo'), 10_000)));
  const attempts = await query('select review_status from payment_attempts where order_id = $1', [unpaid.id]);
  check('no queda ningún intento de pago abierto', attempts.every((attempt) => attempt.review_status === 'rejected'), JSON.stringify(attempts));

  const lastMinuteRow = await orderRow(lastMinute.id);
  check('un QR pagado justo al vencer NO se cancela: queda pagado',
    lastMinuteRow.payment_status === 'paid' && lastMinuteRow.status !== 'cancelled', JSON.stringify(lastMinuteRow));

  check('cuando el banco vuelve, el QR pendiente sale solo', Boolean(qrMessage(late)), JSON.stringify(whatsappTo(late.phone)));
  check('y el aviso de demora no se repitió',
    whatsappTo(late.phone).filter((message) => message.text.includes('Estamos generando tu QR')).length === 1);

  const neverRow = await orderRow(never.id);
  check('si el QR nunca se pudo generar, el pedido se cancela a los 10 minutos',
    neverRow.status === 'cancelled' && neverRow.status_updated_by === 'expiry_qr_unpaid', JSON.stringify(neverRow));
  check('el cliente recibe la disculpa', Boolean(await waitFor(() => textTo(never, 'No pudimos generar el QR'), 10_000)));
  check('y el personal se entera por Telegram de que el banco falló',
    Boolean(await waitFor(() => telegramAbout(never.number).find((alert) => alert.text.includes('No se pudo generar el QR')), 10_000)));
}

try {
  await run();
} catch (error) {
  failures += 1;
  console.error(`\n  ✖ El recorrido se cortó: ${error.message}`);
  if (!verbose) console.error(backendLog.slice(-2000));
} finally {
  await cleanup();
}

console.log(failures === 0 ? '\nTodo cumple.' : `\n${failures} comprobación(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
