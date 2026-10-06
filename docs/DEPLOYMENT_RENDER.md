# PGENRO IMS — Render Docker Deployment

This build serves the PGENRO frontend and the Python/Tesseract OCR API from one Render Web Service.
Supabase remains the online database/auth/storage backend.

## Render settings

1. Push this project to GitHub.
2. Render → New → Web Service.
3. Connect the repository.
4. Language/Runtime: **Docker**.
5. Root Directory: leave blank when `Dockerfile` is in the repository root.
6. Instance: Free is acceptable for testing. OCR can be slow on the free CPU/RAM allocation.
7. Deploy.

Render provides `PORT` automatically. The container starts Gunicorn and serves:

- `/` → redirects to `/User/login.html`
- `/User/...`, `/admin/...`, `/shared/...`, `/logo/...`, `/SettingIMS/...`, `/VisitorsLog/...` → web app static files
- `/ocr` → Python OCR endpoint
- `/ocr/status/<request_id>` → live page progress
- `/cancel` → cancel an OCR request
- `/health` → service/OCR health check

## Supabase

The existing `shared/supabase.js` configuration is retained. Do not put a Supabase service-role/secret key in browser JavaScript or in this repository.
Use Supabase RLS for access control. Ordinary PGENRO users remain read-only for operational records.

Run `supabase/DOCUMENT_STORAGE_PATCH.sql` once in the existing project before using new attachment uploads. It uses the approved-user/admin helper functions from your supplied setup and creates the private document bucket. The frontend stores stable object addresses and signs them when approved users open documents. This patch has not been applied by this archive.

## OCR

Tesseract is installed inside the Docker image. PyMuPDF/Pillow/Flask are installed from `requirements.txt`.
The admin Communications and Office Memo pages call the same-origin `/ocr` endpoint directly, so localhost is no longer required after deployment. Progress uses `/ocr/status/<request_id>`. The supplied configuration uses one document slot and one OCR worker for a small service, keeps PDF-library access serialized, and caches up to 64 processed scan pages. Editable documents avoid Tesseract. Change worker/DPI limits only after measuring on the target host.

## Updating the live system

When Render Auto Deploy is enabled:

1. edit locally;
2. commit and push to GitHub;
3. Render rebuilds the Docker image and redeploys the service automatically.

Permanent records/files should stay in Supabase, not on Render's local filesystem.
