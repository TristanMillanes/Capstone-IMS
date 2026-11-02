-- PGENRO IMS: authenticated User accounts may view operational records only.
-- Apply AFTER the existing PGENRO setup, using the Supabase SQL Editor.
-- No records are modified. Existing SELECT, administrator and anonymous
-- kiosk policies are preserved. Re-running this migration is supported.
begin;

do $preflight$
begin
  if to_regprocedure('public.is_pgenro_admin()') is null then
    raise exception 'Install the existing PGENRO role helpers before this migration.';
  end if;
  if to_regprocedure('auth.role()') is null then
    raise exception 'This migration requires the existing Supabase auth schema.';
  end if;
end;
$preflight$;

create or replace function public.pgenro_guard_viewer_record_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard$
begin
  -- JWT identity is retained even when a SECURITY DEFINER submission RPC
  -- performs the insert as its owner. Service-role maintenance is unaffected.
  if auth.role() = 'authenticated' then
    if not coalesce(public.is_pgenro_admin(),false) then
      raise exception using errcode = '42501',
        message = 'This account has view-only access to office records.';
    end if;
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$guard$;

do $policies$
declare
  record_table text;
begin
  foreach record_table in array array[
    'communications','office_memos','travel_orders','employees',
    'inventory','inventory_movements','ics_records','service_requests','visitors'
  ] loop
    if to_regclass(format('public.%I',record_table)) is null then
      raise exception 'Required PGENRO table public.% is missing. Install the existing setup first.',record_table;
    end if;
    execute format('alter table public.%I enable row level security',record_table);

    -- Restrictive policies are ANDed with all existing permissive policies,
    -- including any old FOR ALL policy that would otherwise allow User writes.
    execute format('drop policy if exists viewer_guard_insert on public.%I',record_table);
    execute format('drop policy if exists viewer_guard_update on public.%I',record_table);
    execute format('drop policy if exists viewer_guard_delete on public.%I',record_table);
    execute format('create policy viewer_guard_insert on public.%I as restrictive for insert to authenticated with check ((select public.is_pgenro_admin()))',record_table);
    execute format('create policy viewer_guard_update on public.%I as restrictive for update to authenticated using ((select public.is_pgenro_admin())) with check ((select public.is_pgenro_admin()))',record_table);
    execute format('create policy viewer_guard_delete on public.%I as restrictive for delete to authenticated using ((select public.is_pgenro_admin()))',record_table);

    -- RPCs owned by a privileged role may bypass RLS; the trigger still runs.
    execute format('drop trigger if exists pgenro_viewer_write_guard on public.%I',record_table);
    execute format('create trigger pgenro_viewer_write_guard before insert or update or delete on public.%I for each row execute function public.pgenro_guard_viewer_record_write()',record_table);
  end loop;
end;
$policies$;

revoke all on function public.pgenro_guard_viewer_record_write() from public;
notify pgrst, 'reload schema';
commit;
