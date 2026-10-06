# Verification of the 4 October 2026 update

These checks used the production application and real local Chromium/Flask/Tesseract. Supabase database, authentication and Storage responses were simulated. No hosted records, policies, Edge Functions or deployments were changed or verified.

| Check | Result | Report |
| --- | --- | --- |
| 24 active pages at 320, 390, 768, 1024 and 1440 px | 120 views passed with no uncaught browser errors, missing local assets, page/control overflow or unrendered icons | `ui/final-20261004-browser.json` |
| Administrator forms and shared interactions | Nine forms saved; dashboard, sidebar, keyboard navigation, rejected saves, notifications and ordinary-user read-only behavior passed | `ui/functional-results.json` |
| Communications and Office Memos OCR in Chromium | Stop/retry, preserved manual corrections, received-date autofill and scan-to-memo save passed | `ui/ocr-ui-results.json` |
| Attachment forms in Chromium | PNG/PDF/TXT byte retention, opening/download, direction edits, rejected-save recovery and admin guard passed | `ui/communication-upload-results.json` |
| Private shared attachments, PDF viewer and direct OCR | Six scenarios passed: fresh-user-browser byte checks, failed Storage retry, mobile multipage canvas PDF viewer, aligned KPI values, same-origin OCR/progress and generated memo routing | `current/app-regression-results.json` |
| Production OCR service | Nine test methods passed, including six native formats, rotated scans, caching, date separation, ambiguous/annex authors, invalid/encrypted documents and cancellation | `ocr/functional-server-results.json` |
| Current OCR regressions | Seven tests passed: all-page reuse, queued cancellation/retry, Word header image reading, inline/continued signatures, unlabeled letter purpose, dates and frontend-serving access boundaries | `current/ocr-regression-results.json` |
| Letter parsing in both administrator modules | Six current signature/recipient/purpose cases and 24 header/reading-order scenarios passed | `current/letter-fields-results.json`, `ocr/header-results.json` |
| Printed sender and memo fields | Seven sender cases and eleven memo/parser/dashboard cases passed | `ocr/printed-sender-results.json`, `../admin/verification/parser-results.json` |
| Communications-to-Memo routing | 25 scenarios passed with flat/JSON records, duplicates, interrupted responses, byte-preserved attachments, permission failures and retry journals | `../admin/verification/memorandum_routing.json` |
| Communications writes | 20 scenarios passed with strict Incoming/Outgoing validation across eight legacy aliases, flat columns, edits and failed-save retries | `../admin/verification/communication_upload.json` |
| Production source syntax | JavaScript, CSS and the three Python entry/helper files passed syntax checks | `current/source-results.json` |

The routing checks also verify that an attachment remains available after the database insert succeeds but its response is interrupted. The repeated-page tests verify page count and extraction, rather than skipping repeated pages from the returned document.

## Local speed comparison

The original uploaded OCR source and updated source ran in separate fresh processes on this machine with `OCR_WORKERS=1`, `OCR_DPI=220` and `OCR_MAX_SIDE=2800`. Caches were cleared before each cold test. This is a small controlled benchmark, not a guarantee for other scans or hosting plans.

| Fixture | Original | Updated | Recognition work |
| --- | ---: | ---: | --- |
| Editable one-page PDF | 16 ms | 18 ms | Both used native extraction, zero OCR passes |
| Synthetic letter with large blank margins | 1,301 ms | 734 ms | Two passes reduced to one; updated source correctly recovered the printed sender name that the original left empty |
| Six-page PDF repeating the same scanned letter | 2,936 ms | 1,033 ms | Six passes reduced to one, with five page-cache hits; all six pages retained |
| Identical six-page file retried with a different name | 23 ms | 23 ms | Both reused the existing whole-document cache |

The six-page repeated-scan fixture was about 65% faster in this run. Distinct pages still need their own OCR. Reports and the reproducible fixture generator are in `current/benchmark-baseline.json`, `current/benchmark-updated.json` and `current/benchmark.py`.

## Run the current checks

From the project root, with the OCR Python requirements and Tesseract installed:

```bash
python verification/ocr/functional-server-tests.py
python verification/current/ocr-regression.py
node verification/current/letter-fields.test.cjs
node verification/ocr/header-fields.test.cjs
node verification/ocr/printed-sender.test.cjs
node admin/verification/memo-parser.test.cjs
node admin/verification/memorandum-routing.test.cjs
node admin/verification/communication-upload.test.cjs
```

See `ui/README.md` and `current/README.md` for browser/syntax setup. Current screenshots include `current/communications-mobile.png`, `current/user-memo-viewer-mobile.png` and the `ui/final-20261004-*` images. Test SDKs and fixtures are not loaded by the production application and are excluded from its Docker image.

Older verification suites and maintenance reports in the supplied project describe previous revisions. Only the reports listed here describe this validation. The older `ocr/python-ocr-tests.py` expects an absent `Ocrr/memo.py` service and was not used. Browser fallback OCR suites were not rerun; current integration checks exercised the production HTTP OCR service. Live Supabase RLS, private Storage and the existing account-management Edge Function still need verification after the included patch and deployment are applied with authorized accounts.
