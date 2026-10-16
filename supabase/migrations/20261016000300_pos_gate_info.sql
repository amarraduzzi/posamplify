-- =============================================================================
-- The till's welcome screen (staff pick their name): who is on duty (clocked in, not out) and how
-- many table bookings are left today. No money: the screen is seen by all staff.
-- =============================================================================
create or replace function public.pos_gate_info(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  return jsonb_build_object(
    'on_duty', (select coalesce(jsonb_agg(distinct s.staff_id), '[]'::jsonb) from public.staff_shifts s
                 where s.restaurant_id = r.id and s.clock_out is null and s.clock_in > now() - interval '16 hours'),
    'bookings_today', (select count(*) from public.reservations b
                        where b.restaurant_id = r.id and b.kind = 'booking' and b.status in ('requested', 'confirmed')
                          and (b.starts_at at time zone r.timezone)::date = (now() at time zone r.timezone)::date
                          and b.starts_at > now() - interval '30 minutes'));
end $$;
revoke all on function public.pos_gate_info(uuid) from public, anon;
grant execute on function public.pos_gate_info(uuid) to authenticated;
notify pgrst, 'reload schema';
