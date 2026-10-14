-- =============================================================================
-- A forgotten Z: the days that had sales but were never closed (last 60 days, before today).
-- The till shows them under Caisse & rapports and lets a manager close them afterwards
-- (close_day already accepts a past day; there is no cash count then, since today's cash
-- is already in the drawer).
-- =============================================================================
create or replace function public.unclosed_days(p_restaurant_id uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare r public.restaurants; today date;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  today := app.business_date(r);
  return coalesce((
    select jsonb_agg(jsonb_build_object('business_date', d.business_date, 'tickets', d.tickets, 'revenue_ttc_cents', d.revenue) order by d.business_date)
      from (select f.business_date,
                   count(*) filter (where f.doc_type <> 'credit_note') as tickets,
                   sum(f.total_ttc_cents) as revenue
              from public.fiscal_documents f
             where f.restaurant_id = r.id and f.business_date < today and f.business_date >= today - 60
               and not exists (select 1 from public.day_closures c where c.restaurant_id = r.id and c.business_date = f.business_date)
             group by f.business_date) d), '[]'::jsonb);
end $$;
revoke all on function public.unclosed_days(uuid) from public, anon;
grant execute on function public.unclosed_days(uuid) to authenticated;
