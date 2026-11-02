# PGENRO IMS — Organization & Responsive Fix (2026-09-14)

## Fixed
- Added **Settings** to every authenticated User profile dropdown.
- Centralized User sidebar/profile/logout behavior in `user-javascript/pgenro-user.js`.
- Removed duplicated User hamburger/profile/logout event handlers from module scripts.
- Centralized Admin sidebar/profile/notification/logout behavior in `admin-javascript/admin-ui.js` and `shared/supabase.js`.
- Removed duplicated Admin shell handlers from module scripts.
- Fixed User profile display mapping: primary label is the account name; secondary label is role/position.
- Added fresh Supabase profile synchronization event so the visible profile updates after authorization/profile refresh.
- Improved shared overlay coordination so drawers/modals and the mobile sidebar do not fight over the overlay state.
- Fixed profile dropdown clipping by letting the sidebar shell overflow visibly while the module list remains the scrollable area.
- Consolidated final responsive action-button rules so buttons wrap without randomly stretching to full width.
- Added `CODE_STRUCTURE.md` with ownership rules for shared vs module code.
- Moved old maintenance reports into `docs/maintenance/` and removed packaged `.git` metadata.

## Validation performed
- JavaScript syntax checked with Node for all project `.js` files.
- Local HTML/CSS/JS/image references checked across User, Admin, Settings and Visitors pages.
- Duplicate HTML IDs checked.
- CSS structural brace balance checked.
- Verified every authenticated User page loads the organized shared shell and contains the Settings menu item.
- Verified module scripts no longer register direct shared profile/hamburger/logout handlers.

## Architecture rule going forward
Do not put sidebar/profile/logout click handlers inside module JavaScript. User shell controls belong to `pgenro-user.js`; Admin shell controls belong to `admin-ui.js`; Supabase logout/auth belongs to `shared/supabase.js`.
