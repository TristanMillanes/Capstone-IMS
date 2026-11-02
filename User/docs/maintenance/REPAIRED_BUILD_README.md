# PGENRO IMS — Consolidated/Repaired Build

This build preserves the existing module CRUD and Supabase logic while consolidating the presentation and navigation layers.

## Repairs included

- Standardized HTML filenames and internal URLs to lowercase for case-sensitive hosting.
- Removed duplicate legacy UI assets that were no longer linked by active pages.
- Removed the redundant `shared/repaired-ui.js` runtime layer; its responsibilities are already handled by `shared/pgenro-global.js` and `shared/workspace.js`.
- Preserved the existing per-page CSS output so module-specific layouts and responsive rules remain intact.
- Added a root `index.html` entry point.
- Hardened the OCR upload endpoint with safe filenames, size limits, temporary-file isolation, validation, cleanup, and non-debug default execution.
- Added `User/requirements-ocr.txt` for the OCR backend.

## Validation status

- Project audit: PASS — 0 missing local assets.
- Regression suite: PASS.
- JavaScript syntax: PASS.
- OCR Python syntax: PASS.

Live Supabase permissions, deployed Edge Functions, browser rendering, and real account/database transactions still require acceptance testing against the user's Supabase project.
