# Frontend repairs — 4 November 2026

This update repairs the uploaded user/admin application. Use the outer `Capstone-IMS` folder as the project root.

## Fixed

- Admin dashboard: readable supporting text on the green hero and analytics cards, including the nearly invisible mobile activity caption.
- Account Settings: readable light-mode section label and description, with clearer profile initials.
- Employee Directory: readable avatar initials in dark mode.
- Visitor registration: readable live clock, date and guidance on the green welcome panel in both themes.
- Admin search fields: centered icons and consistent control alignment. Legacy form margins no longer shift toolbar inputs.
- Mobile admin layout: normal-height stacked dropdowns and a properly sized account button.
- User dashboard: consistent inner padding and gaps around the quick actions.
- Inventory: units and control numbers retain whole values; the User balance cell aligns with the rest of its table row.
- Empty admin ledgers: messages stay inside the visible part of a horizontally scrollable table.
- ICS form: section labels remain readable without clipping at 320 px.
- All 26 nested legacy HTML entry points redirect to the current root User/admin pages, preserving query parameters and bookmarks. They no longer load stale duplicate interfaces.
- Updated asset versions request the repaired frontend files after deployment.

## Run the updated system

1. Extract into a new, empty folder. Keep `admin`, `User`, `shared`, `SettingIMS`, `VisitorsLog`, `vendor`, `logo` and `supabase` together.
2. Start with `START_SYSTEM.bat` on Windows, or use the existing Python startup described in `START_HERE.md`.
3. Open `http://127.0.0.1:5000/User/login.html`. Use Ctrl+F5 once after replacing a previously deployed copy.

This frontend update requires no new SQL migration. Existing Supabase settings and backend source remain supplied. No hosted records, accounts or permissions were changed during the repair.

## Verification

The final checks passed: 280 page/theme/width cases, 390 panel/responsive cases, 26 legacy redirects, 28 theme-toggle/reload cases, six parser cases, and production syntax checks. Results are consolidated in `verification/frontend/release-2026-11-04.json`.

The current frontend checks use the production HTML/CSS/JavaScript in actual Chromium with local fixture Auth/database responses. They do not prove live backend connectivity.

- `verification/frontend/visual-regression.cjs`: both themes at 1440, 1024, 768, 390 and 320 px; gradient and solid-background contrast; search alignment; compact control heights; stock-row alignment; shortcut spacing; empty-message visibility; legacy bookmark redirects.
- `verification/appearance/contrast-layout.cjs`: editors, record details, Settings sections and public forms, including responsive widths.
- `verification/appearance/theme-behavior.cjs`: actual theme buttons, reload persistence and native control appearance on all 28 canonical pages.
- `verification/current/source-checks.py`: production JavaScript, CSS and Python syntax.
- `verification/current/letter-fields.test.cjs`: six existing text-parser cases. Its fixture loader now also loads the current header helper functions; production parser code was not changed.

Install Playwright and Chromium as described in `verification/frontend/README.md`. Set `PGENRO_CHROMIUM_EXECUTABLE` if using an existing browser binary. Run `node verification/frontend/visual-regression.cjs` from the project root. Machine-readable results accompany the checks.

The deliverable omits Git history, local development environments, cached outputs, old screenshots, redundant backup ZIPs and duplicate nested assets. Canonical application assets, OCR sources, backend SQL and templates are retained. OCR recognition accuracy and real email/storage/database integrations require the existing configured installation.
