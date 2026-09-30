-- =============================================================================
-- 0016 AMPLIFY PROFIT: fixed costs, monthly result and break-even
-- =============================================================================
-- The owner enters his fixed costs once (rent, salaries, electricity...).
-- Each month: revenue (from Amplify POS, or one number typed from his Z-reports),
-- purchases of goods (typed; otherwise estimated from the recipe cards),
-- fixed costs  ->  result of the month and the revenue needed per day to break even.
-- Everything computed here. Managers and owners only.
-- =============================================================================

create table public.fixed_costs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 80),
  category      text not null default 'autre' check (category in
                  ('loyer', 'salaires', 'charges_sociales', 'energie', 'eau', 'telecom', 'assurance',
                   'credit', 'comptable', 'marketing', 'entretien', 'logiciels', 'impots', 'autre')),
  amount_cents  bigint not null check (amount_cents between 0 and 10000000000),
  -- how often it is paid; the monthly amount is derived (year / 12, week x 52 / 12)
  frequency     text not null default 'month' check (frequency in ('month', 'year', 'week')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, id)
);
create index fixed_costs_idx on public.fixed_costs (restaurant_id, category);
create trigger fixed_costs_touch before update on public.fixed_costs
  for each row execute function app.touch_updated_at();
create trigger fixed_costs_same_tenant before update on public.fixed_costs
  for each row execute function app.forbid_restaurant_change();

-- what the owner types per month: revenue (only without Amplify POS) and purchases of goods
create table public.month_figures (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  month            date not null check (extract(day from month) = 1),
  revenue_ttc_cents bigint check (revenue_ttc_cents between 0 and 100000000000),
  purchases_cents  bigint check (purchases_cents between 0 and 100000000000),
  updated_at       timestamptz not null default now(),
  unique (restaurant_id, month),
  unique (restaurant_id, id)
);
create trigger month_figures_touch before update on public.month_figures
  for each row execute function app.touch_updated_at();
create trigger month_figures_same_tenant before update on public.month_figures
  for each row execute function app.forbid_restaurant_change();

alter table public.fixed_costs   enable row level security;
alter table public.month_figures enable row level security;
grant select, insert, update, delete on public.fixed_costs   to authenticated;
grant select, insert, update, delete on public.month_figures to authenticated;
do $$
declare t text;
begin
  foreach t in array array['fixed_costs', 'month_figures'] loop
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
create trigger audit_fixed_costs after insert or update or delete on public.fixed_costs
  for each row execute function app.audit();

-- ------------------------------------------------------------ the month
-- p_month: any day of the month (default: the current one).
create or replace function public.profit_month(p_restaurant_id uuid, p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r          public.restaurants;
  today      date;
  m          date;
  m_end      date;
  uses_pos   boolean;
  days_open  int;
  target     int;
  f          public.month_figures;
  rev_ttc    bigint;
  rev_ht     bigint;
  rev_source text;
  rev_today  bigint;
  cogs       bigint;
  cogs_src   text;
  fc_bp      int;
  fixed      bigint;
  days_in    int;
  days_gone  int;
  be_month_ht bigint;
  be_day_ttc bigint;
  vat_bp     int;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  today := app.business_date(r);
  m := date_trunc('month', coalesce(p_month, today))::date;
  m_end := (m + interval '1 month')::date;
  uses_pos := 'pos' = any (r.products);
  days_open := least(31, greatest(1, coalesce((r.profit_settings ->> 'days_open_per_month')::int, 30)));
  target := coalesce((r.profit_settings ->> 'target_food_cost_bp')::int, 3000);
  vat_bp := r.default_vat_bp;
  days_in := (m_end - m);
  days_gone := case when today >= m_end then days_in when today < m then 0 else today - m + 1 end;

  select * into f from public.month_figures where restaurant_id = r.id and month = m;

  -- revenue: the till when there is one (and it has sales), otherwise what the owner typed
  select coalesce(sum(total_ttc_cents), 0), coalesce(sum(total_ht_cents), 0)
    into rev_ttc, rev_ht
    from public.fiscal_documents where restaurant_id = r.id and business_date >= m and business_date < m_end;
  if uses_pos and rev_ttc <> 0 then
    rev_source := 'pos';
  elsif f.revenue_ttc_cents is not null then
    rev_source := 'manual';
    rev_ttc := f.revenue_ttc_cents;
    rev_ht := round(f.revenue_ttc_cents * 10000.0 / (10000 + vat_bp));
  else
    rev_source := null; rev_ttc := 0; rev_ht := 0;
  end if;
  select coalesce(sum(total_ttc_cents), 0) into rev_today
    from public.fiscal_documents where restaurant_id = r.id and business_date = today;

  -- cost of goods: purchases typed for the month, else the recipe cards x what was sold, else the target
  if f.purchases_cents is not null then
    cogs := f.purchases_cents; cogs_src := 'purchases';
  else
    select case when sum(x.price_ht * x.qty) > 0 then round(sum(x.cost * x.qty) * 10000.0 / sum(x.price_ht * x.qty))::int end
      into fc_bp
      from (select d ->> 'cost_cents' is not null has_cost,
                   (d ->> 'cost_cents')::numeric cost, (d ->> 'price_ht_cents')::numeric price_ht, (d ->> 'sold_qty')::numeric qty
              from jsonb_array_elements((public.profit_dishes(r.id, days_in) -> 'dishes')) d) x
     where x.has_cost and x.qty > 0 and m <= today and today < m_end;
    if fc_bp is not null then cogs_src := 'recipes'; else fc_bp := target; cogs_src := 'target'; end if;
    cogs := round(rev_ht * fc_bp / 10000.0);
  end if;
  if rev_ht > 0 then fc_bp := round(cogs * 10000.0 / rev_ht)::int; end if;

  select coalesce(round(sum(case frequency when 'month' then amount_cents
                                           when 'year' then amount_cents / 12.0
                                           else amount_cents * 52 / 12.0 end)), 0)::bigint
    into fixed from public.fixed_costs where restaurant_id = r.id and active;

  -- break-even: fixed costs / what is left of each dirham after goods
  be_month_ht := case when coalesce(fc_bp, target) < 10000 then round(fixed * 10000.0 / (10000 - coalesce(fc_bp, target))) end;
  be_day_ttc := case when be_month_ht is not null then round(be_month_ht * (10000 + vat_bp) / 10000.0 / days_open) end;

  return jsonb_build_object(
    'month', m, 'days_in_month', days_in, 'days_gone', days_gone, 'days_open', days_open,
    'uses_pos', uses_pos, 'revenue_source', rev_source,
    'revenue_ttc_cents', rev_ttc, 'revenue_ht_cents', rev_ht, 'revenue_today_ttc_cents', rev_today,
    'typed_revenue_ttc_cents', f.revenue_ttc_cents, 'typed_purchases_cents', f.purchases_cents,
    'cogs_cents', cogs, 'cogs_source', cogs_src, 'food_cost_bp', coalesce(fc_bp, target), 'target_food_cost_bp', target,
    'fixed_cents', fixed,
    'fixed_by_category', (select coalesce(jsonb_object_agg(category, amt), '{}') from (
        select category, round(sum(case frequency when 'month' then amount_cents when 'year' then amount_cents / 12.0 else amount_cents * 52 / 12.0 end))::bigint amt
          from public.fixed_costs where restaurant_id = r.id and active group by category) c),
    'result_cents', rev_ht - cogs - fixed,
    'breakeven_month_ht_cents', be_month_ht,
    'breakeven_day_ttc_cents', be_day_ttc,
    'vat_bp', vat_bp
  );
end $$;
revoke all on function public.profit_month(uuid, date) from public, anon;
grant execute on function public.profit_month(uuid, date) to authenticated;
