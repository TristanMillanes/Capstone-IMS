# PGENRO IMS — Connect Everything to Supabase

Project ref: `zssrxubajhqryrwijyzm`  
Region: `ap-southeast-1`  
Project URL: `https://zssrxubajhqryrwijyzm.supabase.co`

The frontend is already wired to one shared Supabase client: `shared/supabase.js`.
All HTML pages load the Supabase SDK, then `shared/supabase.js`, then their page controller.

## 1. Add the browser-safe Publishable key

Supabase Dashboard → **Settings → API Keys** → copy the `sb_publishable_...` key.

The browser-safe publishable key is configured in `shared/supabase.js`. If you rotate it in the Supabase Dashboard, replace only the publishable key there. Never put an `sb_secret_...` key in frontend code.

## 2. Create the full database

Supabase Dashboard → **SQL Editor → New query**.
Paste the whole contents of `supabase/PGENRO_FULL_SETUP.sql`, then Run.

This creates Auth-linked profiles, account requests, operational tables, triggers,
RLS policies, realtime publication, audit tables, and the first-admin helper.

## 3. Create the first administrator

Supabase Dashboard → **Authentication → Users → Add user**.
Create your administrator email/password. Then run in SQL Editor:

```sql
select public.promote_pgenro_first_admin('YOUR_ADMIN_EMAIL');
```

Use the exact email you created.

## 4. Deploy secure admin account control

The browser never receives a Supabase secret key. Admin-only Auth actions run in:
`supabase/functions/admin-users/index.ts`.

With Supabase CLI:

```bash
supabase login
supabase link --project-ref zssrxubajhqryrwijyzm
supabase functions deploy admin-users
```

Hosted Edge Functions already receive Supabase project secrets from the platform.

## 5. Run the frontend through a web server

Do not open the HTML as `file://`.
In VS Code, use Live Server, for example `http://127.0.0.1:5500`.

Set Supabase Dashboard → Authentication → URL Configuration → Site URL to your
local or deployed frontend URL as appropriate.

## Connected flow

Request Account → Supabase Auth → Pending profile + Pending access request →
Admin review → Approve/Reject + assign role → Active user → Login → role-based
route guard → all IMS modules → Supabase Postgres + Realtime.

User-facing Communications, Employees, Travel Orders, Office Memos, Inventory,
Service Requests, ICS, Visitors and dashboard summaries are wired to the same
Supabase project. Admin pages write to the same tables, so changes synchronize
between admin and user views.
