# UI-preserved Render redeploy

This build keeps the existing PGENRO page-specific UI and adds only deployment safeguards:

- Render/Linux URL compatibility and aliases remain enabled.
- Python/Tesseract OCR remains available at `/ocr`.
- Supabase integration remains unchanged.
- A small deployment layout guard prevents page-level horizontal overflow without resizing the existing cards/sidebar/tables.
- HTML/CSS/JS responses are sent with no-cache headers so a new deploy cannot mix old CSS with new HTML.
- All admin and user pages keep their existing viewport metadata and page-specific stylesheets.

After redeploy, use browser zoom 100% (`Ctrl+0`) once, then hard refresh (`Ctrl+Shift+R`).
