#!/usr/bin/env node
// Comprueba las credenciales y la API QR de Banco Económico DE VERDAD
// (certificación o producción), con el mismo cliente que usa el backend.
//
//   cd apps/backend
//   npm run baneco:check                       # con las BANECO_* de .env.dev
//   node --env-file=<otro .env> scripts/check-baneco.mjs
//
// Sin opciones genera un QR de Bs 1, consulta su estado (pendiente), lo anula
// y lo vuelve a consultar (anulado). No cobra nada: el QR nunca se paga.
//
// Para probar un PAGO de verdad, que es lo único que este recorrido no cubre:
//
//   --keep            genera el QR, guarda la imagen y NO lo anula
//   --days <n>        con --keep: el QR vence en n días en vez de hoy, para
//                     darle tiempo a quien lo vaya a pagar
//   --status <qrId>   consulta ese QR (pendiente, pagado con sus datos, o anulado)
//   --cancel <qrId>   lo anula
//
// --raw   muestra las respuestas del banco tal como llegan (sin la imagen).
//
// Nunca muestra la contraseña, la llave ni el token. Sale con código 0 si todo
// cumple, 1 si algo falla y 2 si faltan variables o el backend no está compilado.

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const clientFile = path.join(HERE, '..', 'dist', 'baneco', 'baneco-client.service.js');
if (!existsSync(clientFile)) {
  console.error('El backend no está compilado: npm run build');
  process.exit(2);
}
const { BanecoClientService } = require(clientFile);
const appConfig = require(path.join(HERE, '..', 'dist', 'config', 'configuration.js')).default();
const client = new BanecoClientService({ get: (key) => appConfig[key] });

const missing = client.missingSettings();
if (missing.length > 0) {
  console.error(`Faltan variables: ${missing.join(', ')}.`);
  console.error('Van en apps/backend/.env.dev (fuera de git), con los datos que entregó el banco.');
  process.exit(2);
}

let failures = 0;
const STATUS_NAMES = { 0: 'pendiente de pago', 1: 'pagado', 9: 'anulado' };

function show(raw) {
  if (!flag('raw') || !raw) return;
  const { qrImage, ...rest } = raw;
  console.log(`      ${JSON.stringify({ ...rest, ...(qrImage ? { qrImage: `<${qrImage.length} caracteres>` } : {}) })}`);
}

/** Corre un paso y dice si cumplió. Devuelve su resultado, o `undefined` si falló. */
async function step(name, action, expectation) {
  try {
    const result = await action();
    const problem = expectation?.(result);
    if (problem) {
      failures += 1;
      console.log(`  ✖ ${name}\n      ${problem}`);
    } else {
      console.log(`  ✔ ${name}`);
    }
    show(result?.raw);
    return result;
  } catch (error) {
    failures += 1;
    console.log(`  ✖ ${name}\n      ${error.message}`);
    return undefined;
  }
}

const days = Number(option('days') ?? 0);
if (!Number.isInteger(days) || days < 0 || days > 30) {
  console.error('--days debe ser un número entero de 0 a 30.');
  process.exit(2);
}
/** La fecha de vencimiento, en Bolivia: hoy, o dentro de `--days` días. */
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(
  new Date(Date.now() + days * 24 * 60 * 60_000),
);
const expectStatus = (code) => (result) =>
  result.statusQrCode === code
    ? null
    : `se esperaba «${STATUS_NAMES[code]}» y el banco dice «${STATUS_NAMES[result.statusQrCode]}».`;

console.log(`Banco: ${appConfig.baneco.baseUrl}`);
console.log(`Usuario: ${appConfig.baneco.username} · cuenta terminada en ${appConfig.baneco.account.slice(-3)}\n`);

if (option('status')) {
  const result = await step(`consultar ${option('status')}`, () => client.statusQR(option('status')));
  if (result) {
    console.log(`      Estado: ${STATUS_NAMES[result.statusQrCode]}`);
    if (result.payment) {
      const { amount, currency, paymentDate, paymentTime, senderName } = result.payment;
      console.log(`      Pago: ${amount} ${currency}, ${String(paymentDate).slice(0, 10)} ${paymentTime}, de ${senderName}`);
    }
  }
} else if (option('cancel')) {
  await step(`anular ${option('cancel')}`, () => client.cancelQR(option('cancel')));
} else {
  const transactionId = `PRUEBA-${Date.now()}`;
  const generated = await step(
    'cifrar, autenticar y generar un QR de Bs 1',
    () => client.generateQR({ transactionId, amount: 1, description: 'Prueba de integración', dueDate: today }),
    (result) => (Buffer.from(result.qrImageBase64, 'base64').subarray(1, 4).toString() === 'PNG' ? null : 'la imagen no es un PNG.'),
  );

  if (generated) {
    console.log(`      qrId: ${generated.qrId}`);
    await step('el QR recién generado está pendiente de pago', () => client.statusQR(generated.qrId), expectStatus(0));

    if (flag('keep')) {
      // En `.local/` de la raíz del repo (fuera de git) si existe; si no, en la carpeta temporal.
      const localDir = path.join(HERE, '..', '..', '..', '.local');
      const file = path.join(existsSync(localDir) ? localDir : tmpdir(), `baneco-qr-${generated.qrId}.png`);
      await writeFile(file, Buffer.from(generated.qrImageBase64, 'base64'));
      console.log(`\nEl QR quedó vivo: Bs 1, vence el ${today}. Imagen: ${file}`);
      console.log(`Después de pagarlo:   node --env-file=.env.dev scripts/check-baneco.mjs --status ${generated.qrId}`);
      console.log(`Si no se va a pagar:  node --env-file=.env.dev scripts/check-baneco.mjs --cancel ${generated.qrId}`);
    } else {
      // Dato que el manual no dice: si el banco acepta dos QR con el mismo
      // identificador. No cambia nada hoy (cada pedido pide uno solo), pero
      // importa si algún día se regenera el QR de un pedido.
      try {
        const repeated = await client.generateQR({ transactionId, amount: 1, description: 'Prueba de integración', dueDate: today });
        console.log('  – el banco ACEPTA un segundo QR con el mismo transactionId');
        await client.cancelQR(repeated.qrId).catch(() => undefined);
      } catch (error) {
        console.log(`  – el banco RECHAZA un segundo QR con el mismo transactionId (${error.message})`);
      }

      await step('anular el QR', () => client.cancelQR(generated.qrId));
      await step('el QR anulado figura como anulado', () => client.statusQR(generated.qrId), expectStatus(9));
    }
  }
}

console.log(failures === 0 ? '\nTodo cumple.' : `\n${failures} paso(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
