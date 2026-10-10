# PGENRO IMS — modern interface and performance update

Updated 10 October 2026.

The admin and user workspaces use a dark emerald header, clearer typography, refined white cards and consistent navigation. Native CSS 3D document artwork remains, with short entrance animations and a small CSS hover lift. Continuous decorative animation and pointer-driven geometry calculations have been removed from authenticated workspaces.

## Performance fixes

Seven user registries now render 25 rows at a time: communications, inventory, employees, ICS slips, service requests, office memos and travel orders. Previous, Next, First and Last controls keep all matching records accessible. Changing filters returns to page one; realtime refreshes clamp the current page safely. Existing summary totals and export data still use the complete dataset. Registry printing temporarily renders the complete filtered list and restores the current page afterwards.

Search input is batched with a 100 ms delay. Icon refreshes target new placeholders, preserving existing sidebar SVGs. Travel orders use one HTML assignment per page instead of reparsing an ever-growing table for each row. Admin horizontal-scroll controls batch geometry reads in one animation frame and avoid redundant writes. Opaque workspace surfaces no longer use backdrop blur.

## Measured improvement

The same local Chromium benchmark used 800 simulated records per registry and 4× CPU slowdown. These end-to-end search timings include typing and a fixed 250 ms settling wait:

| Registry | Before | After |
| --- | ---: | ---: |
| Communications | 7.81 s | 0.40 s |
| Inventory | 7.57 s | 0.39 s |
| Employees | 8.94 s | 0.40 s |
| Office memos | 9.44 s | 0.39 s |

These searches previously rendered 800 rows and replaced 105 sidebar SVGs during seven keystrokes. They now render one 25-row page, preserve those SVGs and produced no observed long tasks during search. Results are synthetic; hosted performance also depends on the database, network and deployment.

## Verified behavior

- 24 pages at 1440, 1024, 768, 390 and 320 px: 120 layouts without overflow, missing local assets, uncaught browser errors or unrendered icons.
- 14 functional checks: nine admin editors/save flows, dashboard navigation/charts, denied-save handling, notifications and ordinary-user access boundaries.
- 23 presentation checks: native 3D, brief animation, CSS hover/reset, mobile navigation, profile/sign-out controls, reduced motion, aligned metrics, theme/collapse and account settings.
- Nine large-dataset scenarios: seven paginated registries and two dashboards. Pagination, empty-search recovery, second-page details and full-list print/cleanup are checked where applicable. Simulated user operations make no record writes.
- All existing HTML control IDs and backend/deployment files were verified for the performance update. The subsequent logout confirmation update changes only confirmation and sign-out error handling in the existing auth gateway; see `UI_NAVIGATION_LOGOUT_UPDATE.md`.

Browser tests use the production page code with simulated Supabase data. They do not test live record writes, hosted database policies or live network latency. No new production dependency or shared application file was introduced; each module owns its CSS and JavaScript. Supabase configuration, authentication, roles, OCR, database scripts and deployment files remain intact.

## Use the update

Use the complete `Capstone-IMS` folder as the updated deployment source. The latest styles and scripts use the `20261010-slide-confirm-v3` asset version to refresh browser caches. Follow the existing `README.md`, `FIXES_AND_SETUP.md` and `docs/DEPLOYMENT_RENDER.md` for your hosting method.

The ZIP contains application code, logos, setup scripts, OCR requirements, test fixtures/reports and current screenshots. Git history, virtual environments, bytecode caches and archived screenshots are excluded.

Run `npm test`, `npm run test:depth` and `npm run test:performance` from `verification/ui/` after installing its development dependencies and Chromium. Select an installed browser with `PGENRO_CHROMIUM_EXECUTABLE`. See `modern-smooth-browser.json`, `functional-results.json`, `depth-workspace-results.json`, `performance-before.json`, `performance-after.json` and `performance-source-checks.json` for evidence.
