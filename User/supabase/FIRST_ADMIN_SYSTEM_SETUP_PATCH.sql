-- PGENRO IMS: secure, system-side First Admin bootstrap.
-- Run once AFTER EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql has completed successfully.
-- This RPC is callable only by service_role from bootstrap-first-admin Edge Function.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.promote_pgenro_first_admin_by_employee_number(text)') IS NULL THEN
    RAISE EXCEPTION 'The Employee Number migration is missing. Run EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql first.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pgenro_bootstrap_first_admin(p_employee_number text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Serialize all first-admin attempts. The promotion function rechecks that
  -- no active Admin exists after this lock has been acquired.
  PERFORM pg_advisory_xact_lock(20261105, 1);
  RETURN public.promote_pgenro_first_admin_by_employee_number(p_employee_number);
END;
$$;

REVOKE ALL ON FUNCTION public.pgenro_bootstrap_first_admin(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pgenro_bootstrap_first_admin(text) TO service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
