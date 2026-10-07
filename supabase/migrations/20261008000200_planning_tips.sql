-- =============================================================================
-- Staff planning and tips
-- * staff_schedule: who works when (a shift past midnight ends the next day).
-- * planning_week: the week with planned hours and cost per day against the expected revenue
--   (average of the same weekday over the 4 weeks before), the real figures for past days,
--   and late arrivals (clock-in more than 10 minutes after the planned start).
-- * Tips: the tips recorded at the till over a period, shared by hours worked or equally,
--   saved once (a period cannot be shared twice).
-- =============================================================================
create table if not exists public.staff_schedule (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  staff_id      uuid not null,
  day           date not null,
  start_time    time not null,
  end_time      time not null,
  note          text check (length(note) <= 80),
  created_at    timestamptz not null default now(),
  check (start_time <> end_time),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete cascade
);
create index if not exists staff_schedule_idx on public.staff_schedule (restaurant_id, day);

create table if not exists public.tip_payouts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  period_from   date not null,
  period_to     date not null,
  rule          text not null check (rule in ('hours', 'equal')),
  total_cents   bigint not null check (total_cents >= 0),
  lines         jsonb not null,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  check (period_to >= period_from)
);
create index if not exists tip_payouts_idx on public.tip_payouts (restaurant_id, period_from);

alter table public.staff_schedule enable row level security;
alter table public.tip_payouts enable row level security;
grant select, insert, update, delete on public.staff_schedule to authenticated;
grant select on public.tip_payouts to authenticated;
do $$
declare t text;
begin
  foreach t in array array['staff_schedule', 'tip_payouts'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (restaurant_id = any ((select app.my_restaurants(''manager''))::uuid[]))', t);
  end loop;
end $$;
drop policy if exists staff_schedule_insert on public.staff_schedule;
drop policy if exists staff_schedule_update on public.staff_schedule;
drop policy if exists staff_schedule_delete on public.staff_schedule;
create policy staff_schedule_insert on public.staff_schedule for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy staff_schedule_update on public.staff_schedule for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy staff_schedule_delete on public.staff_schedule for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));

-- hours of a planned shift (past midnight: until the next day)
create or replace function app.shift_hours(t1 time, t2 time)
returns numeric language sql immutable set search_path = '' as $$
  select (extract(epoch from (t2 - t1)) / 3600.0 + case when t2 < t1 then 24 else 0 end)::numeric
$$;

create or replace function public.planning_week(p_restaurant_id uuid, p_monday date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  perform app.require_role(p_restaurant_id, 'manager', false);
  select * into r from public.restaurants where id = p_restaurant_id;
  return jsonb_build_object(
    'shifts', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'staff_id', s.staff_id, 'day', s.day, 'start', to_char(s.start_time, 'HH24:MI'),
                 'end', to_char(s.end_time, 'HH24:MI'), 'note', s.note) order by s.day, s.start_time), '[]'::jsonb)
                 from public.staff_schedule s where s.restaurant_id = r.id and s.day between p_monday and p_monday + 6),
    'days', (select jsonb_agg(jsonb_build_object(
        'day', d::date,
        'planned_hours', coalesce((select sum(app.shift_hours(s.start_time, s.end_time)) from public.staff_schedule s where s.restaurant_id = r.id and s.day = d::date), 0),
        'planned_cost_cents', coalesce((select sum(round(app.shift_hours(s.start_time, s.end_time) * rt.hourly_cost_cents)) from public.staff_schedule s
                                          join public.staff_rates rt on rt.staff_id = s.staff_id where s.restaurant_id = r.id and s.day = d::date), 0),
        'missing_rates', (select count(distinct s.staff_id) from public.staff_schedule s where s.restaurant_id = r.id and s.day = d::date
                            and not exists (select 1 from public.staff_rates rt where rt.staff_id = s.staff_id)),
        'expected_cents', (select round(avg(x.rev)) from (select coalesce(sum(f.total_ttc_cents), 0) rev from generate_series(1, 4) w
                              left join public.fiscal_documents f on f.restaurant_id = r.id and f.business_date = d::date - 7 * w group by w) x),
        'revenue_cents', case when d::date <= (now() at time zone r.timezone)::date
                         then (select coalesce(sum(f.total_ttc_cents), 0) from public.fiscal_documents f where f.restaurant_id = r.id and f.business_date = d::date) end,
        'worked_hours', (select coalesce(sum(extract(epoch from (coalesce(h.clock_out, least(now(), h.clock_in + interval '16 hours')) - h.clock_in)) / 3600.0), 0)
                           from public.staff_shifts h where h.restaurant_id = r.id and (h.clock_in at time zone r.timezone)::date = d::date)
      ) order by d) from generate_series(p_monday, p_monday + 6, interval '1 day') d),
    'late', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', s.staff_id, 'day', s.day, 'planned', to_char(s.start_time, 'HH24:MI'),
                 'clock_in', to_char(h.first_in at time zone r.timezone, 'HH24:MI'),
                 'minutes', round(extract(epoch from (h.first_in - ((s.day + s.start_time) at time zone r.timezone))) / 60)) order by s.day), '[]'::jsonb)
               from public.staff_schedule s
               cross join lateral (select min(x.clock_in) first_in from public.staff_shifts x where x.staff_id = s.staff_id
                                     and x.clock_in between ((s.day + s.start_time) at time zone r.timezone) - interval '3 hours'
                                                        and ((s.day + s.start_time) at time zone r.timezone) + interval '4 hours') h
              where s.restaurant_id = r.id and s.day between p_monday and p_monday + 6
                and h.first_in > ((s.day + s.start_time) at time zone r.timezone) + interval '10 minutes')
  );
end $$;

-- copies a week onto another (the target week is replaced)
create or replace function public.planning_copy_week(p_restaurant_id uuid, p_from_monday date, p_to_monday date)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform app.require_role(p_restaurant_id, 'manager', true);
  if p_from_monday = p_to_monday then perform app.fail('invalid_request'); end if;
  delete from public.staff_schedule where restaurant_id = p_restaurant_id and day between p_to_monday and p_to_monday + 6;
  insert into public.staff_schedule (restaurant_id, staff_id, day, start_time, end_time, note)
  select s.restaurant_id, s.staff_id, s.day + (p_to_monday - p_from_monday), s.start_time, s.end_time, s.note
    from public.staff_schedule s join public.staff st on st.id = s.staff_id and st.active
   where s.restaurant_id = p_restaurant_id and s.day between p_from_monday and p_from_monday + 6;
  get diagnostics n = row_count;
  return n;
end $$;

-- the share of the tips over a period (nothing saved)
create or replace function public.tips_preview(p_restaurant_id uuid, p_from date, p_to date, p_rule text, p_exclude uuid[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; total bigint; hrs numeric; lines jsonb;
begin
  perform app.require_role(p_restaurant_id, 'manager', false);
  if p_rule not in ('hours', 'equal') or p_to < p_from or p_to - p_from > 62 then perform app.fail('invalid_request'); end if;
  select * into r from public.restaurants where id = p_restaurant_id;
  select coalesce(sum(p.tip_cents), 0) into total
    from public.payments p join public.orders o on o.id = p.order_id
   where p.restaurant_id = r.id and o.business_date between p_from and p_to and o.status <> 'cancelled';
  with h as (
    select st.id staff_id, st.name, coalesce(sum(extract(epoch from (coalesce(x.clock_out, least(now(), x.clock_in + interval '16 hours')) - x.clock_in)) / 3600.0), 0) hours
      from public.staff st
      left join public.staff_shifts x on x.staff_id = st.id and (x.clock_in at time zone r.timezone)::date between p_from and p_to
     where st.restaurant_id = r.id and st.active and not (st.id = any (coalesce(p_exclude, '{}')))
     group by st.id, st.name),
  f as (select *, count(*) over () n, sum(hours) over () th, row_number() over (order by hours desc, name) rk from h where hours > 0),
  a as (select *, floor(total * case when p_rule = 'hours' then hours / th else 1.0 / n end)::bigint amt from f),
  b as (select *, amt + case when rk = 1 then total - sum(amt) over () else 0 end amount from a)  -- rounding centimes go to who worked most
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', staff_id, 'name', name, 'hours', round(hours, 2), 'amount_cents', amount) order by amount desc, name), '[]'::jsonb),
         coalesce(sum(hours), 0)
    into lines, hrs from b;
  return jsonb_build_object('total_cents', total, 'hours', round(hrs, 2), 'lines', lines,
    'overlap', exists (select 1 from public.tip_payouts t where t.restaurant_id = r.id and t.period_from <= p_to and t.period_to >= p_from));
end $$;

create or replace function public.tips_distribute(p_restaurant_id uuid, p_from date, p_to date, p_rule text, p_exclude uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare res jsonb; id uuid;
begin
  perform app.require_role(p_restaurant_id, 'manager', true);
  perform pg_advisory_xact_lock(hashtext('tips' || p_restaurant_id::text));
  res := public.tips_preview(p_restaurant_id, p_from, p_to, p_rule, p_exclude);
  if (res ->> 'overlap')::boolean then perform app.fail('tips_already_shared'); end if;
  if jsonb_array_length(res -> 'lines') = 0 then perform app.fail('no_hours'); end if;
  insert into public.tip_payouts (restaurant_id, period_from, period_to, rule, total_cents, lines)
  values (p_restaurant_id, p_from, p_to, p_rule, (res ->> 'total_cents')::bigint, res -> 'lines') returning tip_payouts.id into id;
  return res || jsonb_build_object('id', id);
end $$;

create or replace function public.tips_cancel(p_payout_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.tip_payouts where id = p_payout_id;
  if rid is null then perform app.fail('not_found'); end if;
  perform app.require_role(rid, 'owner', true);
  delete from public.tip_payouts where id = p_payout_id;
end $$;

revoke all on function public.planning_week(uuid, date), public.planning_copy_week(uuid, date, date),
  public.tips_preview(uuid, date, date, text, uuid[]), public.tips_distribute(uuid, date, date, text, uuid[]), public.tips_cancel(uuid) from public, anon;
grant execute on function public.planning_week(uuid, date), public.planning_copy_week(uuid, date, date),
  public.tips_preview(uuid, date, date, text, uuid[]), public.tips_distribute(uuid, date, date, text, uuid[]), public.tips_cancel(uuid) to authenticated;
