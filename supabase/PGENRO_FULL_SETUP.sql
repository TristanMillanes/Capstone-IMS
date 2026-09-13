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
  role text not null default 'Staff',
  is_active boolean not null default true,
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
      and lower(p.role) in ('admin','administrator','super admin','superadmin','system administrator')
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
-- select id, coalesce(raw_user_meta_data->>'full_name', email), 'Super Admin', true
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
      and lower(regexp_replace(trim(p.role), '\s+', ' ', 'g')) in (
        'admin',
        'administrator',
        'super admin',
        'superadmin',
        'system administrator'
      )
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
    'System Staff',
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
      'role', 'System Staff',
      'requestedRole', coalesce(nullif(meta->>'requested_role', ''), 'System Staff'),
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
-- Active users can work with records; admins retain full control including
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
    execute format('create policy active_user_insert on public.%I for insert to authenticated with check ((select public.is_pgenro_active_user()))', t);
    execute format('create policy active_user_update on public.%I for update to authenticated using ((select public.is_pgenro_active_user())) with check ((select public.is_pgenro_active_user()))', t);
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
--   'Super Admin',
--   'Administrator',
--   'Active',
--   true
-- from auth.users
-- where lower(email) = lower('YOUR_ADMIN_EMAIL@example.com')
-- on conflict (user_id) do update
-- set
--   role = 'Super Admin',
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
    'System Administrator',
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
    role = 'System Administrator',
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
      'role', 'System Administrator',
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
      'role', 'System Administrator',
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
      'role', 'System Administrator',
      'accountType', 'Administrator',
      'status', 'Approved',
      'approvedBy', 'Bootstrap',
      'approvedAt', now()::text
    ),
    updated_at = now()
  where data->>'uid' = admin_uid::text;

  return 'System Administrator enabled: ' || lower(admin_email);
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
