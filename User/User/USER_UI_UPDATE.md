# User interface update — 1 November 2026

## Apply this update

1. Keep a backup of the current source folder.
2. Extract this ZIP. Replace the complete **User** folder in your project with the supplied **User** folder. Copy the new files as well as the edited files.
3. Restart your usual local server or redeploy your source as you normally do.
4. Open the User sign-in page and press **Ctrl + F5** to reload the styles.

This interface update does not require a new SQL patch. Use the same existing Supabase configuration and application startup instructions.

## Changes

- One shared theme controller for all 13 User pages, including sign-in, account requests and the public forms. Both theme attributes and the appearance button stay synchronized.
- Saved light/dark appearance survives navigation, reload and switching tabs. Invalid preferences and blocked storage do not break the appearance toggle.
- Shared workspace CSS and layout/navigation helpers replace repeated copies in the module files.
- Consistent evergreen sidebar, clearer headings and cards, distinct status colors and readable dark-mode tables, fields, dialogs and notices.
- Removed the extra illustration on the account request page.
- Compact module headers and mobile controls; the long ICS reference no longer pushes the phone layout outside the screen.
- Preserved the existing module IDs, routes, form fields and account/record workflows.

## Files to keep together

The User folder now includes **user-theme.js**, **user-workspace.js**, **user-workspace.css**, **user-polish.css**, and module-specific **homepage-details.css**, **communication-details.css**, **ics-details.css** and **travelOR-details.css**. Keep these files with the existing module styles and scripts. Each page loads the shared assets once.

## Verification

- 38 browser scenarios passed with local fixture records and a simulated Supabase client.
- All 13 User pages checked in light and dark mode at 1440, 1024, 768, 390 and 320 pixels.
- Checked theme persistence and cross-tab updates; desktop collapse/mobile menu; notification panels; six record-detail views; search and refresh; read-only inventory; sign-in password visibility; form validation, ICS calculation and reset.
- No uncaught JavaScript errors or duplicate element IDs were found in the exercised pages. Local asset links and User JavaScript syntax checks passed.
- The checks did not access or modify a live database. Real account permissions, live submissions and deployment connectivity still depend on the existing installation.

Browser test source and the results are in **verification/user-ui**. To rerun, install Playwright and Lucide in your development environment, install the Playwright Chromium browser, then run `node verification/user-ui/user-ui.test.cjs`. Set `PGENRO_CHROMIUM_EXECUTABLE` only if you use a custom Chromium installation.

## ZIP contents

The ZIP contains the complete application source and required assets. Machine-specific environments, Git history, Python caches, temporary OCR uploads and historical verification screenshots are excluded. Install Python packages using the existing requirements files when setting up a new machine.
