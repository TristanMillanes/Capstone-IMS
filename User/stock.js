/* Read-only stock catalog for approved User accounts. */
(() => {
  'use strict';

  const pageSize = 20;
  const quantityFormat = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 });
  const availability = { available: 'In stock', low: 'Low stock', out: 'Out of stock' };

  function stockRow(item) {
    const row = document.createElement('tr');
    for (const value of [item.control_no, item.item_name, item.category, item.unit, quantityFormat.format(item.quantity)]) {
      row.insertCell().textContent = value || '—';
    }
    const badge = document.createElement('span');
    badge.className = 'stock-availability';
    badge.dataset.stockState = item.stock_status;
    badge.textContent = availability[item.stock_status] || 'Unknown';
    row.insertCell().append(badge);
    return row;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const api = window.PGENRO_API;
    const db = api?.client;
    const byId = id => document.getElementById(id);
    const search = byId('stockSearch');
    const refresh = byId('refreshStockCatalog');
    const status = byId('stockCatalogStatus');
    const table = byId('stockTableRegion');
    const body = byId('stockCatalogBody');
    const pages = byId('stockCatalogPages');
    const previous = byId('previousStockPage');
    const next = byId('nextStockPage');
    let accountId = null;
    let page = 0;
    let generation = 0;
    let searchTimer;

    function clearRows(message) {
      body.replaceChildren();
      table.hidden = pages.hidden = true;
      status.textContent = message;
    }

    async function loadStock() {
      if (!accountId) return;
      clearTimeout(searchTimer);
      const version = ++generation;
      const query = search.value.trim();
      refresh.disabled = previous.disabled = next.disabled = true;
      clearRows('Loading inventory…');
      try {
        const { data, error } = await db.rpc('pgenro_inventory_catalog', {
          p_search: query, p_offset: page * pageSize, p_limit: pageSize + 1
        });
        if (version !== generation) return;
        if (error) throw error;

        const rows = data.slice(0, pageSize);
        body.replaceChildren(...rows.map(stockRow));
        table.hidden = rows.length === 0;
        let message = query ? 'No stock items match your search.' : 'No stock items are recorded yet.';
        if (page > 0) message = 'No stock items on this page.';
        if (rows.length) message = `Showing ${rows.length} ${rows.length === 1 ? 'item' : 'items'}`;
        status.textContent = message;
        previous.disabled = page === 0;
        next.disabled = data.length <= pageSize;
        pages.hidden = previous.disabled && next.disabled;
        byId('stockPageNumber').textContent = `Page ${page + 1}`;
      } catch (error) {
        if (version !== generation) return;
        if (error.code === '42501') {
          clearRows('Your account needs Inventory (View Only) access. Contact your administrator.');
        } else if (error.code === 'PGRST202') {
          clearRows('The stock catalog needs the updated module access database patch.');
        } else {
          clearRows('Inventory could not be loaded. Use Refresh to try again.');
        }
      } finally {
        if (version === generation) refresh.disabled = false;
      }
    }

    async function enableCatalog() {
      const version = ++generation;
      try {
        const session = await api.getCurrentSession();
        if (version !== generation || !session?.user) return;
        accountId = session.user.id;
        search.disabled = false;
        await loadStock();
      } catch {
        if (version === generation) clearRows('The inventory session could not be verified. Reload the page to try again.');
      }
    }

    refresh.addEventListener('click', loadStock);
    previous.addEventListener('click', () => { page--; loadStock(); });
    next.addEventListener('click', () => { page++; loadStock(); });
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      generation++;
      page = 0;
      refresh.disabled = previous.disabled = next.disabled = true;
      clearRows('Searching inventory…');
      searchTimer = setTimeout(loadStock, 200);
    });
    db?.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_OUT' && (!accountId || session?.user?.id === accountId)) return;
      generation++;
      accountId = null;
      clearTimeout(searchTimer);
      search.disabled = refresh.disabled = true;
      clearRows('Checking your access…');
    });
    window.addEventListener('pageshow', event => { if (event.persisted) loadStock(); });

    if (document.documentElement.dataset.pgenroUserModules === 'ready') enableCatalog();
    else document.addEventListener('pgenro:user-modules-ready', enableCatalog, { once: true });
  }, { once: true });
})();
