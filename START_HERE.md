# PGENRO IMS — corrected system, 3 November 2026

## Run this copy

1. Extract the complete ZIP into a **new, empty folder**. Use the outer `Capstone-IMS` folder as the project root. Keep `admin`, `User`, `shared`, `SettingIMS`, `VisitorsLog`, `vendor` and `supabase` together.
2. Install Python 3.11 or later and Tesseract if they are not already installed. Put Tesseract on PATH, or set `TESSERACT_CMD` to its executable.
3. On Windows, double-click **`START_SYSTEM.bat`**. It creates/reuses `User/.venv`, installs the supplied OCR requirements, and starts the combined website/OCR server. Keep the command window open.
4. Open **http://127.0.0.1:5000/User/login.html** and sign in with an existing approved account. After replacing an older installation, use Ctrl+F5 once.

For manual startup from the project root:

```bash
python -m pip install -r requirements.txt
python ocr_server.py
```

Open the HTTP address above. Opening HTML through `file://` does not provide the application server or OCR API. `User/START_OCR.bat` now starts this same combined server.

Do not extract this project inside the old `User` folder. Accidental nested whole-project copies were removed from this package; legacy nested HTML bookmarks now redirect to the canonical pages.

## Corrections in this build

- Admin appearance controls and related workspace controls initialize once against the current markup. A removed heading selector previously prevented initialization on several modules.
- Desktop account filters use a compact row with responsive grids on smaller screens. Settings notifications, appearance and sign-out stay together in the header.
- Settings accepts both approved Admin and User sessions. It returns each role to the correct workspace and uses one appearance controller for theme preview, saved preferences and reloads.
- User Management loads one canonical controller and defaults to the bundled **`admin-users`** Edge Function. Old cached controller URLs load the canonical version. An explicit installation-specific function override is still supported.
- When newer account-directory RPCs are absent, User Management uses the existing bundled Admin-check/profile/directory RPCs. Compatibility activates only for a missing function; a permission failure blocks access. Legacy edits go through the existing server account function.
- The combined Flask server serves Chart.js, PDF modules/workers, PDF rendering resources, fonts and official PDF/Word templates with their browser-compatible MIME types. Python, SQL and non-public source paths remain excluded.
- Updated script URLs prevent older cached scripts from mixing with the corrected frontend.
- Windows startup launches the full application, rather than only the OCR API.

The previous User viewer improvements are included: direct **View file** actions, PDF page controls and read-only operational registries. The removed Service Request tracking stepper stays removed. Public submission forms retain their existing purpose.

## Existing backend

The supplied Supabase configuration, SQL patches and Edge Function source are retained. This repair did **not** run SQL, deploy functions, change database permissions or modify hosted records.

An already configured installation can use the corrected frontend with its existing backend. If the account service or database setup is missing, follow `ADMIN_USER_SETUP.md` and the bundled `supabase/ADMIN_USER_ACCESS_PATCH.sql` / `supabase/ADMIN_USER_DIRECTORY_RPC_FIX.sql` instructions. The default account function is `supabase/functions/admin-users`. Attachment setup is documented in `FIXES_AND_SETUP.md`; public Service Request setup is in `PUBLIC_SERVICE_REQUEST_SETUP.md`.

## Verification

Current results are in `verification/frontend/` and `verification/current/source-results.json`. Older reports elsewhere in `verification/` describe earlier builds.

- 21 functional browser checks passed using the actual Flask server and production frontend, with local Supabase/Auth/Storage fixtures. These cover both account-directory contracts, role denial, Admin/User settings, eight Admin editors and saves, five mobile private PDF viewers, official PDF/Word generation, navigation and logout.
- 28 main pages were reviewed at 1440, 1024, 768, 390 and 320 px: no uncaught JavaScript errors, missing local assets or page-width overflow in these scenarios.
- All 201 local script/stylesheet references passed server checks, alongside six module/document asset checks, six legacy redirects and seven blocked source paths.
- Syntax checks passed for 43 JavaScript files, 40 stylesheets and three production Python files.

No live backend was contacted by these tests. Real credentials, deployed RLS/storage policies, real account emails and printer output still require checking in your configured installation. OCR recognition accuracy was not re-benchmarked for this frontend repair.
