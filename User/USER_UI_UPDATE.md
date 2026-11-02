# Viewer workspace update — 2 November 2026

## Installation

1. Back up your existing **User** folder.
2. Extract the ZIP and replace that **User** folder with the included **User** folder.
3. Keep the existing parent folders, including **shared**, **SettingIMS**, **admin**, **logo**, and any existing dashboard chart assets. The upload supplied only the User folder; this update does not recreate the server, database configuration, or those parent folders.
4. Start the project with your usual local web server. Open `User/login.html`, sign in, and press **Ctrl + F5**. Use HTTP/HTTPS rather than opening HTML files directly.

## Changes

- Service request details no longer include the duplicate tracking number, status badge, or five-stage workflow strip. The record title, information tabs, and routing fields remain available.

- Clean green sidebar, compact headings, quieter cards, clearer search controls, and matching light/dark appearance.
- Removed connection/live indicators, decorative scenes, the animation toggle, repeated access labels, and the dashboard's long usage guide.
- Direct **View file** buttons in Communications, Office Memos, Travel Orders, Service Requests, ICS, and pinned dashboard memos when a record has an attachment. Files open immediately; opening record details first is unnecessary. **No file** indicates that no attachment is linked.
- One shared PDF/image/plain-text viewer with PDF page navigation, page-number input, zoom, rotation, expanded view, download, open in tab, print, and readable/copyable PDF page text. PDF.js and icons are bundled under **User/vendor**.
- Sort the entire filtered result using column headings or the sort menu. Choose 10, 25, or 50 rows per page. Search and existing module filters continue to work together.
- Save reference IDs with the bookmark button, then use **Saved** to find them again. These bookmarks belong to the signed-in account in this browser; they do not change shared records or store document contents. Page-size preference is remembered.
- **With files** shows attached records. **Clear filters** resets reading tools and module filters. The **/** keyboard shortcut focuses the registry search field.
- Phone screens show records as cards with visible labels and action buttons. Wider screens use tables.
- Travel Orders now has search, status filtering, refresh, record details, and attachment buttons.
- Viewer workspace has no record creation, editing, deletion, check-out, or approval action. The authenticated ICS submission form and links to create service requests were removed. Existing standalone public request forms remain in the package for the project's separate public workflows.

## Files to keep together

Copy the complete User folder. The module pages now also depend on **user-viewer.js**, **user-documents.js**, **user-viewer.css**, and the bundled **vendor** directory. Keep the existing shared authentication, document URL resolver, ICS adapter, and database settings in the parent project.

## Permissions and attachments

This update provides read-only workspace controls. Database and storage permissions continue to be enforced by the project's existing backend policies. No database migration or permission-granting change is included. If the backend currently lets viewer accounts write shared records, those policies must also be corrected in that project.

Private attachment links use the existing `PGENRO_API.getDocumentUrl` resolver when present. Records without attachment metadata cannot acquire a file automatically. Unsupported formats can be downloaded. Previews are limited to 50 MB; larger attachments can be opened in a new tab. Image-only scanned PDFs may have no extractable text. Printing uses the browser's print dialog.

## Validation

See **VERIFICATION.md** for the checks performed with fixture records. Real sign-in, production storage permissions, and live database policies require the complete existing project and an authorized test account.
