/* Apply the workspace theme before the page styles load. */
(() => {
  'use strict';
  if (window.PGENRO_Theme) return;

  const root = document.documentElement;
  const toggleSelector = '.user-appearance-toggle, #appearanceThemeBtn';
  const adminKey = 'pgenro_admin_theme';
  const userKey = 'pgenro_user_theme';
  const preferencesKey = 'pgenro_preferences';
  const isSettings = /\/SettingIMS\//i.test(location.pathname);
  const fromAdmin = isSettings && new URLSearchParams(location.search).get('from') === 'admin';
  let key = /\/admin\//i.test(location.pathname) || fromAdmin ? adminKey : userKey;
  let selected = read(key);
  let profileTheme = readProfileTheme(read(preferencesKey));
  let theme;

  function isTheme(value) {
    return value === 'light' || value === 'dark';
  }

  function read(name) {
    try { return localStorage.getItem(name); } catch { return null; }
  }

  function readProfileTheme(value) {
    try { return JSON.parse(value || '{}')?.theme; } catch { return undefined; }
  }

  function icon(dark) {
    const shape = dark
      ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>'
      : '<path d="M20.9 12.5A9 9 0 1 1 11.5 3a6.3 6.3 0 0 0 9.4 9.5Z"/>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + shape + '</svg>';
  }

  function render() {
    const dark = theme === 'dark';
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    for (const button of document.querySelectorAll(toggleSelector)) {
      if (button.dataset.appearance !== theme) button.innerHTML = icon(dark);
      button.dataset.appearance = theme;
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    const select = document.getElementById('appearanceThemeSelect');
    if (select) select.value = theme;
    if (isSettings) {
      for (const radio of document.querySelectorAll('input[name="theme"]')) {
        radio.checked = radio.value === theme;
      }
    }
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101d1b' : '#f3f6f5');
  }

  function apply() {
    const next = isTheme(selected) ? selected : isTheme(profileTheme) ? profileTheme : 'light';
    const changed = next !== theme;
    theme = next;
    if (root.dataset.theme !== theme) root.dataset.theme = theme;
    if (root.dataset.pgenroTheme !== theme) root.dataset.pgenroTheme = theme;
    render();
    if (changed) document.dispatchEvent(new CustomEvent('pgenro:themechange', {detail: {theme}}));
  }

  function set(value) {
    if (!isTheme(value)) return;
    selected = value;
    try { localStorage.setItem(key, value); } catch { /* Keep the current page usable. */ }
    apply();
  }

  apply();
  window.PGENRO_Theme = window.PGENRO_UserTheme = Object.freeze({
    get: () => theme,
    set,
    setScope(role, preferences) {
      if (!isSettings) return;
      const nextKey = role === 'admin' ? adminKey : userKey;
      if (nextKey !== key) {
        key = nextKey;
        selected = read(key);
      }
      profileTheme = preferences?.theme ?? readProfileTheme(read(preferencesKey));
      apply();
    },
    sync(preferences) {
      profileTheme = preferences?.theme;
      apply();
    }
  });

  window.addEventListener('storage', event => {
    if (event.key === key) selected = event.newValue;
    else if (event.key === preferencesKey) profileTheme = readProfileTheme(event.newValue);
    else if (event.key === null) selected = profileTheme = null;
    else return;
    apply();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    selected = read(key);
    profileTheme = readProfileTheme(read(preferencesKey));
    apply();
  });

  function init() {
    const header = document.querySelector('.public-header, .portal-topbar');
    if (header && !document.querySelector(toggleSelector)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'user-appearance-toggle';
      header.append(button);
    }
    document.addEventListener('click', event => {
      if (event.target.closest?.(toggleSelector)) set(theme === 'dark' ? 'light' : 'dark');
    });
    document.addEventListener('change', event => {
      if (event.target.id === 'appearanceThemeSelect' ||
          (isSettings && event.target.matches('input[name="theme"]:checked'))) {
        set(event.target.value);
      }
    });
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
