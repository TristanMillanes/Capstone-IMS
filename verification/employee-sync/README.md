# Employee sync and inventory regression checks

These tests use the production SQL migration, Auth trigger, TypeScript registration handler and frontend. Database checks use local PostgreSQL through PGlite, including normalized and legacy JSON employee storage. Browser checks use Chromium and isolated SDK fixtures. No hosted database or real account is contacted.

Requires Node.js 24 or newer. From this directory:

```sh
npm install --no-save @electric-sql/pglite@0.5.15 playwright
npx playwright install chromium
node database.cjs
node browser.cjs
```

`PGENRO_PGLITE_MODULE` selects an existing PGlite module. `CODEX_PRIMARY_RUNTIME_NODE_MODULES` selects existing Playwright dependencies; `PGENRO_CHROMIUM_EXECUTABLE` selects an installed Chromium binary. Optional `PGENRO_SCREENSHOT_DIR` writes local screenshots for inspection.

Results are in `database-results.json` and `browser-results.json`. Fixtures do not establish the state of the hosted SQL migration or deployed function; follow the deployment guide to enable the changes in the live project.

The current checks also cover Admin-only personnel-directory access, caller-owned revision signals, Supabase Realtime publication setup, old Employee page redirects, all eight User module menus, automatic refresh after Admin edits and linking an already-open unlinked account.
