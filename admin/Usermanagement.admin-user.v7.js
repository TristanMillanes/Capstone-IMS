/* Compatibility entry for previously cached User Management pages. */
(() => {
  if (window.PGENRO_USER_MANAGEMENT_SCRIPT_BUILD || [...document.scripts].some(script => /\/Usermanagement\.js(?:[?#]|$)/.test(script.src))) return;
  const script = document.createElement('script');
  script.src = new URL('Usermanagement.js?v=20261103-frontend-fix',document.currentScript.src).href;
  document.head.append(script);
})();
