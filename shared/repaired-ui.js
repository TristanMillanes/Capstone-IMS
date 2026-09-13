/* PGENRO IMS — non-destructive polish layer. No CRUD/auth handlers live here. */
(() => {
  'use strict';
  const init = () => {
    if (document.documentElement.dataset.repairUiReady) return;
    document.documentElement.dataset.repairUiReady = '1';

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('pgenro-reduced-motion');
    const targets = [...document.querySelectorAll('.kpi-card,.metric-card,.stat-card,.module-control-card,.chart-card,.panel-card,.records-card,.table-card')];
    if (!reduce && 'IntersectionObserver' in window) {
      targets.forEach(el => el.classList.add('repair-ui-enter'));
      const io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        });
      }, { threshold: .06, rootMargin: '0px 0px -24px 0px' });
      targets.forEach((el, i) => {
        el.style.transitionDelay = `${Math.min(i % 5, 4) * 35}ms`;
        io.observe(el);
      });
    } else {
      targets.forEach(el => el.classList.add('is-visible'));
    }

    // Make every wide table horizontally reachable on small devices.
    document.querySelectorAll('table').forEach(table => {
      const parent = table.parentElement;
      if (!parent || table.closest('.table-responsive,.table-wrapper,.records-table-wrapper,.ics-table-wrapper,.ws-table-scroll,.table-container')) return;
      const wrap = document.createElement('div');
      wrap.className = 'ws-table-scroll';
      table.before(wrap); wrap.appendChild(table);
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
