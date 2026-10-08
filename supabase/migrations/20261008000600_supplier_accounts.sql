-- =============================================================================
-- Supplier accounts and price comparison
-- * suppliers.payment_terms_days: 0 = paid on delivery, else the number of days allowed.
-- * supplier_entries: payments to a supplier, credit notes (returns, avoirs) and the opening
--   balance (what was already owed when the restaurant started with Amplify).
-- * supplier_balances: per supplier what was bought, paid, still owed, how much is overdue
--   (oldest purchases are paid first) and the next due date.
-- * supplier_statement: the history of one supplier with a running balance.
-- * supplier_compare: for ingredients bought from several suppliers, last and average price
--   per supplier over 6 months, and what buying from the cheapest would save.
-- =============================================================================
alter table public.suppliers add column if not exists payment_terms_days int not null default 0
  check (payment_terms_days between 0 and 180);

create table if not exists public.supplier_entries (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  supplier_id   uuid not null,
  kind          text not null check (kind in ('payment', 'credit', 'opening')),
  amount_cents  bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  entry_on      date not null default current_date,
  method        text check (method in ('cash', 'transfer', 'check', 'card')),
  reference     text check (length(reference) <= 60),
  note          text check (length(note) <= 200),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (restaurant_id, supplier_id) references public.suppliers (restaurant_id, id) on delete cascade
);
create index if not exists supplier_entries_idx on public.supplier_entries (restaurant_id, supplier_id, entry_on);

alter table public.supplier_entries enable row level security;
grant select, insert, delete on public.supplier_entries to authenticated;
drop policy if exists supplier_entries_select on public.supplier_entries;
drop policy if exists supplier_entries_insert on public.supplier_entries;
drop policy if exists supplier_entries_delete on public.supplier_entries;
create policy supplier_entries_select on public.supplier_entries for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
create policy supplier_entries_insert on public.supplier_entries for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy supplier_entries_delete on public.supplier_entries for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
drop trigger if exists audit_supplier_entries on public.supplier_entries;
create trigger audit_supplier_entries after insert or update or delete on public.supplier_entries
  for each row execute function app.audit();

create or replace function public.supplier_balances(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; today date;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  today := app.business_date(r);
  return (select coalesce(jsonb_agg(x order by x.overdue_cents desc, x.balance_cents desc, x.name), '[]'::jsonb) from (
    select s.id, s.name, s.phone, s.payment_terms_days terms,
           b.purchased_cents, b.paid_cents, b.credit_cents, b.opening_cents,
           b.opening_cents + b.purchased_cents - b.paid_cents - b.credit_cents balance_cents,
           coalesce(d.overdue_cents, 0) overdue_cents, d.oldest_overdue, d.next_due, d.next_due_cents,
           (select max(p.purchased_on) from public.stock_purchases p where p.restaurant_id = r.id and p.supplier_id = s.id) last_purchase,
           (select coalesce(sum(p.total_cents), 0) from public.stock_purchases p where p.restaurant_id = r.id and p.supplier_id = s.id and p.purchased_on > today - 30) last_30d_cents
      from public.suppliers s
      cross join lateral (
        select coalesce((select sum(p.total_cents) from public.stock_purchases p where p.restaurant_id = r.id and p.supplier_id = s.id), 0) purchased_cents,
               coalesce((select sum(e.amount_cents) from public.supplier_entries e where e.supplier_id = s.id and e.kind = 'payment'), 0) paid_cents,
               coalesce((select sum(e.amount_cents) from public.supplier_entries e where e.supplier_id = s.id and e.kind = 'credit'), 0) credit_cents,
               coalesce((select sum(e.amount_cents) from public.supplier_entries e where e.supplier_id = s.id and e.kind = 'opening'), 0) opening_cents) b
      -- what is owed, oldest first; payments and credit notes pay the oldest debts first
      cross join lateral (
        select sum(left_cents) filter (where due < today) overdue_cents,
               min(due) filter (where due < today and left_cents > 0) oldest_overdue,
               min(due) filter (where due >= today and left_cents > 0) next_due,
               (array_agg(left_cents order by due) filter (where due >= today and left_cents > 0))[1] next_due_cents
          from (select due, greatest(0, least(amount, cum - (b.paid_cents + b.credit_cents))) left_cents
                  from (select due, amount, sum(amount) over (order by due, k) cum
                          from (select e.entry_on due, e.amount_cents amount, e.id::text k from public.supplier_entries e where e.supplier_id = s.id and e.kind = 'opening'
                                union all
                                select p.purchased_on + s.payment_terms_days, p.total_cents, p.id::text from public.stock_purchases p
                                 where p.restaurant_id = r.id and p.supplier_id = s.id and p.total_cents > 0) debts) c) l) d
     where s.restaurant_id = r.id and (s.active or b.opening_cents + b.purchased_cents - b.paid_cents - b.credit_cents <> 0)
  ) x);
end $$;

create or replace function public.supplier_statement(p_supplier_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.suppliers;
begin
  select * into s from public.suppliers where id = p_supplier_id;
  if s.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(s.restaurant_id, 'manager', false);
  return (select coalesce(jsonb_agg(x order by x.on_date desc, x.at desc), '[]'::jsonb) from (
    select *, sum(signed) over (order by on_date, at) balance_cents from (
      select p.purchased_on on_date, p.created_at at, 'purchase' kind, null::uuid id,
             coalesce(g.name, '?') || ' · ' || trim(to_char(p.qty, 'FM999999990.###')) || ' ' || coalesce(g.base_unit, '') label,
             p.total_cents signed, null::text method
        from public.stock_purchases p left join public.ingredients g on g.id = p.ingredient_id
       where p.restaurant_id = s.restaurant_id and p.supplier_id = s.id
      union all
      select e.entry_on, e.created_at, e.kind, e.id, coalesce(e.reference, e.note, ''),
             case when e.kind = 'opening' then e.amount_cents else -e.amount_cents end, e.method
        from public.supplier_entries e where e.supplier_id = s.id
    ) t
  ) x);
end $$;

create or replace function public.supplier_compare(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; today date;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  today := app.business_date(r);
  return (select coalesce(jsonb_agg(x order by x.saving_cents desc nulls last, x.name), '[]'::jsonb) from (
    select g.id ingredient_id, g.name, g.purchase_unit, g.purchase_qty,
           jsonb_agg(jsonb_build_object('supplier_id', ps.supplier_id, 'supplier', ps.supplier, 'last_cents', ps.last_cents, 'avg_cents', ps.avg_cents,
                                        'last_on', ps.last_on, 'bought_cents', ps.bought_cents) order by ps.avg_cents) suppliers,
           min(ps.avg_cents) best_cents,
           -- buying the last 6 months at the cheapest average price instead
           round(sum(ps.bought_cents) - min(ps.avg_cents) * sum(ps.bought_qty) / g.purchase_qty)::bigint saving_cents
      from public.ingredients g
      join lateral (
        select p.supplier_id, coalesce(s.name, '?') supplier,
               round(sum(p.total_cents) * g.purchase_qty / nullif(sum(p.qty), 0))::bigint avg_cents,
               (array_agg(round(p.total_cents * g.purchase_qty / nullif(p.qty, 0))::bigint order by p.purchased_on desc, p.created_at desc))[1] last_cents,
               max(p.purchased_on) last_on, sum(p.total_cents) bought_cents, sum(p.qty) bought_qty
          from public.stock_purchases p join public.suppliers s on s.id = p.supplier_id
         where p.restaurant_id = r.id and p.ingredient_id = g.id and p.supplier_id is not null and p.qty > 0 and p.total_cents > 0
           and p.purchased_on > today - 183
         group by p.supplier_id, s.name) ps on true
     where g.restaurant_id = r.id and g.purchase_qty > 0
     group by g.id, g.name, g.purchase_unit, g.purchase_qty
    having count(*) >= 2
  ) x);
end $$;

revoke all on function public.supplier_balances(uuid), public.supplier_statement(uuid), public.supplier_compare(uuid) from public, anon;
grant execute on function public.supplier_balances(uuid), public.supplier_statement(uuid), public.supplier_compare(uuid) to authenticated;
