# Employee accounts and personal attendance

For installation and ID-only registration, use [EMPLOYEE_ID_LOGIN_SETUP.md](EMPLOYEE_ID_LOGIN_SETUP.md). Apply `supabase/EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql` first, then `supabase/EMPLOYEE_ID_LOGIN_PATCH.sql` last.

## Registration

Encode the employee's ID in the Employee module before registration. The applicant enters their employee ID and password; the system generates the `@pgenro.ims` login address. Their name, position and division come from the encoded Employee record. A personal contact email is not required for registration.

Employee IDs remain text, including leading zeroes. Matching ignores case and surrounding spaces. Each employee record can have only one account or pending request. A new request stays Pending until an Admin approves it.

## Personal attendance

**My Attendance** displays the signed-in employee's ceremony attendance and uniform monitoring records. Users can filter and view their own records, but only administrators encode or change monitoring data. The account links to the stable employee record ID internally.

An older linked account keeps its existing Auth identity and password. The employee ID login service resolves it through the employee record. An unlinked older account sees an unlinked state in My Attendance until an administrator confirms the employee link.

## Link an older account

After confirming the employee's identity, an authorized administrator or SQL owner can run:

```sql
select public.pgenro_link_employee_account(
  '<AUTH_USER_UUID>'::uuid,
  '<ENCODED_EMPLOYEE_ID>'
);
```

Use the real Auth UUID and encoded employee ID. The account must be a User account, and the employee record must not already belong to another account. The stable link keeps attendance attached to the same employee if their displayed ID number is corrected later.
