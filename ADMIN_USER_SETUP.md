# Admin and User access update

The system has two access roles: **Admin** and **User**. An active Admin uses the administrative workspace and manages accounts and account requests. An approved User uses the existing read-only workspace. Registration records the applicant's requested role; the reviewing Admin chooses the final role. Both workspaces now have per-module notifications and refreshed dashboards/charts. Position/designation and division remain separate personnel fields. The Supabase connection, module workflows and OCR service are retained.

For a short Tagalog installation guide, start with `UNAHIN_ITO.md`. The read-only verification SQL now covers registration/approval roles and notifications in addition to Admin access.

## If the Admin/User update is already installed

Follow all four steps below, including the updated SQL and `admin-users` Edge Function. The complete patch includes the earlier account-list return-type repair, requested-role history, notification tables, read receipts, policies and insert triggers. Running only the directory repair will not install these new features.

## Update an existing Supabase project

1. Open Supabase Dashboard → SQL Editor. Paste and run the **entire** `supabase/ADMIN_USER_ACCESS_PATCH.sql` file. It needs no email replacement, retains accounts and operational records, converts existing administrator labels to Admin, and maps other access roles to User. New requests remain Pending until an Admin approves them. The patch can be rerun; existing records are not replayed as new notifications.
2. Deploy the updated `supabase/functions/admin-users/index.ts` from the project root:

   ```bash
   supabase functions deploy admin-users --project-ref zssrxubajhqryrwijyzm --no-verify-jwt
   ```

   The supplied `supabase/config.toml` contains the same `verify_jwt = false` setting. The function itself validates the bearer token with Supabase Auth, checks the current Auth ban and active Admin profile, and denies unauthenticated or ordinary User callers. It supports the hosted `SUPABASE_SECRET_KEYS` and legacy service-role environment variables. Keep those secrets on the server. The browser keeps the supplied publishable key.
3. Deploy the full application folder, then refresh and sign in again. See `FIXES_AND_SETUP.md` for local Python/Tesseract startup and `docs/DEPLOYMENT_RENDER.md` for deployment.
4. Run `supabase/VERIFY_ADMIN_USER_SETUP.sql` to review roles, active Admin count and installed RPCs. SQL Editor has no browser identity; checking an authorization helper there without `auth.uid()` can correctly return false.

The SQL and Edge Function changes are prepared in this archive. They have not been applied to your hosted project.

## New Supabase project

Run **one** complete setup file: `supabase/COMPLETE_SETUP.sql`. `schema.sql` and `PGENRO_FULL_SETUP.sql` contain the same setup. Each includes the Admin/User migration at its end. Apply `supabase/DOCUMENT_STORAGE_PATCH.sql` for private attachments if the bucket is not yet configured.

If no active Admin exists, create the intended account in Authentication → Users, then edit the single `target_email` value in `supabase/BOOTSTRAP_FIRST_ADMIN.sql` and run that optional file. This promotes the selected existing account to Admin and clears its Auth ban. Existing Admin accounts are retained automatically and do not need the bootstrap script.

## Account behavior

Applicants choose Admin or User on registration. This choice is saved as **Requested Role** and grants no workspace access while Pending. During review, an Admin can choose either **User** or **Admin** as the final role, even when it differs from the request. Quick approval opens that review; bulk approval requires an explicit final-role selection. The request history displays both Requested Role and Assigned Role. Rejected requests retain the original request with no assigned role. Existing pending requests recover the earlier form selection from Auth metadata where available.

| Action | Admin | User |
| --- | --- | --- |
| Open administrative workspace and User Management | Yes, while active | Redirected to User workspace |
| Create/edit accounts and assign Admin or User | Yes, through admin-users | No |
| Approve or decline linked account requests | Yes | No |
| Suspend, activate or delete another account | Yes | No |
| Encode/edit/delete operational records | Yes | No |
| View/filter/print/export permitted records | Yes | Yes, while approved and active |
| Edit own safe profile fields and preferences | Yes | Yes, through Settings RPCs |

The current Admin cannot delete, suspend or demote their own account in User Management. A database trigger protects the final active Admin. Cached roles, editable Auth metadata and preference fields cannot grant administrative access. The role selected at signup is a request; only approval assigns the authorization role and activates the account.

User Management reads `public.profiles` through authenticated Supabase queries protected by RLS, using the same profile and `is_pgenro_admin` checks as the Admin workspace. The migration supplies the authorization and pending-count helpers, plus a compatible account-list RPC for other callers. The account-service response works with both the existing shared controller and User Management. Access is rechecked after focus, visibility changes and every 30 seconds; revoked access clears the loaded directory and forms. A database loading error appears inside the registry while the normal Admin layout remains visible.

Account changes synchronize Auth bans, profiles, compatibility registries, request history and audit entries. An auxiliary history failure after a successful account change produces a warning; refresh and review that history before retrying. Core Auth failures restore the previous profile, and a failed profile write during creation removes only the newly created Auth account.

## Module notifications

All 21 authenticated workspace pages include a notification bell and unread sidebar badges. New records in Communications, Employees, ICS, Inventory, Office Memos, Service Records, Travel Orders and Visitors produce notifications for active users permitted to view those records. User Management and Account Requests notifications are visible only to Admins. The feed uses database insert events, so existing records and later edits do not generate duplicate “new record” alerts.

Opening a notification marks that item as read and opens its module. **Mark all read** clears currently visible notifications for the signed-in account. Read receipts persist in Supabase across reloads and devices; another account keeps its own unread state. Realtime updates are backed by a 30-second refresh. If the notification migration is missing or the service fails, the panel shows an unavailable state.

The complete main patch already includes `MODULE_NOTIFICATIONS_PATCH.sql` and `REGISTRATION_APPROVAL_ROLE_PATCH.sql`. Those focused files are provided for maintenance on an existing Admin/User schema; they do not replace the complete installation steps above.

## Dashboard and charts

Admin and User dashboards retain their operational data, filters and page layouts, with refreshed KPI cards, chart colors, legends, tooltips and readable totals. All five Admin charts use the updated theme. The User dashboard has a **30 / 90 / 180 / 365 days** selector that recalculates its trend and summary from dated records. Reduced-motion preferences are respected. No sample records are inserted into the live dashboard.

## Validation

`verification/access/VALIDATION.md` records local SQL, account-service and Chromium results. These checks simulate Supabase and do not modify hosted accounts or data.

Supabase reference: [Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys) documents handler authorization with `verify_jwt = false` for the new key model.
