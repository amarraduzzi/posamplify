-- =============================================================================
-- FLOOR PLAN: where the tables stand, drawn in the till
--
-- Each zone of the restaurant (Salle, Terrasse, Étage... the zone of the tables) has its own plan on a grid of
-- 48 x 32 squares. A table gets a place on it (plan_x, plan_y), a size in squares, a shape (round or square /
-- long) and a number of seats. A table without a place is simply not on the plan (it stays in the list).
-- The fixed things of the room (bar, entrance, windows, walls, plants, a word) are in restaurants.floor_plan:
--   { "zones": { "<zone>": [ { "k": "bar", "x": 0, "y": 0, "w": 10, "h": 3, "t": "Bar" }, ... ] } }
-- save_floor_plan writes everything at once: an owner or manager account directly, a till with a manager PIN.
-- =============================================================================

alter table public.dining_tables
  add column if not exists plan_x smallint check (plan_x between 0 and 47),
  add column if not exists plan_y smallint check (plan_y between 0 and 31),
  add column if not exists plan_w smallint not null default 4 check (plan_w between 2 and 16),
  add column if not exists plan_h smallint not null default 4 check (plan_h between 2 and 16),
  add column if not exists plan_shape text not null default 'rect' check (plan_shape in ('rect', 'round')),
  add column if not exists seats smallint check (seats between 1 and 40);

alter table public.restaurants
  add column if not exists floor_plan jsonb not null default '{}'::jsonb;
alter table public.restaurants drop constraint if exists restaurants_floor_plan_check;
alter table public.restaurants add constraint restaurants_floor_plan_check
  check (jsonb_typeof(floor_plan) = 'object' and length(floor_plan::text) <= 20000);

create or replace function public.save_floor_plan(p_restaurant_id uuid, p_tables jsonb, p_plan jsonb,
  p_staff_id uuid default null, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; t jsonb; z text; it jsonb; res text; n int := 0;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  -- an owner or manager account may change the plan; a till asks a manager PIN
  if not (p_restaurant_id = any (app.my_restaurants('manager'))) then
    res := app.check_staff_pin(r.id, p_staff_id, p_pin, 'manager');
    if res <> 'ok' then return jsonb_build_object('ok', false, 'error', res); end if;
  end if;
  if jsonb_typeof(p_tables) <> 'array' or jsonb_array_length(p_tables) > 300 then perform app.fail('invalid_request', 'tables'); end if;
  if jsonb_typeof(p_plan) <> 'object' or length(p_plan::text) > 20000 then perform app.fail('invalid_request', 'plan'); end if;
  if p_plan ? 'zones' then
    if jsonb_typeof(p_plan -> 'zones') <> 'object' then perform app.fail('invalid_request', 'plan'); end if;
    for z, it in select key, value from jsonb_each(p_plan -> 'zones') loop
      if jsonb_typeof(it) <> 'array' or jsonb_array_length(it) > 60 or length(z) > 30 then perform app.fail('invalid_request', 'plan'); end if;
      if exists (select 1 from jsonb_array_elements(it) e
                  where coalesce(e ->> 'k', '') not in ('bar', 'door', 'window', 'wall', 'plant', 'text', 'kitchen')
                     or coalesce(e ->> 'x', '') !~ '^[0-9]{1,2}$' or coalesce(e ->> 'y', '') !~ '^[0-9]{1,2}$'
                     or coalesce(e ->> 'w', '') !~ '^[0-9]{1,2}$' or coalesce(e ->> 'h', '') !~ '^[0-9]{1,2}$'
                     or (e ->> 'x')::int > 47 or (e ->> 'y')::int > 31 or (e ->> 'w')::int not between 1 and 48 or (e ->> 'h')::int not between 1 and 32
                     or length(coalesce(e ->> 't', '')) > 30) then
        perform app.fail('invalid_request', 'plan');
      end if;
    end loop;
  end if;

  for t in select * from jsonb_array_elements(p_tables) loop
    if (t ->> 'id') is null or app.try_uuid(t ->> 'id') is null then perform app.fail('invalid_request', 'table'); end if;
    update public.dining_tables set
      plan_x = case when t -> 'x' = 'null'::jsonb or not (t ? 'x') then null else (t ->> 'x')::smallint end,
      plan_y = case when t -> 'y' = 'null'::jsonb or not (t ? 'y') then null else (t ->> 'y')::smallint end,
      plan_w = coalesce((t ->> 'w')::smallint, plan_w),
      plan_h = coalesce((t ->> 'h')::smallint, plan_h),
      plan_shape = coalesce(t ->> 'shape', plan_shape),
      seats = case when t ? 'seats' then nullif(t ->> 'seats', '')::smallint else seats end
     where restaurant_id = r.id and id = (t ->> 'id')::uuid;
    if found then n := n + 1; end if;
  end loop;
  update public.restaurants set floor_plan = p_plan where id = r.id;
  return jsonb_build_object('ok', true, 'tables', n);
end $$;
revoke all on function public.save_floor_plan(uuid, jsonb, jsonb, uuid, text) from public, anon;
grant execute on function public.save_floor_plan(uuid, jsonb, jsonb, uuid, text) to authenticated;

notify pgrst, 'reload schema';
