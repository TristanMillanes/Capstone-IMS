# Visitors Log - Supabase

The Visitors Log now uses the shared Supabase client in `../shared/supabase.js`. Anonymous kiosk submissions are limited by the Row Level Security policy created in `supabase/schema.sql`; authenticated active personnel can view/update records, while administrator permissions control deletion.

Do not add Firebase SDK scripts to this page.
