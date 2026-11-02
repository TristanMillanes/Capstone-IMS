# PGENRO IMS Frontend / Supabase Migration Status

The frontend is wired to **Supabase** for authentication, database access, realtime changes, and administrator-controlled account management.

- Browser authentication uses Supabase Auth.
- Protected screens require an Active/Approved `profiles` record.
- Administrator screens additionally require an administrator role.
- Passwords are handled by Supabase Auth and are not stored in public application tables.
- Privileged user-management operations are handled by the `admin-users` Supabase Edge Function.
- Row Level Security policies in `supabase/schema.sql` protect account and operational tables.
- Some older page controllers retain a Firebase-shaped **local compatibility API name** (`window.firebase`) so the existing frontend modules do not need a full UI rewrite. That adapter lives in `shared/supabase.js` and routes all persistence to Supabase; no Firebase SDK is loaded.

See `SUPABASE_SETUP.md` before running the application.
