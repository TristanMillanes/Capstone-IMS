# PGENRO IMS Responsive Button Fix — September 14, 2026

## What was fixed

- Removed the mobile behavior that stretched action buttons to `width: 100%` when a natural button width is more appropriate.
- Neutralized legacy `flex: 1` / `flex: 1 1 100%` rules that caused buttons to grow unpredictably.
- Action button groups now wrap naturally on narrow screens instead of forcing every button to fill the row.
- Buttons keep `max-width: 100%` so long labels cannot overflow the viewport.
- On very narrow screens, button labels are allowed to wrap instead of causing horizontal overflow.
- Search and filter controls still stack vertically on mobile, so input usability is preserved while action buttons remain compact.
- Fixed page-specific mobile button stretching in:
  - User Inventory
  - User dashboard/hero actions
  - User Employee / Travel action toolbars
  - User Office Memo modal actions
  - User Account Request gateway
  - Admin Inventory
  - Admin Services
  - Admin Visitors
  - Admin ICS
  - Shared Admin page headers and modal/form actions
- Restored `SettingIMS/Setting.css` in `Settings.html`; the stylesheet existed but was not being loaded.
- Added cache-busting versions to shared responsive styles so browsers fetch the updated CSS instead of reusing stale rules.

## Responsive behavior

- Desktop: buttons stay at their intended intrinsic size.
- Tablet: action groups wrap when space becomes limited.
- Mobile: action buttons remain compact and wrap to a new line when needed.
- Very small screens: long button labels wrap safely without horizontal overflow.
- Form/search controls remain full-width where full-width behavior is useful.

## Validation completed

- All 31 CSS files parsed successfully with no CSS parse errors.
- All 25 HTML pages were checked for broken local stylesheet/script/image paths and duplicate IDs.
- All JavaScript files passed `node --check` syntax validation.
