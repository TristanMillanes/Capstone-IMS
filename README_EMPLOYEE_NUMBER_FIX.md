# PGENRO IMS — Employee Number + Supabase End-to-End Repair

**Superseded registration instructions:** Use [UPDATE_EMPLOYEE_ATTENDANCE_AND_INVENTORY.md](UPDATE_EMPLOYEE_ATTENDANCE_AND_INVENTORY.md) for the current automatic Employee record and personal-attendance update. Pre-encoding and employee/email verification below describe an earlier release.

This package repairs the Employee Number account flow and the one-time First Admin setup. It does **not** deploy to the live Supabase project automatically; run the deployment commands below from the project root.

## What is repaired

- Employee Number is the account identifier in the User login and Admin/User Management screens.
- Employee registration verifies Employee Number + Employee Directory email before Auth signup.
- The database Auth trigger links normal employee registrations to `profiles.employee_record_id` and `profiles.employee_number`.
- Employee Number lookup for login stays server-side; the browser does not receive the directory email lookup.
- The `employee-login` Edge Function supports current `SUPABASE_PUBLISHABLE_KEYS` and legacy Supabase key environment variables.
- Pending, Inactive, and Suspended accounts are not issued an Auth session by `employee-login`.
- `admin-users`, `employee-login`, and `bootstrap-first-admin` use consistent CORS responses. CORS is not used as authentication; each endpoint enforces its own credentials/authorization.
- First Admin is created through `User/first-admin-setup.html`, not by manually creating a user in Supabase Authentication.
- The old `BOOTSTRAP_FIRST_ADMIN.sql` is deprecated and contains no Employee Number placeholder.

## Important: do not create Auth users manually

Do not use Supabase Dashboard → Authentication → Users → Create User for ordinary employees or the first Admin. The database trigger intentionally requires Employee Number metadata for normal registration. Use:

- Staff: `User/requestacc.html` → verify Employee Number → submit request → confirm email → wait for Admin approval.
- First Admin only: `User/first-admin-setup.html` → Employee Number + exact directory email + private setup key + password.

## Deployment sequence for an existing project

Do **not** rerun `COMPLETE_SETUP.sql` or `PGENRO_FULL_SETUP.sql` on an existing production database. Those are full setup files. Use the migrations below only if their objects are not already installed.

### 1. Apply/verify the Employee Number SQL patch

In Supabase SQL Editor, run `supabase/EMPLOYEE_ACCOUNT_ATTENDANCE_PATCH.sql` once after the existing `COMPLETE_SETUP.sql` / `ADMIN_USER_ACCESS_PATCH.sql` setup.

The patch is transactional and includes the required `DROP FUNCTION IF EXISTS public.pgenro_employee_login_lookup(text)` before recreating its return shape. If it stops with a duplicate Employee Number message, inspect the existing profiles first; do not delete accounts blindly.

### 2. Apply the First Admin RPC patch

In Supabase SQL Editor, run `supabase/FIRST_ADMIN_SYSTEM_SETUP_PATCH.sql` once after Step 1.

### 3. Deploy the exact Edge Function names

From the folder that contains the `supabase` directory, run:

```powershell
supabase link --project-ref zssrxubajhqryrwijyzm
supabase functions deploy admin-users --no-verify-jwt
supabase functions deploy employee-login --no-verify-jwt
supabase functions deploy bootstrap-first-admin --no-verify-jwt
```

The deployed names must be exactly:

- `admin-users`
- `employee-login`
- `bootstrap-first-admin`

Do not use the old `ADMIN_USER`, `EMPLOYEE_LOGIN`, or misspelled `FIRST_ADMIN_BOOTSRAP` functions. Keep old functions until the new flow is confirmed; they can be removed later.

The supplied `supabase/config.toml` also sets `verify_jwt = false` for these three functions because each function performs its own authorization. The CLI commands explicitly apply the same setting.

### 4. Add the private First Admin setup secret

Supabase Dashboard → Edge Functions → Secrets → Add secret:

- Name: `PGENRO_FIRST_ADMIN_SETUP_KEY`
- Value: a random private value of at least 32 characters.

Example PowerShell command to generate a 64-character hex key on a modern Windows PowerShell/.NET runtime:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToHexString($bytes)
```

Copy the generated value directly into the Supabase secret. Do not put it in HTML, JavaScript, source control, or send it in chat. After the First Admin is created, delete this secret to close the setup endpoint. The endpoint also refuses setup if an active Admin already exists.

The repaired functions do not require `PGENRO_ALLOWED_ORIGINS`; their CORS response permits the browser app while the actual endpoint remains protected by its setup key, password, or verified Admin bearer token. An old `PGENRO_ALLOWED_ORIGINS` secret can remain; these repaired functions ignore it.

### 5. Confirm the project URL and publishable key

Check `shared/supabase.js` and `User/login-modern.js`. They must point to the same Supabase project shown in the Dashboard. The browser key must be a publishable/anon key only. Never place `SUPABASE_SECRET_KEYS`, `SUPABASE_SECRET_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` in browser files.

### 6. Test First Admin setup

Open the local page or deployed site:

`User/first-admin-setup.html`

For local Live Server at port 5500, the page origin will be `http://127.0.0.1:5500`. The repaired CORS code supports this origin without a separate allowlist.

The page should display one of these clear statuses:

- **Connected / setup available** — function is reachable, key is configured, and no active Admin exists.
- **Setup key missing** — add `PGENRO_FIRST_ADMIN_SETUP_KEY` and refresh.
- **Already initialized** — an active Admin exists; use normal sign-in.
- **Cannot reach Edge Function** — verify function deployment, exact function name, project URL, and function logs.

Enter the Employee Number and the exact email recorded for that employee in `public.employees`, plus the private setup key and a password. The server verifies the directory record, creates Auth, links the profile, and activates the first Admin.

### 7. Verify the database

Run the read-only `supabase/VERIFY_EMPLOYEE_NUMBER_SETUP.sql`. It reports required columns, indexes, functions, triggers, and account counts without showing employee emails.

## CORS and browser `Failed to fetch`

The repaired Edge Functions always return `Access-Control-Allow-Origin: *` and handle `OPTIONS` preflight. They do not trust CORS for security. If the browser still reports `Failed to fetch` after redeploying, inspect the browser DevTools Network tab for the `OPTIONS` request and the Edge Function logs; the page now displays the endpoint URL, current origin, and an explicit network/CORS diagnostic.

## Files that are canonical

Use the top-level `supabase/` folder for Supabase CLI deployment. `User/supabase/` is kept as a synchronized reference copy for convenience. The website files are under `User/`, the Admin interface is under `admin/`, and the shared public Supabase client config is `shared/supabase.js`.
