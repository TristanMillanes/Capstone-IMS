-- PGENRO IMS: requested registration role and final approval role.
-- Run this ENTIRE file in Supabase SQL Editor AFTER ADMIN_USER_ACCESS_PATCH.sql.
-- Keeps existing accounts and permissions; pending accounts remain inactive.
begin;

-- A requested role describes the application, not authorization. Profiles always
-- start as inactive Pending Users; an active Admin assigns the final role.
create or replace function public.handle_new_pgenro_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare meta jsonb := coalesce(new.raw_user_meta_data,'{}'::jsonb); request_id text; requested_role text;
begin
  requested_role := case lower(trim(coalesce(nullif(meta->>'requested_role',''),
    nullif(meta->>'requested_system',''),'User'))) when 'admin' then 'Admin' else 'User' end;
  request_id := 'REQ-' || to_char(now(),'YYYY') || '-' || new.id::text;
  insert into public.profiles(user_id,full_name,email,username,contact,position,division,role,account_type,status,is_active)
  values (new.id,coalesce(nullif(meta->>'full_name',''),split_part(new.email,'@',1)),new.email,
    coalesce(nullif(meta->>'username',''),split_part(new.email,'@',1)),nullif(meta->>'contact',''),
    nullif(meta->>'position',''),nullif(meta->>'division',''),'User','Standard User','Pending',false)
  on conflict(user_id) do nothing;
  if to_regclass('public.access_requests') is not null then
    insert into public.access_requests(id,data) values (request_id,jsonb_build_object(
      'id',request_id,'refCode',coalesce(nullif(meta->>'request_id',''),request_id),'uid',new.id::text,
      'fullName',coalesce(nullif(meta->>'full_name',''),split_part(new.email,'@',1)),
      'username',coalesce(nullif(meta->>'username',''),split_part(new.email,'@',1)),
      'email',new.email,'contact',coalesce(meta->>'contact',''),'position',coalesce(meta->>'position',''),
      'division',coalesce(meta->>'division',''),'role',requested_role,'requestedRole',requested_role,'assignedRole',null,
      'endorser',coalesce(meta->>'endorser',''),'reason',coalesce(meta->>'reason',''),'status','Pending',
      'timestamp',floor(extract(epoch from now())*1000),'date',to_char(now(),'Mon DD, YYYY HH12:MI AM')))
    on conflict(id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created_pgenro on auth.users;
create trigger on_auth_user_created_pgenro after insert on auth.users
for each row execute function public.handle_new_pgenro_auth_user();
revoke all on function public.handle_new_pgenro_auth_user() from public, anon, authenticated;

-- Recover the role chosen on the earlier registration form for unreviewed
-- requests only. The previous form sent it as requested_system. This changes
-- application details, never the Pending profile or its permissions.
do $$
begin
  if to_regclass('public.access_requests') is not null then
    update public.access_requests r
    set data=r.data || jsonb_build_object('requestedRole',case lower(trim(coalesce(
      nullif(u.raw_user_meta_data->>'requested_system',''),nullif(u.raw_user_meta_data->>'requested_role',''),
      nullif(r.data->>'requestedRole',''),nullif(r.data->>'role',''),'User')))
      when 'admin' then 'Admin' else 'User' end,'assignedRole',null,
      'role',case lower(trim(coalesce(nullif(u.raw_user_meta_data->>'requested_system',''),
      nullif(u.raw_user_meta_data->>'requested_role',''),nullif(r.data->>'requestedRole',''),
      nullif(r.data->>'role',''),'User'))) when 'admin' then 'Admin' else 'User' end)
    from auth.users u
    where r.data->>'uid'=u.id::text and lower(r.data->>'status')='pending'
      and not(r.data ? 'assignedRole');
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
