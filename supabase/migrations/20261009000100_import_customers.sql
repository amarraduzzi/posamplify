-- =============================================================================
-- Importing customers from another system (CSV or Excel, read in the browser)
-- import_customers(restaurant, rows): rows = [{phone, name, birthday, points, visits, spent_cents,
--   note, marketing_ok}], at most 5000 at a time. The phone number is the key: a customer who
-- already exists keeps what is filled in and gets what was missing; points, visits and spending
-- never go down. Points that come in are written in the loyalty ledger as an adjustment.
-- Lines without a usable phone number are skipped and counted.
-- =============================================================================
create or replace function public.import_customers(p_restaurant_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; x jsonb; ph text; c public.customers; was public.customers;
        created int := 0; updated int := 0; skipped int := 0; bday date; pts int; vis int; spent bigint;
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then perform app.fail('invalid_request', 'rows'); end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    ph := app.norm_phone(x ->> 'phone');
    if ph is null or ph !~ '^[0-9]{6,15}$' then skipped := skipped + 1; continue; end if;
    bday := case when (x ->> 'birthday') ~ '^\d{4}-\d{2}-\d{2}$' then (x ->> 'birthday')::date end;
    pts := greatest(0, least(coalesce(nullif(x ->> 'points', '')::numeric, 0), 10000000))::int;
    vis := greatest(0, least(coalesce(nullif(x ->> 'visits', '')::numeric, 0), 1000000))::int;
    spent := greatest(0, least(coalesce(nullif(x ->> 'spent_cents', '')::numeric, 0), 100000000000))::bigint;
    select * into was from public.customers where restaurant_id = r.id and phone = ph;
    perform set_config('app.loyalty_internal', 'on', true);
    insert into public.customers as cu (restaurant_id, phone, name, birthday, note, marketing_ok, points, visits, spent_cents)
    values (r.id, ph, nullif(left(btrim(coalesce(x ->> 'name', '')), 60), ''), bday,
            nullif(left(btrim(coalesce(x ->> 'note', '')), 300), ''), coalesce((x ->> 'marketing_ok')::boolean, false), pts, vis, spent)
    on conflict (restaurant_id, phone) do update set
      name = coalesce(cu.name, excluded.name),
      birthday = coalesce(cu.birthday, excluded.birthday),
      note = coalesce(cu.note, excluded.note),
      marketing_ok = cu.marketing_ok or excluded.marketing_ok,
      points = greatest(cu.points, excluded.points),
      visits = greatest(cu.visits, excluded.visits),
      spent_cents = greatest(cu.spent_cents, excluded.spent_cents)
    returning * into c;
    perform set_config('app.loyalty_internal', '', true);
    if c.points > coalesce(was.points, 0) then
      insert into public.loyalty_ledger (restaurant_id, customer_id, points, reason) values (r.id, c.id, c.points - coalesce(was.points, 0), 'adjust');
    end if;
    if was.id is null then created := created + 1; else updated := updated + 1; end if;
  end loop;
  return jsonb_build_object('created', created, 'updated', updated, 'skipped', skipped);
end $$;
revoke all on function public.import_customers(uuid, jsonb) from public, anon;
grant execute on function public.import_customers(uuid, jsonb) to authenticated;
