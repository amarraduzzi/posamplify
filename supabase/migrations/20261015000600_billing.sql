-- =============================================================================
-- Amplify's own billing of its customers (cash, transfer, CashPlus, per month or per year)
-- * Per restaurant: from when it pays (billing_start), how much, per month or per year, how it usually
--   pays, and until when it has paid (paid_until = the date of the next payment).
--   No billing start yet = "en préparation": everything works, nothing is due.
-- * A payment received moves paid_until on by one period (or more) and keeps a numbered receipt.
--   It also switches a trial or a suspended restaurant to active.
-- * Late payers are only shown (to Amplify, and to the owner); nothing is switched off automatically.
-- Only platform admins write; the owner and managers of the restaurant can read their own payments.
-- =============================================================================

alter table public.restaurants add column if not exists billing_start date;
alter table public.restaurants add column if not exists billing_amount_cents bigint check (billing_amount_cents is null or billing_amount_cents between 0 and 100000000);
alter table public.restaurants add column if not exists billing_period text not null default 'month' check (billing_period in ('month', 'year'));
alter table public.restaurants add column if not exists billing_method text check (billing_method in ('cash', 'transfer', 'cashplus', 'card', 'other'));
alter table public.restaurants add column if not exists paid_until date;

create sequence if not exists public.platform_receipt_seq;

create table if not exists public.platform_payments (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  number         bigint not null default nextval('public.platform_receipt_seq'),
  amount_cents   bigint not null check (amount_cents between 1 and 100000000),
  method         text not null check (method in ('cash', 'transfer', 'cashplus', 'card', 'other')),
  paid_on        date not null,
  period_from    date not null,
  period_to      date not null check (period_to > period_from),
  note           text check (length(note) <= 200),
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists platform_payments_restaurant_idx on public.platform_payments (restaurant_id, period_to desc);

alter table public.platform_payments enable row level security;
grant select on public.platform_payments to authenticated;
drop policy if exists platform_payments_select on public.platform_payments;
create policy platform_payments_select on public.platform_payments for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[])
         or exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid())));

-- the agreement with a customer
create or replace function public.admin_set_billing(p_restaurant_id uuid, p_start date, p_amount_cents bigint, p_period text, p_method text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants;
begin
  perform app.require_platform_admin();
  if p_period not in ('month', 'year') then perform app.fail('invalid_request', 'period'); end if;
  if p_method is not null and p_method not in ('cash', 'transfer', 'cashplus', 'card', 'other') then perform app.fail('invalid_request', 'method'); end if;
  if p_amount_cents is not null and p_amount_cents not between 0 and 100000000 then perform app.fail('invalid_request', 'amount'); end if;
  update public.restaurants set billing_start = p_start, billing_amount_cents = p_amount_cents, billing_period = p_period, billing_method = p_method,
    -- nothing paid yet: the first payment is due on the start date
    paid_until = case when exists (select 1 from public.platform_payments p where p.restaurant_id = p_restaurant_id) then paid_until else null end
   where id = p_restaurant_id returning * into r;
  if r.id is null then perform app.fail('not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_set_billing(uuid, date, bigint, text, text) from public, anon;
grant execute on function public.admin_set_billing(uuid, date, bigint, text, text) to authenticated;

drop function if exists public.admin_record_payment(uuid, bigint, text, date, integer, text);
-- a payment received: covers p_periods months (or years) from the date that was due
create or replace function public.admin_record_payment(p_restaurant_id uuid, p_amount_cents bigint, p_method text, p_paid_on date, p_periods integer default 1, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; f date; p public.platform_payments;
begin
  perform app.require_platform_admin();
  select * into r from public.restaurants where id = p_restaurant_id for update;
  if r.id is null then perform app.fail('not_found'); end if;
  if coalesce(p_amount_cents, 0) <= 0 then perform app.fail('invalid_request', 'amount'); end if;
  if p_method not in ('cash', 'transfer', 'cashplus', 'card', 'other') then perform app.fail('invalid_request', 'method'); end if;
  if coalesce(p_periods, 0) not between 1 and 24 then perform app.fail('invalid_request', 'periods'); end if;
  if p_paid_on is null then perform app.fail('invalid_request', 'date'); end if;
  f := coalesce(r.paid_until, r.billing_start, p_paid_on);
  insert into public.platform_payments (restaurant_id, amount_cents, method, paid_on, period_from, period_to, note, created_by)
  values (r.id, p_amount_cents, p_method, p_paid_on, f,
          (f + case when r.billing_period = 'year' then make_interval(years => p_periods) else make_interval(months => p_periods) end)::date,
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into p;
  update public.restaurants set paid_until = p.period_to, billing_start = coalesce(billing_start, f),
    status = case when status in ('trial', 'paused') then 'active'::public.restaurant_status else status end
   where id = r.id;
  return to_jsonb(p);
end $$;
revoke all on function public.admin_record_payment(uuid, bigint, text, date, integer, text) from public, anon;
grant execute on function public.admin_record_payment(uuid, bigint, text, date, integer, text) to authenticated;

-- a payment typed by mistake: only the latest one, and the paid period goes back
create or replace function public.admin_cancel_payment(p_payment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.platform_payments;
begin
  perform app.require_platform_admin();
  select * into p from public.platform_payments where id = p_payment_id;
  if p.id is null then perform app.fail('not_found'); end if;
  if exists (select 1 from public.platform_payments x where x.restaurant_id = p.restaurant_id and x.period_to > p.period_to) then
    perform app.fail('invalid_request', 'not_latest');
  end if;
  delete from public.platform_payments where id = p.id;
  update public.restaurants set paid_until = case when exists (select 1 from public.platform_payments x where x.restaurant_id = p.restaurant_id) then p.period_from else null end
   where id = p.restaurant_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_cancel_payment(uuid) from public, anon;
grant execute on function public.admin_cancel_payment(uuid) to authenticated;
