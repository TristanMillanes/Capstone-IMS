-- OPTIONAL: only if there is no active Admin account yet.
-- 1. Run ADMIN_USER_ACCESS_PATCH.sql (existing project) or COMPLETE_SETUP.sql (new).
-- 2. Create your account in Supabase Dashboard > Authentication > Users.
-- 3. Replace YOUR_ADMIN_EMAIL@example.com below with that exact email, then run.
-- Existing Admin accounts are retained automatically and do not need this file.
do $$
declare target_email text := 'YOUR_ADMIN_EMAIL@example.com';
begin
  if target_email = 'YOUR_ADMIN_EMAIL@example.com' then
    raise exception 'Edit target_email to the email already in Authentication > Users.';
  end if;
  raise notice '%',public.promote_pgenro_first_admin(target_email);
end $$;
