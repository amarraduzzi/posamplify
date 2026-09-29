-- =============================================================================
-- 0005 ROW LEVEL SECURITY + PRIVILEGES
-- =============================================================================
-- Two layers:
--   1. Table privileges: what an API role may do at all (Supabase grants
--      everything by default, we take that back and grant precisely).
--   2. RLS policies: which ROWS. Always scoped by restaurant_id.
--
-- anon (QR guests) gets NO table access at all. Guests only use the public
-- functions get_menu / place_order / get_order_status, which return exactly
-- what a guest may see.
-- =============================================================================

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- Every table in public gets RLS. A test checks that no table is ever missed.
alter table public.restaurants        enable row level security;
alter table public.platform_admins    enable row level security;
alter table public.memberships        enable row level security;
alter table public.staff              enable row level security;
alter table public.dining_tables      enable row level security;
alter table public.categories         enable row level security;
alter table public.menu_items         enable row level security;
alter table public.item_variants      enable row level security;
alter table public.orders             enable row level security;
alter table public.order_lines        enable row level security;
alter table public.payments           enable row level security;
alter table public.cash_movements     enable row level security;
alter table public.day_closures       enable row level security;
alter table public.fiscal_documents   enable row level security;
alter table public.fiscal_submissions enable row level security;
alter table public.audit_log          enable row level security;
alter table app.counters              enable row level security;
alter table app.staff_pins            enable row level security;

-- -----------------------------------------------------------------------------
-- restaurants: members read, owner edits profile/branding (not status/billing)
-- -----------------------------------------------------------------------------
grant select on public.restaurants to authenticated;
grant update (
  name, timezone, languages, day_cutoff_hour, branding, opening_hours,
  accept_dine_in, accept_takeaway, accept_delivery,
  legal_name, ice, tax_id, rc, address, city, phone, default_vat_bp
) on public.restaurants to authenticated;

create policy restaurants_select on public.restaurants for select to authenticated
  using (id = any ((select app.my_restaurants('device'))::uuid[]));
create policy restaurants_update on public.restaurants for update to authenticated
  using (id = any ((select app.my_writable_restaurants('owner'))::uuid[]))
  with check (id = any ((select app.my_writable_restaurants('owner'))::uuid[]));

-- -----------------------------------------------------------------------------
-- platform_admins / memberships: read only for clients, managed via admin functions
-- -----------------------------------------------------------------------------
grant select on public.platform_admins to authenticated;
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.memberships to authenticated;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid())
         or restaurant_id = any ((select app.my_restaurants('owner'))::uuid[]));

-- -----------------------------------------------------------------------------
-- Read for every member (device and up), write for managers and owners.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.staff         to authenticated;
grant select, insert, update, delete on public.dining_tables to authenticated;
grant select, insert, update, delete on public.categories    to authenticated;
grant select, insert, update, delete on public.menu_items    to authenticated;
grant select, insert, update, delete on public.item_variants to authenticated;

do $$
declare t text;
begin
  foreach t in array array['staff', 'dining_tables', 'categories', 'menu_items', 'item_variants'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
        with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
    $f$, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Sales: the till (device) reads and writes, triggers guard the lifecycle.
-- -----------------------------------------------------------------------------
grant select, insert, update         on public.orders         to authenticated;
grant select, insert, update, delete on public.order_lines    to authenticated;
grant select, insert, delete         on public.payments       to authenticated;
grant select, insert                 on public.cash_movements to authenticated;

create policy orders_select on public.orders for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy orders_insert on public.orders for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));
create policy orders_update on public.orders for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));

create policy order_lines_select on public.order_lines for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy order_lines_insert on public.order_lines for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));
create policy order_lines_update on public.order_lines for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));
create policy order_lines_delete on public.order_lines for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));

create policy payments_select on public.payments for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy payments_insert on public.payments for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));
create policy payments_delete on public.payments for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));

create policy cash_movements_select on public.cash_movements for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy cash_movements_insert on public.cash_movements for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));

-- -----------------------------------------------------------------------------
-- Read only for clients: written exclusively by server functions / triggers.
-- -----------------------------------------------------------------------------
grant select on public.day_closures       to authenticated;
grant select on public.fiscal_documents   to authenticated;
grant select on public.fiscal_submissions to authenticated;
grant select on public.audit_log          to authenticated;

create policy day_closures_select on public.day_closures for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy fiscal_documents_select on public.fiscal_documents for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy fiscal_submissions_select on public.fiscal_submissions for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
create policy audit_log_select on public.audit_log for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
