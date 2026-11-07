import { AccountError, employeeNumber, publicHandler, serviceClient } from '../_shared/employee-accounts.ts';

export const handler = publicHandler(async body => {
  const number = employeeNumber(body.employee_number);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8 || password.length > 128) throw new AccountError(400, 'invalid_password', 'Password must contain 8–128 characters.');
  function field(key: string, limit = 200): string {
    const value = body[key];
    if (value != null && typeof value !== 'string') throw new AccountError(400, 'invalid_details', 'Account details must be text.');
    const result = (typeof value === 'string' ? value : '').trim();
    if (result.length > limit) throw new AccountError(400, 'invalid_details', 'An account detail is too long.');
    return result;
  }
  const first = field('first_name', 80), middle = field('middle_name', 60);
  const last = field('last_name', 80), extension = field('name_extension', 10);
  const fullName = [first, middle, last, extension].filter(Boolean).join(' ') || field('full_name');
  const division = field('division'), position = field('position');
  const structuredName = ['first_name','middle_name','last_name','name_extension'].some(key => Object.hasOwn(body,key));
  if (!fullName || fullName.length > 200 || !division || (structuredName && (!first || !last))) {
    throw new AccountError(400, 'invalid_details', 'Enter your first name, last name and office division.');
  }
  const db = serviceClient();
  const { data: employee, error: checkError } = await db.rpc('pgenro_employee_registration_check', { p_employee_number: number });
  if (checkError) {
    if (checkError.code === '23505') throw new AccountError(409, 'employee_claimed', 'This employee ID already has an account or request.');
    if (checkError.code === '22023') throw new AccountError(400, 'invalid_employee_id', 'Enter a valid employee number. Admin001 is reserved for the administrator.');
    throw new AccountError(503, 'registration_not_configured', 'The registration service needs the employee auto-sync SQL update. Contact the administrator.');
  }
  if (employee?.eligible !== true || typeof employee.employee_number !== 'string') throw new AccountError(503, 'registration_not_configured', 'The registration service did not confirm the employee number.');
  const canonical = employeeNumber(employee.employee_number);
  // Only basic personnel fields are accepted. Auth/profile/employee creation is
  // one database transaction; the trigger locks and reuses an existing HR row.
  const { data, error } = await db.auth.admin.createUser({
    email: canonical.toLowerCase() + '@pgenro.ims', password, email_confirm: true,
    user_metadata: { employee_number: canonical, full_name: fullName, first_name: first, middle_name: middle,
      last_name: last, name_extension: extension, division, position,
      registration_source: 'employee-auto-v2', requested_role: 'User', requested_system: 'User' }
  });
  if (error || !data.user) {
    if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
      throw new AccountError(409, 'employee_claimed', 'This employee ID already has an account or request.');
    }
    if (error?.code === 'weak_password') throw new AccountError(400, 'invalid_password', 'Choose a stronger password that meets the administrator\'s password policy.');
    // Auth can wrap trigger conflicts in a generic database error. Recheck the
    // read-only preflight so concurrent requests receive the duplicate message.
    const retry = await db.rpc('pgenro_employee_registration_check', { p_employee_number: canonical });
    if (retry.error?.code === '23505') throw new AccountError(409, 'employee_claimed', 'This employee ID already has an account or request.');
    throw new AccountError(400, 'registration_failed', 'Account request could not be saved. Ask the administrator to apply the employee auto-sync SQL update, then retry.');
  }
  // Confirming the synthetic alias does not grant access. The existing database
  // trigger creates an inactive Pending User, awaiting administrator approval.
  return { success: true, employee_number: canonical };
});
Deno.serve(handler);
