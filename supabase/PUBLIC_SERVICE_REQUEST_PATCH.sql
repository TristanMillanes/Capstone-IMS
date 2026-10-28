-- Run the entire file in the existing project's Supabase SQL Editor.
begin;

alter table public.service_requests enable row level security;
revoke all on table public.service_requests from public, anon;
create sequence if not exists public.public_service_request_number_seq as bigint;
revoke all on sequence public.public_service_request_number_seq from public, anon, authenticated;

create or replace function public.submit_public_service_request(p_data jsonb, p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_name text;
  field_limit integer;
  allowed_values text[];
  clean_data jsonb := '{}'::jsonb;
  record_id text;
  service_number text;
  request_number bigint;
  existing_record jsonb;
  received_at timestamptz := now();
  request_date date := (now() at time zone 'Asia/Manila')::date;
begin
  if p_submission_id is null or p_data is null or jsonb_typeof(p_data) <> 'object'
     or octet_length(p_data::text) > 30000 then
    raise exception using errcode = '22023', message = 'Please submit a valid service request form.';
  end if;

  for field_name, field_limit in
    select * from (values
      ('clientName',180), ('organization',240), ('contactNo',60), ('emailAddress',254),
      ('technicalAssistance',120), ('iecService',120), ('plantingMaterials',120),
      ('environmentalConcerns',120), ('certifications',120), ('otherServices',1000),
      ('requestDetails',4000), ('location',500), ('dateNeeded',10),
      ('requestedBy',180), ('notedBy',180)
    ) as fields(name, max_length)
  loop
    if p_data ? field_name and jsonb_typeof(p_data->field_name) <> 'string' then
      raise exception using errcode = '22023', message = 'Invalid value for ' || field_name || '.';
    end if;
    if length(btrim(coalesce(p_data->>field_name,''))) > field_limit then
      raise exception using errcode = '22023', message = field_name || ' is too long.';
    end if;
    clean_data := clean_data || jsonb_build_object(field_name,btrim(coalesce(p_data->>field_name,'')));
  end loop;

  foreach field_name in array array['clientName','organization','requestDetails','location'] loop
    if clean_data->>field_name = '' then
      raise exception using errcode = '22023', message = 'Please complete all required service request fields.';
    end if;
  end loop;

  if clean_data->>'emailAddress' <> '' and clean_data->>'emailAddress' !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Please enter a valid email address.';
  end if;

  if clean_data->>'dateNeeded' <> '' then
    begin
      if clean_data->>'dateNeeded' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date'; end if;
      if (clean_data->>'dateNeeded')::date < request_date then
        raise exception 'Date needed is before the request date';
      end if;
    exception when others then
      raise exception using errcode = '22023', message = 'Date needed must be a valid date on or after the request date.';
    end;
  end if;

  for field_name, allowed_values in
    select * from (values
      ('technicalAssistance',array['Tree Growing','Waste Analysis and Characterization Study','Formulation/Review of 10-Year SWM Plan','Tree Trimming & Tree Risk Assessment','Environmental Impact / Pollution Inspection','Solid Waste Management Advisory','Watershed & Coastal Rehabilitation','Geohazard & Site Suitability Survey']::text[]),
      ('iecService',array['Request for Speaker','Request for Information','Request for Interview','Environmental Symposium / School Lecture','Climate Change Adaptation Workshop','Distribution of IEC Campaign Materials']::text[]),
      ('plantingMaterials',array['Forest Tree Seedlings (Narra, Mahogany, etc.)','Fruit-bearing Tree Seedlings','Mangrove Propagules','Bamboo Culms & Propagules']::text[]),
      ('environmentalConcerns',array['Solid Waste','Air Quality','Water Quality','Wildlife','Natural Resources','Illegal Tree Cutting / Balling','Illegal Dumping / Open Burning','Waterway Encroachment & Quarrying','Industrial Air / Odor Pollution']::text[]),
      ('certifications',array['SWM Compliance','Environmental Compliance Certificate (ECC) Endorsement','Tree Cutting / Trimming Clearance Inspection','Quarry / Sand & Gravel Clearance']::text[])
    ) as categories(name, allowed_options)
  loop
    if clean_data->>field_name <> '' and not (clean_data->>field_name = any(allowed_values)) then
      raise exception using errcode = '22023', message = 'Please select a listed option for ' || field_name || '.';
    end if;
  end loop;

  if not exists (
    select 1 from jsonb_each_text(clean_data) as field
    where field.key in ('technicalAssistance','iecService','plantingMaterials','environmentalConcerns','certifications','otherServices')
      and field.value <> ''
  ) then
    raise exception using errcode = '22023', message = 'Select at least one service or describe another service.';
  end if;

  clean_data := clean_data || jsonb_build_object(
    'requestedBy',coalesce(nullif(clean_data->>'requestedBy',''),clean_data->>'clientName')
  );
  record_id := 'public-service-' || p_submission_id::text;
  request_number := nextval('public.public_service_request_number_seq'::regclass);
  service_number := 'SR-' || extract(year from request_date)::text || '-P' ||
    lpad(request_number::text,greatest(6,length(request_number::text)),'0');

  insert into public.service_requests(id,data) values(record_id,clean_data || jsonb_build_object(
    'serviceNo',service_number, 'dateRequest',request_date, 'serviceStatus','Pending Review',
    'primaryCategory',coalesce(nullif(clean_data->>'technicalAssistance',''),nullif(clean_data->>'certifications',''),
      nullif(clean_data->>'plantingMaterials',''),nullif(clean_data->>'environmentalConcerns',''),
      nullif(clean_data->>'iecService',''),'Other Services'),
    'secondaryCategory',coalesce(nullif(clean_data->>'iecService',''),nullif(clean_data->>'certifications',''),nullif(clean_data->>'otherServices',''),'--'),
    'concernsCategory',coalesce(nullif(clean_data->>'environmentalConcerns',''),'--'),
    'endorsedBy',coalesce(nullif(clean_data->>'notedBy',''),'--'),
    'currentStep',1, 'submissionSource','public', 'submittedBy',clean_data->>'clientName',
    'submittedAt',received_at, 'createdAt',received_at, 'updatedAt',received_at
  )) on conflict(id) do nothing;

  select data into existing_record from public.service_requests where id = record_id;
  if existing_record is null then
    raise exception using errcode = '22023', message = 'The request could not be confirmed. Please try again.';
  end if;
  if exists (
    select 1 from jsonb_each(clean_data) as entry
    where existing_record->entry.key is distinct from entry.value
  ) then
    raise exception using errcode = '22023', message = 'This submission reference was already used. Please reload the form.';
  end if;
  return jsonb_build_object('id',record_id,'serviceNo',existing_record->>'serviceNo',
    'dateRequest',existing_record->>'dateRequest','serviceStatus','Pending Review');
end;
$$;

revoke all on function public.submit_public_service_request(jsonb,uuid) from public;
grant execute on function public.submit_public_service_request(jsonb,uuid) to anon, authenticated;

-- Withdraw the earlier public ICS endpoint, if that update was installed.
drop function if exists public.submit_public_ics(jsonb,uuid);
alter table public.ics_records enable row level security;
revoke all on table public.ics_records from public, anon;

create or replace function public.submit_ics(p_data jsonb, p_submission_id uuid)
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

  record_id := 'staff-ics-' || p_submission_id::text;
  select * into submitter from public.profiles
  where user_id = (select auth.uid()) and is_active = true
    and lower(status) in ('active','approved');
  if submitter.user_id is null then
    raise exception using errcode = '42501', message = 'An active staff account is required for ICS submission.';
  end if;

  clean_data := clean_data || jsonb_build_object(
    'unit', coalesce(nullif(clean_data->>'unit',''),'unit'),
    'quantity', quantity_value, 'unitCost', unit_cost_value,
    'totalValue', round(quantity_value * unit_cost_value,2),
    'status','Pending', 'submissionSource','user',
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

revoke all on function public.submit_ics(jsonb,uuid) from public, anon;
grant execute on function public.submit_ics(jsonb,uuid) to authenticated;



notify pgrst, 'reload schema';
commit;
