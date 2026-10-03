# Visitors Log — Supabase

The visitor kiosk retains its existing Supabase configuration and separate anonymous registration policy. Active personnel can view records; administrators encode records and record departures. Apply `../supabase/READONLY_USER_PATCH.sql` after other setup patches to enforce the current permissions.

Use `visitorsLogin.html` for the kiosk, `../User/visitorsView.html` for viewing, and `../admin/visitors-admin.html` for administrator actions.
