# Verification — 2 November 2026

## Environment and scope

Automated checks ran in Chromium 143 against a local HTTP server. Each registry used 32 fixture records and simulated authentication/database clients. Attachment tests used an actual three-page PDF rendered by the bundled PDF.js reader, plus image, text, and failure fixtures. No production account or live database was used.

## Completed checks

- Nine authenticated pages: Dashboard, Communications, Office Memos, Travel Orders, Employee Profiles, Supplies Inventory, Visitor Log, Service Requests, and ICS Property Slips.
- Layout widths: 1440, 1024, 768, 390, and 320 pixels. Document width stayed within the viewport. Mobile navigation opened and closed with Escape. Phone records use labeled cards.
- Light appearance at those widths and dark appearance at desktop width. Desktop and mobile screenshots were reviewed during implementation.
- All eight registries: pagination, 10/25 row selection, saved-reference persistence after reload, search, clear filters, and sorting. Column sorting was checked against the full result set rather than just the current page.
- Visitor date filtering and clearing back to all dates.
- Five attachment registries: With files filter, direct file opening, three-page PDF navigation, zoom, rotation, expanded view, downloadable blob URLs, and closing the viewer. Dashboard pinned memos also opened their attachments directly.
- PDF viewing and direct page-number navigation on a 390-pixel screen.
- Details/profile dialogs for the available registry records.
- Employee and visitor CSV exports respected the Saved filter and exported the matching record.
- Text containing HTML was displayed as text. Unsupported HTML was offered as a download; unsafe URL schemes and missing files produced clear errors. Image preview, closing while a file was loading, invalid stored preferences/bookmarks, and account separation were also exercised.
- No uncaught JavaScript errors in the nine page scenarios. The simulated clients rejected record-write operations; none were attempted by the exercised viewer flows.
- JavaScript syntax checks passed for all User scripts. All 13 HTML pages had unique element IDs and valid references to assets located inside User.

## Integration checks still needed in the existing project

The supplied archive contains only User. Real sign-in, parent shared scripts, database policies, private attachment access, production uploads, server behavior, and the operating system's print dialog require the complete installation. Standalone public submission forms were preserved and were not changed or re-tested by this update. No new backend permissions or migrations are included.
