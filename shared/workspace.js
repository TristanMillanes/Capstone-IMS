/* Shared layout accessibility. Database and record actions remain in module scripts. */
(() => {
  'use strict';
  function init() {
    if (document.body.dataset.workspaceReady) return;
    document.body.dataset.workspaceReady = 'true';
    const main = document.querySelector('main');
    if (main && !document.querySelector('.admin-ui-skip-link,.ws-skip-link')) {
      main.id ||= 'workspaceMain';
      main.setAttribute('tabindex', '-1');
      const skip = document.createElement('a');
      skip.className = 'ws-skip-link'; skip.href = `#${main.id}`;
      skip.textContent = 'Skip to content'; document.body.prepend(skip);
    }
    document.querySelectorAll('table').forEach(table => {
      if (!table.closest('.table-responsive,.table-wrapper,.table-container,.records-table-wrapper,.ics-table-wrapper,.ws-table-scroll')) {
        const wrap = document.createElement('div'); wrap.className = 'ws-table-scroll';
        table.before(wrap); wrap.append(table);
      }
      const wrap = table.parentElement;
      if (wrap && getComputedStyle(wrap).overflowX === 'auto') {
        wrap.setAttribute('tabindex','0'); wrap.setAttribute('role','region');
        wrap.setAttribute('aria-label', `${document.querySelector('h1')?.textContent.trim() || 'Records'} table, scroll horizontally for more columns`);
      }
    });
    document.querySelectorAll('.pgenro-global-toast,[id$="Toast"]').forEach(el => {
      el.setAttribute('role','status'); el.setAttribute('aria-live','polite');
    });
    const sidebar = document.getElementById('sidebar');
    const menuButton = document.getElementById('hamburgerMenu');
    const overlay = document.getElementById('overlay');
    const isUser = document.body.classList.contains('pgenro-user');
    const mobile = matchMedia('(max-width:1024px)');
    const profileMenu = document.querySelector('.profile-menu');
    const profileButton = profileMenu?.querySelector('.profile-btn,.pgenro-profile-trigger');
    const dropdown = profileMenu?.querySelector('.profile-dropdown,.pgenro-profile-dropdown');
    const focusable = root => [...root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    function closeMenu(restore = false) {
      if (!sidebar || !isUser) return;
      sidebar.classList.remove('open'); menuButton?.classList.remove('active');
      menuButton?.setAttribute('aria-expanded','false');
      main?.classList.remove('blur'); document.body.classList.remove('ws-menu-open');
      // Only clear a navigation backdrop when no record drawer uses it.
      if (!document.querySelector('.drawer.open,.detail-drawer.open,.modal.open,.modal.active,#detailDrawer.open')) overlay?.classList.remove('active');
      sidebar.inert = mobile.matches;
      if (restore) menuButton?.focus();
    }
    function closeProfile(restore = false) {
      if (!isUser || !profileMenu || !dropdown) return;
      profileMenu.classList.remove('open'); dropdown.classList.remove('open','show','active');
      profileButton?.setAttribute('aria-expanded','false');
      if (restore) profileButton?.focus();
    }
    if (isUser && sidebar && menuButton) {
      menuButton.setAttribute('aria-controls',sidebar.id);
      menuButton.setAttribute('aria-expanded','false');
      if (menuButton.tagName !== 'BUTTON') {
        menuButton.setAttribute('role','button'); menuButton.tabIndex=0;
        menuButton.addEventListener('keydown',event => {
          if (['Enter',' '].includes(event.key)) { event.preventDefault(); menuButton.click(); }
        });
      }
      sidebar.inert = mobile.matches && !sidebar.classList.contains('open');
      mobile.addEventListener('change', () => { closeMenu(); sidebar.inert=mobile.matches; });
    }
    if (isUser && profileButton && dropdown) {
      profileButton.setAttribute('aria-label','Open profile menu');
      profileButton.setAttribute('aria-haspopup','menu');
      profileButton.setAttribute('aria-expanded','false');
      dropdown.id ||= 'workspaceProfileDropdown';
      profileButton.setAttribute('aria-controls', dropdown.id);
    }
    // Own user shell clicks in one place. Capture prevents older per-page toggles
    // from immediately reversing the same state, while record actions still bubble.
    document.addEventListener('click',event => {
      if (!isUser || !(event.target instanceof Element)) return;
      if (menuButton?.contains(event.target)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!mobile.matches || !sidebar) return;
        if (sidebar.classList.contains('open')) closeMenu(true);
        else {
          sidebar.inert=false; sidebar.classList.add('open'); menuButton.classList.add('active');
          menuButton.setAttribute('aria-expanded','true'); overlay?.classList.add('active');
          document.body.classList.add('ws-menu-open'); closeProfile();
          focusable(sidebar)[0]?.focus();
        }
        return;
      }
      if (profileButton?.contains(event.target)) {
        event.preventDefault(); event.stopImmediatePropagation();
        const opening = !profileMenu.classList.contains('open');
        closeProfile(); closeMenu();
        if (opening) { profileMenu.classList.add('open'); dropdown.classList.add('open'); profileButton.setAttribute('aria-expanded','true'); focusable(dropdown)[0]?.focus(); }
        return;
      }
      if (event.target === overlay && sidebar?.classList.contains('open')) { event.stopImmediatePropagation(); closeMenu(true); }
      if (sidebar?.contains(event.target) && event.target.closest('a[href]') && mobile.matches) closeMenu();
      if (profileMenu && !profileMenu.contains(event.target)) closeProfile();
    },true);
    document.addEventListener('keydown',event => {
      if (!isUser) return;
      if (event.key === 'Escape') { const menuWasOpen=sidebar?.classList.contains('open'); const profileWasOpen=profileMenu?.classList.contains('open'); closeMenu(!!menuWasOpen); closeProfile(!!profileWasOpen); }
      const region = mobile.matches && sidebar?.classList.contains('open') ? sidebar : profileMenu?.classList.contains('open') ? dropdown : null;
      if (event.key === 'Tab' && region) {
        const nodes=focusable(region); if (!nodes.length) return;
        const first=nodes[0],last=nodes[nodes.length-1];
        if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus(); }
      }
    });
    window.addEventListener('pageshow', () => { closeMenu(); closeProfile(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
