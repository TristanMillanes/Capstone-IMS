/* Actual PostgreSQL (PGlite), production migration and production signup trigger.
   No hosted database or real account is contacted. npm install @electric-sql/pglite */
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..');
const {PGlite}=require(process.env.PGENRO_PGLITE_MODULE||'@electric-sql/pglite');
const migration=fs.readFileSync(path.join(root,'supabase/EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql'),'utf8');
const existing=fs.readFileSync(path.join(root,'supabase/ADMIN_USER_ACCESS_PATCH.sql'),'utf8');
const signup=existing.slice(existing.indexOf('create or replace function public.handle_new_pgenro_auth_user()'),existing.indexOf('-- Recover the role chosen'));
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const checks=[];
async function run(wrapped){
 const db=new PGlite();await db.waitReady;
 const label=wrapped?'legacy JSON employees':'normalized employees';
 const pass=name=>checks.push({schema:label,check:name,result:'PASS'});
 const query=(sql,args=[])=>db.query(sql,args);
 async function fails(sql,args,code){let thrown;try{await query(sql,args);}catch(e){thrown=e;}assert(thrown,'Expected rejection: '+sql);if(code)assert.equal(thrown.code,code,thrown.message);}
 async function actor(n,role='authenticated'){
  await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[n?uid(n):'',role]);
  if(role!=='owner')await db.exec('set role '+role);
 }
 async function employee(n,number,email,ceremony=[],uniform=[]){
  const data={employee_id:number,first_name:'PERSON'+n,last_name:'OFFICE',designation:'Officer',department:'Administration',email,ceremony_records:ceremony,uniform_records:uniform};
  if(wrapped)await query('insert into public.employees(id,data) values($1,$2)',[uid(1000+n),JSON.stringify(data)]);
  else await query('insert into public.employees(id,employee_id,first_name,last_name,designation,department,email,ceremony_records,uniform_records) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uid(1000+n),number,data.first_name,data.last_name,data.designation,data.department,email,JSON.stringify(ceremony),JSON.stringify(uniform)]);
 }
 async function register(n,number,email,extra={},app={}){
  return query('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,email_confirmed_at) values($1,$2,$3,$4,now()) returning raw_user_meta_data',[uid(n),email,JSON.stringify({employee_number:number,...extra}),JSON.stringify(app)]);
 }
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select coalesce(current_setting('request.jwt.claim.role',true),'')$$;
 grant usage on schema auth,public to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;
 create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',email_confirmed_at timestamptz,banned_until timestamptz);
 create table public.profiles(user_id uuid primary key references auth.users(id),full_name text,email text,username text,contact text,position text,division text,role text,status text,is_active boolean,account_type text);
 create table public.access_requests(id text primary key,data jsonb default '{}');
 create table public.employees(id uuid primary key${wrapped?",data jsonb default '{}'":",employee_id text unique,first_name text,last_name text,designation text,department text,email text,ceremony_records jsonb default '[]',uniform_records jsonb default '[]'"});
 create function public.is_pgenro_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.role='Admin' and p.is_active and p.status='Active')$$;
 create function public.is_pgenro_active_user() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles p join auth.users u on u.id=p.user_id where p.user_id=auth.uid() and p.is_active and p.status='Active' and (u.banned_until is null or u.banned_until<=now()))$$;
 grant select,insert,update,delete on public.employees to authenticated,service_role;
 grant select,update on public.profiles to authenticated;grant all on public.profiles to service_role;
 alter table public.employees enable row level security;
 create policy legacy_read_all on public.employees for select to authenticated using(public.is_pgenro_active_user());
 create policy admin_write on public.employees for all to authenticated using(public.is_pgenro_admin()) with check(public.is_pgenro_admin());
 alter table public.profiles enable row level security;
 create policy own_profile on public.profiles for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());`);
 await db.exec(signup);
 await register(99,null,'admin@example.com');await query("update public.profiles set role='Admin',status='Active',is_active=true where user_id=$1",[uid(99)]);
 await register(90,null,'legacy@example.com');await query("update public.profiles set status='Active',is_active=true where user_id=$1",[uid(90)]);
 await register(91,null,'unmatched@example.com');await query("update public.profiles set status='Active',is_active=true where user_id=$1",[uid(91)]);
 await employee(1,'0007','one@example.com',[{id:'a',date:'2026-11-02',status:'PRESENT',activity:'FLAG CEREMONY',remarks:'Own record',secret:'must not be returned'}],[{date:'2026-11-02',compliant:true}]);
 await employee(2,'0008','two@example.com',[{id:'b',date:'2026-11-02',status:'ABSENT',remarks:'OTHER PERSON'}]);
 await employee(3,'EMP-09','');await employee(4,'0010','legacy@example.com');
 await db.exec(migration);pass('Migration installs on the production employee storage format');
 assert.equal((await query('select employee_number from profiles where user_id=$1',[uid(90)])).rows[0].employee_number,'0010');pass('Only an approved account with a unique verified-email match is auto-linked');
 await actor(null,'anon');
 const check=(await query("select public.pgenro_employee_registration_check(' 0007 ','ONE@example.com') result")).rows[0].result;
 assert.deepEqual(check,{eligible:true,employee_number:'0007'});pass('Public verification preserves leading zeroes and returns no personnel data');
 await fails("select public.pgenro_employee_registration_check('missing','one@example.com')",[], '22023');
 await fails("select public.pgenro_employee_registration_check('0007','other@example.com')",[],'22023');
 await fails('select * from public.employees',[],'42501');
 await fails("select public.pgenro_registration_employee('0007','one@example.com')",[],'42501');pass('Anonymous callers cannot enumerate employee rows or call the private resolver');
 await actor(null,'owner');
 await fails('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[uid(1),'missing@example.com',JSON.stringify({created_by_admin:true,requested_role:'Admin'})],'22023');pass('Direct signup without an encoded employee ID is rejected, including a forged admin flag');
 const registered=await register(1,'0007','one@example.com',{full_name:'Fake identity',requested_role:'Admin'});
 assert.equal(registered.rows[0].raw_user_meta_data.username,'0007');
 const profile=(await query('select * from profiles where user_id=$1',[uid(1)])).rows[0];
 assert.equal(profile.employee_record_id,uid(1001));assert.equal(profile.full_name,'PERSON1 OFFICE');assert.equal(profile.role,'User');assert.equal(profile.status,'Pending');assert.equal(profile.is_active,false);
 const request=(await query("select data from access_requests where data->>'uid'=$1",[uid(1)])).rows[0].data;
 assert.equal(request.employeeNumber,'0007');pass('The database derives identity from the employee row, links the account and keeps approval pending');
 await fails('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[uid(2),'one@example.com',JSON.stringify({employee_number:'0007'})],'23505');pass('A pending request reserves the employee ID against duplicate signup');
 await actor(1);await fails('select public.pgenro_my_attendance()',[],'42501');pass('Pending accounts cannot read attendance');
 await actor(null,'owner');await query("update profiles set status='Active',is_active=true where user_id=$1",[uid(1)]);
 await actor(1);
 const own=(await query('select public.pgenro_my_attendance() result')).rows[0].result;
 assert.equal(own.employee.employee_number,'0007');assert.equal(own.ceremony_records.length,1);assert.equal(own.ceremony_records[0].remarks,'Own record');assert.equal(own.uniform_records[0].compliant,true);assert(!JSON.stringify(own).includes('OTHER PERSON'));assert(!JSON.stringify(own).includes('must not be returned'));
 pass('An approved User receives only their linked ceremony/uniform records and allowed record fields');
 assert.equal((await query('select count(*)::int n from employees')).rows[0].n,0);pass('Legacy permissive table policies cannot expose other employees attendance');
 const directory=(await query('select public.pgenro_employee_directory() result')).rows[0].result;
 assert.equal(directory.length,4);assert(directory.every(r=>!('ceremony_records' in r)&&!('uniform_records'in r)));pass('The existing user directory retains personnel rows without monitoring arrays');
 await fails('select public.pgenro_my_attendance($1)',[uid(1002)],'42883');
 await fails('update profiles set employee_record_id=$1 where user_id=$2',[uid(1002),uid(1)],'42501');
 await fails('select public.pgenro_link_employee_account($1,$2)',[uid(1),'0008'],'42501');pass('A User cannot request a different employee ID or change the authoritative link');
 await actor(null,'owner');await query("update auth.users set raw_user_meta_data=raw_user_meta_data||$1::jsonb where id=$2",[JSON.stringify({employee_record_id:uid(1002),employee_number:'0008'}),uid(1)]);
 await actor(1);assert.equal((await query('select public.pgenro_my_attendance() result')).rows[0].result.employee.employee_number,'0007');pass('Editing Auth user metadata cannot redirect attendance');
 await actor(91);assert.equal((await query('select public.pgenro_my_attendance() result')).rows[0].result.linked,false);pass('Unlinked existing accounts receive an empty link state with no fallback to another employee');
 await actor(99);assert.equal((await query('select count(*)::int n from employees')).rows[0].n,4);await fails('select public.pgenro_my_attendance()',[],'42501');pass('Administrator employee encoding access remains available, with no personal attendance endpoint');
 await actor(null,'owner');await register(10,null,'manual-admin@example.com',{created_by_admin:true},{pgenro_role:'Admin',pgenro_status:'Active'});pass('Trusted existing Admin account creation works without public-registration employee fields');
 await register(3,'EMP-09','pending@example.com');assert.equal((await query('select employee_number from profiles where user_id=$1',[uid(3)])).rows[0].employee_number,'EMP-09');pass('An employee without a recorded email can submit a pending request for administrator review');
 await fails('delete from employees where id=$1',[uid(1001)],'23503');pass('Deleting a linked employee cannot silently orphan or redirect the account');
 if(wrapped)await query("update employees set data=data||'{\"employee_id\":\"NEW-0007\"}' where id=$1",[uid(1001)]);
 else await query("update employees set employee_id='NEW-0007' where id=$1",[uid(1001)]);
 await actor(1);assert.equal((await query('select public.pgenro_my_attendance() result')).rows[0].result.employee.employee_number,'NEW-0007');pass('Employee-number corrections preserve the stable account/attendance link');
 await actor(null,'owner');
 await employee(5,'0091','unmatched@example.com');await actor(99);
 await query('select public.pgenro_link_employee_account($1,$2)',[uid(91),'0091']);
 await actor(91);assert.equal((await query('select public.pgenro_my_attendance() result')).rows[0].result.employee.employee_number,'0091');pass('An active Admin can explicitly link a verified existing User to the encoded employee');
 await actor(null,'owner');
 await db.exec('grant select on public.employees to public;create policy test_legacy_public_read on public.employees for select to public using(true)');
 await actor(null,'anon');assert.equal((await query('select count(*)::int n from employees')).rows[0].n,0);pass('Anonymous row access remains blocked even with a legacy PUBLIC grant and read policy');
 await actor(null,'owner');await db.exec('drop policy test_legacy_public_read on employees;revoke select on employees from public');
 await employee(6,'CASE-ID','case@example.com');await employee(7,'case-id','case@example.com');
 await fails("select public.pgenro_employee_registration_check('CASE-ID','case@example.com')",[],'22023');pass('Ambiguous employee numbers are rejected instead of selecting a different person');
 await db.exec(migration);pass('The migration is repeatable without deleting or relinking records');
 await db.close();
}
(async()=>{await run(false);await run(true);const result={passed:true,checks,method:'Production SQL executed in PostgreSQL/PGlite with role/RLS and Auth fixtures; no hosted data changed'};fs.writeFileSync(path.join(__dirname,'employee-account-database-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));})().catch(e=>{console.error(e);fs.writeFileSync(path.join(__dirname,'employee-account-database-results.json'),JSON.stringify({passed:false,checks,error:e.message,code:e.code},null,2));process.exitCode=1;});
