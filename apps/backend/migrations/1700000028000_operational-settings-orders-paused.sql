-- Up Migration
-- Pausa operativa para nuevos pedidos por saturación.
alter table operational_settings
  add column orders_paused boolean not null default false;

-- Down Migration
alter table operational_settings
  drop column if exists orders_paused;
