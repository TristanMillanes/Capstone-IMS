/* Applies saved PGENRO account/system preferences without owning module CRUD. */
(() => {
  'use strict';
  const safeParse = (v, fallback={}) => { try { return JSON.parse(v) ?? fallback; } catch { return fallback; } };
  const cached = safeParse(localStorage.getItem('pgenro_preferences'), {});
  let inactivityTimer = null;
  let lastActivityReset = 0;

  function applyPreferences(prefs={}) {
    const theme = ['light','dark'].includes(prefs.theme) ? prefs.theme : 'light';
    document.documentElement.dataset.pgenroTheme = theme;
    document.body?.classList.toggle('pgenro-compact', !!prefs.compact);
    document.body?.classList.toggle('pgenro-reduced-motion', !!prefs.reduceMotion);
  }
  applyPreferences(cached);

  function showAnnouncement(message) {
    let bar = document.querySelector('.pgenro-system-announcement');
    if (!message) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'pgenro-system-announcement';
      bar.setAttribute('role','status');
      document.body.prepend(bar);
    }
    bar.textContent = message;
    bar.hidden = false;
  }

  function applyAccountRequestAvailability(enabled) {
    document.documentElement.dataset.accountRequestsEnabled = enabled ? 'true' : 'false';
    if (enabled) return;
    document.querySelectorAll('a[href*="requestACC.html"]').forEach(link => {
      link.setAttribute('aria-disabled','true');
      link.title = 'New account requests are currently disabled by the administrator.';
      link.addEventListener('click', event => {
        event.preventDefault();
        alert('New account requests are currently disabled by the system administrator.');
      });
    });
    const form = document.getElementById('accessForm');
    if (form) {
      const submit = form.querySelector('[type="submit"]');
      if (submit) { submit.disabled = true; submit.title = 'Account requests are currently disabled.'; }
      form.addEventListener('submit', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert('New account requests are currently disabled by the system administrator.');
      }, true);
      if (!document.querySelector('.account-request-disabled-note')) {
        const note = document.createElement('div');
        note.className = 'pgenro-system-announcement account-request-disabled-note';
        note.textContent = 'New account requests are temporarily disabled by the system administrator.';
        form.before(note);
      }
    }
  }

  function configureSessionTimeout(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value < 5) return;
    const timeoutMs = Math.min(value, 480) * 60 * 1000;
    const reset = () => {
      const now = Date.now();
      if (now - lastActivityReset < 15000) return;
      lastActivityReset = now;
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(async () => {
        try { await window.pgenroSupabase?.auth?.signOut?.(); } catch {}
        try {
          localStorage.removeItem('pgenro_current_user');
          sessionStorage.removeItem('pgenro_session_active');
          sessionStorage.removeItem('pgenro_session_token');
        } catch {}
        const login = new URL('../User/login.html', location.href);
        location.replace(login.href);
      }, timeoutMs);
    };
    ['pointerdown','keydown','scroll','touchstart'].forEach(name => addEventListener(name, reset, { passive:true }));
    reset();
  }

  async function sync() {
    const sb = window.pgenroSupabase;
    if (!sb) return;

    // System settings are intentionally public-readable and non-sensitive.
    try {
      const { data: settingsRow, error: settingsError } = await sb.from('system_settings').select('settings').eq('id',1).maybeSingle();
      if (!settingsError && settingsRow?.settings) {
        const s = settingsRow.settings;
        window.PGENRO_SYSTEM_SETTINGS = s;
        const announcement = s.announcement_enabled === false ? '' : String(s.announcement || '').trim();
        showAnnouncement(announcement || (s.maintenance_mode ? 'PGENRO IMS maintenance mode is currently enabled. Some services may be temporarily limited.' : ''));
        applyAccountRequestAvailability(s.account_requests_enabled !== false);
        window.PGENRO_DEFAULT_PAGE_SIZE = Number(s.default_page_size || 25);
        if (document.body?.dataset?.requiresAuth) configureSessionTimeout(s.session_timeout_minutes || 30);
      }
    } catch (err) {
      console.debug('PGENRO system settings fallback:', err?.message || err);
    }

    try {
      const { data:{ user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: profile, error } = await sb.from('profiles').select('preferences').eq('user_id', user.id).maybeSingle();
      if (!error && profile?.preferences) {
        localStorage.setItem('pgenro_preferences', JSON.stringify(profile.preferences));
        applyPreferences(profile.preferences);
      }
    } catch (err) {
      console.debug('PGENRO user preferences fallback:', err?.message || err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once:true });
  else sync();
})();
