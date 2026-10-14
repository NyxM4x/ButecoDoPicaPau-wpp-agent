-- ============================================================================
-- 0040_retira_carta_de_la_demo.sql
--
-- Retira de las tablas propias del agente la carta de la demo con la que nació
-- (0017, 0030 y el seed). El agente atiende ahora otro restaurante, y su
-- catálogo es el del POS: `menu_items` ya no se lee con el POS conectado.
--
-- ── Por qué una migración nueva y no editar las viejas ──────────────────────
--
-- Las migraciones viejas son historia: hay bases donde ya corrieron, y varias
-- pruebas leen su SQL. Esta corre después y deja el mismo resultado en una base
-- nueva y en una que ya tenía la carta.
--
-- ── Borrar, salvo lo que ya tiene historia ──────────────────────────────────
--
-- `order_items` y `promotion_items` apuntan a `menu_items` con ON DELETE
-- RESTRICT: un producto que ya se vendió o que forma parte de un combo no se
-- puede borrar sin romper ese histórico. Esos quedan apagados; el resto se
-- borra. En una base nueva no hay pedidos, así que se borran todos.
-- ============================================================================

begin;

create temporary table demo_codes (code text primary key) on commit drop;
insert into demo_codes (code) values
  ('trancaburguer'), ('trancapecho'), ('salchiburguer'), ('hamburguesa'),
  ('lomito'), ('salchipapa'), ('gaseosa_2l'), ('gaseosa_personal'),
  ('gaseosa_pequena'), ('porcion_papas'), ('soda_peque'), ('soda_mini'),
  ('vaso_maracuya'), ('vaso_limonada'), ('vaso_lima'), ('vaso_pina'),
  ('la_fija'), ('doble_o_nada'), ('hat_trick'), ('lomito_jackpot'), ('tocino');

-- Primero, apagados todos: invisibles en el menú y para el agente.
update public.menu_items
   set is_active = false
 where code in (select code from demo_codes);

-- Después, borrados los que no tienen pedidos ni combos que los nombren.
delete from public.menu_items mi
 where mi.code in (select code from demo_codes)
   and not exists (select 1 from public.order_items oi where oi.menu_item_id = mi.id)
   and not exists (select 1 from public.promotion_items pi where pi.menu_item_id = mi.id);

commit;
