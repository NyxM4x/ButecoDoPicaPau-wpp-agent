-- Up Migration
--
-- La migración 18 activó RLS en las tablas que existían entonces. Las que se
-- crearon después (`cash_register_sessions`, `bank_qr_charges`) quedaron sin
-- RLS, y Supabase les da permisos a `anon` y `authenticated` por defecto: con
-- la anon key cualquiera podía leerlas y escribirlas por la API REST.
-- Mismo criterio que la 18 (acceso total solo para el rol del backend), pero
-- solo sobre las tablas que aún no tienen RLS, para no tocar las demás.
do $$
declare
  tbl text;
begin
  for tbl in
    select tablename from pg_tables where schemaname = 'public' and not rowsecurity
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists backend_full_access on public.%I', tbl);
    execute format(
      'create policy backend_full_access on public.%I for all to current_user using (true) with check (true)',
      tbl
    );
  end loop;
end $$;

-- Down Migration
alter table if exists public.cash_register_sessions disable row level security;
drop policy if exists backend_full_access on public.cash_register_sessions;
alter table if exists public.bank_qr_charges disable row level security;
drop policy if exists backend_full_access on public.bank_qr_charges;
