/* ==========================================================================
   PGENRO IMS — Shared UI Fixes & Graceful Enhancements
   ========================================================================== */
(function () {
  'use strict';

  function initModalFixes() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openModals = document.querySelectorAll('.modal.active, .modal.open, .profile-modal.active, #viewModal.open, [role="dialog"].open');
        openModals.forEach(modal => {
          modal.classList.remove('active', 'open');
        });
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.classList.remove('active');
        const main = document.querySelector('.main-content');
        if (main) main.classList.remove('blur');
      }
    });

    document.querySelectorAll('.close-modal, .close-btn, [data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal, .profile-modal, [role="dialog"], #viewModal');
        if (modal) modal.classList.remove('active', 'open');
        const overlay = document.getElementById('overlay');
        if (overlay) overlay.classList.remove('active');
        const main = document.querySelector('.main-content');
        if (main) main.classList.remove('blur');
      });
    });
  }

  function initFormFixes() {
    // Prevent accidental submissions for non-submit buttons
    document.querySelectorAll('form button:not([type])').forEach(btn => {
      btn.setAttribute('type', 'button');
    });
  }

  function initImageFallbacks() {
    document.querySelectorAll('img').forEach(img => {
      if (!img.getAttribute('onerror')) {
        img.addEventListener('error', function () {
          this.style.opacity = '0.6';
        });
      }
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      initModalFixes();
      initFormFixes();
      initImageFallbacks();
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    });
  }
})();
