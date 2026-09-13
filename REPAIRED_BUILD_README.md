# PGENRO IMS — Repaired Build

This build was repaired from the original `Capstone-IMS (2)(2).zip` baseline.
It does **not** use the previous V3 rewrite as its base.

## What was repaired

- Preserved existing Admin/User CRUD and authentication scripts.
- Added a conservative responsive UI layer (`shared/repaired-ui.css`).
- Added non-destructive reveal/transition animations (`shared/repaired-ui.js`).
- Rebuilt the broken Settings page using native Supabase APIs only.
- Added Account Settings navigation for Admin and User workspaces.
- Added database-backed user preferences and administrator system settings.
- Added database-driven announcement/account-request/session-timeout runtime support.
- Added the shared workspace shell to Admin Service Requests for consistent responsive behavior.

## Required database upgrade for Settings

If your existing PGENRO Supabase database is already installed, run only:

`supabase/SAFE_SETTINGS_PATCH.sql`

This patch is idempotent and does not drop operational tables.

For a brand-new database, `supabase/PGENRO_FULL_SETUP.sql` already includes the safe settings patch at the end.

## Important

Use Live Server or another local web server. Do not open protected HTML pages directly with `file://`.

If `SAFE_SETTINGS_PATCH.sql` has not been run yet, the normal IMS modules still work. The Settings page will show a clear error instead of breaking the rest of the system.
