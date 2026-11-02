# PGENRO Admin — layout update v2

Updated all 13 modules: Dashboard, Communications, Travel Orders, Office Memos,
Employees, Inventory, Visitors, Service Requests, Property Slips, User Management,
Account Requests, Audit Trail, and Backups.

## Install

1. Back up your current admin/ folder.
2. Extract this ZIP and replace the complete admin/ folder with this version.
3. Keep the other project folders and services, including shared/, User/, vendor/,
   logo/, authentication, Supabase configuration, and the Python OCR service.
4. Redeploy if your hosting requires it. Refresh with **Ctrl+F5** on desktop;
   reopen or refresh the page on mobile. CSS/JS URLs use 20261013-layout-v2
   to refresh cached assets.

Existing filenames, routes, record IDs, and form element IDs are retained,
including invetoryadmin.html and Usermanagement.admin-user.v7.js.
Each module still owns its CSS and JavaScript; no new shared UI file is required.

## What changed

- Replaced conflicting heading placement with an explicit grid. The module icon,
  breadcrumb, title, description, and action buttons have separate space.
- Reserved input space for leading icons and keyboard hints. Search and form
  text no longer run underneath decorations. Removed duplicate search borders.
- Made navigation, topbars, buttons, breadcrumbs, cards, registry controls,
  table spacing, dialog surfaces, and footers consistent across modules.
- Reduced oversized cards while allowing their labels and existing links to grow.
  Long names, emails, offices, and row actions wrap within their cells.
  Wide registries scroll within their table containers.
- Kept dialog headings and action buttons visible with scrolling form bodies.
  Phone inputs use 16px text and phone controls have 44px touch targets.
  Dialogs respond to the visual viewport and safe-area spacing.
- Corrected dark-mode surfaces and text in employee and travel forms, service
  steps, validation fields, and profile controls. Separated travel preview labels
  and values so they remain readable.
- Removed 124 exact duplicate CSS rules, reduced unused per-module icon maps,
  and removed decorative animation observers for hidden effects.
  CSS/JS together are approximately 5% smaller than the previous unified version.
  Notification fallback polling runs every 60 seconds when visible and online;
  real-time subscriptions and manual refresh remain available.

Module actions, authorization checks, record mapping, document parsing, and
existing OCR integration were retained. This admin-only package contains no
Python backend source or backend migration.

## Verification of this version

Passed **91 rendered page/device scenarios** in local headless Chromium with
sample Supabase responses. All 13 pages were checked at:

- 320 × 860 and 390 × 860 phones;
- 768 × 1024 tablet and 1024 × 860 laptop;
- 1440 × 900 desktop;
- 1916 × 1080 desktop with the sidebar collapsed;
- 844 × 390 landscape.

Populated registries used long names, emails, offices, and subjects.
Checks measured sibling overlaps, input icon/text spacing, row action groups,
page overflow, metric content, dialog bounds, every visible form field, footer
placement, mobile navigation, long profile menus, and light/dark switching.

Additional checks passed for 11 entry/detail dialogs after reducing viewport
height to 460px, dark input text contrast, all three service form steps, and the
employee profile. JavaScript syntax and CSS parsing passed; all original HTML
IDs were preserved without duplicates.

A native-browser workflow passed using a sample text letter: upload, extraction
of its printed sender name, date and subject, attachment save to simulated
storage, and rendering the saved record. The sample sender was
Ma. Cristina de los Santos-Villanueva. The retained memorandum/date parsers
also passed 22 behavior checks using an updated local test harness.

These are local fixture checks. Live Supabase permissions, production document
storage, image OCR recognition accuracy, the Python service, physical mobile
hardware, and Safari/Firefox were not tested in this update.

The existing verification/ folder and earlier verification documents belong to
older versions. Their DOM stubs and parser extraction markers do not fully match
this version. This document records the current checks. No new browser
screenshots were added to the deliverable.
