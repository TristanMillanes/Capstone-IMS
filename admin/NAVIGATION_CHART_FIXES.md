# Navigation and charts — 27 October 2026

The current package also includes the subsequent pointer/tooltip correction documented in `CHART_HOVER_FIX.md`.

## Install

1. Back up the existing `admin/` folder in your full application.
2. Extract this ZIP and replace that `admin/` folder with the updated one.
3. Open `admin/admin.html` through your existing HTTP/HTTPS server and refresh with **Ctrl+F5**. Refresh or reopen the page on mobile.

Keep your existing folders outside `admin/`, including `shared/`, `User/`, `logo/`, your authentication and Supabase configuration, and the OCR service. This is an admin-folder update. It does not contain the full application backend or require a database migration. CSS/JS cache versions were updated on every page that references the edited assets.

## Navigation

- Applied the same spacing to Dashboard, Communications, Travel Orders, Office Memos, Employees, Inventory, Visitors, Service Requests, Property Slips, User Management, Account Requests, Audit Trail and Backups.
- Removed the combined group margin and inherited flex gap that made the menu appear to skip rows. Groups no longer shrink when the menu needs to scroll.
- Kept a consistent 76 px header, 44 px navigation rows, 4 px row gaps and 16 px group gaps. Collapsed menus use a continuous 4 px gap between rows.
- Corrected inherited sidebar minimum widths. The main content aligns with the 254 px expanded sidebar and the 78 px collapsed sidebar.
- Retained all fourteen existing destinations, including Preferences. Short screens scroll within the menu so the last links remain reachable.

## Dashboard charts

- Bundled Chart.js 4.5.1 and its MIT license in `admin/vendor/`. The dashboard now loads that file directly; its previous chart path pointed outside this archive.
- Kept the five charts: activity over time, activity by module, service request status, personnel by division and communications flow.
- Moved doughnut category names and record totals into readable legends outside the canvas. Click or use the keyboard to show/hide a category; the centre total follows visible categories. Legends switch to one column when two columns would split category words.
- Increased label readability and made activity points visible. Chart sizes follow their dedicated containers when the screen or sidebar changes.
- Corrected the personnel axis callback so long division names show an ellipsis. Hovering a bar retains the full division name. Large division lists scroll inside their card.
- Retained reporting-period filters, refresh, export, empty-data messages, cached records, light/dark appearance, and the native chart fallbacks when the chart library cannot load.

## Verification

The included `verification/navigation-charts.test.cjs` passed 85 local Chromium scenarios with simulated Supabase responses:

- All 13 pages at 320, 390, 768, 1024 and 1440 px, including expanded/collapsed or mobile menus as appropriate.
- All 13 pages with dark navigation, plus short 844 × 390 landscape menus.
- Five dashboard charts with populated data, both appearances, readable plot areas, category toggles and keyboard activation.
- Historical data and reporting-period changes, refresh, empty registries, 40 personnel divisions, existing cache data and a blocked chart-library request.

All 15 top-level JavaScript files passed `node --check`. Other module controllers are byte-for-byte unchanged from the supplied archive. No production sign-in, database permissions, hosted data or OCR service was tested or modified.

Run the browser checks with Playwright/Chromium installed:

```bash
node verification/navigation-charts.test.cjs
```

Optionally set `UI_BROWSER_PATH` to a locally installed Chromium executable. The current result summary is `verification/navigation-charts-results.json`; older verification files describe earlier updates.
