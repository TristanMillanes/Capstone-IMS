# OCR Recognition Update

## What changed

- The OCR service now requests English and Filipino recognition (`eng+fil`) by default and checks which Tesseract language packs are installed. It falls back to an installed language instead of failing just because the Filipino model is missing.
- The deployment image installs the English, Filipino, and orientation-detection data packs.
- Scanned pages now get an orientation check when the first OCR pass is weak or the page is landscape. This helps correct sideways and upside-down scans.
- Low-confidence scans can be re-read with an alternate page layout and a high-contrast, binarized image. Clear scans keep the faster path.
- Letter headings are checked line by line, so a heading such as `REQUEST LETTER` can still be detected below a government letterhead.
- Incoming records can use an explicitly printed originating office when no person-name signatory is present. Multiple equally strong signatories remain flagged for review.
- The server now extracts explicitly labelled `STATUS`, `ACTION TAKEN`, `DATE FORWARDED`, and `REMARKS` values and sends them to the matching front-end fields.
- The front end merges the server field contract with its local parser as a fallback, while preserving manual edits. If the OCR endpoint returns a server error, the browser reader can still be attempted.
- The duplicated memo-header parser used by Communications and Office Memos is synchronized so both front ends interpret memo headers consistently.
- The health endpoint reports the selected OCR languages and active read count. OCR responses include processing statistics for diagnostics.

## Run locally

Install Python requirements from the project root:

```bash
pip install -r requirements.txt
```

Install Tesseract OCR with English, Filipino, and orientation-detection data. On Debian/Ubuntu:

```bash
sudo apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-fil tesseract-ocr-osd
```

Start the OCR server:

```bash
python ocr_server.py
```

The service is available at `http://127.0.0.1:5000`; the Communications page uses `/ocr` when hosted by the same server.

## Verification

- `verification/ocr/functional-server-tests.py`: 10/10 functional OCR API tests passed, including rotated scans, document formats, labelled workflow fields, invalid files, and cache reuse.
- `verification/ocr/frontend-ocr-contract.test.cjs`: passed the front-end form-mapping test.
- `node --check admin/admincommunication.js`: passed.

OCR is not guaranteed to read every character perfectly. Blurry scans, handwriting, stamps, signatures, unusual fonts, and low-resolution images still need a human review. The form marks uncertain fields for review and manual corrections are preserved.
