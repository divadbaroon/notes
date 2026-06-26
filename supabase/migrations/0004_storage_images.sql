-- Public image bucket for note embeds (![alt](url)).
-- Reads are public (served via the storage CDN); writes are gated to members.

insert into storage.buckets (id, name, public)
values ('note-images', 'note-images', true)
on conflict (id) do update set public = true;

-- Object-level RLS on storage.objects ----------------------------------
drop policy if exists "note_images_read"   on storage.objects;
drop policy if exists "note_images_insert" on storage.objects;
drop policy if exists "note_images_update" on storage.objects;
drop policy if exists "note_images_delete" on storage.objects;

create policy "note_images_read" on storage.objects
  for select using (bucket_id = 'note-images');

create policy "note_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'note-images' and public.is_member());

create policy "note_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'note-images' and public.is_member());

create policy "note_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'note-images' and public.is_member());
