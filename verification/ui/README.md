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
