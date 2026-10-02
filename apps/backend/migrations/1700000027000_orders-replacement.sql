-- Up Migration
-- Relación explícita entre un pedido nuevo y el pedido que sustituyó.
-- Un pedido viejo solo puede ser reemplazado una vez.

alter table orders
  add column replaces_order_id uuid references orders(id) on delete restrict;

create unique index uq_orders_replaces_order_id
  on orders (replaces_order_id)
  where replaces_order_id is not null;

-- Down Migration
drop index if exists uq_orders_replaces_order_id;
alter table orders drop column if exists replaces_order_id;
