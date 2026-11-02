-- PGENRO IMS — USER READ-ONLY ENFORCEMENT PATCH
-- Run once in Supabase SQL Editor on an existing deployment.
-- Active authenticated users can SELECT operational records.
-- Only PGENRO administrator roles can INSERT, UPDATE, or DELETE.

do $$
declare t text;
begin
  foreach t in array array[
    'service_requests','visitors','office_memos','communications','ics_records',
    'employees','inventory','inventory_movements','travel_orders'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists active_user_select on public.%I', t);
    execute format('drop policy if exists active_user_insert on public.%I', t);
    execute format('drop policy if exists active_user_update on public.%I', t);
    execute format('drop policy if exists admin_insert on public.%I', t);
    execute format('drop policy if exists admin_update on public.%I', t);
    execute format('drop policy if exists admin_delete on public.%I', t);

    execute format('create policy active_user_select on public.%I for select to authenticated using ((select public.is_pgenro_active_user()))', t);
    execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select public.is_pgenro_admin()))', t);
    execute format('create policy admin_update on public.%I for update to authenticated using ((select public.is_pgenro_admin())) with check ((select public.is_pgenro_admin()))', t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using ((select public.is_pgenro_admin()))', t);
  end loop;
end $$;

-- Keep the public visitor kiosk's insert policy intact. It is a separate,
-- purpose-limited visitor check-in flow and does not grant logged-in users
-- general encoding rights.
