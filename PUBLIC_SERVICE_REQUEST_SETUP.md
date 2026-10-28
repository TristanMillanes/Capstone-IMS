# Service Request form without sign-in

The **Service Request · Fill Up Form** button on the sign-in screen opens the Service Request form immediately. Visitors can fill it out and submit without an account.

## Apply the corrected update

1. Open your existing Supabase project and select **SQL Editor**.
2. Copy and run the entire `supabase/PUBLIC_SERVICE_REQUEST_PATCH.sql` file. This uses the existing `service_requests`, `ics_records`, and `profiles` tables and can be run again safely.
3. Replace your project source with this complete updated `Capstone-IMS` folder, then redeploy using your usual process.
4. Open the sign-in screen in a private/incognito window and click **Service Request · Fill Up Form**. Complete the required fields and submit.
5. Sign in as an administrator and open **Service Requests**. The new request appears as **Pending Review**. Click **Review** to check the submission and process it through the existing workflow. See `ADMIN_SERVICE_REQUEST_UPDATE.md` for the new review filters, automatic refresh, downloads, and printing.

The direct form address is `/User/service-request-form.html`. Links using `login.html?next=service` or `login.html?next=service-request` also open this form.

This replaces the earlier public ICS update. Use this SQL patch even if the previous ICS patch was already applied: it removes the old public ICS submission endpoint and restores authenticated ICS submission. The public ICS pages from the earlier ZIP are removed from this corrected folder. If you previously copied files over an existing folder, remove the old `User/ics-form.html`, `User/ics-form.js`, and `User/ics-form.css` files rather than leaving them deployed.

## What the form collects

- Client/requestor name, organization/LGU/barangay, contact number, and email address.
- The existing technical assistance, IEC, planting materials, environmental concerns, and certification options. A person can choose more than one category or describe an unlisted service.
- Request details and quantities, project site, date needed, requestor designation, and endorsing authority.

The service number and request date are assigned by the database. Public service numbers use the `SR-YYYY-P000001` format, with a separate counter so they work alongside the existing administrator number generator. Request dates use Philippine time.

Submissions are saved in `service_requests` with **Pending Review** status and workflow step 1. Public visitors receive their service number and submission reference. Only the authenticated workspace can view the registry or record assessment, approvals, and processing actions.

Required fields, service selections, email format, date needed, and text lengths are checked. Unchanged retries after a lost response reuse the same request reference. A new form or a page reload creates a new request reference.

If the patch has not been applied, the form displays a setup error and keeps the entered information. The source update and database patch must both be deployed before live submissions can work.

## Files to deploy

The administrator update also changes `admin/serviceAdmin.html`, `admin/serviceAdmin.css`, `admin/serviceAdmin.js`, and `admin/serviceRequestFile.js`. Keep the existing template assets and vendor files deployed.

- `User/login.html` and `User/login-modern.js`
- `User/service-request-form.html`, `User/service-request-form.css`, and `User/service-request-form.js`
- `shared/ics-records.js`, `User/ics.html`, and `admin/ics-admin.html` for authenticated ICS compatibility
- `supabase/PUBLIC_SERVICE_REQUEST_PATCH.sql`

The original archive referenced a missing `shared/ics-records.js`. The restored file is retained with authenticated access so the existing ICS pages can operate.

## Verification

From `verification/public-service/`, run:

```bash
npm install
npx playwright install chromium
npm test
```

Database tests run against local PostgreSQL through PGlite. Browser tests intercept network requests and use a local test database; they do not send records to the live Supabase project. Checks cover guest submissions, service numbering, validation, retry handling, 1440/390/320-pixel layouts, receipts, admin processing, and authenticated ICS access.
