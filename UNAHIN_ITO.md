# PGENRO — latest update

Kasama ang lahat ng huling pinagawa:

- Admin at User lang ang access roles. Direktang may access sa User Management ang active Admin.
- Sa registration, pipili ang applicant ng Admin o User bilang requested role.
- Sa approval, puwedeng piliin ng Admin ang final Admin o User role, kahit iba sa requested role.
- May notification bell at badge kada module kapag may bagong record. May sariling read status ang bawat account.
- Mas modernong Admin/User dashboards at charts, kasama ang period selector sa User chart.
- Naka-retain ang Supabase, OCR, at kasalukuyang modules.

## Pag-install sa existing project

1. Sa **Supabase → SQL Editor**, i-paste at i-run ang buong `supabase/ADMIN_USER_ACCESS_PATCH.sql`. Walang email placeholder na kailangang palitan sa file na ito.
2. I-deploy ang updated **admin-users Edge Function** gamit ang `supabase/functions/admin-users/index.ts`. TypeScript ito para sa Edge Function; ang `.sql` file lang ang ilalagay sa SQL Editor. Mula sa project folder:

   ```bash
   supabase functions deploy admin-users --project-ref zssrxubajhqryrwijyzm --no-verify-jwt
   ```

3. I-redeploy ang buong application folder. Mag-refresh at mag-sign in ulit.
4. I-run ang `supabase/VERIFY_ADMIN_USER_SETUP.sql` para makita ang Admin/User roles, request history fields, notification functions, tables, at module triggers.

Hindi pa na-apply ang files na ito sa hosted Supabase project. Kailangan ang SQL migration, Edge Function update, at application redeployment para gumana ang buong update online.

Kung bagong Supabase project, gamitin ang `supabase/COMPLETE_SETUP.sql`. Kung wala pang active Admin, sundin ang optional `supabase/BOOTSTRAP_FIRST_ADMIN.sql`; doon lang kailangang ilagay ang email ng existing Auth account.

Nasa `ADMIN_USER_SETUP.md` ang mas detalyadong setup at account behavior. Nasa `verification/access/VALIDATION.md` ang local verification results.
