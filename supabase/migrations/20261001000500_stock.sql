-- =============================================================================
-- 0018 AMPLIFY PROFIT: inventory (stock counts, purchases, variance)
-- =============================================================================
-- The owner counts his stock (phone in hand, in the units he buys: kg, litre,
-- caisse...) at the end of a day, and notes what he buys in between.
--
--   used = opening count + purchases - closing count        (always)
--   with Amplify POS also:  what the sales say should be gone (recipe cards x
--   dishes sold), and the gap = used - sold. The gap is waste, free food or
--   theft, per ingredient and in dirhams.
--
-- A count on day D is the stock at the END of day D: purchases and sales of
-- the days after the first count, up to and including the day of the second.
-- Quantities in the ingredient's base unit (g, ml, pc). Managers/owners only.
-- =============================================================================

create table public.stock_counts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  counted_on    date not null,
  status        text not null default 'open' check (status in ('open', 'closed')),
  note          text check (length(note) <= 200),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  closed_at     timestamptz,
  unique (restaurant_id, id)
);
create index stock_counts_idx on public.stock_counts (restaurant_id, counted_on desc);
create trigger stock_counts_same_tenant before update on public.stock_counts
  for each row execute function app.forbid_restaurant_change();

create table public.stock_count_lines (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  count_id      uuid not null,
  ingredient_id uuid not null,
  qty           numeric(14, 3) not null check (qty >= 0 and qty < 1000000000),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (count_id, ingredient_id),
  foreign key (restaurant_id, count_id) references public.stock_counts (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete cascade
);
create index stock_count_lines_idx on public.stock_count_lines (restaurant_id, count_id);
create trigger stock_count_lines_touch before update on public.stock_count_lines
  for each row execute function app.touch_updated_at();
create trigger stock_count_lines_same_tenant before update on public.stock_count_lines
  for each row execute function app.forbid_restaurant_change();

create table public.stock_purchases (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  ingredient_id uuid not null,
  purchased_on  date not null,
  qty           numeric(14, 3) not null check (qty > 0 and qty < 1000000000),
  total_cents   bigint check (total_cents between 0 and 10000000000),   -- what was paid, if known
  supplier      text check (length(supplier) <= 80),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete cascade
);
create index stock_purchases_idx on public.stock_purchases (restaurant_id, purchased_on desc);
create trigger stock_purchases_same_tenant before update on public.stock_purchases
  for each row execute function app.forbid_restaurant_change();

-- a closed count is final (reopen it first to change it). Only for direct
-- changes: deleting an ingredient or a whole restaurant still cascades.
create or replace function app.stock_line_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  select status into st from public.stock_counts
   where id = coalesce(new.count_id, old.count_id) and restaurant_id = coalesce(new.restaurant_id, old.restaurant_id);
  if st = 'closed' then
    raise exception 'count closed' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
create trigger stock_count_lines_guard before insert or update or delete on public.stock_count_lines
  for each row execute function app.stock_line_guard();

-- a purchase with a price is the newest real price of that ingredient
create or replace function app.stock_purchase_price()
returns trigger language plpgsql security definer set search_path = '' as $$
declare g public.ingredients;
begin
  if new.total_cents is null or new.total_cents = 0 then return null; end if;
  -- an older purchase typed later must not overwrite a newer price
  if exists (select 1 from public.stock_purchases p
              where p.restaurant_id = new.restaurant_id and p.ingredient_id = new.ingredient_id and p.id <> new.id
                and p.total_cents > 0 and p.purchased_on > new.purchased_on) then
    return null;
  end if;
  select * into g from public.ingredients where restaurant_id = new.restaurant_id and id = new.ingredient_id;
  perform set_config('app.price_source', 'invoice', true);
  update public.ingredients
     set purchase_price_cents = least(100000000, round(new.total_cents * g.purchase_qty / new.qty))::bigint
   where restaurant_id = new.restaurant_id and id = new.ingredient_id;
  perform set_config('app.price_source', '', true);
  return null;
end $$;
create trigger stock_purchases_price after insert on public.stock_purchases
  for each row execute function app.stock_purchase_price();

alter table public.stock_counts      enable row level security;
alter table public.stock_count_lines enable row level security;
alter table public.stock_purchases   enable row level security;
grant select, insert, update, delete on public.stock_counts      to authenticated;
grant select, insert, update, delete on public.stock_count_lines to authenticated;
grant select, insert, update, delete on public.stock_purchases   to authenticated;
do $$
declare t text;
begin
  foreach t in array array['stock_counts', 'stock_count_lines', 'stock_purchases'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
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
create trigger audit_stock_counts after insert or update or delete on public.stock_counts
  for each row execute function app.audit();
create trigger audit_stock_purchases after insert or update or delete on public.stock_purchases
  for each row execute function app.audit();

-- ------------------------------------------------------------ the report
-- Between two closed counts (any order). Per ingredient counted in both:
-- opening, purchases, closing, used, and with the till: sold (theoretical) and gap.
create or replace function public.stock_report(p_restaurant_id uuid, p_from uuid, p_to uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r        public.restaurants;
  a        public.stock_counts;
  b        public.stock_counts;
  x        public.stock_counts;
  uses_pos boolean;
  rev_ht   bigint;
  items    jsonb;
  totals   jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  select * into a from public.stock_counts where restaurant_id = r.id and id = p_from;
  select * into b from public.stock_counts where restaurant_id = r.id and id = p_to;
  if a.id is null or b.id is null then raise exception 'unknown count' using errcode = '22023'; end if;
  if a.status <> 'closed' or b.status <> 'closed' then raise exception 'count not closed' using errcode = '22023'; end if;
  if a.counted_on > b.counted_on then x := a; a := b; b := x; end if;
  if a.counted_on = b.counted_on then raise exception 'same day' using errcode = '22023'; end if;
  uses_pos := 'pos' = any (r.products);

  select coalesce(sum(total_ht_cents), 0) into rev_ht
    from public.fiscal_documents where restaurant_id = r.id and business_date > a.counted_on and business_date <= b.counted_on;

  with
  o as (select ingredient_id, qty from public.stock_count_lines where restaurant_id = r.id and count_id = a.id),
  c as (select ingredient_id, qty from public.stock_count_lines where restaurant_id = r.id and count_id = b.id),
  buy as (
    select ingredient_id, sum(qty) qty, sum(total_cents) spent
      from public.stock_purchases
     where restaurant_id = r.id and purchased_on > a.counted_on and purchased_on <= b.counted_on
     group by 1),
  sold as (
    select l.menu_item_id, l.variant_id, sum(l.quantity) qty
      from public.order_lines l
      join public.orders od on od.restaurant_id = l.restaurant_id and od.id = l.order_id
     where l.restaurant_id = r.id and od.closed_at is not null and od.status <> 'cancelled'
       and od.business_date > a.counted_on and od.business_date <= b.counted_on and l.menu_item_id is not null
     group by 1, 2),
  -- recipe quantities are what ends up on the plate: add the waste back (peel, bones)
  theo as (
    select rl.ingredient_id, sum(s.qty * rl.qty / (1 - g.waste_bp / 10000.0)) qty
      from sold s
      join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = s.menu_item_id
                                 and (rl.variant_id is null or rl.variant_id = s.variant_id)
      join public.ingredients g on g.restaurant_id = r.id and g.id = rl.ingredient_id
     group by 1),
  base as (
    select g.id, g.name, g.name_ar, g.category, g.base_unit, g.purchase_unit, g.purchase_qty,
           case when g.purchase_price_cents is not null then g.purchase_price_cents::numeric / g.purchase_qty end unit_cost,
           o.qty opening, c.qty closing, coalesce(buy.qty, 0) bought, buy.spent,
           case when uses_pos then coalesce(theo.qty, 0) end theo
      from public.ingredients g
      left join o on o.ingredient_id = g.id
      left join c on c.ingredient_id = g.id
      left join buy on buy.ingredient_id = g.id
      left join theo on theo.ingredient_id = g.id
     where g.restaurant_id = r.id
       and (o.qty is not null or c.qty is not null or buy.qty is not null or theo.qty is not null)),
  calc as (
    select *, (opening is not null and closing is not null) counted,
           case when opening is not null and closing is not null then opening + bought - closing end used
      from base),
  val as (
    select *, case when used is not null and theo is not null then used - theo end gap,
           round(used * unit_cost)::bigint used_cents,
           round(theo * unit_cost)::bigint theo_cents,
           round((used - theo) * unit_cost)::bigint gap_cents
      from calc)
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', id, 'name', name, 'name_ar', name_ar, 'category', category, 'base_unit', base_unit,
      'purchase_unit', purchase_unit, 'purchase_qty', purchase_qty, 'priced', unit_cost is not null,
      'counted', counted, 'opening', opening, 'bought', bought, 'closing', closing, 'used', used,
      'theoretical', theo, 'gap', gap,
      'used_cents', used_cents, 'theoretical_cents', theo_cents, 'gap_cents', gap_cents,
      -- more came out of the counts than went in: a purchase was not noted, or a count is wrong
      'negative', coalesce(used < 0, false)
    ) order by counted desc, coalesce(abs(gap_cents), 0) desc, coalesce(used_cents, 0) desc, name), '[]'::jsonb),
    jsonb_build_object(
      'used_cents', coalesce(sum(used_cents) filter (where counted), 0),
      'theoretical_cents', case when uses_pos then coalesce(sum(theo_cents) filter (where counted), 0) end,
      'gap_cents', case when uses_pos then coalesce(sum(gap_cents) filter (where counted and gap_cents > 0), 0) end,
      'surplus_cents', case when uses_pos then coalesce(-sum(gap_cents) filter (where counted and gap_cents < 0), 0) end,
      'purchases_cents', coalesce(sum(spent), 0),
      'counted', count(*) filter (where counted),
      'not_counted', count(*) filter (where not counted),
      'unpriced', count(*) filter (where counted and unit_cost is null),
      'negative', count(*) filter (where used < 0))
    into items, totals
    from val;

  return jsonb_build_object(
    'from', jsonb_build_object('id', a.id, 'counted_on', a.counted_on),
    'to', jsonb_build_object('id', b.id, 'counted_on', b.counted_on),
    'days', b.counted_on - a.counted_on,
    'uses_pos', uses_pos,
    'revenue_ht_cents', case when uses_pos then rev_ht end,
    -- real food cost of the period: what was really used / what was sold (excl. VAT)
    'real_food_cost_bp', case when uses_pos and rev_ht > 0 then round((totals ->> 'used_cents')::numeric * 10000 / rev_ht)::int end,
    'totals', totals,
    'items', items);
end $$;
revoke all on function public.stock_report(uuid, uuid, uuid) from public, anon;
grant execute on function public.stock_report(uuid, uuid, uuid) to authenticated;
