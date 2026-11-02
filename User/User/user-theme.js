/* One User appearance controller. Runs before CSS to avoid a light-mode flash. */
(() => {
  'use strict';
  if (window.PGENRO_UserTheme) return;
  const root = document.documentElement;
  const valid = value => value === 'dark' || value === 'light';
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  function preferences(value = read('pgenro_preferences')) {
    try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
    catch { return {}; }
  }
  let theme = valid(read('pgenro_user_theme')) ? read('pgenro_user_theme') : preferences().theme;
  theme = valid(theme) ? theme : 'light';
  const icon = dark => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dark ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>' : '<path d="M20.9 12.5A9 9 0 1 1 11.5 3a6.3 6.3 0 0 0 9.4 9.5Z"/>'}</svg>`;
  function render() {
    const dark = theme === 'dark';
    document.querySelectorAll('.user-appearance-toggle').forEach(button => {
      if (button.dataset.appearance !== theme) button.innerHTML = icon(dark);
      button.dataset.appearance = theme;
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = button.getAttribute('aria-label');
    });
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101d1b' : '#f3f6f5');
  }
  function apply(value, persist = false) {
    const next = valid(value) ? value : 'light', changed = next !== theme;
    theme = next;
    if (root.dataset.theme !== theme) root.dataset.theme = theme;
    if (root.dataset.pgenroTheme !== theme) root.dataset.pgenroTheme = theme;
    root.style.colorScheme = theme;
    if (persist) {
      try {
        localStorage.setItem('pgenro_user_theme', theme);
        localStorage.setItem('pgenro_preferences', JSON.stringify({...preferences(), theme}));
      } catch { /* Appearance still works when browser storage is unavailable. */ }
    }
    render();
    if (changed) document.dispatchEvent(new CustomEvent('pgenro:themechange', {detail:{theme}}));
  }
  apply(theme);
  window.PGENRO_UserTheme = Object.freeze({get: () => theme, set: value => apply(value, true)});
  new MutationObserver(records => {
    const record = records.filter(item => valid(root.getAttribute(item.attributeName))).at(-1);
    if (record) apply(root.getAttribute(record.attributeName));
  }).observe(root, {attributes:true, attributeFilter:['data-theme','data-pgenro-theme']});
  window.addEventListener('storage', event => {
    if (event.key === 'pgenro_user_theme') apply(valid(event.newValue) ? event.newValue : preferences().theme);
    else if (event.key === 'pgenro_preferences') apply(preferences(event.newValue).theme);
    else if (event.key === null) apply('light');
  });
  function init() {
    if (!document.querySelector('.user-appearance-toggle')) {
      const header = document.querySelector('.public-header,.portal-topbar');
      if (header) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'user-appearance-toggle';
        header.append(button);
      }
    }
    document.addEventListener('click', event => {
      const button = event.target.closest?.('.user-appearance-toggle');
      if (!button) return;
      apply(theme === 'dark' ? 'light' : 'dark', true);
    });
    window.addEventListener('pageshow', () => apply(valid(read('pgenro_user_theme')) ? read('pgenro_user_theme') : theme));
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
