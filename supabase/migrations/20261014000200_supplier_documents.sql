-- =============================================================================
-- Supplier invoices and delivery notes, as a photo or PDF (version 1: no AI reading yet)
-- Added when noting a purchase, when receiving a purchase order, or on its own from the
-- supplier screen. Each document keeps the supplier, the date, the amount (optional) and
-- a note: the fields an AI reader can fill in later.
-- The files live in a PRIVATE storage bucket "supplier-docs", under "<restaurant_id>/...":
-- only owners and managers of that restaurant can see, add or remove them.
-- Deleting a supplier or a purchase order keeps the document (the link is just emptied):
-- proof never disappears by a wrong click.
-- =============================================================================
create table if not exists public.supplier_documents (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  supplier_id       uuid,
  supplier_name     text check (length(supplier_name) <= 80),          -- typed name when no supplier record
  purchase_order_id uuid,
  doc_date          date not null default current_date,
  amount_cents      bigint check (amount_cents between 0 and 10000000000),
  note              text check (length(note) <= 300),
  file_path         text not null check (length(file_path) <= 300),
  mime_type         text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes        integer not null check (size_bytes between 1 and 10485760),
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  unique (restaurant_id, id),
  -- the file must sit in this restaurant's folder
  check (split_part(file_path, '/', 1) = restaurant_id::text),
  foreign key (restaurant_id, supplier_id) references public.suppliers (restaurant_id, id) on delete set null (supplier_id),
  foreign key (restaurant_id, purchase_order_id) references public.purchase_orders (restaurant_id, id) on delete set null (purchase_order_id)
);
create index if not exists supplier_documents_idx on public.supplier_documents (restaurant_id, doc_date desc);
create index if not exists supplier_documents_supplier_idx on public.supplier_documents (restaurant_id, supplier_id);
drop trigger if exists supplier_documents_same_tenant on public.supplier_documents;
create trigger supplier_documents_same_tenant before update on public.supplier_documents
  for each row execute function app.forbid_restaurant_change();

alter table public.supplier_documents enable row level security;
grant select, insert, update, delete on public.supplier_documents to authenticated;
drop policy if exists supplier_documents_select on public.supplier_documents;
drop policy if exists supplier_documents_insert on public.supplier_documents;
drop policy if exists supplier_documents_update on public.supplier_documents;
drop policy if exists supplier_documents_delete on public.supplier_documents;
create policy supplier_documents_select on public.supplier_documents for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
create policy supplier_documents_insert on public.supplier_documents for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy supplier_documents_update on public.supplier_documents for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy supplier_documents_delete on public.supplier_documents for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
drop trigger if exists audit_supplier_documents on public.supplier_documents;
create trigger audit_supplier_documents after insert or update or delete on public.supplier_documents
  for each row execute function app.audit();

-- the private bucket (guarded: only where the Supabase storage schema exists)
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not found, skipping';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('supplier-docs', 'supplier-docs', false, 10485760, '{image/jpeg,image/png,image/webp,application/pdf}')
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                                 allowed_mime_types = excluded.allowed_mime_types;
  execute 'drop policy if exists "supplier-docs: managers read" on storage.objects';
  execute 'drop policy if exists "supplier-docs: managers upload" on storage.objects';
  execute 'drop policy if exists "supplier-docs: managers delete" on storage.objects';
  execute $p$
    create policy "supplier-docs: managers read" on storage.objects for select to authenticated
    using (bucket_id = 'supplier-docs'
           and (storage.foldername(name))[1] in (select unnest((select app.my_restaurants('manager')))::text))
  $p$;
  execute $p$
    create policy "supplier-docs: managers upload" on storage.objects for insert to authenticated
    with check (bucket_id = 'supplier-docs'
                and (storage.foldername(name))[1] in (select unnest((select app.my_writable_restaurants('manager')))::text))
  $p$;
  execute $p$
    create policy "supplier-docs: managers delete" on storage.objects for delete to authenticated
    using (bucket_id = 'supplier-docs'
           and (storage.foldername(name))[1] in (select unnest((select app.my_writable_restaurants('manager')))::text))
  $p$;
end $$;
