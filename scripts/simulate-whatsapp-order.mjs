#!/usr/bin/env node
// Simula un pedido que entra por WhatsApp, sin WhatsApp: llama al backend con
// el token de servicio del gateway, igual que lo hará el agente. Sirve para
// probar que el pedido aparece en la cocina del POS con la etiqueta WHATSAPP.
// Sin dependencias (Node >= 20).
//
//   node scripts/simulate-whatsapp-order.mjs            # delivery, paga en efectivo al recibir
//   node scripts/simulate-whatsapp-order.mjs --pickup   # retira en el local
//   node scripts/simulate-whatsapp-order.mjs --qr       # paga por QR
//   node scripts/simulate-whatsapp-order.mjs --nota "sin cebolla"
//
// Con la caja cerrada el backend no confirma el pedido: lo deja como solicitud
// pendiente (aparece en Pedidos del POS para aceptarlo o rechazarlo).
//
// Destino y credenciales (variables de entorno):
//   API_URL        por defecto http://localhost:3100
//   SERVICE_TOKEN  por defecto el de "whatsapp-gateway" en apps/backend/.env.dev

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const pickup = args.includes('--pickup');
const paymentMethod = args.includes('--qr') ? 'qr' : 'cash';
const noteIndex = args.indexOf('--nota');
const notes = noteIndex >= 0 ? args[noteIndex + 1] : undefined;

const CUSTOMERS = [
  ['María Flores', '+59170010001'],
  ['Carlos Rojas', '+59170010002'],
  ['Daniela Suárez', '+59170010003'],
  ['Luis Vaca', '+59170010004'],
];

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

const devEnv = await readEnvFile(path.join(ROOT, 'apps/backend/.env.dev'));
const apiUrl = (process.env.API_URL ?? `http://localhost:${devEnv.PORT ?? 3100}`).replace(/\/$/, '');
// SERVICE_AUTH_TOKENS tiene la forma "whatsapp-gateway:token,pos:token".
const gatewayToken = (devEnv.SERVICE_AUTH_TOKENS ?? '')
  .split(',')
  .map((pair) => pair.trim())
  .find((pair) => pair.startsWith('whatsapp-gateway:'))
  ?.slice('whatsapp-gateway:'.length);
const token = process.env.SERVICE_TOKEN ?? gatewayToken;

if (!token) {
  console.error('Falta SERVICE_TOKEN (o el token "whatsapp-gateway" en SERVICE_AUTH_TOKENS de apps/backend/.env.dev).');
  process.exit(2);
}

async function api(method, route, body, headers = {}) {
  const response = await fetch(`${apiUrl}${route}`, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const detail = typeof parsed === 'object' && parsed ? `${parsed.code}: ${[].concat(parsed.message).join('; ')}` : text;
    const error = new Error(`${method} ${route} -> ${response.status} ${detail}`);
    error.code = parsed?.code;
    throw error;
  }
  return { status: response.status, data: parsed };
}

function pick(list, count) {
  return [...list].sort(() => Math.random() - 0.5).slice(0, count);
}

async function main() {
  const [name, phone] = CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)];
  const customer = (await api('POST', '/customers/find-or-create', { phone, name })).data;

  const products = (await api('GET', '/products')).data.filter((product) => product.isAvailable);
  if (products.length === 0) throw new Error('No hay productos disponibles: carga una demo con scripts/load-demo.mjs.');
  const items = pick(products, Math.min(2, products.length)).map((product) => ({
    productId: product.id,
    quantity: 1 + Math.floor(Math.random() * 2),
  }));

  const created = await api(
    'POST',
    '/orders',
    {
      customerId: customer.id,
      channel: 'whatsapp',
      customerName: name,
      deliveryType: pickup ? 'pickup' : 'delivery',
      paymentMethod,
      ...(notes ? { notes } : {}),
      items,
    },
    { 'idempotency-key': randomUUID() },
  );

  if (created.status === 202) {
    console.log(`Solicitud ${created.data.requestNumber ?? ''} en espera: la caja está cerrada.`);
    console.log('Ábrela en el POS (Caja) y acepta el pedido en Pedidos; vence en 10 minutos.');
    return;
  }

  let order = created.data;
  if (!pickup) {
    // En delivery el pedido espera la ubicación del cliente; al adjuntarla el
    // backend cotiza el envío y recién entonces lo confirma.
    const settings = (await api('GET', '/operational-settings')).data;
    const latitude = (settings.restaurantLatitude ?? -17.7833) + 0.012;
    const longitude = (settings.restaurantLongitude ?? -63.1821) + 0.009;
    order = (await api('POST', `/orders/${order.id}/location`, { latitude, longitude })).data;
  }

  const lines = order.items.map((item) => `${item.quantity}× ${item.productNameSnapshot}`).join(', ');
  console.log(`${order.orderNumber} · ${name} · ${pickup ? 'retira en el local' : 'delivery'} · ${paymentMethod === 'qr' ? 'QR' : 'efectivo'}`);
  console.log(`  ${lines}`);
  console.log(`  total Bs ${order.totalAmount.toFixed(2)} · estado ${order.status} · pago ${order.paymentStatus}`);
  if (order.status !== 'confirmed') {
    console.log('  Aún no entra a cocina: el envío quedó sin cotizar (revisa el estado en Pedidos del POS).');
  } else if (order.paymentStatus !== 'paid' && (pickup || paymentMethod === 'qr')) {
    console.log('  Está en cocina como «Falta cobrar en caja»: se cobra desde Pedidos del POS.');
  } else {
    console.log('  Ya está en la columna Nuevos de la cocina.');
  }
}

const HINTS = {
  closed: 'El local está fuera de su horario. Cambia el horario en Configuración del POS, o carga la demo con --24h.',
  orders_paused: 'Los pedidos están en pausa. Reanúdalos en Configuración del POS.',
  pickup_disabled: 'El retiro en el local está apagado. Actívalo en Configuración del POS o prueba sin --pickup.',
};

main().catch((error) => {
  console.error(`Falló la simulación: ${error.message}`);
  if (HINTS[error.code]) console.error(HINTS[error.code]);
  process.exit(1);
});
