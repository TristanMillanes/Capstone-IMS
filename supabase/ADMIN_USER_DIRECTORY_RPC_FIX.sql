-- PGENRO IMS: repair "structure of query does not match function result type".
-- Run this whole file in Supabase SQL Editor after the Admin/User migration.
-- Existing varchar and timestamp columns are cast to the declared RPC output.
-- No email edits, role promotion or data deletion is performed.
begin;
drop function if exists public.pgenro_admin_list_users(integer,integer);
create function public.pgenro_admin_list_users(p_offset integer default 0, p_limit integer default 500)
returns table (
  user_id uuid, full_name text, username text, email text, division text,
  role text, status text, is_active boolean, "position" text, contact text,
  last_login timestamptz, created_at timestamptz, updated_at timestamptz, account_type text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_pgenro_admin() then
    raise exception using errcode='42501', message='Active Admin access is required for User Management.';
  end if;
  return query
    select p.user_id::uuid, p.full_name::text, p.username::text,
      coalesce(u.email::text,p.email::text), p.division::text,
      p.role::text, (case when p.status='Active' and u.banned_until > now() then 'Suspended' else p.status end)::text,
      (p.is_active and (u.banned_until is null or u.banned_until <= now()))::boolean,
      p.position::text, p.contact::text,
      coalesce(u.last_sign_in_at::timestamptz,p.last_login::timestamptz),
      p.created_at::timestamptz, p.updated_at::timestamptz, p.account_type::text
    from public.profiles p join auth.users u on u.id=p.user_id
    order by p.created_at desc, p.user_id
    offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,500),1),500);
end $$;
revoke all on function public.pgenro_admin_list_users(integer,integer) from public,anon;
grant execute on function public.pgenro_admin_list_users(integer,integer) to authenticated,service_role;
notify pgrst, 'reload schema';
commit;
