-- =============================================================================
-- AMPLIFY AGENDA (14): "Mes chiffres" on the till
--
-- A person of the team sees their own month on the salon's till: revenue in prestations and
-- products, clients, commission by their pay rules, tips, and the days of the month. Asked with
-- their own PIN each time (the reception tablet is shared). Never the salary, the advances or
-- anybody else's numbers.
-- =============================================================================

create or replace function public.agenda_my_month(p_restaurant_id uuid, p_staff_id uuid, p_pin text, p_month date default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; res text; m date; f jsonb;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  res := app.check_staff_pin(r.id, p_staff_id, p_pin, 'staff');
  if res <> 'ok' then return jsonb_build_object('ok', false, 'error', res); end if;
  m := date_trunc('month', coalesce(p_month, app.business_date(r)))::date;
  if m > date_trunc('month', app.business_date(r))::date or m < (date_trunc('month', app.business_date(r)) - interval '12 months')::date then
    perform app.fail('invalid_date');
  end if;
  f := app.agenda_pay_compute(r, p_staff_id, m);
  return jsonb_build_object('ok', true, 'month', m, 'today', app.business_date(r),
    'clients', f -> 'clients', 'services_cents', f -> 'services_cents', 'products_cents', f -> 'products_cents',
    'has_plan', f -> 'has_plan', 'service_commission_cents', f -> 'service_commission_cents',
    'product_commission_cents', f -> 'product_commission_cents', 'commission_cents', f -> 'commission_cents', 'tips_cents', f -> 'tips_cents',
    'days', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'cents', c, 'clients', n) order by d) from (
        select s.business_date d, sum(l.line_cents - case when s.subtotal_cents > 0 then round(l.line_cents::numeric * s.discount_cents / s.subtotal_cents) else 0 end)::bigint c,
               count(distinct s.id) n
          from public.agenda_sale_lines l join public.agenda_sales s on s.id = l.sale_id
         where s.restaurant_id = r.id and s.cancelled_at is null and l.staff_id = p_staff_id
           and s.business_date >= m and s.business_date < (m + interval '1 month')::date
         group by 1) x), '[]'::jsonb));
end $$;
revoke all on function public.agenda_my_month(uuid, uuid, text, date) from public, anon;
grant execute on function public.agenda_my_month(uuid, uuid, text, date) to authenticated;

notify pgrst, 'reload schema';
