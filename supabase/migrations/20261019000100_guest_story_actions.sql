-- =============================================================================
-- GUEST STORY ACTIONS: a one-time code for the next visit
-- =============================================================================
-- The owner builds a list of actions in Settings (stored in restaurants.branding ->
-- 'guest_actions'). An action with when = 'next' gives the guest a unique code after
-- sharing the story: a normal promo code (kind 'code') that works once, from the
-- next day, for a number of days. The till and the guest basket already accept
-- promo codes, so nothing else changes there. Vouchers are marked (voucher = true)
-- so they stay out of the promotions list and its report.
-- =============================================================================

alter table public.promotions
  add column if not exists voucher boolean not null default false,
  add column if not exists voucher_order_id uuid,
  add column if not exists voucher_action text;
-- one voucher per order
create unique index if not exists promotions_voucher_order_idx on public.promotions (voucher_order_id) where voucher_order_id is not null;
create index if not exists promotions_voucher_action_idx on public.promotions (restaurant_id, voucher_action, created_at) where voucher;

create or replace function app.voucher_json(p public.promotions)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('status', 'ok', 'voucher', jsonb_build_object(
    'code', p.code, 'name', p.name, 'discount_type', p.discount_type, 'value', p.value, 'min_order_cents', p.min_order_cents,
    'starts_on', p.starts_on, 'ends_on', p.ends_on, 'days', p.days, 'start_time', p.start_time, 'end_time', p.end_time, 'channels', p.channels))
$$;

-- The guest asks for the voucher of the action he picked (only the owner's own settings count, nothing
-- comes from the guest). A second call for the same order returns the same code.
-- status: ok | none (nothing to give) | full (weekly limit reached)
create or replace function public.issue_guest_voucher(p_order_id uuid, p_action_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; r public.restaurants; p public.promotions; a jsonb;
  num numeric; v_type text; start_d date; end_d date; valid int; cap int; issued int;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text; tries int := 0; v_days int[]; v_t1 time; v_t2 time;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null then return jsonb_build_object('status', 'none'); end if;
  select * into p from public.promotions where voucher_order_id = o.id;
  if p.id is not null then return app.voucher_json(p); end if;

  select * into r from public.restaurants where id = o.restaurant_id and status <> 'cancelled';
  if r.id is null or o.status = 'cancelled' or o.created_at < now() - interval '12 hours'
     or coalesce((r.branding ->> 'guest_share')::boolean, true) = false then
    return jsonb_build_object('status', 'none');
  end if;

  select t.x into a
    from jsonb_array_elements(case when jsonb_typeof(r.branding -> 'guest_actions') = 'array' then r.branding -> 'guest_actions' else '[]'::jsonb end) as t(x)
   where t.x ->> 'id' = p_action_id and coalesce((t.x ->> 'on')::boolean, true)
     and t.x ->> 'when' = 'next' and t.x ->> 'type' in ('percent', 'amount')
   limit 1;
  if a is null then return jsonb_build_object('status', 'none'); end if;

  v_type := a ->> 'type';
  num := nullif(a ->> 'value', '')::numeric;
  if num is null or num <= 0 then return jsonb_build_object('status', 'none'); end if;
  if v_type = 'percent' then num := least(num, 100); end if;

  cap := nullif(a ->> 'max_per_week', '')::int;
  if cap is not null then
    select count(*) into issued from public.promotions
     where restaurant_id = r.id and voucher and voucher_action = p_action_id and created_at > now() - interval '7 days';
    if issued >= cap then return jsonb_build_object('status', 'full'); end if;
  end if;

  valid := greatest(1, least(365, coalesce(nullif(a ->> 'valid_days', '')::int, 30)));
  start_d := (now() at time zone r.timezone)::date + case when coalesce(a ->> 'delay', 'next_day') = 'now' then 0 else 1 end;
  end_d := start_d + (valid - 1);
  select array_agg(x::int order by x::int) into v_days
    from jsonb_array_elements_text(case when jsonb_typeof(a -> 'days') = 'array' then a -> 'days' else '[]'::jsonb end) x
   where x ~ '^[1-7]$';
  if v_days is null or cardinality(v_days) = 0 then v_days := '{1,2,3,4,5,6,7}'; end if;
  v_t1 := nullif(a ->> 'from', '')::time; v_t2 := nullif(a ->> 'to', '')::time;
  if v_t1 is null or v_t2 is null then v_t1 := null; v_t2 := null; end if;

  loop
    tries := tries + 1;
    v_code := upper(left(regexp_replace(r.slug, '[^a-zA-Z0-9]', '', 'g'), 2)) || '-'
              || (select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
    begin
      insert into public.promotions (restaurant_id, kind, name, active, discount_type, value, days, start_time, end_time, starts_on, ends_on,
                                     code, min_order_cents, max_uses, once_per_phone, channels, voucher, voucher_order_id, voucher_action)
      values (r.id, 'code', left(coalesce(nullif(btrim(a ->> 'name'), ''), 'Story'), 50), true, v_type, round(num * 100)::bigint, v_days, v_t1, v_t2, start_d, end_d,
              v_code, coalesce(round(nullif(a ->> 'min', '')::numeric * 100), 0)::bigint, 1, false,
              case when coalesce((a ->> 'in_store_only')::boolean, false) then array['pos'] else array['pos', 'online'] end,
              true, o.id, p_action_id)
      returning * into p;
      exit;
    exception when unique_violation then
      select * into p from public.promotions where voucher_order_id = o.id;   -- a parallel call made it
      if p.id is not null then exit; end if;
      if tries >= 8 then return jsonb_build_object('status', 'none'); end if;
    end;
  end loop;
  return app.voucher_json(p);
end $$;

-- how the actions did (managers): codes issued, used, given away and the sales of those orders
create or replace function public.guest_voucher_stats(p_restaurant_id uuid, p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(365, p_days)));
begin
  perform app.require_role(p_restaurant_id, 'manager', false);
  return jsonb_build_object(
    'issued', (select count(*) from public.promotions p where p.restaurant_id = p_restaurant_id and p.voucher and p.created_at >= since),
    'used', (select count(*) from public.orders o join public.promotions p on p.id = o.promo_id
              where p.restaurant_id = p_restaurant_id and p.voucher and o.status <> 'cancelled' and o.created_at >= since),
    'given_cents', (select coalesce(sum(o.discount_cents), 0) from public.orders o join public.promotions p on p.id = o.promo_id
                     where p.restaurant_id = p_restaurant_id and p.voucher and o.status <> 'cancelled' and o.created_at >= since),
    'revenue_cents', (select coalesce(sum(o.total_cents), 0) from public.orders o join public.promotions p on p.id = o.promo_id
                       where p.restaurant_id = p_restaurant_id and p.voucher and o.status <> 'cancelled' and o.created_at >= since));
end $$;

revoke all on function public.issue_guest_voucher(uuid, text) from public;
revoke all on function public.guest_voucher_stats(uuid, integer) from public, anon;
grant execute on function public.issue_guest_voucher(uuid, text) to anon, authenticated;
grant execute on function public.guest_voucher_stats(uuid, integer) to authenticated;

-- the promotions report leaves the vouchers out (they have their own summary above)
create or replace function public.promo_report(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_role(p_restaurant_id, 'manager', false);
  return (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select p.id, p.name, p.kind,
           (select count(distinct l.order_id) from public.order_lines l join public.orders o on o.id = l.order_id
             where l.restaurant_id = p.restaurant_id and l.promo_id = p.id and o.closed_at is not null and o.business_date between p_from and p_to)
         + (select count(*) from public.orders o where o.restaurant_id = p.restaurant_id and o.promo_id = p.id and o.closed_at is not null and o.business_date between p_from and p_to) orders,
           (select coalesce(sum((l.list_price_cents - l.unit_price_cents) * l.quantity), 0) from public.order_lines l join public.orders o on o.id = l.order_id
             where l.restaurant_id = p.restaurant_id and l.promo_id = p.id and o.closed_at is not null and o.business_date between p_from and p_to)
         + (select coalesce(sum(o.discount_cents), 0) from public.orders o where o.restaurant_id = p.restaurant_id and o.promo_id = p.id and o.closed_at is not null and o.business_date between p_from and p_to) given_cents,
           (select coalesce(sum(o.total_cents), 0) from public.orders o where o.restaurant_id = p.restaurant_id and o.closed_at is not null and o.business_date between p_from and p_to
             and (o.promo_id = p.id or exists (select 1 from public.order_lines l where l.order_id = o.id and l.promo_id = p.id))) revenue_cents
      from public.promotions p where p.restaurant_id = p_restaurant_id and not p.voucher order by p.created_at) x);
end $$;
