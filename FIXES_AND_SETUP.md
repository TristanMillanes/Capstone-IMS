# Local startup and document storage

## Windows

1. Extract the project into a fresh folder, keeping its main folders together.
2. Install Python 3 and Tesseract OCR. Ensure Tesseract is on PATH, or set `TESSERACT_CMD` to its executable path.
3. Double-click **START_SYSTEM.bat**. It uses `User/START_OCR.bat` to create the Python environment, install the declared dependencies and start the combined application/OCR server.
4. Open **http://127.0.0.1:5000/User/login.html**. Keep the server terminal open while using the local system.

## Manual startup

From the project root:

```bash
python -m pip install -r requirements.txt
python ocr_server.py
```

On Windows, `py -3` can replace `python`. For Docker/Render hosting, follow [docs/DEPLOYMENT_RENDER.md](docs/DEPLOYMENT_RENDER.md).

## Supabase accounts

Follow [EMPLOYEE_ID_LOGIN_SETUP.md](EMPLOYEE_ID_LOGIN_SETUP.md) before signing in with employee IDs. It covers the SQL patches, Edge Functions and first Admin001 setup. Use [ADMIN_USER_SETUP.md](ADMIN_USER_SETUP.md) for a new database or an older account installation.

## Private attachments

Apply `supabase/DOCUMENT_STORAGE_PATCH.sql` to enable the private document bucket. It requires the account/authorization helpers from the base setup. Administrators upload and change documents; approved users can open permitted attachments through temporary authorized links.

The frontend and OCR API are served from the same application. Communications and Office Memos use `/ocr`; progress uses `/ocr/status/<request_id>`, and cancellation uses `/cancel`. Editable documents use native extraction, while scans use Tesseract. Review detected fields against the source document before saving.

Permanent documents belong in Supabase. Temporary local OCR files, tests and old reports are not required in the distributed project.
