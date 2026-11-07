# Current registration update
Use `../UPDATE_EMPLOYEE_ATTENDANCE_AND_INVENTORY.md` and run `EMPLOYEE_REGISTRATION_AUTO_SYNC_PATCH.sql` last. Registration now creates or links the Employee record automatically. The directory-verification instructions below describe an earlier release.

# PGENRO IMS — Employee Number Account Flow

This guide is aligned with the end-to-end repair package. For the complete deployment checklist, read `README_EMPLOYEE_NUMBER_FIX.md` or `FIRST_ADMIN_SYSTEM_SETUP.md`.

## Normal employee account flow

1. Employee opens `User/requestacc.html`.
2. Employee enters the Employee Number and the email recorded in the Employee Directory.
3. The system calls `pgenro_employee_registration_check` to verify the record.
4. On submission, Supabase Auth creates the account with Employee Number metadata. The database trigger re-verifies the employee, links `employee_record_id` and `employee_number`, and creates a Pending access request.
5. The employee confirms the email if Supabase email confirmation is enabled.
6. An active Admin reviews and approves the request in PGENRO IMS.
7. Employee signs in using Employee Number + password. The `employee-login` Edge Function resolves the email privately on the server and checks the password through Supabase Auth.

## First Admin flow

Use `User/first-admin-setup.html` and the `bootstrap-first-admin` Edge Function. Do not create the first Auth account manually in Supabase Dashboard. The First Admin setup requires the exact Employee Number, matching directory email, a private `PGENRO_FIRST_ADMIN_SETUP_KEY` of at least 32 characters, and a password. After successful setup, remove the setup key.

## SQL migration order for an existing database

1. Existing `COMPLETE_SETUP.sql` / `ADMIN_USER_ACCESS_PATCH.sql` must already be installed.
2. Run `supabase/EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql`.
3. Run `supabase/FIRST_ADMIN_SYSTEM_SETUP_PATCH.sql`.
4. Run `supabase/VERIFY_EMPLOYEE_NUMBER_SETUP.sql` to confirm required columns, functions, and triggers.

Do not rerun the full `COMPLETE_SETUP.sql` or `PGENRO_FULL_SETUP.sql` on a live database just to repair account login.

## Edge Functions

Deploy these exact names from the project root:

```powershell
supabase link --project-ref zssrxubajhqryrwijyzm
supabase functions deploy admin-users --no-verify-jwt
supabase functions deploy employee-login --no-verify-jwt
supabase functions deploy bootstrap-first-admin --no-verify-jwt
```

The repaired functions use CORS `*` because CORS is not an authentication mechanism. `admin-users` validates the Admin bearer token, `employee-login` validates the Employee Number/password, and `bootstrap-first-admin` validates the private one-time setup key. `PGENRO_ALLOWED_ORIGINS` is not required by these repaired versions.

Never place a Supabase secret/service-role key or the First Admin setup key in frontend JavaScript or HTML.
