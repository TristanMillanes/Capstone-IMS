# OCR regression checks

Run these commands from `Capstone-IMS/verification/ocr`:

```bash
node header-fields.test.cjs
node printed-sender.test.cjs
node ../../admin/verification/memo-parser.test.cjs
node ../../admin/verification/memorandum-routing.test.cjs
```

For the real browser reader checks, install the test dependencies and Chromium:

```bash
npm install
npx playwright install chromium
node incoming-browser.cjs
node memo-browser.cjs
node docx-layout-browser.cjs
node ui-speed-browser.cjs
```

Run browser suites sequentially. The tests serve the real pinned reader assets locally, block unrelated network calls, simulate authenticated Supabase responses and use real browser IndexedDB. They never contact or modify the configured live database. Reader asset overrides use `PGENRO_READERS_ROOT`; an already installed browser can be selected with `PGENRO_CHROMIUM_EXECUTABLE`. `PGENRO_PROJECT_ROOT` selects another complete project checkout.

For Python checks, install `../../Ocrr/requirements.txt` and a local Tesseract executable, then run:

```bash
python python-ocr-tests.py
```

This exercises both production Flask test clients, native/scanned/mixed PDFs, TXT, DOCX (including embedded scans), multipage TIFF/GIF, the actual two-page printed author, disabled digits-only passes, no-default metadata and shared date/header cases. JSON files record the completed verification. PNG screenshots show desktop/mobile extraction review; they are verification artifacts, not application assets.

The incoming browser suite reads all listed formats through the production form, verifies the actual printed author separately from TO, tests legacy recipient contamination repair and preserves manual corrections. Header fixtures also reject annex/CC/body names. Routing tests save the printed memo signatory into Office Memos in both flat and JSON database simulations.

## UI and reading-speed verification

`ui-speed-browser.cjs` checks cancellation/retry, drag and drop, small-screen layout, native CSV/UTF-16/XLSX/PPTX reading, ambiguous signatory selection and the Communications-to-Office-Memos save/redirect. Set `PGENRO_BASELINE_ROOT` to a directory containing the three supplied Communications baseline files to reproduce before/after measurements. The test server exposes a reader hook and counters only in served test copies; production code contains no test hook. The benchmark uses the same pinned English OCR model and local assets in both versions. Native PDF preflight, one-pass clear scans, a reusable worker and a memory cache account for the difference. Extra accuracy passes remain enabled for unclear/sideways scans and blue ink over printed names. Times are local observations, not guaranteed deployment latency.

`ui-speed-results.json`, `incoming-browser-results.json`, `printed-sender-results.json`, `header-results.json` and `../../admin/verification/memorandum_routing.json` contain current update checks. Other unchanged reports include results retained from the previous OCR release.


## v6 functional server and browser integration

Install `../../User/requirements-ocr.txt` and a local Tesseract executable, then run:

```bash
python functional-server-tests.py
node functional-service-browser.cjs
```

The browser integration suite starts `../../ocr_server.py` itself on test port 5051, then closes it. `PGENRO_PYTHON` selects the Python executable (use the OCR virtual environment if installed there). It uses the real production form and a real HTTP Python service to check Stop/Retry, the included two-page Office Order, scanned incoming autofill with manual corrections, scanned memo save/redirect, and a stalled health check falling back to real Tesseract.js. Database persistence uses the same mock as the other suites; there are no live writes.

`functional-server-tests.py` additionally checks native PDF/DOCX/XLSX/PPTX/UTF-16/CSV, content-based caching, rotated scans, main-letter versus annex signatories, registry versus issue dates, invalid/password-protected/blank files and cancellation racing with upload. `functional-server-results.json` and `functional-service-browser-results.json` record these checks. `verification-summary.json` identifies current v6 reports separately from retained older reports.
