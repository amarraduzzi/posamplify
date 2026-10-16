-- =============================================================================
-- Quick picks for taking orders on a phone at the table
-- * popular: the 12 dishes sold most in each part of the day (morning, noon, afternoon, evening),
--   over the last 4 weeks, so "Populaires" shows coffee in the morning and tajines at night.
-- * notes: the remarks staff type most often, per dish (sans oignon, bien cuit...) and overall,
--   over the last 90 days, so a remark is one tap.
-- The till keeps the result for offline use; it is read once when the order screen opens.
-- =============================================================================

create or replace function public.pos_quick_picks(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  return (
    with sold as (
      select l.menu_item_id, l.quantity, l.note,
             extract(hour from (o.created_at at time zone r.timezone))::int h, o.created_at
        from public.order_lines l
        join public.orders o on o.restaurant_id = l.restaurant_id and o.id = l.order_id
       where l.restaurant_id = r.id and l.menu_item_id is not null and o.status <> 'cancelled'
         and o.created_at > now() - interval '90 days'),
    part as (
      select menu_item_id, quantity,
             case when h between 5 and 10 then 'morning' when h between 11 and 14 then 'noon'
                  when h between 15 and 17 then 'afternoon' else 'evening' end p
        from sold where created_at > now() - interval '28 days'),
    ranked as (
      select p, menu_item_id, sum(quantity) n, row_number() over (partition by p order by sum(quantity) desc, menu_item_id) rk
        from part group by 1, 2),
    notes as (
      select menu_item_id, btrim(note) note, count(*) n
        from sold where nullif(btrim(note), '') is not null and length(btrim(note)) <= 40
       group by 1, 2),
    item_notes as (
      select menu_item_id, jsonb_agg(note order by n desc, note) list
        from (select *, row_number() over (partition by menu_item_id order by n desc, note) rk from notes where n >= 2) x
       where rk <= 4 group by 1),
    common as (
      select note, sum(n) n from notes group by 1 having sum(n) >= 3 order by 2 desc, 1 limit 6)
    select jsonb_build_object(
      'popular', (select coalesce(jsonb_object_agg(p, ids), '{}'::jsonb) from (
                    select p, jsonb_agg(menu_item_id order by rk) ids from ranked where rk <= 12 group by p) y),
      'notes', (select coalesce(jsonb_object_agg(menu_item_id, list), '{}'::jsonb) from item_notes),
      'common_notes', (select coalesce(jsonb_agg(note order by n desc, note), '[]'::jsonb) from common))
  );
end $$;
revoke all on function public.pos_quick_picks(uuid) from public, anon;
grant execute on function public.pos_quick_picks(uuid) to authenticated;

notify pgrst, 'reload schema';
