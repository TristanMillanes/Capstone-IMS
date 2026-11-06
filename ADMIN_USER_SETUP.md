# Admin and User account setup

The system uses two access roles: **Admin** and **User**. Public employee registration creates a Pending User request. An active administrator reviews the request and assigns the final access role. Cached browser roles and editable Auth metadata do not grant Admin access.

## Existing Supabase project

1. If Admin/User access has not been installed, run the entire `supabase/ADMIN_USER_ACCESS_PATCH.sql` in the Supabase SQL Editor. It retains accounts and operational records, normalizes access roles and installs account/notification helpers.
2. Apply the employee patches in [EMPLOYEE_ID_LOGIN_SETUP.md](EMPLOYEE_ID_LOGIN_SETUP.md), with `supabase/EMPLOYEE_ID_LOGIN_PATCH.sql` last.
3. Deploy the supplied `admin-users`, `employee-login` and `employee-register` Edge Functions as described in that guide.
4. Deploy the complete application folder, refresh the browser and sign in again. Run `supabase/VERIFY_ADMIN_USER_SETUP.sql` to inspect the installed account helpers and Admin count.

If you run an older account or policy patch later, reapply the employee ID login patch afterward.

## New Supabase project

Run **supabase/COMPLETE_SETUP.sql** once as the canonical base schema. Apply `supabase/DOCUMENT_STORAGE_PATCH.sql` for private attachments and `supabase/PUBLIC_SERVICE_REQUEST_PATCH.sql` for guest Service Request submissions. Then follow the employee ID guide to apply the account/attendance patch and employee ID login patch, and deploy the Edge Functions.

The former `schema.sql` and `PGENRO_FULL_SETUP.sql` copies contained the same base setup and have been consolidated into `COMPLETE_SETUP.sql`.

## First administrator

After the SQL is ready, run **SETUP_FIRST_ADMIN.bat** or `python SETUP_FIRST_ADMIN.py` on your computer. The private prompts ask for the project's server key and your chosen password. The script creates `admin001@pgenro.ims` and activates its Admin profile without requiring an Employee Directory record. Sign in using **Admin001**; the login suffix is already displayed.

If an active Admin already exists, use that administrator's User Management to add accounts. For an interrupted setup where the Auth account already exists, `supabase/BOOTSTRAP_FIRST_ADMIN.sql` can finish promotion without resetting the password.

## Access behavior

| Action | Admin | Approved User |
| --- | --- | --- |
| Create accounts and review access requests | Yes | No |
| Assign Admin/User access and account status | Yes | No |
| Encode, edit and delete operational records | Yes | No |
| View, filter, print and export permitted records | Yes | Yes |
| Change permitted personal settings | Yes | Yes |

The current Admin cannot delete, suspend or demote their own account through User Management. Database guards protect the final active Admin. Public registration remains pending until reviewed, even though its generated login alias is confirmed on the server.

Supabase server keys stay in server-side configuration or the local setup prompt. Keep the supplied public connection configuration in the browser files. For local startup, see [FIXES_AND_SETUP.md](FIXES_AND_SETUP.md); for deployment, see [docs/DEPLOYMENT_RENDER.md](docs/DEPLOYMENT_RENDER.md).
