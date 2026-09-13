# PGENRO IMS — Interface update

## Open the project

1. Extract the complete ZIP into a fresh folder. Do not copy only individual HTML files; pages share styles and scripts.
2. Open the project in VS Code and start Live Server, or run `python -m http.server 8080` from the project folder.
3. Open `User/login.html`. The public visitor form is `VisitorsLog/visitorsLogin.html`.
4. Sign in with an existing approved account. Admin users enter through the same login.
5. Hard-refresh existing browser tabs (Ctrl+Shift+R) after replacing an older installation.

The existing Supabase URL, browser publishable key, SQL files, and record operations are retained. No database migration is required for this interface update. Do not run the setup SQL again merely to apply the design.

## Design changes

- Consistent green navigation, white headers, quiet page backgrounds, and clearer hierarchy across admin and user modules.
- More readable form controls and table text, consistent button sizes, card spacing, and responsive metric grids.
- Compact profile control; account details remain inside its menu.
- User mobile menu opens/closes consistently, closes on Escape and navigation, restores focus, and prevents background scrolling.
- Off-screen user navigation is removed from keyboard focus; profile menus support keyboard focus cycling and Escape.
- Tables can scroll horizontally with keyboard access instead of forcing the whole page wider.
- Shared card/row entrance animations, hover feedback, button ripples, menu transitions, and reduced-motion support.
- Browser Back/Forward restores page visibility after route transitions.
- Settings retains its centered layout; browser zoom remains available.

## Confirmed fixes

- Removed the second user data loader, which could overwrite correctly mapped employee/travel data and attach duplicate realtime listeners.
- Removed the unused alternate Supabase bootstrap and unused UI helper (`USER-CSS/supabase.js` and `USER-CSS/pgenro-global.js`). All current pages use the canonical `shared/supabase.js`.
- Removed the second admin animation implementation and redundant shared admin authorization/logout implementation. The existing shared route guard remains active.
- Navigation highlights one current destination and respects dashboard section hashes.
- Canonical database IDs take precedence over stale IDs inside JSON data.
- Malformed local record caches fall back to an empty list instead of crashing initialization.
- Corrected duplicated HTML doctype declarations and dead admin footer links.
- Corrected ripple animation positioning and cleaned up mobile backdrop/ARIA state on Escape.

## Files to inspect

- `shared/workspace.css`: final visual layout and responsive rules.
- `shared/workspace.js`: user navigation, profile accessibility, table wrappers.
- `shared/pgenro-global.js`: shared navigation state and motion.
- `shared/supabase.js`: canonical data bridge and profile display.
- `user-javascript/pgenro-user.js`: compact profile markup and header normalization.
- `admin-javascript/admin-ui.js`: admin shell controls.

## Validation

Passed: syntax checks for all 32 application JavaScript files and 2 inline scripts; duplicate-ID, doctype, and local asset/link checks across 25 HTML pages.

Passed targeted JavaScript regression tests: four user module data bridges, one realtime subscription per module, employee/travel field mapping, canonical record IDs, three active-navigation cases, and three malformed-cache cases.

Run again from the project folder:

```sh
python tests/audit.py
node tests/regression.cjs
```

These tests use synthetic data and do not write to Supabase. Browser visual checks could not run because the available browser could not reach the local project. Live login, database writes, uploads, exports with real records, RLS permissions, and deployed mobile/desktop rendering still need an acceptance check in your environment. This update does not certify every backend operation or remove all legacy per-module styling.

Git history and editor metadata are excluded from the delivery ZIP. Existing setup documentation is retained for reference; this file describes the current interface update and its validation limits.
