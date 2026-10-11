-- Up Migration
-- Nombre comercial del local: lo muestran el POS y el ticket, y cambia al
-- cargar otro perfil de demo.
alter table operational_settings
  add column restaurant_name text not null default 'Restaurante';

-- Down Migration
alter table operational_settings
  drop column if exists restaurant_name;
