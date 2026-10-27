-- =============================================================================
-- LABELS (step 2): everything a product label needs, taken from what already exists
--
-- * production_batches.lot_code: every batch ("fournée") gets its own number, automatically, like P261027-03
--   (P + day YYMMDD + number of the batch that day). It is also put on the dated lot the batch creates in stock
--   (stock_lots.lot_code), so the traceability of a later production that uses it shows the same number.
--   Batches and lots that already exist get their number too.
-- * production_label(): per batch, the facts for the label: shop, product, day made, expiry date, lot number,
--   allergens (calculated by step 1, through every preparation) and whether they are complete.
--   Nothing is stored for the label: the allergens on a label are never an old copy.
-- The label never says "no allergens" for something that is not fully checked: the app shows a warning instead.
-- =============================================================================

alter table public.production_batches
  add column if not exists lot_code text check (lot_code is null or length(lot_code) <= 40);

-- the next number of a day (one counter per shop and day; cancelled batches keep their number)
create or replace function app.next_batch_code(p_restaurant_id uuid, p_day date)
returns text language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_restaurant_id::text || ':' || p_day::text, 0));
  select count(*) + 1 into n from public.production_batches where restaurant_id = p_restaurant_id and produced_on = p_day;
  return 'P' || to_char(p_day, 'YYMMDD') || '-' || lpad(n::text, 2, '0');
end $$;

create or replace function app.production_batches_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lot_code is null then new.lot_code := app.next_batch_code(new.restaurant_id, new.produced_on); end if;
  return new;
end $$;
drop trigger if exists production_batches_code on public.production_batches;
create trigger production_batches_code before insert on public.production_batches
  for each row execute function app.production_batches_code();

-- the dated lot a batch creates carries the number of the batch
create or replace function app.stock_lots_batch_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.production_id is not null and new.lot_code is null then
    select lot_code into new.lot_code from public.production_batches where id = new.production_id;
  end if;
  return new;
end $$;
drop trigger if exists stock_lots_batch_code on public.stock_lots;
create trigger stock_lots_batch_code before insert on public.stock_lots
  for each row execute function app.stock_lots_batch_code();

-- batches and lots that were made before this step
with n as (
  select id, 'P' || to_char(produced_on, 'YYMMDD') || '-' || lpad((row_number() over (partition by restaurant_id, produced_on order by created_at, id))::text, 2, '0') code
    from public.production_batches where lot_code is null)
update public.production_batches b set lot_code = n.code from n where b.id = n.id;

update public.stock_lots l set lot_code = b.lot_code
  from public.production_batches b
 where l.production_id = b.id and l.lot_code is null and b.lot_code is not null;

-- ------------------------------------------------------------ the facts of one label
create or replace function public.production_label(p_production_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.production_batches; r public.restaurants; g public.ingredients; lot_exp date; exp date; al record;
begin
  select * into b from public.production_batches where id = p_production_id;
  if b.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(b.restaurant_id, 'manager', false);
  select * into g from public.ingredients where restaurant_id = r.id and id = b.ingredient_id;
  select expires_on into lot_exp from public.stock_lots where production_id = b.id order by created_at limit 1;
  exp := coalesce(lot_exp, case when g.shelf_life_days is not null then b.produced_on + g.shelf_life_days end);
  select * into al from app.ingredient_allergens(r.id, g.id);
  return jsonb_build_object(
    'production_id', b.id,
    'restaurant', r.name,
    'name', g.name,
    'base_unit', g.base_unit,
    'qty', b.qty,
    'produced_on', b.produced_on,
    'expires_on', exp,
    'expiry_type', g.expiry_type,
    'lot_code', b.lot_code,
    'allergens', to_jsonb(coalesce(al.allergens, '{}'::text[])),
    'may_contain', to_jsonb(app.array_minus(coalesce(al.may_contain, '{}'::text[]), coalesce(al.allergens, '{}'::text[]))),
    'allergens_complete', coalesce(al.complete, false),
    'cancelled', b.cancelled_at is not null);
end $$;
revoke all on function public.production_label(uuid) from public, anon;
grant execute on function public.production_label(uuid) to authenticated;
