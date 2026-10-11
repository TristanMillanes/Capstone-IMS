Current navigation, dark-mode, chart and PDF update: see [UI_NAVIGATION_PDF_UPDATE.md](UI_NAVIGATION_PDF_UPDATE.md).

# PGENRO Information Management System

Updated 11 October 2026: consistent Admin/User UI, responsive controls and dialogs, separate Audit Trail and Backup modules, and repaired chart containers and updates. See [UI_FULL_SYSTEM_UPDATE.md](UI_FULL_SYSTEM_UPDATE.md) for applying this full source update and its verification.

Updated 10 October 2026: the system uses **Admin** and **User** access. Active Admins open User Management directly through the normal Admin workspace. Registration saves the requested Admin/User role, and approval lets an Admin choose either final role. Persistent per-module notifications, unread sidebar badges and modern Admin/User dashboards are included, with a new period selector on the User charts. Run the entire latest `supabase/ADMIN_USER_ACCESS_PATCH.sql`, deploy the updated `admin-users` Edge Function and redeploy the full application, including when the earlier Admin/User update is already installed. The patch includes the account-list return-type repair. See [ADMIN_USER_SETUP.md](ADMIN_USER_SETUP.md) for installation and optional first-Admin setup.

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
