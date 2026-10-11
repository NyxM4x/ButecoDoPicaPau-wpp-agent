#!/usr/bin/env node
// Crea o actualiza las tablas del agente de WhatsApp en un ESQUEMA PROPIO
// (`agent`) de la base, para que convivan con las del backend central en el
// mismo proyecto de Supabase.
//
// Por qué: las migraciones del agente (apps/agent-whatsapp/supabase/migrations)
// se escribieron para el esquema `public`, y 9 de sus tablas se llaman igual
// que las del backend (`orders`, `promotions`, `payment_attempts`…). Aquí se
// aplican las mismas migraciones, sin editarlas, cambiando `public` por
// `agent` al vuelo. El esquema `public` no se toca.
//
//   DATABASE_URL=postgres://... node scripts/agent-db.mjs          # aplica lo pendiente
//   DATABASE_URL=postgres://... node scripts/agent-db.mjs --status # solo muestra el estado
//
// Es repetible: lleva la cuenta en `agent.schema_migrations` y solo aplica las
// migraciones que falten. Requiere `psql` (viene con PostgreSQL).
//
// Después, el agente debe arrancar con SUPABASE_DB_SCHEMA=agent, y el esquema
// `agent` debe estar en "Exposed schemas" de la API de Supabase (el script
// intenta exponerlo y avisa si no pudo).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'agent';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'apps/agent-whatsapp/supabase/migrations');
const statusOnly = process.argv.includes('--status');

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('Falta DATABASE_URL (la cadena de conexión Postgres de la base de destino).');
  process.exit(2);
}

function findPsql() {
  if (process.env.PSQL) return process.env.PSQL;
  const base = 'C:/Program Files/PostgreSQL';
  if (existsSync(base)) {
    const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
    for (const version of versions) {
      const candidate = path.join(base, version, 'bin', 'psql.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'psql';
}
const PSQL = findPsql();

/** Ejecuta psql. Nunca imprime la cadena de conexión. */
function psql(args, { allowFail = false } = {}) {
  const result = spawnSync(PSQL, [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {
    encoding: 'utf8',
    env: { ...process.env, PGCONNECT_TIMEOUT: '20', PGCLIENTENCODING: 'UTF8' },
  });
  if (result.error) {
    console.error(`No se pudo ejecutar psql (${PSQL}): ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0 && !allowFail) {
    console.error((result.stderr || result.stdout).split(url).join('<url>').trim());
    process.exit(1);
  }
  return { ok: result.status === 0, out: result.stdout.trim(), err: result.stderr.trim() };
}

/**
 * La migración, apuntando al esquema del agente.
 *
 * Solo dos sustituciones, y son todas las formas en que las 39 migraciones
 * nombran el esquema: el prefijo `public.` y el `search_path = public` de sus
 * funciones. `public` queda SEGUNDO en el search_path para que sigan
 * resolviéndose las extensiones; las tablas del agente ganan porque `agent` va
 * primero.
 */
export function retarget(sql) {
  return sql
    .replace(/\bpublic\./g, `${SCHEMA}.`)
    .replace(/search_path\s*=\s*public\b/gi, `search_path = ${SCHEMA}, public`);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();

const schemaExists = psql(['-tA', '-c', `select 1 from pg_namespace where nspname = '${SCHEMA}'`]).out === '1';
const applied = new Set(
  schemaExists
    ? psql(['-tA', '-c', `select name from ${SCHEMA}.schema_migrations`], { allowFail: true })
        .out.split(/\r?\n/)
        .filter(Boolean)
    : [],
);
const pending = files.filter((name) => !applied.has(name));

console.log(`Esquema "${SCHEMA}": ${applied.size} de ${files.length} migraciones aplicadas, ${pending.length} pendientes.`);
if (statusOnly || pending.length === 0) {
  if (!statusOnly) console.log('Nada que aplicar.');
  process.exit(0);
}

psql([
  '-c',
  `create schema if not exists ${SCHEMA};
   create table if not exists ${SCHEMA}.schema_migrations (
     name text primary key,
     applied_at timestamptz not null default now()
   );`,
]);

const workDir = mkdtempSync(path.join(tmpdir(), 'agent-db-'));
try {
  for (const name of pending) {
    const file = path.join(workDir, name);
    writeFileSync(
      file,
      [
        `set search_path = ${SCHEMA}, public;`,
        retarget(readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')),
        `insert into ${SCHEMA}.schema_migrations (name) values ('${name}') on conflict do nothing;`,
        '',
      ].join('\n'),
    );
    const result = psql(['-o', process.platform === 'win32' ? 'NUL' : '/dev/null', '-f', file], { allowFail: true });
    if (!result.ok) {
      console.error(`\nFalló ${name}:\n${result.err.split(url).join('<url>').split(workDir).join('').slice(0, 1500)}`);
      console.error('\nLas migraciones anteriores quedaron aplicadas; corrige y vuelve a ejecutar.');
      process.exit(1);
    }
    console.log(`  aplicada ${name}`);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

// El agente entra con `service_role`, que salta RLS pero igual necesita
// permisos sobre un esquema que no es `public`. A `anon` y `authenticated` no
// se les da nada: estas tablas no son para el navegador.
psql([
  '-c',
  `do $$
   begin
     if exists (select 1 from pg_roles where rolname = 'service_role') then
       grant usage on schema ${SCHEMA} to service_role;
       grant all on all tables in schema ${SCHEMA} to service_role;
       grant all on all sequences in schema ${SCHEMA} to service_role;
       grant execute on all functions in schema ${SCHEMA} to service_role;
       alter default privileges in schema ${SCHEMA} grant all on tables to service_role;
       alter default privileges in schema ${SCHEMA} grant all on sequences to service_role;
       alter default privileges in schema ${SCHEMA} grant execute on functions to service_role;
     end if;
   end $$;`,
]);

// Exponer el esquema en la API (PostgREST). Se AÑADE a lo que ya haya.
const expose = psql(
  [
    '-c',
    `do $$
     declare
       actual text;
     begin
       if not exists (select 1 from pg_roles where rolname = 'authenticator') then
         return;
       end if;
       select split_part(cfg, '=', 2) into actual
         from pg_roles r, unnest(coalesce(r.rolconfig, '{}')) cfg
        where r.rolname = 'authenticator' and cfg like 'pgrst.db_schemas=%';
       actual := coalesce(nullif(actual, ''), 'public, graphql_public');
       if position('${SCHEMA}' in actual) = 0 then
         execute format('alter role authenticator set pgrst.db_schemas = %L', actual || ', ${SCHEMA}');
       end if;
       notify pgrst, 'reload config';
       notify pgrst, 'reload schema';
     end $$;`,
  ],
  { allowFail: true },
);

const tables = psql(['-tA', '-c', `select count(*) from information_schema.tables where table_schema = '${SCHEMA}' and table_type = 'BASE TABLE'`]).out;
console.log(`Listo: ${pending.length} migraciones aplicadas, ${tables} tablas en "${SCHEMA}".`);
if (!expose.ok) {
  console.log(`Aviso: no se pudo exponer el esquema por SQL. Añade "${SCHEMA}" en Supabase → Project Settings → Data API → Exposed schemas.`);
}
