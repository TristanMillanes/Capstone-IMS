/* ==========================================================================
   PGENRO IMS — Shared Global Utilities, Navigation & Notifications
   ========================================================================== */
(function () {
  'use strict';

  function markActiveNavigation() {
    const links = Array.from(document.querySelectorAll('a'));
    let matched = null;
    let fallback = null;
    let currentUrl;
    try {
      currentUrl = new URL(location.href);
    } catch (e) {
      return;
    }
    const currentPath = (currentUrl.pathname || '').toLowerCase();
    const currentHash = currentUrl.hash || '';

    for (const a of links) {
      if (!a.href) continue;
      let target;
      try {
        target = new URL(a.href, location.href);
      } catch (e) {
        continue;
      }
      if (target.pathname.toLowerCase() === currentPath) {
        if (currentHash && target.hash === currentHash) {
          matched = a;
          break;
        }
        if (!target.hash && !fallback) {
          fallback = a;
        }
      }
    }

    const activeLink = matched || fallback;
    links.forEach(a => {
      const isActive = a === activeLink;
      a.classList.toggle('active', isActive);
      if (isActive) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function navbarScrollState() {
    const nav = document.querySelector('.navbar, .admin-navbar, header');
    if (!nav) return;
    window.addEventListener('scroll', () => {
      if (window.scrollY > 20) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    }, { passive: true });
  }

  function showToast(message, type = 'info') {
    let container = document.getElementById('pgenroToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'pgenroToastContainer';
      container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `pgenro-global-toast ${type}`;
    toast.style.cssText = 'background:#0b5d3b;color:#fff;padding:12px 18px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.18);font-size:14px;font-weight:600;display:flex;align-items:center;gap:10px;pointer-events:auto;transition:all .25s ease;opacity:0;transform:translateY(10px);';
    if (type === 'error') toast.style.background = '#dc2626';
    if (type === 'warning') toast.style.background = '#d97706';
    if (type === 'success') toast.style.background = '#059669';

    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  function setupScrollToTop() {
    const btn = document.getElementById('scrollToTopBtn');
    if (!btn) return;
    window.addEventListener('scroll', () => {
      if (window.scrollY > 300) btn.classList.add('visible');
      else btn.classList.remove('visible');
    }, { passive: true });
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  if (typeof window !== 'undefined') {
    window.pgenroToast = showToast;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      markActiveNavigation();
      navbarScrollState();
      setupScrollToTop();
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    });

    window.addEventListener('hashchange', () => {
      markActiveNavigation();
    });
  }
})();
