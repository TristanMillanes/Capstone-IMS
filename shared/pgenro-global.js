/* PGENRO IMS — Shared UI polish. No database/auth logic lives here. */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function classifyPage() {
    const p = location.pathname.replace(/\\/g, '/').toLowerCase();
    const body = document.body;
    if (!body) return;
    if (p.includes('/admin/')) body.classList.add('pgenro-admin');
    else if (p.includes('/visitorslog/')) body.classList.add('pgenro-public-visitor');
    else if (p.includes('/settingims/')) body.classList.add('pgenro-user', 'pgenro-settings');
    else if (p.endsWith('/user/login.html') || p.endsWith('/user/login')) body.classList.add('pgenro-auth', 'pgenro-login');
    else if (p.endsWith('/user/requestacc.html') || p.endsWith('/user/requestacc')) body.classList.add('pgenro-auth', 'pgenro-request');
    else if (p.includes('/user/')) body.classList.add('pgenro-user');
  }

  function markActiveNavigation() {
    const links = [...document.querySelectorAll('.sidebar-nav a[href], .modules-list a[href]')];
    const matches = links.filter(a => {
      const u = new URL(a.href, location.href);
      return u.pathname.toLowerCase() === location.pathname.toLowerCase() &&
        (u.hash ? u.hash === location.hash : !location.hash || ['#home', '#dashboard'].includes(location.hash));
    });
    const selected = matches[0] || links.find(a => {
      const u = new URL(a.href, location.href);
      return u.pathname.toLowerCase() === location.pathname.toLowerCase() && !u.hash;
    });
    links.forEach(a => {
      a.classList.toggle('active', a === selected);
      if (a === selected) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function navbarScrollState() {
    const nav = document.querySelector('.navbar, .topbar');
    if (!nav) return;
    const sync = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
    sync();
    window.addEventListener('scroll', sync, { passive:true });
  }

  function rippleButtons() {
    document.addEventListener('pointerdown', e => {
      const btn = e.target.closest('button, .btn, .btn-primary, .btn-secondary, .btn-solid, .primary-sign-btn, .submit-btn');
      if (!btn || reduceMotion || btn.disabled || e.button !== 0) return;
      btn.classList.add('pgr-ripple-host');
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 1.8;
      const dot = document.createElement('span');
      dot.className = 'pgr-ripple';
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${e.clientX - r.left}px`;
      dot.style.top = `${e.clientY - r.top}px`;
      btn.appendChild(dot);
      window.setTimeout(() => dot.remove(), 600);
    }, { passive:true });
  }

  function revealContent() {
    if (reduceMotion) return;
    const selectors = [
      '.stat-card','.metric-card','.kpi-card','.panel-card','.table-card','.records-card',
      '.detail-card','.dossier-card','.settings-sidebar-card','.module-header','.page-header',
      '.dashboard-header-banner','.glass-login-card','.app-shell'
    ];
    const nodes = [...document.querySelectorAll(selectors.join(','))].filter((el,i,arr) => arr.indexOf(el) === i);
    nodes.forEach((el, i) => {
      el.classList.add('pgr-animate');
      el.style.transitionDelay = `${Math.min(i % 6, 5) * 35}ms`;
    });
    if (!('IntersectionObserver' in window)) {
      nodes.forEach(n => n.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      io.unobserve(entry.target);
    }), { threshold:.06, rootMargin:'0px 0px -20px 0px' });
    nodes.forEach(n => io.observe(n));
  }

  function animateInsertedRows() {
    if (reduceMotion || !('MutationObserver' in window)) return;
    const tables = document.querySelectorAll('tbody');
    const obs = new MutationObserver(mutations => {
      for (const m of mutations) {
        [...m.addedNodes].forEach((node, idx) => {
          if (!(node instanceof HTMLElement) || node.tagName !== 'TR') return;
          node.classList.add('pgr-table-enter');
          node.style.animationDelay = `${Math.min(idx, 8) * 24}ms`;
          setTimeout(() => node.classList.remove('pgr-table-enter'), 650);
        });
      }
    });
    tables.forEach(t => obs.observe(t, { childList:true }));
  }

  function mountFloatingUtilities() {
    const body = document.body;
    if (!body || body.classList.contains('pgenro-auth') || body.classList.contains('pgenro-public-visitor')) return;

    if (!document.querySelector('.scroll-to-top-btn, .pgr-scroll-top')) {
      const top = document.createElement('button');
      top.type = 'button';
      top.className = 'pgr-scroll-top';
      top.setAttribute('aria-label', 'Back to top');
      top.innerHTML = '<i data-lucide="arrow-up"></i>';
      body.appendChild(top);
      const sync = () => top.classList.toggle('is-visible', window.scrollY > 520);
      sync();
      window.addEventListener('scroll', sync, { passive:true });
      top.addEventListener('click', () => window.scrollTo({ top:0, behavior: reduceMotion ? 'auto' : 'smooth' }));
    }

    if (!document.querySelector('.pgr-route-progress')) {
      const bar = document.createElement('div');
      bar.className = 'pgr-route-progress';
      bar.setAttribute('aria-hidden','true');
      body.appendChild(bar);
    }
  }

  function smoothInternalPageTransitions() {
    if (reduceMotion) return;
    document.addEventListener('click', e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const raw = a.getAttribute('href') || '';
      if (!raw || raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return;
      let url;
      try { url = new URL(a.href, location.href); } catch { return; }
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (url.origin !== location.origin || !/\.html?(?:$|[?#])/i.test(url.href)) return;
      e.preventDefault();
      const bar = document.querySelector('.pgr-route-progress');
      if (bar) bar.classList.add('is-active');
      document.body.classList.add('is-leaving');
      window.setTimeout(() => { location.href = url.href; }, 155);
    });
  }

  function improveTables() {
    document.querySelectorAll('table').forEach(table => {
      if (!table.getAttribute('role')) table.setAttribute('role','table');
      table.querySelectorAll('thead th').forEach(th => th.setAttribute('scope','col'));
    });
  }

  function syncLucideAfterDynamicUi() {
    if (!window.lucide || typeof window.lucide.createIcons !== 'function') return;
    try { window.lucide.createIcons(); } catch (_) {}
  }

  function init() {
    if (document.body.dataset.pgrInitialized) return;
    document.body.dataset.pgrInitialized = 'true';
    classifyPage();
    document.body.classList.add('is-ui-ready');
    markActiveNavigation();
    window.addEventListener('hashchange', markActiveNavigation);
    window.addEventListener('pageshow', () => {
      document.body.classList.remove('is-leaving');
      document.querySelector('.pgr-route-progress')?.classList.remove('is-active');
    });
    navbarScrollState();
    rippleButtons();
    revealContent();
    animateInsertedRows();
    smoothInternalPageTransitions();
    improveTables();
    mountFloatingUtilities();
    syncLucideAfterDynamicUi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
