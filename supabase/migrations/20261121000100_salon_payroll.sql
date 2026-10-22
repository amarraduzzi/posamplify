-- =============================================================================
-- AMPLIFY AGENDA (13): commissions and pay of the salon's team
--
-- Each person has pay rules (agenda_pay_plans), owner only (salaries are not for managers):
--   * a fixed monthly salary, added to the commission ('plus') or as a guaranteed minimum ('max':
--     the higher of salary and commission);
--   * the commission on prestations: one rate ('flat'), marginal brackets on the month's revenue
--     ('tiers': 30 % up to 10 000 DH, 40 % above; a first bracket at 0 % is "only above a minimum"),
--     or a rate per prestation with a default ('by_service');
--   * the commission on products sold: a rate of the price or of the margin;
--   * the tips: paid with the month, or already given in cash.
-- Plus advances, bonuses and deductions per month (agenda_pay_items). The month is computed from
-- the real tickets (after discount, cancelled tickets left out), per line and per person, and can be
-- marked paid: its figures are then kept as they were (agenda_payouts).
-- =============================================================================

create table if not exists public.agenda_pay_plans (
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  staff_id        uuid not null,
  base_cents      bigint not null default 0 check (base_cents between 0 and 100000000),
  base_mode       text not null default 'plus' check (base_mode in ('plus', 'max')),
  service_mode    text not null default 'flat' check (service_mode in ('flat', 'tiers', 'by_service')),
  service_rate_bp integer not null default 0 check (service_rate_bp between 0 and 10000),
  tiers           jsonb not null default '[]'::jsonb check (jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) <= 10),
  service_rates   jsonb not null default '{}'::jsonb check (jsonb_typeof(service_rates) = 'object'),
  product_rate_bp integer not null default 0 check (product_rate_bp between 0 and 10000),
  product_basis   text not null default 'price' check (product_basis in ('price', 'margin')),
  tips_in_pay     boolean not null default true,
  updated_at      timestamptz not null default now(),
  primary key (restaurant_id, staff_id),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete cascade
);

create table if not exists public.agenda_pay_items (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  staff_id       uuid not null,
  month          date not null check (extract(day from month) = 1),
  kind           text not null check (kind in ('advance', 'bonus', 'deduction')),
  amount_cents   bigint not null check (amount_cents between 1 and 100000000),
  note           text check (length(note) <= 200),
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete cascade
);
create index if not exists agenda_pay_items_idx on public.agenda_pay_items (restaurant_id, month);

create table if not exists public.agenda_payouts (
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  staff_id       uuid not null,
  month          date not null check (extract(day from month) = 1),
  figures        jsonb not null,
  net_cents      bigint not null,
  paid_at        timestamptz not null default now(),
  paid_by        uuid default auth.uid(),
  primary key (restaurant_id, staff_id, month),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete cascade
);

do $$ declare t text; begin
  foreach t in array array['agenda_pay_plans', 'agenda_pay_items', 'agenda_payouts'] loop
    execute format('drop trigger if exists %1$s_same_tenant on public.%1$s', t);
    execute format('create trigger %1$s_same_tenant before update on public.%1$s for each row execute function app.forbid_restaurant_change()', t);
    execute format('alter table public.%s enable row level security', t);
    execute format('revoke all on public.%s from anon, authenticated', t);
    execute format('grant select on public.%s to authenticated', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (restaurant_id = any ((select app.my_restaurants(''owner''))::uuid[]))', t);
  end loop;
end $$;
-- the advances, bonuses and deductions: the owner writes them directly (not in a paid month)
grant insert (restaurant_id, staff_id, month, kind, amount_cents, note) on public.agenda_pay_items to authenticated;
grant delete on public.agenda_pay_items to authenticated;
drop policy if exists agenda_pay_items_insert on public.agenda_pay_items;
create policy agenda_pay_items_insert on public.agenda_pay_items for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('owner'))::uuid[])
              and not exists (select 1 from public.agenda_payouts p where p.restaurant_id = agenda_pay_items.restaurant_id and p.staff_id = agenda_pay_items.staff_id and p.month = agenda_pay_items.month));
drop policy if exists agenda_pay_items_delete on public.agenda_pay_items;
create policy agenda_pay_items_delete on public.agenda_pay_items for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('owner'))::uuid[])
         and not exists (select 1 from public.agenda_payouts p where p.restaurant_id = agenda_pay_items.restaurant_id and p.staff_id = agenda_pay_items.staff_id and p.month = agenda_pay_items.month));

-- the rules of one person: checked here (brackets in order, rates between 0 and 100 %)
create or replace function public.agenda_pay_plan_save(p_restaurant_id uuid, p_staff uuid, p jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; t jsonb; last bigint := -1; k text; v jsonb;
begin
  r := app.require_role(p_restaurant_id, 'owner', true);
  if not exists (select 1 from public.staff where id = p_staff and restaurant_id = r.id) then perform app.fail('not_found'); end if;
  for t in select * from jsonb_array_elements(coalesce(p -> 'tiers', '[]'::jsonb)) loop
    if (t ->> 'from_cents')::bigint is null or (t ->> 'from_cents')::bigint <= last or (t ->> 'rate_bp')::int not between 0 and 10000 then
      perform app.fail('invalid_request', 'tiers');
    end if;
    last := (t ->> 'from_cents')::bigint;
  end loop;
  if jsonb_array_length(coalesce(p -> 'tiers', '[]'::jsonb)) > 0 and (p -> 'tiers' -> 0 ->> 'from_cents')::bigint <> 0 then perform app.fail('invalid_request', 'tiers'); end if;
  if p ->> 'service_mode' = 'tiers' and jsonb_array_length(coalesce(p -> 'tiers', '[]'::jsonb)) = 0 then perform app.fail('invalid_request', 'tiers'); end if;
  for k, v in select * from jsonb_each(coalesce(p -> 'service_rates', '{}'::jsonb)) loop
    if not exists (select 1 from public.agenda_services where id = app.try_uuid(k) and restaurant_id = r.id) or (v #>> '{}')::int not between 0 and 10000 then
      perform app.fail('invalid_request', 'service_rates');
    end if;
  end loop;
  insert into public.agenda_pay_plans as x (restaurant_id, staff_id, base_cents, base_mode, service_mode, service_rate_bp, tiers, service_rates,
                                            product_rate_bp, product_basis, tips_in_pay, updated_at)
  values (r.id, p_staff, coalesce((p ->> 'base_cents')::bigint, 0), coalesce(p ->> 'base_mode', 'plus'), coalesce(p ->> 'service_mode', 'flat'),
          coalesce((p ->> 'service_rate_bp')::int, 0), coalesce(p -> 'tiers', '[]'::jsonb), coalesce(p -> 'service_rates', '{}'::jsonb),
          coalesce((p ->> 'product_rate_bp')::int, 0), coalesce(p ->> 'product_basis', 'price'), coalesce((p ->> 'tips_in_pay')::boolean, true), now())
  on conflict (restaurant_id, staff_id) do update set base_cents = excluded.base_cents, base_mode = excluded.base_mode, service_mode = excluded.service_mode,
     service_rate_bp = excluded.service_rate_bp, tiers = excluded.tiers, service_rates = excluded.service_rates, product_rate_bp = excluded.product_rate_bp,
     product_basis = excluded.product_basis, tips_in_pay = excluded.tips_in_pay, updated_at = now();
end $$;
revoke all on function public.agenda_pay_plan_save(uuid, uuid, jsonb) from public, anon;
grant execute on function public.agenda_pay_plan_save(uuid, uuid, jsonb) to authenticated;

-- marginal brackets: each part of the revenue at the rate of its bracket
create or replace function app.agenda_tiers(tiers jsonb, revenue bigint)
returns bigint language sql immutable set search_path = '' as $$
  select coalesce(sum(round(greatest(0, least(revenue, coalesce(t.next_from, revenue)) - t.from_c)::numeric * t.rate / 10000)), 0)::bigint
    from (select (x ->> 'from_cents')::bigint from_c, (x ->> 'rate_bp')::int rate,
                 lead((x ->> 'from_cents')::bigint) over (order by (x ->> 'from_cents')::bigint) next_from
            from jsonb_array_elements(tiers) x) t
   where revenue > t.from_c
$$;

-- one person's month, computed from the tickets
create or replace function app.agenda_pay_compute(r public.restaurants, p_staff uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pl public.agenda_pay_plans; svc bigint; prod bigint; prod_margin bigint; svc_comm bigint; prod_comm bigint; comm bigint; base bigint;
        tips bigint; adv bigint; bonus bigint; ded bigint; clients int; earned bigint;
begin
  select * into pl from public.agenda_pay_plans where restaurant_id = r.id and staff_id = p_staff;
  -- the lines of this person in the month, with their share of the ticket's discount
  with l as (
    select l.kind, l.service_id, l.product_id, l.quantity, s.id sale_id,
           (l.line_cents - case when s.subtotal_cents > 0 then round(l.line_cents::numeric * s.discount_cents / s.subtotal_cents) else 0 end)::bigint net
      from public.agenda_sale_lines l join public.agenda_sales s on s.id = l.sale_id
     where s.restaurant_id = r.id and s.cancelled_at is null and l.staff_id = p_staff
       and s.business_date >= p_month and s.business_date < (p_month + interval '1 month')::date)
  select coalesce(sum(net) filter (where kind = 'service'), 0),
         coalesce(sum(net) filter (where kind <> 'service'), 0),
         coalesce(sum(net - case when kind <> 'service' then l.quantity * coalesce((select cost_cents from public.agenda_products p where p.id = l.product_id), 0) else 0 end) filter (where kind <> 'service'), 0),
         coalesce(sum(round(net::numeric * coalesce((pl.service_rates ->> l.service_id::text)::int, pl.service_rate_bp) / 10000)) filter (where kind = 'service'), 0),
         count(distinct sale_id)
    into svc, prod, prod_margin, svc_comm, clients
    from l;
  if pl.restaurant_id is null then
    svc_comm := 0; prod_comm := 0; base := 0;
  else
    if pl.service_mode = 'flat' then svc_comm := round(svc::numeric * pl.service_rate_bp / 10000);
    elsif pl.service_mode = 'tiers' then svc_comm := app.agenda_tiers(pl.tiers, svc);
    end if;   -- by_service: computed per line above
    prod_comm := round(greatest(0, case when pl.product_basis = 'margin' then prod_margin else prod end)::numeric * pl.product_rate_bp / 10000);
    base := pl.base_cents;
  end if;
  comm := svc_comm + prod_comm;
  earned := case when coalesce(pl.base_mode, 'plus') = 'max' then greatest(base, comm) else base + comm end;
  select coalesce(sum(tip_cents), 0) into tips from public.agenda_sales
   where restaurant_id = r.id and cancelled_at is null and staff_id = p_staff and business_date >= p_month and business_date < (p_month + interval '1 month')::date;
  select coalesce(sum(amount_cents) filter (where kind = 'advance'), 0), coalesce(sum(amount_cents) filter (where kind = 'bonus'), 0),
         coalesce(sum(amount_cents) filter (where kind = 'deduction'), 0)
    into adv, bonus, ded from public.agenda_pay_items where restaurant_id = r.id and staff_id = p_staff and month = p_month;
  return jsonb_build_object('staff_id', p_staff, 'has_plan', pl.restaurant_id is not null, 'clients', clients,
    'services_cents', svc, 'products_cents', prod, 'products_margin_cents', prod_margin,
    'service_commission_cents', svc_comm, 'product_commission_cents', prod_comm, 'commission_cents', comm,
    'base_cents', base, 'base_mode', coalesce(pl.base_mode, 'plus'), 'earned_cents', earned,
    'tips_cents', tips, 'tips_in_pay', coalesce(pl.tips_in_pay, true),
    'bonus_cents', bonus, 'advance_cents', adv, 'deduction_cents', ded,
    'net_cents', earned + case when coalesce(pl.tips_in_pay, true) then tips else 0 end + bonus - adv - ded);
end $$;
revoke all on function app.agenda_pay_compute(public.restaurants, uuid, date) from public, anon, authenticated;

-- the month of the team: computed live, or as it was when marked paid
create or replace function public.agenda_payroll(p_restaurant_id uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; m date := date_trunc('month', p_month)::date;
begin
  r := app.require_role(p_restaurant_id, 'owner', false);
  return jsonb_build_object('month', m, 'staff', coalesce((select jsonb_agg(x order by x ->> 'name') from (
    select coalesce(po.figures, app.agenda_pay_compute(r, s.id, m)) || jsonb_build_object('name', s.name, 'agenda_color', s.agenda_color,
             'paid_at', po.paid_at, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'amount_cents', i.amount_cents, 'note', i.note, 'at', i.created_at) order by i.created_at)
                from public.agenda_pay_items i where i.restaurant_id = r.id and i.staff_id = s.id and i.month = m), '[]'::jsonb)) x
      from public.staff s
      left join public.agenda_payouts po on po.restaurant_id = r.id and po.staff_id = s.id and po.month = m
     where s.restaurant_id = r.id
       and (s.active or po.staff_id is not null or exists (select 1 from public.agenda_sale_lines l where l.staff_id = s.id))) t), '[]'::jsonb));
end $$;
revoke all on function public.agenda_payroll(uuid, date) from public, anon;
grant execute on function public.agenda_payroll(uuid, date) to authenticated;

-- mark a month paid (its figures are kept), or reopen it
create or replace function public.agenda_payout_set(p_restaurant_id uuid, p_staff uuid, p_month date, p_paid boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; m date := date_trunc('month', p_month)::date; f jsonb;
begin
  r := app.require_role(p_restaurant_id, 'owner', true);
  if not exists (select 1 from public.staff where id = p_staff and restaurant_id = r.id) then perform app.fail('not_found'); end if;
  if p_paid then
    if m > date_trunc('month', app.business_date(r))::date then perform app.fail('invalid_date'); end if;
    f := app.agenda_pay_compute(r, p_staff, m);
    insert into public.agenda_payouts (restaurant_id, staff_id, month, figures, net_cents) values (r.id, p_staff, m, f, (f ->> 'net_cents')::bigint)
    on conflict (restaurant_id, staff_id, month) do nothing;
  else
    delete from public.agenda_payouts where restaurant_id = r.id and staff_id = p_staff and month = m;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.agenda_payout_set(uuid, uuid, date, boolean) from public, anon;
grant execute on function public.agenda_payout_set(uuid, uuid, date, boolean) to authenticated;

notify pgrst, 'reload schema';
