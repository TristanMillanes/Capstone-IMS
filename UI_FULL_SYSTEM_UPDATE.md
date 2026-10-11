# Full system UI update — 11 October 2026

This package contains the complete application source with the UI update applied across all 26 pages.

- Admin modules now use consistent sidebars, topbars, compact page headers, cards, controls and table presentation.
- User modules use the same emerald visual style, with responsive layouts and their existing viewer actions.
- Tables scroll within their own regions. Filters, actions, forms and dialogs fit narrow screens.
- Audit Trail remains a separate module: `admin/audittrail-admin.html`, `admin/audittrail-admin.css`, and `admin/audittrail-admin.js`.
- Backup is now a separate module: `admin/backup-admin.html`, `admin/backup-admin.css`, and `admin/backup-admin.js`.
- All admin navigation and module palettes link directly to Audit Trail and Backup. Older `admin.html#audit` and `admin.html#backup` bookmarks redirect to those modules.
- Both chart dashboards use dedicated canvas containers. Legends and summaries have their own space. Chart instances are reused during period changes and realtime updates; theme changes refresh chart colors.
- User chart dates follow the same module-specific fields and Philippine calendar days as the admin dashboard. Time-only and invalid dates are skipped.
- Backup supports local JSON export, import review, cancellation, validation and rollback if storage fills up. It copies local browser caches and preferences; it does not export or restore the Supabase database or cloud attachments.

## Apply the update

1. Extract this package and replace the application source with the included `Capstone-IMS` folder. Use the complete updated folder, including `admin`, `User`, `SettingIMS`, `VisitorsLog`, and `shared`.
2. Keep your existing deployment environment configuration and Supabase project. This UI update adds no database migrations. Existing setup instructions and SQL/Edge Function files remain included.
3. Redeploy with your existing Docker/Render workflow, or start the application as described in `FIXES_AND_SETUP.md`.
4. Reload the browser after deployment. Page references include a new version so updated CSS and JavaScript load together.

The package includes application code, logos, backend/deployment files, SQL patches and verification scripts. Reproducible local environments, caches and old generated verification screenshots are excluded. For local Python use, install the included requirements in your local environment; the Docker build installs them automatically.

## Verification

The current browser checks use actual HTML/CSS/JavaScript and Chart.js with a simulated Supabase SDK. They passed:

- 26 pages at five widths: 320, 390, 768, 1024 and 1440 pixels.
- 30 record-dialog viewport checks, plus mobile module-menu bounds.
- 14 workflow checks covering chart sizing, legends, period/theme updates, realtime instance reuse, chart fallback, backup export/review/restore/rollback, legacy bookmarks, and logout cancellation.
- JavaScript syntax, CSS parsing, duplicate IDs and local stylesheet/script references.

No runtime JavaScript errors were observed in these checks. Live Supabase, real accounts, cloud attachments and the OCR service were not exercised. Supabase integration, SQL, Python backend code and ordinary-user record permissions are retained.

Run `npm run test:unified` in `verification/ui` to repeat the current browser suite after installing its dependencies. See that folder's README for details and the included JSON reports for the checked scenarios.
