-- =============================================================================
-- 0011 OFFLINE TILL
-- =============================================================================
-- The till keeps working without internet and sends its work later. Orders
-- then reach the server minutes (or hours) after they were taken. To keep the
-- real time of the order (kitchen timers, history), a till may now send the
-- moment it created the order. It is accepted only when plausible: not in the
-- future and at most 48 hours ago; otherwise the server time is used, as before.
-- Business date, ticket number and everything fiscal stay server side.
-- =============================================================================

create or replace function app.orders_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare r public.restaurants;
begin
  select * into r from public.restaurants where id = new.restaurant_id;
  if r.id is null then
    -- not visible to the caller: RLS would reject the row anyway, fail clearly
    raise exception 'not allowed' using errcode = '42501';
  end if;
  new.business_date := app.business_date(r);
  new.ticket_number := app.next_counter(new.restaurant_id, 'ticket:' || new.business_date::text);

  if app.is_client() then
    -- QR orders only through place_order(); the till cannot create closed or
    -- discounted orders directly.
    if new.source = 'qr' then
      raise exception 'qr orders must use place_order()' using errcode = '42501';
    end if;
    new.status := 'new';
    new.subtotal_cents := 0;
    new.discount_cents := 0;
    new.total_cents := 0;
    new.discount_by_staff_id := null;
    new.cancelled_at := null;
    new.cancelled_by_staff_id := null;
    new.cancel_reason := null;
    new.closed_at := null;
    new.fiscal_document_id := null;
    -- time the till took the order (offline sync), if plausible
    -- (a till clock running a bit fast is capped at the server time)
    if new.created_at is null or new.created_at > now() or new.created_at < now() - interval '48 hours' then
      new.created_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
