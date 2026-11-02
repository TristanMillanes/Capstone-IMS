// Meaningful authorization regression checks. No hosted project is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const {PGlite} = require('@electric-sql/pglite');
const root = path.resolve(__dirname,'../..');
const ids = {admin:'11111111-1111-4111-8111-111111111111',second:'22222222-2222-4222-8222-222222222222',user:'33333333-3333-4333-8333-333333333333',pending:'44444444-4444-4444-8444-444444444444',new:'55555555-5555-4555-8555-555555555555'};
let checks=0;
function pass(label){checks++;console.log('PASS',label);}
async function denied(db,sql,code='42501'){
  await assert.rejects(()=>db.query(sql),e=>e.code===code);
}
async function sqlTests(){
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key,email varchar(254),
        raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',
        banned_until timestamptz,last_sign_in_at timestamptz,created_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon;
      create publication supabase_realtime;
      insert into auth.users(id,email,raw_user_meta_data) values
        ('${ids.admin}','admin@example.test','{}'),('${ids.second}','second@example.test','{}'),
        ('${ids.user}','user@example.test','{"role":"Super Admin","status":"Active"}');
      create table public.profiles(user_id uuid primary key references auth.users(id) on delete cascade,
        full_name varchar(200),role varchar(50) default 'Staff',is_active boolean default true,
        status varchar(20) default 'Active',email varchar(254),username varchar(60),contact varchar(40),
        position varchar(200),division varchar(200),account_type varchar(40) default 'Standard User',
        last_login timestamp,created_at timestamp default now(),updated_at timestamp default now());
      insert into public.profiles(user_id,full_name,role) values
        ('${ids.admin}','Admin One','System Administrator'),('${ids.second}','Admin Two','Super Admin'),
        ('${ids.user}','Ordinary User','Division Head');`);
    // pgcrypto is provided by Supabase. PG18 has the UUID function used here;
    // the extension-install command is the only omitted production statement.
    const full=fs.readFileSync(path.join(root,'supabase/COMPLETE_SETUP.sql'),'utf8').replace('create extension if not exists pgcrypto;','');
    const patch=fs.readFileSync(path.join(root,'supabase/ADMIN_USER_ACCESS_PATCH.sql'),'utf8');
    await db.exec(full);await db.exec(patch);await db.exec(full);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.admin]);
    assert.equal((await db.query('select pgenro_get_module_notifications() as feed')).rows[0].feed.total,0);
    await db.exec(fs.readFileSync(path.join(__dirname,'legacy-directory-rpc.sql'),'utf8'));
    await denied(db,'select * from pgenro_admin_list_users()','42804');
    await db.exec(fs.readFileSync(path.join(root,'supabase/ADMIN_USER_DIRECTORY_RPC_FIX.sql'),'utf8'));
    assert.equal((await db.query('select * from pgenro_admin_list_users()')).rows.length,3);
    pass('Reproduced the screenshot SQL error on legacy varchar/timestamp columns; focused repair returns the directory correctly');
    assert.deepEqual((await db.query('select role from profiles order by user_id')).rows.map(r=>r.role),['Admin','Admin','User']);
    pass('Full setup and migration rerun safely; legacy administrator roles become Admin and other roles become User');
    async function identity(id,role='authenticated'){
      await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+role);
    }
    await identity(ids.user);
    assert.equal((await db.query('select pgenro_is_admin() as allowed')).rows[0].allowed,false);
    assert.deepEqual((await db.query('select user_id from profiles')).rows.map(r=>r.user_id),[ids.user]);
    await denied(db,'select * from pgenro_admin_list_users()');await denied(db,'select pgenro_admin_pending_count()');
    await denied(db,"update profiles set role='Admin' where user_id=auth.uid()");
    await denied(db,"select promote_pgenro_first_admin('user@example.test')");
    pass('User cannot list accounts, count requests, edit roles or invoke the SQL-only Admin bootstrap');
    await db.query("select update_my_profile('Renamed User','user_qa','123','Division Head','Forestry')");
    assert.equal((await db.query('select role from profiles')).rows[0].role,'User');
    await db.query(`select update_my_preferences('{"theme":"dark","role":"Admin"}')`);
    assert.equal((await db.query('select pgenro_is_admin() as allowed')).rows[0].allowed,false);
    pass('Self-service Settings changes preserve User authorization, including forged preference role labels');
    await identity(ids.admin);
    assert.equal((await db.query('select pgenro_is_admin() as allowed')).rows[0].allowed,true);
    assert.equal((await db.query('select * from pgenro_admin_list_users()')).rows.length,3);
    assert.equal((await db.query('select * from pgenro_admin_list_users(-1,0)')).rows.length,1);
    await denied(db,"update profiles set role='User' where user_id=auth.uid()");
    await db.query("insert into communications(id,data) values('qa-access','{\"subject\":\"Original\"}')");
    pass('Active Admin can list and paginate accounts and encode operational records; profile mutations require the account service');
    await identity(ids.user);
    assert.equal((await db.query("select id from communications where id='qa-access'")).rows.length,1);
    await denied(db,"insert into communications(id,data) values('user-write','{}')");
    assert.equal((await db.query("update communications set data='{}' where id='qa-access' returning id")).rows.length,0);
    assert.equal((await db.query("delete from communications where id='qa-access' returning id")).rows.length,0);
    pass('User can read operational records but cannot create, update or delete them');
    await identity(ids.admin);await db.exec('reset role');
    await db.query(`update auth.users set banned_until=now()+interval '1 day' where id='${ids.admin}'`);
    await identity(ids.admin);
    assert.equal((await db.query('select pgenro_is_admin() as allowed')).rows[0].allowed,false);
    await denied(db,'select * from pgenro_admin_list_users()');
    assert.equal((await db.query('select id from communications')).rows.length,0);
    pass('A banned Admin loses directory and operational access even with a stale authenticated session');
    await db.exec('reset role');await db.query(`update auth.users set banned_until=null where id='${ids.admin}'`);
    await db.query(`update profiles set role='User',account_type='Standard User' where user_id='${ids.admin}'`);
    await denied(db,`update profiles set is_active=false,status='Inactive' where user_id='${ids.second}'`,'23514');
    await denied(db,`delete from auth.users where id='${ids.second}'`,'23514');
    await db.query(`update profiles set role='Admin',account_type='Administrator' where user_id='${ids.admin}'`);
    pass('Final active Admin cannot be disabled or deleted through Auth cascading');
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values('${ids.pending}','pending@example.test',
      '{"role":"Admin","requested_role":"Admin","status":"Active","request_id":"REQ-USER-REF","full_name":"Applicant","username":"applicant"}')`);
    const pending=(await db.query('select role,status,is_active from profiles where user_id=$1',[ids.pending])).rows[0];
    assert.deepEqual(pending,{role:'User',status:'Pending',is_active:false});
    const request=(await db.query("select data from access_requests where data->>'uid'=$1",[ids.pending])).rows[0].data;
    assert.equal(request.refCode,'REQ-USER-REF');assert.equal(request.requestedRole,'Admin');assert.equal(request.assignedRole,null);
    await identity(ids.admin);assert.equal((await db.query('select pgenro_admin_pending_count() as n')).rows[0].n,1);
    await identity(ids.pending);assert.equal((await db.query('select is_pgenro_active_user() as allowed')).rows[0].allowed,false);
    await denied(db,'select pgenro_get_module_notifications()');
    pass('An Admin request retains the requested role and reference while its profile stays an inactive Pending User without workspace access');
    await identity('','anon');await denied(db,'select pgenro_is_admin()');await denied(db,'select * from profiles');
    pass('Anonymous callers cannot read personnel profiles or call Admin authorization RPCs');
    await db.exec('reset role');
    await db.query("select promote_pgenro_first_admin('pending@example.test')");
    assert.equal((await db.query('select role from profiles where user_id=$1',[ids.pending])).rows[0].role,'Admin');
    pass('SQL Editor bootstrap enables only the selected existing Auth account as Admin');
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values('${ids.new}','legacy@example.test',
      '{"requested_role":"User","requested_system":"Admin","full_name":"Legacy Applicant"}')`);
    await db.query("update access_requests set data=(data-'assignedRole')||'{\"role\":\"User\",\"requestedRole\":\"User\"}' where data->>'uid'=$1",[ids.new]);
    const focus=fs.readFileSync(path.join(root,'supabase/REGISTRATION_APPROVAL_ROLE_PATCH.sql'),'utf8');
    await db.exec(focus);await db.exec(focus);
    const recovered=(await db.query("select data from access_requests where data->>'uid'=$1",[ids.new])).rows[0].data;
    assert.equal(recovered.requestedRole,'Admin');assert.equal(recovered.assignedRole,null);
    assert.equal((await db.query('select role from profiles where user_id=$1',[ids.new])).rows[0].role,'User');
    pass('Focused role migration recovers legacy requested Admin choices and reruns without granting pending access');

    await identity(ids.admin);await db.query('select pgenro_mark_notifications_read()');
    await identity(ids.user);await db.query('select pgenro_mark_notifications_read()');
    await identity(ids.admin);
    await db.query("insert into communications(id,data) values('notif-doc','{\"subject\":\"Notification Test\"}')");
    await db.query("insert into office_memos(id,data) values('notif-memo','{\"subject\":\"New Office Memo\"}')");
    await db.query("insert into travel_orders(tor_no,traveler_name,destination,departure_date,return_date) values('NOTIF-TOR','Personnel Trip','Lucena','2026-10-10','2026-10-11')");
    await db.query("insert into service_requests(id,data) values('notif-service','{\"requesterName\":\"Office Service\"}')");
    await db.query("insert into ics_records(id,data) values('notif-ics','{\"accountablePerson\":\"Property Custodian\"}')");
    await db.query("insert into inventory(control_no,item_name,unit,quantity) values('NOTIF-INV','New Supply','REAM',10)");
    await db.query("insert into employees(employee_id,first_name,last_name,designation,department) values('NOTIF-EMP','New','Personnel','Staff','Administration')");
    await db.query("insert into visitors(id,full_name,contact,address,person_to_visit,purpose_category) values('notif-visitor','New Visitor','09123456789','Lucena','Officer','Meeting')");
    let feed=(await db.query('select pgenro_get_module_notifications() as feed')).rows[0].feed;
    assert.equal(feed.total,8);assert.equal(Object.keys(feed.counts).length,8);
    assert.equal(feed.items.find(n=>n.module==='visitors').title,'New Visitor');
    await db.query("update communications set data='{\"subject\":\"Updated title\"}' where id='notif-doc'");
    assert.equal((await db.query('select pgenro_get_module_notifications() as feed')).rows[0].feed.total,8);
    pass('Every operational module emits one new-record notification; updates do not create duplicates and normalized visitors retain their title');
    await db.exec('reset role');
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values('66666666-6666-4666-8666-666666666666','notif-applicant@example.test','{\"requested_role\":\"Admin\",\"full_name\":\"New Applicant\"}')");
    await identity(ids.admin);feed=(await db.query('select pgenro_get_module_notifications() as feed')).rows[0].feed;
    assert.equal(feed.total,10);assert.equal(feed.counts.user_accounts,1);assert.equal(feed.counts.account_requests,1);
    const privateId=feed.items.find(n=>n.module==='account_requests').id;
    await identity(ids.user);feed=(await db.query('select pgenro_get_module_notifications() as feed')).rows[0].feed;
    assert.equal(feed.total,8);assert.equal(feed.workspace,'user');assert.equal(feed.counts.account_requests,undefined);
    assert.equal((await db.query('select pgenro_mark_notifications_read(array[$1]::uuid[]) as n',[privateId])).rows[0].n,0);
    await denied(db,`insert into pgenro_module_notifications(module_key,record_id,title) values('communications','forged','Fake alert')`);
    const publicId=feed.items[0].id;
    await denied(db,`insert into pgenro_notification_reads(user_id,notification_id) values('${ids.admin}','${publicId}')`);
    await db.query('select pgenro_mark_notifications_read(array[$1]::uuid[])',[publicId]);
    assert.equal((await db.query('select pgenro_get_module_notifications() as feed')).rows[0].feed.total,7);
    await identity(ids.admin);assert.equal((await db.query('select pgenro_get_module_notifications() as feed')).rows[0].feed.total,10);
    pass('Admin-only account notifications stay private; read state belongs to each account and clients cannot forge events or other users’ receipts');
    await db.query("select pgenro_mark_notifications_read(null,'communications')");
    assert.equal((await db.query('select pgenro_get_module_notifications() as feed')).rows[0].feed.counts.communications,undefined);
    await db.query('select pgenro_mark_notifications_read()');
    assert.equal((await db.query('select pgenro_get_module_notifications() as feed')).rows[0].feed.total,0);
    await db.query("insert into communications(id,data) values('notif-later','{\"subject\":\"Added after marking read\"}')");
    assert.equal((await db.query('select pgenro_get_module_notifications() as feed')).rows[0].feed.total,1);
    await identity(ids.user);assert.equal((await db.query('select pgenro_get_module_notifications() as feed')).rows[0].feed.total,8);
    await identity('','anon');await denied(db,'select pgenro_get_module_notifications()');await denied(db,'select * from pgenro_module_notifications');
    await db.exec('reset role');await db.query(`update auth.users set banned_until=now()+interval '1 day' where id='${ids.admin}'`);
    await identity(ids.admin);await denied(db,'select pgenro_get_module_notifications()');await denied(db,'select pgenro_mark_notifications_read()');
    pass('Module/all read actions persist without hiding later inserts; anonymous, pending and banned sessions cannot read or mark notifications');
  }finally{await db.close();}
}
function edgeHarness(options={}){
  let handler;let version=0;const calls={mutations:0,authUpdates:[],created:null,deleted:[]};
  const profiles=[{user_id:ids.admin,email:'admin@example.test',full_name:'Admin',username:'admin',role:options.role||'Admin',status:options.status||'Active',is_active:options.active!==false,account_type:'Administrator',updated_at:'v0'},
    {user_id:ids.user,email:'user@example.test',full_name:'User',username:'user',role:'User',status:'Active',is_active:true,account_type:'Standard User',updated_at:'v0'},
    {user_id:ids.pending,email:'pending@example.test',full_name:'Applicant',username:'applicant',division:'Forestry',role:'User',status:'Pending',is_active:false,account_type:'Standard User',updated_at:'v0'}];
  const tables={profiles,users:[],admins:[],admin_logs:[],access_requests:[{id:'request-1',data:{uid:ids.pending,email:'pending@example.test',status:'Pending',role:options.requestedRole||'User',requestedRole:options.requestedRole||'User',assignedRole:null}}]};
  if(options.noProfile)profiles.shift();
  const authUsers=new Map(profiles.map(p=>[p.user_id,{id:p.user_id,email:p.email,app_metadata:{},user_metadata:{},banned_until:p.user_id===ids.admin&&options.banned?'2999-01-01':null}]));
  if(options.noProfile)authUsers.set(ids.admin,{id:ids.admin,email:'admin@example.test'});
  const db={auth:{
    getUser:async token=>({data:{user:token==='verified-token'?authUsers.get(ids.admin):null},error:token==='verified-token'?null:{code:'invalid_token'}}),
    admin:{getUserById:async id=>({data:{user:authUsers.get(id)||null},error:null}),
      createUser:async input=>{calls.created=input;calls.mutations++;const user={id:ids.new,email:input.email,app_metadata:input.app_metadata,user_metadata:input.user_metadata};authUsers.set(ids.new,user);
        profiles.push({user_id:ids.new,email:input.email,role:'User',status:'Pending',is_active:false,updated_at:'v0'});
        tables.access_requests.push({id:'direct-new',data:{uid:ids.new,status:'Pending'}});return {data:{user},error:null};},
      updateUserById:async(id,input)=>{calls.authUpdates.push({id,input});if(options.authFailure)return {data:{user:null},error:{status:422,message:'Auth rejected change'}};
        const user=authUsers.get(id);Object.assign(user,input);return {data:{user},error:null};},
      deleteUser:async id=>{calls.deleted.push(id);calls.mutations++;authUsers.delete(id);tables.profiles=tables.profiles.filter(p=>p.user_id!==id);return {error:null};}}
  },from(table){
    let op='select',payload,filters=[],max=Infinity;
    const query={select(){return query;},order(){return query;},eq(k,v){filters.push(r=>r[k]===v);return query;},
      ilike(k,v){const exact=v.replace(/\\([_%\\])/g,'$1').toLowerCase();filters.push(r=>String(r[k]||'').toLowerCase()===exact);return query;},
      contains(k,v){filters.push(r=>Object.entries(v).every(([a,b])=>r[k]?.[a]===b));return query;},limit(n){max=n;return query;},
      insert(data){op='insert';payload=data;return query;},upsert(data){op='upsert';payload=data;return query;},
      update(data){op='update';payload=data;return query;},delete(){op='delete';return query;},
      result(single=false){
        const rows=tables[table]||[];
        if(options.profileFailure&&table==='profiles'&&op==='upsert')return {data:null,error:{code:'23505'}};
        if(options.stale&&table==='profiles'&&op==='update')return {data:null,error:null};
        let found=rows.filter(r=>filters.every(f=>f(r))).slice(0,max);
        if(op!=='select'){
          calls.mutations++;
          if(op==='insert'){rows.push(payload);found=[payload];}
          if(op==='upsert'){const field=table==='profiles'?'user_id':'id';let row=rows.find(r=>r[field]===payload[field]);if(!row){row={};rows.push(row);}Object.assign(row,payload);if(table==='profiles')row.updated_at='v'+(++version);found=[row];}
          if(op==='update'){for(const row of found){Object.assign(row,payload);if(table==='profiles')row.updated_at='v'+(++version);}}
          if(op==='delete')tables[table]=rows.filter(r=>!found.includes(r));
        }
        return {data:single?(found[0]?structuredClone(found[0]):null):structuredClone(found),error:null};
      },single(){return Promise.resolve(query.result(true));},maybeSingle(){return Promise.resolve(query.result(true));},
      then(resolve,reject){return Promise.resolve(query.result()).then(resolve,reject);}};
    return query;
  }};
  let source=fs.readFileSync(path.join(root,'supabase/functions/admin-users/index.ts'),'utf8').replace(/^import[^\n]+\n/,'');
  source=stripTypeScriptTypes(source,{mode:'transform'});
  vm.runInNewContext(source,{createClient:()=>db,Deno:{env:{get:name=>({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-server-key'})[name]},serve:h=>handler=h},Response,Request,console,Date,JSON,Set,crypto});
  return {tables,calls,async request(body,token='verified-token'){
    const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;
    const res=await handler(new Request('https://test.invalid/admin-users',{method:'POST',headers,body:JSON.stringify(body)}));
    return {status:res.status,body:await res.json()};
  }};
}
async function edgeTests(){
  const user={fullName:'New Account',username:'new_account',email:'new@example.test',division:'Forestry',role:'User',status:'Active',position:'Staff',contact:'',password:'TestPassword123!'};
  for(const options of [{role:'User'},{role:'Super Admin'},{status:'Suspended'},{active:false},{banned:true},{noProfile:true}]){
    const h=edgeHarness(options),r=await h.request({action:'create',user});assert.equal(r.status,403);assert.equal(h.calls.mutations,0);
  }
  let h=edgeHarness(),r=await h.request({action:'create',user},'invalid');assert.equal(r.status,401);
  r=await h.request({action:'create',user},null);assert.equal(r.status,401);
  pass('Account service validates Auth and denies User, disabled/banned Admin, missing profile and old Super Admin role');
  for(const role of ['Admin','User']){
    h=edgeHarness();r=await h.request({action:'create',user:{...user,role}});
    assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(r.body.success,true);assert.equal(r.body.user.role,role);assert.equal(r.body.user.is_active,true);
    assert.equal(h.calls.created.app_metadata.pgenro_role,role);assert.equal(h.tables.access_requests.find(x=>x.id==='direct-new').data.status,'Approved');
  }
  pass('Admin creates either Admin or User; Auth/profile roles, legacy registries and direct-create requests agree');
  for(const role of ['Super Admin','Division Head','Staff','Owner']){
    h=edgeHarness();r=await h.request({action:'create',user:{...user,role}});assert.equal(r.status,400);assert.equal(h.calls.mutations,0);
  }
  pass('Account service rejects unsupported role values before mutation');
  for(const action of ['delete','set_status','update']){
    h=edgeHarness();r=await h.request({action,userId:ids.admin,status:'Suspended',user});assert.equal(r.status,409);assert.equal(h.calls.mutations,0);assert.equal(h.calls.authUpdates.length,0);
  }
  pass('Self-deletion, self-suspension and self-demotion are rejected before Auth changes');
  h=edgeHarness();r=await h.request({action:'update',userId:ids.user,user:{...user,username:'user',email:'user@example.test',role:'Admin',password:undefined}});
  assert.equal(r.status,200);assert.equal(r.body.user.role,'Admin');assert.equal(r.body.user.account_type,'Administrator');
  h=edgeHarness();r=await h.request({action:'set_status',userId:ids.user,status:'Suspended'});
  assert.equal(r.status,200);assert.equal(r.body.user.is_active,false);assert.equal(h.calls.authUpdates[0].input.ban_duration,'876000h');
  pass('Admin can promote another User and suspend access in both profiles and Auth');
  h=edgeHarness({stale:true});r=await h.request({action:'set_status',userId:ids.user,status:'Inactive'});
  assert.equal(r.status,409);assert.equal(h.calls.authUpdates.length,0);
  h=edgeHarness({authFailure:true});r=await h.request({action:'set_status',userId:ids.user,status:'Suspended'});
  assert.equal(r.status,422);assert.equal(h.tables.profiles.find(p=>p.user_id===ids.user).status,'Active');assert.equal(h.tables.profiles.find(p=>p.user_id===ids.user).is_active,true);
  h=edgeHarness({profileFailure:true});r=await h.request({action:'create',user});assert.equal(r.status,409);assert.deepEqual(h.calls.deleted,[ids.new]);
  pass('Concurrent edits return conflict; Auth rejection restores profile access; failed creation rolls back only the new Auth user');
  h=edgeHarness();r=await h.request({action:'approve_request',requestId:'request-1',userId:ids.user,role:'Admin'});assert.equal(r.status,400);assert.equal(h.calls.mutations,0);
  for(const requestedRole of ['Admin','User'])for(const role of ['Admin','User']){
    h=edgeHarness({requestedRole});r=await h.request({action:'approve_request',requestId:'request-1',role});
    assert.equal(r.status,200);assert.equal(r.body.user.role,role);assert.equal(r.body.user.status,'Active');assert.equal(r.body.request.status,'Approved');
    assert.equal(r.body.request.requestedRole,requestedRole);assert.equal(r.body.request.assignedRole,role);
    assert.equal(h.calls.authUpdates[0].input.app_metadata.pgenro_role,role);assert.ok(r.body.request.approvedAt);
    assert.equal(h.tables.access_requests[0].data.requestedRole,requestedRole);assert.equal(h.tables.access_requests[0].data.assignedRole,role);
  }
  h=edgeHarness();r=await h.request({action:'approve_request',requestId:'request-1'});assert.equal(r.status,400);assert.equal(h.calls.mutations,0);
  h=edgeHarness({requestedRole:'Admin'});r=await h.request({action:'reject_request',requestId:'request-1',reason:'Unverified',remarks:'Needs endorsement'});
  assert.equal(r.status,200);assert.equal(r.body.user.status,'Rejected');assert.equal(r.body.user.is_active,false);assert.equal(r.body.request.declineReason,'Unverified');
  assert.equal(r.body.request.requestedRole,'Admin');assert.equal(r.body.request.assignedRole,null);
  pass('Admin can approve either requested role as Admin or User; final access and original request stay distinct, and explicit role choice is required');
}
(async()=>{await sqlTests();await edgeTests();console.log(JSON.stringify({result:'PASS',scenario_groups:checks,hosted_changes:false}));})().catch(e=>{console.error(JSON.stringify({result:'FAIL',message:e.message,code:e.code,stack:e.stack?.split('\n').slice(0,4)}));process.exitCode=1;});
