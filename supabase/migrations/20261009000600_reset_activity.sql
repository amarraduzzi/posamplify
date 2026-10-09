-- =============================================================================
-- Start fresh before going live (platform admins only)
-- admin_reset_activity(restaurant, typed slug): removes everything a restaurant did while it was
-- being set up and tested, and keeps everything it is made of.
-- Removed: orders, lines, payments, fiscal tickets and credit notes (numbering starts again at 1),
--   Z reports, cash movements, tips paid out, stock moves, counts, purchases, purchase orders,
--   supplier entries, loyalty and account movements, reservations, clock-ins.
-- Kept: menu, sizes, options, recipes, ingredients and their prices, suppliers, tables, staff,
--   tills, promotions, customers (points, visits, spending and balance back to 0), website,
--   imported sales of the old till, settings.
-- The live stock goes back to "not counted": the first count (opening inventory) starts it.
-- Dishes switched off by the stock come back. One line in the audit log says who did it.
-- Meant for the switch from testing to real service. Once real tickets exist, they must be kept
-- (10 years): use this only before the restaurant takes real money.
-- =============================================================================
create or replace function public.admin_reset_activity(p_restaurant_id uuid, p_confirm_slug text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; n jsonb;
begin
  perform app.require_platform_admin();
  select * into r from public.restaurants where id = p_restaurant_id for update;
  if r.id is null then perform app.fail('not_found'); end if;
  if lower(btrim(coalesce(p_confirm_slug, ''))) <> r.slug then perform app.fail('confirm_slug_mismatch'); end if;

  n := jsonb_build_object(
    'orders', (select count(*) from public.orders where restaurant_id = r.id),
    'tickets', (select count(*) from public.fiscal_documents where restaurant_id = r.id),
    'stock_moves', (select count(*) from public.stock_moves where restaurant_id = r.id),
    'purchases', (select count(*) from public.stock_purchases where restaurant_id = r.id));

  perform set_config('app.purge', 'on', true);
  -- purchases first: their removal writes stock moves, which go right after
  delete from public.stock_purchases where restaurant_id = r.id;
  delete from public.purchase_order_lines where restaurant_id = r.id;
  delete from public.purchase_orders where restaurant_id = r.id;
  delete from public.supplier_entries where restaurant_id = r.id;
  delete from public.stock_count_lines where restaurant_id = r.id;
  delete from public.stock_counts where restaurant_id = r.id;
  delete from public.stock_moves where restaurant_id = r.id;
  -- sales
  delete from public.fiscal_submissions where restaurant_id = r.id;
  delete from public.payments where restaurant_id = r.id;
  delete from public.order_lines where restaurant_id = r.id;
  -- orders and tickets point at each other: one statement removes both
  with t as (delete from public.fiscal_documents where restaurant_id = r.id returning 1)
  delete from public.orders where restaurant_id = r.id;
  delete from public.day_closures where restaurant_id = r.id;
  delete from public.cash_movements where restaurant_id = r.id;
  delete from public.tip_payouts where restaurant_id = r.id;
  -- customers stay, their counters go back to 0
  delete from public.loyalty_ledger where restaurant_id = r.id;
  delete from public.customer_account_ledger where restaurant_id = r.id;
  perform set_config('app.loyalty_internal', 'on', true);
  update public.customers set points = 0, visits = 0, spent_cents = 0, balance_cents = 0, last_visit_at = null
   where restaurant_id = r.id;
  perform set_config('app.loyalty_internal', '', true);
  -- bookings and clock-ins of the test period
  delete from public.reservations where restaurant_id = r.id;
  delete from public.staff_shifts where restaurant_id = r.id;
  -- the live stock: not counted yet; dishes hidden by the stock come back
  update public.ingredients set stock_qty = null, stock_since = null, stock_updated_at = null where restaurant_id = r.id;
  update public.menu_items set available = true, sold_out_by_stock = false where restaurant_id = r.id and sold_out_by_stock;
  perform set_config('app.purge', 'off', true);

  insert into public.audit_log (restaurant_id, table_name, row_id, action, actor_user_id, changes)
  values (r.id, 'restaurants', r.id::text, 'delete', auth.uid(), jsonb_build_object('reset_activity', n));
  return n || jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_reset_activity(uuid, text) from public, anon;
grant execute on function public.admin_reset_activity(uuid, text) to authenticated;
