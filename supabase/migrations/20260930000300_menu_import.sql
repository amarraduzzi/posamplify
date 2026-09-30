-- =============================================================================
-- 0013 MENU IMPORT
-- =============================================================================
-- Switching from another till must not mean typing the whole menu again.
-- The back office reads an Excel/CSV export or a photo of the paper menu,
-- shows everything for checking, then calls import_menu() once:
--   * in one transaction (all or nothing),
--   * categories are matched by name (case-insensitive, any language) or created,
--   * a dish that already exists in that category (same name) is skipped, so
--     running the same file twice does not create doubles,
--   * the batch is remembered in menu_imports, so undo_menu_import() can remove
--     exactly what was added. Dishes that were sold in the meantime are hidden
--     instead of deleted, so sales history keeps its link.
-- Managers and owners only.
-- =============================================================================

create table public.menu_imports (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  source         text not null check (source in ('file', 'photo')),
  file_name      text check (length(file_name) <= 200),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  category_ids   uuid[] not null default '{}',   -- categories this import created
  item_ids       uuid[] not null default '{}',   -- dishes this import created
  skipped        integer not null default 0,
  undone_at      timestamptz,
  unique (restaurant_id, id)
);
create index menu_imports_restaurant_idx on public.menu_imports (restaurant_id, created_at desc);

alter table public.menu_imports enable row level security;
grant select on public.menu_imports to authenticated;
create policy menu_imports_select on public.menu_imports for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
-- no insert/update/delete policies: only through the functions below

-- lower-cased, trimmed, inner spaces collapsed
create or replace function app.norm_name(t text)
returns text language sql immutable set search_path = ''
as $$ select lower(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g')) $$;

-- true when two i18n names share a spelling in any language
create or replace function app.same_name(a jsonb, b jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select exists (select 1 from jsonb_each_text(a) x, jsonb_each_text(b) y
                  where app.norm_name(x.value) = app.norm_name(y.value) and app.norm_name(x.value) <> '')
$$;

-- keeps only 2-letter language keys with a non-empty trimmed text
create or replace function app.clean_i18n(v jsonb)
returns jsonb language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.key, btrim(e.value)), '{}'::jsonb)
    from jsonb_each_text(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) e
   where e.key ~ '^[a-z]{2}$' and btrim(e.value) <> ''
$$;

-- Rows: [{ category: {fr,..}, category_icon?, category_station?, name: {fr,..},
--          description?: {..}, price_cents?, tags?: [..], variants?: [{name:{..}, price_cents}] }]
create or replace function public.import_menu(
  p_restaurant_id uuid, p_source text, p_file_name text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.restaurants;
  imp_id   uuid := gen_random_uuid();
  row_     jsonb;
  n        int := 0;
  cat_name jsonb;
  cat_id   uuid;
  item_nm  jsonb;
  item_id  uuid;
  price    bigint;
  vars     jsonb;
  v        jsonb;
  vi       int;
  new_cats uuid[] := '{}';
  new_items uuid[] := '{}';
  skipped  int := 0;
  cat_sort int;
  item_sort int;
  station  text;
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  if p_source not in ('file', 'photo') then raise exception 'invalid source' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'nothing to import' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 1500 then
    raise exception 'too many rows (max 1500)' using errcode = '22023';
  end if;

  select coalesce(max(sort_order), 0) into cat_sort from public.categories where restaurant_id = r.id;

  for row_ in select value from jsonb_array_elements(p_rows) loop
    n := n + 1;
    cat_name := app.clean_i18n(row_ -> 'category');
    item_nm  := app.clean_i18n(row_ -> 'name');
    if cat_name = '{}'::jsonb then raise exception 'row %: category missing', n using errcode = '22023'; end if;
    if item_nm = '{}'::jsonb then raise exception 'row %: name missing', n using errcode = '22023'; end if;
    if not app.valid_i18n(cat_name, 60) then raise exception 'row %: category name too long', n using errcode = '22023'; end if;
    if not app.valid_i18n(item_nm, 80) then raise exception 'row %: name too long', n using errcode = '22023'; end if;

    vars := coalesce(row_ -> 'variants', '[]'::jsonb);
    if jsonb_typeof(vars) <> 'array' then vars := '[]'::jsonb; end if;
    price := nullif(row_ ->> 'price_cents', '')::bigint;
    if price is null and jsonb_array_length(vars) > 0 then
      select min((x ->> 'price_cents')::bigint) into price from jsonb_array_elements(vars) x;
    end if;
    if price is null or price < 0 or price > 100000000 then
      raise exception 'row %: price missing', n using errcode = '22023';
    end if;

    -- category: existing (same name in any language) or new
    select c.id into cat_id from public.categories c
     where c.restaurant_id = r.id and app.same_name(c.name, cat_name)
     order by c.sort_order limit 1;
    if cat_id is null then
      station := coalesce(nullif(row_ ->> 'category_station', ''), 'kitchen');
      if station !~ '^[a-z0-9_-]{1,20}$' then station := 'kitchen'; end if;
      cat_sort := cat_sort + 10;
      insert into public.categories (restaurant_id, name, icon, station, sort_order)
      values (r.id, cat_name, left(nullif(row_ ->> 'category_icon', ''), 16), station, cat_sort)
      returning id into cat_id;
      new_cats := new_cats || cat_id;
    end if;

    -- dish already there? skip it
    if exists (select 1 from public.menu_items i
                where i.restaurant_id = r.id and i.category_id = cat_id and app.same_name(i.name, item_nm)) then
      skipped := skipped + 1;
      continue;
    end if;

    select coalesce(max(sort_order), 0) + 10 into item_sort
      from public.menu_items where restaurant_id = r.id and category_id = cat_id;
    insert into public.menu_items (restaurant_id, category_id, name, description, price_cents, tags, sort_order)
    values (r.id, cat_id, item_nm,
            case when app.valid_i18n(app.clean_i18n(row_ -> 'description'), 500) then app.clean_i18n(row_ -> 'description') else '{}'::jsonb end,
            price,
            coalesce((select array_agg(distinct t) from jsonb_array_elements_text(
                        case when jsonb_typeof(row_ -> 'tags') = 'array' then row_ -> 'tags' else '[]'::jsonb end) t
                      where t in ('popular', 'new', 'spicy', 'vegetarian')), '{}'),
            item_sort)
    returning id into item_id;
    new_items := new_items || item_id;

    vi := 0;
    for v in select value from jsonb_array_elements(vars) loop
      vi := vi + 1;
      if app.clean_i18n(v -> 'name') = '{}'::jsonb or not app.valid_i18n(app.clean_i18n(v -> 'name'), 60) then
        raise exception 'row %: variant name missing or too long', n using errcode = '22023';
      end if;
      if nullif(v ->> 'price_cents', '') is null or (v ->> 'price_cents')::bigint not between 0 and 100000000 then
        raise exception 'row %: variant price missing', n using errcode = '22023';
      end if;
      insert into public.item_variants (restaurant_id, menu_item_id, name, price_cents, sort_order)
      values (r.id, item_id, app.clean_i18n(v -> 'name'), (v ->> 'price_cents')::bigint, vi * 10);
    end loop;
  end loop;

  insert into public.menu_imports (id, restaurant_id, source, file_name, category_ids, item_ids, skipped)
  values (imp_id, r.id, p_source, left(p_file_name, 200), new_cats, new_items, skipped);

  return jsonb_build_object('import_id', imp_id, 'categories', cardinality(new_cats),
                            'items', cardinality(new_items), 'skipped', skipped);
end $$;

create or replace function public.undo_menu_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  imp     public.menu_imports;
  r       public.restaurants;
  hidden  int;
  removed int;
begin
  select * into imp from public.menu_imports where id = p_import_id for update;
  if imp.id is null then raise exception 'not allowed' using errcode = '42501'; end if;
  r := app.require_role(imp.restaurant_id, 'manager', true);
  if imp.undone_at is not null then raise exception 'already undone' using errcode = 'P0001'; end if;

  -- sold dishes stay (hidden), so tickets and reports keep their link
  update public.menu_items i set active = false
   where i.restaurant_id = r.id and i.id = any (imp.item_ids)
     and exists (select 1 from public.order_lines l where l.restaurant_id = r.id and l.menu_item_id = i.id);
  get diagnostics hidden = row_count;

  delete from public.menu_items i
   where i.restaurant_id = r.id and i.id = any (imp.item_ids)
     and not exists (select 1 from public.order_lines l where l.restaurant_id = r.id and l.menu_item_id = i.id);
  get diagnostics removed = row_count;

  -- a new category goes only when nothing is left in it (the owner may have added dishes)
  delete from public.categories c
   where c.restaurant_id = r.id and c.id = any (imp.category_ids)
     and not exists (select 1 from public.menu_items i where i.restaurant_id = r.id and i.category_id = c.id);

  update public.menu_imports set undone_at = now() where id = imp.id;
  return jsonb_build_object('removed', removed, 'hidden', hidden);
end $$;

-- cheap permission check for the photo reader (it spends AI quota)
create or replace function public.can_import_menu(p_restaurant_id uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform app.require_role(p_restaurant_id, 'manager', true);
  return true;
end $$;

revoke all on function public.import_menu(uuid, text, text, jsonb) from public, anon;
revoke all on function public.undo_menu_import(uuid) from public, anon;
revoke all on function public.can_import_menu(uuid) from public, anon;
grant execute on function public.import_menu(uuid, text, text, jsonb) to authenticated;
grant execute on function public.undo_menu_import(uuid) to authenticated;
grant execute on function public.can_import_menu(uuid) to authenticated;
