-- Run once in the existing project's Supabase SQL Editor, after the base setup.
begin;

alter table public.ics_records enable row level security;
revoke all on table public.ics_records from public, anon;

create or replace function public.submit_public_ics(p_data jsonb, p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_name text;
  field_limit integer;
  quantity_value numeric;
  unit_cost_value numeric;
  clean_data jsonb := '{}'::jsonb;
  record_id text;
  existing_record jsonb;
  received_at timestamptz := now();
  submitter public.profiles%rowtype;
begin
  if p_submission_id is null or p_data is null or jsonb_typeof(p_data) <> 'object'
     or octet_length(p_data::text) > 16000 then
    raise exception using errcode = '22023', message = 'Please submit a valid ICS form.';
  end if;

  for field_name, field_limit in
    select * from (values
      ('controlNo',60), ('icsNo',60), ('entryNo',60), ('accountCode',60),
      ('article',120), ('itemDescription',240), ('serialNo',120), ('itemNo',120),
      ('unit',40), ('dateAcquired',10), ('prNo',80), ('prDate',10),
      ('fundCluster',80), ('accountablePerson',180), ('division',120), ('remarks',1000)
    ) as fields(name, max_length)
  loop
    if p_data ? field_name and jsonb_typeof(p_data->field_name) <> 'string' then
      raise exception using errcode = '22023', message = 'Invalid value for ' || field_name || '.';
    end if;
    if length(btrim(coalesce(p_data->>field_name,''))) > field_limit then
      raise exception using errcode = '22023', message = field_name || ' is too long.';
    end if;
    clean_data := clean_data || jsonb_build_object(field_name, btrim(coalesce(p_data->>field_name,'')));
  end loop;

  foreach field_name in array array['controlNo','icsNo','article','itemDescription','accountablePerson']
  loop
    if clean_data->>field_name = '' then
      raise exception using errcode = '22023', message = 'Please complete all required ICS fields.';
    end if;
  end loop;

  foreach field_name in array array['dateAcquired','prDate'] loop
    if clean_data->>field_name <> '' then
      begin
        if clean_data->>field_name !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'Invalid date';
        end if;
        perform (clean_data->>field_name)::date;
      exception when others then
        raise exception using errcode = '22023', message = 'Please enter a valid date for ' || field_name || '.';
      end;
    end if;
  end loop;

  if coalesce(jsonb_typeof(p_data->'quantity'),'null') not in ('number','string')
     or coalesce(jsonb_typeof(p_data->'unitCost'),'null') not in ('number','string')
     or coalesce(p_data->>'quantity','') !~ '^\d{1,7}(\.\d{1,2})?$'
     or coalesce(p_data->>'unitCost','') !~ '^\d{1,10}(\.\d{1,2})?$' then
    raise exception using errcode = '22023', message = 'Enter a valid quantity and unit cost with up to two decimal places.';
  end if;
  quantity_value := (p_data->>'quantity')::numeric;
  unit_cost_value := (p_data->>'unitCost')::numeric;
  if quantity_value <= 0 or quantity_value > 1000000 or unit_cost_value < 0 or unit_cost_value > 1000000000 then
    raise exception using errcode = '22023', message = 'Quantity or unit cost is outside the allowed range.';
  end if;

  record_id := 'public-ics-' || p_submission_id::text;
  select * into submitter from public.profiles
  where user_id = (select auth.uid()) and is_active = true
    and lower(status) in ('active','approved');

  clean_data := clean_data || jsonb_build_object(
    'unit', coalesce(nullif(clean_data->>'unit',''),'unit'),
    'quantity', quantity_value, 'unitCost', unit_cost_value,
    'totalValue', round(quantity_value * unit_cost_value,2),
    'status','Pending', 'submissionSource',case when submitter.user_id is null then 'public' else 'user' end,
    'submittedBy',coalesce(nullif(submitter.full_name,''),clean_data->>'accountablePerson'),
    'submittedByUserId',submitter.user_id, 'submittedAt',received_at,
    'createdAt',received_at, 'updatedAt',received_at
  );

  insert into public.ics_records(id,data) values(record_id,clean_data)
  on conflict(id) do nothing;

  -- Only return the receipt for this unpredictable request ID, never a registry.
  select data into existing_record from public.ics_records where id = record_id;
  if existing_record is null then
    raise exception using errcode = '22023', message = 'The submission could not be confirmed. Please try again.';
  end if;
  if exists (
    select 1 from jsonb_each(clean_data - array['submittedAt','createdAt','updatedAt']) as entry
    where entry.key not in ('status') and existing_record->entry.key is distinct from entry.value
  ) then
    raise exception using errcode = '22023', message = 'This submission reference was already used. Please reload the form.';
  end if;
  return jsonb_build_object('id',record_id,'controlNo',existing_record->>'controlNo',
    'icsNo',existing_record->>'icsNo','status','Pending');
end;
$$;

revoke all on function public.submit_public_ics(jsonb,uuid) from public;
grant execute on function public.submit_public_ics(jsonb,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
