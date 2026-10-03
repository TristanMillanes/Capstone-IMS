# Verification — interactive PGENRO administrator package

Verified on 1 October 2026 using actual headless Chromium and simulated Supabase responses. The browser runs the supplied page scripts and styles. Production records contain no seeded test rows.

## Interface and navigation

The eleven modules share a 275 px sidebar, 78 px collapsed sidebar, 70 px topbar and 36 px navigation items. All fourteen navigation destinations resolve to included pages or dashboard sections. Every JavaScript page parses successfully.

The workspace scenarios exercise all eleven pages at 320, 390 and 768 px, with desktop interaction at 1440 px. Checks include the module switcher, all fourteen results, empty results, arrow-key selection, Enter navigation, Escape focus restoration, mobile menus, height changes, dialog bounds and page overflow. Separate browser checks cover the existing profile/notification menus and sidebar preference.

Office Memo chart bars and KPI cards filter actual records. Month filtering, active-filter summaries, sorting, selection, pagination, refresh and CSV export are verified. Mobile table scroll buttons expose wide columns. Native field errors clear after correction. A delayed employee save retains its draft, locks the form and blocks another form or module switcher. Cached-navigation lifecycle events preserve the busy observer.

## Existing workflows

Browser regression checks cover employee CRUD, unique IDs, profile dialogs, batch deletion and failed-save retention; communication encoding, edits, deletion, attachments, text review, archives and exports; inventory CRUD, atomic movement RPC, insufficient-stock protection and adjustment to zero; ICS CRUD, calculated values, details and exports; visitor registration, departure, reopening/editing and deletion; user administrator-service actions and partial bulk failures; account approvals/declines and assigned roles; service wizard validation, create/edit and date retention; travel CRUD, status changes, exports and the official print view.

Dashboard checks cover module counts, analytics reporting periods/export, audit filters/pagination/details/export, preferences and local backup/restore. Flat and JSON-wrapped records, permission-denied writes, outages and paged reads beyond 1,000 rows are exercised.

## Memorandum OCR and routing

Seventeen browser scenarios verify memo dashboard aggregates, selection/export, attachments and field review, manual-value preservation, invalid/ambiguous dates, replacement files, denied saves, preview return, saved extracted text, mobile forms, busy actions and Communications-to-Office-Memos redirects for flat and JSON record schemas.

Real TXT, PDF, DOCX, PNG and scanned-PDF fixtures extract the same five printed fields using the production PDF.js 4.10.38, Mammoth 1.8.0 and Tesseract.js 5.1.1 libraries. Their pinned assets are served locally during verification to make the run repeatable.

Eleven parser/dashboard cases cover wrapped labels, body boundaries, series, explicit dates, ambiguous and impossible dates, first-page isolation, letter references, heading OCR errors and month/year transitions. Twenty-one routing/failure cases verify target confirmation, attachment retention, interrupted insert/delete retries, duplicate protection, pending moves, offline behavior and safe preview formats.

## Included evidence

Current reports are in `verification/`: `workspace.json`, `memo_browser.json`, `registry_workflows.json`, `employee_communication.json`, `access_service_travel.json`, `dashboard_tools.json`, `parser-results.json` and `memorandum_routing.json`. Two screenshots show the updated memo workspace. `verification.json` lists the report files.

Run the dependency-free checks from admin/: `node verification/memo-parser.test.cjs` and `node verification/memorandum-routing.test.cjs`. The event-driven routing harness uses the actual page-owned database runtime with simulated Supabase, IndexedDB and file readers.

## Verification limits

Your real `shared/supabase.js`, login page, logo, database schema/policies and administrator/stock server services were absent from the uploaded archive. Those integrations are preserved and must remain in the full application. Live database/auth/RPC behavior needs a deployment check with an authorized administrator account. Browser checks do not prove that an unavailable server service is configured.

OCR accuracy depends on document quality. Missing or unclear fields remain reviewable; manual edits are preserved before saving.
