# Public Service Request form

**Service Request · Fill Up Form** on the sign-in screen opens the Service Request form without signing in. Employees still use authenticated access for ICS and the ordinary User workspace.

## Setup

1. Install the base schema and account helpers as described in [ADMIN_USER_SETUP.md](ADMIN_USER_SETUP.md).
2. Run the entire `supabase/PUBLIC_SERVICE_REQUEST_PATCH.sql` in the existing Supabase project's SQL Editor.
3. Deploy the application and open `/User/service-request-form.html` in a private/incognito window.
4. Submit a request, then sign in as an Admin and review it in **Service Requests**.

The public Service Request patch also disables the earlier public ICS submission endpoint and retains authenticated ICS access. Preserve the Employee ID login patch as the final account patch when applying older setup files.

The admin Service Requests page supports review, filtering, status changes, document downloads and Print Form. Its PDF/Word templates, layout metadata, fonts and document libraries are required and are included in this clean package.
