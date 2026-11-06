# PGENRO IMS — System-side First Admin Setup

The initial Admin account is now created from the PGENRO IMS login area. Do not create the first user manually in Supabase Authentication and do not run the old placeholder `BOOTSTRAP_FIRST_ADMIN.sql`.

## What this adds

- `User/first-admin-setup.html`: one-time setup screen linked from the sign-in page.
- `User/first-admin-setup.js`: submits the Employee Number, directory email, password, and private setup key to the Edge Function.
- `supabase/functions/bootstrap-first-admin/index.ts`: verifies the employee against the private directory, creates the Auth account server-side, links the profile, and promotes it to Admin.
- `supabase/FIRST_ADMIN_SYSTEM_SETUP_PATCH.sql`: creates a service-role-only RPC that serializes first-admin promotion.
- The endpoint refuses to create another first Admin once an active Admin exists.

## Deployment steps

1. Merge the package into the existing web project. Keep existing folders and files that are not included in this package.
2. In Supabase SQL Editor, run `supabase/FIRST_ADMIN_SYSTEM_SETUP_PATCH.sql` once. This expects the Employee Number migration to have already been installed.
3. Deploy the new Edge Function from `supabase/functions/bootstrap-first-admin/` with JWT verification disabled. With Supabase CLI:

   ```bash
   supabase functions deploy bootstrap-first-admin --no-verify-jwt
   ```

4. Add a private Edge Function secret named `PGENRO_FIRST_ADMIN_SETUP_KEY`. Use a randomly generated value of at least 32 characters. Never put this value in JavaScript, HTML, source control, or the ZIP file.
5. Deploy the updated `supabase/config.toml` configuration. Also ensure `employee-login` and `admin-users` are deployed from this package.
6. Open `User/first-admin-setup.html` on the deployed PGENRO IMS site. Enter the first Admin's Employee Number, the email recorded in the Employee Directory, the private setup key, and a password.
7. After successful setup, remove `PGENRO_FIRST_ADMIN_SETUP_KEY` from Edge Function secrets. The endpoint also permanently refuses another setup once an active Admin exists.
8. Sign in through the normal login page using Employee Number and password.

## Security behavior

- The browser never receives the Supabase service-role/secret key.
- The setup key is checked only by the Edge Function and is not saved in browser storage.
- The Edge Function verifies Employee Number + email against the employee directory before creating an account.
- Auth account creation, employee linking, and Admin promotion happen server-side.
- The promotion RPC is granted only to `service_role` and uses an advisory transaction lock to prevent competing first-admin setup requests.
- The setup is one-time. If an active Admin already exists, the function returns `409` and does not create an account.
- The first Admin's email is confirmed by the trusted server-side create-user call so the account can sign in immediately. This is distinct from ordinary employee self-registration.

## Notes

- The normal Request Account flow for staff remains unchanged.
- Existing Admin-created user management remains unchanged.
- If the employee already has a linked Auth account, this setup screen will refuse to create a duplicate. Use the existing account recovery or account-management process instead.
- `BOOTSTRAP_FIRST_ADMIN.sql` is intentionally deprecated; its old `YOUR_EMPLOYEE_NUMBER` placeholder was the source of the repeated P0001 message.
