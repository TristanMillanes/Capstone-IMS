# PGENRO Information Management System

On the User side, use **My Attendance** for the signed-in employee's ceremony and uniform records. Employee Profiles/Directory is Admin-only. Apply the latest auto-sync SQL patch again and redeploy the website for the current attendance-only User update.

This folder contains the application, OCR server, required assets, Supabase setup files and current installation guides.

## Start locally

Install Python 3 and Tesseract OCR, then double-click **START_SYSTEM.bat** on Windows. Open **http://127.0.0.1:5000/User/login.html** after the server starts.

For manual startup, see [FIXES_AND_SETUP.md](FIXES_AND_SETUP.md). For Docker/Render hosting, see [docs/DEPLOYMENT_RENDER.md](docs/DEPLOYMENT_RENDER.md).

## Set up accounts

Follow [UPDATE_EMPLOYEE_ATTENDANCE_AND_INVENTORY.md](UPDATE_EMPLOYEE_ATTENDANCE_AND_INVENTORY.md) for automatic Employee creation/linking during registration, private personal attendance and inventory stock movements through the pencil button. Apply the auto-sync SQL patch last and redeploy `employee-register` as described there. Login uses the employee ID and password, with `@pgenro.ims` added automatically.

Run **SETUP_FIRST_ADMIN.bat** to create **Admin001** with your chosen password after applying the SQL setup. For a new database or Admin/User access configuration, see [ADMIN_USER_SETUP.md](ADMIN_USER_SETUP.md).

## Main folders

| Folder | Purpose |
| --- | --- |
| admin | Administrator pages and operational modules |
| User | Employee pages, login, public Service Request form and OCR engine |
| shared | Shared account, database, document and settings code |
| supabase | Canonical SQL setup, patches and Edge Functions |
| vendor | Libraries and assets required by the application |
| logo | Application logos |
| SettingIMS | Settings pages |
| VisitorsLog | Visitor kiosk and compatibility pages |
| account | Compatibility login controller |
| docs | Deployment guide |

Required PDF/Word templates, fonts, icons and library licenses are included. Nested ZIP archives, duplicate SQL/docs trees, developer test fixtures, generated screenshots, temporary OCR files and historical update reports have been removed.

The source package does not apply SQL, deploy Supabase functions or create hosted accounts automatically. Follow the setup guide before using the employee ID login in your live system.
