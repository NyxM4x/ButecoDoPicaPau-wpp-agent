#!/usr/bin/env node
// Carga un perfil de demo (demos/<slug>/menu.json + images/) en el backend,
// usando la MISMA API que usa el POS: login de admin, categorías, productos,
// fotos, promociones y configuración del local. Sin dependencias (Node >= 20).
//
//   node scripts/load-demo.mjs buteco-do-pica-pau       # carga o actualiza
//   node scripts/load-demo.mjs buteco-do-pica-pau --replace  # y apaga lo que no sea de esta demo
//   node scripts/load-demo.mjs buteco-do-pica-pau --with-staff  # crea además los usuarios cocina y caja
//   node scripts/load-demo.mjs buteco-do-pica-pau --24h         # sin horario: para mostrar la demo a cualquier hora
//
// Es idempotente: se puede correr las veces que haga falta. Nunca borra nada:
// `--replace` desactiva productos y categorías y archiva promociones, así los
// pedidos históricos siguen apuntando a algo que existe.
//
// Destino y credenciales (variables de entorno):
//   API_URL          por defecto http://localhost:3100
//   ADMIN_USER       por defecto DEV_ADMIN_USER de apps/backend/.env.dev
//   ADMIN_PASSWORD   por defecto DEV_ADMIN_PASSWORD de apps/backend/.env.dev
//   STAFF_PASSWORD   contraseña de cocina/caja con --with-staff (por defecto la del admin)

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME_BY_EXT = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const SETTINGS_KEYS = [
  'pickupEnabled',
  'ordersPaused',
  'rainSurchargeEnabled',
  'rainSurchargeAmount',
  'businessOpensHour',
  'businessClosesHour',
  'restaurantLatitude',
  'restaurantLongitude',
  'restaurantName',
  // Perfil del restaurante (GET /restaurant/profile): lo que el agente dice del local.
  'restaurantDescription',
  'restaurantPhone',
  'restaurantAddress',
  'restaurantMapsUrl',
  'restaurantTimezone',
  'restaurantLocale',
  'currencyCode',
  'currencySymbol',
  'hoursText',
  'deliveryEnabled',
  'enabledPaymentMethods',
  'greetingMessage',
  'farewellMessage',
  'menuVideoUrl',
  'menuImageUrl',
  // Modo «sin POS»: sin caja ni pantallas, con el pedido al personal por Telegram.
  'requiresCashRegister',
  'autoCompleteMinutes',
];

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const replace = args.includes('--replace');
const withStaff = args.includes('--with-staff');
const allDay = args.includes('--24h');

if (!slug) {
  console.error('Uso: node scripts/load-demo.mjs <slug> [--replace] [--with-staff] [--24h]');
  process.exit(2);
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

const devEnv = await readEnvFile(path.join(ROOT, 'apps/backend/.env.dev'));
const apiUrl = (process.env.API_URL ?? `http://localhost:${devEnv.PORT ?? 3100}`).replace(/\/$/, '');
const adminUser = process.env.ADMIN_USER ?? devEnv.DEV_ADMIN_USER;
const adminPassword = process.env.ADMIN_PASSWORD ?? devEnv.DEV_ADMIN_PASSWORD;

if (!adminUser || !adminPassword) {
  console.error('Faltan ADMIN_USER y ADMIN_PASSWORD (o apps/backend/.env.dev con DEV_ADMIN_USER/DEV_ADMIN_PASSWORD).');
  process.exit(2);
}

const demoDir = path.join(ROOT, 'demos', slug);
let demo;
try {
  demo = JSON.parse(await readFile(path.join(demoDir, 'menu.json'), 'utf8'));
} catch (error) {
  console.error(`No se pudo leer demos/${slug}/menu.json: ${error.message}`);
  process.exit(2);
}

let token = null;

async function api(method, route, body) {
  const response = await fetch(`${apiUrl}${route}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
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
  return parsed;
}

function validate() {
  const problems = [];
  const categoryNames = new Set((demo.categories ?? []).map((c) => c.name));
  const codes = new Set();
  for (const p of demo.products ?? []) {
    if (!p.code || !p.name) problems.push(`producto sin code o name: ${JSON.stringify(p)}`);
    if (codes.has(p.code)) problems.push(`code repetido: ${p.code}`);
    codes.add(p.code);
    if (!categoryNames.has(p.category)) problems.push(`${p.code}: la categoría "${p.category}" no está en categories`);
    if (typeof p.price !== 'number' || p.price < 0) problems.push(`${p.code}: precio inválido`);
  }
  for (const promo of demo.promotions ?? []) {
    const distinct = new Set((promo.items ?? []).map((i) => i.code));
    if (distinct.size < 2) problems.push(`promoción "${promo.name}": necesita al menos 2 productos distintos`);
    for (const code of distinct) if (!codes.has(code)) problems.push(`promoción "${promo.name}": no existe el producto ${code}`);
  }
  if (problems.length > 0) {
    console.error(`demos/${slug}/menu.json tiene errores:\n- ${problems.join('\n- ')}`);
    process.exit(2);
  }
}

async function main() {
  validate();
  console.log(`Demo "${demo.restaurant?.name ?? slug}" -> ${apiUrl}${replace ? ' (reemplazando lo anterior)' : ''}`);

  token = (await api('POST', '/auth/login', { username: adminUser, password: adminPassword })).accessToken;

  // ── Categorías (clave: nombre) ────────────────────────────────────────────
  const existingCategories = await api('GET', '/categories?includeInactive=true');
  const categoryIdByName = new Map();
  for (const category of demo.categories) {
    const found = existingCategories.find((c) => c.name === category.name);
    const body = { name: category.name, sortOrder: category.sortOrder ?? 0, isActive: true };
    const saved = found ? await api('PATCH', `/categories/${found.id}`, body) : await api('POST', '/categories', body);
    categoryIdByName.set(category.name, saved.id);
  }

  // ── Productos (clave: code) ───────────────────────────────────────────────
  const existingProducts = await api('GET', '/products?includeInactive=true');
  const productIdByCode = new Map();
  let created = 0;
  let updated = 0;
  let photos = 0;
  const missingPhotos = [];
  for (const product of demo.products) {
    const found = existingProducts.find((p) => p.code === product.code);
    const fields = {
      name: product.name,
      categoryId: categoryIdByName.get(product.category),
      price: product.price,
      isActive: true,
      sortOrder: product.sortOrder ?? 0,
      ...(product.description ? { description: product.description } : {}),
    };
    let saved;
    if (found) {
      saved = await api('PATCH', `/products/${found.id}`, fields);
      await api('PATCH', `/products/${found.id}/availability`, { available: product.available ?? true });
      updated += 1;
    } else {
      saved = await api('POST', '/products', { code: product.code, isAvailable: product.available ?? true, ...fields });
      created += 1;
    }
    productIdByCode.set(product.code, saved.id);

    if (product.image) {
      const file = path.join(demoDir, 'images', product.image);
      const mimeType = MIME_BY_EXT[path.extname(file).toLowerCase()];
      try {
        await access(file);
        if (!mimeType) throw new Error('formato no admitido');
        await api('POST', `/products/${saved.id}/image`, { mimeType, fileBase64: (await readFile(file)).toString('base64') });
        photos += 1;
      } catch (error) {
        missingPhotos.push(`${product.image} (${error.message})`);
      }
    }
  }

  // ── Promociones (clave: nombre) ───────────────────────────────────────────
  const existingPromotions = await api('GET', '/promotions');
  const demoPromoNames = new Set();
  for (const promo of demo.promotions ?? []) {
    demoPromoNames.add(promo.name);
    const body = {
      name: promo.name,
      promoPrice: promo.promoPrice,
      items: promo.items.map((i) => ({ productId: productIdByCode.get(i.code), quantity: i.quantity ?? 1 })),
      ...(promo.description ? { description: promo.description } : {}),
    };
    // Si una carga anterior con --replace la archivó, se recupera esa misma en
    // vez de crear otra: ir y volver entre demos no debe acumular duplicados.
    const sameName = existingPromotions.filter((p) => p.name === promo.name);
    const found = sameName.find((p) => !p.archivedAt) ?? sameName[0];
    if (found?.archivedAt) await api('PATCH', `/promotions/${found.id}/archived`, { archived: false });
    const saved = found ? await api('PATCH', `/promotions/${found.id}`, body) : await api('POST', '/promotions', body);
    await api('PATCH', `/promotions/${saved.id}/active`, { active: promo.active ?? true });
  }

  // ── Lo que no pertenece a esta demo ───────────────────────────────────────
  let hidden = 0;
  if (replace) {
    for (const promo of existingPromotions) {
      if (!promo.archivedAt && !demoPromoNames.has(promo.name)) {
        await api('PATCH', `/promotions/${promo.id}/archived`, { archived: true });
        hidden += 1;
      }
    }
    for (const product of existingProducts) {
      if (product.isActive && !productIdByCode.has(product.code)) {
        await api('PATCH', `/products/${product.id}`, { isActive: false });
        hidden += 1;
      }
    }
    for (const category of existingCategories) {
      if (category.isActive && !categoryIdByName.has(category.name)) {
        await api('PATCH', `/categories/${category.id}`, { isActive: false });
        hidden += 1;
      }
    }
  }

  // ── Configuración del local ───────────────────────────────────────────────
  // Nombre, descripción, dirección, enlace de Maps y teléfono salen de
  // `restaurant`; el resto, de `settings`. Con --24h se pisa el horario: misma
  // hora de apertura y de cierre = abierto todo el día.
  const wanted = {
    ...demo.settings,
    ...(demo.restaurant?.name ? { restaurantName: demo.restaurant.name } : {}),
    ...(demo.restaurant?.description ? { restaurantDescription: demo.restaurant.description } : {}),
    ...(demo.restaurant?.address ? { restaurantAddress: demo.restaurant.address } : {}),
    ...(demo.restaurant?.mapsUrl ? { restaurantMapsUrl: demo.restaurant.mapsUrl } : {}),
    ...(demo.restaurant?.phone ? { restaurantPhone: demo.restaurant.phone } : {}),
    ...(allDay ? { businessOpensHour: 0, businessClosesHour: 0 } : {}),
  };
  const settings = Object.fromEntries(
    SETTINGS_KEYS.filter((key) => wanted[key] !== undefined && wanted[key] !== null).map((key) => [key, wanted[key]]),
  );
  const saved = Object.keys(settings).length > 0 ? await api('PATCH', '/operational-settings', settings) : null;

  // ── Usuarios de cocina y caja ─────────────────────────────────────────────
  const staff = [];
  if (withStaff) {
    const password = process.env.STAFF_PASSWORD ?? adminPassword;
    for (const [username, role] of [
      ['cocina', 'kitchen'],
      ['caja', 'cashier'],
    ]) {
      try {
        await api('POST', '/auth/users', { username, password, role });
        staff.push(`${username} (creado)`);
      } catch (error) {
        if (error.code !== 'username_taken') throw error;
        staff.push(`${username} (ya existía)`);
      }
    }
  }

  console.log(
    [
      `  categorías:  ${demo.categories.length}`,
      `  productos:   ${created} nuevos, ${updated} actualizados`,
      `  fotos:       ${photos} subidas${missingPhotos.length ? `, ${missingPhotos.length} sin subir` : ''}`,
      `  promociones: ${(demo.promotions ?? []).length}`,
      replace ? `  apagados:    ${hidden} (de la demo anterior)` : null,
      withStaff ? `  usuarios:    ${staff.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  for (const missing of missingPhotos) console.warn(`  aviso: foto no subida -> ${missing}`);
  if (saved) {
    const { businessOpensHour: opens, businessClosesHour: closes } = saved;
    if (opens === closes) {
      console.log('  horario:     abierto las 24 horas');
    } else {
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/La_Paz', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
      const openNow = (((hour - opens) % 24) + 24) % 24 < (((closes - opens) % 24) + 24) % 24;
      console.log(`  horario:     de ${opens}:00 a ${closes}:00 (hora de Bolivia)`);
      if (!openNow) {
        console.warn('  aviso: con ese horario el local está CERRADO ahora: los pedidos de WhatsApp y web se rechazan.');
        console.warn('         Para mostrar la demo a cualquier hora, vuelve a cargarla con --24h. El POS vende siempre.');
      }
    }
  }
}

main().catch((error) => {
  console.error(`Falló la carga: ${error.message}`);
  process.exit(1);
});
