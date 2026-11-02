-- Read-only SQL Editor checks; expected role values are Admin and User.
select role,status,is_active,count(*) as accounts
from public.profiles group by role,status,is_active order by role,status;
select count(*) as active_admin_accounts
from public.profiles p join auth.users u on u.id=p.user_id
where p.role='Admin' and p.status='Active' and p.is_active
  and (u.banned_until is null or u.banned_until<=now());
select proname as installed_function from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in ('pgenro_is_admin','is_pgenro_admin',
 'is_pgenro_active_user','pgenro_admin_list_users','pgenro_admin_pending_count',
 'pgenro_get_module_notifications','pgenro_mark_notifications_read',
 'handle_new_pgenro_auth_user','pgenro_notify_module_insert') order by proname;
select policyname,cmd,roles from pg_policies
where schemaname='public' and tablename='profiles' order by policyname;

-- Latest additions: saved requested roles and notifications for each module.
-- These are aggregate installation checks; they do not mark anything as read.
select data->>'requestedRole' as requested_role,
       data->>'assignedRole' as assigned_role,
       data->>'status' as request_status,
       count(*) as requests
from public.access_requests
group by data->>'requestedRole',data->>'assignedRole',data->>'status'
order by request_status,requested_role,assigned_role;

select name as notification_table,to_regclass('public.'||name) is not null as installed
from (values ('pgenro_module_notifications'),('pgenro_notification_reads')) as expected(name);

select mapping.module_key,mapping.table_name,
       exists (
         select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
         join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname=mapping.table_name
           and t.tgname='pgenro_module_new_record' and t.tgenabled<>'D'
       ) as new_record_notifications_enabled
from (values
 ('communications','communications'),('travel_orders','travel_orders'),
 ('office_memos','office_memos'),('employees','employees'),('inventory','inventory'),
 ('visitors','visitors'),('service_requests','service_requests'),('ics_records','ics_records'),
 ('user_accounts','profiles'),('account_requests','access_requests')
) as mapping(module_key,table_name)
order by mapping.module_key;

select tablename,policyname,cmd,roles from pg_policies
where schemaname='public'
  and tablename in ('pgenro_module_notifications','pgenro_notification_reads')
order by tablename,policyname;
-- A zero active_admin_accounts result means you should run BOOTSTRAP_FIRST_ADMIN.sql.
-- SQL Editor has no browser auth.uid(), so calling pgenro_is_admin() here
-- can correctly return false; test the Admin screen after signing in.
