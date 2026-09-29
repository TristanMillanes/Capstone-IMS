/* PGENRO IMS — shared workspace accessibility helpers.
   Navigation/profile interactions are intentionally owned by pgenro-user.js
   (User side) and admin-ui.js (Admin side) to prevent double toggles/glitches. */
(() => {
  'use strict';

  function init() {
    const body = document.body;
    if (!body || body.dataset.workspaceReady === 'true') return;
    body.dataset.workspaceReady = 'true';

    const main = document.querySelector('main');
    if (main && !document.querySelector('.admin-ui-skip-link,.ws-skip-link')) {
      main.id ||= 'workspaceMain';
      main.setAttribute('tabindex', '-1');
      const skip = document.createElement('a');
      skip.className = 'ws-skip-link';
      skip.href = `#${main.id}`;
      skip.textContent = 'Skip to content';
      body.prepend(skip);
    }

    document.querySelectorAll('table').forEach(table => {
      if (!table.closest('.table-responsive,.table-wrapper,.table-container,.records-table-wrapper,.ics-table-wrapper,.ws-table-scroll')) {
        const wrap = document.createElement('div');
        wrap.className = 'ws-table-scroll';
        table.before(wrap);
        wrap.append(table);
      }

      const wrap = table.parentElement;
      if (!wrap) return;
      const overflowX = getComputedStyle(wrap).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') {
        wrap.setAttribute('tabindex', '0');
        wrap.setAttribute('role', 'region');
        if (!wrap.getAttribute('aria-label')) {
          wrap.setAttribute(
            'aria-label',
            `${document.querySelector('h1')?.textContent.trim() || 'Records'} table, scroll horizontally for more columns`
          );
        }
      }
    });

    document.querySelectorAll('.pgenro-global-toast,[id$="Toast"]').forEach(el => {
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
    });

    document.querySelectorAll('a[target="_blank"]').forEach(link => {
      const rel = new Set((link.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
      rel.add('noopener');
      rel.add('noreferrer');
      link.setAttribute('rel', [...rel].join(' '));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
