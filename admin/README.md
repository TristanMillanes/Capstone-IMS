# PGENRO Admin — interactive workspace update

Replace the `admin/` folder in your existing PGENRO application with this folder. Serve the application through HTTP or HTTPS and open `admin/admin.html`. All eleven pages retain their own HTML, CSS and JavaScript; no new shared UI files are required.

The interface follows the same green/slate design on every page: a 275 px sidebar (78 px collapsed), 70 px topbar, matching navigation, page headers, buttons, profile and notification menus, and centered forms with internal scrolling. The saved sidebar preference works across modules. Mobile navigation and forms support 320 px screens.

## Interface and interaction update

All eleven pages have matching forest-green navigation, white page headers, consistent cards, buttons and centered forms. The layout supports 320 px phones, tablets and desktop screens. Tables include accessible horizontal scroll controls when their columns exceed the available width.

Use **Modules** in the topbar, or **Ctrl K / Cmd K**, to find any of the fourteen navigation destinations. Use arrow keys to move through the results, Enter to open one and Escape to close the switcher. Existing topbar record searches still filter their current module. The switcher preserves the current record query and stays closed while a form is open. Mobile menu focus returns to its toggle on Escape, and changing screen height does not dismiss an open menu.

Office Memo KPI cards filter all, pinned, this-month or attached records. Click a chart month to filter its issuances; click it again to clear that month. The registry also supports an issue-month input, pinned/newest/oldest/number sorting and an active-filter summary. Every filter applies to the complete loaded registry and its existing pagination/export behavior. Dashboard shortcuts open the frequently used registries.

Native form errors appear beside their fields and clear after correction. During a save or OCR operation the form is locked, reports that it is working, and retains its draft if the operation fails. Opening another record form cannot reset an active save. Notification feedback is consistent and capped to avoid covering the mobile screen.

## Pages

| Module | Entry page |
| --- | --- |
| Executive Dashboard | `admin.html` |
| Communications | `admincommunication.html` |
| Employee Profiles | `employee-admin.html` |
| Travel Orders | `travelOR-admin.html` |
| Office Memos | `officememo-admin.html` |
| Supplies Inventory | `invetoryadmin.html` |
| Visitors | `visitors-admin.html` |
| Service Requests | `serviceAdmin.html` |
| ICS Property Slips | `ics-admin.html` |
| User Management | `Usermanagement.html` |
| Account Requests | `requestacc.html` |

Audit, local backups and workspace preferences are sections of the dashboard. Office Memo HTML/CSS filenames now use lowercase `officememo-admin`, matching navigation on case-sensitive hosts. The original inventory filename spelling is retained for compatibility.

## Memo dashboard and form update

The Office Memos dashboard now shows a six-month issuance chart, attachment coverage and shortcuts to pinned/recent memorandums. It uses your registry data and handles month/year boundaries without UTC date shifts. Filters have a clear action; page refresh preserves pagination; selections persist across pages and drive **Export Selected**.

The centered form supports multiline recipients, subjects and remarks. It accurately labels PDF/image/DOCX/text attachments, opens the file chooser by clicking the dropzone, protects the draft during busy actions, and returns from preview to the same draft. Mobile layouts were checked at 320, 390 and 768 px. Toast feedback stays compact.

Communications and Office Memos use the same page-owned parsing rules. Printed header numbers, series, labeled recipients, subject, date and issuing office are extracted. Wrapped text and inline labels are supported, and subject extraction stops at body paragraphs. Ambiguous numeric dates, invalid dates and missing fields are marked for manual review. Optional issuing office/remarks are not fabricated. OCR fills empty/generated values while preserving your manual edits; replacing a file clears its stale automatic values. Correct extracted text and use **Recheck fields from text** when needed. Extracted text remains available after saving/editing through the existing memo record format; no new database columns or global UI files are required.

The original routing is retained: **Communications upload → Run OCR → review the fields → Save to Office Memos → memo dashboard**. The original attachment follows the record. The dashboard displays the newly saved memorandum after successful upload.

## Workflow repairs

- Communications text extraction recognizes memorandum headings and switches the save destination to Office Memos. Review the memo number, date, recipient, issuing office and subject, then choose **Save to Office Memos**. A manual Document Type selection also supports routing or correction. A mention of a memorandum in a letter's subject/body does not trigger routing.
- Routed memos use the existing `office_memos` fields and attachment format. The original file, extracted text, remarks and action notes are retained. Memo attachments have the existing 10 MB limit; Communications attachments retain their 50 MB limit. After a confirmed save, Office Memos opens with the saved memo displayed.
- A new memo upload creates only an Office Memos entry. Converting an existing communication saves the memo first, then removes its original communication. If source removal fails, **Finish Move to Office Memos** retries removal using the saved memo. Stable upload IDs prevent a second insert after an interrupted response. Missing attachments and failed database writes keep the original/form available.
- Ordered SDK/bootstrap/controller loading avoids initialization and global-variable collisions.
- Save and delete actions confirm affected database rows. Failed changes retain the form and entered values. Double submissions and delayed focus changes are guarded.
- Database reads support existing flat-column records and JSON `data` envelopes, including paged reads beyond 1,000 rows. JSON updates preserve unmodified fields.
- User creation, editing, suspension and deletion continue through the existing administrator service. Inactive accounts are no longer mistaken for active accounts, self-delete/access changes are blocked, and partial bulk failures keep the displayed registry accurate.
- Inventory movements continue through the existing atomic stock movement RPC. Excess stock issuance is blocked; an adjustment to zero works. Searches, movement history, reports and exports use current records.
- Visitors support registration, editing, departure, reopening, deletion and passes. Category filters include all form and recorded purposes. Today's departure count uses the departure date, and confirmed changes update the registry/cache immediately.
- ICS keeps its original fields, calculated values, detail view and official print layout; control numbers are generated and duplicate control numbers are checked.
- Office Memo CRUD, pinning, search, pagination, attachments and filtered CSV export work without seeded sample records. PDF/image/TXT/DOCX reading uses the local OCR service when available and retains the browser reader fallback. Both modules have a Stop reading control. Preview returns to an unfinished form, and DOCX attachments offer a download. File limits and safe preview URLs are validated.
- Module notifications detect newly added record IDs; initial loads, ordinary edits and filters do not create fake notifications. Visible connection/debug badges were removed while database handling remains active.
- CSV downloads escape formula-like text. Missing backend access shows empty or read-only cached states rather than fake successful writes.

## Existing application dependencies

This archive contains the full application, including the existing shared Supabase bootstrap, login pages, logos, setup scripts and administrator Edge Function. Follow `../FIXES_AND_SETUP.md` for this update and apply its read-only database patch to your existing database.

Keep your real `shared/supabase.js` one level above `admin/`. It must initialize `window.pgenroSupabase` (or `window.PGENRO_DB.client`) and your existing administrator helpers `window.PGENRO_API.requireAdmin` and `window.PGENRO_API.invokeAdmin`. The full application's authorization guard should remain enabled.

The account helpers must continue to handle `create`, `update`, `set_status`, `delete`, `approve_request` and `reject_request`. Stock changes require the existing `record_inventory_movement` RPC with its current `p_item_id`, `p_movement_type`, `p_quantity`, `p_reference_no`, `p_remarks` and `p_recorded_by` parameters. The required registries are `employees`, `communications`, `travel_orders`, `office_memos`, `inventory`, `inventory_movements`, `visitors`, `service_requests`, `ics_records`, `profiles` and `access_requests`; `audit_logs` supports the audit trail. Preserve your matching schema, constraints, access policies and realtime publication.

Keep `logo/enro.png` and `User/login.html` in their existing locations outside `admin/`. A local text mark appears if the logo image is unavailable. Sign out continues to use the existing login route.

The official Supabase SDK and document reader libraries require network access. Fonts use the existing Google Fonts include; icons are rendered locally. The dashboard has native chart fallbacks. Workspace backup/restore manages local browser caches and preferences; it does not back up or restore the hosted database.

## Validation

See `../verification/CURRENT_VERIFICATION.md` for this update. `VERIFICATION.md` and older reports are retained from the supplied source. Checks cover all eleven pages, mobile widths, keyboard navigation, forms, registry actions, exports, print views, OCR field review and Communications-to-Memo routing. Real PDF, DOCX, image and scanned-PDF extraction uses the production reader libraries, served locally for repeatable testing.

Database responses were simulated; the existing Supabase bootstrap is retained and the hosted database was not modified or verified. Keep the existing integration and verify the deployed application with your authorized administrator account. OCR quality depends on the source document; review unclear or missing values before saving.

Run `node verification/memo-parser.test.cjs` and `node verification/memorandum-routing.test.cjs` from `admin/` for the included dependency-free regression checks.
