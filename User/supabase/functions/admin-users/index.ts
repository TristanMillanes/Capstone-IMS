import { createClient } from 'npm:@supabase/supabase-js@2';
// Account mutations run on the server with a verified caller and profile role.
// SUPABASE_SERVICE_ROLE_KEY is built in; new SUPABASE_SECRET_KEYS is also supported.
const TABLE = 'profiles';
const allowedRoles = new Set(['Admin', 'User']);
const allowedStatuses = new Set(['Active', 'Inactive', 'Suspended']);
type ProfileInput = {
  fullName: string; username: string; email: string; division: string;
  role: string; status: string; position: string; contact: string; password?: string;
};
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function text(value: unknown, label: string, max = 200, required = false): string {
  if (typeof value !== 'string') {
    if (required || value != null) throw new HttpError(400, `${label} must be text.`);
    return '';
  }
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > max) throw new HttpError(400, `${label} is missing or too long.`);
  return normalized;
}
function validateUser(raw: unknown, creating: boolean): ProfileInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'User details are required.');
  const u = raw as Record<string, unknown>;
  const result: ProfileInput = {
    fullName: text(u.fullName, 'Full name', 200, true),
    username: text(u.username, 'Username', 60, true),
    email: text(u.email, 'Email', 254, true).toLowerCase(),
    division: text(u.division, 'Division', 200, true),
    role: text(u.role, 'Role', 30, true), status: text(u.status, 'Status', 20, true),
    position: text(u.position, 'Position'), contact: text(u.contact, 'Contact', 40),
  };
  if (!/^[a-zA-Z0-9_.-]{1,60}$/.test(result.username)) throw new HttpError(400, 'Username must contain letters, numbers, dots, underscores or hyphens.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new HttpError(400, 'Enter a valid email address.');
  // Accept only the two canonical access roles from the Admin review form.
  if (!allowedRoles.has(result.role) || !allowedStatuses.has(result.status)) throw new HttpError(400, 'Invalid role or status.');
  if (u.password !== undefined && typeof u.password !== 'string') throw new HttpError(400, 'Password must be text.');
  const password = u.password as string | undefined;
  if ((creating || password) && (!password || password.length < 8 || password.length > 256)) {
    throw new HttpError(400, 'Password must contain 8–256 characters.');
  }
  if (password) result.password = password;
  return result;
}
function directoryFields(u: ProfileInput) {
  return { full_name: u.fullName, username: u.username, email: u.email, division: u.division,
    role: u.role, status: u.status, is_active: u.status === 'Active',
    account_type: u.role === 'Admin' ? 'Administrator' : 'Standard User', position: u.position, contact: u.contact,
    updated_at: new Date().toISOString() };
}
function displayMetadata(u: ProfileInput) {
  return { full_name: u.fullName, fullName: u.fullName, name: u.fullName, username: u.username,
    division: u.division, position: u.position, contact: u.contact };
}
function accessMetadata(role: string, status: string) {
  return { pgenro_role: role, pgenro_status: status,
    role: role === 'Admin' ? 'admin' : 'user' };
}
function requestedAccessRole(data: Record<string, any>): string {
  const candidate = data.requestedRole || data.requested_role || data.requested_system || data.role;
  return String(candidate || 'User').trim().toLowerCase() === 'admin' ? 'Admin' : 'User';
}
function serverKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try { const parsed = JSON.parse(keys); if (typeof parsed.default === 'string') return parsed.default; } catch { /* legacy fallback */ }
  }
  return Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}
function databaseError(error: { code?: string; message?: string }): HttpError {
  if (error.code === '23505') return new HttpError(409, 'Email or username already exists. Refresh the directory before retrying.');
  if (error.code === '23514') return new HttpError(409, error.message || 'Keep at least one active Admin.');
  if (['42P01', '42703', 'PGRST205'].includes(error.code || '')) return new HttpError(503, 'Run ADMIN_USER_ACCESS_PATCH.sql in this Supabase project first.');
  console.error('User directory database error:', error.code || 'unknown');
  return new HttpError(500, 'The account profile could not be saved. Refresh and retry.');
}
function authError(error: { code?: string; status?: number; message?: string }): HttpError {
  if (['email_exists', 'user_already_exists', 'email_address_not_authorized'].includes(error.code || '')) {
    return new HttpError(409, 'This email is already registered or cannot be used. Check Authentication > Users.');
  }
  if (error.status === 404 || error.code === 'user_not_found') return new HttpError(404, 'This Auth user no longer exists. Refresh the directory.');
  return new HttpError(error.status && error.status >= 400 && error.status < 500 ? error.status : 502,
    error.message || 'Supabase Auth could not complete this account change.');
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const configuredOrigins = (Deno.env.get('PGENRO_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowedOrigin = configuredOrigins.length ? configuredOrigins.includes(origin) : true;
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': configuredOrigins.length ? (allowedOrigin ? origin : configuredOrigins[0]) : '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify({ ok: (body as Record<string, unknown>)?.success === true, ...(body as Record<string, unknown>) }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
  if (origin && !allowedOrigin) return respond({ success: false, error: 'This website origin is not allowed.' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return respond({ success: false, error: 'Use POST.' }, 405);
  try {
    const authorization = req.headers.get('authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) throw new HttpError(401, 'Sign in with an active Admin account.');
    const url = Deno.env.get('SUPABASE_URL') || '';
    const key = serverKey();
    if (!url || !key) throw new HttpError(503, 'The account service is missing its server configuration.');
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    // Validate with Auth, rather than trusting getSession(), a decoded JWT or localStorage.
    const { data: identity, error: identityError } = await db.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
    if (identityError || !identity.user) throw new HttpError(401, 'Your session expired or the Auth account no longer exists. Sign in again.');
    const actor = identity.user;
    const currentAccount = await db.auth.admin.getUserById(actor.id);
    if (currentAccount.error || !currentAccount.data.user) throw new HttpError(401, 'Your Auth account is no longer available. Sign in again.');
    const { data: administrator, error: administratorError } = await db.from(TABLE).select('*').eq('user_id', actor.id).maybeSingle();
    if (administratorError) throw databaseError(administratorError);
    if (!administrator || administrator.role !== 'Admin' || administrator.status !== 'Active' || administrator.is_active !== true
      || (currentAccount.data.user.banned_until && new Date(currentAccount.data.user.banned_until).getTime() > Date.now())) {
      throw new HttpError(403, 'Only an active Admin can manage user accounts.');
    }
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { throw new HttpError(400, 'Request body must be valid JSON.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Request body must be an object.');
    const action = body.action;
    if (!['list', 'create', 'update', 'set_status', 'delete', 'approve_request', 'reject_request'].includes(String(action))) throw new HttpError(400, 'Unknown account action.');

    // The profile is authoritative. Compatibility registries and audit history
    // are synced after the Auth/profile operation succeeds; partial history
    // failures are returned as warnings instead of encouraging duplicate writes.
    const warnings: string[] = [];
    const auxiliary = async (label: string, operation: () => PromiseLike<{error: unknown}>) => {
      try { const result = await operation(); if (result.error) throw result.error; }
      catch { warnings.push(`${label} could not be synchronized. Refresh and review the account history.`); }
    };
    const audit = async (event: string, profile: Record<string, any>) => {
      await auxiliary('Audit history', () => db.from('admin_logs').insert({id: crypto.randomUUID(), data: {
        action: event, performedBy: administrator.email || actor.email || actor.id,
        performedById: actor.id, targetUser: profile.email || profile.user_id,
        details: {role: profile.role, status: profile.status}, timestamp: new Date().toISOString()
      }}));
    };
    const syncProfile = async (profile: Record<string, any>) => {
      const uid = String(profile.user_id);
      const data = {fullName: profile.full_name, username: profile.username, email: profile.email,
        contact: profile.contact, position: profile.position, division: profile.division,
        role: profile.role, accountType: profile.account_type, status: profile.status,
        lastLogin: profile.last_login, updatedAt: new Date().toISOString()};
      await auxiliary('Account registry', () => db.from('users').upsert({id:uid,data,updated_at:new Date().toISOString()}, {onConflict:'id'}));
      await auxiliary('Admin registry', () => profile.role === 'Admin' && profile.is_active && profile.status === 'Active'
        ? db.from('admins').upsert({id:uid,data,updated_at:new Date().toISOString()}, {onConflict:'id'})
        : db.from('admins').delete().eq('id',uid));
      const requests = await db.from('access_requests').select('id,data').contains('data',{uid});
      if (requests.error) { warnings.push('Account updated, but request history could not be loaded.'); return; }
      for (const row of requests.data || []) {
        const next = {...row.data, ...data, uid, requestedRole:requestedAccessRole(row.data),
          assignedRole:['Pending','Rejected'].includes(profile.status)?null:profile.role,
          status: profile.status === 'Active' ? 'Approved' : profile.status,
          ...(profile.status === 'Active' ? {approvedBy:administrator.email || actor.email,approvedAt:new Date().toISOString()} : {})};
        delete next.password; delete next.confirmPassword;
        await auxiliary('Request history', () => db.from('access_requests').update({data:next,updated_at:new Date().toISOString()}).eq('id',row.id));
      }
    };
    if (action === 'list') {
      const listed = await db.from(TABLE).select('*').order('created_at',{ascending:false});
      if (listed.error) throw databaseError(listed.error);
      return respond({success:true,users:listed.data});
    }
    let requestRow: {id: string; data: Record<string, any>} | null = null;
    if (action === 'approve_request' || action === 'reject_request') {
      const requestId = text(body.requestId,'Request ID',200,true);
      const request = await db.from('access_requests').select('id,data').eq('id',requestId).maybeSingle();
      if (request.error) throw databaseError(request.error);
      if (!request.data) throw new HttpError(404,'This account request no longer exists.');
      if (String(request.data.data?.status || '').toLowerCase() !== 'pending') throw new HttpError(409,'This request has already been reviewed. Refresh the request queue.');
      requestRow = request.data;
      const linkedId = text(requestRow.data.uid,'Linked Auth user ID',36,true);
      if (body.userId && body.userId !== linkedId) throw new HttpError(400,'The user ID does not match this request.');
      body.userId = linkedId;
      if (action === 'reject_request') {
        body.reason = text(body.reason || 'Request declined','Reason',1000);
        body.remarks = text(body.remarks,'Remarks',2000);
      }
    }
    if (action === 'create') {
      const input = validateUser(body.user, true);
      const exactUsername = input.username.replace(/([\\%_])/g, '\\$1');
      const duplicate = await db.from(TABLE).select('user_id').ilike('username', exactUsername).limit(1);
      if (duplicate.error) throw databaseError(duplicate.error);
      if (duplicate.data?.length) throw new HttpError(409, 'This username already exists.');
      const created = await db.auth.admin.createUser({
        email: input.email, password: input.password, email_confirm: true,
        user_metadata: {...displayMetadata(input), requested_role:input.role, created_by_admin: true}, app_metadata: accessMetadata(input.role, input.status),
        ban_duration: input.status === 'Active' ? 'none' : '876000h',
      });
      if (created.error) throw authError(created.error);
      if (!created.data.user) throw new HttpError(502, 'Auth did not confirm the new account. Refresh before retrying.');
      const userId = created.data.user.id;
      const saved = await db.from(TABLE).upsert({ user_id: userId, ...directoryFields(input) }, { onConflict: 'user_id' }).select('*').single();
      if (saved.error) {
        // Roll back only the Auth user created by this request.
        const rollback = await db.auth.admin.deleteUser(userId);
        if (rollback.error) throw new HttpError(500, 'Auth created the account, but its profile could not be saved or rolled back. Check Authentication > Users and refresh before retrying.');
        throw databaseError(saved.error);
      }
      await syncProfile(saved.data);
      await audit('CREATE_USER',saved.data);
      return respond({ success: true, user: saved.data, warnings });
    }
    const userId = text(body.userId, 'User ID', 36, true);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new HttpError(400, 'Invalid Auth user ID.');
    const existingAuth = await db.auth.admin.getUserById(userId);
    if (existingAuth.error) throw authError(existingAuth.error);
    if (!existingAuth.data.user) throw new HttpError(404, 'This Auth user no longer exists. Refresh the directory.');
    const existing = await db.from(TABLE).select('*').eq('user_id', userId).maybeSingle();
    if (existing.error) throw databaseError(existing.error);
    if (!existing.data) throw new HttpError(409, 'The Auth account exists but its personnel profile is missing. Run ADMIN_USER_ACCESS_PATCH.sql again.');
    const before = existing.data;
    if (action === 'delete') {
      if (userId === actor.id) throw new HttpError(409, 'You cannot delete your own Admin account.');
      const deleted = await db.auth.admin.deleteUser(userId);
      if (deleted.error) throw authError(deleted.error);
      await auxiliary('Account registry', () => db.from('users').delete().eq('id',userId));
      await auxiliary('Admin registry', () => db.from('admins').delete().eq('id',userId));
      await audit('DELETE_USER',before);
      return respond({ success: true, userId, warnings }); // FK cascade removes the profile row.
    }
    let fields: Record<string, unknown>;
    let authChanges: Record<string, unknown>;
    if (action === 'approve_request' || action === 'reject_request') {
      if (userId === actor.id) throw new HttpError(409,'Use another Admin to review your own access.');
      if (before.status !== 'Pending' || before.is_active) throw new HttpError(409,'This account is no longer pending. Refresh before reviewing it.');
      const approving = action === 'approve_request';
      const role = approving ? text(body.role,'Role',30,true) : before.role;
      if (!allowedRoles.has(role)) throw new HttpError(400,'Choose Admin or User.');
      const status = approving ? 'Active' : 'Rejected';
      fields = {role,status,is_active:approving,account_type:role==='Admin'?'Administrator':'Standard User',updated_at:new Date().toISOString()};
      authChanges = {ban_duration:approving?'none':'876000h', ...(approving?{email_confirm:true}:{}),
        app_metadata:{...existingAuth.data.user.app_metadata,...accessMetadata(role,status)}};
    } else if (action === 'set_status') {
      if (userId === actor.id) throw new HttpError(409, 'Use another Admin to change your own access.');
      const status = text(body.status, 'Status', 20, true);
      if (!allowedStatuses.has(status)) throw new HttpError(400, 'Invalid account status.');
      fields = { status, is_active: status === 'Active', updated_at: new Date().toISOString() };
      authChanges = { ban_duration: status === 'Active' ? 'none' : '876000h',
        app_metadata: { ...existingAuth.data.user.app_metadata, ...accessMetadata(before.role, status) } };
    } else {
      const input = validateUser(body.user, false);
      if (userId === actor.id && (input.role !== before.role || input.status !== before.status)) {
        throw new HttpError(409, 'Use another Admin to change your own role or status.');
      }
      fields = directoryFields(input);
      authChanges = { email: input.email, email_confirm: true,
        user_metadata: { ...existingAuth.data.user.user_metadata, ...displayMetadata(input) },
        app_metadata: { ...existingAuth.data.user.app_metadata, ...accessMetadata(input.role, input.status) },
        ban_duration: input.status === 'Active' ? 'none' : '876000h' };
      if (input.password) authChanges.password = input.password;
    }
    // Guarded profile write comes first, so the final active Admin cannot be
    // disabled before the SQL trigger checks the directory.
    const changed = await db.from(TABLE).update(fields).eq('user_id', userId).eq('updated_at', before.updated_at).select('*').maybeSingle();
    if (changed.error) throw databaseError(changed.error);
    if (!changed.data) throw new HttpError(409, 'Another operation changed this profile. Refresh before saving again.');
    const authUpdate = await db.auth.admin.updateUserById(userId, authChanges);
    if (authUpdate.error) {
      const rollback = await db.from(TABLE).update({ full_name: before.full_name,
        username: before.username, email: before.email, division: before.division,
        role: before.role, status: before.status, is_active: before.is_active, account_type: before.account_type, position: before.position,
        contact: before.contact, updated_at: new Date().toISOString() }).eq('user_id', userId)
        .eq('updated_at', changed.data.updated_at).select('user_id');
      if (rollback.error || rollback.data?.length !== 1) throw new HttpError(500, 'Auth rejected the change and the directory rollback failed. Refresh and review the account before retrying.');
      throw authError(authUpdate.error);
    }
    const saved = { ...changed.data, email: authUpdate.data.user?.email || changed.data.email };
    await syncProfile(saved);
    let reviewedRequest = null;
    if (requestRow) {
      reviewedRequest = {...requestRow.data,requestedRole:requestedAccessRole(requestRow.data),
        assignedRole:action==='approve_request'?saved.role:null,role:saved.role,accountType:saved.account_type,
        status:action==='approve_request'?'Approved':'Rejected',
        ...(action==='reject_request'?{declineReason:text(body.reason || 'Request declined','Reason',1000),
          declineRemarks:text(body.remarks,'Remarks',2000),declinedAt:new Date().toISOString(),declinedBy:administrator.email || actor.email}:
          {approvedAt:new Date().toISOString(),approvedBy:administrator.email || actor.email})};
      delete reviewedRequest.password; delete reviewedRequest.confirmPassword;
      await auxiliary('Request review', () => db.from('access_requests').update({data:reviewedRequest,updated_at:new Date().toISOString()}).eq('id',requestRow!.id));
    }
    await audit(String(action).toUpperCase(),saved);
    return respond({ success: true, user: saved, request: reviewedRequest, warnings });
  } catch (error) {
    const known = error instanceof HttpError;
    if (!known) console.error('Account service error:', error instanceof Error ? error.name : 'unknown');
    return respond({ success: false, error: known ? error.message : 'The account service could not complete this action. Refresh and retry.' }, known ? error.status : 500);
  }
});
