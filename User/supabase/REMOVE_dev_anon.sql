-- PGENRO IMS - remove any old development-wide anonymous access.
-- Safe for the Supabase admin-control architecture.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','admins','access_requests','service_requests','visitors','admin_logs',
    'audit_logs','office_memos','communications','ics_records',
    'employees','inventory','inventory_movements','travel_orders'
  ]
  LOOP
    EXECUTE format('drop policy if exists dev_anon_all on public.%I', t);
    EXECUTE format('revoke all on table public.%I from anon', t);
  END LOOP;
END $$;

-- Keep only the intended public visitor-kiosk insert permission.
grant insert on table public.visitors to anon;
drop policy if exists public_visitor_insert on public.visitors;
create policy public_visitor_insert
on public.visitors for insert
to anon
with check (true);
