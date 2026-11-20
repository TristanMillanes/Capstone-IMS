-- Run once in Supabase SQL Editor for an existing PGENRO IMS database.
-- Existing records continue to use their legacy numbers until edited.
begin;

alter table public.communications
  add column if not exists manual_control_no text;

comment on column public.communications.manual_control_no is
  'Control number manually assigned in the Communications Log';

notify pgrst, 'reload schema';

commit;
