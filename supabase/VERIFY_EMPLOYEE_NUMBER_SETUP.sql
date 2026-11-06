-- PGENRO IMS: read-only verification of Employee Number + First Admin setup.
-- Run this before deciding which migration is still missing. This file changes nothing.

-- 1) Required profile columns and indexes.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles'
  AND column_name IN ('employee_number','employee_record_id')
ORDER BY column_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public'
  AND indexname IN ('profiles_employee_number_unique','profiles_one_account_per_employee');

-- 2) Required functions and their actual return types.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'pgenro_employee_registration_check',
    'pgenro_employee_login_lookup',
    'pgenro_registration_employee',
    'promote_pgenro_first_admin_by_employee_number',
    'pgenro_bootstrap_first_admin'
  )
ORDER BY p.proname;

-- 3) Required function permissions for service_role.
SELECT
  CASE WHEN to_regprocedure('public.pgenro_registration_employee(text,text,boolean,uuid)') IS NOT NULL
    THEN has_function_privilege('service_role',to_regprocedure('public.pgenro_registration_employee(text,text,boolean,uuid)'),'EXECUTE') ELSE false END AS service_can_verify_employee,
  CASE WHEN to_regprocedure('public.pgenro_employee_login_lookup(text)') IS NOT NULL
    THEN has_function_privilege('service_role',to_regprocedure('public.pgenro_employee_login_lookup(text)'),'EXECUTE') ELSE false END AS service_can_resolve_login,
  CASE WHEN to_regprocedure('public.promote_pgenro_first_admin_by_employee_number(text)') IS NOT NULL
    THEN has_function_privilege('service_role',to_regprocedure('public.promote_pgenro_first_admin_by_employee_number(text)'),'EXECUTE') ELSE false END AS service_can_promote_first_admin,
  CASE WHEN to_regprocedure('public.pgenro_bootstrap_first_admin(text)') IS NOT NULL
    THEN has_function_privilege('service_role',to_regprocedure('public.pgenro_bootstrap_first_admin(text)'),'EXECUTE') ELSE false END AS service_can_bootstrap_first_admin;

-- 4) Required Auth/profile triggers.
SELECT t.tgname AS trigger_name, t.tgrelid::regclass AS table_name, t.tgenabled
FROM pg_trigger t
WHERE NOT t.tgisinternal
  AND t.tgname IN (
    'a_pgenro_employee_registration',
    'on_auth_user_created_pgenro',
    'pgenro_bind_employee_profile'
  )
ORDER BY t.tgname;

-- 5) Employee directory count and profile summary (no email or personal details).
SELECT count(*) AS employee_directory_records
FROM public.employees
WHERE nullif(btrim(to_jsonb(employees)->>'employee_id'),'') IS NOT NULL;

SELECT
  count(*) FILTER (WHERE role='Admin' AND status='Active' AND is_active=true) AS active_admin_count,
  count(*) FILTER (WHERE nullif(btrim(employee_number),'') IS NULL) AS profiles_without_employee_number,
  count(*) FILTER (WHERE nullif(btrim(employee_number),'') IS NOT NULL) AS profiles_with_employee_number
FROM public.profiles;
