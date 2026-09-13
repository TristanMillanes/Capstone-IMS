-- ============================================================================
-- PGENRO IMS - CONNECT EVERYTHING PATCH
-- Safe to run AFTER the main schema has already been created.
-- Project ref: zssrxubajhqryrwijyzm
-- ============================================================================

-- Preserve the user-side inventory screen's Total / Used / Balance model while
-- keeping inventory.quantity as the current available balance used by admin.
alter table public.inventory
  add column if not exists initial_quantity numeric(14,2),
  add column if not exists used_quantity numeric(14,2) not null default 0;

update public.inventory
set initial_quantity = coalesce(initial_quantity, quantity + used_quantity)
where initial_quantity is null;

alter table public.inventory
  drop constraint if exists inventory_initial_quantity_nonnegative,
  drop constraint if exists inventory_used_quantity_nonnegative;

alter table public.inventory
  add constraint inventory_initial_quantity_nonnegative check (initial_quantity is null or initial_quantity >= 0),
  add constraint inventory_used_quantity_nonnegative check (used_quantity >= 0);

-- Profiles are watched by the User Management admin page, so include profiles
-- in the Supabase Realtime publication as well.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- Safe first-admin helper. Create the account first in Authentication > Users,
-- then run: select public.promote_pgenro_first_admin('your@email.com');
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

-- Keep Realtime publication complete for operational modules. This is safe to
-- run repeatedly because every table is checked before being added.
do $$
declare t text;
begin
  foreach t in array array[
    'users','admins','access_requests','service_requests','visitors','admin_logs',
    'audit_logs','office_memos','communications','ics_records','employees',
    'inventory','inventory_movements','travel_orders'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Remove any Firebase-era plaintext credential properties if legacy rows exist.
update public.users
set data = data - 'password' - 'confirmPassword'
where data ? 'password' or data ? 'confirmPassword';

update public.access_requests
set data = data - 'password' - 'confirmPassword'
where data ? 'password' or data ? 'confirmPassword';

-- End patch.
