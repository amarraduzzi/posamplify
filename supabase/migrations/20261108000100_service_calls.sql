-- =============================================================================
-- LE SERVICE DISCRET (Amplify Maître): the guest calls without raising a hand
--
-- On the table's QR page the guest taps "Un serveur", "De l'eau" or "L'addition". The table lights up
-- on the floor plan and on the waiters' phones; a waiter taps "C'est fait". The guest sees that the
-- call was seen and when it was answered. One open call per kind and table: tapping twice does not
-- ring twice. Only from a table QR (the table's secret token), only with Amplify Maître.
-- =============================================================================

create table if not exists public.service_calls (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id      uuid not null,
  kind          text not null check (kind in ('waiter', 'water', 'bill')),
  created_at    timestamptz not null default now(),
  done_at       timestamptz,
  done_by       uuid,
  foreign key (restaurant_id, table_id) references public.dining_tables (restaurant_id, id) on delete cascade
);
create index if not exists service_calls_open_idx on public.service_calls (restaurant_id, created_at) where done_at is null;
create unique index if not exists service_calls_one_open on public.service_calls (table_id, kind) where done_at is null;
alter table public.service_calls enable row level security;
grant select on public.service_calls to authenticated;
drop policy if exists service_calls_select on public.service_calls;
create policy service_calls_select on public.service_calls for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));

-- the table of a QR token, when the restaurant offers the service (Amplify Maître)
create or replace function app.service_table(p_slug text, p_table_token text)
returns public.dining_tables language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; t public.dining_tables;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null or not app.has_maitre(r) or not app.is_writable(r) or coalesce((r.pos_settings ->> 'service_calls')::boolean, true) = false then return null; end if;
  select * into t from public.dining_tables where restaurant_id = r.id and qr_token = p_table_token and active;
  return t;
end $$;

-- Public: what the guest's page shows (the service on or off, the calls of this table still open)
create or replace function public.table_service(p_slug text, p_table_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.dining_tables;
begin
  t := app.service_table(p_slug, p_table_token);
  if t.id is null then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true, 'open', coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'at', created_at) order by created_at)
      from public.service_calls where table_id = t.id and done_at is null and created_at > now() - interval '3 hours'), '[]'::jsonb),
    'done', coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'at', done_at) order by done_at)
      from public.service_calls where table_id = t.id and done_at > now() - interval '2 minutes'), '[]'::jsonb));
end $$;

-- Public: the guest calls
create or replace function public.call_service(p_slug text, p_table_token text, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.dining_tables; c public.service_calls;
begin
  if p_kind not in ('waiter', 'water', 'bill') then perform app.fail('invalid_request'); end if;
  t := app.service_table(p_slug, p_table_token);
  if t.id is null then perform app.fail('service_off'); end if;
  -- already called and not answered yet: the same call (old ones are closed by themselves)
  update public.service_calls set done_at = now() where table_id = t.id and done_at is null and created_at < now() - interval '3 hours';
  select * into c from public.service_calls where table_id = t.id and kind = p_kind and done_at is null;
  if c.id is not null then return jsonb_build_object('ok', true, 'at', c.created_at, 'again', true); end if;
  -- a table cannot ring all evening: 6 calls per 10 minutes at most
  if (select count(*) from public.service_calls where table_id = t.id and created_at > now() - interval '10 minutes') >= 6 then
    perform app.fail('rate_limited');
  end if;
  insert into public.service_calls (restaurant_id, table_id, kind) values (t.restaurant_id, t.id, p_kind) returning * into c;
  return jsonb_build_object('ok', true, 'at', c.created_at, 'again', false);
end $$;

-- The waiter answers (one call, or all the calls of a table)
create or replace function public.pos_service_done(p_restaurant_id uuid, p_call_id uuid default null, p_table_id uuid default null, p_staff_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; n int;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  if p_call_id is null and p_table_id is null then perform app.fail('invalid_request'); end if;
  update public.service_calls set done_at = now(), done_by = p_staff_id
   where restaurant_id = r.id and done_at is null
     and (p_call_id is null or id = p_call_id) and (p_table_id is null or table_id = p_table_id);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'done', n);
end $$;

revoke all on function app.service_table(text, text) from public, anon, authenticated;
revoke all on function public.table_service(text, text) from public;
revoke all on function public.call_service(text, text, text) from public;
revoke all on function public.pos_service_done(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.table_service(text, text) to anon, authenticated;
grant execute on function public.call_service(text, text, text) to anon, authenticated;
grant execute on function public.pos_service_done(uuid, uuid, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
