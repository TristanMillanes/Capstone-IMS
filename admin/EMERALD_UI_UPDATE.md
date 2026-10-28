# Emerald interface update — 27 October 2026

## Install

1. Back up the existing `admin/` folder in your complete application.
2. Extract this ZIP and replace that folder with the updated `admin/` folder.
3. Serve the application normally, open `admin/admin.html`, then refresh with **Ctrl+F5**. Refresh or reopen the page on mobile.

Keep the full application's existing `shared/`, `User/`, logo, authentication, database configuration, document services and other folders. This update contains the admin folder. It does not require a backend or database schema change. All edited page-owned CSS/JS references use `20261027-emerald-v6` so the browser loads this version.

## Design

- Emerald branding across all 13 modules: Dashboard, Communications, Travel Orders, Office Memos, Employees, Inventory, Visitors, Service Requests, Property Slips, User Management, Account Requests, Audit Trail and Backups.
- Deep emerald navigation, an emerald gradient dashboard header, pale green backgrounds, clear white surfaces, and a matching dark appearance.
- More defined card edges, aligned metric values, clearer heading hierarchy, stronger primary actions, and numbered quick-access tiles.
- Refined table headings, row highlights, filter controls, form fields, dialog surfaces and focus rings.
- Emerald-led chart colors with distinct colors for data categories and service statuses.
- No leaf icons or decorative heading/metric icons. Functional navigation and action icons remain. The official seal path is retained; a missing seal uses a simple P mark.

## Motion and interaction

- Brief page fades and staggered metric-card entrances.
- Smooth sidebar collapse/expand and mobile drawer movement.
- Animated profile/search/notification menus, dialog entrances, and local notifications.
- Subtle card elevation, button hover lift, press feedback and field-focus transitions.
- Motion is finite. There are no new continuous animations, animation libraries or shared runtime dependencies. Operating-system reduced-motion preferences disable the added effects immediately.
- Charts and their viewport-level tooltip retain their coordinate space. The tooltip stays immediate, without lag or animation, to preserve the earlier pointer alignment correction.

## Verification

The final version passed 52 design scenarios (36 form checks), 26 motion scenarios (18 animated form checks), 85 navigation/chart scenarios, and 345 actual pointer/touch targets across 11 configurations. The largest measured tooltip anchor error was below 1 CSS pixel. All 15 page/controller JavaScript files passed syntax checks, and all original HTML identifiers remain present without duplicates.

Current browser checks are included in:

```bash
node verification/studio-design.test.cjs
node verification/emerald-motion.test.cjs
node verification/navigation-charts.test.cjs
node verification/chart-hover.test.cjs
```

The design suite now checks the emerald appearance; its existing filename is retained for compatibility. The motion suite uses actual mouse, keyboard and menu/dialog interactions with motion enabled, then changes the operating-system reduced-motion preference at runtime. Result JSON files are beside the test scripts.

Tests use local Chromium and simulated records/service responses. They cover UI behavior and layout; the live hosted backend and physical devices were not accessed. Record handling and authorization code are retained. All original HTML identifiers and module destinations remain present. Earlier design documents and images describe previous versions.
