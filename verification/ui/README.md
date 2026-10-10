# Current UI verification

Run from this folder:

```bash
npm install
npx playwright install chromium
npm test
npm run test:ocr
npm run test:upload
```

`PGENRO_CHROMIUM_EXECUTABLE` selects an existing Chromium executable. `PGENRO_PYTHON` selects a Python interpreter with `../../User/requirements-ocr.txt` installed. The OCR suite also needs local Tesseract. It starts the production reader on port 5053 and closes it afterwards.

The suites run the actual application code with a simulated Supabase SDK and block unrelated network requests. They create screenshots and JSON reports in this folder. No hosted records are changed. The OCR suite uses the real Flask HTTP service for scan autofill and simulates a stalled upload to check prompt Stop/Retry behavior.

The upload suite uses strict Incoming/Outgoing validation, real browser IndexedDB, and byte checks for PNG/PDF/TXT attachments. It also checks opening/download, direction edits, failed-save retry and administrator permission. It does not connect to the hosted database or inspect its trigger definition.

`chart.umd.min.js` is the official Chart.js 4.4.8 test asset under its included MIT notice; production pages retain their pinned CDN include. The mock SDK is used only by these tests.

## Modern workspace checks — 10 October 2026

Run `npm run test:depth` to verify the 20 admin/user workspaces: native CSS 3D, brief entrances without continuous decoration, CSS hover lift and reset, profile menus, mobile navigation, reduced motion, aligned KPI values, dark/light appearance, sidebar collapse, keyboard module navigation and account settings links. The directory SDK fixture includes the current authorization/list/count RPC responses.

Run `npm run test:performance` for an 800-record registry test with 4× CPU slowdown. It checks bounded rendering, search, unchanged sidebar SVGs, pagination, second-page details, empty results, complete registry printing and read-only behavior. `performance-before.json` retains the measured baseline; `performance-after.json` is the current result. Timings include a fixed 250 ms settling wait after typing. The benchmark is synthetic and does not measure hosted network/database latency.

Run `npm run test:navigation` for the page-slide and system logout confirmation suite. It tests all 21 authenticated pages, cancellation/focus/mobile bounds, pending state, one confirmed sign-out, simulated failures/retry, browser Back and reduced motion. The mock auth fixture persists signed-out state across navigation within each isolated test context. No real accounts are signed out.

Current screenshots prefixed `slide-confirm-` show production HTML/CSS with simulated data. Screenshots prefixed `modern-smooth-` cover the preceding performance/design update. They do not show live database contents.
