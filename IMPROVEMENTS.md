# PGENRO IMS - Supabase Upgrade

This build replaces external Firebase connectivity with Supabase while preserving the existing PGENRO interface.

## Completed

- One shared browser Supabase bootstrap: `shared/supabase.js`
- Supabase Auth login and request-account signup
- Pending account workflow controlled by administrators
- Admin create/edit/approve/reject/activate/suspend/delete controls
- Admin password reset/change through a server-side Edge Function
- Supabase Auth ban/unban tied to account status
- Row Level Security for profiles, account-control data, and operational data
- Realtime Postgres subscriptions through the shared compatibility layer
- Plaintext-password cleanup SQL for old imported records
- Government Employee ID/PRC field removed from the request-account workflow
- Applicant self-selection of Administrator access removed

## Required before first run

Follow `SUPABASE_SETUP.md`. The only project-specific value still intentionally blank is the browser-safe Supabase Publishable/Anon key. Never put a secret/service-role key in frontend files.
