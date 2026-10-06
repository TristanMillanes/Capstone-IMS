# PGENRO IMS — OCR and UI update

Updated 4 October 2026. Use the complete application folder from this archive.

## Start or update the system

1. Extract into a fresh folder, then use the contents of `Capstone-IMS` as your project root. Keep the existing Supabase project configuration in `shared/supabase.js`.
2. Run `supabase/DOCUMENT_STORAGE_PATCH.sql` once in your existing Supabase SQL Editor. It creates the private `pgenro-documents` bucket with approved-user read access and administrator upload/change/delete access. It requires the existing `is_pgenro_admin()` and `is_pgenro_active_user()` helpers from your supplied setup. It is safe to rerun and does not delete records. The patch has not been applied to your hosted project.
3. Redeploy the complete folder using the included `Dockerfile` and `render.yaml`, or start the combined local server as shown below.
4. Refresh the browser after deployment. Sign in with an approved account. Use Communications or Office Memos to attach a document, read it, review the detected fields, and save.

For local use, install Python and Tesseract, then run from the project root:

```bash
python -m pip install -r requirements.txt
python ocr_server.py
```

Open `http://127.0.0.1:5000/User/login.html`. On Windows, `py -3` can replace `python`. Set `TESSERACT_CMD` if Tesseract is installed outside PATH. The existing `User/START_OCR.bat` remains available for a separate local OCR service. Serving the combined application through `ocr_server.py` gives the frontend direct access to `/ocr`, live progress and cancellation.

Keep your existing database/Edge Function setup. If the supplied operational read-only policies have not yet been applied, use `supabase/READONLY_USER_PATCH.sql` after the original setup. Account management continues to use the supplied `admin-users` Edge Function.

## OCR changes

- Direct same-origin OCR avoids the previous health-check delay and unnecessary browser fallback. An interrupted backend read keeps the draft available for retry.
- Editable PDF, Word, spreadsheet, presentation and text content uses native extraction. Scans use blank-margin trimming, adaptive recognition, orientation recovery and a signature retry when needed. Word header/footer text and embedded scans are included.
- Every page is counted and read. Identical processed scan pages can reuse the page cache, even across differently packaged documents. Whole-document caching remains content-based.
- Live page progress, elapsed time and Stop Reading work with queued and active requests. Manual corrections survive reading and cancellation.
- Letter parsing handles printed signatures on the closing line, separate designations, honorifics, signatures continued on another page and conventional recipient address blocks. Issue, received and released dates remain separate. Annex/CC authors and body memorandum references do not replace the covering letter fields.
- Missing subjects and document types can be suggested from the letter opening; inferred values are flagged for review. A detected memorandum without a printed number receives a generated registry number before routing to Office Memos.

Review uncertain fields against the attachment. Poor scans, handwriting and ambiguous printed information can still require manual correction.

## Attachments and user access

New attachments are stored privately in Supabase. The records retain stable object addresses; opening a document generates a temporary authorized link. Approved ordinary users can open the attachment from another browser/device and retain read-only operational access. Office Memo attachments retain their 10 MB limit; the general OCR/storage limit is 50 MB.

Legacy inline memo documents remain readable. An older Communications attachment that exists only in one browser must be reattached from that browser and saved with this build to make it available elsewhere. There is no automatic recovery of a file that was never uploaded to shared storage.

A failed upload preserves the form and selected file. Memo routing retains its retry journal and checks for an already-saved destination after an interrupted response. Uncertain save results retain uploaded files rather than deleting a potentially saved record's attachment.

## UI changes

Mobile KPI labels and counts now align without splitting long words into stray letters. Forms, buttons, icons, modal heights and long filenames wrap within their cards. The existing layout, palette, per-module CSS/JavaScript and Supabase configuration are retained.

The user Office Memo viewer renders PDF pages directly with Previous, Next and Download controls. It supports short mobile screens, image/text previews, rendering cancellation and cleanup when closed.

## Validation

See `verification/CURRENT_VERIFICATION.md` for current browser, OCR, parser, upload and routing reports. Testing used real Chromium, Flask and Tesseract with simulated Supabase responses. No hosted database records, SQL policies or deployment were changed during this work.
