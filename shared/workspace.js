/* ==========================================================================
   PGENRO IMS — Shared Workspace Controls & Responsive UI
   ========================================================================== */
(function () {
  'use strict';

  function initSidebar() {
    const hamburgerMenu = document.getElementById('hamburgerMenu');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    const mainContent = document.querySelector('.main-content') || document.querySelector('.main-panel') || document.querySelector('main');

    if (hamburgerMenu && sidebar) {
      hamburgerMenu.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        sidebar.classList.toggle('active');
        hamburgerMenu.classList.toggle('active');
        if (overlay) overlay.classList.toggle('active');
        if (mainContent) mainContent.classList.toggle('blur');
      });

      if (overlay) {
        overlay.addEventListener('click', () => {
          sidebar.classList.remove('open');
          sidebar.classList.remove('active');
          hamburgerMenu.classList.remove('active');
          overlay.classList.remove('active');
          if (mainContent) mainContent.classList.remove('blur');
        });
      }
    }

    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    if (collapseBtn && sidebar) {
      collapseBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
      });
    }
  }

  function initProfileMenu() {
    const profileBtn = document.getElementById('profileBtn') || document.querySelector('.pgenro-profile-trigger');
    const profileMenu = document.getElementById('profileMenu') || document.querySelector('.pgenro-profile-dropdown') || document.querySelector('.profile-dropdown');

    if (profileBtn && profileMenu) {
      profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = profileMenu.classList.toggle('open');
        profileBtn.setAttribute('aria-expanded', String(isOpen));
      });

      document.addEventListener('click', (e) => {
        if (!profileMenu.contains(e.target) && !profileBtn.contains(e.target)) {
          profileMenu.classList.remove('open');
          profileBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  function initLogout() {
    const logoutButtons = document.querySelectorAll('[data-pgenro-logout], .logout-btn, #logoutBtn');
    logoutButtons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          if (window.pgenroSupabase?.auth) {
            await window.pgenroSupabase.auth.signOut();
          }
        } catch (err) {
          console.warn('Sign out warning:', err);
        }
        try {
          localStorage.removeItem('pgenro_current_user');
          localStorage.removeItem('pgenro_session');
        } catch (err) {}
        const isUserFolder = window.location.pathname.toLowerCase().includes('/user/');
        window.location.href = isUserFolder ? 'login.html' : '../User/login.html';
      });
    });
  }

  function initResponsiveTables() {
    const tables = document.querySelectorAll('table:not(.no-wrap)');
    tables.forEach(table => {
      const parent = table.parentElement;
      if (parent && !parent.classList.contains('table-responsive') && !parent.classList.contains('table-container')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'table-responsive';
        parent.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      initSidebar();
      initProfileMenu();
      initLogout();
      initResponsiveTables();
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    });
  }
})();
