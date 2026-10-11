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
