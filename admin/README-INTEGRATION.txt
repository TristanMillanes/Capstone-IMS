PGENRO IMS — administrator package

Replace admin/ in your existing application. Serve the full application through HTTP(S) and open admin/admin.html. All eleven modules keep their own HTML, CSS and JavaScript. No additional shared UI file is required.

Keep your existing shared/supabase.js, logo/enro.png and User/login.html one level above admin/. These files and the hosted database/service configuration were not present in the uploaded archive and are not included here. The supplied bootstrap must initialize window.pgenroSupabase or window.PGENRO_DB.client, with PGENRO_API.requireAdmin and PGENRO_API.invokeAdmin for account administration. Do not put service-role or secret keys in browser code.

Live functionality requires the existing tables, authorization policies, administrator service and record_inventory_movement RPC documented in README.md. Backend access failures retain forms or show read-only cached/empty states. They do not report a successful server save.

Ctrl K or the Modules button opens the keyboard-accessible module switcher. Topbar record searches continue to filter their current module. All modules share the same sidebar, headers, buttons, forms and responsive table controls. Memo chart/KPI interactions filter actual registry records. Communications OCR still routes detected memorandums to Office Memos after field review and a successful save.

The application retains its pinned document reader libraries, Supabase SDK and Google Fonts CDN references. Keep network access for these dependencies. Local icons and native dashboard charts work without their icon/chart CDNs. Animations honor reduced motion. See VERIFICATION.md for verification and its limits.
