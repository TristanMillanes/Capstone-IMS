# PGENRO IMS — Supabase Setup

This build is configured for:

- **Project ref:** `zssrxubajhqryrwijyzm`
- **Region:** `ap-southeast-1`
- **Project URL:** `https://zssrxubajhqryrwijyzm.supabase.co`

## 1. Add the browser-safe key

The browser-safe Publishable key is configured in `shared/supabase.js`. If that key is rotated, update only the Publishable key there. Do **not** paste a Secret key or Service Role key into any HTML/JavaScript file.

## 2. Create the database and RLS policies

In Supabase Dashboard → **SQL Editor**, run:

`supabase/PGENRO_FULL_SETUP.sql`

This creates the PGENRO tables, profile/auth trigger, access-request workflow, Row Level Security policies, and cleanup rules for legacy plaintext-password fields.

## 3. Bootstrap only the first administrator

After the schema is installed, create one user in Supabase Dashboard → **Authentication → Users**. Then edit the email placeholder in:

`supabase/BOOTSTRAP_FIRST_ADMIN.sql`

Run that SQL in the SQL Editor. That user becomes the first **System Administrator**.

After this step, do not manually bootstrap normal accounts. Use **Admin → User Management** and **Admin → Request Access**.

## 4. Deploy the secure admin Edge Function

From the project root with Supabase CLI installed:

```bash
supabase login
supabase link --project-ref zssrxubajhqryrwijyzm
supabase functions deploy admin-users
```

The function is at:

`https://zssrxubajhqryrwijyzm.supabase.co/functions/v1/admin-users`

The hosted function reads the Supabase server secret from its environment. The function supports both the current `SUPABASE_SECRET_KEYS` variable and the legacy `SUPABASE_SERVICE_ROLE_KEY` fallback. Never copy either server secret into browser code.

## 5. Recommended Auth settings

In Supabase Dashboard → Authentication:

- Configure your production **Site URL** and allowed Redirect URLs.
- Keep email/password authentication enabled.
- Set the password minimum to at least 8 characters if you want it to match the Admin User Management validation.
- Use your normal email-confirmation policy. Administrator approval also confirms an approved request through the server-side function.

## Admin control model

Applicants can request an account but cannot grant themselves Admin access. Their new profile starts as **Pending + inactive**. An active administrator assigns the final role and can approve/reject, edit name/email/contact/position/division/role, set a new password, activate, suspend/deactivate, or permanently delete the Supabase Auth user.

Suspended/inactive/rejected users are banned in Supabase Auth and are also blocked by PGENRO Row Level Security. Reactivating an account removes the Auth ban.

## Architecture note

There is only one project-side Supabase bootstrap file: `shared/supabase.js`. A few older page controllers still call a Firebase-shaped compatibility namespace for minimal UI rewrites, but that namespace is implemented inside `shared/supabase.js` and sends data to Supabase/Postgres. No Firebase SDK or Firebase project is loaded.
