-- Run AFTER EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql. Safe to run again.
-- Contact email in the HR record stays separate from the employee login alias.
begin;
do $$ begin
  if to_regprocedure('public.pgenro_employee_payload(jsonb)') is null then
    raise exception 'Run EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql first.';
  end if;
end $$;

create or replace function public.pgenro_employee_login_address(p_number text)
returns text language plpgsql immutable set search_path='' as $$
declare number text:=btrim(p_number);
begin
  if number is null or number !~ '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$'
    or right(number,1)='.' or position('..' in number)>0 then
    raise exception using errcode='22023',message='Enter a valid employee ID using 1–64 letters, numbers, dots, underscores or hyphens.';
  end if;
  return lower(number)||'@pgenro.ims';
end $$;

create or replace function public.pgenro_registration_employee(
  p_employee_number text, p_email text, p_lock boolean default false, p_exclude_user uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare employee jsonb; matches integer; number text:=btrim(p_employee_number);
  alias text:=public.pgenro_employee_login_address(p_employee_number); legacy_account boolean;
begin
  if lower(number)='admin001' then
    raise exception using errcode='22023',message='Admin001 is reserved for the first administrator.';
  end if;
  select count(*) into matches from public.employees e
    where upper(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=upper(number);
  if matches<>1 then
    raise exception using errcode='22023',message='Employee ID could not be verified. Ask the administrator to check your Employee record.';
  end if;
  if p_lock then
    select public.pgenro_employee_payload(to_jsonb(e)) into employee from public.employees e
      where upper(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=upper(number) for update;
  else
    select public.pgenro_employee_payload(to_jsonb(e)) into employee from public.employees e
      where upper(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=upper(number);
  end if;
  -- Only a trusted linking operation can retain an already existing Auth email.
  select exists(select 1 from auth.users u where u.id=p_exclude_user
    and lower(btrim(u.email))=lower(btrim(p_email))) into legacy_account;
  if employee is null or (not legacy_account and lower(btrim(coalesce(p_email,'')))<>alias) then
    raise exception using errcode='22023',message='The account must use the automatic employee ID login address.';
  end if;
  if exists(select 1 from public.profiles p where p.employee_record_id=employee->>'id'
    and (p_exclude_user is null or p.user_id<>p_exclude_user))
    or exists(select 1 from auth.users u where lower(u.email)=alias
      and (p_exclude_user is null or u.id<>p_exclude_user)) then
    raise exception using errcode='23505',message='This employee ID already has an account or pending request. Use Sign in or contact the administrator.';
  end if;
  return employee;
end $$;

-- Keep the earlier signature compatible; email is now optional and generated.
create or replace function public.pgenro_employee_registration_check(p_employee_number text,p_email text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare employee jsonb;
begin
  employee:=public.pgenro_registration_employee(p_employee_number,
    coalesce(p_email,public.pgenro_employee_login_address(p_employee_number)));
  return jsonb_build_object('eligible',true,'employee_number',btrim(employee->>'employee_id'));
end $$;

-- Private resolver used only by employee-login. Never reveal account emails
-- through a public RPC. Stable employee links support older email-based accounts.
create or replace function public.pgenro_employee_login_email(p_employee_number text)
returns text language plpgsql stable security definer set search_path='' as $$
declare number text:=btrim(p_employee_number); matches integer; target_email text;
begin
  perform public.pgenro_employee_login_address(number);
  select count(*),min(u.email) into matches,target_email
  from public.profiles p join auth.users u on u.id=p.user_id
  left join public.employees e on e.id::text=p.employee_record_id
  where (p.employee_record_id is not null
    and upper(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=upper(number))
    or (p.employee_record_id is null and (lower(p.username)=lower(number)
      or lower(u.email)=lower(number)||'@pgenro.ims'));
  if matches<>1 then return null; end if;
  return target_email;
end $$;

-- Serialize first-admin setup. Repeating it for the same account is harmless.
create or replace function public.promote_pgenro_first_admin(admin_email text)
returns text language plpgsql security definer set search_path='' as $$
declare account auth.users;
begin
  perform pg_advisory_xact_lock(20261105,1);
  select * into account from auth.users where lower(email)=lower(btrim(admin_email));
  if account.id is null then raise exception 'Create the first Admin Auth account before promoting it.'; end if;
  if exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id
    where p.role='Admin' and p.status='Active' and p.is_active and p.user_id<>account.id) then
    raise exception 'An active administrator already exists. Use User Management to add administrators.';
  end if;
  insert into public.profiles(user_id,full_name,email,username,role,account_type,status,is_active)
  values(account.id,coalesce(nullif(account.raw_user_meta_data->>'full_name',''),'PGENRO Administrator'),
    account.email,coalesce(nullif(account.raw_user_meta_data->>'username',''),split_part(account.email,'@',1)),
    'Admin','Administrator','Active',true)
  on conflict(user_id) do update set role='Admin',account_type='Administrator',status='Active',is_active=true;
  update auth.users set banned_until=null,email_confirmed_at=coalesce(email_confirmed_at,now()),
    raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)
      ||jsonb_build_object('role','admin','pgenro_role','Admin','pgenro_status','Active') where id=account.id;
  if to_regclass('public.access_requests') is not null then
    update public.access_requests set data=(data-'password'-'confirmPassword')
      ||jsonb_build_object('role','Admin','assignedRole','Admin','accountType','Administrator',
        'status','Approved','approvedBy','Bootstrap') where data->>'uid'=account.id::text;
  end if;
  return 'Admin enabled: '||account.email;
end $$;

revoke all on function public.pgenro_employee_login_address(text),
  public.pgenro_registration_employee(text,text,boolean,uuid),public.pgenro_employee_login_email(text),
  public.promote_pgenro_first_admin(text) from public,anon,authenticated;
grant execute on function public.pgenro_employee_login_email(text),
  public.promote_pgenro_first_admin(text) to service_role;
revoke all on function public.pgenro_employee_registration_check(text,text) from public,anon,authenticated;
grant execute on function public.pgenro_employee_registration_check(text,text) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
