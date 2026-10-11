create or replace function public.pgenro_admin_list_users(p_offset integer default 0, p_limit integer default 500)
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
    select p.user_id, p.full_name, p.username, coalesce(u.email,p.email), p.division,
      p.role, case when p.status='Active' and u.banned_until > now() then 'Suspended' else p.status end,
      p.is_active and (u.banned_until is null or u.banned_until <= now()), p.position, p.contact,
      coalesce(u.last_sign_in_at,p.last_login), p.created_at, p.updated_at, p.account_type
    from public.profiles p join auth.users u on u.id=p.user_id
    order by p.created_at desc, p.user_id
    offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,500),1),500);
end $$;
