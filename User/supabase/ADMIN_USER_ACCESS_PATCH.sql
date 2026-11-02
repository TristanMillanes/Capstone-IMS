-- PGENRO IMS: two access roles, Admin and User.
-- EXISTING PROJECT: run this whole file in Supabase Dashboard > SQL Editor.
-- NEW PROJECT: run COMPLETE_SETUP.sql instead; it already includes this patch.
-- Re-runnable. Keeps operational records, account details and existing accounts.
-- No email replacement is needed here. Existing administrator labels become Admin.
begin;

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Run COMPLETE_SETUP.sql first for a new Supabase project.';
  end if;
end $$;

alter table public.profiles
  add column if not exists email text,
  add column if not exists username text,
  add column if not exists contact text,
  add column if not exists position text,
  add column if not exists division text,
  add column if not exists account_type text not null default 'Standard User',
  add column if not exists status text not null default 'Pending',
  add column if not exists last_login timestamptz,
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- Replace only authorization-role checks from older versions.
drop trigger if exists pgenro_keep_last_admin on public.profiles;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~ '\mrole\M'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

update public.profiles p
set role = case
      when lower(regexp_replace(trim(replace(p.role, '_', ' ')), '\s+', ' ', 'g'))
        in ('admin','administrator','super admin','superadmin','system administrator') then 'Admin'
      else 'User' end,
    status = case
      when lower(trim(p.status)) in ('active','approved','enabled') and p.is_active then 'Active'
      when lower(trim(p.status)) in ('active','approved','enabled') then 'Inactive'
      when lower(trim(p.status)) in ('suspended','banned') then 'Suspended'
      when lower(trim(p.status)) = 'rejected' then 'Rejected'
      when lower(trim(p.status)) = 'pending' then 'Pending'
      else 'Inactive' end,
    email = coalesce(nullif(u.email, ''), p.email),
    updated_at = now()
from auth.users u where u.id = p.user_id;

update public.profiles
set account_type = case when role = 'Admin' then 'Administrator' else 'Standard User' end,
    is_active = (status = 'Active');
alter table public.profiles alter column role set default 'User';
alter table public.profiles alter column is_active set default false;
alter table public.profiles add constraint profiles_admin_user_role check (role in ('Admin','User'));

create or replace function public.is_pgenro_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.user_id
    where p.user_id = (select auth.uid()) and p.role = 'Admin'
      and p.is_active and p.status = 'Active'
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;
create or replace function public.is_pgenro_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join auth.users u on u.id = p.user_id
    where p.user_id = (select auth.uid()) and p.role in ('Admin','User')
      and p.is_active and p.status = 'Active'
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;
-- User Management and the other modules now check the same profile source.
create or replace function public.pgenro_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_pgenro_admin();
$$;
revoke all on function public.is_pgenro_admin() from public, anon;
revoke all on function public.is_pgenro_active_user() from public, anon;
revoke all on function public.pgenro_is_admin() from public, anon;
grant execute on function public.is_pgenro_admin(), public.is_pgenro_active_user(), public.pgenro_is_admin() to authenticated, service_role;

-- Profiles can be read by their owner and active Admins. Account changes use
-- admin-users; the existing self-service Settings RPCs edit display fields only.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='profiles'
  loop execute format('drop policy %I on public.profiles', p.policyname); end loop;
end $$;
alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant all on table public.profiles to service_role;
create policy profiles_read_own_or_admin on public.profiles for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_pgenro_admin()));

-- Replace old directory RPC signatures, including a previously supplied
-- directory-based patch, with guarded profile-based reads.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature, p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'pgenro_admin_%' or p.proname='pgenro_is_super_admin')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    if f.proname in ('pgenro_admin_list_users','pgenro_admin_pending_count') then
      execute format('drop function %s', f.signature);
    end if;
  end loop;
end $$;

create function public.pgenro_admin_list_users(p_offset integer default 0, p_limit integer default 500)
returns table (
  user_id uuid, full_name text, username text, email text, division text,
  role text, status text, is_active boolean, "position" text, contact text,
  last_login timestamptz, created_at timestamptz, updated_at timestamptz, account_type text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_pgenro_admin() then
    raise exception using errcode='42501', message='Active Admin access is required for User Management.';
  end if;
  return query
    select p.user_id::uuid, p.full_name::text, p.username::text,
      coalesce(u.email::text,p.email::text), p.division::text,
      p.role::text, (case when p.status='Active' and u.banned_until > now() then 'Suspended' else p.status end)::text,
      (p.is_active and (u.banned_until is null or u.banned_until <= now()))::boolean,
      p.position::text, p.contact::text,
      coalesce(u.last_sign_in_at::timestamptz,p.last_login::timestamptz),
      p.created_at::timestamptz, p.updated_at::timestamptz, p.account_type::text
    from public.profiles p join auth.users u on u.id=p.user_id
    order by p.created_at desc, p.user_id
    offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,500),1),500);
end $$;
create function public.pgenro_admin_pending_count()
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare total bigint;
begin
  if not public.is_pgenro_admin() then
    raise exception using errcode='42501', message='Active Admin access is required.';
  end if;
  if to_regclass('public.access_requests') is null then return 0; end if;
  select count(*) into total from public.access_requests r where lower(r.data->>'status')='pending';
  return total;
end $$;
revoke all on function public.pgenro_admin_list_users(integer,integer), public.pgenro_admin_pending_count() from public, anon;
grant execute on function public.pgenro_admin_list_users(integer,integer), public.pgenro_admin_pending_count() to authenticated, service_role;

-- A requested role describes the application, not authorization. Profiles always
-- start as inactive Pending Users; an active Admin assigns the final role.
create or replace function public.handle_new_pgenro_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare meta jsonb := coalesce(new.raw_user_meta_data,'{}'::jsonb); request_id text; requested_role text;
begin
  requested_role := case lower(trim(coalesce(nullif(meta->>'requested_role',''),
    nullif(meta->>'requested_system',''),'User'))) when 'admin' then 'Admin' else 'User' end;
  request_id := 'REQ-' || to_char(now(),'YYYY') || '-' || new.id::text;
  insert into public.profiles(user_id,full_name,email,username,contact,position,division,role,account_type,status,is_active)
  values (new.id,coalesce(nullif(meta->>'full_name',''),split_part(new.email,'@',1)),new.email,
    coalesce(nullif(meta->>'username',''),split_part(new.email,'@',1)),nullif(meta->>'contact',''),
    nullif(meta->>'position',''),nullif(meta->>'division',''),'User','Standard User','Pending',false)
  on conflict(user_id) do nothing;
  if to_regclass('public.access_requests') is not null then
    insert into public.access_requests(id,data) values (request_id,jsonb_build_object(
      'id',request_id,'refCode',coalesce(nullif(meta->>'request_id',''),request_id),'uid',new.id::text,
      'fullName',coalesce(nullif(meta->>'full_name',''),split_part(new.email,'@',1)),
      'username',coalesce(nullif(meta->>'username',''),split_part(new.email,'@',1)),
      'email',new.email,'contact',coalesce(meta->>'contact',''),'position',coalesce(meta->>'position',''),
      'division',coalesce(meta->>'division',''),'role',requested_role,'requestedRole',requested_role,'assignedRole',null,
      'endorser',coalesce(meta->>'endorser',''),'reason',coalesce(meta->>'reason',''),'status','Pending',
      'timestamp',floor(extract(epoch from now())*1000),'date',to_char(now(),'Mon DD, YYYY HH12:MI AM')))
    on conflict(id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created_pgenro on auth.users;
create trigger on_auth_user_created_pgenro after insert on auth.users
for each row execute function public.handle_new_pgenro_auth_user();
revoke all on function public.handle_new_pgenro_auth_user() from public, anon, authenticated;

-- Recover the role chosen on the earlier registration form for unreviewed
-- requests only. The previous form sent it as requested_system. This changes
-- application details, never the Pending profile or its permissions.
do $$
begin
  if to_regclass('public.access_requests') is not null then
    update public.access_requests r
    set data=r.data || jsonb_build_object('requestedRole',case lower(trim(coalesce(
      nullif(u.raw_user_meta_data->>'requested_system',''),nullif(u.raw_user_meta_data->>'requested_role',''),
      nullif(r.data->>'requestedRole',''),nullif(r.data->>'role',''),'User')))
      when 'admin' then 'Admin' else 'User' end,'assignedRole',null,
      'role',case lower(trim(coalesce(nullif(u.raw_user_meta_data->>'requested_system',''),
      nullif(u.raw_user_meta_data->>'requested_role',''),nullif(r.data->>'requestedRole',''),
      nullif(r.data->>'role',''),'User'))) when 'admin' then 'Admin' else 'User' end)
    from auth.users u
    where r.data->>'uid'=u.id::text and lower(r.data->>'status')='pending'
      and not(r.data ? 'assignedRole');
  end if;
end $$;

create or replace function public.pgenro_guard_admin_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and new.user_id is distinct from old.user_id then
    raise exception using errcode='23514', message='The Auth user ID cannot be changed.';
  end if;
  if old.role='Admin' and old.is_active and old.status='Active' then
    if tg_op='UPDATE' then
      if new.role='Admin' and new.is_active and new.status='Active' then return new; end if;
    end if;
    perform pg_advisory_xact_lock(20261010,742);
    if not exists (
      select 1 from public.profiles p join auth.users u on u.id=p.user_id
      where p.user_id<>old.user_id and p.role='Admin' and p.is_active and p.status='Active'
        and (u.banned_until is null or u.banned_until<=now())
    ) then raise exception using errcode='23514', message='Keep at least one active Admin account.'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger pgenro_keep_last_admin before update or delete on public.profiles
for each row execute function public.pgenro_guard_admin_profile();
revoke all on function public.pgenro_guard_admin_profile() from public, anon, authenticated;

-- Strictly monotonic version for concurrent account changes and safe rollback.
create or replace function public.pgenro_profile_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(),old.updated_at + interval '1 microsecond');
  return new;
end $$;
drop trigger if exists z_pgenro_profile_version on public.profiles;
create trigger z_pgenro_profile_version before update on public.profiles
for each row execute function public.pgenro_profile_version();
revoke all on function public.pgenro_profile_version() from public, anon, authenticated;

-- Prevent duplicate new usernames without renaming legacy personnel accounts.
create or replace function public.pgenro_unique_profile_username()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' then
    if new.username is not distinct from old.username then return new; end if;
  end if;
  if nullif(trim(new.username),'') is null then return new; end if;
  perform pg_advisory_xact_lock(20261010,743);
  if exists(select 1 from public.profiles p where p.user_id<>new.user_id
    and lower(p.username)=lower(new.username)) then
    raise exception using errcode='23505', message='Username already exists.';
  end if;
  return new;
end $$;
drop trigger if exists pgenro_unique_username on public.profiles;
create trigger pgenro_unique_username before insert or update on public.profiles
for each row execute function public.pgenro_unique_profile_username();
revoke all on function public.pgenro_unique_profile_username() from public, anon, authenticated;

-- Keep compatibility registries readable; account writes go through admin-users.
do $$
declare t text;
begin
  foreach t in array array['users','admins','access_requests'] loop
    if to_regclass(format('public.%I',t)) is null then continue; end if;
    execute format('revoke insert,update on public.%I from public,anon,authenticated',t);
    execute format('update public.%I set data=(data - ''password'' - ''confirmPassword'') || jsonb_build_object(''role'',case when lower(data->>''role'') in (''admin'',''administrator'',''super admin'',''superadmin'',''system administrator'') then ''Admin'' else ''User'' end,''accountType'',case when lower(data->>''role'') in (''admin'',''administrator'',''super admin'',''superadmin'',''system administrator'') then ''Administrator'' else ''Standard User'' end)',t);
  end loop;
end $$;

-- Enforce the Admin/User boundary even when older permissive policies exist.
do $$
declare t text; p record;
begin
  foreach t in array array['communications','office_memos','travel_orders','employees','inventory',
    'inventory_movements','ics_records','service_requests','visitors'] loop
    if to_regclass(format('public.%I',t)) is null then continue; end if;
    execute format('alter table public.%I enable row level security',t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t
      and roles && array['authenticated','public']::name[]
    loop execute format('drop policy %I on public.%I',p.policyname,t); end loop;
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('create policy active_user_select on public.%I for select to authenticated using ((select public.is_pgenro_active_user()))',t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select public.is_pgenro_admin()))',t);
    execute format('create policy admin_update on public.%I for update to authenticated using ((select public.is_pgenro_admin())) with check ((select public.is_pgenro_admin()))',t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using ((select public.is_pgenro_admin()))',t);
  end loop;
end $$;

-- SQL Editor-only bootstrap. Existing Admins do not need to run this function.
create or replace function public.promote_pgenro_first_admin(admin_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare account auth.users;
begin
  select * into account from auth.users where lower(email)=lower(trim(admin_email));
  if account.id is null then raise exception 'Create this email in Authentication > Users first: %',admin_email; end if;
  insert into public.profiles(user_id,full_name,email,username,role,account_type,status,is_active)
  values(account.id,coalesce(nullif(account.raw_user_meta_data->>'full_name',''),split_part(account.email,'@',1)),
    account.email,coalesce(nullif(account.raw_user_meta_data->>'username',''),split_part(account.email,'@',1)),
    'Admin','Administrator','Active',true)
  on conflict(user_id) do update set role='Admin',account_type='Administrator',status='Active',is_active=true;
  update auth.users set banned_until=null,raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)
    || jsonb_build_object('role','admin','pgenro_role','Admin','pgenro_status','Active') where id=account.id;
  if to_regclass('public.access_requests') is not null then
    update public.access_requests set data=(data-'password'-'confirmPassword')
      || jsonb_build_object('role','Admin','accountType','Administrator','status','Approved','approvedBy','Bootstrap')
    where data->>'uid'=account.id::text;
  end if;
  return 'Admin enabled: '||account.email;
end $$;
revoke all on function public.promote_pgenro_first_admin(text) from public,anon,authenticated;
grant execute on function public.promote_pgenro_first_admin(text) to service_role;

-- Per-module new-record notifications, 10 October 2026.

create table if not exists public.pgenro_module_notifications (
  id uuid primary key default gen_random_uuid(),
  module_key text not null check (module_key in ('communications','travel_orders','office_memos',
    'employees','inventory','visitors','service_requests','ics_records','user_accounts','account_requests')),
  record_id text not null,
  title text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists pgenro_notifications_module_date on public.pgenro_module_notifications(module_key,created_at desc);
create index if not exists pgenro_notifications_date on public.pgenro_module_notifications(created_at desc,id);
create table if not exists public.pgenro_notification_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_id uuid not null references public.pgenro_module_notifications(id) on delete cascade,
  read_at timestamptz not null default clock_timestamp(),
  primary key(user_id,notification_id)
);

alter table public.pgenro_module_notifications enable row level security;
alter table public.pgenro_notification_reads enable row level security;
revoke all on public.pgenro_module_notifications,public.pgenro_notification_reads from public,anon,authenticated;
grant select on public.pgenro_module_notifications to authenticated;
grant select,insert on public.pgenro_notification_reads to authenticated;
grant all on public.pgenro_module_notifications,public.pgenro_notification_reads to service_role;
drop policy if exists pgenro_notifications_visible on public.pgenro_module_notifications;
create policy pgenro_notifications_visible on public.pgenro_module_notifications for select to authenticated
using ((select public.is_pgenro_active_user()) and
  (module_key not in ('user_accounts','account_requests') or (select public.is_pgenro_admin())));
drop policy if exists pgenro_notification_reads_own on public.pgenro_notification_reads;
create policy pgenro_notification_reads_own on public.pgenro_notification_reads for select to authenticated
using (user_id=(select auth.uid()) and (select public.is_pgenro_active_user()));
drop policy if exists pgenro_notification_reads_insert on public.pgenro_notification_reads;
create policy pgenro_notification_reads_insert on public.pgenro_notification_reads for insert to authenticated
with check (user_id=(select auth.uid()) and (select public.is_pgenro_active_user()) and exists
  (select 1 from public.pgenro_module_notifications n where n.id=notification_id));

create or replace function public.pgenro_notify_module_insert()
returns trigger language plpgsql security definer set search_path='' as $$
declare payload jsonb:=to_jsonb(new); details jsonb; record_key text; record_title text;
begin
  details:=payload || case when jsonb_typeof(payload->'data')='object' then payload->'data' else '{}'::jsonb end;
  record_key:=coalesce(payload->>'user_id',payload->>'id');
  if record_key is null then return new; end if;
  record_title:=coalesce(nullif(details->>'subject',''),nullif(details->>'item_name',''),
    nullif(details->>'fullName',''),nullif(details->>'full_name',''),nullif(details->>'employeeName',''),nullif(details->>'traveler_name',''),
    nullif(trim(concat_ws(' ',details->>'first_name',details->>'last_name')),''),
    nullif(details->>'requesterName',''),nullif(details->>'accountablePerson',''),
    nullif(details->>'controlNo',''),nullif(details->>'control_no',''),record_key);
  insert into public.pgenro_module_notifications(module_key,record_id,title)
  values(tg_argv[0],record_key,left(record_title,180));
  return new;
end $$;
revoke all on function public.pgenro_notify_module_insert() from public,anon,authenticated;

do $$
declare mapping record;
begin
  for mapping in select * from (values
    ('communications','communications'),('travel_orders','travel_orders'),('office_memos','office_memos'),
    ('employees','employees'),('inventory','inventory'),('visitors','visitors'),
    ('service_requests','service_requests'),('ics_records','ics_records'),
    ('profiles','user_accounts'),('access_requests','account_requests')) as modules(table_name,module_key)
  loop
    if to_regclass(format('public.%I',mapping.table_name)) is null then continue; end if;
    execute format('drop trigger if exists pgenro_module_new_record on public.%I',mapping.table_name);
    execute format('create trigger pgenro_module_new_record after insert on public.%I for each row execute function public.pgenro_notify_module_insert(%L)',mapping.table_name,mapping.module_key);
  end loop;
end $$;

create or replace function public.pgenro_get_module_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if not public.is_pgenro_active_user() then
    raise exception using errcode='42501',message='An active approved account is required.';
  end if;
  with unread as (
    select n.* from public.pgenro_module_notifications n
    where not exists(select 1 from public.pgenro_notification_reads r
      where r.user_id=auth.uid() and r.notification_id=n.id)
  ), module_counts as (
    select module_key,count(*) as total from unread group by module_key
  ), latest as (
    select * from unread order by created_at desc,id desc limit greatest(1,least(coalesce(p_limit,30),100))
  )
  select jsonb_build_object('total',(select count(*) from unread),
    'workspace',case when public.is_pgenro_admin() then 'admin' else 'user' end,
    'counts',coalesce((select jsonb_object_agg(module_key,total) from module_counts),'{}'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'module',module_key,
      'recordId',record_id,'title',title,'createdAt',created_at) order by created_at desc,id desc) from latest),'[]'::jsonb))
  into result;
  return result;
end $$;

create or replace function public.pgenro_mark_notifications_read(p_ids uuid[] default null,p_module text default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare marked integer;
begin
  if not public.is_pgenro_active_user() then
    raise exception using errcode='42501',message='An active approved account is required.';
  end if;
  if p_module is not null and p_module not in ('communications','travel_orders','office_memos',
    'employees','inventory','visitors','service_requests','ics_records','user_accounts','account_requests') then
    raise exception using errcode='22023',message='Unknown notification module.';
  end if;
  if p_ids is not null and cardinality(p_ids)>1000 then
    raise exception using errcode='22023',message='Select up to 1000 notifications at a time.';
  end if;
  insert into public.pgenro_notification_reads(user_id,notification_id)
  select auth.uid(),n.id from public.pgenro_module_notifications n
  where (p_ids is null or n.id=any(p_ids)) and (p_module is null or n.module_key=p_module)
  on conflict(user_id,notification_id) do nothing;
  get diagnostics marked=row_count;
  return marked;
end $$;
revoke all on function public.pgenro_get_module_notifications(integer),public.pgenro_mark_notifications_read(uuid[],text) from public,anon;
grant execute on function public.pgenro_get_module_notifications(integer),public.pgenro_mark_notifications_read(uuid[],text) to authenticated;

-- Supabase Realtime respects the notification table's SELECT policy.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='pgenro_module_notifications') then
    alter publication supabase_realtime add table public.pgenro_module_notifications;
  end if;
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='pgenro_notification_reads') then
    alter publication supabase_realtime add table public.pgenro_notification_reads;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
