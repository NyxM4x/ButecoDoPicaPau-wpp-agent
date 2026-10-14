#!/usr/bin/env node
// Prepara las fotos de un menú para cargarlas en el backend: recorta el margen
// vacío, las achica y las pasa a WebP. Una foto de celular de 1 MB queda en
// unos 60 KB, que es lo que tiene que pesar en la pantalla de un cliente con
// datos móviles.
//
//   node scripts/prepare-menu-images.mjs buteco-do-pica-pau apps/agent-whatsapp/public/menu
//
// Lee todos los PNG, JPG y WebP de la carpeta de origen y deja en
// demos/<slug>/images/ un .webp con el mismo nombre, en minúsculas y con
// guiones (Tablita1.png -> tablita1.webp). No toca los originales.
//
// --width N   ancho máximo en píxeles (por defecto 1000)
// --keep-margin   no recorta el margen: para fotos con fondo, que no lo tienen
//
// Usa `sharp`, que ya viene instalado con el agente (lo trae Next): antes hay
// que haber corrido `npm install` en apps/agent-whatsapp.

import { mkdir, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const positional = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--width');
const [slug, sourceArg] = positional;
const widthAt = args.indexOf('--width');
const maxWidth = widthAt >= 0 ? Number(args[widthAt + 1]) : 1000;
const keepMargin = args.includes('--keep-margin');

if (!slug || !sourceArg || !Number.isInteger(maxWidth) || maxWidth < 200) {
  console.error('Uso: node scripts/prepare-menu-images.mjs <slug> <carpeta-de-origen> [--width 1000] [--keep-margin]');
  process.exit(2);
}

let sharp;
try {
  sharp = createRequire(path.join(ROOT, 'apps', 'agent-whatsapp', 'package.json'))('sharp');
} catch {
  console.error('No se encontró sharp: corre "npm install" dentro de apps/agent-whatsapp.');
  process.exit(2);
}

const source = path.resolve(sourceArg);
const target = path.join(ROOT, 'demos', slug, 'images');
await mkdir(target, { recursive: true });

const files = (await readdir(source)).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).sort();
if (files.length === 0) {
  console.error(`No hay fotos (png, jpg, webp) en ${source}.`);
  process.exit(2);
}

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
for (const name of files) {
  const input = path.join(source, name);
  const outputName = `${path
    .parse(name)
    .name.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}.webp`;
  const output = path.join(target, outputName);

  let image = sharp(input).rotate(); // respeta la orientación de la cámara
  // El recorte quita el borde que es todo del mismo color que la esquina: en un
  // recorte sin fondo, el margen transparente que deja al plato chico en su caja.
  if (!keepMargin) image = image.trim();
  const info = await image
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(output);

  const before = (await stat(input)).size;
  console.log(`${name}  ${kb(before)}  ->  ${outputName}  ${info.width}x${info.height}  ${kb(info.size)}`);
}
console.log(`\nListo: ${files.length} foto(s) en ${path.relative(ROOT, target)}`);
