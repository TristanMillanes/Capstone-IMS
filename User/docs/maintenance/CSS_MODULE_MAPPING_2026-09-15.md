# CSS Module Mapping Fix — 2026-09-15

- Restored every Admin/User module to its existing page-specific CSS file.
- Kept only one shared shell CSS per authenticated side: `admin-ui.css` and `user-shell.css`.
- Trimmed `admin.css` to Admin Dashboard only.
- Trimmed `auth.css` to shared authentication foundation only.
- Removed obsolete consolidated/duplicate CSS files: `User/user.css`, `admin/admin-modern.css`, `admin/visitors-admin-enhanced.css`.
- Merged the existing Admin modern visual layer into `admin-ui.css` so no extra shared stylesheet is required.
- Preserved responsive button stability and profile/notification dropdown fixes in the shared shell styles.
- No new CSS stylesheet was created.
