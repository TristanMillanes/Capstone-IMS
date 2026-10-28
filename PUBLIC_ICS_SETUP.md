# ICS form without sign-in

The **ICS · Fill Up Form** button on the sign-in screen now opens the form immediately. A person can fill it out and submit it without creating an account or signing in.

## Apply this update

1. Open your existing Supabase project and select **SQL Editor**.
2. Open `supabase/PUBLIC_ICS_FORM_PATCH.sql`, copy the entire file, and run it in SQL Editor. This patch requires the existing project tables, including `profiles` and `ics_records`. It can be run again safely.
3. Replace your project source with this updated `Capstone-IMS` folder and redeploy using your usual process. Include the new files in `User/` and `shared/`.
4. Open the sign-in screen in a private/incognito window. Click **ICS · Fill Up Form**, complete the required fields, and submit.
5. Sign in as an administrator, open **ICS / Property**, and choose **Pending review**. Open the submitted record and select **Approve ICS** after checking its details.

The public form is also available directly at `/User/ics-form.html`. Old `login.html?next=ics` links forward to it automatically.

## Resulting behavior

- The form opens immediately with the same property, procurement, and accountability fields used by the existing ICS module.
- A successful submission displays its control number, ICS number, and submission reference. Keep that reference when following up with the property custodian.
- New submissions are saved in the existing `ics_records` table with **Pending** status. The administrator sees **Public form** as the source.
- The database calculates the total from quantity and unit cost. Required fields, text lengths, numeric ranges, and dates are validated.
- Submitting again with the same unchanged request after a lost response reuses the same reference instead of creating a duplicate. Reloading the page or intentionally starting another form creates a new request.
- The public page only submits forms. It does not load the office registry or expose record editing, approval, or deletion. Registry access uses the existing account permissions.
- Public submissions identify the accountable person from the form; this name is not an authenticated account identity. Administrators review the entry before approval.
- If the database patch has not been installed, the form keeps the entries and displays an error explaining that public submission needs to be enabled.

The archive was missing `shared/ics-records.js`, although both ICS pages referenced it. This update restores that module so the authenticated ICS registry, saving, and approval controls can run.

## Changed application files

- `User/login.html`
- `User/login-modern.js`
- `User/ics.html` (shared script version)
- `User/ics-form.html` (new)
- `User/ics-form.css` (new)
- `User/ics-form.js` (new)
- `shared/ics-records.js` (restored)
- `admin/ics-admin.html`
- `admin/ics-admin.js` (public submission label)
- `supabase/PUBLIC_ICS_FORM_PATCH.sql` (new)
- `README.md`

## Verification

From `verification/public-ics/`, run:

```bash
npm install
npx playwright install chromium
npm test
```

The database checks use a local PostgreSQL runtime through PGlite. Browser checks use Playwright with intercepted database requests and a local test database. They do not submit records to the live Supabase project.

Checks cover public navigation, old ICS links, signed-out access, 1440/390/320-pixel layouts, required fields and numbers, offline/database-setup errors, receipts and reset, duplicate retry protection, administrator review, and ordinary-user write restrictions. The live database patch and deployment must still be applied to activate this on your hosted system.
