-- PGENRO IMS: run this whole file LAST in Supabase SQL Editor.
-- Existing setup only: requires COMPLETE_SETUP.sql / ADMIN_USER_ACCESS_PATCH.sql.
-- Re-runnable; preserves employee details, monitoring history and account status.
begin;

alter table public.profiles
  add column if not exists employee_record_id text,
  add column if not exists employee_number text;
create unique index if not exists profiles_one_account_per_employee
  on public.profiles(employee_record_id) where employee_record_id is not null;

do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='employees' and column_name='employee_id') then
    alter table public.employees add column if not exists ceremony_records jsonb not null default '[]'::jsonb;
    alter table public.employees add column if not exists uniform_records jsonb not null default '[]'::jsonb;
  end if;
end $$;

create or replace function public.pgenro_employee_payload(row_data jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select (case when jsonb_typeof(row_data->'data')='object' then row_data->'data' else '{}'::jsonb end)
    || jsonb_strip_nulls(row_data-'data');
$$;
create or replace function public.pgenro_employee_array(value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare parsed jsonb;
begin
  if jsonb_typeof(value)='array' then return value; end if;
  if jsonb_typeof(value)='string' then
    begin
      parsed:=(value #>> '{}')::jsonb;
      if jsonb_typeof(parsed)='array' then return parsed; end if;
    exception when invalid_text_representation then return '[]'::jsonb;
    end;
  end if;
  return '[]'::jsonb;
end $$;

-- Ignore case and surrounding spaces, but NEVER discard leading zeroes.
-- Stop on existing ambiguous IDs instead of merging two employees' attendance.
do $$ begin
  if exists(select 1 from public.employees e
    where nullif(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'),'') is not null
    group by lower(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id')) having count(*)>1) then
    raise exception 'Duplicate employee numbers exist (ignoring case/spaces). Correct the duplicate numbers in Employees, then rerun this file. No records have been merged or deleted.';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='employees' and column_name='employee_id') then
    create unique index if not exists employees_number_casefold_unique
      on public.employees(lower(btrim(employee_id))) where nullif(btrim(employee_id),'') is not null;
  else
    create unique index if not exists employees_number_casefold_unique
      on public.employees(lower(btrim(data->>'employee_id'))) where nullif(btrim(data->>'employee_id'),'') is not null;
  end if;
end $$;

create or replace function public.pgenro_employee_login_address(p_number text)
returns text language plpgsql immutable set search_path='' as $$
declare number text:=btrim(p_number);
begin
  if number is null or number !~ '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$'
    or right(number,1)='.' or position('..' in number)>0 then
    raise exception using errcode='22023',message='Enter a valid employee number using 1-64 letters, numbers, dots, underscores or hyphens.';
  end if;
  return lower(number)||'@pgenro.ims';
end $$;

-- Read-only preflight; an employee does not need to be pre-encoded to register.
-- The Auth INSERT trigger below repeats these checks inside the transaction.
create or replace function public.pgenro_employee_registration_check(p_employee_number text,p_email text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare number text:=btrim(p_employee_number); alias text; employee jsonb; matches integer;
begin
  alias:=public.pgenro_employee_login_address(number);
  if lower(number)='admin001' then
    raise exception using errcode='22023',message='Admin001 is reserved for the first administrator.';
  end if;
  select count(*) into matches from public.employees e
    where lower(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=lower(number);
  if matches>1 then raise exception using errcode='23505',message='This employee number needs administrator review.'; end if;
  select public.pgenro_employee_payload(to_jsonb(e)) into employee from public.employees e
    where lower(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=lower(number);
  if exists(select 1 from public.profiles p where
      (employee is not null and p.employee_record_id=employee->>'id')
      or lower(btrim(p.employee_number))=lower(number))
    or exists(select 1 from auth.users u where lower(btrim(u.email))=alias) then
    raise exception using errcode='23505',message='This employee number already has an account or pending request. Use Sign in or contact the administrator.';
  end if;
  return jsonb_build_object('eligible',true,'employee_number',coalesce(employee->>'employee_id',number));
end $$;

-- Private, transaction-bound creator/resolver. Never overwrites an existing HR
-- record, contact email, or attendance array with applicant-submitted details.
create or replace function public.pgenro_ensure_account_employee(p_user_id uuid,p_number text,p_details jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare number text:=btrim(p_number); employee jsonb; matches integer; payload jsonb;
  first_name text; last_name text; middle_name text; extension text; full_name text;
  columns_sql text; values_sql text; wrapped boolean;
begin
  perform public.pgenro_employee_login_address(number);
  if lower(number)='admin001' then raise exception using errcode='22023',message='Admin001 is reserved for the first administrator.'; end if;
  -- Same employee number serializes even when no employee row exists yet.
  perform pg_advisory_xact_lock(hashtextextended('pgenro.employee.'||lower(number),0));
  select count(*) into matches from public.employees e
    where lower(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=lower(number);
  if matches>1 then raise exception using errcode='23505',message='This employee number needs administrator review.'; end if;
  select public.pgenro_employee_payload(to_jsonb(e)) into employee from public.employees e
    where lower(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=lower(number) for update;
  if exists(select 1 from public.profiles p where p.user_id<>p_user_id and
      ((employee is not null and p.employee_record_id=employee->>'id') or lower(btrim(p.employee_number))=lower(number)))
    or exists(select 1 from auth.users u where u.id<>p_user_id
      and lower(btrim(u.email))=lower(number)||'@pgenro.ims') then
    raise exception using errcode='23505',message='This employee number already has an account or pending request.';
  end if;
  if employee is not null then return employee; end if;

  first_name:=btrim(coalesce(p_details->>'first_name',''));
  last_name:=btrim(coalesce(p_details->>'last_name',''));
  middle_name:=btrim(coalesce(p_details->>'middle_name',''));
  extension:=btrim(coalesce(p_details->>'name_extension',''));
  full_name:=btrim(coalesce(p_details->>'full_name',''));
  -- Compatibility with the earlier full-name-only registration form. Keep the
  -- supplied name intact; Admin can split it into HR name fields during editing.
  if first_name='' and last_name='' then first_name:=full_name; end if;
  if btrim(concat_ws(' ',first_name,middle_name,last_name,extension))=''
    or length(concat_ws(' ',first_name,middle_name,last_name,extension))>203
    or length(coalesce(p_details->>'division',''))>200 or length(coalesce(p_details->>'position',''))>200 then
    raise exception using errcode='22023',message='Enter your name and valid account details.';
  end if;
  payload:=jsonb_build_object('employee_id',number,'first_name',first_name,'middle_name',middle_name,
    'last_name',last_name,'name_extension',extension,'designation',btrim(coalesce(p_details->>'position','')),
    'department',btrim(coalesce(p_details->>'division','')),'duty_status','Active',
    'ceremony_records','[]'::jsonb,'uniform_records','[]'::jsonb);
  select not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='employees' and column_name='employee_id') into wrapped;
  if wrapped then payload:=jsonb_build_object('data',payload); end if;
  payload:=payload||jsonb_build_object('id',gen_random_uuid());
  -- Populate only existing columns so both supported employee storage formats
  -- retain their defaults and work without a schema-specific Edge Function.
  select string_agg(format('%I',c.column_name),',' order by c.ordinal_position),
    string_agg(format('r.%I',c.column_name),',' order by c.ordinal_position)
    into columns_sql,values_sql
    from information_schema.columns c where c.table_schema='public' and c.table_name='employees'
      and payload ? c.column_name;
  execute format('insert into public.employees as e (%s) select %s from jsonb_populate_record(null::public.employees,$1) r returning public.pgenro_employee_payload(to_jsonb(e))',columns_sql,values_sql)
    into employee using payload;
  return employee;
end $$;

create or replace function public.pgenro_require_employee_registration()
returns trigger language plpgsql security definer set search_path='' as $$
declare meta jsonb:=coalesce(new.raw_user_meta_data,'{}'::jsonb); employee jsonb; number text; trusted boolean;
begin
  -- Only trusted Auth app metadata can identify administrator-created accounts.
  trusted:=coalesce(new.raw_app_meta_data->>'created_by_admin'='true',false) or
    coalesce(new.raw_app_meta_data->>'pgenro_role' in ('Admin','User') and
      new.raw_app_meta_data->>'pgenro_status' in ('Active','Inactive','Suspended'),false);
  if trusted and (new.raw_app_meta_data->>'pgenro_role'='Admin'
    or new.raw_app_meta_data->>'role'='admin') then return new; end if;
  number:=btrim(coalesce(nullif(meta->>'employee_number',''),case when trusted then meta->>'username' end));
  if not trusted and lower(btrim(new.email)) is distinct from public.pgenro_employee_login_address(number) then
    raise exception using errcode='22023',message='The account must use the automatic employee number login address.';
  end if;
  employee:=public.pgenro_ensure_account_employee(new.id,number,meta);
  new.raw_user_meta_data:=(meta-'created_by_admin'-'employee_record_id')||jsonb_build_object(
    'registration_source','employee-auto-v2','employee_record_id',employee->>'id',
    'employee_number',btrim(employee->>'employee_id'),'username',btrim(employee->>'employee_id'),
    'full_name',coalesce(nullif(btrim(concat_ws(' ',employee->>'first_name',employee->>'middle_name',employee->>'last_name',employee->>'name_extension')),''),number),
    'contact',coalesce(employee->>'mobile',''),'position',coalesce(employee->>'designation',''),
    'division',coalesce(employee->>'department',''),'requested_role','User','requested_system','User');
  return new;
end $$;
drop trigger if exists a_pgenro_employee_registration on auth.users;
create trigger a_pgenro_employee_registration before insert on auth.users
  for each row execute function public.pgenro_require_employee_registration();

create or replace function public.pgenro_bind_employee_profile()
returns trigger language plpgsql security definer set search_path='' as $$
declare meta jsonb; employee jsonb;
begin
  if tg_op='INSERT' and new.employee_record_id is null then
    select u.raw_user_meta_data into meta from auth.users u where u.id=new.user_id;
    if meta->>'registration_source' in ('employee-id-v1','employee-auto-v2') then
      new.employee_record_id:=nullif(meta->>'employee_record_id','');
    end if;
  end if;
  if tg_op='UPDATE' and (new.employee_record_id is distinct from old.employee_record_id
    or new.employee_number is distinct from old.employee_number)
    and coalesce(auth.role(),'')<>'service_role' and not public.is_pgenro_admin()
    and not(auth.uid() is null and session_user in ('postgres','supabase_admin')
      and coalesce(current_setting('role',true),'none') in ('none','postgres','supabase_admin')) then
    raise exception using errcode='42501',message='Only an administrator can change the linked employee record.';
  end if;
  if new.employee_record_id is not null then
    select public.pgenro_employee_payload(to_jsonb(e)) into employee from public.employees e where e.id::text=new.employee_record_id;
    if employee is null then raise exception using errcode='23503',message='The linked employee record does not exist.'; end if;
    new.employee_number:=btrim(employee->>'employee_id');
  else new.employee_number:=null;
  end if;
  return new;
end $$;
drop trigger if exists pgenro_bind_employee_profile on public.profiles;
create trigger pgenro_bind_employee_profile before insert or update on public.profiles
  for each row execute function public.pgenro_bind_employee_profile();

create or replace function public.pgenro_employee_request_details()
returns trigger language plpgsql security definer set search_path='' as $$
declare profile public.profiles;
begin
  select p.* into profile from public.profiles p where p.user_id::text=new.data->>'uid';
  if profile.employee_record_id is not null then
    new.data:=new.data||jsonb_build_object('employeeNumber',profile.employee_number,'employeeRecordId',profile.employee_record_id);
  end if;
  return new;
end $$;
drop trigger if exists pgenro_employee_request_details on public.access_requests;
create trigger pgenro_employee_request_details before insert or update on public.access_requests
  for each row execute function public.pgenro_employee_request_details();

create or replace function public.pgenro_keep_linked_employee()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.profiles p where p.employee_record_id=old.id::text) then
    raise exception using errcode='23503',message='This employee has a linked account. Archive the employee or unlink the account before deleting the record.';
  end if;
  return old;
end $$;
drop trigger if exists pgenro_keep_linked_employee on public.employees;
create trigger pgenro_keep_linked_employee before delete on public.employees
  for each row execute function public.pgenro_keep_linked_employee();

-- Employee-number corrections keep the same permanent employee/account link.
create or replace function public.pgenro_sync_employee_number()
returns trigger language plpgsql security definer set search_path='' as $$
declare number text:=btrim(public.pgenro_employee_payload(to_jsonb(new))->>'employee_id');
begin
  if number is distinct from btrim(public.pgenro_employee_payload(to_jsonb(old))->>'employee_id') then
    update public.profiles set employee_number=number where employee_record_id=new.id::text;
  end if;
  return new;
end $$;
drop trigger if exists pgenro_sync_employee_number on public.employees;
create trigger pgenro_sync_employee_number after update on public.employees
  for each row execute function public.pgenro_sync_employee_number();

-- Personnel profiles/directory are Admin-only. Users have My Attendance.
create or replace function public.pgenro_employee_directory()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_pgenro_admin() then raise exception using errcode='42501',message='Personnel records are available to administrators. Open My Attendance for your own records.'; end if;
  select coalesce(jsonb_agg(safe.data order by safe.data->>'last_name',safe.data->>'first_name'),'[]'::jsonb) into result
  from public.employees e cross join lateral (
    select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) data
    from jsonb_each(public.pgenro_employee_payload(to_jsonb(e))) as fields(k,v)
    where k=any(array['id','employee_id','first_name','middle_name','last_name','name_extension','gender','dob','pob',
      'civil_status','blood_type','designation','department','employment_type','item_code','date_employed','date_assumption',
      'salary_grade','step_no','nosa_date','eligibility','education_level','course','last_school_attended','year_graduated',
      'duty_status','mobile','mobile_2','landline','email','address','created_at','updated_at'])
  ) safe;
  return result;
end $$;

-- No employee-number argument. Only auth.uid() chooses whose attendance to read.
create or replace function public.pgenro_my_attendance()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare profile public.profiles; employee jsonb; ceremony jsonb; uniforms jsonb;
begin
  if auth.uid() is null or not public.is_pgenro_active_user() then
    raise exception using errcode='42501',message='Sign in with an approved employee User account.';
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

-- Trusted manual linking for older accounts, without creating or changing HR data.
create or replace function public.pgenro_link_employee_account(p_user_id uuid,p_employee_number text)
returns void language plpgsql security definer set search_path='' as $$
declare employee jsonb; matches integer;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.is_pgenro_admin()
    and not(auth.uid() is null and session_user in ('postgres','supabase_admin')
      and coalesce(current_setting('role',true),'none') in ('none','postgres','supabase_admin')) then
    raise exception using errcode='42501',message='Only an active Admin can link an existing account.';
  end if;
  if not exists(select 1 from public.profiles where user_id=p_user_id and role='User') then
    raise exception using errcode='22023',message='Select an existing User account.';
  end if;
  select count(*) into matches from public.employees e
    where lower(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=lower(btrim(p_employee_number));
  if matches<>1 then raise exception using errcode='22023',message='Select a unique existing employee number.'; end if;
  select public.pgenro_employee_payload(to_jsonb(e)) into employee from public.employees e
    where lower(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=lower(btrim(p_employee_number)) for update;
  update public.profiles set employee_record_id=employee->>'id' where user_id=p_user_id;
end $$;

create or replace function public.pgenro_employee_login_email(p_employee_number text)
returns text language plpgsql stable security definer set search_path='' as $$
declare number text:=btrim(p_employee_number); matches integer; target_email text;
begin
  perform public.pgenro_employee_login_address(number);
  select count(*),min(u.email) into matches,target_email
    from public.profiles p join auth.users u on u.id=p.user_id
    left join public.employees e on e.id::text=p.employee_record_id
    where (p.employee_record_id is not null
      and lower(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=lower(number))
      or (p.employee_record_id is null and (lower(btrim(p.username))=lower(number)
        or lower(btrim(u.email))=lower(number)||'@pgenro.ims'));
  if matches<>1 then return null; end if;
  return target_email;
end $$;

-- Realtime messages contain only a caller-owned revision signal, never HR or
-- attendance data. The frontend re-fetches through pgenro_my_attendance().
create table if not exists public.pgenro_attendance_updates (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  revision bigint not null default 1,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.pgenro_attendance_updates enable row level security;
revoke all on public.pgenro_attendance_updates from public,anon,authenticated;
grant select on public.pgenro_attendance_updates to authenticated;
grant all on public.pgenro_attendance_updates to service_role;
drop policy if exists pgenro_attendance_updates_own on public.pgenro_attendance_updates;
create policy pgenro_attendance_updates_own on public.pgenro_attendance_updates for select to authenticated
  using(user_id=(select auth.uid()) and (select public.is_pgenro_active_user()));

create or replace function public.pgenro_touch_attendance_account(p_user_id uuid)
returns void language sql security definer set search_path='' as $$
  insert into public.pgenro_attendance_updates(user_id) values(p_user_id)
  on conflict(user_id) do update set revision=public.pgenro_attendance_updates.revision+1,updated_at=clock_timestamp();
$$;
create or replace function public.pgenro_employee_attendance_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare account_id uuid;
begin
  for account_id in select p.user_id from public.profiles p
    where p.role='User' and p.employee_record_id=new.id::text
  loop
    perform public.pgenro_touch_attendance_account(account_id);
  end loop;
  return new;
end $$;
drop trigger if exists pgenro_employee_attendance_changed on public.employees;
create trigger pgenro_employee_attendance_changed after update on public.employees
  for each row execute function public.pgenro_employee_attendance_changed();

create or replace function public.pgenro_attendance_account_link_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.role<>'User' then
    delete from public.pgenro_attendance_updates where user_id=new.user_id;
    return new;
  end if;
  if tg_op='UPDATE' then
    if new.role=old.role and new.employee_record_id is not distinct from old.employee_record_id
      and new.employee_number is not distinct from old.employee_number then return new; end if;
  end if;
  -- Keep a signal row for unlinked legacy Users too: Admin linking their
  -- employee number must refresh a page that was already open in an empty state.
  perform public.pgenro_touch_attendance_account(new.user_id);
  return new;
end $$;
drop trigger if exists pgenro_attendance_account_link_changed on public.profiles;
create trigger pgenro_attendance_account_link_changed after insert or update on public.profiles
  for each row execute function public.pgenro_attendance_account_link_changed();
insert into public.pgenro_attendance_updates(user_id)
  select p.user_id from public.profiles p where p.role='User' on conflict(user_id) do nothing;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='pgenro_attendance_updates') then
    alter publication supabase_realtime add table public.pgenro_attendance_updates;
  end if;
  -- Restrictive policy composes with older notification policies, so hidden
  -- personnel/admin modules also stay out of User notification counts/results.
  if to_regclass('public.pgenro_module_notifications') is not null then
    drop policy if exists pgenro_admin_record_notifications on public.pgenro_module_notifications;
    create policy pgenro_admin_record_notifications on public.pgenro_module_notifications
      as restrictive for select to authenticated
      using(module_key not in ('employees','visitors','user_accounts','account_requests') or (select public.is_pgenro_admin()));
  end if;
end $$;
revoke all on function public.pgenro_touch_attendance_account(uuid),
  public.pgenro_employee_attendance_changed(),public.pgenro_attendance_account_link_changed() from public,anon,authenticated;

-- Repair older ID accounts from their server-generated login address. Ordinary
-- email accounts require an explicit employee_number or an existing exact HR
-- username match. Do not guess an employee number from a person's name/email.
do $$
declare account record; number text; employee jsonb; skipped integer:=0;
begin
  for account in select p.*,u.email auth_email,u.raw_user_meta_data meta
    from public.profiles p join auth.users u on u.id=p.user_id
    where p.role='User' and p.employee_record_id is null
  loop
    number:=case when lower(account.auth_email) ~ '^[a-z0-9_-][a-z0-9._-]{0,63}@pgenro[.]ims$'
      then split_part(account.auth_email,'@',1) else nullif(btrim(account.employee_number),'') end;
    if number is null and exists(select 1 from public.employees e
      where lower(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=lower(btrim(account.username))) then
      number:=btrim(account.username);
    end if;
    if number is null then continue; end if;
    begin
      employee:=public.pgenro_ensure_account_employee(account.user_id,number,
        coalesce(account.meta,'{}'::jsonb)||jsonb_build_object('full_name',account.full_name,
          'position',account.position,'division',account.division));
      update public.profiles set employee_record_id=employee->>'id' where user_id=account.user_id;
    exception when unique_violation or invalid_parameter_value then skipped:=skipped+1;
    end;
  end loop;
  if skipped>0 then raise notice '% existing account(s) need administrator review; no attendance was merged.',skipped; end if;
end $$;
update public.access_requests r set data=r.data||jsonb_build_object('employeeNumber',p.employee_number,'employeeRecordId',p.employee_record_id)
  from public.profiles p where r.data->>'uid'=p.user_id::text and p.employee_record_id is not null;

-- A restrictive policy also blocks data exposure through old permissive policies.
alter table public.employees enable row level security;
revoke select on public.employees from anon;
drop policy if exists pgenro_employee_private_read on public.employees;
create policy pgenro_employee_private_read on public.employees as restrictive for all to authenticated
  using ((select public.is_pgenro_admin())) with check ((select public.is_pgenro_admin()));
drop policy if exists pgenro_employee_anon_private on public.employees;
create policy pgenro_employee_anon_private on public.employees as restrictive for all to anon using(false) with check(false);

revoke all on function public.pgenro_employee_payload(jsonb),public.pgenro_employee_array(jsonb),
  public.pgenro_employee_login_address(text),public.pgenro_ensure_account_employee(uuid,text,jsonb),
  public.pgenro_require_employee_registration(),public.pgenro_bind_employee_profile(),
  public.pgenro_employee_request_details(),public.pgenro_keep_linked_employee(),public.pgenro_sync_employee_number(),
  public.pgenro_employee_login_email(text) from public,anon,authenticated;
grant execute on function public.pgenro_employee_login_email(text) to service_role;
revoke all on function public.pgenro_employee_registration_check(text,text),public.pgenro_employee_directory(),
  public.pgenro_my_attendance(),public.pgenro_link_employee_account(uuid,text) from public,anon,authenticated;
grant execute on function public.pgenro_employee_registration_check(text,text) to anon,authenticated,service_role;
grant execute on function public.pgenro_employee_directory(),public.pgenro_my_attendance(),
  public.pgenro_link_employee_account(uuid,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;

-- Read-only result: unlinked legacy users can be reviewed by the administrator.
select count(*) filter(where role='User' and employee_record_id is not null) as linked_user_accounts,
  count(*) filter(where role='User' and employee_record_id is null) as unlinked_user_accounts
from public.profiles;
