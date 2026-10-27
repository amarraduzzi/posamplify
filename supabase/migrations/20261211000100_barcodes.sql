-- =============================================================================
-- BARCODES AND SCALE LABELS (step 3): an option, OFF unless the shop switches it on
--
-- * restaurants.barcode_scan: the switch (default off; the owner switches it on in the back office). While it is
--   off, nothing changes anywhere: no scan field in the till, no code field on a product.
-- * menu_items.barcode: the code printed on the product (a normal barcode), or, for a product sold by weight, the
--   product number the scale prints inside its own labels (the "PLU"). Unique per shop.
-- * restaurants.scale_*: how this shop's scale writes its labels. Most scales print an EAN-13 that starts with a
--   fixed prefix (2 or 02...), then the product number, then the weight (or the price), then a check digit:
--       2 PPPPPP WWWWW C        prefix + code + value + 1 check digit = 13 digits
--   so prefix length + code length + value length = 12. The value is the weight in grams ('weight_g'), in tens of
--   grams ('weight_10g'), or the price in centimes ('price_cents').
-- The till reads the code and puts the product on the order, with the weight; the price is then calculated by the
-- database exactly as for a weight typed by hand (sold_by_weight, step "selling by weight"). Nothing else changes.
-- =============================================================================

alter table public.menu_items
  add column if not exists barcode text check (barcode is null or barcode ~ '^[0-9A-Za-z-]{3,32}$');
create unique index if not exists menu_items_barcode_uq on public.menu_items (restaurant_id, barcode) where barcode is not null;

alter table public.restaurants
  add column if not exists barcode_scan   boolean  not null default false,
  add column if not exists scale_prefix   text     not null default '2'  check (scale_prefix ~ '^[0-9]{1,3}$'),
  add column if not exists scale_code_len smallint not null default 6    check (scale_code_len between 3 and 8),
  add column if not exists scale_value_len smallint not null default 5   check (scale_value_len between 3 and 6),
  add column if not exists scale_value    text     not null default 'weight_g' check (scale_value in ('weight_g', 'weight_10g', 'price_cents'));
alter table public.restaurants drop constraint if exists restaurants_scale_length_check;
alter table public.restaurants add constraint restaurants_scale_length_check
  check (length(scale_prefix) + scale_code_len + scale_value_len = 12);

grant update (barcode_scan, scale_prefix, scale_code_len, scale_value_len, scale_value) on public.restaurants to authenticated;
