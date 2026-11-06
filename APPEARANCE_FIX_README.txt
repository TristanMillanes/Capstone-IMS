DARK / LIGHT MODE AND ALIGNMENT UPDATE — 3 NOVEMBER 2026

Based on your uploaded Capstone-IMS (4)(1).zip.

USING THIS FULL PROJECT
1. Extract into a NEW, EMPTY folder and open the main Capstone-IMS folder.
2. Keep admin, User, shared, SettingIMS, VisitorsLog, vendor and logo together.
3. Use your existing startup/deployment process. On Windows, START_SYSTEM.bat
   starts the combined frontend/OCR server. Open http://127.0.0.1:5000/.
4. Use Ctrl+F5 after replacing or deploying the files.

No SQL needs to be run for this appearance update. Keep your existing database.
The Service Request WITH/WITHOUT letter and optional fields from your upload
are retained. Operational User access remains viewer-only.

WHAT WAS FIXED
- Readable labels, placeholders, status badges, counters and footers in both modes.
- ICS progress/total panels, document picker buttons and employee form hints.
- User details dialogs: header badges, request values, OCR text and address fields.
- Settings labels, active navigation and radio selection follow the current theme.
- Theme switching stays selected after reload; another role's preferences do not
  replace a User's explicitly chosen mode.
- Visitor registration now has the same dark/light appearance control.
- Inspect/analytics buttons, icons and compact layouts align without clipping.

The new shared/theme-layout.css is loaded LAST by each canonical page so older
module styles cannot override these corrections. Screen-only corrections keep
printed document styles separate.

The archive excludes development environments, Git history, cached outputs,
historical screenshots and accidentally nested old project copies. Use the main
admin/ and User/ folders, rather than a second project inside User/User or User/admin.

TESTING
See verification/appearance for the current local browser results. Database/Auth
responses were simulated; no live login, hosted records or deployment was changed.
Historical reports outside that folder describe earlier builds.
