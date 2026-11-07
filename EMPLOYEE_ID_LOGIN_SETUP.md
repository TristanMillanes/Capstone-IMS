# Employee ID login and first administrator

**Current registration update:** Follow [UPDATE_EMPLOYEE_ATTENDANCE_AND_INVENTORY.md](UPDATE_EMPLOYEE_ATTENDANCE_AND_INVENTORY.md). Apply `supabase/EMPLOYEE_REGISTRATION_AUTO_SYNC_PATCH.sql` last and redeploy `employee-register`. Staff enter their number and basic details; the Employee record is created or linked automatically. The older verification steps below are superseded by this update.

Registration asks for the employee number, name, office division, optional position and password. A fixed `@pgenro.ims` suffix is displayed beside the ID. The system generates the Auth login address: `0007` becomes `0007@pgenro.ims`. Leading zeroes are preserved and ID matching ignores case. The first administrator signs in as `Admin001`, using the same automatic suffix.

## Install in your existing Supabase project

1. Run the existing `supabase/ADMIN_USER_ACCESS_PATCH.sql` if Admin/User access is not installed yet. For a new empty database, follow `ADMIN_USER_SETUP.md` first.
2. Run the entire **`supabase/EMPLOYEE_REGISTRATION_AUTO_SYNC_PATCH.sql` last**. It includes the employee link, registration and private attendance setup for existing databases. Do not reapply an older account patch afterward without reapplying this latest patch.
3. Deploy all three Edge Functions from this project. The two public employee functions are new; `admin-users` is updated:

   ```bash
   supabase functions deploy employee-login --project-ref zssrxubajhqryrwijyzm --no-verify-jwt
   supabase functions deploy employee-register --project-ref zssrxubajhqryrwijyzm --no-verify-jwt
   supabase functions deploy admin-users --project-ref zssrxubajhqryrwijyzm --no-verify-jwt
   ```

   The Supabase CLI must already be logged in. Use your actual project ref if you use a different Supabase project, and update the public connection configuration in `shared/supabase.js` and `User/login-modern.js` too. Include `supabase/functions/_shared/employee-accounts.ts` when deploying through the Dashboard editor. The functions use Supabase's built-in server credentials; no server key belongs in HTML or browser JavaScript. The existing optional `PGENRO_ALLOWED_ORIGINS` setting must include your application origin when configured.

4. Copy/deploy the complete updated source, restart using `START_SYSTEM.bat` or your existing deployment, then refresh the login page with Ctrl+F5.

## Create the first Admin001 account

On your own computer, double-click **`SETUP_FIRST_ADMIN.bat`**, or run:

```bash
python SETUP_FIRST_ADMIN.py
```

Use the default Supabase project URL unless you changed projects. Paste the project's **secret key or legacy service_role key** at the private prompt, then choose and confirm a password of at least 12 characters. The script creates the confirmed `admin001@pgenro.ims` Auth account and activates its Admin profile. It does not need an Employee Directory record, an email inbox, or email confirmation. The key and password are never saved or printed.

Then open `/User/login.html`, enter **`Admin001`** and the password you chose. The suffix is already displayed. There is no shared default password. If an active Admin already exists, the setup stops; use that administrator's User Management to add accounts instead. If an interrupted setup left the Auth account behind, run `supabase/BOOTSTRAP_FIRST_ADMIN.sql` to finish promotion without changing its password.

## Employee registration and account management

- Employees enter their ID, name, division, optional position and password. The Employee record is added or linked automatically; Admin completes other personnel information. IDs support letters, digits, underscores, hyphens and dots; dots cannot be consecutive or last. The registration form uses the existing 60-character limit.
- `employee-register` generates the alias on the server, confirms it without sending mail, and creates an inactive **Pending User** linked to an Employee record. An administrator must approve access. A client cannot choose Admin access or another employee's attendance link.
- One employee record can have only one account or pending request. `Admin001` is reserved for the first administrator.
- In Admin User Management, enter the Employee ID. The login address is filled automatically and cannot be edited separately. Password changes remain available to administrators; email recovery is not used for synthetic login addresses.
- Existing linked email-based accounts retain their password and Auth identity. The private login resolver finds them by the linked Employee ID. Older unlinked accounts can use their existing username, or an administrator can link a confirmed employee using `pgenro_link_employee_account` as documented in `EMPLOYEE_ACCOUNT_SETUP.md`. An employee ID correction continues to use the stable employee record link.

## Validation and deployment status

The account, attendance and first-admin checks passed locally before packaging. Developer tests, screenshots and historical verification reports are excluded from this clean application distribution.

These source changes do not deploy Edge Functions, run SQL or create accounts in your hosted Supabase project automatically. Complete the steps above to activate them. The first Admin is created when you run the setup script.

The package includes the runtime source, required libraries/templates and current setup files. Local Python environments, caches, temporary OCR uploads, nested ZIP archives and duplicate SQL/docs trees are omitted. `requirements.txt` and `START_SYSTEM.bat` rebuild the Python environment when needed.
