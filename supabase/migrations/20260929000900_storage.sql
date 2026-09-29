-- =============================================================================
-- 0009 STORAGE: menu photos, logos and covers
-- =============================================================================
-- One public bucket "menu-images". Files live under "<restaurant_id>/...".
-- Everyone can view (the guest menu shows them), only managers and owners of
-- THAT restaurant can upload, replace or delete, and only while writable.
-- Guarded: runs only where the Supabase storage schema exists.
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not found, skipping';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('menu-images', 'menu-images', true, 3145728, '{image/jpeg,image/png,image/webp}')
  on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
                                 allowed_mime_types = excluded.allowed_mime_types;

  execute $p$
    create policy "menu-images: managers upload" on storage.objects for insert to authenticated
    with check (bucket_id = 'menu-images'
                and (storage.foldername(name))[1] in (select unnest((select app.my_writable_restaurants('manager')))::text))
  $p$;
  execute $p$
    create policy "menu-images: managers update" on storage.objects for update to authenticated
    using (bucket_id = 'menu-images'
           and (storage.foldername(name))[1] in (select unnest((select app.my_writable_restaurants('manager')))::text))
    with check (bucket_id = 'menu-images'
           and (storage.foldername(name))[1] in (select unnest((select app.my_writable_restaurants('manager')))::text))
  $p$;
  execute $p$
    create policy "menu-images: managers delete" on storage.objects for delete to authenticated
    using (bucket_id = 'menu-images'
           and (storage.foldername(name))[1] in (select unnest((select app.my_writable_restaurants('manager')))::text))
  $p$;
  execute $p$
    create policy "menu-images: members list" on storage.objects for select to authenticated
    using (bucket_id = 'menu-images'
           and (storage.foldername(name))[1] in (select unnest((select app.my_restaurants('device')))::text))
  $p$;
end $$;
