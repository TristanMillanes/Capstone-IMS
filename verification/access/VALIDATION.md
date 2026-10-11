# Admin/User, notifications and dashboard validation — 10 October 2026

## Continuation verification — 11 October 2026

Recovered the final requested additions and verified the complete saved build: two access roles, requested/final approval roles, per-module notifications, and modern Admin/User dashboards and charts. Re-ran the actual production SQL/account-service suite (**22 groups**), Chromium feature suite (**10 groups**, including all **21 mobile workspace pages**), and Chromium access suite (**9 groups**). All passed. All **28 JavaScript files** in the Admin, User, Settings, shared and account folders passed syntax checks.

Expanded `VERIFY_ADMIN_USER_SETUP.sql` to inspect requested/final role history, notification functions, both notification tables, all ten new-record triggers, and their policies. Its **eight read-only queries** passed against a fresh local setup, with **10/10 enabled module triggers** and **2/2 notification tables**. Added `UNAHIN_ITO.md` with concise installation steps. Inspected the regenerated Admin and User dashboard screenshots; these internal screenshots are excluded from the release archive.

This continuation did not change hosted Supabase data or deploy the application. The navigation/logout results described below are retained from the previous build; that suite was not re-run during this continuation.

Passed **22 database/account-service scenario groups**, **10 feature browser groups**, the mobile notification/layout check across **21 authenticated pages**, **9 access/UI regression groups** and **27 navigation/logout scenarios**. All 27 JavaScript files checked in the Admin, User, Settings and shared folders parsed successfully. These checks use local production source with simulated Supabase services; no hosted data or deployments were changed.

## Database and account service

The actual complete setup and migration SQL were executed and re-executed in PGlite PostgreSQL 18. Supabase's Auth schema, database roles and realtime publication were represented locally. The extension installation command was omitted because the embedded PostgreSQL already provides the UUID function used by this schema. No other production SQL statements were omitted.

Checks covered legacy role migration, directory pagination and return types, profile RLS, denied User writes, read-only records, Settings edits, banned Admin sessions, final-Admin protection including Auth deletion cascading, anonymous denials and the SQL-only Admin bootstrap. The legacy VARCHAR/timestamp fixture reproduced PostgreSQL error 42804 with the earlier directory RPC; the focused repair and complete migration restored its results.

Signup tests verified that an Admin request is retained while the profile remains an inactive Pending User. The focused backfill recovers legacy pending selections without granting access or changing reviewed requests. The actual Edge Function was transpiled and exercised against a local Supabase simulation. All four requested/final Admin/User combinations passed, preserving the original requested role and agreeing on the final profile/Auth role. An explicit final role is required; rejection keeps the requested role with no assigned role. Auth validation, unsupported roles, self-access protection, concurrent changes, bans, rollbacks and compatible responses also passed.

Notification checks exercised inserts in all eight operational modules plus the two Admin account modules. They verified normalized visitor titles, no duplicate alerts on updates, no historical-record replay when setup is rerun, User/Admin visibility, rejected client-forged notices, per-account read receipts, single/module/all read actions and later inserts remaining unread. Anonymous, Pending and banned accounts could not read the feed.

## Browser

Real Chromium loaded the supplied HTML, JavaScript and CSS with simulated Supabase responses and the actual Chart.js library. Registration submitted both chosen roles correctly. Review and quick approval supported overriding either requested role; bulk approval required a final role. Realtime inserts changed the bell and corresponding sidebar badge; read status survived navigation. User visibility, keyboard dismissal and unavailable-service states passed.

All five Admin charts rendered fixture counts with the modern theme, center totals and reduced-motion behavior. The User period selector included/excluded actual dated records and updated the trend summary. Notifications mounted once on every authenticated page, and all 21 mobile pages and open panels stayed within the viewport. The feature suite regenerates `modern-admin-dashboard.png` and `modern-user-dashboard.png` for visual review.

The access regression suite passed direct Admin entry, only Admin/User choices, account creation, revocation cleanup, User/signed-out redirects, inline database error handling, mobile forms, disabled JavaScript and profile-based login routing. The navigation/logout suite passed confirmation, cancellation, focus, responsive bounds, logout retry, slide navigation, browser back and reduced motion. JSON results are included; older generated screenshots are omitted from the distribution to keep the archive small. Test scripts recreate their screenshots when run.

## Reproduce

With Node 24+, Playwright, PGlite and Chromium installed in a test environment, run from the project root:

```bash
node verification/access/admin-user-security.cjs
node verification/access/roles-notifications-dashboard.cjs
node verification/access/admin-user-browser.cjs
node verification/ui/navigation-logout.cjs
```

Set `PGENRO_CHROMIUM_EXECUTABLE` to an installed Chromium executable when needed. Tests use local HTTP serving and mocked Supabase/CDN responses. The hosted Auth integration and project-specific triggers require validation after the included SQL and Edge Function are installed.
