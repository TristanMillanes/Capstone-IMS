import { createClient } from 'npm:@supabase/supabase-js@2';

const noStore = { 'Cache-Control': 'no-store' };

function serverKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      if (typeof parsed.default === 'string') return parsed.default;
    } catch { /* Use compatible secret variables below. */ }
  }
  return Deno.env.get('SUPABASE_SECRET_KEY')
    || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    || '';
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

function clean(value: unknown, max = 254): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function employeeName(employee: Record<string, unknown>): string {
  const parts = [employee.first_name, employee.middle_name, employee.last_name, employee.name_extension]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => String(value).trim());
  return parts.join(' ') || clean(employee.full_name, 180) || clean(employee.employee_id, 80);
}

async function hasActiveAdmin(db: ReturnType<typeof createClient>): Promise<boolean> {
  const { data, error } = await db.from('profiles')
    .select('user_id')
    .eq('role', 'Admin')
    .eq('status', 'Active')
    .eq('is_active', true)
    .limit(25);
  if (error) throw new Error('Could not verify the current Admin setup. Check the profiles table and database permissions.');

  for (const row of data || []) {
    const result = await db.auth.admin.getUserById(String(row.user_id));
    if (result.error) throw new Error('Could not verify an existing Admin account. Retry after checking Supabase Auth.');
    if (!result.data.user) continue;
    const bannedUntil = result.data.user.banned_until;
    if (!bannedUntil || new Date(bannedUntil).getTime() <= Date.now()) return true;
  }
  return false;
}

Deno.serve(async (req: Request) => {
  // CORS is not an authentication boundary. Authorization is enforced by the
  // private setup key (bootstrap), the employee password (login), or the
  // verified Admin bearer token (admin-users). Allow the browser app to call
  // this endpoint from localhost and the deployed site without a stale
  // PGENRO_ALLOWED_ORIGINS secret causing opaque browser 'Failed to fetch'.
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
  };
  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!['GET', 'POST'].includes(req.method)) return respond({ success: false, error: 'Use GET or POST.' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = serverKey();
    if (!url || !serviceKey) {
      return respond({ success: false, configured: false, available: false,
        error: 'The First Admin setup service is missing its server configuration.' }, 503);
    }
    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    if (req.method === 'GET') {
      const alreadyInitialized = await hasActiveAdmin(db);
      const configured = (Deno.env.get('PGENRO_FIRST_ADMIN_SETUP_KEY') || '').length >= 32;
      return respond({
        success: true,
        service: 'bootstrap-first-admin',
        configured,
        already_initialized: alreadyInitialized,
        available: configured && !alreadyInitialized,
      });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return respond({ success: false, error: 'Request body must be valid JSON.' }, 400); }

    const expectedKey = Deno.env.get('PGENRO_FIRST_ADMIN_SETUP_KEY') || '';
    const suppliedKey = clean(body.setup_key, 200);
    if (expectedKey.length < 32 || !constantTimeEqual(suppliedKey, expectedKey)) {
      return respond({ success: false, error: 'The secure setup key is invalid or the setup service is not configured.' }, 403);
    }

    const employeeNumber = clean(body.employee_number, 80);
    const email = clean(body.email, 254).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!employeeNumber || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || password.length < 8 || password.length > 128) {
      return respond({ success: false, error: 'Enter a valid Employee Number, directory email, and password of at least 8 characters.' }, 400);
    }

    if (await hasActiveAdmin(db)) {
      return respond({ success: false, already_initialized: true,
        error: 'The system already has an active Admin. First Admin setup is permanently closed.' }, 409);
    }

    // Verify the employee against the private directory. This RPC also rejects
    // employees already linked to another Auth account.
    const verified = await db.rpc('pgenro_registration_employee', {
      p_employee_number: employeeNumber,
      p_email: email,
      p_lock: true,
      p_exclude_user: null,
    });
    if (verified.error) {
      const missing = ['42883', 'PGRST202', 'PGRST204'].includes(verified.error.code || '')
        || /function.*does not exist|schema cache/i.test(verified.error.message || '');
      if (missing) return respond({ success: false,
        error: 'Employee Number setup is not installed. Run EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql first.' }, 503);
      return respond({ success: false,
        error: 'Employee Number and email could not be verified, or this employee already has an account. Check the Employee Directory.' }, 400);
    }

    const employee = verified.data as Record<string, unknown> | null;
    const canonicalNumber = clean(employee?.employee_id, 80);
    const employeeRecordId = clean(employee?.id, 80);
    const directoryEmail = clean(employee?.email, 254).toLowerCase();
    if (!employee || !canonicalNumber || !employeeRecordId || !directoryEmail || directoryEmail !== email) {
      return respond({ success: false, error: "The Employee Number, email, or employee record does not match the Employee Directory. Ask the system maintainer to verify the employee email on file." }, 400);
    }

    const fullName = employeeName(employee);
    const created = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        username: canonicalNumber,
        employee_number: canonicalNumber,
        requested_role: 'Admin',
        requested_system: 'Admin',
        registration_source: 'system-first-admin-v1',
      },
      app_metadata: {
        created_by_admin: true,
        pgenro_role: 'Admin',
        pgenro_status: 'Active',
        role: 'admin',
      },
    });
    if (created.error || !created.data.user) {
      console.error('First Admin Auth createUser failed:', created.error?.code || 'unknown', created.error?.message || 'no user returned');
      const duplicate = /already|registered|exists/i.test(created.error?.message || '');
      const triggerFailure = /database error creating new user|error running.*trigger|failed to run.*trigger/i.test(created.error?.message || '');
      return respond({ success: false,
        error: duplicate
          ? 'This email already has a Supabase Auth account. Do not create a duplicate. The existing account must be checked and securely linked.'
          : triggerFailure
            ? 'Supabase Auth rejected account creation in a database trigger. Confirm that the Employee Number SQL patch and the profile-creation trigger are installed, then check the Supabase Auth logs.'
            : 'Supabase could not create the initial Admin account. Check the Supabase Auth logs for the underlying database error.' }, duplicate ? 409 : 502);
    }

    const userId = created.data.user.id;
    const profile = await db.from('profiles').update({
      employee_record_id: employeeRecordId,
      full_name: fullName,
      email,
      username: canonicalNumber,
      contact: clean(employee.mobile, 80),
      position: clean(employee.designation, 180),
      division: clean(employee.department, 180),
    }).eq('user_id', userId).select('user_id').maybeSingle();

    if (profile.error || !profile.data) {
      const rollback = await db.auth.admin.deleteUser(userId);
      if (rollback.error) return respond({ success: false,
        error: 'Auth created the account, but the employee profile could not be linked and automatic rollback failed. Check Authentication > Users before retrying.' }, 500);
      return respond({ success: false,
        error: 'The employee profile could not be linked. The temporary Auth account was rolled back; check the database patch and try again.' }, 500);
    }

    const promoted = await db.rpc('pgenro_bootstrap_first_admin', {
      p_employee_number: canonicalNumber,
    });
    if (promoted.error) {
      const rollback = await db.auth.admin.deleteUser(userId);
      if (rollback.error) return respond({ success: false,
        error: 'The account was created but Admin activation failed and automatic rollback failed. Check Authentication > Users and the profiles table before retrying.' }, 500);
      const missing = ['42883', 'PGRST202', 'PGRST204'].includes(promoted.error.code || '')
        || /function.*does not exist|schema cache/i.test(promoted.error.message || '');
      return respond({ success: false,
        error: missing
          ? 'Run FIRST_ADMIN_SYSTEM_SETUP_PATCH.sql in Supabase SQL Editor, then try again.'
          : 'The first Admin could not be activated. The temporary account was rolled back. Check the Employee Number and database setup.' }, 500);
    }

    return respond({
      success: true,
      employee_number: canonicalNumber,
      full_name: fullName,
      message: 'The first PGENRO IMS Admin account has been created and activated. You can now sign in using your Employee Number and password.',
    });
  } catch (error) {
    console.error('First Admin setup failed:', error instanceof Error ? error.message : 'unknown_error');
    return respond({ success: false,
      error: error instanceof Error ? error.message : 'First Admin setup is temporarily unavailable.' }, 500);
  }
});
