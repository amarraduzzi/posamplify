-- =============================================================================
-- AMPLIFY AGENDA (16): loyalty, packs of sessions and gift cards, all through the salon's till
--
-- * Loyalty: a stamp per paid visit (a ticket with a prestation); at the Nth visit the reward the
--   salon chose (restaurants.agenda -> 'loyalty': every, type percent|amount, value, name). Taking it
--   starts the card again.
-- * Packs: "5 brushings pour 600 DH" (agenda_packs). Sold at the till, paid at once or in parts
--   (pack_payment lines); each visit uses one session: the prestation is on the ticket at the value
--   of a session (the person who does it gets the commission on it), paid by the pack.
-- * Gift cards: sold at the till with a code (agenda_giftcards), spent in one or more visits.
-- What a pack or a gift card pays is "prepaid" (agenda_sales.prepaid_cents): cash + card + prepaid =
-- total + tip. A cancelled ticket gives everything back.
-- =============================================================================

create table if not exists public.agenda_packs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 60),
  service_id    uuid not null,
  sessions      integer not null check (sessions between 2 and 100),
  price_cents   bigint not null check (price_cents between 100 and 100000000),
  valid_days    integer not null default 365 check (valid_days between 7 and 1095),
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, service_id) references public.agenda_services (restaurant_id, id) on delete cascade
);

create table if not exists public.agenda_client_packs (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  pack_id        uuid,
  customer_id    uuid,
  phone          text not null,
  client_name    text check (length(client_name) <= 60),
  name           text not null,
  service_id     uuid,
  sessions_total integer not null check (sessions_total >= 1),
  sessions_left  integer not null check (sessions_left >= 0),
  price_cents    bigint not null check (price_cents >= 0),
  paid_cents     bigint not null default 0 check (paid_cents >= 0),
  expires_on     date not null,
  sale_id        uuid not null,
  created_at     timestamptz not null default now(),
  cancelled_at   timestamptz,
  unique (restaurant_id, id),
  check (paid_cents <= price_cents and sessions_left <= sessions_total),
  foreign key (restaurant_id, pack_id) references public.agenda_packs (restaurant_id, id) on delete set null (pack_id),
  foreign key (restaurant_id, customer_id) references public.customers (restaurant_id, id) on delete set null (customer_id),
  foreign key (restaurant_id, service_id) references public.agenda_services (restaurant_id, id) on delete set null (service_id),
  foreign key (restaurant_id, sale_id) references public.agenda_sales (restaurant_id, id) on delete cascade
);
create index if not exists agenda_client_packs_idx on public.agenda_client_packs (restaurant_id, phone);

create table if not exists public.agenda_giftcards (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  code           text not null unique check (code ~ '^[A-Z0-9-]{6,20}$'),
  initial_cents  bigint not null check (initial_cents between 100 and 100000000),
  balance_cents  bigint not null check (balance_cents >= 0),
  for_name       text check (length(for_name) <= 60),
  expires_on     date not null,
  sale_id        uuid not null,
  created_at     timestamptz not null default now(),
  cancelled_at   timestamptz,
  unique (restaurant_id, id),
  check (balance_cents <= initial_cents),
  foreign key (restaurant_id, sale_id) references public.agenda_sales (restaurant_id, id) on delete cascade
);
create index if not exists agenda_giftcards_idx on public.agenda_giftcards (restaurant_id, created_at desc);

create table if not exists public.agenda_prepaid_moves (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  sale_id        uuid not null,
  kind           text not null check (kind in ('pack_use', 'pack_payment', 'giftcard_use')),
  client_pack_id uuid,
  giftcard_id    uuid,
  sessions       integer not null default 0,
  amount_cents   bigint not null default 0,
  created_at     timestamptz not null default now(),
  foreign key (restaurant_id, sale_id) references public.agenda_sales (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, client_pack_id) references public.agenda_client_packs (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, giftcard_id) references public.agenda_giftcards (restaurant_id, id) on delete cascade
);
create index if not exists agenda_prepaid_moves_idx on public.agenda_prepaid_moves (restaurant_id, sale_id);

alter table public.agenda_sales add column if not exists prepaid_cents bigint not null default 0 check (prepaid_cents >= 0);
alter table public.agenda_sales add column if not exists loyalty_used boolean not null default false;
alter table public.agenda_sales drop constraint if exists agenda_sales_check1;
alter table public.agenda_sales drop constraint if exists agenda_sales_payment_check;
alter table public.agenda_sales add constraint agenda_sales_payment_check check (cash_cents + card_cents + prepaid_cents = total_cents + tip_cents);
alter table public.agenda_sale_lines drop constraint if exists agenda_sale_lines_kind_check;
alter table public.agenda_sale_lines add constraint agenda_sale_lines_kind_check check (kind in ('service', 'product', 'other', 'pack', 'pack_payment', 'giftcard'));
alter table public.agenda_sale_lines add column if not exists client_pack_id uuid;
alter table public.agenda_sale_lines add column if not exists giftcard_id uuid;

do $$ declare t text; begin
  foreach t in array array['agenda_packs', 'agenda_client_packs', 'agenda_giftcards', 'agenda_prepaid_moves'] loop
    execute format('drop trigger if exists %1$s_same_tenant on public.%1$s', t);
    execute format('create trigger %1$s_same_tenant before update on public.%1$s for each row execute function app.forbid_restaurant_change()', t);
    execute format('alter table public.%s enable row level security', t);
    execute format('revoke all on public.%s from anon, authenticated', t);
    execute format('grant select on public.%s to authenticated', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (restaurant_id = any ((select app.my_restaurants(%2$L))::uuid[]))',
                   t, case when t = 'agenda_packs' then 'device' else 'manager' end);
  end loop;
end $$;
-- the catalogue of packs: written by the owner and managers
grant insert (restaurant_id, name, service_id, sessions, price_cents, valid_days, active, sort_order) on public.agenda_packs to authenticated;
grant update (name, service_id, sessions, price_cents, valid_days, active, sort_order) on public.agenda_packs to authenticated;
drop policy if exists agenda_packs_insert on public.agenda_packs;
create policy agenda_packs_insert on public.agenda_packs for insert to authenticated with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
drop policy if exists agenda_packs_update on public.agenda_packs;
create policy agenda_packs_update on public.agenda_packs for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[])) with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));

-- the loyalty settings of a salon, checked
create or replace function app.agenda_loyalty_cfg(r public.restaurants)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'enabled', coalesce((r.agenda -> 'loyalty' ->> 'enabled')::boolean, false),
    'every', least(50, greatest(2, coalesce((r.agenda -> 'loyalty' ->> 'every')::int, 10))),
    'type', case when r.agenda -> 'loyalty' ->> 'type' = 'amount' then 'amount' else 'percent' end,
    'value', greatest(0, coalesce((r.agenda -> 'loyalty' ->> 'value')::numeric, 0)),
    'name', coalesce(nullif(btrim(r.agenda -> 'loyalty' ->> 'name'), ''), 'Récompense fidélité'))
$$;

-- the stamps of a client: paid visits with a prestation since the last reward taken
create or replace function app.agenda_stamps(r public.restaurants, p_phone text)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.agenda_sales s
   where s.restaurant_id = r.id and s.phone = p_phone and s.cancelled_at is null and s.total_cents + s.prepaid_cents > 0 and not s.loyalty_used
     and exists (select 1 from public.agenda_sale_lines l where l.sale_id = s.id and l.kind = 'service')
     and s.created_at > coalesce((select max(x.created_at) from public.agenda_sales x
                                   where x.restaurant_id = r.id and x.phone = p_phone and x.cancelled_at is null and x.loyalty_used), '-infinity')
$$;
revoke all on function app.agenda_stamps(public.restaurants, text) from public, anon, authenticated;

-- what a client has at the till: stamps, packs, what is still due on them
create or replace function public.agenda_client_wallet(p_restaurant_id uuid, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; ph text := app.norm_phone(p_phone); c jsonb; st int;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  if ph is null or ph !~ '^\+?[0-9]{6,15}$' then return null; end if;
  c := app.agenda_loyalty_cfg(r); st := app.agenda_stamps(r, ph);
  return jsonb_build_object(
    'name', (select name from public.customers where restaurant_id = r.id and phone = ph),
    'loyalty', c || jsonb_build_object('stamps', st, 'ready', (c ->> 'enabled')::boolean and st >= (c ->> 'every')::int),
    'packs', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'service_id', p.service_id, 'left', p.sessions_left, 'total', p.sessions_total,
                         'expires_on', p.expires_on, 'due_cents', p.price_cents - p.paid_cents, 'session_cents', round(p.price_cents::numeric / p.sessions_total)::bigint) order by p.created_at)
       from public.agenda_client_packs p
      where p.restaurant_id = r.id and p.phone = ph and p.cancelled_at is null and p.expires_on >= app.business_date(r)
        and (p.sessions_left > 0 or p.paid_cents < p.price_cents)), '[]'::jsonb));
end $$;
revoke all on function public.agenda_client_wallet(uuid, text) from public, anon;
grant execute on function public.agenda_client_wallet(uuid, text) to authenticated;

create or replace function public.agenda_giftcard_check(p_restaurant_id uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; g public.agenda_giftcards;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  select * into g from public.agenda_giftcards where restaurant_id = r.id and code = upper(btrim(p_code));
  if g.id is null or g.cancelled_at is not null then return jsonb_build_object('ok', false, 'error', 'giftcard_unknown'); end if;
  if g.expires_on < app.business_date(r) then return jsonb_build_object('ok', false, 'error', 'giftcard_expired', 'expires_on', g.expires_on); end if;
  if g.balance_cents <= 0 then return jsonb_build_object('ok', false, 'error', 'giftcard_empty'); end if;
  return jsonb_build_object('ok', true, 'code', g.code, 'balance_cents', g.balance_cents, 'expires_on', g.expires_on, 'for_name', g.for_name);
end $$;
revoke all on function public.agenda_giftcard_check(uuid, text) from public, anon;
grant execute on function public.agenda_giftcard_check(uuid, text) to authenticated;

-- a cancelled ticket gives back what it took from packs and gift cards, and cancels what it sold
create or replace function app.agenda_sale_cancel_prepaid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.agenda_prepaid_moves;
begin
  if new.cancelled_at is not null and old.cancelled_at is null then
    for m in select * from public.agenda_prepaid_moves where sale_id = new.id loop
      if m.kind = 'pack_use' then update public.agenda_client_packs set sessions_left = least(sessions_total, sessions_left + m.sessions) where id = m.client_pack_id;
      elsif m.kind = 'pack_payment' then update public.agenda_client_packs set paid_cents = greatest(0, paid_cents - m.amount_cents) where id = m.client_pack_id;
      elsif m.kind = 'giftcard_use' then update public.agenda_giftcards set balance_cents = least(initial_cents, balance_cents + m.amount_cents) where id = m.giftcard_id;
      end if;
    end loop;
    update public.agenda_client_packs set cancelled_at = now() where sale_id = new.id and cancelled_at is null;
    update public.agenda_giftcards set cancelled_at = now() where sale_id = new.id and cancelled_at is null;
  end if;
  return new;
end $$;
drop trigger if exists agenda_sales_cancel_prepaid on public.agenda_sales;
create trigger agenda_sales_cancel_prepaid after update of cancelled_at on public.agenda_sales for each row execute function app.agenda_sale_cancel_prepaid();

-- Encaisser, complete. p: { appointment_id?, queue_id?, name?, phone?, staff_id?,
--   lines: [ {kind 'service', service_id?, unit_cents, quantity?, staff_id?, use_pack?}   (use_pack: a client pack, one session)
--          | {kind 'product', product_id, unit_cents, quantity?, staff_id?} | {kind 'other', name, unit_cents, quantity?}
--          | {kind 'pack', pack_id, unit_cents (paid now)} | {kind 'pack_payment', client_pack_id, unit_cents}
--          | {kind 'giftcard', unit_cents, name? (for whom)} ],
--   discount_cents?, discount_reason?, free_reason?, voucher_code?, loyalty?, giftcard_code?, giftcard_cents?,
--   cash_cents, card_cents, tip_cents? }
create or replace function public.agenda_checkout(p_restaurant_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.restaurants; d date; a public.agenda_appointments; q public.agenda_queue; l jsonb; v public.agenda_services;
  sid uuid; num int; sub bigint := 0; disc bigint; tot bigint; tip bigint; cash bigint; card bigint; prepaid bigint := 0;
  ph text; nm text; who uuid; cust uuid; i int := 0; ln_staff uuid; ln_name text; ln_qty int; ln_unit bigint; ln_kind text; pr public.agenda_products;
  counted_price bigint := 0; vo public.agenda_vouchers; vdisc bigint := 0; reason text;
  cp public.agenda_client_packs; pk public.agenda_packs; gc public.agenda_giftcards; gcp bigint := 0;
  uses jsonb := '{}'::jsonb; pays jsonb := '{}'::jsonb; units jsonb := '[]'::jsonb;
  lc jsonb := '{}'::jsonb; lred bigint := 0; loyal boolean := coalesce((p ->> 'loyalty')::boolean, false);
  new_cp uuid; new_gc uuid; gcode text; made jsonb := '[]'::jsonb; tries int;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  if not 'agenda' = any (r.products) then perform app.fail('not_allowed'); end if;
  d := app.business_date(r);
  if exists (select 1 from public.agenda_closings where restaurant_id = r.id and business_date = d) then perform app.fail('day_closed'); end if;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') not between 1 and 30 then perform app.fail('invalid_request', 'lines'); end if;

  nm := nullif(btrim(p ->> 'name'), ''); ph := app.norm_phone(nullif(p ->> 'phone', '')); who := nullif(p ->> 'staff_id', '')::uuid;
  if nullif(p ->> 'appointment_id', '') is not null then
    select * into a from public.agenda_appointments where id = (p ->> 'appointment_id')::uuid and restaurant_id = r.id for update;
    if a.id is null or a.status in ('cancelled', 'no_show') then perform app.fail('invalid_request', 'appointment'); end if;
    if exists (select 1 from public.agenda_sales where appointment_id = a.id and cancelled_at is null) then perform app.fail('already_paid'); end if;
    nm := coalesce(nm, a.name); ph := coalesce(ph, a.phone); who := coalesce(who, a.staff_id);
  elsif nullif(p ->> 'queue_id', '') is not null then
    select * into q from public.agenda_queue where id = (p ->> 'queue_id')::uuid and restaurant_id = r.id for update;
    if q.id is null or q.status in ('left', 'no_show') then perform app.fail('invalid_request', 'queue'); end if;
    if exists (select 1 from public.agenda_sales where queue_id = q.id and cancelled_at is null) then perform app.fail('already_paid'); end if;
    nm := coalesce(nm, q.name); ph := coalesce(ph, q.phone); who := coalesce(who, q.served_by, q.staff_id);
  end if;
  if who is not null and not exists (select 1 from public.staff where id = who and restaurant_id = r.id) then perform app.fail('invalid_request', 'staff'); end if;
  if ph is not null and ph !~ '^\+?[0-9]{6,15}$' then ph := null; end if;

  -- the lines: checked and priced before anything is written (units: the price of each line)
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    ln_kind := coalesce(l ->> 'kind', case when nullif(l ->> 'product_id', '') is not null then 'product' else 'service' end);
    if ln_kind not in ('service', 'product', 'other', 'pack', 'pack_payment', 'giftcard') then perform app.fail('invalid_request', 'kind'); end if;
    ln_unit := (l ->> 'unit_cents')::bigint; ln_qty := coalesce((l ->> 'quantity')::int, 1);
    if nullif(l ->> 'staff_id', '') is not null and not exists (select 1 from public.staff where id = (l ->> 'staff_id')::uuid and restaurant_id = r.id) then
      perform app.fail('invalid_request', 'staff');
    end if;
    if nullif(l ->> 'service_id', '') is not null and not exists (select 1 from public.agenda_services where id = (l ->> 'service_id')::uuid and restaurant_id = r.id) then
      perform app.fail('invalid_request', 'service');
    end if;
    if ln_kind = 'product' and nullif(l ->> 'product_id', '') is not null
       and not exists (select 1 from public.agenda_products where id = (l ->> 'product_id')::uuid and restaurant_id = r.id and kind = 'retail') then
      perform app.fail('invalid_request', 'product');
    end if;
    if ln_kind = 'service' and nullif(l ->> 'use_pack', '') is not null then
      -- a session of a pack: one per line, at the value of a session, paid by the pack
      select * into cp from public.agenda_client_packs where id = app.try_uuid(l ->> 'use_pack') and restaurant_id = r.id for update;
      if cp.id is null or cp.cancelled_at is not null or cp.expires_on < d then perform app.fail('pack_unknown'); end if;
      if ph is null or cp.phone <> ph then perform app.fail('pack_not_client'); end if;
      if cp.service_id is not null and nullif(l ->> 'service_id', '') is not null and cp.service_id <> (l ->> 'service_id')::uuid then perform app.fail('pack_other_service'); end if;
      uses := jsonb_set(uses, array[cp.id::text], to_jsonb(coalesce((uses ->> cp.id::text)::int, 0) + 1));
      if (uses ->> cp.id::text)::int > cp.sessions_left then perform app.fail('pack_empty'); end if;
      ln_unit := round(cp.price_cents::numeric / cp.sessions_total)::bigint; ln_qty := 1;
      prepaid := prepaid + ln_unit;
    elsif ln_kind = 'pack' then
      select * into pk from public.agenda_packs where id = app.try_uuid(l ->> 'pack_id') and restaurant_id = r.id and active;
      if pk.id is null then perform app.fail('invalid_request', 'pack'); end if;
      if ph is null then perform app.fail('phone_required'); end if;
      ln_qty := 1; ln_unit := coalesce(ln_unit, pk.price_cents);
      if ln_unit < 1 or ln_unit > pk.price_cents then perform app.fail('invalid_request', 'price'); end if;
    elsif ln_kind = 'pack_payment' then
      select * into cp from public.agenda_client_packs where id = app.try_uuid(l ->> 'client_pack_id') and restaurant_id = r.id for update;
      if cp.id is null or cp.cancelled_at is not null then perform app.fail('pack_unknown'); end if;
      pays := jsonb_set(pays, array[cp.id::text], to_jsonb(coalesce((pays ->> cp.id::text)::bigint, 0) + coalesce(ln_unit, 0)));
      ln_qty := 1;
      if coalesce(ln_unit, 0) < 1 or cp.paid_cents + (pays ->> cp.id::text)::bigint > cp.price_cents then perform app.fail('invalid_request', 'price'); end if;
    elsif ln_kind = 'giftcard' then
      ln_qty := 1;
      if ln_unit is null or ln_unit not between 1000 and 10000000 then perform app.fail('invalid_request', 'price'); end if;
    end if;
    if ln_unit is null or ln_unit not between 0 and 10000000 or ln_qty not between 1 and 99 then perform app.fail('invalid_request', 'price'); end if;
    units := units || jsonb_build_array(jsonb_build_object('unit', ln_unit, 'qty', ln_qty, 'kind', ln_kind));
    sub := sub + ln_unit * ln_qty;
  end loop;

  disc := coalesce((p ->> 'discount_cents')::bigint, 0);
  if disc < 0 or disc > sub then perform app.fail('invalid_request', 'discount'); end if;
  reason := nullif(btrim(p ->> 'discount_reason'), '');
  -- a code from the client's story (Le miroir): checked and applied here, used once
  if nullif(btrim(p ->> 'voucher_code'), '') is not null then
    select * into vo from public.agenda_vouchers where restaurant_id = r.id and code = upper(btrim(p ->> 'voucher_code')) for update;
    if vo.id is null then perform app.fail('voucher_unknown'); end if;
    if vo.used_sale_id is not null then perform app.fail('voucher_used'); end if;
    if d < vo.starts_on or d > vo.ends_on or not (extract(isodow from d)::int = any (vo.days)) then perform app.fail('voucher_not_today'); end if;
    if sub < vo.min_cents then perform app.fail('voucher_min'); end if;
    vdisc := case when vo.kind = 'percent' then round(sub::numeric * vo.value / 10000)::bigint when vo.kind = 'amount' then least(vo.value, sub) else 0 end;
    disc := least(sub, disc + vdisc);
    reason := concat_ws(' · ', reason, 'Code ' || vo.code || case when vo.kind = 'gift' then ' : ' || vo.name else '' end);
  end if;
  -- the loyalty reward: only when the client has her stamps
  if loyal then
    lc := app.agenda_loyalty_cfg(r);
    if not (lc ->> 'enabled')::boolean or ph is null or app.agenda_stamps(r, ph) < (lc ->> 'every')::int then perform app.fail('loyalty_not_ready'); end if;
    lred := case when lc ->> 'type' = 'percent' then round(sub::numeric * least((lc ->> 'value')::numeric, 100) / 100)::bigint
                 else least(round((lc ->> 'value')::numeric * 100)::bigint, sub) end;
    disc := least(sub, disc + lred);
    reason := concat_ws(' · ', reason, 'Fidélité : ' || (lc ->> 'name'));
  end if;
  tot := sub - disc;
  -- a gift card pays part of it
  if nullif(btrim(p ->> 'giftcard_code'), '') is not null then
    select * into gc from public.agenda_giftcards where restaurant_id = r.id and code = upper(btrim(p ->> 'giftcard_code')) for update;
    if gc.id is null or gc.cancelled_at is not null then perform app.fail('giftcard_unknown'); end if;
    if gc.expires_on < d then perform app.fail('giftcard_expired'); end if;
    gcp := coalesce((p ->> 'giftcard_cents')::bigint, 0);
    if gcp < 1 or gcp > gc.balance_cents then perform app.fail('giftcard_balance'); end if;
    prepaid := prepaid + gcp;
  end if;
  if tot = 0 and coalesce(btrim(p ->> 'free_reason'), '') = '' and vo.id is null and not loyal then perform app.fail('free_reason_required'); end if;
  tip := coalesce((p ->> 'tip_cents')::bigint, 0); cash := coalesce((p ->> 'cash_cents')::bigint, 0); card := coalesce((p ->> 'card_cents')::bigint, 0);
  if tip < 0 or cash < 0 or card < 0 or prepaid > tot + tip or cash + card + prepaid <> tot + tip then perform app.fail('payment_mismatch'); end if;

  -- the visit counts (the appointment or the Nouba entry is done)
  if a.id is not null then
    if a.status <> 'done' then update public.agenda_appointments set status = 'done' where id = a.id; end if;
    if a.phone is not null and a.phone = ph then counted_price := a.price_cents; end if;
  elsif q.id is not null and q.status <> 'done' then
    update public.agenda_queue set status = 'done', ended_at = coalesce(ended_at, now()), started_at = coalesce(started_at, now()) where id = q.id;
  end if;

  -- the client: the list knows what she really paid
  if ph is not null then
    insert into public.customers (restaurant_id, phone, name) values (r.id, ph, left(coalesce(nm, ph), 60))
    on conflict (restaurant_id, phone) do update set name = coalesce(public.customers.name, excluded.name)
    returning id into cust;
    if a.id is not null and a.phone is not null and a.phone = ph then
      update public.customers set spent_cents = greatest(0, spent_cents + tot - counted_price) where id = cust;
    else
      update public.customers set spent_cents = spent_cents + tot, visits = visits + 1,
             first_visit_at = coalesce(first_visit_at, now()), last_visit_at = now() where id = cust;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('agenda_sales' || r.id::text || d::text));
  select coalesce(max(number), 0) + 1 into num from public.agenda_sales where restaurant_id = r.id and business_date = d;
  insert into public.agenda_sales (restaurant_id, business_date, number, appointment_id, queue_id, customer_id, name, phone, staff_id,
                                   subtotal_cents, discount_cents, discount_reason, total_cents, cash_cents, card_cents, tip_cents, prepaid_cents, loyalty_used, free_reason, created_by)
  values (r.id, d, num, a.id, q.id, cust, nm, ph, who, sub, disc, left(reason, 100), tot, cash, card, tip, prepaid, loyal,
          case when tot = 0 then left(coalesce(nullif(btrim(p ->> 'free_reason'), ''), case when loyal then 'Fidélité' else 'Code ' || vo.code end), 100) end, auth.uid())
  returning id into sid;
  if vo.id is not null then update public.agenda_vouchers set used_sale_id = sid, used_at = now(), used_cents = vdisc where id = vo.id; end if;
  if gc.id is not null then
    update public.agenda_giftcards set balance_cents = balance_cents - gcp where id = gc.id;
    insert into public.agenda_prepaid_moves (restaurant_id, sale_id, kind, giftcard_id, amount_cents) values (r.id, sid, 'giftcard_use', gc.id, gcp);
  end if;

  for l in select * from jsonb_array_elements(p -> 'lines') loop
    ln_kind := (units -> i ->> 'kind'); ln_unit := (units -> i ->> 'unit')::bigint; ln_qty := (units -> i ->> 'qty')::int;
    v := null; pr := null; cp := null; pk := null; new_cp := null; new_gc := null;
    if nullif(l ->> 'service_id', '') is not null then select * into v from public.agenda_services where id = (l ->> 'service_id')::uuid; end if;
    if ln_kind = 'product' and nullif(l ->> 'product_id', '') is not null then select * into pr from public.agenda_products where id = (l ->> 'product_id')::uuid; end if;
    ln_staff := case when ln_kind in ('pack', 'pack_payment', 'giftcard') then null
                     else coalesce(nullif(l ->> 'staff_id', '')::uuid, case when ln_kind = 'service' then who end) end;
    if ln_kind = 'service' and nullif(l ->> 'use_pack', '') is not null then
      select * into cp from public.agenda_client_packs where id = (l ->> 'use_pack')::uuid;
      if v.id is null and cp.service_id is not null then select * into v from public.agenda_services where id = cp.service_id; end if;
      update public.agenda_client_packs set sessions_left = sessions_left - 1 where id = cp.id;
      insert into public.agenda_prepaid_moves (restaurant_id, sale_id, kind, client_pack_id, sessions, amount_cents) values (r.id, sid, 'pack_use', cp.id, 1, ln_unit);
      ln_name := coalesce(v.name ->> 'fr', v.name ->> 'ar', cp.name) || ' (' || cp.name || ')';
    elsif ln_kind = 'pack' then
      select * into pk from public.agenda_packs where id = (l ->> 'pack_id')::uuid;
      insert into public.agenda_client_packs (restaurant_id, pack_id, customer_id, phone, client_name, name, service_id, sessions_total, sessions_left, price_cents, paid_cents, expires_on, sale_id)
      values (r.id, pk.id, cust, ph, nm, pk.name, pk.service_id, pk.sessions, pk.sessions, pk.price_cents, ln_unit, d + pk.valid_days, sid)
      returning id into new_cp;
      ln_name := pk.name || case when ln_unit < pk.price_cents then ' (1er versement)' else '' end;
      made := made || jsonb_build_array(jsonb_build_object('kind', 'pack', 'id', new_cp, 'name', pk.name, 'sessions', pk.sessions, 'due_cents', pk.price_cents - ln_unit));
    elsif ln_kind = 'pack_payment' then
      select * into cp from public.agenda_client_packs where id = (l ->> 'client_pack_id')::uuid;
      update public.agenda_client_packs set paid_cents = paid_cents + ln_unit where id = cp.id;
      insert into public.agenda_prepaid_moves (restaurant_id, sale_id, kind, client_pack_id, amount_cents) values (r.id, sid, 'pack_payment', cp.id, ln_unit);
      ln_name := 'Versement : ' || cp.name;
    elsif ln_kind = 'giftcard' then
      tries := 0;
      loop
        tries := tries + 1;
        gcode := 'KDO-' || (select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
        begin
          insert into public.agenda_giftcards (restaurant_id, code, initial_cents, balance_cents, for_name, expires_on, sale_id)
          values (r.id, gcode, ln_unit, ln_unit, nullif(left(btrim(l ->> 'name'), 60), ''), d + 365, sid) returning id into new_gc;
          exit;
        exception when unique_violation then
          if tries >= 8 then perform app.fail('invalid_request', 'giftcard'); end if;
        end;
      end loop;
      ln_name := 'Carte cadeau ' || gcode || coalesce(' pour ' || nullif(btrim(l ->> 'name'), ''), '');
      made := made || jsonb_build_array(jsonb_build_object('kind', 'giftcard', 'id', new_gc, 'code', gcode, 'amount_cents', ln_unit, 'expires_on', d + 365));
    else
      ln_name := coalesce(nullif(btrim(l ->> 'name'), ''), pr.name, v.name ->> 'fr', v.name ->> 'ar', v.name ->> 'en', 'Prestation');
    end if;
    insert into public.agenda_sale_lines (restaurant_id, sale_id, kind, service_id, product_id, client_pack_id, giftcard_id, name, quantity, unit_cents, staff_id, sort)
    values (r.id, sid, ln_kind, v.id, pr.id, coalesce(cp.id, new_cp), new_gc, left(ln_name, 80), ln_qty, ln_unit, ln_staff, i);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', sid, 'number', num, 'business_date', d, 'total_cents', tot, 'tip_cents', tip, 'voucher_cents', vdisc, 'loyalty_cents', lred,
                            'prepaid_cents', prepaid, 'share_token', (select share_token from public.agenda_sales where id = sid), 'made', made,
                            'stamps', case when ph is not null and (app.agenda_loyalty_cfg(r) ->> 'enabled')::boolean then app.agenda_stamps(r, ph) end,
                            'every', case when (app.agenda_loyalty_cfg(r) ->> 'enabled')::boolean then (app.agenda_loyalty_cfg(r) ->> 'every')::int end,
                            'cash_cents', cash, 'card_cents', card, 'name', nm, 'phone', ph);
end $$;
revoke all on function public.agenda_checkout(uuid, jsonb) from public, anon;
grant execute on function public.agenda_checkout(uuid, jsonb) to authenticated;

-- the packs and gift cards of the salon (owner and managers): what is sold, used, still due
create or replace function public.agenda_prepaid_list(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  return jsonb_build_object(
    'packs', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'client', p.client_name, 'phone', p.phone, 'left', p.sessions_left, 'total', p.sessions_total,
                         'price_cents', p.price_cents, 'paid_cents', p.paid_cents, 'expires_on', p.expires_on, 'created_at', p.created_at) order by p.created_at desc)
       from public.agenda_client_packs p where p.restaurant_id = r.id and p.cancelled_at is null and (p.sessions_left > 0 or p.paid_cents < p.price_cents)), '[]'::jsonb),
    'giftcards', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'for', g.for_name, 'initial_cents', g.initial_cents, 'balance_cents', g.balance_cents,
                         'expires_on', g.expires_on, 'created_at', g.created_at) order by g.created_at desc)
       from public.agenda_giftcards g where g.restaurant_id = r.id and g.cancelled_at is null and g.balance_cents > 0), '[]'::jsonb),
    'outstanding_cents', (select coalesce(sum(balance_cents), 0) from public.agenda_giftcards where restaurant_id = r.id and cancelled_at is null and expires_on >= app.business_date(r))
                       + (select coalesce(sum(round(price_cents::numeric * sessions_left / sessions_total)), 0) from public.agenda_client_packs where restaurant_id = r.id and cancelled_at is null and expires_on >= app.business_date(r))::bigint);
end $$;
revoke all on function public.agenda_prepaid_list(uuid) from public, anon;
grant execute on function public.agenda_prepaid_list(uuid) to authenticated;

notify pgrst, 'reload schema';
