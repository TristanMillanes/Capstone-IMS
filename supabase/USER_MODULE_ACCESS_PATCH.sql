-- Apply after EMPLOYEE_REGISTRATION_AUTO_SYNC_PATCH.sql and the latest
-- USER_INVENTORY_MOVEMENT_PATCH.sql (Supply Requests / inventory custodian).
begin;

do $$
begin
  if to_regprocedure('public.pgenro_my_attendance()') is null then
    raise exception 'Apply EMPLOYEE_REGISTRATION_AUTO_SYNC_PATCH.sql first.';
  end if;
  if to_regclass('public.pgenro_supply_requests') is null
     or to_regprocedure('public.is_pgenro_inventory_custodian()') is null then
    raise exception 'Apply the Supply Requests version of USER_INVENTORY_MOVEMENT_PATCH.sql first.';
  end if;
end $$;

alter table public.profiles add column if not exists user_modules text[];

-- Preserve access for Users already active at the time of the upgrade.
-- New accounts and accounts still awaiting approval start with no modules.
update public.profiles
set user_modules = case when role = 'User' and is_active and status in ('Active', 'Approved')
  then array['communications','travel_orders','office_memos','attendance','supply_requests','service_requests','ics_records']
  else array[]::text[] end
where user_modules is null;

alter table public.profiles alter column user_modules set default array[]::text[];
alter table public.profiles alter column user_modules set not null;
alter table public.profiles drop constraint if exists pgenro_valid_user_modules;
alter table public.profiles add constraint pgenro_valid_user_modules check (
  user_modules <@ array['communications','travel_orders','office_memos','attendance','supply_requests','service_requests','ics_records']
  and coalesce(array_ndims(user_modules), 1) = 1
  and cardinality(user_modules) <= 7
);

create or replace function public.pgenro_guard_user_modules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and cardinality(new.user_modules) > 0)
     or (tg_op = 'UPDATE' and new.user_modules is distinct from old.user_modules) then
    if coalesce(auth.role(), '') <> 'service_role' and not public.is_pgenro_admin()
       and not (auth.uid() is null and session_user in ('postgres','supabase_admin')
         and coalesce(current_setting('role', true), 'none') in ('none','postgres','supabase_admin','service_role')) then
      raise exception using errcode = '42501', message = 'Only an administrator can change module access.';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.pgenro_guard_user_modules() from public, anon, authenticated;
drop trigger if exists pgenro_guard_user_modules on public.profiles;
create trigger pgenro_guard_user_modules before insert or update of user_modules on public.profiles
for each row execute function public.pgenro_guard_user_modules();

create or replace function public.pgenro_has_user_module(p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_pgenro_active_user() and exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.role = 'User'
      and p_module = any(p.user_modules)
  );
$$;
revoke all on function public.pgenro_has_user_module(text) from public, anon;
grant execute on function public.pgenro_has_user_module(text) to authenticated;

-- Restrictive policies also apply when a prior setup has a broader read policy.
do $$
declare module_table text;
begin
  foreach module_table in array array['communications','travel_orders','office_memos','service_requests','ics_records'] loop
    execute format('alter table public.%I enable row level security', module_table);
    execute format('revoke select on public.%I from public, anon', module_table);
    execute format('drop policy if exists pgenro_module_read on public.%I', module_table);
    execute format(
      'create policy pgenro_module_read on public.%I as restrictive for select to authenticated
       using ((select public.is_pgenro_admin()) or (select public.pgenro_has_user_module(%L)))',
      module_table, module_table);
  end loop;
end $$;

drop policy if exists pgenro_supply_module_read on public.pgenro_supply_requests;
create policy pgenro_supply_module_read on public.pgenro_supply_requests
as restrictive for select to authenticated
using (
  (select public.is_pgenro_inventory_custodian()) or (
    requester_id = (select auth.uid()) and
    ((select public.is_pgenro_admin()) or (select public.pgenro_has_user_module('supply_requests')))
  )
);

-- Authenticated submissions through security-definer RPCs still pass through
-- this trigger. Anonymous submissions through the public forms are supported.
create or replace function public.pgenro_guard_module_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not (public.is_pgenro_admin() or public.pgenro_has_user_module(tg_argv[0])) then
    raise exception using errcode = '42501', message = 'Your account does not have access to this module.';
  end if;
  return new;
end $$;
revoke all on function public.pgenro_guard_module_submission() from public, anon, authenticated;

drop trigger if exists pgenro_guard_module_submission on public.pgenro_supply_requests;
create trigger pgenro_guard_module_submission before insert on public.pgenro_supply_requests
for each row execute function public.pgenro_guard_module_submission('supply_requests');

drop trigger if exists pgenro_guard_module_submission on public.service_requests;
create trigger pgenro_guard_module_submission before insert on public.service_requests
for each row execute function public.pgenro_guard_module_submission('service_requests');

drop trigger if exists pgenro_guard_module_submission on public.ics_records;
create trigger pgenro_guard_module_submission before insert on public.ics_records
for each row execute function public.pgenro_guard_module_submission('ics_records');

-- Attendance is read through a definer RPC rather than the employee table.
create or replace function public.pgenro_my_attendance()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare profile public.profiles; employee jsonb; ceremony jsonb; uniforms jsonb;
begin
  if not public.pgenro_has_user_module('attendance') then
    raise exception using errcode='42501',message='Your account does not have My Attendance access.';
  end if;
  select p.* into profile from public.profiles p where p.user_id=auth.uid() and p.role='User';
  if not found then raise exception using errcode='42501',message='Personal attendance is available to employee User accounts.'; end if;
  if profile.employee_record_id is not null then
    select public.pgenro_employee_payload(to_jsonb(e)) into employee from public.employees e where e.id::text=profile.employee_record_id;
  end if;
  if employee is null then return jsonb_build_object('linked',false,'employee',null,'ceremony_records','[]'::jsonb,'uniform_records','[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','control_number',r->>'control_number','date',r->>'date',
    'activity',r->>'activity','status',r->>'status','remarks',r->>'remarks')),'[]'::jsonb) into ceremony
    from jsonb_array_elements(public.pgenro_employee_array(employee->'ceremony_records')) r where jsonb_typeof(r)='object';
  select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','control_number',r->>'control_number','date',r->>'date',
    'compliant',r->'compliant','remarks',r->>'remarks')),'[]'::jsonb) into uniforms
    from jsonb_array_elements(public.pgenro_employee_array(employee->'uniform_records')) r where jsonb_typeof(r)='object';
  return jsonb_build_object('linked',true,'employee',jsonb_build_object('employee_number',employee->>'employee_id',
    'full_name',btrim(concat_ws(' ',employee->>'first_name',employee->>'middle_name',employee->>'last_name',employee->>'name_extension')),
    'department',employee->>'department','designation',employee->>'designation'),
    'ceremony_records',ceremony,'uniform_records',uniforms);
end $$;

revoke all on function public.pgenro_my_attendance() from public, anon;
grant execute on function public.pgenro_my_attendance() to authenticated;

drop policy if exists pgenro_attendance_module_read on public.pgenro_attendance_updates;
create policy pgenro_attendance_module_read on public.pgenro_attendance_updates
as restrictive for select to authenticated
using ((select public.pgenro_has_user_module('attendance')));

do $$
begin
  if to_regclass('public.pgenro_module_notifications') is not null then
    drop policy if exists pgenro_module_notification_read on public.pgenro_module_notifications;
    create policy pgenro_module_notification_read on public.pgenro_module_notifications
    as restrictive for select to authenticated
    using ((select public.is_pgenro_admin()) or public.pgenro_has_user_module(module_key));
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- Attachments in the private bucket follow their module's read permissions.
update storage.buckets set public = false where id = 'pgenro-documents' and public;
drop policy if exists pgenro_document_module_read on storage.objects;
create policy pgenro_document_module_read on storage.objects
as restrictive for select to authenticated
using (
  bucket_id <> 'pgenro-documents' or (select public.is_pgenro_admin()) or
  case split_part(name, '/', 1)
    when 'communications' then (select public.pgenro_has_user_module('communications'))
    when 'office_memos' then (select public.pgenro_has_user_module('office_memos'))
    else false
  end
);
drop policy if exists pgenro_document_module_anon on storage.objects;
create policy pgenro_document_module_anon on storage.objects
as restrictive for select to anon using (bucket_id <> 'pgenro-documents');

notify pgrst, 'reload schema';
commit;
