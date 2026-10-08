-- =============================================================================
-- Sales from before Amplify (imported from the old till, CSV or Excel)
-- They are kept apart from the fiscal tickets: never numbered, never in a Z report or the
-- accounting export. They serve to compare (this month against the same month last year) and
-- to see what sold best.
-- * sales_history_days: per day, revenue (TTC) and number of tickets if known.
-- * sales_history_items: per day and product, quantity and revenue (when the export has lines).
-- * import_sales(restaurant, days, items): replaces the imported figures of the days it contains.
--   A day that already has Amplify tickets is skipped (it would count twice).
-- * sales_history(restaurant): per month, imported revenue and Amplify revenue; the average day
--   before and with Amplify; the best sellers of the history (by quantity).
-- * sales_history_clear(restaurant): removes all imported figures (owner).
-- =============================================================================
create table if not exists public.sales_history_days (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day           date not null,
  revenue_cents bigint not null check (revenue_cents between 0 and 100000000000),
  tickets       integer check (tickets between 0 and 1000000),
  imported_at   timestamptz not null default now(),
  primary key (restaurant_id, day)
);
create table if not exists public.sales_history_items (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day           date not null,
  name          text not null check (length(btrim(name)) between 1 and 120),
  qty           numeric(14, 3) not null default 0,
  revenue_cents bigint not null default 0 check (revenue_cents between -100000000000 and 100000000000),
  primary key (restaurant_id, day, name)
);
alter table public.sales_history_days enable row level security;
alter table public.sales_history_items enable row level security;
grant select on public.sales_history_days, public.sales_history_items to authenticated;
drop policy if exists sales_history_days_select on public.sales_history_days;
drop policy if exists sales_history_items_select on public.sales_history_items;
create policy sales_history_days_select on public.sales_history_days for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
create policy sales_history_items_select on public.sales_history_items for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

create or replace function public.import_sales(p_restaurant_id uuid, p_days jsonb, p_items jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; d jsonb; x jsonb; dd date; done_days date[] := '{}'; skipped date[] := '{}'; n_items int := 0;
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) > 4000 then perform app.fail('invalid_request', 'days'); end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' or jsonb_array_length(coalesce(p_items, '[]')) > 60000 then perform app.fail('invalid_request', 'items'); end if;
  for d in select * from jsonb_array_elements(p_days) loop
    if (d ->> 'day') !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
    dd := (d ->> 'day')::date;
    if dd > app.business_date(r) or dd < date '2000-01-01' then continue; end if;
    if exists (select 1 from public.fiscal_documents where restaurant_id = r.id and business_date = dd) then
      skipped := skipped || dd; continue;
    end if;
    insert into public.sales_history_days (restaurant_id, day, revenue_cents, tickets)
    values (r.id, dd, greatest(0, round((d ->> 'revenue_cents')::numeric))::bigint, nullif(d ->> 'tickets', '')::numeric::int)
    on conflict (restaurant_id, day) do update set revenue_cents = excluded.revenue_cents, tickets = excluded.tickets, imported_at = now();
    delete from public.sales_history_items where restaurant_id = r.id and day = dd;
    done_days := done_days || dd;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    if (x ->> 'day') !~ '^\d{4}-\d{2}-\d{2}$' or not ((x ->> 'day')::date = any (done_days)) or nullif(btrim(x ->> 'name'), '') is null then continue; end if;
    insert into public.sales_history_items (restaurant_id, day, name, qty, revenue_cents)
    values (r.id, (x ->> 'day')::date, left(btrim(x ->> 'name'), 120), coalesce(nullif(x ->> 'qty', '')::numeric, 0), round(coalesce(nullif(x ->> 'revenue_cents', '')::numeric, 0))::bigint)
    on conflict (restaurant_id, day, name) do update set qty = public.sales_history_items.qty + excluded.qty, revenue_cents = public.sales_history_items.revenue_cents + excluded.revenue_cents;
    n_items := n_items + 1;
  end loop;
  return jsonb_build_object('days', cardinality(done_days), 'items', n_items, 'skipped', cardinality(skipped),
    'from', (select min(v) from unnest(done_days) v), 'to', (select max(v) from unnest(done_days) v));
end $$;

create or replace function public.sales_history(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  return jsonb_build_object(
    'months', (select coalesce(jsonb_agg(m order by m.month), '[]'::jsonb) from (
      select to_char(mo, 'YYYY-MM') as month,
             coalesce((select sum(revenue_cents) from public.sales_history_days h where h.restaurant_id = r.id and date_trunc('month', h.day) = mo), 0) history_cents,
             (select sum(tickets) from public.sales_history_days h where h.restaurant_id = r.id and date_trunc('month', h.day) = mo) history_tickets,
             coalesce((select sum(total_ttc_cents) from public.fiscal_documents f where f.restaurant_id = r.id and date_trunc('month', f.business_date) = mo), 0) amplify_cents,
             (select count(*) from public.sales_history_days h where h.restaurant_id = r.id and date_trunc('month', h.day) = mo) as days
        from generate_series(date_trunc('month', (select min(day) from public.sales_history_days where restaurant_id = r.id)),
                             date_trunc('month', app.business_date(r)), interval '1 month') mo
       where exists (select 1 from public.sales_history_days where restaurant_id = r.id)) m),
    'top', (select coalesce(jsonb_agg(t order by t.qty desc, t.revenue_cents desc), '[]'::jsonb) from (
      select name, sum(qty) qty, sum(revenue_cents) revenue_cents from public.sales_history_items where restaurant_id = r.id
       group by name order by sum(qty) desc, sum(revenue_cents) desc limit 10) t),
    'total_cents', (select coalesce(sum(revenue_cents), 0) from public.sales_history_days where restaurant_id = r.id),
    'tickets', (select sum(tickets) from public.sales_history_days where restaurant_id = r.id),
    'days', (select count(*) from public.sales_history_days where restaurant_id = r.id),
    'amplify', (select jsonb_build_object('days', count(distinct business_date), 'cents', coalesce(sum(total_ttc_cents), 0),
                       'tickets', count(*) filter (where doc_type <> 'credit_note'))
                  from public.fiscal_documents where restaurant_id = r.id),
    'from', (select min(day) from public.sales_history_days where restaurant_id = r.id),
    'to', (select max(day) from public.sales_history_days where restaurant_id = r.id));
end $$;

create or replace function public.sales_history_clear(p_restaurant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role(p_restaurant_id, 'owner', true);
  delete from public.sales_history_items where restaurant_id = p_restaurant_id;
  delete from public.sales_history_days where restaurant_id = p_restaurant_id;
end $$;

revoke all on function public.import_sales(uuid, jsonb, jsonb), public.sales_history(uuid), public.sales_history_clear(uuid) from public, anon;
grant execute on function public.import_sales(uuid, jsonb, jsonb), public.sales_history(uuid), public.sales_history_clear(uuid) to authenticated;
