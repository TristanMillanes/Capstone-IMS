-- Run once in Supabase SQL Editor before uploading documents with this build.
-- Uses the existing approved-user/admin helpers. Preserves all current records.
begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('pgenro-documents', 'pgenro-documents', false, 52428800)
on conflict (id) do update
set public = false, file_size_limit = 52428800;

drop policy if exists pgenro_documents_read on storage.objects;
create policy pgenro_documents_read on storage.objects
for select to authenticated
using (bucket_id = 'pgenro-documents' and (select public.is_pgenro_active_user()));

drop policy if exists pgenro_documents_insert on storage.objects;
create policy pgenro_documents_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'pgenro-documents' and (select public.is_pgenro_admin()));

drop policy if exists pgenro_documents_update on storage.objects;
create policy pgenro_documents_update on storage.objects
for update to authenticated
using (bucket_id = 'pgenro-documents' and (select public.is_pgenro_admin()))
with check (bucket_id = 'pgenro-documents' and (select public.is_pgenro_admin()));

drop policy if exists pgenro_documents_delete on storage.objects;
create policy pgenro_documents_delete on storage.objects
for delete to authenticated
using (bucket_id = 'pgenro-documents' and (select public.is_pgenro_admin()));

commit;
