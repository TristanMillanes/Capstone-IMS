-- PGENRO IMS: notifications for newly inserted module records.
-- Run this ENTIRE file in Supabase SQL Editor AFTER ADMIN_USER_ACCESS_PATCH.sql.
-- Existing records are not backfilled as new notifications.
begin;

create table if not exists public.pgenro_module_notifications (
  id uuid primary key default gen_random_uuid(),
  module_key text not null check (module_key in ('communications','travel_orders','office_memos',
    'employees','inventory','visitors','service_requests','ics_records','user_accounts','account_requests')),
  record_id text not null,
  title text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists pgenro_notifications_module_date on public.pgenro_module_notifications(module_key,created_at desc);
create index if not exists pgenro_notifications_date on public.pgenro_module_notifications(created_at desc,id);
create table if not exists public.pgenro_notification_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_id uuid not null references public.pgenro_module_notifications(id) on delete cascade,
  read_at timestamptz not null default clock_timestamp(),
  primary key(user_id,notification_id)
);

alter table public.pgenro_module_notifications enable row level security;
alter table public.pgenro_notification_reads enable row level security;
revoke all on public.pgenro_module_notifications,public.pgenro_notification_reads from public,anon,authenticated;
grant select on public.pgenro_module_notifications to authenticated;
grant select,insert on public.pgenro_notification_reads to authenticated;
grant all on public.pgenro_module_notifications,public.pgenro_notification_reads to service_role;
drop policy if exists pgenro_notifications_visible on public.pgenro_module_notifications;
create policy pgenro_notifications_visible on public.pgenro_module_notifications for select to authenticated
using ((select public.is_pgenro_active_user()) and
  (module_key not in ('user_accounts','account_requests') or (select public.is_pgenro_admin())));
drop policy if exists pgenro_notification_reads_own on public.pgenro_notification_reads;
create policy pgenro_notification_reads_own on public.pgenro_notification_reads for select to authenticated
using (user_id=(select auth.uid()) and (select public.is_pgenro_active_user()));
drop policy if exists pgenro_notification_reads_insert on public.pgenro_notification_reads;
create policy pgenro_notification_reads_insert on public.pgenro_notification_reads for insert to authenticated
with check (user_id=(select auth.uid()) and (select public.is_pgenro_active_user()) and exists
  (select 1 from public.pgenro_module_notifications n where n.id=notification_id));

create or replace function public.pgenro_notify_module_insert()
returns trigger language plpgsql security definer set search_path='' as $$
declare payload jsonb:=to_jsonb(new); details jsonb; record_key text; record_title text;
begin
  details:=payload || case when jsonb_typeof(payload->'data')='object' then payload->'data' else '{}'::jsonb end;
  record_key:=coalesce(payload->>'user_id',payload->>'id');
  if record_key is null then return new; end if;
  record_title:=coalesce(nullif(details->>'subject',''),nullif(details->>'item_name',''),
    nullif(details->>'fullName',''),nullif(details->>'full_name',''),nullif(details->>'employeeName',''),nullif(details->>'traveler_name',''),
    nullif(trim(concat_ws(' ',details->>'first_name',details->>'last_name')),''),
    nullif(details->>'requesterName',''),nullif(details->>'accountablePerson',''),
    nullif(details->>'controlNo',''),nullif(details->>'control_no',''),record_key);
  insert into public.pgenro_module_notifications(module_key,record_id,title)
  values(tg_argv[0],record_key,left(record_title,180));
  return new;
end $$;
revoke all on function public.pgenro_notify_module_insert() from public,anon,authenticated;

do $$
declare mapping record;
begin
  for mapping in select * from (values
    ('communications','communications'),('travel_orders','travel_orders'),('office_memos','office_memos'),
    ('employees','employees'),('inventory','inventory'),('visitors','visitors'),
    ('service_requests','service_requests'),('ics_records','ics_records'),
    ('profiles','user_accounts'),('access_requests','account_requests')) as modules(table_name,module_key)
  loop
    if to_regclass(format('public.%I',mapping.table_name)) is null then continue; end if;
    execute format('drop trigger if exists pgenro_module_new_record on public.%I',mapping.table_name);
    execute format('create trigger pgenro_module_new_record after insert on public.%I for each row execute function public.pgenro_notify_module_insert(%L)',mapping.table_name,mapping.module_key);
  end loop;
end $$;

create or replace function public.pgenro_get_module_notifications(p_limit integer default 30)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if not public.is_pgenro_active_user() then
    raise exception using errcode='42501',message='An active approved account is required.';
  end if;
  with unread as (
    select n.* from public.pgenro_module_notifications n
    where not exists(select 1 from public.pgenro_notification_reads r
      where r.user_id=auth.uid() and r.notification_id=n.id)
  ), module_counts as (
    select module_key,count(*) as total from unread group by module_key
  ), latest as (
    select * from unread order by created_at desc,id desc limit greatest(1,least(coalesce(p_limit,30),100))
  )
  select jsonb_build_object('total',(select count(*) from unread),
    'workspace',case when public.is_pgenro_admin() then 'admin' else 'user' end,
    'counts',coalesce((select jsonb_object_agg(module_key,total) from module_counts),'{}'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'module',module_key,
      'recordId',record_id,'title',title,'createdAt',created_at) order by created_at desc,id desc) from latest),'[]'::jsonb))
  into result;
  return result;
end $$;

create or replace function public.pgenro_mark_notifications_read(p_ids uuid[] default null,p_module text default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare marked integer;
begin
  if not public.is_pgenro_active_user() then
    raise exception using errcode='42501',message='An active approved account is required.';
  end if;
  if p_module is not null and p_module not in ('communications','travel_orders','office_memos',
    'employees','inventory','visitors','service_requests','ics_records','user_accounts','account_requests') then
    raise exception using errcode='22023',message='Unknown notification module.';
  end if;
  if p_ids is not null and cardinality(p_ids)>1000 then
    raise exception using errcode='22023',message='Select up to 1000 notifications at a time.';
  end if;
  insert into public.pgenro_notification_reads(user_id,notification_id)
  select auth.uid(),n.id from public.pgenro_module_notifications n
  where (p_ids is null or n.id=any(p_ids)) and (p_module is null or n.module_key=p_module)
  on conflict(user_id,notification_id) do nothing;
  get diagnostics marked=row_count;
  return marked;
end $$;
revoke all on function public.pgenro_get_module_notifications(integer),public.pgenro_mark_notifications_read(uuid[],text) from public,anon;
grant execute on function public.pgenro_get_module_notifications(integer),public.pgenro_mark_notifications_read(uuid[],text) to authenticated;

-- Supabase Realtime respects the notification table's SELECT policy.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='pgenro_module_notifications') then
    alter publication supabase_realtime add table public.pgenro_module_notifications;
  end if;
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='pgenro_notification_reads') then
    alter publication supabase_realtime add table public.pgenro_notification_reads;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
