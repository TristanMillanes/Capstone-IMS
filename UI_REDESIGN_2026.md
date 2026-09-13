# PGENRO IMS — Unified Web Interface Redesign (2026)

This build keeps the existing Supabase/database logic and adds a shared presentation layer across the complete system.

## Redesigned interfaces

- Admin dashboard and all admin modules
- Staff dashboard and all staff/viewer modules
- Visitors administration
- Staff visitors view
- Public visitor registration kiosk
- Login portal
- Account access request portal
- Settings/profile console
- Inventory, Employees, Travel Orders, Office Memos, Communications, Service Requests and ICS

## Shared UI improvements

- Unified PGENRO green government design system
- Consistent spacing, typography, shadows, radii and controls
- Refined navbar and dark application drawer for staff modules
- Cleaner admin cards, filters, tables, forms and modals
- Improved table readability with sticky headers and row feedback
- Unified button states and input focus states
- Better status badges and visual hierarchy
- Responsive layout improvements for tablet and mobile
- Page entrance animation and section reveal animation
- Dynamic table-row animation
- Button ripple feedback
- Smooth internal HTML page transitions
- Navbar scroll elevation
- Automatic active sidebar module highlighting
- Back-to-top control on long authenticated pages
- Reduced-motion accessibility support
- Improved focus-visible accessibility
- Cache-busted shared UI assets for easier deployment updates

## New shared files

- `shared/pgenro-global.css`
- `shared/pgenro-global.js`

These files are intentionally presentation-only. They do not contain Supabase credentials, CRUD logic, authentication decisions, or database permissions.
