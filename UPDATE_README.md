# PGENRO IMS — Consolidated Build

## Run locally

Use a local web server. From the project root:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080/` or `User/login.html`.

Do not open protected pages directly with `file://` because Supabase authentication, module imports, and relative assets require an HTTP origin.

## Current structure

- `shared/supabase.js` — single browser Supabase client and compatibility bridge.
- `shared/pgenro-global.js` — shared navigation, accessibility, animation, and page utilities.
- `shared/workspace.js` — responsive user workspace controls and table accessibility.
- `user-javascript/` — user module controllers.
- `admin-javascript/` — administrator module controllers.
- Each application page keeps one local CSS file; obsolete standalone global/repair CSS files were removed after their rules had already been consolidated into the page styles.

## Current cleanup

The 2026-09-13 build standardizes HTML URLs to lowercase so the system works consistently on case-sensitive web servers. Duplicate UI repair JavaScript was removed because its table wrapping and reveal behavior were already covered by the canonical shared scripts.

The OCR backend was also hardened. See `User/OCR.py` and `User/requirements-ocr.txt`.

## Validation

The delivered build passes:

```bash
python tests/audit.py
node tests/regression.cjs
```

JavaScript syntax checks and `User/OCR.py` Python compilation also pass.

## Supabase

Keep the browser-safe Publishable/Anon key in `shared/supabase.js`. Never place a service-role/secret key in frontend files. Database setup and RLS scripts remain under `supabase/`.
