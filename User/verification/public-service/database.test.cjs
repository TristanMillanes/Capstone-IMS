const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

async function setupDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    create table public.profiles (
      user_id uuid primary key, full_name text, email text,
      role text, status text, is_active boolean
    );
    create table public.service_requests (
      id text primary key, data jsonb not null default '{}',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table public.ics_records (like public.service_requests including all);
    grant all on public.service_requests,public.ics_records to anon,authenticated;
    alter table public.service_requests enable row level security;
    alter table public.ics_records enable row level security;
    create policy admin_access on public.service_requests to authenticated
      using (current_setting('request.jwt.claim.role',true) = 'Admin')
      with check (current_setting('request.jwt.claim.role',true) = 'Admin');
    create function public.submit_public_ics(jsonb,uuid) returns jsonb language sql as 'select ''{}''::jsonb';
  `);
  const patch = fs.readFileSync(path.resolve(__dirname,'../../supabase/PUBLIC_SERVICE_REQUEST_PATCH.sql'),'utf8');
  await db.exec(patch);
  await db.exec(patch);
  return db;
}

const valid = () => ({
  clientName:'Juan Dela Cruz', organization:'Barangay Sample', contactNo:'09123456789',
  emailAddress:'juan@example.com', technicalAssistance:'Tree Growing',
  requestDetails:'Requesting 25 seedlings for our school.', location:'Lucena City'
});

async function asRole(db,role,action) {
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec('reset role'); }
}

async function submit(db,payload = valid(),id = randomUUID()) {
  return asRole(db,'anon',async () => {
    const result = await db.query('select public.submit_public_service_request($1::jsonb,$2::uuid) as receipt',[JSON.stringify(payload),id]);
    return result.rows[0].receipt;
  });
}

async function main() {
  const db = await setupDatabase();
  try {
    const id = randomUUID();
    const payload = { ...valid(), serviceNo:'FORGED', serviceStatus:'Completed / Closed', currentStep:5, pgdhAction:'Approved', dateRequest:'1999-01-01', submissionSource:'admin' };
    const receipt = await submit(db,payload,id);
    assert.deepEqual(Object.keys(receipt).sort(),['dateRequest','id','serviceNo','serviceStatus']);
    assert.equal(receipt.serviceStatus,'Pending Review');
    assert.match(receipt.serviceNo,/^SR-\d{4}-P\d{6,}$/);
    const result = await db.query('select data from public.service_requests where id=$1',[receipt.id]);
    const saved = result.rows[0].data;
    assert.equal(saved.serviceStatus,'Pending Review');
    assert.equal(saved.submissionSource,'public');
    assert.equal(saved.currentStep,1);
    assert.equal(saved.requestedBy,'Juan Dela Cruz');
    assert.equal(saved.primaryCategory,'Tree Growing');
    assert.equal(saved.pgdhAction,undefined);
    const today = (await db.query(`select (now() at time zone 'Asia/Manila')::date::text as today`)).rows[0].today;
    assert.equal(receipt.dateRequest,today);
    assert.deepEqual(await submit(db,payload,id),receipt);
    assert.equal((await db.query('select count(*)::int as count from public.service_requests')).rows[0].count,1);
    await assert.rejects(submit(db,{...valid(),clientName:'Someone Else'},id),/already used/);

    for (const bad of [
      {...valid(),clientName:' '}, {...valid(),organization:''}, {...valid(),requestDetails:''},
      {...valid(),location:''}, {...valid(),technicalAssistance:''}, {...valid(),technicalAssistance:'Unlisted service'},
      {...valid(),iecService:'FORGED'}, {...valid(),plantingMaterials:'FORGED'},
      {...valid(),certifications:'FORGED'}, {...valid(),environmentalConcerns:'FORGED'},
      {...valid(),requestDetails:'x'.repeat(4001)}, {...valid(),clientName:'x'.repeat(181)},
      {...valid(),organization:[]}, {...valid(),emailAddress:'invalid'},
      {...valid(),dateNeeded:'2026-02-30'}, {...valid(),dateNeeded:'2000-01-01'},
      {...valid(),dateNeeded:'tomorrow'}, {...valid(),location:{}},
      {...valid(),requestDetails:'x'.repeat(31000)}, [], null
    ]) await assert.rejects(submit(db,bad));

    for (const table of ['service_requests','ics_records']) {
      for (const statement of [
        `select * from public.${table}`,
        `insert into public.${table}(id,data) values('forged','{}')`,
        `update public.${table} set data='{}'`, `delete from public.${table}`
      ]) await assert.rejects(asRole(db,'anon',() => db.exec(statement)),/permission denied/);
    }
    await assert.rejects(asRole(db,'anon',() => db.query('select public.submit_ics($1::jsonb,$2::uuid)',[JSON.stringify({}),randomUUID()])),/permission denied/);
    assert.equal((await db.query(`select to_regprocedure('public.submit_public_ics(jsonb,uuid)') as fn`)).rows[0].fn,null);

    await db.exec(`select set_config('request.jwt.claim.role','User',false)`);
    await asRole(db,'authenticated',async () => {
      const update = await db.query(`update public.service_requests set data=data||'{"serviceStatus":"In Progress"}' returning id`);
      assert.equal(update.rows.length,0);
    });
    await db.exec(`select set_config('request.jwt.claim.role','Admin',false)`);
    await asRole(db,'authenticated',async () => {
      const update = await db.query(`update public.service_requests set data=data||'{"serviceStatus":"Assessed / Evaluated"}' where id=$1 returning data`,[receipt.id]);
      assert.equal(update.rows[0].data.serviceStatus,'Assessed / Evaluated');
    });

    const otherReceipt = await submit(db,{...valid(),technicalAssistance:'',otherServices:'Other assistance'});
    assert.equal((await db.query('select data from public.service_requests where id=$1',[otherReceipt.id])).rows[0].data.primaryCategory,'Other Services');
    await db.exec(`select setval('public.public_service_request_number_seq',1000000)`);
    const largerReceipt = await submit(db);
    assert.match(largerReceipt.serviceNo,/-P1000001$/);
    const userId = randomUUID();
    await db.query(`insert into public.profiles values($1,'Verified Staff','staff@example.com','User','Active',true)`,[userId]);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[userId]);
    const ics = {controlNo:'PRIVATE-ICS',icsNo:'ICS-PRIVATE',article:'Laptop',itemDescription:'Staff property',quantity:1,unitCost:100,accountablePerson:'Verified Staff'};
    const privateReceipt = await asRole(db,'authenticated',async () => {
      const response = await db.query('select public.submit_ics($1::jsonb,$2::uuid) as receipt',[JSON.stringify(ics),randomUUID()]);
      return response.rows[0].receipt;
    });
    assert.equal(privateReceipt.status,'Pending');
    assert.equal((await db.query('select data from public.ics_records where id=$1',[privateReceipt.id])).rows[0].data.submissionSource,'user');
    await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
    await assert.rejects(asRole(db,'authenticated',() => db.query('select public.submit_ics($1::jsonb,$2::uuid)',[JSON.stringify(ics),randomUUID()])),/active staff account/);
    console.log('PASS: service submission and numbering, validation, retry deduplication, metadata protection, anonymous CRUD denial, admin processing, authenticated ICS access, removal of public ICS endpoint.');
  } finally { await db.close(); }
}

module.exports = { setupDatabase,valid,submit };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
