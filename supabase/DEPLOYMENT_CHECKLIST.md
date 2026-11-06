# PGENRO IMS deployment checklist

- [ ] Employee Number SQL patch applied successfully.
- [ ] First Admin RPC patch applied successfully.
- [ ] `admin-users` deployed.
- [ ] `employee-login` deployed.
- [ ] `bootstrap-first-admin` deployed.
- [ ] Verify JWT is OFF for all three functions.
- [ ] `PGENRO_FIRST_ADMIN_SETUP_KEY` added as a private Edge Function secret (32+ characters).
- [ ] `shared/supabase.js` project URL and publishable key match this Supabase project.
- [ ] First Admin setup page reports Connected / setup available.
- [ ] First Admin account created through the PGENRO IMS page.
- [ ] Setup secret removed after success.
- [ ] Read-only verification SQL reports required functions/triggers installed.

Never paste the private setup key, Supabase secret key, or service-role key into chat or browser code.
