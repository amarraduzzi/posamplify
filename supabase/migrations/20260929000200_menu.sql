-- =============================================================================
-- 0002 MENU: categories, items, variants. All texts translated per language.
-- =============================================================================

create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          jsonb not null check (app.valid_i18n(name, 60)),
  icon          text check (length(icon) <= 16),     -- emoji shown in the category bar
  -- where items of this category are prepared / printed ("kitchen", "bar", ...)
  station       text not null default 'kitchen' check (station ~ '^[a-z0-9_-]{1,20}$'),
  sort_order    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, id)
);
create index categories_restaurant_idx on public.categories (restaurant_id, sort_order);
create trigger categories_touch before update on public.categories
  for each row execute function app.touch_updated_at();
create trigger categories_same_tenant before update on public.categories
  for each row execute function app.forbid_restaurant_change();

create table public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id   uuid not null,
  name          jsonb not null check (app.valid_i18n(name, 80)),
  description   jsonb not null default '{}'::jsonb check (app.valid_i18n(description, 500)),
  price_cents   bigint not null check (price_cents between 0 and 100000000),
  image_url     text check (length(image_url) <= 500),
  vat_bp        integer check (vat_bp between 0 and 10000),       -- null = restaurant default
  station       text check (station ~ '^[a-z0-9_-]{1,20}$'),      -- null = category station
  -- free tags shown as badges: spicy, popular, vegetarian, new, ...
  tags          text[] not null default '{}' check (cardinality(tags) <= 10),
  active        boolean not null default true,   -- false = hidden everywhere
  available     boolean not null default true,   -- false = shown as "sold out" today
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, category_id)
    references public.categories (restaurant_id, id) on delete no action
);
create index menu_items_category_idx on public.menu_items (restaurant_id, category_id, sort_order);
create trigger menu_items_touch before update on public.menu_items
  for each row execute function app.touch_updated_at();
create trigger menu_items_same_tenant before update on public.menu_items
  for each row execute function app.forbid_restaurant_change();

-- Variants replace the base price (size S/M/L, "with fries", ...).
-- If an item has active variants, the guest must pick one.
create table public.item_variants (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_item_id  uuid not null,
  name          jsonb not null check (app.valid_i18n(name, 60)),
  price_cents   bigint not null check (price_cents between 0 and 100000000),
  sort_order    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, menu_item_id)
    references public.menu_items (restaurant_id, id) on delete cascade
);
create index item_variants_item_idx on public.item_variants (restaurant_id, menu_item_id, sort_order);
create trigger item_variants_same_tenant before update on public.item_variants
  for each row execute function app.forbid_restaurant_change();
