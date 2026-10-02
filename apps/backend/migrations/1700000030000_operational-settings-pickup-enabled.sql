-- Up Migration
-- Regla autoritativa de negocio: habilitar/deshabilitar recojo en local.
alter table operational_settings
  add column pickup_enabled boolean not null default false;

-- Down Migration
alter table operational_settings
  drop column if exists pickup_enabled;
