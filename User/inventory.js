/* The former inventory URL now serves the supply request workflow. */
(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const pageSize = 20;
  const dateFormat = new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Manila'
  });

  function textElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function init() {
    const api = window.PGENRO_API;
    const db = api?.client;
    const form = byId('supplyRequestForm');
    const fields = byId('supplyRequestFields');
    const submit = byId('submitSupplyRequest');
    const submitStatus = byId('supplySubmitStatus');
    const history = byId('supplyRequestHistory');
    const historyStatus = byId('supplyHistoryStatus');
    const refresh = byId('refreshSupplyRequests');
    const pages = byId('supplyRequestPages');
    const previous = byId('previousSupplyRequests');
    const next = byId('nextSupplyRequests');

    let page = 0;
    let generation = 0;
    let currentUser = null;
    let ready = false;
    let saving = false;
    let retry = null;

    function setFormEnabled() {
      fields.disabled = !ready || saving;
      submit.disabled = !ready || saving;
    }

    function showSubmitStatus(message, error = false) {
      submitStatus.textContent = message;
      submitStatus.classList.toggle('supply-error', error);
    }

    function showProfile(profile) {
      const name = profile.full_name || profile.username || 'PGENRO User';
      document.querySelector('.profile-text strong').textContent = name;
      document.querySelector('.profile-text small').textContent = profile.division || 'Office account';
      byId('profileDropdown').querySelector('h3').textContent = name;
      byId('profileDropdown').querySelector('p').textContent = profile.division || 'Office account';
    }

    function renderHistory(rows, count) {
      const items = rows.map(row => {
        const requested = Number(row.quantity_requested);
        const issued = Number(row.quantity_issued);
        const state = issued === 0 ? 'Pending' : issued >= requested ? 'Issued' : 'Partially issued';

        const item = textElement('li', '', 'supply-history-row');
        const title = textElement('div', '', 'supply-history-item');
        title.append(
          textElement('strong', row.supply_name),
          textElement('p', `SRQ-${row.request_number} · ${dateFormat.format(new Date(row.created_at))}`),
          textElement('p', row.purpose)
        );
        const quantities = document.createElement('div');
        quantities.append(
          textElement('p', `Requested ${requested.toLocaleString()} ${row.unit}`),
          textElement('p', `Issued ${issued.toLocaleString()} ${row.unit}`)
        );
        item.append(title, quantities, textElement('span', state, 'supply-history-state'));
        return item;
      });

      history.replaceChildren(...items);
      historyStatus.textContent = items.length ? '' : 'You have no supply requests yet.';
      const totalPages = Math.max(1, Math.ceil(count / pageSize));
      pages.hidden = totalPages === 1;
      byId('supplyRequestPageNumber').textContent = `Page ${page + 1} of ${totalPages}`;
      previous.disabled = page === 0;
      next.disabled = page + 1 >= totalPages;
    }

    async function loadRequests() {
      const token = ++generation;
      refresh.disabled = previous.disabled = next.disabled = true;
      ready = false;
      setFormEnabled();

      try {
        if (!db) throw new Error('The database is unavailable.');
        const profile = await api.requireApprovedUser();
        if (token !== generation) return;
        if (api.isAdminProfile(profile)) {
          window.location.replace('../admin/admin.html');
          return;
        }
        currentUser = profile.user_id;
        showProfile(profile);

        const { data, count, error } = await db.from('pgenro_supply_requests')
          .select('request_number,supply_name,unit,quantity_requested,quantity_issued,purpose,created_at', { count: 'exact' })
          .eq('requester_id', currentUser)
          .order('request_number', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (token !== generation) return;
        if (error) throw error;

        renderHistory(data || [], count || 0);
        ready = true;
      } catch (error) {
        if (token !== generation) return;
        history.replaceChildren();
        pages.hidden = true;
        historyStatus.textContent = error.code === 'PGRST205'
          ? 'Supply requests have not been configured. Contact your administrator.'
          : error.message || 'Your supply requests could not be loaded.';
      } finally {
        if (token === generation) {
          refresh.disabled = false;
          setFormEnabled();
        }
      }
    }

    async function saveRequest(event) {
      event.preventDefault();
      if (!ready || saving) return;

      const data = new FormData(form);
      const args = {
        p_supply_name: data.get('supplyName').trim(),
        p_unit: data.get('unit').trim().toUpperCase(),
        p_quantity: Number(data.get('quantity')),
        p_purpose: data.get('purpose').trim()
      };
      const fingerprint = JSON.stringify([currentUser, args]);
      if (retry?.fingerprint !== fingerprint) {
        retry = { fingerprint, id: crypto.randomUUID() };
      }
      const user = currentUser;
      saving = true;
      setFormEnabled();
      showSubmitStatus('Submitting request…');

      try {
        const { error } = await db.rpc('pgenro_submit_supply_request', {
          p_request_id: retry.id,
          ...args
        });
        if (user !== currentUser) return;
        if (error) throw error;

        retry = null;
        form.reset();
        page = 0;
        showSubmitStatus('Supply request submitted.');
        await loadRequests();
      } catch (error) {
        if (user === currentUser) {
          showSubmitStatus(error.message || 'Could not confirm your request. Submit again to retry.', true);
        }
      } finally {
        saving = false;
        setFormEnabled();
      }
    }

    window.lucide?.createIcons();
    form.addEventListener('submit', saveRequest);
    refresh.addEventListener('click', loadRequests);
    previous.addEventListener('click', () => { page--; loadRequests(); });
    next.addEventListener('click', () => { page++; loadRequests(); });

    db?.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_OUT' && (!currentUser || session?.user?.id === currentUser)) return;
      generation++;
      currentUser = null;
      ready = false;
      retry = null;
      page = 0;
      form.reset();
      setFormEnabled();
      showSubmitStatus('');
      history.replaceChildren();
      pages.hidden = true;
      historyStatus.textContent = 'Loading your requests…';
      if (event === 'SIGNED_OUT') window.location.replace('login.html');
      else queueMicrotask(loadRequests);
    });

    window.addEventListener('pageshow', event => { if (event.persisted) loadRequests(); });
    loadRequests();
  }

  document.addEventListener('DOMContentLoaded', init, { once: true });
})();
