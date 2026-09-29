/* ==========================================================================
   PGENRO IMS — Settings Runtime Engine
   ========================================================================== */
(function () {
  'use strict';

  function applyPreferences() {
    try {
      const prefs = JSON.parse(localStorage.getItem('pgenro_preferences') || '{}');
      if (prefs.theme) {
        document.documentElement.dataset.theme = prefs.theme;
        document.documentElement.dataset.pgenroTheme = prefs.theme;
      }
      if (prefs.compact) {
        document.documentElement.classList.add('pgenro-compact');
      }
      if (prefs.reduceMotion) {
        document.documentElement.classList.add('pgenro-reduce-motion');
      }
    } catch (e) {}

    try {
      const settings = JSON.parse(localStorage.getItem('pgenro_system_settings') || '{}');
      if (typeof window !== 'undefined') {
        window.PGENRO_SYSTEM_SETTINGS = settings;
      }
      if (settings.announcement_enabled && settings.announcement) {
        const renderAnnouncement = () => {
          if (document.querySelector('.pgenro-system-announcement')) return;
          const bar = document.createElement('div');
          bar.className = 'pgenro-system-announcement';
          bar.style.cssText = 'background:#065f46;color:#ffffff;padding:8px 16px;text-align:center;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;position:relative;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.1);';
          bar.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#34d399;"></span>' + settings.announcement;
          document.body.prepend(bar);
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', renderAnnouncement);
        } else {
          renderAnnouncement();
        }
      }
    } catch (e) {
      if (typeof window !== 'undefined') {
        window.PGENRO_SYSTEM_SETTINGS = {};
      }
    }
  }

  applyPreferences();
})();
