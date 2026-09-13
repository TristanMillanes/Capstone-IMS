/**
 * Deprecated compatibility shim.
 * All pages must load ../shared/supabase.js. This file intentionally does not
 * create another Supabase client, preventing duplicate Auth sessions.
 */
(() => {
  "use strict";
  if (!window.pgenroSupabase || !window.PGENRO_DB) {
    console.error("PGENRO IMS: load shared/supabase.js before the visitor compatibility shim.");
    return;
  }
})();
