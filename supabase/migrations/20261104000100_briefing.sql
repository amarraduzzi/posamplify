-- =============================================================================
-- LE BRIEFING: the evening as the maître d' tells it to the team before service
--
-- One call gives the bookings of a day with what the team must know about each guest:
-- the profile (VIP, allergies, preferences, visits) when the restaurant keeps a customer
-- file, the times this phone did not come, and a birthday in the coming week.
-- The till turns it into one screen and one printed sheet.
-- =============================================================================

create or replace function public.pos_briefing(p_restaurant_id uuid, p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; d date; t0 timestamptz; files boolean;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  d := coalesce(p_day, (now() at time zone r.timezone)::date);
  if d < current_date - 400 or d > current_date + 400 then perform app.fail('invalid_request', 'day'); end if;
  t0 := d::timestamp at time zone r.timezone;
  files := coalesce((r.loyalty ->> 'customers')::boolean, false);
  return jsonb_build_object(
    'day', d,
    'files', files,
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id, 'starts_at', b.starts_at, 'status', b.status, 'source', b.source,
          'party_size', b.party_size, 'name', b.name, 'phone', b.phone, 'note', b.note,
          'table', t.label,
          'guest', case when files and c.id is not null then app.guest_brief(c) end,
          'no_shows', (select count(*) from public.reservations x
                        where x.restaurant_id = r.id and b.phone is not null and x.phone = b.phone and x.status = 'no_show'),
          -- days until the birthday (0 = today), only within the coming week
          'birthday_in', case when files and c.birthday is not null then (
              select n from (select case when bd >= d then bd - d else (bd + interval '1 year')::date - d end n
                               from (select (c.birthday + make_interval(years => (extract(year from d) - extract(year from c.birthday))::int))::date bd) y) z
               where n between 0 and 6) end
        ) order by b.starts_at, b.name)
        from public.reservations b
        left join public.dining_tables t on t.restaurant_id = r.id and t.id = b.table_id
        left join public.customers c on c.restaurant_id = r.id and c.phone = b.phone
       where b.restaurant_id = r.id and b.kind = 'booking'
         and b.status in ('requested', 'confirmed', 'seated')
         and b.starts_at >= t0 and b.starts_at < t0 + interval '1 day'
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.pos_briefing(uuid, date) from public, anon;
grant execute on function public.pos_briefing(uuid, date) to authenticated;

notify pgrst, 'reload schema';
