PGENRO IMS — administrator package

Open admin/admin.html from an HTTP(S) server. The dashboard connects to ten admin modules through its sidebar and module cards. Every module links back to the dashboard, and the audit, backup and workspace preference links point to sections of admin/admin.html.

Folder layout:
  admin/   — eleven admin pages, page scripts and styles, module-owned styles and scripts, brand fallback
  shared/  — the supplied Supabase bootstrap used by all admin modules

This archive includes the supplied browser-side Supabase configuration. The official Supabase SDK, Lucide and Chart.js load from their HTML CDN URLs. Live records and administrative actions require the matching Supabase tables, edge functions, row-level access policies, network access and an authorized admin account. Do not put secret or service-role keys in frontend code.

The original admin HTML expects the official PGENRO logo at logo/enro.png, one level above admin/. That image was referenced in the uploaded ZIP but its bytes were not present. The original path is retained so the official logo displays when deployed in the full project; an included local brand-mark.svg displays if the PNG is unavailable. To ship the official logo with this archive, add its actual file as logo/enro.png alongside the admin/ and shared/ folders.

Sign Out points to User/login.html in the full PGENRO application. That login page was not supplied and is not included in this admin package. The browser-level Workspace Preferences section lives on the admin dashboard; the separate original settings page was not included in the ZIP.

Each admin module keeps its own HTML, CSS, and JavaScript. Navigation and layout match the homepage; the ICS page uses the same sizing and saved sidebar preference.

Motion: cards reveal as they enter the viewport; navigation, buttons, menus, and modals use subtle transitions. Content remains visible if scripts are unavailable, and the animations turn off when the visitor requests reduced motion.
