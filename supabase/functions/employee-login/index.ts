import { AccountError, employeeNumber, publicHandler, serviceClient } from '../_shared/employee-accounts.ts';

export const handler = publicHandler(async body => {
  const number = employeeNumber(body.employee_number);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 256) throw new AccountError(401, 'invalid_credentials', 'Employee ID or password is incorrect.');
  const db = serviceClient();
  const { data: email, error: lookupError } = await db.rpc('pgenro_employee_login_email', { p_employee_number: number });
  if (lookupError) throw new AccountError(503, 'employee_login_not_configured', 'Run the employee ID login SQL patch.');
  // Always make an Auth request, including unknown IDs. Auth performs password
  // verification, bans and rate limiting. Do not expose the resolved email.
  const { data, error } = await db.auth.signInWithPassword({ email: email || number.toLowerCase() + '@pgenro.ims', password });
  if (error || !email || !data.session) {
    if (error?.status === 429) throw new AccountError(429, 'rate_limited', 'Too many attempts. Please wait and try again.');
    if (error?.code === 'email_not_confirmed') throw new AccountError(403, 'email_not_confirmed', 'Contact the administrator to confirm your existing account.');
    throw new AccountError(401, 'invalid_credentials', 'Employee ID or password is incorrect.');
  }
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
});
Deno.serve(handler);
