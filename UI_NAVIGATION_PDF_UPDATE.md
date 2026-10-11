# Navigation, dark mode, charts and document viewing

The menu control is in the top bar throughout the admin and user workspaces. Desktop menus can collapse, while narrow screens use the existing drawer with Close and Escape controls. Module HTML, CSS and JavaScript remain in their own files.

Dark mode now uses matching surfaces, borders, readable text, form controls, badges and chart labels. User appearance is available in the top bar, persists between modules and agrees with Account Settings. Existing account preferences and Supabase authentication remain in place.

Chart.js now ships in `vendor/chart.umd.min.js`. The seven dashboard charts use bounded canvas containers, reuse their existing instances, and resize immediately so their legends do not retain an older width during a layout change.

PDF viewing is available for Communications and Office Memos on both admin and user pages. The reader includes paging, Fit width, zoom and Download, with a clear fallback for unavailable or damaged documents. Only the active page is rendered, canvas allocations are limited, and closing a viewer cancels its work and releases the canvas. PDF.js, its worker, character maps and standard fonts ship in `vendor/pdfjs/`. PDF paper stays white inside the dark viewer.

Travel Orders has organized responsive filters, a contained registry table and a form that stacks on small screens. The Print action and Print Official Form button were removed. View details remains available.

## Install

Extract the complete `Capstone-IMS` folder and use the project's existing HTTP server and Supabase setup. Copy the included `vendor` folder together with the module files. Refresh the browser after replacing the files; stylesheet and script version URLs have been updated. The PDF worker needs HTTP or HTTPS, so use the application's server rather than opening the HTML directly as a local file.

No database migration or new Supabase credentials are needed for this UI update. Existing storage permissions still govern hosted attachments.

## Verification

- 26 production pages checked at five desktop, tablet and mobile widths; form dialogs checked at desktop and narrow widths.
- All 22 admin and user workspaces checked for top navigation, collapse/expand, mobile drawer, light/dark switching and page containment from 320 to 1816 pixels.
- Seven real Chart.js instances checked for positive plot areas, legend bounds, period changes, responsive sizing and reuse.
- Four viewers checked with a real three-page PDF, including rendered pixels, paging, zoom, Fit width, dark surroundings and cleanup after closing.
- Damaged PDF fallback, Travel Order details, backup/restore and logout confirmation checked.

The checks use simulated Supabase data and local sample attachments. Live account permissions, hosted files and OCR services were not exercised.

Run `npm run test:unified` from `verification/ui` after installing its development dependencies and Chromium for Playwright. Test scripts and JSON results are included; browser screenshots are omitted from the deliverable.
