import { AccountError, employeeNumber, publicHandler, serviceClient } from '../_shared/employee-accounts.ts';

export const handler = publicHandler(async body => {
  const number = employeeNumber(body.employee_number);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8 || password.length > 128) throw new AccountError(400, 'invalid_password', 'Password must contain 8–128 characters.');
  const db = serviceClient();
  const { data: employee, error: checkError } = await db.rpc('pgenro_employee_registration_check', { p_employee_number: number });
  if (checkError) {
    if (checkError.code === '23505') throw new AccountError(409, 'employee_claimed', 'This employee ID already has an account or request.');
    if (checkError.code === '22023') throw new AccountError(400, 'employee_not_verified', 'Employee ID could not be verified. Contact the administrator.');
    throw new AccountError(503, 'registration_not_configured', 'Run the employee ID login SQL patch.');
  }
  if (employee?.eligible !== true || typeof employee.employee_number !== 'string') throw new AccountError(400, 'employee_not_verified', 'Employee ID could not be verified.');
  const canonical = employeeNumber(employee.employee_number);
  // Only the server generates the alias. No role, name or email from the caller
  // is accepted. The database rechecks and locks the employee row atomically.
  const { data, error } = await db.auth.admin.createUser({
    email: canonical.toLowerCase() + '@pgenro.ims', password, email_confirm: true,
    user_metadata: { employee_number: canonical, registration_source: 'employee-id-v1', requested_role: 'User', requested_system: 'User' }
  });
  if (error || !data.user) {
    if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
      throw new AccountError(409, 'employee_claimed', 'This employee ID already has an account or request.');
    }
    if (error?.code === 'weak_password') throw new AccountError(400, 'invalid_password', 'Choose a stronger password that meets the administrator\'s password policy.');
    throw new AccountError(400, 'registration_failed', 'Account request could not be saved. Recheck the employee ID or contact the administrator.');
  }
  // Confirming the synthetic alias does not grant access. The existing database
  // trigger creates an inactive Pending User, awaiting administrator approval.
  return { success: true, employee_number: canonical };
});
Deno.serve(handler);
