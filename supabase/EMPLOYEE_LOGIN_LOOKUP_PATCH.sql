begin;

-- The employee number is text. Match current profiles and legacy linked
-- profiles against their real Auth addresses without creating accounts.
create or replace function public.pgenro_employee_login_email(p_employee_number text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  number text := lower(btrim(p_employee_number));
  login_address text := public.pgenro_employee_login_address(number);
  matches integer;
  target_email text;
begin
  select count(*), min(u.email) into matches, target_email
  from public.profiles p
  join auth.users u on u.id = p.user_id
  left join public.employees e on e.id::text = p.employee_record_id
  where u.email is not null
    and (
      lower(coalesce(
        nullif(btrim(p.employee_number), ''),
        nullif(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'), ''),
        nullif(btrim(p.username), '')
      )) = number
      or (lower(btrim(u.email)) = login_address and lower(btrim(p.username)) = number)
    );

  if matches <> 1 then return null; end if;
  return target_email;
end
$$;

revoke all on function public.pgenro_employee_login_email(text) from public, anon, authenticated;
grant execute on function public.pgenro_employee_login_email(text) to service_role;

notify pgrst, 'reload schema';
commit;
