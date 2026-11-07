# Employee accounts and personal attendance

For the current update, use [UPDATE_EMPLOYEE_ATTENDANCE_AND_INVENTORY.md](UPDATE_EMPLOYEE_ATTENDANCE_AND_INVENTORY.md). Apply `supabase/EMPLOYEE_REGISTRATION_AUTO_SYNC_PATCH.sql` last, redeploy `employee-register`, then publish the website files. This supersedes the older ID verification patches.

## Registration

Registration automatically creates or reuses an Employee record with the entered employee number. Applicants enter their number, name, division, optional position and password. Admin completes other personnel information and approves the pending account. Employees do not need to be encoded before registration. The `@pgenro.ims` login address is generated automatically; an HR contact email stays separate.

Employee IDs remain text, including leading zeroes. Matching ignores case and surrounding spaces. Each employee record can have only one account or pending request. A new request stays Pending until an Admin approves it.

## Personal attendance

**My Attendance** displays the signed-in employee's ceremony attendance and uniform monitoring records. Users can filter and view their own records, but only administrators encode or change monitoring data. The account links to the stable employee record ID internally.

Employee Profiles/Directory is available only to Admin. Employee or uniform changes refresh the linked User's My Attendance page automatically, including when an older account is linked while its attendance page is already open.

An older linked account keeps its existing Auth identity and password. The auto-sync patch repairs existing ID accounts when their identity is unambiguous. Other unlinked accounts show no attendance until Admin confirms the employee link using the command below.

## Link an older account

After confirming the employee's identity, an authorized administrator or SQL owner can run:

```sql
select public.pgenro_link_employee_account(
  '<AUTH_USER_UUID>'::uuid,
  '<ENCODED_EMPLOYEE_ID>'
);
```

Use the real Auth UUID and encoded employee ID. The account must be a User account, and the employee record must not already belong to another account. The stable link keeps attendance attached to the same employee if their displayed ID number is corrected later.
