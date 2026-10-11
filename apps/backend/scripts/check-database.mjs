#!/usr/bin/env node
// Revisa, SIN ESCRIBIR NADA, si una base PostgreSQL sirve para este backend:
// qué migraciones tiene aplicadas, qué tablas le sobran o le faltan y cuántas
// filas hay. Sirve para decidir si se reutiliza una base o se empieza de cero.
//
//   node --env-file=.env.supabase scripts/check-database.mjs
//   node --env-file=.env.dev      scripts/check-database.mjs
//
// Usa DIRECT_URL si existe (conexión de sesión, la que necesitan las
// migraciones) y, si no, DATABASE_URL. Nunca imprime la contraseña.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!raw) {
  console.error('Falta DIRECT_URL o DATABASE_URL. Ejemplo: node --env-file=.env.supabase scripts/check-database.mjs');
  process.exit(2);
}

const url = new URL(raw);
const local = ['localhost', '127.0.0.1'].includes(url.hostname);
console.log(`Base: ${url.hostname}:${url.port || 5432}${url.pathname} (usuario ${url.username})`);
if (url.port === '6543') {
  console.log('Aviso: el puerto 6543 es el pooler de transacciones. Para migrar hace falta la conexión de sesión (5432): ponla en DIRECT_URL.');
}

const migrationFiles = (await readdir(path.join(ROOT, 'migrations')))
  .filter((file) => file.endsWith('.sql'))
  .map((file) => file.replace(/\.sql$/, ''))
  .sort();

// Las tablas que este backend espera son las claves de `Database` en types.ts.
const types = await readFile(path.join(ROOT, 'src/database/types.ts'), 'utf8');
const expectedTables = [...types.slice(types.indexOf('export interface Database {')).matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]);

const client = new pg.Client({
  connectionString: raw,
  ssl: local ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
} catch (error) {
  console.error(`No se pudo conectar: ${error.code ?? ''} ${error.message}`);
  process.exit(1);
}

try {
  // Garantía de solo lectura: cualquier escritura fallaría.
  await client.query('set default_transaction_read_only = on');
  const version = (await client.query('show server_version')).rows[0].server_version;
  console.log(`Conectado. PostgreSQL ${version}\n`);

  const tables = (
    await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")
  ).rows.map((row) => row.table_name);

  const hasLedger = tables.includes('pgmigrations');
  const applied = hasLedger ? (await client.query('select name from pgmigrations order by run_on, id')).rows.map((row) => row.name) : [];
  const pending = migrationFiles.filter((name) => !applied.includes(name));
  const unknown = applied.filter((name) => !migrationFiles.includes(name));

  const missing = expectedTables.filter((name) => !tables.includes(name));
  const extra = tables.filter((name) => !expectedTables.includes(name) && name !== 'pgmigrations');

  console.log(`Tablas en public: ${tables.length}`);
  for (const name of tables) {
    const count = (await client.query(`select count(*)::int as n from public."${name.replace(/"/g, '""')}"`)).rows[0].n;
    const mark = expectedTables.includes(name) || name === 'pgmigrations' ? ' ' : '?';
    console.log(`  ${mark} ${name.padEnd(34)} ${String(count).padStart(7)} filas`);
  }
  if (extra.length > 0) console.log('  (? = tabla que este backend no conoce)');

  console.log(`\nMigraciones: ${applied.length} aplicadas de ${migrationFiles.length}`);
  if (pending.length > 0) console.log(`  faltan: ${pending.join(', ')}`);
  if (unknown.length > 0) console.log(`  aplicadas que no están en este repo: ${unknown.join(', ')}`);
  if (missing.length > 0) console.log(`Tablas que faltan: ${missing.join(', ')}`);

  console.log('\nVeredicto:');
  if (tables.length === 0) {
    console.log('  Base vacía: es el caso ideal. Corre todas las migraciones desde cero.');
  } else if (!hasLedger) {
    console.log('  Tiene tablas pero no el registro de migraciones (pgmigrations): las creó otro sistema.');
    console.log('  No conviene migrar encima. Usa una base nueva y vacía.');
  } else if (unknown.length > 0) {
    console.log('  Tiene migraciones que este repo no conoce: viene de otra versión del backend.');
    console.log('  No conviene migrar encima sin compararlas. Lo seguro es una base nueva.');
  } else if (pending.length > 0 && missing.length === 0 && extra.length === 0) {
    console.log(`  Es de este backend y le faltan ${pending.length} migraciones: se puede poner al día con migrate up.`);
  } else if (pending.length === 0 && missing.length === 0) {
    console.log(`  Está al día con este backend.${extra.length > 0 ? ' Las tablas marcadas con ? son de otro sistema y no estorban.' : ''}`);
  } else {
    console.log('  Estado mixto: revisa las listas de arriba antes de migrar. Ante la duda, base nueva.');
  }
} finally {
  await client.end();
}
