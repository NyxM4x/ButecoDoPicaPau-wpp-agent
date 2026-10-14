#!/usr/bin/env node
// Prepara las capas de la tabla por capas (la maqueta de /menu/maqueta): la
// tabla de base (arroz y plátano) y cada carne recortada, por separado.
//
//   node scripts/prepare-board-layers.mjs
//
// Lee los originales del usuario (PNG transparentes, 1 MB cada uno):
//   apps/agent-whatsapp/public/menu/tablaPrincipal.png   la base
//   apps/agent-whatsapp/public/menu/carnes/*.png          una por carne
//
// y deja en apps/agent-whatsapp/public/menu/capas/ un WebP de cada uno, sin el
// margen vacío: `tabla.webp` y `carnes/<nombre-con-guiones>.webp`
// (chicharronDePescado.png -> chicharron-de-pescado.webp). Al final escribe el
// ancho y el alto de cada capa: van en `src/lib/menu/board-layers.ts`.
//
// OJO: el acomodo de las carnes está medido sobre la base RECORTADA. Si cambia
// la foto de la base, hay que volver a medir los huecos en ese archivo.
//
// Usa `sharp`, que ya viene instalado con el agente (lo trae Next).

import { mkdir, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'apps', 'agent-whatsapp');
const SOURCE = path.join(APP, 'public', 'menu');
const TARGET = path.join(SOURCE, 'capas');

/** La base se ve a lo ancho de la tarjeta; una carne, a un tercio de eso. */
const BASE_WIDTH = 1200;
const MEAT_WIDTH = 640;

let sharp;
try {
  sharp = createRequire(path.join(APP, 'package.json'))('sharp');
} catch {
  console.error('No se encontró sharp: corre "npm install" dentro de apps/agent-whatsapp.');
  process.exit(2);
}

/** «chicharronDePescado» -> «chicharron-de-pescado». */
const kebab = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

async function prepare(input, output, maxWidth) {
  // El recorte quita el margen transparente: sin él, las medidas del acomodo
  // dependerían del lienzo con el que se exportó cada foto.
  const info = await sharp(input)
    .trim()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(output);
  const before = (await stat(input)).size;
  console.log(
    `${path.relative(SOURCE, input)}  ${kb(before)}  ->  ${path.relative(TARGET, output)}  ` +
      `${info.width}x${info.height}  ${kb(info.size)}`,
  );
}

await mkdir(path.join(TARGET, 'carnes'), { recursive: true });

await prepare(path.join(SOURCE, 'tablaPrincipal.png'), path.join(TARGET, 'tabla.webp'), BASE_WIDTH);

const meats = (await readdir(path.join(SOURCE, 'carnes'))).filter((name) => /\.(png|webp)$/i.test(name)).sort();
for (const name of meats) {
  await prepare(
    path.join(SOURCE, 'carnes', name),
    path.join(TARGET, 'carnes', `${kebab(path.parse(name).name)}.webp`),
    MEAT_WIDTH,
  );
}

console.log(`\nListo: la base y ${meats.length} carne(s) en ${path.relative(ROOT, TARGET)}`);
