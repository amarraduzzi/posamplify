-- =============================================================================
-- 0017 AMPLIFY PROFIT: a typed monthly revenue wins over the till
-- =============================================================================
-- With Amplify POS the revenue comes from the till. But the month a restaurant
-- starts with the till (or when there are only test tickets) that number is too
-- low, so the owner can type the real total of the month and it is used instead.
-- Leaving the field empty goes back to the till.
-- =============================================================================

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

  -- revenue: what the owner typed for the month, otherwise the till
  select coalesce(sum(total_ttc_cents), 0), coalesce(sum(total_ht_cents), 0)
    into rev_ttc, rev_ht
    from public.fiscal_documents where restaurant_id = r.id and business_date >= m and business_date < m_end;
  -- a number the owner typed wins: the month he switched to the till mid-month, or test tickets
  if f.revenue_ttc_cents is not null then
    rev_source := 'manual';
    rev_ttc := f.revenue_ttc_cents;
    rev_ht := round(f.revenue_ttc_cents * 10000.0 / (10000 + vat_bp));
  elsif uses_pos and rev_ttc <> 0 then
    rev_source := 'pos';
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
