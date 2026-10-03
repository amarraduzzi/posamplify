-- Free trial: 14 days instead of 30, and never ending in the middle of a service.
--   * The trial ends at 04:00 (Morocco time) after 14 full days.
--   * After that, 3 days of grace: everything keeps working while the owner chooses a plan.
--   * Then the restaurant becomes read-only. Nothing is deleted.
-- Trials that already started keep the 30 days they were promised.

create or replace function app.trial_end()
returns timestamptz
language sql stable
set search_path = ''
as $$
  select ((date_trunc('day', now() at time zone 'Africa/Casablanca') + interval '15 days' + interval '4 hours')
          at time zone 'Africa/Casablanca')
$$;

alter table public.restaurants alter column trial_ends_at set default app.trial_end();

-- writable while on a running trial (+ 3 days grace) or an active subscription
create or replace function app.is_writable(r public.restaurants)
returns boolean
language sql stable
set search_path = ''
as $$
  select r.status = 'active'
      or (r.status = 'trial' and (r.trial_ends_at is null or r.trial_ends_at + interval '3 days' > now()))
$$;

create or replace function public.signup_restaurant(p_name text, p_slug text, p_city text default null,
                                                    p_products text[] default '{pos,profit}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid(); rid uuid; prods text[];
begin
  if uid is null or app.is_anonymous() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.memberships where user_id = uid and role = 'owner') >= 3 then
    perform app.fail('too_many_restaurants');
  end if;
  if nullif(btrim(p_name), '') is null then perform app.fail('name_required'); end if;
  if not public.slug_available(p_slug) then perform app.fail('slug_taken'); end if;
  prods := coalesce((select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit')), '{pos,profit}');
  if cardinality(prods) = 0 then prods := '{pos,profit}'; end if;

  insert into public.restaurants (slug, name, city, status, trial_ends_at, timezone, languages,
                                  accept_dine_in, accept_takeaway, branding, products)
  values (lower(p_slug), left(btrim(p_name), 80), nullif(btrim(p_city), ''), 'trial', app.trial_end(),
          'UTC', '{fr,ar,en}', true, true, '{"primary_color":"#C2410C","theme":"light"}', prods)
  returning id into rid;
  insert into public.memberships (restaurant_id, user_id, role) values (rid, uid, 'owner');
  return rid;
end $$;
revoke all on function public.signup_restaurant(text, text, text, text[]) from public, anon;
grant execute on function public.signup_restaurant(text, text, text, text[]) to authenticated;
