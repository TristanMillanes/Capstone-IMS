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
    create table public.ics_records (
      id text primary key, data jsonb not null default '{}',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    grant all on public.ics_records to anon, authenticated;
    alter table public.ics_records enable row level security;
    create policy admin_access on public.ics_records to authenticated
      using (current_setting('request.jwt.claim.role',true) = 'Admin')
      with check (current_setting('request.jwt.claim.role',true) = 'Admin');
  `);
  const patch = fs.readFileSync(path.resolve(__dirname,'../../supabase/PUBLIC_ICS_FORM_PATCH.sql'),'utf8');
  await db.exec(patch);
  await db.exec(patch);
  return db;
}

const valid = () => ({
  controlNo: 'ICS-2026-1000', icsNo: 'ICS-1000', article: 'Office Equipment',
  itemDescription: 'Office laptop', quantity: 2, unitCost: 1234.56,
  accountablePerson: 'Juan Dela Cruz', dateAcquired: '2026-10-25',
  unit: 'unit', division: 'Administration'
});

async function asRole(db, role, action) {
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec('reset role'); }
}

async function submit(db, payload = valid(), id = randomUUID()) {
  return asRole(db,'anon',async () => {
    const result = await db.query('select public.submit_public_ics($1::jsonb,$2::uuid) as receipt',[JSON.stringify(payload),id]);
    return result.rows[0].receipt;
  });
}

async function main() {
  const db = await setupDatabase();
  try {
    const id = randomUUID();
    const payload = { ...valid(), status: 'Active', totalValue: 1, submissionSource: 'admin', reviewedBy: 'forged' };
    const receipt = await submit(db,payload,id);
    assert.deepEqual(Object.keys(receipt).sort(),['controlNo','icsNo','id','status']);
    assert.equal(receipt.status,'Pending');
    let result = await db.query('select data from public.ics_records where id=$1',[receipt.id]);
    const saved = result.rows[0].data;
    assert.equal(saved.status,'Pending');
    assert.equal(saved.submissionSource,'public');
    assert.equal(saved.totalValue,2469.12);
    assert.equal(saved.submittedBy,'Juan Dela Cruz');
    assert.equal(saved.submittedByUserId,null);
    assert.equal(saved.reviewedBy,undefined);
    assert.ok(saved.submittedAt);
    assert.deepEqual(await submit(db,payload,id),receipt);
    assert.equal((await db.query('select count(*)::int as count from public.ics_records')).rows[0].count,1);
    await assert.rejects(submit(db,{ ...valid(), accountablePerson:'Someone Else' },id),/already used/);

    for (const bad of [
      { ...valid(), controlNo:' ' }, { ...valid(), icsNo:'' },
      { ...valid(), quantity:0 }, { ...valid(), quantity:-1 },
      { ...valid(), unitCost:-5 }, { ...valid(), unitCost:'NaN' },
      { ...valid(), quantity:1000001 }, { ...valid(), unitCost:1000000001 },
      { ...valid(), quantity:1.111 }, { ...valid(), unitCost:null },
      { ...valid(), article:'a'.repeat(121) }, { ...valid(), remarks:'x'.repeat(1001) },
      { ...valid(), itemDescription:[] }, { ...valid(), dateAcquired:'2026-02-30' },
      { ...valid(), prDate:'yesterday' }, { ...valid(), accountCode:{} },
      { ...valid(), remarks:'x'.repeat(17000) }, [], null
    ]) await assert.rejects(submit(db,bad));

    for (const statement of [
      'select * from public.ics_records',
      `insert into public.ics_records(id,data) values('forged','{}')`,
      `update public.ics_records set data='{}'`,
      'delete from public.ics_records'
    ]) await assert.rejects(asRole(db,'anon',() => db.exec(statement)),/permission denied/);

    const userId = randomUUID();
    await db.query(`insert into public.profiles values($1,'Verified Staff','staff@example.com','User','Active',true)`,[userId]);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[userId]);
    const staffReceipt = await asRole(db,'authenticated',async () => {
      const response = await db.query('select public.submit_public_ics($1::jsonb,$2::uuid) as receipt',[JSON.stringify(valid()),randomUUID()]);
      return response.rows[0].receipt;
    });
    result = await db.query('select data from public.ics_records where id=$1',[staffReceipt.id]);
    assert.equal(result.rows[0].data.submittedBy,'Verified Staff');
    assert.equal(result.rows[0].data.submissionSource,'user');
    assert.equal(result.rows[0].data.status,'Pending');
    await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
    await db.exec(`select set_config('request.jwt.claim.role','User',false)`);
    await asRole(db,'authenticated',async () => {
      const update = await db.query(`update public.ics_records set data=data||'{"status":"Active"}' returning id`);
      assert.equal(update.rows.length,0);
    });
    await db.exec(`select set_config('request.jwt.claim.role','Admin',false)`);
    await asRole(db,'authenticated',async () => {
      const update = await db.query(`update public.ics_records set data=data||'{"status":"Active"}' where id=$1 returning data`,[receipt.id]);
      assert.equal(update.rows[0].data.status,'Active');
    });
    console.log('PASS: SQL installation/reinstallation, anonymous submission, validation, trusted metadata, retry deduplication, restricted CRUD, staff attribution, admin approval.');
  } finally { await db.close(); }
}

module.exports = { setupDatabase, valid, submit };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
