# Studio design update — 27 October 2026

Historical version. The current emerald design and animations are described in `EMERALD_UI_UPDATE.md`.

## Install

1. Back up the existing `admin/` folder in your complete application.
2. Extract this ZIP and replace that folder with the updated `admin/` folder.
3. Serve the existing application normally, open `admin/admin.html`, then refresh with **Ctrl+F5**. Refresh or reopen the page on mobile.

Keep `shared/`, `User/`, your official logo, authentication, database configuration, OCR service and other folders in the full application. This is an admin-folder update; it does not add a backend or require a schema migration. Every edited page-owned CSS/JS reference now uses `20261027-studio-v5` to refresh cached assets.

## Appearance

- Applied the new design to Dashboard, Communications, Travel Orders, Office Memos, Employees, Inventory, Visitors, Service Requests, Property Slips, User Management, Account Requests, Audit Trail and Backups.
- Introduced navy navigation, a restrained blue accent, light neutral backgrounds and matching dark appearance.
- Reworked the dashboard introduction, metric cards, quick-access links and analytics presentation. Metric values align when labels wrap.
- Improved title hierarchy, spacing, table headers, controls, buttons and form surfaces. Phone headers use content-based sizing instead of oversized desktop flex spacing.
- Removed leaf icons from the topbar and sidebar notes, decorative header artwork, header icon tiles and redundant metric icons. Botanical glyphs were also removed from local icon registries. A missing official seal now uses a simple P letter mark; the original official logo path is retained.
- Kept functional navigation, search, editing, deleting, file, notification and other action icons.
- Matched chart colors to the new interface while retaining meaningful status colors.

## Functionality and checks

The final package passed 52 design scenarios (including 36 form checks), 85 navigation/chart scenarios, 345 actual pointer/touch targets and 18 JavaScript syntax checks. All original HTML IDs remain present without duplicate IDs. The final mouse/touch suite measured a maximum anchor error below 1 CSS pixel.

All original HTML IDs, filenames, navigation destinations and module routes are retained. The changes to module scripts are limited to the logo fallback/icon registry and dashboard chart colors. Existing record handling, access checks, document reading and data integration remain in place. The earlier navigation spacing and pointer/tooltip corrections are included.

Current checks are in `verification/studio-design-results.json`, `verification/navigation-charts-results.json` and `verification/chart-hover-results.json`. They exercise the 13-page interface at phone and desktop sizes, both appearances, form opening/closing and bounds, missing-logo fallback, absence of removed decoration, metric alignment, navigation states and actual pointer/touch targets.

Tests use simulated records and service responses, including the existing User Management access/directory service and ICS bridge. They do not change production access checks or establish that a live backend is configured. The live hosted application and physical devices were not accessed.

Run with Playwright and Chromium installed:

```bash
node verification/studio-design.test.cjs
node verification/navigation-charts.test.cjs
node verification/chart-hover.test.cjs
```

Set `UI_BROWSER_PATH` if Chromium is installed outside Playwright's cache. Older verification documents and images describe previous versions.
