# Chart hover alignment — 27 October 2026

## Install

Replace the existing `admin/` folder with the folder from this ZIP, then refresh the dashboard with **Ctrl+F5**. Keep your existing `shared/`, authentication, logos, backend and other application folders. The dashboard's CSS and JS URLs now use `20261027-chart-hover-v4` to invalidate the previous assets.

This package includes the earlier sidebar spacing and chart layout fixes.

## Corrected behavior

The previous charts used Chart.js's average tooltip position. In local reproduction, the line-chart tooltip anchor appeared about 93 CSS pixels below the pointed-to data point. The full personnel name also produced a 381 px tooltip inside a 324 px phone chart. The previous layout checks did not test these pointer interactions.

- Tooltip information follows the actual pointer immediately, including movement within the same bar or reporting interval. It no longer averages the positions of the line series or animates behind the pointer.
- Mouse/touch coordinates are calculated from the canvas's displayed rectangle before hit testing. The highlighted item and its tooltip use the same coordinates, including under CSS zoom and after sidebar resizing.
- The tooltip is rendered in the viewport, with wrapping text and bounded placement. It remains readable beside the pointer and is not clipped by the personnel chart's scrolling container.
- Long division names remain complete in the tooltip. The shortened axis labels are unchanged.
- Moving out of a chart, scrolling, resizing or pressing Escape dismisses stale information. A touch tap keeps its selection until another tap, real mouse movement, scrolling or Escape.
- Existing chart data, period filters, legends, native fallbacks and module controllers remain in place.

## Checks

The final version passed **345 pointer/touch targets in 11 scenarios**, with a maximum measured anchor error of **0.998 CSS pixels**, plus all **85 navigation/chart layout scenarios**. All 15 top-level module scripts and both current browser-test scripts passed JavaScript syntax checks. The other 14 module controllers are unchanged from the prior package.

`verification/chart-hover.test.cjs` exercises actual mouse movements and a touch tap, rather than calling Chart.js's tooltip methods directly. It checks the hovered data index, displayed title/value, pointer anchor, tooltip bounds, absence of layout shifts and dismissal behavior.

The test covers all five charts at 320, 390, 768, 1024, 1440 and 1916 px; device scale factors 1, 1.25, 2 and 3; expanded/collapsed sidebars; light/dark appearances; personnel scrolling; CSS zoom at 80% and 125%; reporting-period changes; and touch selection. See `verification/chart-hover-results.json` for the recorded target count and maximum measured pointer error.

Run with Playwright and Chromium installed:

```bash
node verification/chart-hover.test.cjs
node verification/navigation-charts.test.cjs
```

Set `UI_BROWSER_PATH` when Chromium is installed outside Playwright's cache. These are local Chromium checks with simulated records. The live hosted application, production database and physical devices were not accessed.
