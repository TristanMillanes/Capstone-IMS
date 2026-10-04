# PGENRO IMS Redeploy Audit — 2026-10-04

This package was checked specifically for Render/Linux deployment where file and
folder names are case-sensitive.

## Fixed

- Added case-insensitive static-file resolution for approved application folders.
- Added canonical redirects for old/lowercase URLs such as `/user/...`.
- Added friendly `/admin`, `/user`, `/login`, `/settings`, and legacy aliases.
- Added compatibility aliases for `travelOR`, `Usermanagement`, and the existing
  `invetoryadmin.html` filename.
- Fixed the user dashboard logout/login fallback that still pointed to missing
  `../index.html`.
- Fixed the Travel Orders logo fallback that pointed to missing `brand-mark.svg`.
- Kept `/health`, `/ocr`, and `/cancel` handled by the Python OCR service.
- Kept Supabase integration and user/admin role restrictions intact.

## Route coverage checked

Admin pages:
- admin/admin.html
- admin/admincommunication.html
- admin/travelOR-admin.html
- admin/officememo-admin.html
- admin/employee-admin.html
- admin/invetoryadmin.html
- admin/visitors-admin.html
- admin/serviceAdmin.html
- admin/ics-admin.html
- admin/Usermanagement.html
- admin/requestacc.html

User pages:
- User/homepage.html
- User/communication.html
- User/travelOR.html
- User/officememo.html
- User/employee.html
- User/inventory.html
- User/visitorsView.html
- User/service.html
- User/ics.html
- User/login.html
- User/requestacc.html

Other pages:
- SettingIMS/Settings.html
- VisitorsLog/visitorsLogin.html

## Validation results

- HTML/CSS local asset references: 0 missing after fixes.
- JavaScript syntax check: passed for all `.js` files.
- Python compile check: passed.
- Canonical and lowercase route resolution checked for all deployed HTML pages.
- User operational modules remain read-only; account signup and login audit logging
  remain available where intended.
- Existing OCR/memo/communication JavaScript verification scenarios passed: 87.

## Render redeploy

If `Dockerfile` is at the root of your GitHub repository:
- Render service type: Web Service
- Language/runtime: Docker
- Root Directory: leave blank
- Dockerfile path: `./Dockerfile`
- Health Check Path: `/health`

If the repository contains one outer `Capstone-IMS` folder and the Dockerfile is
inside it, set Render Root Directory to `Capstone-IMS`.

After pushing the updated files to GitHub, use Render Auto Deploy or
**Manual Deploy -> Deploy latest commit**. Then hard-refresh the browser.
