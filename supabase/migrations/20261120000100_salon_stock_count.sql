-- =============================================================================
-- AMPLIFY AGENDA (12): counting the salon's stock, and what went missing
--
-- The inventory counts all products at once, blind: whoever counts does not see what should be
-- there. Each difference becomes a stock move ('count') and the count keeps its lines:
--   * a product for sale that is missing: sold without a ticket, taken, broken. The leak.
--   * a product for the salon's own use that is gone: what the salon consumed (its real cost).
-- Values at the purchase price. Owner and managers only.
-- =============================================================================

alter table public.agenda_stock_moves drop constraint if exists agenda_stock_moves_kind_check;
alter table public.agenda_stock_moves add constraint agenda_stock_moves_kind_check
  check (kind in ('sale', 'cancel', 'delivery', 'correction', 'start', 'count'));
alter table public.agenda_stock_moves add column if not exists count_id uuid;

create table if not exists public.agenda_stock_counts (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  counted_at        timestamptz not null default now(),
  lines             jsonb not null default '[]'::jsonb,
  missing_cents     bigint not null default 0,   -- products for sale missing, at purchase price
  extra_cents       bigint not null default 0,   -- products for sale found in excess
  used_cents        bigint not null default 0,   -- products for the salon's use consumed since the last count
  note              text check (length(note) <= 200),
  created_by        uuid default auth.uid(),
  unique (restaurant_id, id)
);
create index if not exists agenda_stock_counts_idx on public.agenda_stock_counts (restaurant_id, counted_at desc);
drop trigger if exists agenda_stock_counts_same_tenant on public.agenda_stock_counts;
create trigger agenda_stock_counts_same_tenant before update on public.agenda_stock_counts for each row execute function app.forbid_restaurant_change();
alter table public.agenda_stock_counts enable row level security;
revoke all on public.agenda_stock_counts from anon, authenticated;
grant select on public.agenda_stock_counts to authenticated;
drop policy if exists agenda_stock_counts_select on public.agenda_stock_counts;
create policy agenda_stock_counts_select on public.agenda_stock_counts for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

-- the count: p_lines [{product_id, counted}], only the products counted. Returns the result.
create or replace function public.agenda_stock_count(p_restaurant_id uuid, p_lines jsonb, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; l jsonb; pr public.agenda_products; n int; diff int; cid uuid; out jsonb := '[]'::jsonb;
        miss bigint := 0; extra bigint := 0; used bigint := 0; v bigint;
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 1000 then perform app.fail('invalid_request', 'lines'); end if;
  insert into public.agenda_stock_counts (restaurant_id, note) values (r.id, nullif(left(btrim(p_note), 200), '')) returning id into cid;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into pr from public.agenda_products where id = app.try_uuid(l ->> 'product_id') and restaurant_id = r.id for update;
    if pr.id is null then perform app.fail('invalid_request', 'product'); end if;
    n := (l ->> 'counted')::int;
    if n is null or n not between 0 and 1000000 then perform app.fail('invalid_request', 'counted'); end if;
    diff := n - pr.stock;
    v := diff::bigint * coalesce(pr.cost_cents, 0);
    if diff <> 0 then
      insert into public.agenda_stock_moves (restaurant_id, product_id, kind, qty, count_id, note)
      values (r.id, pr.id, 'count', diff, cid, 'Inventaire');
      if pr.kind = 'retail' then
        if diff < 0 then miss := miss - v; else extra := extra + v; end if;
      else used := used - v;
      end if;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('product_id', pr.id, 'name', pr.name, 'kind', pr.kind, 'expected', pr.stock,
                                    'counted', n, 'diff', diff, 'cost_cents', pr.cost_cents, 'value_cents', v));
  end loop;
  update public.agenda_stock_counts set lines = out, missing_cents = miss, extra_cents = extra, used_cents = greatest(0, used) where id = cid;
  return jsonb_build_object('id', cid, 'lines', out, 'missing_cents', miss, 'extra_cents', extra, 'used_cents', greatest(0, used));
end $$;
revoke all on function public.agenda_stock_count(uuid, jsonb, text) from public, anon;
grant execute on function public.agenda_stock_count(uuid, jsonb, text) to authenticated;

-- the overview of a period: per product what was sold, received, and what the counts found missing
create or replace function public.agenda_stock_report(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; f timestamptz; t timestamptz;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then perform app.fail('invalid_request', 'period'); end if;
  f := (p_from::timestamp at time zone r.timezone); t := ((p_to + 1)::timestamp at time zone r.timezone);
  return jsonb_build_object(
    'products', coalesce((select jsonb_agg(x order by x ->> 'name') from (
      select jsonb_build_object('product_id', p.id, 'name', p.name, 'kind', p.kind, 'cost_cents', p.cost_cents, 'price_cents', p.price_cents,
               'sold', coalesce(-sum(m.qty) filter (where m.kind in ('sale', 'cancel')), 0),
               'received', coalesce(sum(m.qty) filter (where m.kind = 'delivery'), 0),
               'count_diff', coalesce(sum(m.qty) filter (where m.kind in ('count', 'correction')), 0),
               'count_value_cents', coalesce(sum(m.qty) filter (where m.kind in ('count', 'correction')), 0) * coalesce(p.cost_cents, 0)) x
        from public.agenda_products p
        join public.agenda_stock_moves m on m.product_id = p.id and m.created_at >= f and m.created_at < t
       where p.restaurant_id = r.id
       group by p.id) s), '[]'::jsonb),
    'counts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'at', c.counted_at, 'missing_cents', c.missing_cents, 'extra_cents', c.extra_cents,
                         'used_cents', c.used_cents, 'note', c.note, 'lines', c.lines) order by c.counted_at desc)
       from public.agenda_stock_counts c where c.restaurant_id = r.id and c.counted_at >= f and c.counted_at < t), '[]'::jsonb));
end $$;
revoke all on function public.agenda_stock_report(uuid, date, date) from public, anon;
grant execute on function public.agenda_stock_report(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
