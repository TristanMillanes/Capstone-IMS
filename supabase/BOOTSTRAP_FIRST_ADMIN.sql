-- OPTIONAL: only if there is no active Admin account yet.
-- 1. Run ADMIN_USER_ACCESS_PATCH.sql (existing project) or COMPLETE_SETUP.sql (new).
-- 2. Run EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql and EMPLOYEE_ID_LOGIN_PATCH.sql.
-- 3. Run SETUP_FIRST_ADMIN.py to create Admin001 with your chosen password.
-- This SQL also recovers promotion if the script created the Auth user but
-- could not confirm the last step. It does not create/reset passwords.
-- Existing Admin accounts are retained automatically and do not need this file.
do $$
declare target_email text := 'admin001@pgenro.ims';
begin
  raise notice '%',public.promote_pgenro_first_admin(target_email);
end $$;
