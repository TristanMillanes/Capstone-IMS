begin;

-- The signature is stored outside the registry so it stays out of list queries,
-- browser caches and exports. Match the existing visitor ID type.
do $$
declare
  visitor_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into visitor_id_type
  from pg_attribute a
  where a.attrelid = to_regclass('public.visitors')
    and a.attname = 'id'
    and not a.attisdropped;
  if visitor_id_type is null then
    raise exception 'The Visitors Log database table is missing.';
  end if;
  execute format(
    'create table if not exists public.pgenro_visitor_signatures (
      visitor_id %s primary key references public.visitors(id) on delete cascade,
      submission_id text not null unique,
      signature_png text not null
    )', visitor_id_type
  );
end
$$;

alter table public.pgenro_visitor_signatures enable row level security;
revoke all on table public.pgenro_visitor_signatures from public, anon, authenticated;
grant select (visitor_id, signature_png) on public.pgenro_visitor_signatures to authenticated;

-- The existing visitor registry policies determine which visits this Admin can see.
alter table public.visitors enable row level security;
revoke select on public.visitors from public, anon;
drop policy if exists pgenro_visitor_registry_admin_only on public.visitors;
create policy pgenro_visitor_registry_admin_only on public.visitors
as restrictive for select to authenticated
using ((select public.is_pgenro_admin()));

drop policy if exists pgenro_visitor_signature_read on public.pgenro_visitor_signatures;
create policy pgenro_visitor_signature_read on public.pgenro_visitor_signatures
for select to authenticated
using (
  (select public.is_pgenro_admin())
  and exists (select 1 from public.visitors v where v.id = visitor_id)
);

-- The public tablet can submit a new signed visit without reading the registry.
-- Both rows commit together. Retrying the same submission does not add a second visit.
create or replace function public.pgenro_register_signed_visit(
  p_visit jsonb,
  p_signature text,
  p_submission_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  visit_id public.visitors.id%type;
  visitor_name text := coalesce(btrim(p_visit->>'full_name'), '');
  phone text := coalesce(btrim(p_visit->>'contact'), '');
  origin text := coalesce(btrim(p_visit->>'address'), '');
  host text := coalesce(btrim(p_visit->>'person_to_visit'), '');
  purpose text := coalesce(btrim(p_visit->>'purpose_category'), '');
  details text := coalesce(btrim(p_visit->>'other_purpose_specific'), '');
  png bytea;
begin
  if p_submission_id is null or p_submission_id collate "C" !~ '^[0-9a-f]{32}$'
    or char_length(visitor_name) not between 2 and 100
    or phone !~ '^09[0-9]{9}$'
    or char_length(origin) not between 3 and 160
    or char_length(host) not between 2 and 100
    or char_length(purpose) not between 1 and 160
    or char_length(details) > 180 then
    raise exception using errcode = '22023', message = 'Invalid visitor registration details.';
  end if;
  if p_signature is null or char_length(p_signature) > 131072
    or p_signature collate "C" !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$' then
    raise exception using errcode = '22023', message = 'Invalid visitor signature.';
  end if;

  png := decode(substr(p_signature, 23), 'base64');
  -- Check the PNG header, the signing canvas dimensions (600 x 270) and IEND.
  if substr(png, 1, 24) <> decode('89504e470d0a1a0a0000000d49484452000002580000010e', 'hex')
    or substr(png, octet_length(png) - 11) <> decode('0000000049454e44ae426082', 'hex') then
    raise exception using errcode = '22023', message = 'Invalid visitor signature image.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_submission_id, 0));
  if exists (select 1 from public.pgenro_visitor_signatures s where s.submission_id = p_submission_id) then
    return;
  end if;

  insert into public.visitors (
    full_name, contact, address, person_to_visit, purpose_category, other_purpose_specific, visit_date
  ) values (
    visitor_name, phone, origin, host, purpose, details, (now() at time zone 'Asia/Manila')::date
  ) returning id into visit_id;

  insert into public.pgenro_visitor_signatures (visitor_id, submission_id, signature_png)
  values (visit_id, p_submission_id, p_signature);
end
$$;

revoke all on function public.pgenro_register_signed_visit(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.pgenro_register_signed_visit(jsonb, text, text) to anon;

create or replace function public.pgenro_get_visitor_signature(p_visitor_id text)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  visit_id public.visitors.id%type;
begin
  if not coalesce(public.is_pgenro_admin(), false) then
    raise exception using errcode = '42501', message = 'Visitors Log access is required.';
  end if;
  begin
    visit_id := p_visitor_id;
  exception when invalid_text_representation then
    return null;
  end;
  return (select s.signature_png from public.pgenro_visitor_signatures s where s.visitor_id = visit_id);
end
$$;

revoke all on function public.pgenro_get_visitor_signature(text) from public, anon, authenticated;
grant execute on function public.pgenro_get_visitor_signature(text) to authenticated;

notify pgrst, 'reload schema';
commit;
