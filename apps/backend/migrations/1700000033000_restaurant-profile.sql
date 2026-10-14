-- Up Migration
--
-- Perfil del restaurante: lo que el agente de WhatsApp necesita saber del local
-- y que hasta ahora estaba escrito a mano en su código (nombre, descripción,
-- dirección, idioma, moneda, formas de pago, mensajes propios). Lo expone
-- `GET /restaurant/profile` (ver docs/pos-contract.md).
--
-- Va en `operational_settings` porque esa fila única ya ES el restaurante de
-- este backend. Los valores por defecto dejan todo como estaba: español de
-- Bolivia, bolivianos, envío activo y los dos pagos que ya se ofrecían.
alter table operational_settings
  add column restaurant_description text,
  add column restaurant_phone text,
  add column restaurant_address text,
  add column restaurant_maps_url text,
  add column restaurant_timezone text not null default 'America/La_Paz',
  add column restaurant_locale text not null default 'es-BO',
  add column currency_code text not null default 'BOB',
  add column currency_symbol text not null default 'Bs',
  add column hours_text text,
  add column delivery_enabled boolean not null default true,
  add column enabled_payment_methods text[] not null default '{cash,qr}',
  add column greeting_message text,
  add column farewell_message text,
  add column menu_video_url text,
  add column menu_image_url text;

alter table operational_settings
  add constraint operational_settings_payment_methods_known
  check (enabled_payment_methods <@ array['cash', 'qr', 'card']::text[]);

-- Down Migration
alter table operational_settings
  drop constraint if exists operational_settings_payment_methods_known;

alter table operational_settings
  drop column if exists restaurant_description,
  drop column if exists restaurant_phone,
  drop column if exists restaurant_address,
  drop column if exists restaurant_maps_url,
  drop column if exists restaurant_timezone,
  drop column if exists restaurant_locale,
  drop column if exists currency_code,
  drop column if exists currency_symbol,
  drop column if exists hours_text,
  drop column if exists delivery_enabled,
  drop column if exists enabled_payment_methods,
  drop column if exists greeting_message,
  drop column if exists farewell_message,
  drop column if exists menu_video_url,
  drop column if exists menu_image_url;
