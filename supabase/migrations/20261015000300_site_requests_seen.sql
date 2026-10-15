-- =============================================================================
-- Requests from the website: the back office sees the new ones straight away
-- * catering_orders.seen_at: when the restaurant opened the request. A request from the website arrives
--   unseen (a badge on Traiteur, a banner and a sound in the back office); orders typed in by the
--   restaurant itself are seen from the start.
-- * catering_orders joins Realtime, so a new request shows up without reloading the page.
-- =============================================================================

alter table public.catering_orders add column if not exists seen_at timestamptz default now();

create or replace function app.catering_seen_on_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source = 'site' then new.seen_at := null; end if;
  return new;
end $$;
drop trigger if exists catering_seen_on_insert on public.catering_orders;
create trigger catering_seen_on_insert before insert on public.catering_orders
  for each row execute function app.catering_seen_on_insert();

create index if not exists catering_orders_unseen_idx on public.catering_orders (restaurant_id) where seen_at is null;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'catering_orders') then
    alter publication supabase_realtime add table public.catering_orders;
  end if;
end $$;
notify pgrst, 'reload schema';
