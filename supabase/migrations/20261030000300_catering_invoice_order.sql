-- =============================================================================
-- CATERING INVOICE: the ticket lists the dishes in the order of the catering order
-- (made in the SQL editor in production, brought into the code exactly as it runs there)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.catering_invoice(p_id uuid, p_buyer jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.catering_orders; r public.restaurants; o public.orders; l record; p record;
  total bigint; paid bigint; left_qty integer; n integer; k integer := 0; d jsonb; buyer jsonb := p_buyer;
begin
  select * into c from public.catering_orders where id = p_id for update;
  if c.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(c.restaurant_id, 'manager', true);
  if c.order_id is not null then perform app.fail('already_invoiced'); end if;
  if c.status in ('quote', 'cancelled') then perform app.fail('not_confirmed'); end if;
  if not exists (select 1 from public.catering_lines where restaurant_id = r.id and catering_id = c.id) then perform app.fail('order_empty'); end if;
  select coalesce(sum(unit_price_cents * qty), 0) + c.delivery_fee_cents into total
    from public.catering_lines where restaurant_id = r.id and catering_id = c.id;
  select coalesce(sum(amount_cents), 0) into paid from public.catering_payments where restaurant_id = r.id and catering_id = c.id;
  if paid <> total then perform app.fail('not_fully_paid', format('paid=%s total=%s', paid, total)); end if;
  if buyer is null and c.ice is not null then
    buyer := jsonb_strip_nulls(jsonb_build_object('name', coalesce(c.company, c.customer_name), 'ice', c.ice, 'address', c.address));
  end if;

  insert into public.orders (restaurant_id, client_id, source, order_type, status, customer_name, customer_phone, delivery_address, note)
  values (r.id, gen_random_uuid(), 'catering', case when c.mode = 'delivery' then 'delivery' else 'takeaway' end, 'served',
          left(coalesce(c.company, c.customer_name), 60), c.customer_phone, c.address, 'Traiteur CT-' || lpad(c.number::text, 4, '0'))
  returning * into o;

  perform set_config('app.copy_line', 'on', true);
  for l in select * from public.catering_lines where restaurant_id = r.id and catering_id = c.id order by sort_order, created_at loop
    left_qty := l.qty;
    while left_qty > 0 loop
      n := least(left_qty, 999);
      k := k + 1;   -- the ticket lists the lines in the order of the catering order
      insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp, station, kitchen_sent_at, served_at, created_at)
      values (r.id, o.id, l.menu_item_id, left(l.name, 120), l.unit_price_cents, n,
              coalesce(l.vat_bp, (select m.vat_bp from public.menu_items m where m.restaurant_id = r.id and m.id = l.menu_item_id), r.default_vat_bp),
              'kitchen', now(), now(), now() + make_interval(secs => k / 1000.0));
      left_qty := left_qty - n;
    end loop;
  end loop;
  if c.delivery_fee_cents > 0 then
    insert into public.order_lines (restaurant_id, order_id, name, unit_price_cents, quantity, vat_bp, station, kitchen_sent_at, served_at, created_at)
    values (r.id, o.id, 'Livraison', c.delivery_fee_cents, 1, r.default_vat_bp, 'kitchen', now(), now(), now() + make_interval(secs => (k + 1) / 1000.0));
  end if;
  perform set_config('app.copy_line', 'off', true);

  for p in select method, sum(amount_cents) amt from public.catering_payments where restaurant_id = r.id and catering_id = c.id group by method loop
    insert into public.payments (restaurant_id, order_id, method, amount_cents) values (r.id, o.id, p.method, p.amt);
  end loop;
  -- linked before closing: the ticket's stock trigger also takes the catering preparations out
  update public.catering_orders set order_id = o.id, invoiced_at = now(), status = 'delivered' where id = c.id;
  d := public.close_order(o.id, null, buyer);
  return jsonb_build_object('ok', true, 'order_id', o.id, 'document', d);
end $function$;
revoke all on function public.catering_invoice(uuid, jsonb) from public, anon;
grant execute on function public.catering_invoice(uuid, jsonb) to authenticated;
