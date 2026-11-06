import { createClient } from 'npm:@supabase/supabase-js@2';

const noStore = { 'Cache-Control': 'no-store' };

function serverKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      if (typeof parsed.default === 'string') return parsed.default;
    } catch { /* Use the compatible secret variables below. */ }
  }
  return Deno.env.get('SUPABASE_SECRET_KEY')
    || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    || '';
}

function publishableKey(): string {
  // Current Supabase projects expose a JSON map named SUPABASE_PUBLISHABLE_KEYS.
  // Older projects may still expose SUPABASE_ANON_KEY or the singular variable.
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      if (typeof parsed.default === 'string') return parsed.default;
      const first = Object.values(parsed).find(value => typeof value === 'string');
      if (typeof first === 'string') return first;
    } catch { /* Use compatible variables below. */ }
  }
  return Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    || Deno.env.get('SUPABASE_ANON_KEY')
    || '';
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
  if (req.method === 'GET') return respond({ success: true, service: 'employee-login' });
  if (req.method !== 'POST') return respond({ success: false, error: 'Use POST.' }, 405);

  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return respond({ success: false, error: 'Request body must be valid JSON.' }, 400); }

    const employeeNumber = typeof body.employee_number === 'string'
      ? body.employee_number.trim()
      : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!employeeNumber || employeeNumber.length > 80 || !password || password.length > 256) {
      return respond({
        success: false,
        code: 'invalid_credentials',
        error: 'Enter a valid employee number and password.',
      }, 401);
    }

    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = serverKey();
    const publicKey = publishableKey();
    if (!url || !serviceKey || !publicKey) {
      return respond({
        success: false,
        code: 'employee_login_not_configured',
        error: 'Employee-number sign-in is not configured in Supabase.',
      }, 503);
    }

    // Only the server-side service client can resolve an employee number to
    // the private Auth email. The browser receives only the resulting session.
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const lookup = await admin.rpc('pgenro_employee_login_lookup', {
      p_employee_number: employeeNumber,
    });
    if (lookup.error) {
      const missing = ['42883', 'PGRST202', 'PGRST204'].includes(lookup.error.code || '')
        || /function.*does not exist|schema cache/i.test(lookup.error.message || '');
      if (missing) {
        return respond({
          success: false,
          code: 'employee_login_not_configured',
          error: 'Run EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql in this Supabase project.',
        }, 503);
      }
      console.error('Employee login lookup failed:', lookup.error.code || 'database_error');
      return respond({ success: false, error: 'Employee-number sign-in is temporarily unavailable.' }, 503);
    }

    const matches = Array.isArray(lookup.data)
      ? lookup.data
      : lookup.data ? [lookup.data] : [];
    if (matches.length !== 1 || !matches[0]?.email) {
      return respond({
        success: false,
        code: 'invalid_credentials',
        error: 'The employee number or password is incorrect.',
      }, 401);
    }

    // Do not issue an Auth session to a Pending, Inactive, or Suspended account.
    // The profile status is returned only as a safe status label, never an email.
    const normalizedStatus = String(matches[0].status || '').trim().toLowerCase();
    if (!['active', 'approved'].includes(normalizedStatus) || matches[0].is_active !== true) {
      const accountStatus = String(matches[0].status || 'Inactive');
      return respond({
        success: false,
        code: 'account_not_active',
        account_status: accountStatus,
        error: accountStatus.toLowerCase() === 'pending'
          ? 'Your account is waiting for administrator approval.'
          : accountStatus.toLowerCase() === 'suspended'
            ? 'Your account is suspended. Contact the system administrator.'
            : 'Your account is inactive. Contact the system administrator.',
      }, 403);
    }

    // Password verification is still performed by Supabase Auth. The service
    // key is never used to create a session or returned to the browser.
    const auth = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const signedIn = await auth.auth.signInWithPassword({
      email: matches[0].email,
      password,
    });

    if (signedIn.error || !signedIn.data.session) {
      const code = signedIn.error?.code || signedIn.error?.name || '';
      if (code === 'email_not_confirmed') {
        return respond({
          success: false,
          code: 'email_not_confirmed',
          error: 'Confirm your registered email before signing in.',
        }, 403);
      }
      return respond({
        success: false,
        code: 'invalid_credentials',
        error: 'The employee number or password is incorrect.',
      }, 401);
    }

    return respond({
      success: true,
      access_token: signedIn.data.session.access_token,
      refresh_token: signedIn.data.session.refresh_token,
      user: { id: signedIn.data.user.id },
    });
  } catch (error) {
    console.error('Employee login request failed:', error instanceof Error ? error.message : 'unknown_error');
    return respond({ success: false, error: 'Employee-number sign-in is temporarily unavailable.' }, 500);
  }
});
