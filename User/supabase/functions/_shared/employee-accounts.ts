import { createClient } from 'npm:@supabase/supabase-js@2';

export class AccountError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function employeeNumber(value: unknown): string {
  const number = typeof value === 'string' ? value.trim().replace(/@pgenro\.ims$/i, '') : '';
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(number) || number.endsWith('.') || number.includes('..')) {
    throw new AccountError(400, 'invalid_employee_id', 'Enter a valid employee ID.');
  }
  return number;
}
export function serviceClient() {
  let keys: Record<string, string> = {};
  try { keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); } catch { /* legacy keys */ }
  const key = keys.default || Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  if (!key || !url) throw new AccountError(503, 'employee_login_not_configured', 'The employee account service is not configured.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
export function publicHandler(action: (body: Record<string, unknown>, req: Request) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin') || '';
    const allowed = (Deno.env.get('PGENRO_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = { 'Access-Control-Allow-Origin': allowed.length ? (allowed.includes(origin) ? origin : allowed[0]) : '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (origin && allowed.length && !allowed.includes(origin)) return respond({ error: 'Website origin is not allowed.' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return respond({ error: 'Use POST.' }, 405);
    try {
      // Bound request size before parsing or forwarding any credentials.
      const raw = await req.text();
      if (raw.length > 8192) throw new AccountError(413, 'request_too_large', 'Request is too large.');
      let body;
      try { body = JSON.parse(raw); } catch { throw new AccountError(400, 'invalid_request', 'Send a JSON object.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AccountError(400, 'invalid_request', 'Send a JSON object.');
      return respond(await action(body, req));
    } catch (error) {
      if (error instanceof AccountError) return respond({ code: error.code, error: error.message }, error.status);
      // Never log passwords, tokens, account emails or request bodies.
      return respond({ code: 'account_service_error', error: 'The employee account service is unavailable. Try again.' }, 503);
    }
  };
}
