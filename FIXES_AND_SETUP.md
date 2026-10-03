# Capstone IMS — corrected UI and workflows

Updated 2 October 2026.


## Render / Docker deployment

This revision can now run as **one Docker Web Service**: the Flask application serves the existing HTML/CSS/JS and the same Python/Tesseract OCR service. The existing Supabase project remains the database, authentication and storage backend.

For deployment, use the repository-root `Dockerfile`, `requirements.txt` and optional `render.yaml`. On Render choose **Web Service → Docker**. The deployed site opens `/User/login.html`; OCR is available on the same origin at `/ocr`, with `/health` as the health-check endpoint. See `docs/DEPLOYMENT_RENDER.md`.

Local OCR startup with `User/START_OCR.bat` remains supported.

## Start the application

1. Extract this ZIP into a fresh folder. Use the complete `Capstone-IMS` folder so that the corrected lowercase filenames and module scripts stay together.
2. From that folder, run `python -m http.server 8000` (on Windows, `py -3 -m http.server 8000` also works).
3. Open `http://localhost:8000/User/login.html`. Sign in with your existing approved account. Administrator accounts open the admin workspace; ordinary accounts open the viewer workspace.

The existing Supabase project configuration is retained. No live records or account credentials were changed during this update.

## Communications upload/save correction

This revision addresses the screenshot error **“Invalid communication type. Use Incoming or Outgoing.”** The form now sends the selected direction consistently through the legacy JSON field names, including `type`, `communicationType` and `communication_type`. Document Type and the attachment MIME type remain separate. Existing flat-column tables retain their own columns.

Replace the complete application folder with this version, then restart Live Server and press **Ctrl+F5** on the Communications page. If you are copying only this correction into the previously corrected project, replace **both** `admin/admincommunication.html` and `admin/admincommunication.js`. The HTML includes a new script version to avoid using a cached copy.

Attach the document, review the required fields, and click **Save Record**. A failed save keeps the draft and selected file available for retry. Saved Communications attachments remain in the browser where they were attached; **View file** opens/downloads the retained document there.

The same error was reproduced with a strict simulated database validator before the correction. This revision passed the supported JSON direction variants, flat-column saves, attachment recovery and browser checks. The hosted validator definition was not available, so these results do not establish that the live database has been tested. This correction does not require a new SQL patch or removal of the existing validation.

## Apply the database access patch

For your existing database, run **`supabase/READONLY_USER_PATCH.sql`** in the Supabase SQL Editor after any other setup patches. It requires the existing `is_pgenro_admin()` and `is_pgenro_active_user()` functions from your supplied setup scripts.

The patch reserves operational record insert/update/delete permissions for administrators. Active user accounts retain viewing access. It preserves separate account settings and anonymous visitor kiosk policies and does not delete records. The patch is included in the ZIP; it has **not** been applied to your hosted database.

Account management calls the supplied `admin-users` Edge Function, matching `supabase/functions/admin-users/index.ts`. Deploy that existing function if it is not already deployed. Use `shared/supabase.js` for frontend configuration; server secrets belong in Supabase function settings.

## Start OCR

On Windows, run **`User/START_OCR.bat`**. It creates a local Python environment and installs `User/requirements-ocr.txt` on the first run. Keep its terminal open while reading documents.

On another system:

```bash
python -m pip install -r User/requirements-ocr.txt
python User/OCR.py
```

Install a local Tesseract executable for scanned documents. `TESSERACT_CMD` can specify its executable path. The reader listens on `http://127.0.0.1:5000`; editable document text remains readable without Tesseract. Communications and Office Memos use this local service when available and retain their browser reader fallback. Their **Stop reading** controls cancel the request and preserve the draft.

## What changed

- Consistent sidebar, navigation icons, topbar, page spacing, cards, filters and centered forms. Phone/tablet layouts wrap controls and scroll wide tables within their cards.
- Fixed broken case-sensitive HTML/CSS links and the missing Settings stylesheet reference. User modules reuse the shared authenticated client and have one data loader per page.
- Fixed Travel Orders field aliases for both flat records and JSON `data` envelopes, plus counters after an empty result.
- User Inventory and Visitors Log show records without encoding/departure controls. Administrator writes require the profile-based admin guard; editable Auth metadata cannot grant admin access.
- Account management uses the correct Edge Function name. Failed saves retain the form and display an error. Supabase integration, existing record schemas and per-module files are retained.
- Communications uploads keep Incoming/Outgoing direction fields synchronized across legacy JSON formats. Direction edits preserve attachments and unrelated record data. Older document categories, such as `Letter`, remain selected when editing their records. A direct module write also checks administrator permission.
- OCR preserves Word table labels and page breaks, reads rotated scans, separates issue/received/released dates, and ignores annex/CC authors. Memo number and registry control number remain separate. Printed signatures can continue on another page. Manual corrections survive extraction and cancellation.
- Memo routing handles flat and JSON record storage, duplicate/interrupted saves, attachment limits and failed source removal.

Duplicate old application copies under `VisitorsLog` are replaced with small forwarding pages to the corrected modules. The ZIP contains source and verification files; Python environments, Git internals and caches are omitted. Application data stays in your existing Supabase project.

## Verification

See `verification/CURRENT_VERIFICATION.md`. All 24 active pages were checked at **320, 390, 768, 1024 and 1440 px** without page/control overflow, local missing assets or uncaught browser errors. Nine administrator forms saved against simulated Supabase responses. OCR integration used the production forms, a real HTTP Flask server and local Tesseract. These checks did not modify or verify the hosted database.
