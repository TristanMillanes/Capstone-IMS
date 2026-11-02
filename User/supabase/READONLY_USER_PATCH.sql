-- Apply once to an existing PGENRO database in the Supabase SQL Editor.
-- Operational record encoding is reserved for administrators. Approved user
-- accounts can view records. Account settings and public visitor registration
-- retain their existing separate rules. No records are deleted by this patch.
begin;
do $$
declare
  table_name text;
  existing_policy record;
begin
  foreach table_name in array array[
    'communications','office_memos','travel_orders','employees','inventory',
    'inventory_movements','ics_records','service_requests','visitors'
  ] loop
    if to_regclass(format('public.%I',table_name)) is null then
      raise notice 'Skipping absent table %',table_name;
      continue;
    end if;
    execute format('alter table public.%I enable row level security',table_name);

    -- Remove legacy permissive policies for logged-in users, including ALL
    -- policies. Preserve policies that only apply to the public visitor kiosk.
    for existing_policy in
      select policyname from pg_policies
      where schemaname='public' and tablename=table_name
        and roles && array['authenticated','public']::name[]
    loop
      execute format('drop policy %I on public.%I',existing_policy.policyname,table_name);
    end loop;

    execute format('grant select,insert,update,delete on public.%I to authenticated',table_name);
    execute format('create policy active_user_select on public.%I for select to authenticated using ((select public.is_pgenro_active_user()))',table_name);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select public.is_pgenro_admin()))',table_name);
    execute format('create policy admin_update on public.%I for update to authenticated using ((select public.is_pgenro_admin())) with check ((select public.is_pgenro_admin()))',table_name);
    execute format('create policy admin_delete on public.%I for delete to authenticated using ((select public.is_pgenro_admin()))',table_name);
  end loop;
end $$;
commit;
