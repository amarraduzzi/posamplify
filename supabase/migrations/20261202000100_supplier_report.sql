-- "Situation fournisseurs": over a period, per supplier what was bought, paid and still owed (opening and
-- closing balance), compared with the period before; and per supplier the detail: each product (quantity,
-- average price, total, price change), each delivery (order number, invoice numbers, what was ordered and
-- what really came), each payment. Only data already recorded: purchases, orders, supplier entries, invoices.
set lock_timeout = '10s';

create or replace function public.supplier_report(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; len int; pf date; pt date; rows jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then perform app.fail('invalid_request', 'period'); end if;
  len := p_to - p_from + 1;
  pt := p_from - 1; pf := p_from - len;   -- the period just before, same length
  with sup as (
    select s.id, s.name, s.phone from public.suppliers s where s.restaurant_id = r.id
    union all select null::uuid, null::text, null::text),
  x as (
    select sup.id, sup.name, sup.phone,
      -- before the period: what was owed at its start
      coalesce((select sum(e.amount_cents) from public.supplier_entries e where e.restaurant_id = r.id and e.supplier_id = sup.id and e.kind = 'opening' and e.entry_on < p_from), 0)
      + coalesce((select sum(p.total_cents) from public.stock_purchases p where p.restaurant_id = r.id and p.supplier_id = sup.id and p.purchased_on < p_from), 0)
      - coalesce((select sum(e.amount_cents) from public.supplier_entries e where e.restaurant_id = r.id and e.supplier_id = sup.id and e.kind in ('payment', 'credit') and e.entry_on < p_from), 0) opening_cents,
      coalesce((select sum(e.amount_cents) from public.supplier_entries e where e.restaurant_id = r.id and e.supplier_id = sup.id and e.kind = 'opening' and e.entry_on between p_from and p_to), 0) opening_in_cents,
      coalesce((select sum(p.total_cents) from public.stock_purchases p where p.restaurant_id = r.id and p.supplier_id is not distinct from sup.id and p.purchased_on between p_from and p_to), 0) purchased_cents,
      (select count(distinct coalesce(p.purchase_order_id::text, p.purchased_on::text)) from public.stock_purchases p where p.restaurant_id = r.id and p.supplier_id is not distinct from sup.id and p.purchased_on between p_from and p_to) deliveries,
      (select count(*) from public.stock_purchases p where p.restaurant_id = r.id and p.supplier_id is not distinct from sup.id and p.purchased_on between p_from and p_to and p.total_cents is null) unpriced,
      coalesce((select sum(e.amount_cents) from public.supplier_entries e where e.restaurant_id = r.id and e.supplier_id = sup.id and e.kind = 'payment' and e.entry_on between p_from and p_to), 0) paid_cents,
      coalesce((select sum(e.amount_cents) from public.supplier_entries e where e.restaurant_id = r.id and e.supplier_id = sup.id and e.kind = 'credit' and e.entry_on between p_from and p_to), 0) credit_cents,
      coalesce((select sum(p.total_cents) from public.stock_purchases p where p.restaurant_id = r.id and p.supplier_id is not distinct from sup.id and p.purchased_on between pf and pt), 0) prev_purchased_cents
      from sup)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'name', x.name, 'phone', x.phone,
      'opening_cents', case when x.id is null then 0 else x.opening_cents end,
      'purchased_cents', x.purchased_cents, 'paid_cents', x.paid_cents, 'credit_cents', x.credit_cents,
      'closing_cents', case when x.id is null then 0 else x.opening_cents + x.opening_in_cents + x.purchased_cents - x.paid_cents - x.credit_cents end,
      'deliveries', x.deliveries, 'unpriced', x.unpriced, 'prev_purchased_cents', x.prev_purchased_cents)
      order by x.purchased_cents desc, x.name), '[]'::jsonb)
    into rows
    from x
   where x.purchased_cents <> 0 or x.paid_cents <> 0 or x.credit_cents <> 0 or x.deliveries > 0 or x.prev_purchased_cents <> 0
      or (x.id is not null and x.opening_cents + x.opening_in_cents <> 0);
  return jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', pf, 'prev_to', pt, 'restaurant', r.name, 'suppliers', rows);
end $$;
revoke all on function public.supplier_report(uuid, date, date) from public, anon;
grant execute on function public.supplier_report(uuid, date, date) to authenticated;

-- the detail of one supplier (p_supplier_id null: the purchases without supplier)
create or replace function public.supplier_report_detail(p_restaurant_id uuid, p_supplier_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; len int; pf date; products jsonb; deliveries jsonb; payments jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then perform app.fail('invalid_request', 'period'); end if;
  if p_supplier_id is not null and not exists (select 1 from public.suppliers where restaurant_id = r.id and id = p_supplier_id) then perform app.fail('not_found'); end if;
  len := p_to - p_from + 1; pf := p_from - len;

  -- per product: quantity in purchase units, average price per purchase unit, and the one of the period before
  select coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', g.id, 'name', g.name, 'base_unit', g.base_unit, 'purchase_unit', g.purchase_unit, 'purchase_qty', g.purchase_qty,
      'qty', a.qty, 'units', round(a.qty / nullif(g.purchase_qty, 0), 3), 'total_cents', a.total, 'lines', a.n,
      'avg_unit_cents', case when a.priced_qty > 0 then round(a.total * g.purchase_qty / a.priced_qty) end,
      'prev_avg_unit_cents', case when b.priced_qty > 0 then round(b.total * g.purchase_qty / b.priced_qty) end)
      order by a.total desc nulls last, g.name), '[]'::jsonb)
    into products
    from (select p.ingredient_id, sum(p.qty) qty, sum(p.total_cents) total, count(*) n, sum(p.qty) filter (where p.total_cents is not null) priced_qty
            from public.stock_purchases p
           where p.restaurant_id = r.id and p.supplier_id is not distinct from p_supplier_id and p.purchased_on between p_from and p_to
           group by 1) a
    join public.ingredients g on g.restaurant_id = r.id and g.id = a.ingredient_id
    left join (select p.ingredient_id, sum(p.total_cents) total, sum(p.qty) filter (where p.total_cents is not null) priced_qty
                 from public.stock_purchases p
                where p.restaurant_id = r.id and p.supplier_id is not distinct from p_supplier_id and p.purchased_on between pf and p_from - 1
                group by 1) b on b.ingredient_id = a.ingredient_id;

  -- per delivery: one order received, or the purchases of one day noted by hand
  select coalesce(jsonb_agg(d order by d->>'date' desc, d->>'number'), '[]'::jsonb)
    into deliveries
    from (
      select jsonb_build_object(
          'date', min(p.purchased_on), 'order_id', p.purchase_order_id, 'number', o.doc_number,
          'total_cents', sum(p.total_cents), 'lines', count(*),
          'invoices', (select coalesce(jsonb_agg(distinct d.doc_number) filter (where d.doc_number is not null), '[]'::jsonb) from public.supplier_documents d
                        where d.restaurant_id = r.id and ((p.purchase_order_id is not null and d.purchase_order_id = p.purchase_order_id)
                           or (p.purchase_order_id is null and d.supplier_id is not distinct from p_supplier_id and d.purchase_order_id is null and d.doc_date = min(p.purchased_on)))),
          -- ordered against delivered (an order only)
          'short', case when p.purchase_order_id is null then '[]'::jsonb else (
            select coalesce(jsonb_agg(jsonb_build_object('name', g.name, 'unit', g.purchase_unit, 'ordered', l.units, 'received', coalesce(l.received_units, 0)) order by g.name), '[]'::jsonb)
              from public.purchase_order_lines l join public.ingredients g on g.restaurant_id = r.id and g.id = l.ingredient_id
             where l.restaurant_id = r.id and l.order_id = p.purchase_order_id and coalesce(l.received_units, 0) <> l.units) end) d
        from public.stock_purchases p
        left join public.purchase_orders o on o.restaurant_id = r.id and o.id = p.purchase_order_id
       where p.restaurant_id = r.id and p.supplier_id is not distinct from p_supplier_id and p.purchased_on between p_from and p_to
       group by p.purchase_order_id, o.doc_number, case when p.purchase_order_id is null then p.purchased_on end) q;

  select coalesce(jsonb_agg(jsonb_build_object('date', e.entry_on, 'kind', e.kind, 'amount_cents', e.amount_cents, 'method', e.method, 'reference', e.reference, 'note', e.note)
           order by e.entry_on desc, e.created_at desc), '[]'::jsonb)
    into payments
    from public.supplier_entries e
   where e.restaurant_id = r.id and p_supplier_id is not null and e.supplier_id = p_supplier_id and e.entry_on between p_from and p_to;

  return jsonb_build_object('products', products, 'deliveries', deliveries, 'payments', payments);
end $$;
revoke all on function public.supplier_report_detail(uuid, uuid, date, date) from public, anon;
grant execute on function public.supplier_report_detail(uuid, uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
