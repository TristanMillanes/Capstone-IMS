# UI refresh verification — 6 October 2026

This report records the earlier Calm Workspace refresh. The current Modern Workspace design and results are documented in `MODERN_UI.md` and `ui-modern.json`. Current screenshots are in `previews/`.

All eleven admin pages were exercised in headless Chromium at 320, 390, 768, 1024 and 1440 px widths. A separate 1440 × 480 scenario checks the profile menu on a short screen and reduced-motion behavior: 56 UI scenarios total.

The checks cover page and card overflow, toolbar spacing, profile and notification menus, sign-out icon/label spacing, mobile navigation, collapse/expand controls, keyboard focus return, the fourteen-destination module switcher, and available record-creation dialogs. Form content remains scrollable without horizontal overflow, and form action buttons remain within the viewport. Dynamically inserted icons render locally and retain inline sizing. All pages run without JavaScript exceptions in the simulated environment.

All eleven JavaScript files pass `node --check`. The supplied regression suites pass: 11 parser/dashboard scenarios, 25 memorandum-routing scenarios, and 20 communication-upload scenarios. A source comparison confirms that database, authorization, OCR, chart and record-controller code is unchanged apart from the icon renderer and added presentation behavior.

Browser tests use an empty simulated Supabase client and block external libraries/fonts. They verify the offline icon and font fallback behavior. No live database, login, Edge Function, OCR server or stock RPC was modified or verified. The shared integration files were absent from the supplied archive and must remain in the existing project.

Historical detailed results: `ui-refresh.json`. The previous screenshots have been replaced by the current previews.

The application needs no new dependency. For optional verification, install Playwright in your test environment and its Chromium browser, then run `node verification/ui-refresh.test.cjs` from admin/. `UI_BROWSER_PATH` may point to an already installed Chromium executable. Run the original `memo-parser.test.cjs`, `memorandum-routing.test.cjs`, and `communication-upload.test.cjs` from the same verification folder.
