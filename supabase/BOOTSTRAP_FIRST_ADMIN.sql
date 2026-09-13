-- ============================================================================
-- PGENRO IMS - BOOTSTRAP THE FIRST SYSTEM ADMINISTRATOR
-- ============================================================================
-- 1) Run supabase/schema.sql first.
-- 2) In Supabase Dashboard > Authentication > Users, create the first user.
-- 3) Replace the email below and run this script once.
--
-- After the first administrator exists, create/manage all other accounts from
-- the PGENRO Admin > User Management screen.
-- ============================================================================

do $$
declare
  admin_email text := 'REPLACE_WITH_FIRST_ADMIN_EMAIL@example.com';
  admin_uid uuid;
  admin_name text;
begin
  if admin_email like 'REPLACE_WITH_%' then
    raise exception 'Replace admin_email in BOOTSTRAP_FIRST_ADMIN.sql before running it.';
  end if;

  select id, coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
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

  raise notice 'First System Administrator enabled: % (%)', admin_email, admin_uid;
end $$;
