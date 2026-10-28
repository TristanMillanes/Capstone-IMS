# Service Requests: administrator review and printing

This update completes the administrator side of the public Service Request form. Open **Service Requests** from the administrator sidebar.

## Deploy

1. Replace the deployed project with the updated `Capstone-IMS` folder and redeploy using your usual process.
2. If the earlier public Service Request update has not been activated yet, run `supabase/PUBLIC_SERVICE_REQUEST_PATCH.sql` in Supabase SQL Editor. If that patch is already installed, this administrator update requires no additional SQL.
3. Refresh the administrator page after deployment. The page's JavaScript and CSS version numbers have been updated so the browser can fetch the changed files.

The four changed application files are `admin/serviceAdmin.html`, `admin/serviceAdmin.css`, `admin/serviceAdmin.js`, and `admin/serviceRequestFile.js`. Keep the existing `admin/vendor` and `admin/assets/service-request` folders deployed; they provide the official template and document tools.

## Review a submission

1. Click **Show pending requests**, or choose **Pending Review** in the Status filter.
2. Choose **Public form** in the Source filter to see submissions from the form that opens without sign-in. **Office entry** identifies requests encoded in the authenticated workspace, including earlier records.
3. Search by service number, client, organization, contact, service scope, or submission reference.
4. Click **Review** to open a pending request. Public entries display their submission reference and time. Their assigned service number and request date are read-only. The client's original submission metadata is retained when the request is saved.
5. Check Client Info and Service Scope. Update the status and complete the assessment and processing details in Course of Action.
6. Click **Save & View File**. The registry and request counters update, and the completed official form opens.

Requests refresh when the workspace regains focus and every 30 seconds while the page is visible and online. Existing realtime updates are also retained. Refreshing the registry does not replace unsaved entries in an open form. A connection failure displays the last available registry with a connection notice; saving stays blocked until a successful refresh.

## Download and print

- **View File** generates the official form from the selected saved request.
- **Download PDF** and **Download Word** download the filled documents.
- **Print Form** prepares every page of the completed form and opens the browser's print dialog. Select your printer or Save as PDF. The form uses 8.5 × 13 inch paper; keep the original paper size and disable browser headers and footers if your browser adds them.
- Long entries are carried onto continuation pages, which are included when printing.
- **Export CSV** exports the registry's current search and filters. The Summary Masterlist's export includes all requests.

The browser prepares the print document; selecting a printer and confirming printing remain administrator actions.

## Verification

Run `npm install`, install Chromium with `npx playwright install chromium`, then run `npm test` from `verification/public-service`.

The checks use a local database and browser fixtures, without changing the live Supabase project. They cover public submissions, validation and retries, protected registries, authenticated ICS access, administrator review, status and source filters, searchable references, filtered CSV export, preserved submission metadata, real PDF and Word generation, print preparation including continuation pages, automatic refresh, connection recovery, and desktop/mobile layouts.
