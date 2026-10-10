# PGENRO Information Management System

Modern interface, slide navigation and logout confirmation update, 10 October 2026. See `UI_MODERN_3D_UPDATE.md` for the refreshed design, faster paginated registries and verification, and `UI_NAVIGATION_LOGOUT_UPDATE.md` for transitions and the system confirmation dialog. Supabase integration, OCR and ordinary-user read-only workflows are retained.

Before saving new shared attachments, run `supabase/DOCUMENT_STORAGE_PATCH.sql` in your existing Supabase project. Follow `FIXES_AND_SETUP.md` for local startup and deployment.

## Main folders

- `admin/` — administrator workspace and write-enabled operational modules.
- `User/` — authenticated user/viewer workspace. Operational records remain read-only for ordinary users.
- `shared/` — shared Supabase client, runtime settings and OCR field helpers.
- `supabase/` — database setup/patch SQL and Edge Functions.
- `SettingIMS/` — account/workspace settings UI.
- `VisitorsLog/` — visitor kiosk/forwarding pages retained for compatibility.
- `logo/` — application logos.
- `verification/` — source verification fixtures/results; excluded from the Docker image.
- `docs/` — maintenance and deployment notes.

## Deployment files

- `Dockerfile` — installs Python 3.11, Tesseract and the OCR dependencies.
- `requirements.txt` — Python dependencies for the deployment service.
- `ocr_server.py` — serves the frontend and OCR API from one Flask application.
- `render.yaml` — optional Render Blueprint configuration.
- `.dockerignore` — keeps tests, caches and runtime uploads out of the Docker image.
- `.gitignore` — keeps local environments, temporary OCR files and secrets out of source control.

## Production entry points

- `/` → `/User/login.html`
- `/ocr` → full-document OCR API
- `/ocr/status/<request_id>` → live page progress
- `/cancel` → cancel an OCR request
- `/health` → deployment/OCR health check

## Access boundary

Administrator modules retain encoding/edit/delete workflows. Ordinary user modules are designed for authenticated viewing, filtering, printing and export only. The user Employee Directory now displays additional safe read-only employment and education fields that are available in the administrator record, while admin-only HR identifiers and sensitive fields are intentionally not exposed.

See `docs/DEPLOYMENT_RENDER.md` for deployment steps and `FIXES_AND_SETUP.md` for application notes.
