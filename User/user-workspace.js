/* User workspace layout and navigation. Database policies enforce record access. */
(() => {
  'use strict';

  const moduleGroups = [
    ['Overview', [['homepage.html', 'Office summary and charts']]],
    ['Office records', [
      ['communication.html', 'Incoming and outgoing correspondence'],
      ['officememo.html', 'Memoranda, notices and directives'],
      ['travelOR.html', 'Travel requests and official schedules']
    ]],
    ['Staff & operations', [
      ['my-attendance.html', 'Activity attendance and uniform monitoring'],
      ['stock.html', 'View stock quantities and availability'],
      ['inventory.html', 'Request supplies and track your own releases'],
      ['service.html', 'Requests, categories and progress'],
      ['ics.html', 'Inventory Custodian Slips and property accountability']
    ]]
  ];

  function mountModuleFinder(sidebar) {
    const list = sidebar.querySelector('.modules-list');
    const actions = document.querySelector('.depth-topbar-actions');
    if (!list || !actions) return;

    // Build the finder from the links already available on the page.
    const links = [...list.querySelectorAll('a[href]')].filter(link => !link.closest('[data-module-hidden]'));
    const byPath = new Map(links.map(link => [link.getAttribute('href'), link]));
    const modules = [];
    for (const [group, entries] of moduleGroups) {
      const heading = document.createElement('li');
      heading.className = 'workspace-nav-label';
      heading.textContent = group;
      heading.setAttribute('aria-hidden', 'true');
      let hasLinks = false;
      for (const [path, description] of entries) {
        const link = byPath.get(path);
        if (!link) continue;
        if (!hasLinks) list.append(heading);
        list.append(link.closest('li'));
        modules.push({link, description});
        hasLinks = true;
        byPath.delete(path);
      }
    }
    for (const link of byPath.values()) {
      list.append(link.closest('li'));
      modules.push({link, description: 'Workspace module'});
    }
    if (!modules.length) return;
    sidebar.classList.add('workspace-grouped-nav');

    const searchIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
    const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'workspace-find-button';
    trigger.setAttribute('aria-label', 'Find a module');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    trigger.innerHTML = searchIcon + '<span>Find a module</span><kbd aria-hidden="true"></kbd>';
    trigger.querySelector('kbd').textContent = shortcut;
    actions.prepend(trigger);

    const dialog = document.createElement('dialog');
    dialog.className = 'workspace-finder';
    dialog.setAttribute('aria-labelledby', 'workspaceFinderTitle');
    dialog.innerHTML = `
      <div class="workspace-finder-heading">
        <div><p>WORKSPACE NAVIGATION</p><h2 id="workspaceFinderTitle">Find a module</h2></div>
        <button type="button" class="workspace-finder-close" aria-label="Close module finder">×</button>
      </div>
      <label class="workspace-finder-input">
        ${searchIcon}<input type="search" aria-label="Search modules" placeholder="Try attendance, memos, or supplies" autocomplete="off" autofocus>
      </label>
      <p class="workspace-finder-count" role="status"></p>
      <ul class="workspace-finder-results" aria-label="Matching modules"></ul>
      <div class="workspace-finder-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> Move</span><span><kbd>Enter</kbd> Open</span><span><kbd>Esc</kbd> Close</span></div>`;
    document.body.append(dialog);

    const input = dialog.querySelector('input');
    const results = dialog.querySelector('ul');
    const count = dialog.querySelector('[role="status"]');
    const entries = modules.map(({link, description}) => {
      const row = document.createElement('li');
      const result = document.createElement('a');
      result.href = link.href;
      const symbol = document.createElement('span');
      symbol.className = 'workspace-finder-symbol';
      symbol.setAttribute('aria-hidden', 'true');
      const icon = link.querySelector('svg,i')?.cloneNode(true);
      if (icon) symbol.append(icon);
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = link.textContent.trim();
      const subtitle = document.createElement('small');
      subtitle.textContent = description;
      copy.append(title, subtitle);
      const hint = document.createElement('span');
      hint.className = 'workspace-finder-hint';
      const current = link.getAttribute('aria-current') === 'page';
      hint.textContent = current ? 'Current page' : '↗';
      if (current) result.setAttribute('aria-current', 'page');
      else hint.setAttribute('aria-hidden', 'true');
      result.append(symbol, copy, hint);
      row.append(result);
      results.append(row);
      return {row, result, terms: `${title.textContent} ${description}`.toLowerCase()};
    });
    let matches = entries;
    let opener;
    function filter() {
      const terms = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      matches = entries.filter(entry => {
        const match = terms.every(term => entry.terms.includes(term));
        entry.row.hidden = !match;
        return match;
      });
      results.scrollTop = 0;
      count.textContent = matches.length
        ? `${matches.length} ${matches.length === 1 ? 'module' : 'modules'}`
        : 'No modules match your search.';
    }
    function open(button) {
      if (dialog.open || document.querySelector('dialog[open], [aria-modal="true"][aria-hidden="false"], .sidebar.open')) return;
      opener = button;
      input.value = '';
      filter();
      dialog.showModal();
      input.focus();
    }
    trigger.addEventListener('click', () => open(trigger));
    document.querySelectorAll('[data-find-module]').forEach(button => {
      button.hidden = false;
      button.addEventListener('click', () => open(button));
    });
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.repeat || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return;
      if (!dialog.open && document.querySelector('dialog[open], [aria-modal="true"][aria-hidden="false"], .sidebar.open')) return;
      event.preventDefault();
      open(trigger);
    });
    dialog.querySelector('.workspace-finder-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      // Close before the existing workspace navigation handler receives the link click.
      if (event.target === dialog || event.target.closest('a[href]')) dialog.close();
    });
    dialog.addEventListener('close', () => opener?.focus({preventScroll: true}));
    input.addEventListener('input', filter);
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dialog.close();
        return;
      }
      if (event.key === 'Enter' && event.target === input && matches.length) {
        event.preventDefault();
        matches[0].result.click();
      }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !matches.length) return;
      const index = matches.findIndex(entry => entry.result === event.target);
      if (index < 0 && event.target !== input) return;
      event.preventDefault();
      if (event.key === 'ArrowUp') {
        if (index === 0) input.focus();
        else matches[index < 0 ? matches.length - 1 : index - 1].result.focus();
      } else {
        matches[(index + 1) % matches.length].result.focus();
      }
    });
    window.lucide?.createIcons?.();
  }

  function enableFilterTabs() {
    document.querySelectorAll('main [role="tablist"]').forEach(list => {
      const tabs = [...list.querySelectorAll(':scope > [role="tab"]')];
      if (!tabs.length) return;
      const sync = () => tabs.forEach(tab => { tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1; });
      const observer = new MutationObserver(sync);
      observer.observe(list, {subtree: true, attributes: true, attributeFilter: ['aria-selected']});
      sync();
      list.addEventListener('keydown', event => {
        const index = tabs.indexOf(event.target);
        if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].click();
        tabs[next].focus();
      });
    });
  }

  function showAllowedModules(sidebar, modules) {
    const access = window.PGENRO_USER_MODULES;
    const allowed = new Set(modules);
    document.querySelectorAll('a[href], [data-user-modules]').forEach(element => {
      const keys = element.dataset.userModules?.split(/\s+/) || [access.fromUrl(element.href)].filter(Boolean);
      if (!keys.length || keys.some(key => allowed.has(key))) return;
      (element.closest('.modules-list li') || element).setAttribute('data-module-hidden', '');
    });

    const notice = document.getElementById('moduleAccessNotice');
    if (notice) {
      const url = new URL(location.href);
      const key = url.searchParams.get('access');
      if (Object.hasOwn(access.catalog, key) && !allowed.has(key)) {
        notice.textContent = `Your account does not have access to ${access.catalog[key].label}. Contact your administrator.`;
      } else if (!allowed.size) {
        notice.textContent = 'Your account is active. Ask your administrator to grant access to the modules you need.';
      }
      notice.hidden = !notice.textContent;
      if (url.searchParams.has('access')) {
        url.searchParams.delete('access');
        history.replaceState(history.state, '', url);
      }
    }

    if (getComputedStyle(document.body).getPropertyValue('--workspace-topbar')) mountModuleFinder(sidebar);
  }

  function bindInventoryNavigation() {
    const sidebar = document.getElementById('sidebar');
    const menu = document.getElementById('hamburgerMenu');
    const overlay = document.getElementById('overlay');
    const profile = document.getElementById('profileMenu');
    const profileButton = document.getElementById('profileBtn');
    const profileDropdown = document.getElementById('profileDropdown');
    const mobile = matchMedia('(max-width: 900px)');

    function setProfile(open) {
      profile.classList.toggle('open', open);
      profileButton.setAttribute('aria-expanded', String(open));
      profileDropdown.setAttribute('aria-hidden', String(!open));
    }

    function setSidebar(open) {
      sidebar.classList.toggle('open', open);
      overlay.classList.toggle('active', open);
      document.body.classList.toggle('sidebar-open', open);
      menu.setAttribute('aria-expanded', String(open));
    }

    menu.addEventListener('click', () => {
      if (mobile.matches) {
        setProfile(false);
        setSidebar(!sidebar.classList.contains('open'));
      }
    });
    overlay.addEventListener('click', () => setSidebar(false));
    mobile.addEventListener('change', () => {
      if (!mobile.matches && sidebar.classList.contains('open')) setSidebar(false);
    });
    profileButton.addEventListener('click', () => setProfile(!profile.classList.contains('open')));
    document.addEventListener('click', event => {
      if (!profile.contains(event.target)) setProfile(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (profile.classList.contains('open')) {
        setProfile(false);
        profileButton.focus();
      } else if (sidebar.classList.contains('open')) {
        setSidebar(false);
        menu.focus();
      }
    });
  }

  function init() {
    if (document.body.dataset.unifiedLayoutReady) return;
    document.body.dataset.unifiedLayoutReady = 'true';
    if (document.body.dataset.cssScope === 'user-inventory') bindInventoryNavigation();
    function hideAdminRecordLinks() {
      if (!document.body.classList.contains('pgenro-user')) return;
      document.querySelectorAll('a[href*="visitorsView"],a[href*="visitors-admin"],a[href="employee.html"],a[href$="/employee.html"],a[href*="employee-admin.html"]').forEach(link => {
        const row = link.closest('.modules-list li, .sidebar li');
        (row || link).remove();
      });
    }
    hideAdminRecordLinks();
    document.querySelectorAll('.modules-list a[href="inventory.html"] span:first-of-type').forEach(label => {
      label.textContent = 'Supply Requests';
    });
    // A wide registry scrolls within its own region, including dynamically mounted tables.
    function containTables() {
      document.querySelectorAll('main table,.modal-body table,.modal-content table').forEach(table => {
        if (table.closest('.table-responsive,.table-wrapper,.table-container,.table-scroll,.responsive-table,.ui-table-scroll,.ws-table-scroll,.audit-table-scroll,.monitor-table-scroll')) return;
        const region = document.createElement('div'); region.className = 'ui-table-scroll';
        table.before(region); region.append(table);
      });
    }
    containTables();
    let tableFrame;
    const insertedTables = new MutationObserver(records => {
      const selector = 'table,a[href*="visitorsView"],a[href*="visitors-admin"],a[href="employee.html"],a[href$="/employee.html"],a[href*="employee-admin.html"]';
      if (!records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches?.(selector) || node.querySelector?.(selector))))) return;
      cancelAnimationFrame(tableFrame); tableFrame = requestAnimationFrame(() => {containTables(); hideAdminRecordLinks();});
    });
    insertedTables.observe(document.body, {childList:true,subtree:true});
    document.querySelector('.admin-sidebar-close')?.addEventListener('click',()=>document.getElementById('sidebarBackdrop')?.click());
    // The existing user page controls continue to open and close its module menu.
    const sidebar = document.querySelector('.pgenro-user .sidebar');
    if (sidebar) {
      // The module finder uses the redesigned workspace styles when installed.
      if (document.body.dataset.requiresAuth === 'user') {
        document.addEventListener('pgenro:user-modules-ready', event => showAllowedModules(sidebar, event.detail), { once: true });
      } else if (getComputedStyle(document.body).getPropertyValue('--workspace-topbar')) {
        mountModuleFinder(sidebar);
      }
      enableFilterTabs();
      const media = matchMedia('(max-width: 900px)'), menu = document.getElementById('hamburgerMenu');
      let previouslyOpen = false, preferredCollapsed = false;
      try { preferredCollapsed = localStorage.getItem('pgenro_user_sidebar') === 'collapsed'; } catch {}
      sidebar.querySelectorAll('.modules-list a').forEach(link=>link.title=link.textContent.trim());
      function desktopNavigation() {
        const collapsed = !media.matches && preferredCollapsed;
        sidebar.classList.toggle('collapsed',collapsed);document.body.classList.toggle('user-sidebar-collapsed',collapsed);
        if(!media.matches&&menu){menu.setAttribute('aria-expanded',String(!collapsed));menu.setAttribute('aria-label',collapsed?'Expand module menu':'Collapse module menu');menu.title=menu.getAttribute('aria-label');}
      }
      menu?.addEventListener('click',event=>{
        if(media.matches)return;
        event.preventDefault();event.stopImmediatePropagation();
        preferredCollapsed = !sidebar.classList.contains('collapsed');
        try{localStorage.setItem('pgenro_user_sidebar',preferredCollapsed?'collapsed':'expanded');}catch{}
        desktopNavigation();
      },true);
      function sync() {
        const open = media.matches && sidebar.classList.contains('open');
        sidebar.inert = media.matches && !open;
        sidebar.setAttribute('aria-hidden', String(media.matches && !open));
        if (open && !previouslyOpen) sidebar.querySelector('.user-sidebar-close,a[href]')?.focus({preventScroll:true});
        if (!open && previouslyOpen) menu?.focus({preventScroll:true});
        previouslyOpen = open;
      }
      const state = new MutationObserver(sync); state.observe(sidebar,{attributes:true,attributeFilter:['class']});
      media.addEventListener('change',()=>{desktopNavigation();sync();});desktopNavigation();sync();
      let navigationFrame;
      window.addEventListener('resize',()=>{cancelAnimationFrame(navigationFrame);navigationFrame=requestAnimationFrame(desktopNavigation);});
      window.addEventListener('pagehide',()=>cancelAnimationFrame(navigationFrame));
      document.querySelector('.user-sidebar-close')?.addEventListener('click',()=>{ if(sidebar.classList.contains('open')) menu?.click(); });
      document.addEventListener('keydown',event=>{
        if(!media.matches||!sidebar.classList.contains('open')) return;
        if(event.key==='Escape') {menu?.click();return;}
        if(event.key!=='Tab')return;
        const items=[...sidebar.querySelectorAll('a[href],button:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length && !el.closest('[inert]'));
        if(!items.length)return;
        const first=items[0],last=items.at(-1);
        if(!sidebar.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();}
        else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      });
    }
    window.addEventListener('pagehide',event=>{if(event.persisted)return;insertedTables.disconnect();cancelAnimationFrame(tableFrame);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
