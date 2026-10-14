-- Up Migration
--
-- Modo «sin POS»: el restaurante todavía no tiene pantallas de caja ni de
-- cocina, y el personal recibe los pedidos por Telegram.
--
-- `requires_cash_register = true` (el valor por defecto) deja todo como estaba:
-- sin caja abierta los pedidos quedan en revisión y no se puede confirmar un
-- cobro. En `false`, el horario decide si se toma el pedido, los cobros no
-- piden caja, y el personal recibe el pedido completo cuando queda firme.
--
-- `auto_complete_minutes`: sin pantalla nadie marca un pedido como entregado,
-- y quedaría «en curso» para siempre. Pasados esos minutos desde que quedó
-- firme, el backend lo cierra como entregado. NULL = no cerrar solo.
alter table operational_settings
  add column requires_cash_register boolean not null default true,
  add column auto_complete_minutes integer
    check (auto_complete_minutes is null or auto_complete_minutes between 10 and 1440);

-- Down Migration
alter table operational_settings
  drop column if exists requires_cash_register,
  drop column if exists auto_complete_minutes;
