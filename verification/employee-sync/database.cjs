/* Production SQL + Auth triggers + Edge handler; local PostgreSQL WASM only. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const {PGlite}=require(process.env.PGENRO_PGLITE_MODULE||require.resolve('@electric-sql/pglite',{paths:[__dirname,path.resolve(__dirname,'../frontend')]}));
const root=path.resolve(__dirname,'../..'),checks=[];
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const access=source('supabase/ADMIN_USER_ACCESS_PATCH.sql');
const signup=access.slice(access.indexOf('create or replace function public.handle_new_pgenro_auth_user()'),access.indexOf('-- Recover the role chosen'));
const migration=source('supabase/EMPLOYEE_REGISTRATION_AUTO_SYNC_PATCH.sql');
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function run(wrapped,upgrade=false){
 const db=new PGlite();await db.waitReady;
 const schema=(wrapped?'JSON employees':'normalized employees')+(upgrade?' (upgrade)':'');
 const pass=check=>checks.push({schema,check,result:'PASS'});
 const q=(sql,args=[])=>db.query(sql,args);
 const value=async(sql,args=[])=>(await q(sql,args)).rows[0];
 async function fails(sql,args=[],code){let error;try{await q(sql,args);}catch(e){error=e;}assert(error,'Expected rejection');if(code)assert.equal(error.code,code,error.message);}
 async function actor(n,role='authenticated'){
  await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[n?uid(n):'',role]);
  if(role!=='owner')await db.exec('set role '+role);
 }
 async function register(n,number,details={},app={}){
  return q('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,email_confirmed_at) values($1,$2,$3,$4,now()) returning id',
   [uid(n),number+'@pgenro.ims',JSON.stringify({employee_number:number,first_name:'Maria',last_name:'Santos',division:'Admin Office',position:'Officer',...details}),JSON.stringify(app)]);
 }
 async function employee(n,number){
  const payload={employee_id:number,first_name:'Existing',last_name:'Person',designation:'HR Officer',department:'Forestry Division',email:'contact@example.com',
   ceremony_records:[{date:'2026-11-02',status:'PRESENT',remarks:'PRIVATE_'+number,secret:'NEVER_RETURN'}],uniform_records:[{date:'2026-11-02',compliant:true}]};
  if(wrapped)await q('insert into employees(id,data) values($1,$2)',[uid(1000+n),JSON.stringify(payload)]);
  else await q('insert into employees(id,employee_id,first_name,last_name,designation,department,email,ceremony_records,uniform_records) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
   [uid(1000+n),number,payload.first_name,payload.last_name,payload.designation,payload.department,payload.email,JSON.stringify(payload.ceremony_records),JSON.stringify(payload.uniform_records)]);
 }
 const payload=async(number)=>(await value("select public.pgenro_employee_payload(to_jsonb(e)) data from employees e where lower(btrim(public.pgenro_employee_payload(to_jsonb(e))->>'employee_id'))=lower($1)",[number])).data;
 async function patchEmployee(id,fields){
  if(wrapped)return q('update employees set data=data||$1::jsonb where id=$2',[JSON.stringify(fields),id]);
  const keys=Object.keys(fields);return q('update employees set '+keys.map((k,i)=>k+'=$'+(i+1)).join(',')+' where id=$'+(keys.length+1),[...keys.map(k=>typeof fields[k]==='object'?JSON.stringify(fields[k]):fields[k]),id]);
 }
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select coalesce(current_setting('request.jwt.claim.role',true),'')$$;
 grant usage on schema auth,public to anon,authenticated,service_role;
 grant execute on all functions in schema auth to anon,authenticated,service_role;
 create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',email_confirmed_at timestamptz,banned_until timestamptz);
 create table profiles(user_id uuid primary key references auth.users(id) on delete cascade,full_name text,email text,username text,contact text,position text,division text,role text,status text,is_active boolean,account_type text);
 create table access_requests(id text primary key,data jsonb default '{}');
 create table pgenro_module_notifications(id uuid primary key default gen_random_uuid(),module_key text,title text);
 alter table pgenro_module_notifications enable row level security;
 grant select on pgenro_module_notifications to authenticated;
 create table employees(id ${wrapped?'text':'uuid'} primary key default gen_random_uuid()${wrapped?",data jsonb not null default '{}'":",employee_id text not null unique,first_name text not null,middle_name text,last_name text not null,name_extension text,designation text not null,department text not null,email text,duty_status text default 'Active',ceremony_records jsonb default '[]',uniform_records jsonb default '[]'"});
 create function is_pgenro_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.role='Admin' and p.is_active and p.status='Active')$$;
 create function is_pgenro_active_user() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id where p.user_id=auth.uid() and p.status='Active' and p.is_active and (u.banned_until is null or u.banned_until<=now()))$$;
 create policy legacy_notifications on pgenro_module_notifications for select to authenticated using(public.is_pgenro_active_user());
 grant select,insert,update,delete on employees to authenticated,service_role;
 grant select,update on profiles to authenticated;grant all on profiles,auth.users,access_requests to service_role;
 alter table employees enable row level security;
 create policy legacy_read_all on employees for select to authenticated using(public.is_pgenro_active_user());
 create policy admin_write on employees for all to authenticated using(public.is_pgenro_admin()) with check(public.is_pgenro_admin());
 alter table profiles enable row level security;
 create policy own_profile on profiles for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());`);
 await db.exec(signup);
 await register(99,'Admin001',{},{});await q("update profiles set role='Admin',status='Active',is_active=true where user_id=$1",[uid(99)]);
 await register(10,'0009',{full_name:'Legacy Person'});
 await register(11,'0042');await q("update profiles set status='Active',is_active=true where user_id=$1",[uid(11)]);
 await q("insert into auth.users(id,email,raw_user_meta_data) values($1,'legacy@example.com','{\"full_name\":\"Unlinked legacy\"}')",[uid(12)]);
 await q("update profiles set status='Active',is_active=true where user_id=$1",[uid(12)]);
 await employee(8,'0008');await employee(42,'0042');
 await db.exec("create publication supabase_realtime;insert into pgenro_module_notifications(module_key,title) values('employees','PRIVATE_PERSONNEL_NOTICE'),('visitors','PRIVATE_VISITOR_NOTICE'),('communications','PUBLIC_COMMUNICATION_NOTICE');");
 if(upgrade){await db.exec(source('supabase/EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql'));await db.exec(source('supabase/EMPLOYEE_ID_LOGIN_PATCH.sql'));}
 await db.exec(migration);
 const firstCount=(await value('select count(*)::int n from employees')).n;
 assert.equal(firstCount,3);assert.equal((await value('select employee_number from profiles where user_id=$1',[uid(10)])).employee_number,'0009');
 assert.equal((await value('select employee_record_id from profiles where user_id=$1',[uid(11)])).employee_record_id,uid(1042));
 assert.equal((await value('select employee_record_id from profiles where user_id=$1',[uid(12)])).employee_record_id,null);
 pass('Migration backfills existing employee-ID accounts without guessing legacy identities');
 await db.exec(migration);assert.equal((await value('select count(*)::int n from employees')).n,firstCount);
 assert.equal((await value("select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename='pgenro_attendance_updates'")).n,1);
 pass('Migration is re-runnable without duplicate records/history and publishes the private attendance revision table');
 await actor(null,'anon');
 assert.deepEqual((await value("select pgenro_employee_registration_check(' 0007 ') result")).result,{eligible:true,employee_number:'0007'});
 await fails('select * from employees',[],'42501');
 await fails('select pgenro_ensure_account_employee($1,$2,$3)',[uid(1),'0007','{}'],'42501');
 pass('Registration preflight accepts new numbers and cannot create or expose employee records');
 await actor(null,'owner');assert.equal((await value('select count(*)::int n from employees')).n,firstCount);
 await register(1,'0007',{requested_role:'Admin',employee_record_id:uid(1042),created_by_admin:true});
 let p=await value('select * from profiles where user_id=$1',[uid(1)]);
 assert(p.employee_record_id);assert.equal(p.employee_number,'0007');assert.equal(p.role,'User');assert.equal(p.status,'Pending');assert.equal(p.is_active,false);
 let emp=await payload('0007');assert.equal(emp.id,p.employee_record_id);assert.equal(emp.first_name,'Maria');assert.equal(emp.last_name,'Santos');assert.equal(emp.department,'Admin Office');assert.deepEqual(emp.ceremony_records,[]);
 const request=(await value("select data from access_requests where data->>'uid'=$1",[uid(1)])).data;
 assert.equal(request.employeeRecordId,emp.id);assert.equal(request.employeeNumber,'0007');assert(!JSON.stringify(emp).includes('password'));
 pass('One signup atomically creates the employee, pending User profile and linked access request');
 const old=await payload('0008');await register(2,'0008',{first_name:'Forged',last_name:'Identity',division:'Fake Division'});assert.deepEqual(await payload('0008'),old);
 assert.equal((await value('select employee_record_id from profiles where user_id=$1',[uid(2)])).employee_record_id,old.id);
 pass('An existing employee number reuses the exact HR row and preserves names, email and monitoring histories');
 let collision;try{await employee(88,' 0008 ');}catch(e){collision=e;}
 assert.equal(collision?.code,'23505');pass('The database also rejects duplicate employee numbers introduced by manual Admin encoding');
 await fails('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[uid(3),'0007@pgenro.ims',JSON.stringify({employee_number:'0007'})],'23505');
 await register(4,'7');assert.notEqual((await payload('7')).id,emp.id);
 pass('Duplicate requests are blocked while distinct leading-zero employee numbers remain distinct');
 await actor(1);await fails('select pgenro_my_attendance()',[],'42501');assert.equal((await q('select * from pgenro_attendance_updates')).rows.length,0);
 await actor(null,'owner');await q("update profiles set status='Active',is_active=true where user_id in ($1,$2)",[uid(1),uid(2)]);
 const revision=(await value('select revision from pgenro_attendance_updates where user_id=$1',[uid(1)])).revision;
 const otherRevision=(await value('select revision from pgenro_attendance_updates where user_id=$1',[uid(2)])).revision;
 await patchEmployee(emp.id,{ceremony_records:[{date:'2026-11-03',status:'LATE',remarks:'ONLY_0007',secret:'DO_NOT_RETURN'}],uniform_records:[{date:'2026-11-03',compliant:false}]});
 assert((await value('select revision from pgenro_attendance_updates where user_id=$1',[uid(1)])).revision>revision);
 assert.equal((await value('select revision from pgenro_attendance_updates where user_id=$1',[uid(2)])).revision,otherRevision);
 pass('An Admin employee update signals only the linked account for attendance refresh');
 await actor(1);let own=(await value('select pgenro_my_attendance() data')).data;
 assert.equal(own.employee.employee_number,'0007');assert.equal(own.ceremony_records[0].remarks,'ONLY_0007');assert.equal(own.uniform_records[0].compliant,false);assert(!JSON.stringify(own).includes('PRIVATE_0008'));assert(!JSON.stringify(own).includes('DO_NOT_RETURN'));
 assert.equal((await value('select count(*)::int n from employees')).n,0);
 await fails('select pgenro_employee_directory()',[],'42501');
 pass('Approved users receive only their own attendance/uniform records and cannot open the personnel directory');
 const signals=(await q('select * from pgenro_attendance_updates')).rows;
 assert.equal(signals.length,1);assert.equal(signals[0].user_id,uid(1));assert.deepEqual(Object.keys(signals[0]).sort(),['revision','updated_at','user_id']);
 await fails('update pgenro_attendance_updates set revision=100',[],'42501');
 await fails('select pgenro_touch_attendance_account($1)',[uid(2)],'42501');
 assert.deepEqual((await q('select module_key from pgenro_module_notifications')).rows.map(r=>r.module_key),['communications']);
 pass('Attendance signals are read-only and caller-owned; personnel and visitor notifications stay Admin-only');
 await fails('select pgenro_my_attendance($1)',[old.id],'42883');
 await fails('update profiles set employee_record_id=$1 where user_id=$2',[old.id,uid(1)],'42501');
 await fails('update profiles set employee_number=$1 where user_id=$2',['0008',uid(1)],'42501');
 await fails('select pgenro_link_employee_account($1,$2)',[uid(1),'0008'],'42501');
 await actor(null,'owner');await q("update auth.users set raw_user_meta_data=raw_user_meta_data||$1::jsonb where id=$2",[JSON.stringify({employee_record_id:old.id,employee_number:'0008'}),uid(1)]);
 await actor(1);assert.equal((await value('select pgenro_my_attendance() data')).data.employee.employee_number,'0007');
 pass('URL-style ID arguments, profile edits and forged Auth metadata cannot redirect attendance');
 await actor(12);assert.equal((await value('select pgenro_my_attendance() data')).data.linked,false);
 await actor(99);assert((await value('select pgenro_employee_directory() data')).data.length>0);
 assert.equal((await q('select module_key from pgenro_module_notifications')).rows.length,3);
 await employee(44,'0044');await q('select pgenro_link_employee_account($1,$2)',[uid(12),'0044']);
 await actor(12);assert.equal((await value('select pgenro_my_attendance() data')).data.employee.employee_number,'0044');
 assert.equal((await value('select pgenro_my_attendance() data')).data.ceremony_records[0].remarks,'PRIVATE_0044');
 pass('Admin can link an older User account by employee number while retaining exclusive personnel-directory access');
 await actor(99);await fails('delete from employees where id=$1',[emp.id],'23503');
 await patchEmployee(emp.id,{employee_id:'CORRECTED-0007',first_name:'Corrected'});
 await actor(1);assert.equal((await value('select pgenro_my_attendance() data')).data.ceremony_records[0].remarks,'ONLY_0007');
 assert.equal((await value('select employee_number from profiles where user_id=$1',[uid(1)])).employee_number,'CORRECTED-0007');
 await fails('select pgenro_employee_login_email($1)',['CORRECTED-0007'],'42501');
 await actor(null,'service_role');assert.equal((await value('select pgenro_employee_login_email($1) email',['CORRECTED-0007'])).email,'0007@pgenro.ims');
 pass('Administrator HR corrections keep the permanent attendance link and employee-number login resolver');
 await actor(null,'owner');
 await fails('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[uid(20),'admin001@pgenro.ims','{"employee_number":"Admin001"}'],'22023');
 await register(21,'Admin002',{username:'Admin002'},{created_by_admin:true,pgenro_role:'Admin',pgenro_status:'Active'});
 assert.equal((await value('select employee_record_id from profiles where user_id=$1',[uid(21)])).employee_record_id,null);
 await register(22,'ADMIN-CREATED-USER',{username:'ADMIN-CREATED-USER'},{created_by_admin:true,pgenro_role:'User',pgenro_status:'Active'});
 assert((await value('select employee_record_id from profiles where user_id=$1',[uid(22)])).employee_record_id);
 pass('Trusted administrator setup remains supported; administrator-created Users also receive linked employees');
 await db.exec("create function reject_test_request() returns trigger language plpgsql as $$begin if new.data->>'employeeNumber'='ROLLBACK' then raise exception 'Fixture request failure';end if;return new;end$$;create trigger reject_test_request before insert on access_requests for each row execute function reject_test_request();");
 await fails('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[uid(23),'rollback@pgenro.ims',JSON.stringify({employee_number:'ROLLBACK',full_name:'Rollback Test'})],'P0001');
 assert.equal((await value("select count(*)::int n from employees e where pgenro_employee_payload(to_jsonb(e))->>'employee_id'='ROLLBACK'")).n,0);
 assert.equal((await value('select count(*)::int n from auth.users where id=$1',[uid(23)])).n,0);
 pass('A failed request rolls back Auth, profile and employee creation without orphan records');
 if(!wrapped&&!upgrade){
  // Execute the actual TypeScript handler with a Supabase-shaped adapter backed
  // by this real local database. There are no live HTTP/database requests.
  const calls=[];
  const adapter={rpc:async(name,args)=>{try{return{data:(await value('select '+name+'($1) data',[args.p_employee_number])).data,error:null};}catch(e){return{data:null,error:{code:e.code}};}},
   auth:{admin:{createUser:async input=>{calls.push(input);try{const id=crypto.randomUUID();await q('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,now())',[id,input.email,JSON.stringify(input.user_metadata)]);return{data:{user:{id}},error:null};}catch(e){return{data:{user:null},error:{code:'unexpected_failure',message:'Database error'}};}}}}};
  const Deno={env:{get:key=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only'})[key]},serve(){}};
  const compile=file=>stripTypeScriptTypes(source(file),{mode:'transform'}).replace(/^import[^\n]+\n/m,'').replace(/\bexport /g,'');
  const helpers=new Function('createClient','Deno',compile('supabase/functions/_shared/employee-accounts.ts')+';return {AccountError,employeeNumber,publicHandler,serviceClient};')(()=>adapter,Deno);
  const handler=new Function(...Object.keys(helpers),'Deno',compile('supabase/functions/employee-register/index.ts')+';return handler;')(...Object.values(helpers),Deno);
  const body={employee_number:'EDGE-0001',first_name:'Edge',middle_name:'Test',last_name:'Person',division:'Admin Office',password:'FixtureOnly123!',role:'Admin',employee_record_id:old.id};
  const invoke=b=>handler(new Request('https://fixture.invalid/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}));
  let response=await invoke(body);assert.equal(response.status,200);assert.equal((await response.json()).success,true);
  assert.equal(calls.at(-1).user_metadata.requested_role,'User');assert(!('employee_record_id'in calls.at(-1).user_metadata));assert(!('password'in calls.at(-1).user_metadata));assert.equal(calls.at(-1).email_confirm,true);
  assert.equal((await payload('EDGE-0001')).last_name,'Person');
  const race=await Promise.all([invoke({...body,employee_number:'RACE-Ab'}),invoke({...body,employee_number:' race-ab '})]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  assert.equal((await value("select count(*)::int n from employees e where lower(pgenro_employee_payload(to_jsonb(e))->>'employee_id')='race-ab'")).n,1);
  assert.equal((await invoke({...body,employee_number:'BAD-NEW',first_name:'',last_name:'',full_name:''})).status,400);
  assert.equal((await invoke({...body,employee_number:'BAD-PASS',password:'short'})).status,400);
  pass('Production registration endpoint creates linked employees, forces Pending User metadata, validates details and handles racing duplicates');
 }
 await db.close();
}
(async()=>{await run(false);await run(true);await run(false,true);fs.writeFileSync(path.join(__dirname,'database-results.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));})().catch(e=>{fs.writeFileSync(path.join(__dirname,'database-results.json'),JSON.stringify({passed:false,checks,error:e.message},null,2));console.error({message:e.message,code:e.code,position:e.position,where:e.where,stack:e.stack});process.exitCode=1;});
