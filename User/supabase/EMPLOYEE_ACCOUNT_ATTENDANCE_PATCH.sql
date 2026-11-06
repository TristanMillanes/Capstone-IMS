-- Run this file LAST, after COMPLETE_SETUP.sql or ADMIN_USER_ACCESS_PATCH.sql.
-- Installs Employee Number linking, private employee-number login lookup,
-- synchronized account-request details, personal attendance access, and the
-- one-time first Admin bootstrap.
-- Employee Numbers are text: leading zeroes and internal punctuation are preserved.
begin;

alter table public.profiles
  add column if not exists employee_record_id text,
  add column if not exists employee_number text;
create unique index if not exists profiles_one_account_per_employee
  on public.profiles(employee_record_id) where employee_record_id is not null;

-- One employee number can identify only one account, regardless of letter case.
do $$
begin
  if exists (
    select 1 from public.profiles
    where nullif(btrim(employee_number),'') is not null
    group by upper(btrim(employee_number)) having count(*) > 1
  ) then
    raise exception 'Duplicate Employee Numbers already exist in profiles. Resolve those account links before installing this patch.';
  end if;
end $$;
create unique index if not exists profiles_employee_number_unique
  on public.profiles (upper(btrim(employee_number)))
  where nullif(btrim(employee_number),'') is not null;

-- Normalized installations store monitoring arrays as employee columns.
-- Legacy JSON-backed installations keep the arrays inside employees.data.
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
    begin parsed := (value #>> '{}')::jsonb;
      if jsonb_typeof(parsed)='array' then return parsed; end if;
    exception when invalid_text_representation then return '[]'::jsonb;
    end;
  end if;
  return '[]'::jsonb;
end $$;

-- Internal resolver. It is not callable by anonymous/authenticated clients.
create or replace function public.pgenro_registration_employee(
  p_employee_number text, p_email text, p_lock boolean default false, p_exclude_user uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare employee jsonb; matches integer; number text:=btrim(p_employee_number); email text:=lower(btrim(p_email));
begin
  if number is null or number='' or length(number)>80 or email is null or email=''
    or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode='22023',message='Enter an Employee Number and a valid email address.';
  end if;
  select count(*) into matches from public.employees e
    where upper(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=upper(number);
  if matches<>1 then
    raise exception using errcode='22023',message='Employee Number and email could not be verified. Ask the administrator to check your Employee record.';
  end if;
  if p_lock then
    select public.pgenro_employee_payload(to_jsonb(e)) into employee from public.employees e
      where upper(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=upper(number) for update;
  else
    select public.pgenro_employee_payload(to_jsonb(e)) into employee from public.employees e
      where upper(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=upper(number);
  end if;
  if employee is null or (nullif(btrim(employee->>'email'),'') is not null
    and lower(btrim(employee->>'email'))<>email) then
    raise exception using errcode='22023',message='Employee Number and email could not be verified. Ask the administrator to check your Employee record.';
  end if;
  -- Detect both newly linked profiles and legacy profiles that still have the
  -- Employee Number stored only in username/employee_number. This prevents a
  -- second Auth account from colliding with the legacy unique-username trigger.
  if exists(
    select 1 from public.profiles p
    where (
      p.employee_record_id=employee->>'id'
      or upper(btrim(coalesce(p.employee_number,'')))=upper(number)
      or upper(btrim(coalesce(p.username,'')))=upper(number)
    )
    and (p_exclude_user is null or p.user_id<>p_exclude_user)
  ) then
    raise exception using errcode='23505',message='This Employee Number already has an account or pending request. Use Sign in or ask the system administrator to link the existing account.';
  end if;
  return employee;
end $$;

-- Returns no personnel details, attendance, account email or account identity.
create or replace function public.pgenro_employee_registration_check(p_employee_number text,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare employee jsonb;
begin
  employee:=public.pgenro_registration_employee(p_employee_number,p_email);
  return jsonb_build_object('eligible',true,'employee_number',btrim(employee->>'employee_id'));
end $$;

-- Private identity lookup used only by the employee-login Edge Function.
-- The browser never receives the email-to-employee-number directory lookup.
-- PostgreSQL cannot change a RETURNS TABLE shape using CREATE OR REPLACE, so
-- drop this exact signature first. No SQL function depends on this RPC; it is
-- called by the Edge Function through PostgREST only.
drop function if exists public.pgenro_employee_login_lookup(text);
create function public.pgenro_employee_login_lookup(p_employee_number text)
returns table(user_id uuid,email text,role text,status text,is_active boolean)
language sql stable security definer set search_path='' as $$
  select p.user_id,u.email,p.role,p.status,p.is_active
  from public.profiles p
  join auth.users u on u.id=p.user_id
  where nullif(btrim(p_employee_number),'') is not null
    and upper(btrim(p.employee_number))=upper(btrim(p_employee_number))
  limit 2;
$$;

create or replace function public.pgenro_require_employee_registration()
returns trigger language plpgsql security definer set search_path='' as $$
declare employee jsonb; meta jsonb:=coalesce(new.raw_user_meta_data,'{}'::jsonb);
begin
  -- These app metadata fields can only be set by the trusted Admin Auth API.
  -- A same-named field in user_metadata never bypasses employee verification.
  if new.raw_app_meta_data->>'created_by_admin'='true' or
    (new.raw_app_meta_data->>'pgenro_role' in ('Admin','User') and
     new.raw_app_meta_data->>'pgenro_status' in ('Active','Inactive','Suspended')) then return new; end if;
  employee:=public.pgenro_registration_employee(meta->>'employee_number',new.email,true,new.id);
  new.raw_user_meta_data:=(meta-'created_by_admin')||jsonb_build_object(
    'registration_source','employee-id-v1','employee_record_id',employee->>'id',
    'employee_number',btrim(employee->>'employee_id'),'username',btrim(employee->>'employee_id'),
    'full_name',coalesce(nullif(btrim(concat_ws(' ',employee->>'first_name',employee->>'middle_name',
      employee->>'last_name',employee->>'name_extension')),''),employee->>'full_name',employee->>'employee_id'),
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
    if meta->>'registration_source'='employee-id-v1' then
      new.employee_record_id:=nullif(meta->>'employee_record_id','');
    end if;
  end if;
  if tg_op='UPDATE' and new.employee_record_id is distinct from old.employee_record_id
    and coalesce(auth.role(),'')<>'service_role' and not public.is_pgenro_admin()
    and not(auth.uid() is null and session_user in ('postgres','supabase_admin')
      and coalesce(current_setting('role',true),'none') in ('none','postgres','supabase_admin')) then
    raise exception using errcode='42501',message='Only an administrator can change the linked employee record.';
  end if;
  if new.employee_record_id is not null then
    select public.pgenro_employee_payload(to_jsonb(e)) into employee from public.employees e
      where e.id::text=new.employee_record_id;
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
    new.data:=new.data||jsonb_build_object('employeeNumber',profile.employee_number,
      'employeeRecordId',profile.employee_record_id);
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

-- Only unambiguous, already approved accounts with a verified matching email
-- are linked automatically. Other existing accounts remain unlinked.
with matches as (
  select p.user_id,min(e.id::text) employee_record_id from public.profiles p
  join auth.users u on u.id=p.user_id and u.email_confirmed_at is not null
  join public.employees e on nullif(lower(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'email')),'')=lower(btrim(u.email))
  where p.role='User' and p.is_active and p.status='Active' and p.employee_record_id is null
    and not exists(select 1 from public.profiles claimed where claimed.employee_record_id=e.id::text)
  group by p.user_id having count(*)=1
), unique_matches as (
  select * from matches m where not exists(select 1 from matches other
    where other.employee_record_id=m.employee_record_id and other.user_id<>m.user_id)
)
update public.profiles p set employee_record_id=m.employee_record_id from unique_matches m where p.user_id=m.user_id;

-- Read-only directory data is separate from private monitoring arrays. The
-- projection preserves the existing directory fields, with no attendance data.
create or replace function public.pgenro_employee_directory()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_pgenro_active_user() then raise exception using errcode='42501',message='Sign in with an approved account.'; end if;
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

-- No Employee Number argument: the caller cannot request another person's records.
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

-- Existing accounts without a unique verified-email match can be linked by
-- an active Admin (or the SQL owner) after confirming the employee's identity.
create or replace function public.pgenro_link_employee_account(p_user_id uuid,p_employee_number text)
returns void language plpgsql security definer set search_path='' as $$
declare employee jsonb; email text;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.is_pgenro_admin()
    and not(auth.uid() is null and session_user in ('postgres','supabase_admin')
      and coalesce(current_setting('role',true),'none') in ('none','postgres','supabase_admin')) then
    raise exception using errcode='42501',message='Only an active Admin can link an existing account.';
  end if;
  select u.email into email from auth.users u join public.profiles p on p.user_id=u.id where u.id=p_user_id and p.role='User';
  if email is null then raise exception using errcode='22023',message='Select an existing User account.'; end if;
  employee:=public.pgenro_registration_employee(p_employee_number,email,true,p_user_id);
  update public.profiles set employee_record_id=employee->>'id' where user_id=p_user_id;
end $$;

-- One-time first Admin bootstrap. The account must already have completed the
-- normal employee-number registration and verified its email. It cannot be
-- used to create additional Admins after the first active Admin exists.
create or replace function public.promote_pgenro_first_admin_by_employee_number(p_employee_number text)
returns text language plpgsql security definer set search_path='' as $$
declare target public.profiles; account auth.users; target_number text:=btrim(p_employee_number);
begin
  if target_number is null or target_number='' or length(target_number)>80 then
    raise exception 'Enter the first Admin employee number.';
  end if;

  if exists (
    select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where p.role='Admin' and p.status='Active' and p.is_active
      and (u.banned_until is null or u.banned_until<=now())
  ) then
    raise exception 'An active Admin already exists. Use User Management to manage other accounts.';
  end if;

  select p.* into target
  from public.profiles p
  join auth.users u on u.id=p.user_id
  where upper(btrim(p.employee_number))=upper(target_number)
    and p.employee_record_id is not null
    and u.email_confirmed_at is not null
    and lower(coalesce(p.status,'')) not in ('rejected','suspended')
  for update of p;

  if target.user_id is null then
    raise exception 'No verified employee account was found for Employee Number %. Register through Request Account, verify the email, and try again.',target_number;
  end if;

  select * into account from auth.users where id=target.user_id;
  update public.profiles
    set role='Admin',account_type='Administrator',status='Active',is_active=true,updated_at=now()
    where user_id=target.user_id;

  update auth.users
    set banned_until=null,
        raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)
          || jsonb_build_object('role','admin','pgenro_role','Admin','pgenro_status','Active')
    where id=target.user_id;

  if to_regclass('public.access_requests') is not null then
    update public.access_requests
      set data=(data-'password'-'confirmPassword')
        || jsonb_build_object('employeeNumber',target.employee_number,
          'employeeRecordId',target.employee_record_id,'role','Admin',
          'accountType','Administrator','assignedRole','Admin','status','Approved',
          'approvedBy','First Admin Bootstrap','approvedAt',now())
      where data->>'uid'=target.user_id::text;
  end if;

  if to_regclass('public.users') is not null then
    update public.users
      set data=(coalesce(data,'{}'::jsonb)-'password'-'confirmPassword')
        || jsonb_build_object('employeeNumber',target.employee_number,'fullName',target.full_name,
          'email',coalesce(account.email,target.email),'role','Admin',
          'accountType','Administrator','status','Active')
      where id=target.user_id::text;
  end if;

  if to_regclass('public.admins') is not null then
    insert into public.admins(id,data)
    values(target.user_id::text,jsonb_build_object('uid',target.user_id::text,
      'employeeNumber',target.employee_number,'fullName',target.full_name,
      'email',coalesce(account.email,target.email),'role','Admin',
      'accountType','Administrator','status','Active'))
    on conflict(id) do update set data=excluded.data,updated_at=now();
  end if;

  return 'First Admin activated for Employee Number '||target.employee_number||'.';
end $$;

-- Restrictive policies compose with legacy permissive policies. Users
-- get directory projections / their own attendance only through the RPCs above.
alter table public.employees enable row level security;
revoke select on public.employees from anon;
drop policy if exists pgenro_employee_private_read on public.employees;
create policy pgenro_employee_private_read on public.employees as restrictive for all to authenticated
  using ((select public.is_pgenro_admin())) with check ((select public.is_pgenro_admin()));
drop policy if exists pgenro_employee_anon_private on public.employees;
create policy pgenro_employee_anon_private on public.employees as restrictive for all to anon
  using (false) with check (false);

revoke all on function public.pgenro_employee_payload(jsonb),public.pgenro_employee_array(jsonb),
  public.pgenro_registration_employee(text,text,boolean,uuid),public.pgenro_require_employee_registration(),
  public.pgenro_bind_employee_profile(),public.pgenro_employee_request_details(),public.pgenro_keep_linked_employee()
  from public,anon,authenticated;
revoke all on function public.pgenro_employee_registration_check(text,text),public.pgenro_employee_login_lookup(text),
  public.pgenro_employee_directory(),public.pgenro_my_attendance(),
  public.pgenro_link_employee_account(uuid,text),public.promote_pgenro_first_admin_by_employee_number(text)
  from public,anon,authenticated;
grant execute on function public.pgenro_employee_registration_check(text,text) to anon,authenticated;
grant execute on function public.pgenro_registration_employee(text,text,boolean,uuid),
  public.pgenro_employee_login_lookup(text),public.promote_pgenro_first_admin_by_employee_number(text) to service_role;
grant execute on function public.pgenro_employee_directory(),public.pgenro_my_attendance(),
  public.pgenro_link_employee_account(uuid,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
