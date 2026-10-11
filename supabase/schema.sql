-- ============================================================================
-- PGENRO IMS - SUPABASE DATABASE SCHEMA
-- Run this once in Supabase Dashboard > SQL Editor.
-- Auth, admin-control, operational data, and RLS schema for the PGENRO IMS project.
-- ============================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- 1) Admin profile used by Row Level Security
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'User',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_pgenro_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_active = true
      and lower(p.role) = 'admin'
  );
$$;

revoke all on function public.is_pgenro_admin() from public;
grant execute on function public.is_pgenro_admin() to authenticated, service_role;

-- --------------------------------------------------------------------------
-- 2) JSONB-backed tables used by legacy admin screens.
--    The compatibility adapter flattens data JSON into the existing UI model.
-- --------------------------------------------------------------------------
create table if not exists public.users (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admins (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.access_requests (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_requests (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.visitors (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- Visitors Log normalized columns. The legacy JSONB column is retained so old
-- dashboard/compatibility reads keep working while all visitor screens use the
-- same first-class columns.
alter table public.visitors
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists full_name text,
  add column if not exists contact text,
  add column if not exists address text,
  add column if not exists person_to_visit text,
  add column if not exists purpose_category text,
  add column if not exists other_purpose_specific text,
  add column if not exists visit_date date,
  add column if not exists time_in timestamptz,
  add column if not exists time_out timestamptz,
  add column if not exists status text;

-- Existing deployments may have either a text or UUID visitor primary key.
-- Give both variants an automatic UUID default without dropping any records.
do $$
declare visitor_id_type text;
begin
  select data_type into visitor_id_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'visitors' and column_name = 'id';

  if visitor_id_type = 'uuid' then
    execute 'alter table public.visitors alter column id set default gen_random_uuid()';
  else
    execute 'alter table public.visitors alter column id set default (gen_random_uuid()::text)';
  end if;
end $$;

-- Migrate legacy JSON visitor rows into the normalized columns.
update public.visitors
set
  full_name = coalesce(nullif(full_name, ''), nullif(data->>'fullName', ''), nullif(data->>'full_name', ''), 'Visitor'),
  contact = coalesce(contact, data->>'contact', ''),
  address = coalesce(address, data->>'address', ''),
  person_to_visit = coalesce(person_to_visit, data->>'personToVisit', data->>'person_to_visit', ''),
  purpose_category = coalesce(purpose_category, data->>'purposeCategory', data->>'purpose_category', ''),
  other_purpose_specific = coalesce(other_purpose_specific, data->>'otherPurposeSpecific', data->>'other_purpose_specific', ''),
  visit_date = coalesce(
    visit_date,
    case
      when coalesce(data->>'visit_date', data->>'dateISO', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then coalesce(data->>'visit_date', data->>'dateISO')::date
      else created_at::date
    end
  ),
  time_in = coalesce(
    time_in,
    case
      when coalesce(data->>'timeInISO', data->>'time_in', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        then coalesce(data->>'timeInISO', data->>'time_in')::timestamptz
      else created_at
    end
  ),
  time_out = coalesce(
    time_out,
    case
      when coalesce(data->>'timeOutISO', data->>'time_out', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        then coalesce(data->>'timeOutISO', data->>'time_out')::timestamptz
      else null
    end
  ),
  status = case
    when lower(coalesce(status, data->>'status', 'inside')) in ('completed','checked out','checked_out','out') then 'completed'
    else 'inside'
  end;

alter table public.visitors
  alter column full_name set default 'Visitor',
  alter column full_name set not null,
  alter column contact set default '',
  alter column contact set not null,
  alter column address set default '',
  alter column address set not null,
  alter column person_to_visit set default '',
  alter column person_to_visit set not null,
  alter column purpose_category set default '',
  alter column purpose_category set not null,
  alter column other_purpose_specific set default '',
  alter column other_purpose_specific set not null,
  alter column visit_date set default current_date,
  alter column visit_date set not null,
  alter column time_in set default now(),
  alter column time_in set not null,
  alter column status set default 'inside',
  alter column status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.visitors'::regclass
      and conname = 'visitors_status_check'
  ) then
    alter table public.visitors
      add constraint visitors_status_check check (status in ('inside','completed'));
  end if;
end $$;

create index if not exists visitors_visit_date_idx on public.visitors (visit_date desc);
create index if not exists visitors_time_in_idx on public.visitors (time_in desc);
create index if not exists visitors_status_column_idx on public.visitors (status);

-- Keep the retained JSON representation synchronized for legacy dashboard code.
create or replace function public.sync_visitor_legacy_data()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object(
    'fullName', new.full_name,
    'contact', new.contact,
    'address', new.address,
    'personToVisit', new.person_to_visit,
    'purposeCategory', new.purpose_category,
    'otherPurposeSpecific', new.other_purpose_specific,
    'visit_date', new.visit_date,
    'dateISO', new.visit_date,
    'timeInISO', new.time_in,
    'timeOutISO', new.time_out,
    'status', new.status,
    'timestamp', floor(extract(epoch from new.time_in) * 1000)
  );
  return new;
end;
$$;

drop trigger if exists sync_visitor_legacy_data_trigger on public.visitors;
create trigger sync_visitor_legacy_data_trigger
before insert or update of full_name, contact, address, person_to_visit,
  purpose_category, other_purpose_specific, visit_date, time_in, time_out, status
on public.visitors
for each row execute function public.sync_visitor_legacy_data();

-- Backfill JSON once for rows migrated before the trigger existed.
update public.visitors set status = status;

create table if not exists public.admin_logs (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.office_memos (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communications (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ics_records (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Useful JSON expression indexes for admin filters/searches.
create index if not exists access_requests_status_idx on public.access_requests ((data->>'status'));
create index if not exists access_requests_email_idx on public.access_requests ((lower(data->>'email')));
create index if not exists service_requests_status_idx on public.service_requests ((data->>'serviceStatus'));
create index if not exists service_requests_date_idx on public.service_requests ((data->>'dateRequest'));
create index if not exists users_email_idx on public.users ((lower(data->>'email')));
create index if not exists visitors_status_idx on public.visitors ((data->>'status'));
create index if not exists communications_date_idx on public.communications ((data->>'date'));
create index if not exists office_memos_date_idx on public.office_memos ((data->>'date'));

-- --------------------------------------------------------------------------
-- 3) Normalized tables already used directly by some admin modules
-- --------------------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null unique,
  first_name text not null,
  middle_name text,
  last_name text not null,
  name_extension text,
  gender text,
  dob date,
  pob text,
  civil_status text,
  blood_type text,
  designation text not null,
  department text not null,
  employment_type text,
  item_code text,
  date_employed date,
  salary_grade text,
  duty_status text not null default 'Active',
  mobile text,
  email text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employees_department_idx on public.employees (department);
create index if not exists employees_duty_status_idx on public.employees (duty_status);
create index if not exists employees_last_name_idx on public.employees (last_name);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  control_no text not null unique,
  item_name text not null,
  category text,
  unit text not null,
  quantity numeric(14,2) not null default 0 check (quantity >= 0),
  threshold numeric(14,2) not null default 0 check (threshold >= 0),
  description text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_category_idx on public.inventory (category);
create index if not exists inventory_item_name_idx on public.inventory (item_name);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory(id) on delete cascade,
  movement_type text not null check (movement_type in ('IN','OUT','ADJUSTMENT')),
  quantity numeric(14,2) not null check (quantity > 0),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  reference_no text,
  remarks text,
  recorded_by text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_item_idx on public.inventory_movements (item_id);
create index if not exists inventory_movements_created_idx on public.inventory_movements (created_at desc);

-- Atomic inventory transaction: locks the stock row, calculates the new
-- balance, updates inventory, and writes movement history in one transaction.
create or replace function public.record_inventory_movement(
  p_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reference_no text default null,
  p_remarks text default null,
  p_recorded_by text default null
)
returns public.inventory_movements
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_qty numeric;
  next_qty numeric;
  saved public.inventory_movements;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;

  if p_movement_type not in ('IN','OUT','ADJUSTMENT') then
    raise exception 'Invalid inventory movement type: %', p_movement_type;
  end if;

  select quantity into current_qty
  from public.inventory
  where id = p_item_id
  for update;

  if not found then
    raise exception 'Inventory item not found.';
  end if;

  if p_movement_type = 'IN' then
    next_qty := current_qty + p_quantity;
  elsif p_movement_type = 'OUT' then
    next_qty := current_qty - p_quantity;
  else
    next_qty := p_quantity;
  end if;

  if next_qty < 0 then
    raise exception 'Stock out quantity cannot exceed current inventory balance.';
  end if;

  update public.inventory
  set quantity = next_qty, updated_at = now()
  where id = p_item_id;

  insert into public.inventory_movements (
    item_id, movement_type, quantity, balance_after,
    reference_no, remarks, recorded_by
  ) values (
    p_item_id, p_movement_type, p_quantity, next_qty,
    nullif(p_reference_no, ''), nullif(p_remarks, ''), nullif(p_recorded_by, '')
  )
  returning * into saved;

  return saved;
end;
$$;

revoke all on function public.record_inventory_movement(uuid,text,numeric,text,text,text) from public;
grant execute on function public.record_inventory_movement(uuid,text,numeric,text,text,text)
to authenticated, service_role;


create table if not exists public.travel_orders (
  id uuid primary key default gen_random_uuid(),
  tor_no text not null unique,
  traveler_name text not null,
  traveler_position text,
  department text,
  travel_type text,
  status text not null default 'Pending',
  destination text not null,
  departure_date date not null,
  return_date date not null,
  transportation text,
  purpose text,
  per_diem text,
  fund_source text,
  approver text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint travel_order_dates_valid check (return_date >= departure_date)
);

create index if not exists travel_orders_status_idx on public.travel_orders (status);
create index if not exists travel_orders_departure_idx on public.travel_orders (departure_date desc);

-- --------------------------------------------------------------------------
-- 4) updated_at automation
-- --------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','users','admins','access_requests','service_requests','visitors',
    'admin_logs','audit_logs','office_memos','communications','ics_records',
    'employees','inventory','travel_orders'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', t, t);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 5) Row Level Security
--    Only authenticated users marked as an active admin in public.profiles
--    can use the admin-side tables.
-- --------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_update_admin_only" on public.profiles;

create policy "profiles_select_own_or_admin"
on public.profiles for select
to authenticated
using ((select auth.uid()) = user_id or public.is_pgenro_admin());

create policy "profiles_update_admin_only"
on public.profiles for update
to authenticated
using (public.is_pgenro_admin())
with check (public.is_pgenro_admin());

-- SQL Editor/service_role is used to bootstrap the first admin profile.
revoke all on table public.profiles from anon, authenticated;
grant select, update on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'users','admins','access_requests','service_requests','visitors','admin_logs',
    'audit_logs','office_memos','communications','ics_records',
    'employees','inventory','inventory_movements','travel_orders'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);

    execute format('drop policy if exists admin_select on public.%I', t);
    execute format('drop policy if exists admin_insert on public.%I', t);
    execute format('drop policy if exists admin_update on public.%I', t);
    execute format('drop policy if exists admin_delete on public.%I', t);

    execute format('create policy admin_select on public.%I for select to authenticated using (public.is_pgenro_admin())', t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check (public.is_pgenro_admin())', t);
    execute format('create policy admin_update on public.%I for update to authenticated using (public.is_pgenro_admin()) with check (public.is_pgenro_admin())', t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using (public.is_pgenro_admin())', t);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 6) Realtime publication for live admin updates
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'users','admins','access_requests','service_requests','visitors','admin_logs',
    'audit_logs','office_memos','communications','ics_records',
    'employees','inventory','inventory_movements','travel_orders'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 7) Bootstrap your FIRST admin after creating the user in Supabase Auth.
--    Replace the email before running this section separately.
-- --------------------------------------------------------------------------
-- insert into public.profiles (user_id, full_name, role, is_active)
-- select id, coalesce(raw_user_meta_data->>'full_name', email), 'Admin', true
-- from auth.users
-- where email = 'YOUR_ADMIN_EMAIL@example.com'
-- on conflict (user_id) do update
-- set role = excluded.role, is_active = true, updated_at = now();


-- ============================================================================
-- 8) PGENRO IMS - ADMIN-CONTROLLED AUTHORIZATION UPGRADE
-- Project ref: zssrxubajhqryrwijyzm
-- Region: ap-southeast-1
-- ============================================================================
-- This section makes Supabase Auth the source of truth for credentials.
-- Passwords are NEVER stored in public tables.
-- Admins control approval, role, activation, suspension, and deletion.
-- ============================================================================

alter table public.profiles
  add column if not exists email text,
  add column if not exists username text,
  add column if not exists contact text,
  add column if not exists position text,
  add column if not exists division text,
  add column if not exists account_type text not null default 'Standard User',
  add column if not exists status text not null default 'Pending',
  add column if not exists last_login timestamptz;

create unique index if not exists profiles_email_lower_unique
on public.profiles (lower(email))
where email is not null;

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_status_idx on public.profiles (status);
create index if not exists profiles_active_idx on public.profiles (is_active);

create or replace function public.is_pgenro_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_active = true
      and lower(p.status) in ('active','approved')
      and lower(regexp_replace(trim(p.role), '\s+', ' ', 'g')) = 'admin'
  );
$$;

create or replace function public.is_pgenro_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_active = true
      and lower(p.status) in ('active','approved')
  );
$$;

revoke all on function public.is_pgenro_admin() from public;
revoke all on function public.is_pgenro_active_user() from public;
grant execute on function public.is_pgenro_admin() to authenticated, service_role;
grant execute on function public.is_pgenro_active_user() to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Auth trigger:
-- Request Account -> Supabase Auth user + Pending PGENRO profile/request.
-- The frontend passes personnel details in auth user_metadata.
-- --------------------------------------------------------------------------
create or replace function public.handle_new_pgenro_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id text;
  meta jsonb;
begin
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  request_id := coalesce(
    nullif(meta->>'request_id', ''),
    'REQ-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(new.id::text, '-', ''), 1, 8))
  );

  insert into public.profiles (
    user_id,
    full_name,
    email,
    username,
    contact,
    position,
    division,
    role,
    account_type,
    status,
    is_active,
    created_at,
    updated_at
  )
  values (
    new.id,
    coalesce(nullif(meta->>'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    new.email,
    coalesce(nullif(meta->>'username', ''), split_part(coalesce(new.email, ''), '@', 1)),
    nullif(meta->>'contact', ''),
    nullif(meta->>'position', ''),
    nullif(meta->>'division', ''),
    'User',
    'Standard User',
    'Pending',
    false,
    now(),
    now()
  )
  on conflict (user_id) do update
  set
    email = excluded.email,
    full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
    contact = coalesce(excluded.contact, public.profiles.contact),
    position = coalesce(excluded.position, public.profiles.position),
    division = coalesce(excluded.division, public.profiles.division),
    updated_at = now();

  insert into public.access_requests (id, data, created_at, updated_at)
  values (
    request_id,
    jsonb_build_object(
      'id', request_id,
      'uid', new.id::text,
      'fullName', coalesce(nullif(meta->>'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
      'username', coalesce(nullif(meta->>'username', ''), split_part(coalesce(new.email, ''), '@', 1)),
      'email', new.email,
      'contact', coalesce(meta->>'contact', ''),
      'position', coalesce(meta->>'position', ''),
      'division', coalesce(meta->>'division', ''),
      'role', 'User',
      'requestedRole', coalesce(nullif(meta->>'requested_role', ''), 'User'),
      'endorser', coalesce(meta->>'endorser', ''),
      'reason', coalesce(meta->>'reason', ''),
      'status', 'Pending',
      'timestamp', floor(extract(epoch from now()) * 1000),
      'date', to_char(now(), 'Mon DD, YYYY HH12:MI AM')
    ),
    now(),
    now()
  )
  on conflict (id) do update
  set data = excluded.data, updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_pgenro on auth.users;
create trigger on_auth_user_created_pgenro
after insert on auth.users
for each row execute function public.handle_new_pgenro_auth_user();

-- --------------------------------------------------------------------------
-- Profiles: users can read their own state; admins can read/update everyone.
-- Only admins may change authorization fields through the browser.
-- --------------------------------------------------------------------------
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_update_admin_only" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "profiles_select_admin"
on public.profiles
for select
to authenticated
using ((select public.is_pgenro_admin()));

create policy "profiles_update_admin"
on public.profiles
for update
to authenticated
using ((select public.is_pgenro_admin()))
with check ((select public.is_pgenro_admin()));

-- --------------------------------------------------------------------------
-- Account-control tables are administrator-only.
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['users','admins','access_requests','admin_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);

    execute format('drop policy if exists admin_select on public.%I', t);
    execute format('drop policy if exists admin_insert on public.%I', t);
    execute format('drop policy if exists admin_update on public.%I', t);
    execute format('drop policy if exists admin_delete on public.%I', t);

    execute format('create policy admin_select on public.%I for select to authenticated using ((select public.is_pgenro_admin()))', t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select public.is_pgenro_admin()))', t);
    execute format('create policy admin_update on public.%I for update to authenticated using ((select public.is_pgenro_admin())) with check ((select public.is_pgenro_admin()))', t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using ((select public.is_pgenro_admin()))', t);
  end loop;
end $$;

-- Login/security audit records may be inserted by authenticated accounts.
-- Reading/modifying audit history remains administrator-only.
revoke all on table public.audit_logs from anon, authenticated;
grant insert on table public.audit_logs to authenticated;
grant select, update, delete on table public.audit_logs to authenticated;
grant all on table public.audit_logs to service_role;

drop policy if exists admin_select on public.audit_logs;
drop policy if exists admin_insert on public.audit_logs;
drop policy if exists admin_update on public.audit_logs;
drop policy if exists admin_delete on public.audit_logs;
drop policy if exists authenticated_audit_insert on public.audit_logs;

create policy authenticated_audit_insert
on public.audit_logs for insert
to authenticated
with check (true);

create policy admin_select
on public.audit_logs for select
to authenticated
using ((select public.is_pgenro_admin()));

create policy admin_update
on public.audit_logs for update
to authenticated
using ((select public.is_pgenro_admin()))
with check ((select public.is_pgenro_admin()));

create policy admin_delete
on public.audit_logs for delete
to authenticated
using ((select public.is_pgenro_admin()));

-- --------------------------------------------------------------------------
-- Operational tables:
-- Approved users can view records; admins retain all encoding, updates, and
-- deletion. Suspending a profile immediately blocks future Data API access.
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'service_requests','visitors','office_memos','communications','ics_records',
    'employees','inventory','inventory_movements','travel_orders'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);

    execute format('drop policy if exists admin_select on public.%I', t);
    execute format('drop policy if exists admin_insert on public.%I', t);
    execute format('drop policy if exists admin_update on public.%I', t);
    execute format('drop policy if exists admin_delete on public.%I', t);
    execute format('drop policy if exists active_user_select on public.%I', t);
    execute format('drop policy if exists active_user_insert on public.%I', t);
    execute format('drop policy if exists active_user_update on public.%I', t);

    execute format('create policy active_user_select on public.%I for select to authenticated using ((select public.is_pgenro_active_user()))', t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select public.is_pgenro_admin()))', t);
    execute format('create policy admin_update on public.%I for update to authenticated using ((select public.is_pgenro_admin())) with check ((select public.is_pgenro_admin()))', t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using ((select public.is_pgenro_admin()))', t);
  end loop;
end $$;

-- Public visitor kiosk can submit a new visitor record but cannot read/update
-- existing visitor data.
revoke all on table public.visitors from anon;
grant insert (full_name, contact, address, person_to_visit, purpose_category, other_purpose_specific)
on table public.visitors to anon;
drop policy if exists public_visitor_insert on public.visitors;
create policy public_visitor_insert
on public.visitors for insert
to anon
with check (status = 'inside' and time_out is null);

-- --------------------------------------------------------------------------
-- Optional cleanup: if old Firebase-era rows contain plaintext passwords,
-- remove that property from JSONB immediately.
-- --------------------------------------------------------------------------
update public.users
set data = data - 'password' - 'confirmPassword'
where data ? 'password' or data ? 'confirmPassword';

update public.access_requests
set data = data - 'password' - 'confirmPassword'
where data ? 'password' or data ? 'confirmPassword';

-- --------------------------------------------------------------------------
-- FIRST ADMIN BOOTSTRAP
-- 1) Create the first admin in Supabase Dashboard > Authentication > Users.
-- 2) Replace the email below and run ONLY this INSERT.
-- --------------------------------------------------------------------------
-- insert into public.profiles (
--   user_id, full_name, email, username, role, account_type, status, is_active
-- )
-- select
--   id,
--   coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1)),
--   email,
--   split_part(email, '@', 1),
--   'Admin',
--   'Administrator',
--   'Active',
--   true
-- from auth.users
-- where lower(email) = lower('YOUR_ADMIN_EMAIL@example.com')
-- on conflict (user_id) do update
-- set
--   role = 'Admin',
--   account_type = 'Administrator',
--   status = 'Active',
--   is_active = true,
--   updated_at = now();


-- Safe self-service last-login heartbeat. Users can update only their own
-- last_login through this function; authorization fields remain admin-only.
create or replace function public.touch_last_login()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set last_login = now(), updated_at = now()
  where user_id = (select auth.uid());
$$;

revoke all on function public.touch_last_login() from public;
grant execute on function public.touch_last_login() to authenticated;

-- Active users may read/update only their own legacy public.users row.
-- This row is for UI/profile compatibility only; roles/status used by RLS
-- always come from public.profiles, so editing this JSON cannot grant access.
drop policy if exists user_select_own_legacy on public.users;
drop policy if exists user_insert_own_legacy on public.users;
drop policy if exists user_update_own_legacy on public.users;

create policy user_select_own_legacy
on public.users for select
to authenticated
using (
  id = (select auth.uid())::text
  and (select public.is_pgenro_active_user())
);

create policy user_insert_own_legacy
on public.users for insert
to authenticated
with check (
  id = (select auth.uid())::text
  and (select public.is_pgenro_active_user())
);

create policy user_update_own_legacy
on public.users for update
to authenticated
using (
  id = (select auth.uid())::text
  and (select public.is_pgenro_active_user())
)
with check (
  id = (select auth.uid())::text
  and (select public.is_pgenro_active_user())
);

-- ============================================================================
-- 9) SAFE FIRST-ADMIN PROMOTION HELPER
-- Run AFTER you manually create your first account in Authentication > Users.
-- Example:
--   select public.promote_pgenro_first_admin('admin@pgenro.gov.ph');
-- This function is NOT exposed to anon/authenticated browser clients.
-- ============================================================================
create or replace function public.promote_pgenro_first_admin(admin_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_uid uuid;
  admin_name text;
begin
  select id,
         coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
    into admin_uid, admin_name
  from auth.users
  where lower(email) = lower(admin_email)
  limit 1;

  if admin_uid is null then
    raise exception 'No Supabase Auth user exists for email %', admin_email;
  end if;

  insert into public.profiles (
    user_id, full_name, email, username, role, account_type,
    status, is_active, created_at, updated_at
  )
  values (
    admin_uid,
    admin_name,
    lower(admin_email),
    split_part(lower(admin_email), '@', 1),
    'Admin',
    'Administrator',
    'Active',
    true,
    now(),
    now()
  )
  on conflict (user_id) do update
  set
    full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
    email = excluded.email,
    username = coalesce(nullif(public.profiles.username, ''), excluded.username),
    role = 'Admin',
    account_type = 'Administrator',
    status = 'Active',
    is_active = true,
    updated_at = now();

  insert into public.users (id, data, created_at, updated_at)
  values (
    admin_uid::text,
    jsonb_build_object(
      'fullName', admin_name,
      'username', split_part(lower(admin_email), '@', 1),
      'email', lower(admin_email),
      'role', 'Admin',
      'accountType', 'Administrator',
      'status', 'Active',
      'updatedAt', now()::text
    ),
    now(),
    now()
  )
  on conflict (id) do update
  set data = excluded.data, updated_at = now();

  insert into public.admins (id, data, created_at, updated_at)
  values (
    admin_uid::text,
    jsonb_build_object(
      'fullName', admin_name,
      'email', lower(admin_email),
      'role', 'Admin',
      'status', 'Active',
      'assignedBy', 'Bootstrap',
      'updatedAt', now()::text
    ),
    now(),
    now()
  )
  on conflict (id) do update
  set data = excluded.data, updated_at = now();

  update public.access_requests
  set
    data = (data - 'password' - 'confirmPassword') || jsonb_build_object(
      'role', 'Admin',
      'accountType', 'Administrator',
      'status', 'Approved',
      'approvedBy', 'Bootstrap',
      'approvedAt', now()::text
    ),
    updated_at = now()
  where data->>'uid' = admin_uid::text;

  return 'Admin enabled: ' || lower(admin_email);
end;
$$;

revoke all on function public.promote_pgenro_first_admin(text) from public;
revoke all on function public.promote_pgenro_first_admin(text) from anon;
revoke all on function public.promote_pgenro_first_admin(text) from authenticated;
grant execute on function public.promote_pgenro_first_admin(text) to service_role;

-- ============================================================================
-- END OF PGENRO IMS SUPABASE SETUP
-- ============================================================================


-- --------------------------------------------------------------------------
-- Browser-safe connectivity probe used by SUPABASE_CONNECTION_TEST.html.
-- It exposes no records and works for signed-out and signed-in clients.
-- --------------------------------------------------------------------------
create or replace function public.pgenro_healthcheck()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'project', 'PGENRO IMS',
    'server_time', now()
  );
$$;

revoke all on function public.pgenro_healthcheck() from public;
grant execute on function public.pgenro_healthcheck() to anon, authenticated, service_role;

-- ============================================================================
-- PGENRO IMS — SAFE ACCOUNT & SYSTEM SETTINGS PATCH
-- Idempotent: safe to run more than once after PGENRO_FULL_SETUP.sql.
-- Does not replace or drop operational tables.
-- ============================================================================

alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- Users may update only their own editable profile fields through this RPC.
create or replace function public.update_my_profile(
  p_full_name text,
  p_username text,
  p_contact text,
  p_position text,
  p_division text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.profiles;
begin
  if auth.uid() is null or not public.is_pgenro_active_user() then
    raise exception 'Active PGENRO authentication is required.';
  end if;

  update public.profiles
  set
    full_name = nullif(trim(coalesce(p_full_name, '')), ''),
    username = nullif(trim(coalesce(p_username, '')), ''),
    contact = nullif(trim(coalesce(p_contact, '')), ''),
    position = nullif(trim(coalesce(p_position, '')), ''),
    division = nullif(trim(coalesce(p_division, '')), ''),
    updated_at = now()
  where user_id = auth.uid()
  returning * into saved;

  if saved.user_id is null then
    raise exception 'Profile not found.';
  end if;
  return saved;
end;
$$;

revoke all on function public.update_my_profile(text,text,text,text,text) from public;
grant execute on function public.update_my_profile(text,text,text,text,text) to authenticated;

create or replace function public.update_my_preferences(p_preferences jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved jsonb;
begin
  if auth.uid() is null or not public.is_pgenro_active_user() then
    raise exception 'Active PGENRO authentication is required.';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
    raise exception 'Preferences must be a JSON object.';
  end if;

  update public.profiles
  set preferences = coalesce(preferences, '{}'::jsonb) || p_preferences,
      updated_at = now()
  where user_id = auth.uid()
  returning preferences into saved;

  if saved is null then
    raise exception 'Profile not found.';
  end if;
  return saved;
end;
$$;

revoke all on function public.update_my_preferences(jsonb) from public;
grant execute on function public.update_my_preferences(jsonb) to authenticated;

create table if not exists public.system_settings (
  id smallint primary key default 1 check (id = 1),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.system_settings (id, settings)
values (1, jsonb_build_object(
  'organization_name', 'Provincial Government of Quezon',
  'office_name', 'PGENRO Information Management System',
  'session_timeout_minutes', 30,
  'default_page_size', 25,
  'account_requests_enabled', true,
  'maintenance_mode', false,
  'announcement_enabled', false,
  'announcement', ''
))
on conflict (id) do nothing;

alter table public.system_settings enable row level security;
revoke all on table public.system_settings from anon, authenticated;
grant select on table public.system_settings to anon, authenticated;
grant update on table public.system_settings to authenticated;
grant all on table public.system_settings to service_role;

drop policy if exists system_settings_public_read on public.system_settings;
drop policy if exists system_settings_admin_update on public.system_settings;

create policy system_settings_public_read
on public.system_settings for select
to anon, authenticated
using (true);

create policy system_settings_admin_update
on public.system_settings for update
to authenticated
using ((select public.is_pgenro_admin()))
with check ((select public.is_pgenro_admin()));

create or replace function public.update_pgenro_system_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved jsonb;
begin
  if not public.is_pgenro_admin() then
    raise exception 'Administrator permission is required.';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Settings patch must be a JSON object.';
  end if;

  update public.system_settings
  set settings = coalesce(settings, '{}'::jsonb) || p_patch,
      updated_at = now(),
      updated_by = auth.uid()
  where id = 1
  returning settings into saved;

  return saved;
end;
$$;

revoke all on function public.update_pgenro_system_settings(jsonb) from public;
grant execute on function public.update_pgenro_system_settings(jsonb) to authenticated;

-- Realtime is optional. Ignore duplicate-publication errors safely.
do $$
begin
  begin
    alter publication supabase_realtime add table public.system_settings;
  exception when duplicate_object then
    null;
  end;
end $$;


-- Admin/User account integration update, 10 October 2026.
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
