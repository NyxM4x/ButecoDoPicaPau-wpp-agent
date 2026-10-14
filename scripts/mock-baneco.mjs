#!/usr/bin/env node
// Un Banco Económico de mentira para desarrollo local: contesta las mismas
// rutas que la API QR del banco («API Market», manual v1.3.0) y deja pagar un
// QR con una llamada. Sin dependencias (Node >= 20).
//
//   node scripts/mock-baneco.mjs                 # escucha en http://localhost:3290
//   node scripts/mock-baneco.mjs --port 3291
//
// Para que el backend local lo use, en apps/backend/.env.dev:
//
//   BANECO_BASE_URL=http://localhost:3290/ApiGateway/
//   BANECO_USERNAME=prueba
//   BANECO_PASSWORD=prueba
//   BANECO_AES_KEY=prueba
//   BANECO_ACCOUNT=1234567890
//
// Rutas de control (no existen en el banco de verdad):
//
//   GET  /__mock/qrs                    los QR generados y su estado
//   POST /__mock/pay/<qrId>             paga un QR
//   POST /__mock/fail   {"failing":true}   hace fallar todas las llamadas (banco caído)
//
// Con --notify-url, al pagar avisa al comercio como lo haría el banco:
//
//   node scripts/mock-baneco.mjs --notify-url http://localhost:3200/api/qrsimple/notifyPaymentQR
//
// NO es el ambiente de certificación: no valida credenciales ni cifra de
// verdad. Lo que se compruebe aquí hay que repetirlo contra el banco
// (apps/backend/scripts/check-baneco.mjs).

import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const PREFIX = '/ApiGateway';
const TOKEN_TTL_SECONDS = 30 * 60;

// ── Imagen del QR ───────────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** Un PNG válido con cuadros que dependen del texto: parece un QR, no lo es. */
function fakeQrPng(seed) {
  const cells = 29;
  const scale = 8;
  const size = cells * scale;
  let state = crc32(Buffer.from(seed)) || 1;
  const dark = Array.from({ length: cells * cells }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 31 === 1;
  });
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size, 0xff);
    row[0] = 0; // sin filtro
    for (let x = 0; x < size; x += 1) {
      if (dark[Math.floor(y / scale) * cells + Math.floor(x / scale)]) row[1 + x] = 0x00;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8 bits, escala de grises
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Servidor ────────────────────────────────────────────────────────────────

function fakeToken() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'none' })}.${encode({ iat: now, exp: now + TOKEN_TTL_SECONDS })}.mock`;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * Arranca el banco simulado. Devuelve su dirección y los controles que usan
 * las pruebas (`pay`, `setFailing`, `qrs`, `calls`).
 */
export async function startMockBaneco({ port = 3290, notifyUrl, quiet = false } = {}) {
  /** @type {Map<string, any>} */
  const qrs = new Map();
  /** @type {Array<{method: string, path: string, body: any}>} */
  const calls = [];
  let failing = false;
  let sequence = 0;
  /** Cinco dígitos que cambian en cada arranque (los segundos del día). */
  const runId = String(Math.floor(Date.now() / 1000) % 86_400).padStart(5, '0');
  const log = (...parts) => {
    if (!quiet) console.log('[banco simulado]', ...parts);
  };

  const paymentOf = (qr) => ({
    qrId: qr.qrId,
    transactionId: String(900000 + qr.sequence),
    paymentDate: `${qr.paidAt.slice(0, 10)}T00:00:00`,
    paymentTime: qr.paidAt.slice(11, 19),
    currency: qr.currency,
    amount: qr.amount,
    senderBankCode: '1016',
    senderName: 'CLIENTE DE PRUEBA',
    senderDocumentId: '0',
    senderAccount: '******0000',
    description: qr.description,
  });

  async function pay(qrId) {
    const qr = qrs.get(qrId);
    if (!qr) return { ok: false, message: 'QR inexistente' };
    if (qr.status === 9) return { ok: false, message: 'QR anulado' };
    if (qr.status === 1) return { ok: true, message: 'ya estaba pagado' };
    qr.status = 1;
    qr.paidAt = new Date().toISOString();
    log(`pagado ${qrId} (${qr.transactionId}, ${qr.amount} ${qr.currency})`);
    if (notifyUrl) {
      try {
        await fetch(notifyUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ payment: paymentOf(qr) }),
        });
      } catch (error) {
        log(`no se pudo avisar a ${notifyUrl}: ${error.message}`);
      }
    }
    return { ok: true, message: '' };
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    const reply = (responseCode, message, extra = {}) => send(200, { ...extra, responseCode, message });

    // Control.
    if (url.pathname === '/__mock/qrs') return send(200, [...qrs.values()].map(({ image, ...qr }) => qr));
    if (url.pathname === '/__mock/fail' && request.method === 'POST') {
      failing = Boolean((await readJson(request)).failing);
      log(failing ? 'ahora falla todo' : 'vuelve a responder');
      return send(200, { failing });
    }
    if (url.pathname.startsWith('/__mock/pay/') && request.method === 'POST') {
      const result = await pay(decodeURIComponent(url.pathname.slice('/__mock/pay/'.length)));
      return send(result.ok ? 200 : 404, result);
    }

    if (!url.pathname.startsWith(`${PREFIX}/`)) return send(404, { message: 'ruta desconocida' });
    const route = url.pathname.slice(PREFIX.length);
    const body = request.method === 'GET' ? undefined : await readJson(request);
    calls.push({ method: request.method ?? 'GET', path: route, body });
    if (failing) return send(503, { message: 'banco simulado caído' });

    if (route === '/api/authentication/encrypt') {
      return send(200, `mock:${Buffer.from(url.searchParams.get('text') ?? '').toString('base64')}`);
    }
    if (route === '/api/authentication/decrypt') {
      const text = (url.searchParams.get('text') ?? '').replace(/^mock:/, '');
      return send(200, Buffer.from(text, 'base64').toString('utf8'));
    }
    if (route === '/api/authentication/authenticate' && request.method === 'POST') {
      if (!body.userName || !body.password) return reply(1, 'Credenciales incompletas');
      return reply(0, '', { token: fakeToken() });
    }

    if (!/^Bearer .+/.test(request.headers.authorization ?? '')) {
      return send(401, { message: 'Falta el token' });
    }

    if (route === '/api/qrsimple/generateQR' && request.method === 'POST') {
      const required = ['transactionId', 'accountCredit', 'currency', 'amount', 'dueDate', 'singleUse', 'modifyAmount'];
      const missing = required.filter((field) => body[field] === undefined || body[field] === '');
      if (missing.length > 0) return reply(1, `Faltan campos: ${missing.join(', ')}`);
      if (String(body.transactionId).length > 30) return reply(1, 'transactionId excede 30 caracteres');
      if (String(body.description ?? '').length > 100) return reply(1, 'description excede 100 caracteres');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) return reply(1, 'dueDate debe ser yyyy-MM-dd');
      if (!(Number(body.amount) > 0)) return reply(1, 'amount inválido');

      sequence += 1;
      const stamp = new Date().toISOString().slice(2, 10).replaceAll('-', '');
      // Como los del banco: 20 dígitos, y nunca repetidos aunque el simulador se reinicie.
      const qrId = `${stamp}01016${runId}${String(sequence).padStart(4, '0')}`;
      const image = fakeQrPng(qrId).toString('base64');
      qrs.set(qrId, {
        qrId,
        sequence,
        status: 0,
        transactionId: body.transactionId,
        amount: Number(body.amount),
        currency: body.currency,
        description: body.description ?? '',
        dueDate: body.dueDate,
        singleUse: body.singleUse,
        paidAt: null,
        image,
      });
      log(`generado ${qrId} (${body.transactionId}, ${body.amount} ${body.currency}, vence ${body.dueDate})`);
      return reply(0, '', { qrId, qrImage: image });
    }

    const statusMatch = /^\/api\/qrsimple\/v2\/statusQR\/([^/]+)$/.exec(route);
    if (statusMatch && request.method === 'GET') {
      const qr = qrs.get(decodeURIComponent(statusMatch[1]));
      if (!qr) return reply(1, 'QR inexistente');
      return reply(0, '', {
        statusQrCode: qr.status,
        ...(qr.status === 1 ? { payment: [paymentOf(qr)] } : {}),
      });
    }

    if (route === '/api/qrsimple/cancelQR' && request.method === 'DELETE') {
      const qr = qrs.get(body.qrId);
      if (!qr) return reply(1, 'QR inexistente');
      if (qr.status === 1 && qr.singleUse) return reply(1, 'El QR ya fue pagado');
      qr.status = 9;
      log(`anulado ${qr.qrId}`);
      return reply(0, '');
    }

    const paidMatch = /^\/api\/qrsimple\/v2\/paidQR\/(\d{8})$/.exec(route);
    if (paidMatch && request.method === 'GET') {
      const day = `${paidMatch[1].slice(0, 4)}-${paidMatch[1].slice(4, 6)}-${paidMatch[1].slice(6)}`;
      const paymentList = [...qrs.values()]
        .filter((qr) => qr.status === 1 && qr.paidAt.startsWith(day))
        .map(paymentOf);
      return reply(0, '', { paymentList });
    }

    return send(404, { message: `ruta no simulada: ${request.method} ${route}` });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;

  return {
    /** Lo que va en `BANECO_BASE_URL`. */
    url: `http://127.0.0.1:${listeningPort}${PREFIX}/`,
    port: listeningPort,
    qrs,
    calls,
    pay,
    setFailing(value) {
      failing = value;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// ── Línea de comandos ───────────────────────────────────────────────────────

// En Windows la letra de la unidad puede venir en mayúscula o en minúscula.
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const bank = await startMockBaneco({
    port: Number(option('port') ?? 3290),
    notifyUrl: option('notify-url'),
  });
  console.log(`Banco simulado en ${bank.url}`);
  console.log(`  pagar un QR:   curl -X POST http://127.0.0.1:${bank.port}/__mock/pay/<qrId>`);
  console.log(`  ver los QR:    curl http://127.0.0.1:${bank.port}/__mock/qrs`);
}
