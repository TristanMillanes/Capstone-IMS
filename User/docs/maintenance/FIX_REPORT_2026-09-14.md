# PGENRO IMS Repair Report — 2026-09-14

## Main fixes applied

- Consolidated frontend database compatibility around `shared/supabase.js`.
- Removed the redundant `admin-javascript/supabase-compat.js` script include from all Admin HTML pages so two adapters no longer compete at runtime.
- Preserved legacy Admin dashboard compatibility by mapping the old `users` path to the real `profiles` table, including realtime subscriptions.
- Corrected the Admin dashboard authentication log feed from `admin_logs` to `audit_logs`.
- Centralized logout handling in `shared/supabase.js` so page-specific logout listeners cannot double-fire.
- Changed route authorization behavior so a valid Staff user opening an Admin URL is redirected to the User workspace without destroying the login session.
- Inactive/missing-profile accounts are still safely signed out.
- Temporary authorization/network errors now preserve the session and display a warning instead of causing an unexpected logout loop.
- Improved `.info/connected` compatibility to reflect browser online/offline state.
- Consolidated User shell behavior: `pgenro-user.js` owns sidebar/profile interactions while `shared/workspace.js` is accessibility/layout-only. This prevents double toggles and menu flicker.
- Added cache-busting version tags to repaired shared scripts so browsers do not continue loading stale JavaScript.
- Synchronized `supabase/schema.sql` and `supabase/COMPLETE_SETUP.sql` with `supabase/PGENRO_FULL_SETUP.sql` so all setup entry points contain the same current schema, RLS policies, settings functions, and triggers.

## Validation completed

- All project JavaScript files pass `node --check` syntax validation.
- 25 HTML pages checked: no duplicate IDs and no missing local script/style/image references.
- Existing regression suite passes:
  - 4 user-module Supabase data bridges
  - single realtime subscriptions
  - employee/travel field mapping
  - canonical row IDs
  - active navigation states
  - malformed cache handling
- Added targeted compatibility validation:
  - legacy `users` reads resolve to `profiles`
  - realtime `users` subscription resolves to `profiles`
  - connection state honors browser offline state
  - centralized sign-out API is available
- Added targeted route-guard validation:
  - Staff on an Admin route is redirected without sign-out
  - inactive accounts are signed out and returned to login

## Supabase deployment required

The frontend build is repaired, but database-side changes only become active after the project SQL is applied to the connected Supabase project.

1. Open Supabase Dashboard > SQL Editor.
2. Run `supabase/PGENRO_FULL_SETUP.sql`.
3. If the Admin user-management Edge Function has not been deployed, follow `START_HERE_SUPABASE.txt` and deploy `supabase/functions/admin-users`.
4. Serve the frontend through a web server (for example VS Code Live Server), not by double-clicking HTML files.
5. Open `SUPABASE_CONNECTION_TEST.html` and confirm the connection checks are green.

## Important security note

Keep only the browser-safe Supabase Publishable/Anon key in frontend JavaScript. Never place a `service_role` or other secret key in the browser code.
