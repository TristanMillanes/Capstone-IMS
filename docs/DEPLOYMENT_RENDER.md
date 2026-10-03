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
- `/cancel` → cancel an OCR request
- `/health` → service/OCR health check

## Supabase

The existing `shared/supabase.js` configuration is retained. Do not put a Supabase service-role/secret key in browser JavaScript or in this repository.
Use Supabase RLS for access control. Ordinary PGENRO users remain read-only for operational records.

## OCR

Tesseract is installed inside the Docker image. PyMuPDF/Pillow/Flask are installed from `requirements.txt`.
The admin Communications and Office Memo pages use the same-origin `/ocr` endpoint, so localhost is no longer required after deployment.

## Updating the live system

When Render Auto Deploy is enabled:

1. edit locally;
2. commit and push to GitHub;
3. Render rebuilds the Docker image and redeploys the service automatically.

Permanent records/files should stay in Supabase, not on Render's local filesystem.
