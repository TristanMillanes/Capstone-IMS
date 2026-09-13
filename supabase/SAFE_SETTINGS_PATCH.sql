-- ============================================================================
-- PGENRO IMS — SAFE ACCOUNT & SYSTEM SETTINGS PATCH
-- Idempotent: safe to run more than once after PGENRO_FULL_SETUP.sql.
-- Does not replace or drop operational tables.
-- ============================================================================

alter table public.profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- Users may update only their own editable profile fields through this RPC.
create or replace function public.update_my_profile(
  p_full_name text,
  p_username text,
  p_contact text,
  p_position text,
  p_division text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.profiles;
begin
  if auth.uid() is null or not public.is_pgenro_active_user() then
    raise exception 'Active PGENRO authentication is required.';
  end if;

  update public.profiles
  set
    full_name = nullif(trim(coalesce(p_full_name, '')), ''),
    username = nullif(trim(coalesce(p_username, '')), ''),
    contact = nullif(trim(coalesce(p_contact, '')), ''),
    position = nullif(trim(coalesce(p_position, '')), ''),
    division = nullif(trim(coalesce(p_division, '')), ''),
    updated_at = now()
  where user_id = auth.uid()
  returning * into saved;

  if saved.user_id is null then
    raise exception 'Profile not found.';
  end if;
  return saved;
end;
$$;

revoke all on function public.update_my_profile(text,text,text,text,text) from public;
grant execute on function public.update_my_profile(text,text,text,text,text) to authenticated;

create or replace function public.update_my_preferences(p_preferences jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved jsonb;
begin
  if auth.uid() is null or not public.is_pgenro_active_user() then
    raise exception 'Active PGENRO authentication is required.';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object' then
    raise exception 'Preferences must be a JSON object.';
  end if;

  update public.profiles
  set preferences = coalesce(preferences, '{}'::jsonb) || p_preferences,
      updated_at = now()
  where user_id = auth.uid()
  returning preferences into saved;

  if saved is null then
    raise exception 'Profile not found.';
  end if;
  return saved;
end;
$$;

revoke all on function public.update_my_preferences(jsonb) from public;
grant execute on function public.update_my_preferences(jsonb) to authenticated;

create table if not exists public.system_settings (
  id smallint primary key default 1 check (id = 1),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.system_settings (id, settings)
values (1, jsonb_build_object(
  'organization_name', 'Provincial Government of Quezon',
  'office_name', 'PGENRO Information Management System',
  'session_timeout_minutes', 30,
  'default_page_size', 25,
  'account_requests_enabled', true,
  'maintenance_mode', false,
  'announcement_enabled', false,
  'announcement', ''
))
on conflict (id) do nothing;

alter table public.system_settings enable row level security;
revoke all on table public.system_settings from anon, authenticated;
grant select on table public.system_settings to anon, authenticated;
grant update on table public.system_settings to authenticated;
grant all on table public.system_settings to service_role;

drop policy if exists system_settings_public_read on public.system_settings;
drop policy if exists system_settings_admin_update on public.system_settings;

create policy system_settings_public_read
on public.system_settings for select
to anon, authenticated
using (true);

create policy system_settings_admin_update
on public.system_settings for update
to authenticated
using ((select public.is_pgenro_admin()))
with check ((select public.is_pgenro_admin()));

create or replace function public.update_pgenro_system_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved jsonb;
begin
  if not public.is_pgenro_admin() then
    raise exception 'Administrator permission is required.';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Settings patch must be a JSON object.';
  end if;

  update public.system_settings
  set settings = coalesce(settings, '{}'::jsonb) || p_patch,
      updated_at = now(),
      updated_by = auth.uid()
  where id = 1
  returning settings into saved;

  return saved;
end;
$$;

revoke all on function public.update_pgenro_system_settings(jsonb) from public;
grant execute on function public.update_pgenro_system_settings(jsonb) to authenticated;

-- Realtime is optional. Ignore duplicate-publication errors safely.
do $$
begin
  begin
    alter publication supabase_realtime add table public.system_settings;
  exception when duplicate_object then
    null;
  end;
end $$;
