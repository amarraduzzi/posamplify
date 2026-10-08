-- =============================================================================
-- Courses and kitchen stations
-- * categories.course: 1 starter, 2 main, 3 dessert (null = sent right away, e.g. drinks).
-- * order_lines.course / held: a later course is saved on the bill but held back; the till
--   sends it with "Envoyer la suite". The kitchen sees what is coming.
-- * order_lines.served_at: the pass marks a ready dish as taken to the table.
-- * Stations are free (grill, pizza, dessert...): their names and printers live in
--   restaurants.pos_settings (stations: [{key, name}], printers.stations: {key: printer}).
-- =============================================================================
alter table public.categories add column if not exists course smallint check (course between 1 and 3);
alter table public.order_lines
  add column if not exists course smallint check (course between 1 and 3),
  add column if not exists held boolean not null default false,
  add column if not exists served_at timestamptz;
-- a held line has not been sent yet
alter table public.order_lines drop constraint if exists order_lines_held_unsent;
alter table public.order_lines add constraint order_lines_held_unsent check (not held or kitchen_sent_at is null);
create index if not exists order_lines_held_idx on public.order_lines (order_id) where held;

-- owner_live: "today" follows the business day (after midnight it is still yesterday's service)
create or replace function public.owner_live(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; today date; last_week date;
begin
  perform app.require_role(p_restaurant_id, 'manager', false);
  select * into r from public.restaurants where id = p_restaurant_id;
  -- the business day (it ends at the restaurant's cut-off hour, not at midnight)
  today := app.business_date(r);
  last_week := today - 7;
  return jsonb_build_object(
    'today', today,
    'revenue_cents', (select coalesce(sum(total_ttc_cents), 0) from public.fiscal_documents where restaurant_id = r.id and business_date = today),
    'tickets', (select count(*) from public.fiscal_documents where restaurant_id = r.id and business_date = today and doc_type <> 'credit_note'),
    'last_week_same_time_cents', (select coalesce(sum(total_ttc_cents), 0) from public.fiscal_documents
                                   where restaurant_id = r.id and business_date = last_week and issued_at <= now() - interval '7 days'),
    'last_week_total_cents', (select coalesce(sum(total_ttc_cents), 0) from public.fiscal_documents where restaurant_id = r.id and business_date = last_week),
    'open_orders', (select count(*) from public.orders where restaurant_id = r.id and closed_at is null and status <> 'cancelled' and total_cents > 0),
    'open_cents', (select coalesce(sum(total_cents), 0) from public.orders where restaurant_id = r.id and closed_at is null and status <> 'cancelled'),
    'tables_busy', (select count(distinct table_id) from public.orders where restaurant_id = r.id and closed_at is null and status <> 'cancelled' and table_id is not null),
    'guests_waiting', (select count(*) from public.orders where restaurant_id = r.id and source = 'qr' and status = 'new' and closed_at is null),
    'day_closed', exists (select 1 from public.day_closures where restaurant_id = r.id and business_date = today),
    'on_duty', (select coalesce(jsonb_agg(jsonb_build_object('name', st.name, 'since', h.clock_in) order by h.clock_in), '[]'::jsonb)
                  from public.staff_shifts h join public.staff st on st.id = h.staff_id
                 where h.restaurant_id = r.id and h.clock_out is null and now() - h.clock_in <= interval '16 hours'),
    'payments', (select coalesce(jsonb_object_agg(m, a), '{}'::jsonb) from (
                   select p ->> 'method' m, sum((p ->> 'amount')::bigint) a from public.fiscal_documents f, jsonb_array_elements(f.payments) p
                    where f.restaurant_id = r.id and f.business_date = today group by 1) x),
    'last_sales', (select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) from (
                     select f.issued_at at, f.total_ttc_cents total, st.name staff from public.fiscal_documents f left join public.staff st on st.id = f.staff_id
                      where f.restaurant_id = r.id and f.business_date = today and f.doc_type <> 'credit_note' order by f.issued_at desc limit 8) x),
    'alerts', (select coalesce(jsonb_agg(a order by a.at desc), '[]'::jsonb) from (
        -- discounts of 20 % or more, or 100 DH or more
        select 'discount' kind, o.closed_at at, o.discount_cents amount, st.name staff, o.ticket_number::text ref
          from public.orders o left join public.staff st on st.id = coalesce(o.discount_by_staff_id, o.staff_id)
         where o.restaurant_id = r.id and o.business_date = today and o.discount_cents > 0 and o.discount_kind is null
           and (o.discount_cents >= 10000 or o.discount_cents * 5 >= o.subtotal_cents)
        union all
        -- cancelled orders that had reached the kitchen
        select 'cancel', o.updated_at, o.subtotal_cents, st.name, o.ticket_number::text
          from public.orders o left join public.staff st on st.id = o.staff_id
         where o.restaurant_id = r.id and o.business_date = today and o.status = 'cancelled'
           and exists (select 1 from public.audit_log a where a.restaurant_id = r.id and a.table_name = 'order_lines' and a.action = 'delete'
                         and a.changes ->> 'order_id' = o.id::text and a.changes ->> 'kitchen_sent_at' is not null)
        union all
        -- dishes removed after the kitchen
        select 'removed', a.created_at, (a.changes ->> 'line_total_cents')::bigint, st.name, a.changes ->> 'name'
          from public.audit_log a left join public.staff st on st.id = (a.changes ->> 'staff_id')::uuid
         where a.restaurant_id = r.id and a.table_name = 'order_lines' and a.action = 'delete' and a.changes ->> 'kitchen_sent_at' is not null
           and app.business_date(r, a.created_at) = today
           and not exists (select 1 from public.orders o where o.id::text = a.changes ->> 'order_id' and o.status = 'cancelled')
        union all
        -- cash taken out of the drawer
        select 'payout', c.created_at, c.amount_cents, st.name, c.reason
          from public.cash_movements c left join public.staff st on st.id = c.staff_id
         where c.restaurant_id = r.id and c.business_date = today and c.kind = 'payout'
        union all
        -- yesterday's cash count
        select 'cash_gap', d.closed_at, d.cash_diff_cents, st.name, d.business_date::text
          from public.day_closures d left join public.staff st on st.id = d.closed_by_staff_id
         where d.restaurant_id = r.id and d.business_date >= today - 1 and abs(coalesce(d.cash_diff_cents, 0)) > 1000
        union all
        -- stock at or below its minimum
        select 'stock', now(), null, null, i.name
          from public.ingredients i
         where i.restaurant_id = r.id and i.stock_qty is not null and i.stock_min is not null and i.stock_qty <= i.stock_min
        union all
        select 'paused', now(), null, null, r.online ->> 'paused_until'
         where coalesce((r.online ->> 'paused_until')::timestamptz > now(), false)
      ) a)
  );
end $$;
