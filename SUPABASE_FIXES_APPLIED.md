# Supabase / Functional Fixes Applied

## Shared backend
- Consolidated the entire frontend to one `shared/supabase.js` client and one persisted Auth session.
- Visitors Admin, Staff View, and Public Kiosk now use that same client.
- Added a `PGENRO_DB` compatibility facade without creating another Supabase client.
- Added `PGENRO_API.testConnection()` and `pgenro_healthcheck()` support.
- Kept the publishable key in browser code and privileged secrets only in the Edge Function.

## Visitors Log
- Fixed the Admin Visitors page not loading `visitors-admin.js` at all.
- Fixed the previous second-client/session mismatch that could cause inconsistent login state.
- Added normalized visitor columns used by the actual UI while retaining/synchronizing legacy JSON data.
- Added safe migration of existing visitor rows.
- Added automatic visitor IDs/default visit timestamps/status.
- Tightened anonymous kiosk permission: insert only the public form fields; no read/update/delete.
- Public kiosk now relies on database defaults for protected status/timestamp fields.
- Fixed case-sensitive login path for deployment on Linux/Netlify-like hosts.
- Existing enhanced Admin Visitors UI/animations are retained.

## Inventory
- Fixed a fatal JavaScript syntax error in `admin-javascript/admin-invetory.js`.
- Added atomic `record_inventory_movement()` RPC so quantity and movement history commit together.

## Authentication / authorization
- Route guards continue to validate active/approved profiles and admin roles through Supabase Auth + RLS.
- Settings registration shortcut now routes to the official Request Account flow instead of opening a second Auth session from a protected page.
- Settings password validation now matches its 8-character UI requirement.
- Admin Auth operations remain in `supabase/functions/admin-users/index.ts`.

## Database security
- RLS is enabled on exposed application tables.
- Operational tables require an active approved user.
- Deletion of operational records is administrator-only where configured.
- Visitor public access is limited to anonymous kiosk insertion.
- Secret/service-role credentials are not present in frontend files.

## Validation completed
- All external JavaScript files pass `node --check`.
- All inline HTML scripts pass syntax validation.
- No missing local HTML script/style/image references were found.
- Only one Supabase `createClient()` remains in the frontend.
- All three Visitors pages load the shared Supabase client.
- Admin Visitors page now loads its controller.

## Still required in your Supabase account
Run `supabase/PGENRO_FULL_SETUP.sql` in SQL Editor and deploy the `admin-users` Edge Function. These account-side operations cannot be applied only by editing frontend files.
