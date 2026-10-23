-- Production planning: in the evening the team writes down what has to be made tomorrow (icing, cinnamon
-- roll dough, pancake mix...), in the order it will be made. The next morning the plan is a checklist:
-- NOTHING leaves the stock when the plan is saved. Only when someone confirms "Fait" with the quantity really
-- made are the ingredients taken out and the preparation put in stock (a normal production). What was not
-- made stays visible as "Pas fait", with the reason. Undo puts the line back to do, and gives the stock back.
--
-- Each preparation can say on which weekdays it is made (weekdays: icing and cinnamon rolls; weekend:
-- pancakes and waffles), so the evening list only proposes what belongs to that day. The plan also says
-- which raw ingredients the remaining lines will use, against the stock, with what is missing per supplier.
set lock_timeout = '10s';

-- ------------------------------------------------------------ on which days a preparation is made
-- ISO weekdays (1 = Monday ... 7 = Sunday). Null or empty: every day.
alter table public.ingredients add column if not exists make_days smallint[];
alter table public.ingredients drop constraint if exists ingredients_make_days_check;
alter table public.ingredients add constraint ingredients_make_days_check
  check (make_days is null or (make_days <@ array[1,2,3,4,5,6,7]::smallint[] and cardinality(make_days) <= 7));

create or replace function public.production_make_days(p_ingredient_id uuid, p_days smallint[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.ingredients; r public.restaurants; d smallint[];
begin
  select * into g from public.ingredients where id = p_ingredient_id;
  if g.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(g.restaurant_id, 'manager', true);
  if not g.is_preparation then perform app.fail('not_a_preparation'); end if;
  if p_days is not null and not (p_days <@ array[1,2,3,4,5,6,7]::smallint[]) then perform app.fail('invalid_request', 'days'); end if;
  select array_agg(distinct x order by x) into d from unnest(coalesce(p_days, '{}')) x;
  -- all seven days is the same as "every day"
  if d is null or cardinality(d) = 7 then d := null; end if;
  update public.ingredients set make_days = d, updated_at = now() where id = g.id;
  return jsonb_build_object('ok', true, 'make_days', d);
end $$;
revoke all on function public.production_make_days(uuid, smallint[]) from public, anon;
grant execute on function public.production_make_days(uuid, smallint[]) to authenticated;

-- ------------------------------------------------------------ the plans
create table if not exists public.production_plans (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  plan_date      date not null,
  note           text check (length(note) <= 500),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, plan_date),
  unique (restaurant_id, id)
);

create table if not exists public.production_plan_lines (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  plan_id        uuid not null,
  ingredient_id  uuid not null,
  planned_qty    numeric(14, 3) not null check (planned_qty > 0 and planned_qty < 100000000),   -- base unit
  sort_order     int not null default 0,
  note           text check (length(note) <= 200),
  status         text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  done_qty       numeric(14, 3) check (done_qty is null or (done_qty > 0 and done_qty < 100000000)),
  batch_id       uuid references public.production_batches (id) on delete set null,
  skip_reason    text check (length(skip_reason) <= 200),
  done_at        timestamptz,
  done_by        uuid,
  created_at     timestamptz not null default now(),
  unique (plan_id, ingredient_id),
  foreign key (restaurant_id, plan_id) references public.production_plans (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete cascade,
  check ((status = 'done') = (done_at is not null and done_qty is not null))
);
create index if not exists production_plan_lines_plan_idx on public.production_plan_lines (plan_id, sort_order);
create index if not exists production_plan_lines_batch_idx on public.production_plan_lines (batch_id) where batch_id is not null;

alter table public.production_plans enable row level security;
alter table public.production_plan_lines enable row level security;
grant select on public.production_plans, public.production_plan_lines to authenticated;
drop policy if exists production_plans_select on public.production_plans;
create policy production_plans_select on public.production_plans for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
drop policy if exists production_plan_lines_select on public.production_plan_lines;
create policy production_plan_lines_select on public.production_plan_lines for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
drop trigger if exists audit_production_plan_lines on public.production_plan_lines;
create trigger audit_production_plan_lines after insert or update or delete on public.production_plan_lines
  for each row execute function app.audit();

-- a production that is cancelled (from the plan or from the list of the day) puts its line back to do
create or replace function app.production_plan_on_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null then
    update public.production_plan_lines set status = 'pending', done_qty = null, done_at = null, done_by = null, batch_id = null
     where restaurant_id = new.restaurant_id and batch_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists production_plan_on_cancel on public.production_batches;
create trigger production_plan_on_cancel after update of cancelled_at on public.production_batches
  for each row execute function app.production_plan_on_cancel();

-- ------------------------------------------------------------ the day: plan, proposals, what it needs
-- p_date: the day of the plan (null: today). Returns
--   proposals: every made-ahead preparation with the suggested quantity of production_plan and on_day
--              (true when it is made on that weekday);
--   plan:      the saved plan of that day (or null) with its lines in order;
--   previous:  the last plan of the same weekday before, to copy it;
--   needs:     the raw ingredients that the lines still to do will take, against the stock.
create or replace function public.production_day(p_restaurant_id uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; dt date; today date; dow int; pl public.production_plans; prev public.production_plans;
        proposals jsonb; lines jsonb; prev_lines jsonb; needs jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  today := app.business_date(r);
  dt := coalesce(p_date, today);
  dow := extract(isodow from dt)::int;

  select coalesce(jsonb_agg(x || jsonb_build_object('make_days', to_jsonb(g.make_days),
                                                    'on_day', g.make_days is null or cardinality(g.make_days) = 0 or dow = any (g.make_days))
                            order by x->>'name'), '[]'::jsonb)
    into proposals
    from jsonb_array_elements(public.production_plan(r.id, dt)->'items') x
    join public.ingredients g on g.restaurant_id = r.id and g.id = (x->>'ingredient_id')::uuid;

  select * into pl from public.production_plans where restaurant_id = r.id and plan_date = dt;
  if pl.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'ingredient_id', l.ingredient_id, 'name', g.name, 'base_unit', g.base_unit, 'batch_qty', g.purchase_qty,
        'planned_qty', l.planned_qty, 'sort_order', l.sort_order, 'note', l.note, 'status', l.status,
        'done_qty', l.done_qty, 'batch_id', l.batch_id, 'skip_reason', l.skip_reason, 'done_at', l.done_at,
        'cost_cents', case when g.purchase_price_cents is not null and g.purchase_qty > 0
                           then round(coalesce(l.done_qty, l.planned_qty) * g.purchase_price_cents / g.purchase_qty) end
      ) order by l.sort_order, g.name), '[]'::jsonb)
      into lines
      from public.production_plan_lines l
      join public.ingredients g on g.restaurant_id = r.id and g.id = l.ingredient_id
     where l.plan_id = pl.id;

    with need as (
      select u.ingredient_id, sum(u.qty) qty
        from public.production_plan_lines l
        cross join lateral app.production_usage(r.id, l.ingredient_id, l.planned_qty) u
       where l.plan_id = pl.id and l.status = 'pending'
       group by 1)
    select coalesce(jsonb_agg(jsonb_build_object(
        'ingredient_id', g.id, 'name', g.name, 'base_unit', g.base_unit, 'purchase_unit', g.purchase_unit, 'purchase_qty', g.purchase_qty,
        'need', round(n.qty, 3), 'stock_qty', g.stock_qty,
        'short', case when g.stock_qty is null then null else greatest(0, round(n.qty - greatest(g.stock_qty, 0), 3)) end,
        'is_preparation', g.is_preparation,
        'supplier_id', s.id, 'supplier', coalesce(s.name, nullif(g.supplier, '')), 'supplier_phone', s.phone
      ) order by coalesce(s.name, g.supplier, ''), g.name), '[]'::jsonb)
      into needs
      from need n
      join public.ingredients g on g.restaurant_id = r.id and g.id = n.ingredient_id
      left join public.suppliers s on s.restaurant_id = r.id and s.id = g.supplier_id;
  end if;

  select * into prev from public.production_plans
   where restaurant_id = r.id and plan_date < dt and extract(isodow from plan_date) = dow
     and exists (select 1 from public.production_plan_lines l where l.plan_id = production_plans.id)
   order by plan_date desc limit 1;
  if prev.id is not null then
    select jsonb_agg(jsonb_build_object('ingredient_id', l.ingredient_id, 'planned_qty', l.planned_qty, 'note', l.note) order by l.sort_order)
      into prev_lines
      from public.production_plan_lines l
      join public.ingredients g on g.restaurant_id = r.id and g.id = l.ingredient_id and g.active and g.is_preparation and g.made_ahead
     where l.plan_id = prev.id;
  end if;

  return jsonb_build_object(
    'date', dt, 'today', today, 'dow', dow,
    'proposals', proposals,
    'plan', case when pl.id is null then null else jsonb_build_object('id', pl.id, 'note', pl.note, 'updated_at', pl.updated_at, 'lines', lines) end,
    'needs', coalesce(needs, '[]'::jsonb),
    'previous', case when prev.id is null or prev_lines is null then null else jsonb_build_object('date', prev.plan_date, 'lines', prev_lines) end);
end $$;
revoke all on function public.production_day(uuid, date) from public, anon;
grant execute on function public.production_day(uuid, date) to authenticated;

-- ------------------------------------------------------------ save the plan of a day
-- p_lines: [{ingredient_id, qty, note}] in the order of the day. Lines to do are replaced; lines already
-- done or marked "Pas fait" stay as they are (their stock has moved, or the reason was written). An empty
-- list with nothing done removes the plan.
create or replace function public.production_plan_save(p_restaurant_id uuid, p_date date, p_lines jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; today date; pl public.production_plans; x jsonb; i int := 0; gid uuid; q numeric; ids uuid[] := '{}';
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  today := app.business_date(r);
  if p_date is null or p_date < today then perform app.fail('past_date'); end if;
  if p_date > today + 14 then perform app.fail('invalid_request', 'date'); end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then perform app.fail('invalid_request', 'lines'); end if;

  insert into public.production_plans (restaurant_id, plan_date, note)
  values (r.id, p_date, nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  on conflict (restaurant_id, plan_date) do update set note = excluded.note, updated_at = now()
  returning * into pl;

  for x in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    begin gid := (x->>'ingredient_id')::uuid; q := (x->>'qty')::numeric;
    exception when others then perform app.fail('invalid_request', 'line'); end;
    if gid is null or gid = any (ids) then perform app.fail('invalid_request', 'line'); end if;
    if q is null or q <= 0 or q >= 100000000 then perform app.fail('invalid_request', 'qty'); end if;
    if not exists (select 1 from public.ingredients where restaurant_id = r.id and id = gid and is_preparation and made_ahead) then
      perform app.fail('not_a_preparation');
    end if;
    ids := ids || gid;
    insert into public.production_plan_lines (restaurant_id, plan_id, ingredient_id, planned_qty, sort_order, note)
    values (r.id, pl.id, gid, round(q, 3), i, nullif(left(btrim(coalesce(x->>'note', '')), 200), ''))
    on conflict (plan_id, ingredient_id) do update
      set sort_order = excluded.sort_order,
          planned_qty = case when production_plan_lines.status = 'pending' then excluded.planned_qty else production_plan_lines.planned_qty end,
          note = case when production_plan_lines.status = 'pending' then excluded.note else production_plan_lines.note end;
  end loop;

  delete from public.production_plan_lines where plan_id = pl.id and status = 'pending' and not (ingredient_id = any (ids));
  if not exists (select 1 from public.production_plan_lines where plan_id = pl.id) and pl.note is null then
    delete from public.production_plans where id = pl.id;
  end if;
  return public.production_day(r.id, p_date);
end $$;
revoke all on function public.production_plan_save(uuid, date, jsonb, text) from public, anon;
grant execute on function public.production_plan_save(uuid, date, jsonb, text) to authenticated;

-- ------------------------------------------------------------ the morning: done, not done, undo
-- "Fait": the quantity really made. Only now do the ingredients leave the stock (a normal production of today).
create or replace function public.production_plan_done(p_line_id uuid, p_qty numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.production_plan_lines; pl public.production_plans; r public.restaurants; res jsonb;
begin
  select * into l from public.production_plan_lines where id = p_line_id for update;
  if l.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(l.restaurant_id, 'manager', true);
  if l.status <> 'pending' then perform app.fail('not_pending'); end if;
  select * into pl from public.production_plans where id = l.plan_id;
  if pl.plan_date <> app.business_date(r) then perform app.fail('not_today'); end if;
  if p_qty is null or p_qty <= 0 or p_qty >= 100000000 then perform app.fail('invalid_request', 'qty'); end if;
  res := public.production_record(l.ingredient_id, round(p_qty, 3), coalesce(l.note, 'Planning'), null, null);
  update public.production_plan_lines
     set status = 'done', done_qty = round(p_qty, 3), done_at = now(), done_by = auth.uid(), batch_id = (res->>'id')::uuid, skip_reason = null
   where id = l.id;
  return res || jsonb_build_object('line_id', l.id);
end $$;

-- "Pas fait": nothing moves, the reason is kept for the end of the day
create or replace function public.production_plan_skip(p_line_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.production_plan_lines; r public.restaurants;
begin
  select * into l from public.production_plan_lines where id = p_line_id for update;
  if l.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(l.restaurant_id, 'manager', true);
  if l.status <> 'pending' then perform app.fail('not_pending'); end if;
  update public.production_plan_lines set status = 'skipped', skip_reason = nullif(left(btrim(coalesce(p_reason, '')), 200), '')
   where id = l.id;
  return jsonb_build_object('ok', true);
end $$;

-- back to do: a "Fait" is cancelled (the stock comes back), a "Pas fait" is forgotten
create or replace function public.production_plan_undo(p_line_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.production_plan_lines; r public.restaurants;
begin
  select * into l from public.production_plan_lines where id = p_line_id for update;
  if l.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(l.restaurant_id, 'manager', true);
  if l.status = 'pending' then perform app.fail('not_done'); end if;
  if l.status = 'done' and l.batch_id is not null
     and exists (select 1 from public.production_batches where id = l.batch_id and cancelled_at is null) then
    perform public.production_cancel(l.batch_id);   -- the trigger puts the line back to do
  end if;
  update public.production_plan_lines set status = 'pending', done_qty = null, done_at = null, done_by = null, batch_id = null, skip_reason = null
   where id = l.id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.production_plan_done(uuid, numeric) from public, anon;
revoke all on function public.production_plan_skip(uuid, text) from public, anon;
revoke all on function public.production_plan_undo(uuid) from public, anon;
grant execute on function public.production_plan_done(uuid, numeric) to authenticated;
grant execute on function public.production_plan_skip(uuid, text) to authenticated;
grant execute on function public.production_plan_undo(uuid) to authenticated;
