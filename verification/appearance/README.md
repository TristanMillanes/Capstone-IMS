# Appearance regression checks

Production HTML/CSS/JavaScript are served locally. All external requests are intercepted; Auth/database responses use the supplied mock SDK. No hosted records are changed.

From the project root:

```sh
npm install --no-save playwright
npx playwright install chromium
node verification/appearance/theme-behavior.cjs
node verification/appearance/contrast-layout.cjs check
```

`PGENRO_CHROMIUM_EXECUTABLE` can select an installed browser. Optional `PGENRO_CHROMIUM_ARGS` is a JSON argument array. `CODEX_PRIMARY_RUNTIME_NODE_MODULES` can select a preinstalled Playwright dependency directory. `PGENRO_SCREENSHOT_DIR` selects the screenshot directory.

Checks cover 28 pages, two appearances and 1440/1024/768/390/320 px widths, plus Admin editors, User record details and Settings/public form panels. The behavior suite clicks the actual controls, reloads the page, checks native control appearance and verifies that another role's preference does not overwrite the User's selected mode.

Computed contrast uses solid ancestor backgrounds and excludes decorative, hidden and disabled content. Gradient/image surfaces need visual review. This is a scoped regression report, not an accessibility certification. Current consolidated reports are `results.json`, `behavior-results.json` and `release-results.json`.
