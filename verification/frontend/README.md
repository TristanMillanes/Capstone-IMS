# Frontend repair regression checks

These checks use the actual application source. Browser tests intercept all external requests and simulate Supabase, Auth and private Storage; they do not change hosted records. `integration.cjs` starts and stops the production Flask server on local port 5076. Keep that port free.

From the project root, install the production Python requirements, Node.js and test-only dependencies:

```bash
python -m pip install -r requirements.txt tinycss2
npm install --no-save playwright pdf-lib
npx playwright install chromium
python verification/current/source-checks.py
python verification/frontend/server-assets.py
node verification/frontend/integration.cjs
node verification/frontend/layout.cjs
```

Tesseract is needed by the existing OCR service at startup. `PGENRO_PYTHON` can select the browser test's Python executable; `PGENRO_CHROMIUM_EXECUTABLE` can select an installed Chromium binary. Optional `PGENRO_CHROMIUM_ARGS` is a JSON array of Chromium arguments. `CODEX_PRIMARY_RUNTIME_NODE_MODULES`, when present, selects a preinstalled Node dependency directory. `PGENRO_SCREENSHOT_DIR` optionally enables layout screenshots.

Results: `integration-results.json`, `server-assets-results.json`, `layout-results.json`, and `../current/source-results.json`. The integration report covers 21 scenarios. Layout results include each page and viewport, theme-button behavior, uncaught errors and missing assets. Backend fixtures cannot establish that your deployed policies, credentials or real email service are correctly configured.

## 4 November visual regressions

Run `node verification/frontend/visual-regression.cjs` for the current gradient contrast, geometry and legacy-entry checks. Results are written to `visual-regression/results.json`. Screenshots are optional via `PGENRO_SCREENSHOT_DIR` and are intended for local inspection.

## Employee account and personal attendance

See `../../EMPLOYEE_ACCOUNT_SETUP.md`. The new checks are `employee-account-database.cjs` and `employee-account-browser.cjs`; their JSON results are written beside the scripts. From this directory, `npm install`, `npx playwright install chromium`, then `npm run test:employee-account`.
