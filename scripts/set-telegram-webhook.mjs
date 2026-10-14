#!/usr/bin/env node
// Registra en Telegram el webhook del agente, por donde vuelven los toques de
// los botones del aviso de un pedido (Listo / Salió / Entregado). Se corre UNA
// vez después de publicar el agente, y de nuevo solo si cambia su dominio o el
// secreto. Sin dependencias (Node >= 20).
//
//   node scripts/set-telegram-webhook.mjs https://<dominio-del-agente>
//   node scripts/set-telegram-webhook.mjs --status      # qué tiene registrado Telegram
//   node scripts/set-telegram-webhook.mjs --delete      # quita el webhook
//
// Credenciales (variables de entorno, o apps/agent-whatsapp/.env.local):
//   TELEGRAM_BOT_TOKEN        el token del bot (de @BotFather)
//   TELEGRAM_WEBHOOK_SECRET   el mismo valor que tiene el agente en Vercel
//
// Solo pide los toques de botones (`callback_query`): el agente no lee los
// mensajes del grupo, y Telegram no se los manda.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

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

const local = await readEnvFile(path.join(ROOT, 'apps', 'agent-whatsapp', '.env.local'));
const token = process.env.TELEGRAM_BOT_TOKEN ?? local.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? local.TELEGRAM_WEBHOOK_SECRET;

if (!token) {
  console.error('Falta TELEGRAM_BOT_TOKEN (variable de entorno o apps/agent-whatsapp/.env.local).');
  process.exit(2);
}

/** Llama a la API de Telegram. El token va en la URL: nunca se imprime la URL. */
async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.ok !== true) {
    throw new Error(`Telegram respondió ${response.status}: ${json?.description ?? 'sin detalle'}`);
  }
  return json.result;
}

try {
  if (args.includes('--status')) {
    const info = await telegram('getWebhookInfo');
    console.log(`URL registrada:      ${info.url || '(ninguna)'}`);
    console.log(`Toques pendientes:   ${info.pending_update_count}`);
    console.log(`Qué recibe:          ${(info.allowed_updates ?? ['todo']).join(', ')}`);
    if (info.last_error_message) {
      console.log(`Último error:        ${info.last_error_message} (${new Date(info.last_error_date * 1000).toISOString()})`);
    }
    process.exit(0);
  }

  if (args.includes('--delete')) {
    await telegram('deleteWebhook');
    console.log('Webhook quitado: los botones de los avisos dejan de responder.');
    process.exit(0);
  }

  const origin = args.find((arg) => !arg.startsWith('--'))?.replace(/\/+$/, '');
  if (!origin || !/^https:\/\/[^/]+$/.test(origin)) {
    console.error('Uso: node scripts/set-telegram-webhook.mjs https://<dominio-del-agente>');
    console.error('Tiene que ser https y sin ruta: la ruta la pone este script.');
    process.exit(2);
  }
  if (!secret || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
    console.error('Falta TELEGRAM_WEBHOOK_SECRET, o no sirve: de 16 a 256 caracteres, solo letras, números, "_" y "-".');
    process.exit(2);
  }

  const url = `${origin}/api/telegram/webhook`;
  await telegram('setWebhook', { url, secret_token: secret, allowed_updates: ['callback_query'] });
  console.log(`Listo: Telegram manda los toques de botones a ${url}`);
  console.log('Comprueba con: node scripts/set-telegram-webhook.mjs --status');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
