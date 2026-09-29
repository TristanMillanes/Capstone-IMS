/*
 * PGENRO IMS — Supabase data service for admin modules.
 *
 * All storage operations are routed through the single Supabase client created by
 * ../shared/supabase.js.
 * It intentionally does NOT create a second Supabase client.
 */
(() => {
  'use strict';

  if (window.PGENRO_SUPABASE_STORE && window.PGENRO_SUPABASE_STORE.__pgenroSupabaseStore) return;

  const sb = window.pgenroSupabase || window.PGENRO_DB?.client || null;
  if (!sb) {
    console.warn('PGENRO IMS: Supabase data service could not start because the shared Supabase client is unavailable.');
    return;
  }

  const TABLE_ALIASES = {
    users: 'profiles'
  };

  const wrappedCache = new Map();
  const channelRegistry = new Set();

  const tableName = (name) => TABLE_ALIASES[name] || name;
  const uuid = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function normalizeValue(value) {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(normalizeValue);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) out[key] = normalizeValue(item);
      return out;
    }
    return value;
  }

  function unwrapRow(row) {
    if (!row || typeof row !== 'object') return row;
    if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
      return {
        ...row.data,
        id: row.id ?? row.data.id,
        created_at: row.created_at ?? row.data.created_at,
        updated_at: row.updated_at ?? row.data.updated_at
      };
    }
    return { ...row };
  }

  // Retry without a supplied ID only when PostgreSQL rejects that ID itself.
  // Permission, network and constraint errors must surface to the caller.
  const isGeneratedIdError = error => ['428C9', '22P02'].includes(String(error?.code || ''));

  async function isWrappedTable(rawName) {
    const name = tableName(rawName);
    if (wrappedCache.has(name)) return wrappedCache.get(name);
    const { error } = await sb.from(name).select('data').limit(1);
    if (error && !['42703', 'PGRST204'].includes(String(error.code || ''))) throw error;
    const wrapped = !error;
    wrappedCache.set(name, wrapped);
    return wrapped;
  }

  async function readRows(rawName, order = null) {
    const name = tableName(rawName);
    let query = sb.from(name).select('*');

    // Stored JSON fields such as createdAt can live inside JSON data, so only use a
    // database-side order when it is a real snake_case column. Otherwise sort
    // after unwrapping.
    if (order?.field && order.field.includes('_')) {
      query = query.order(order.field, { ascending: order.direction !== 'desc' });
    }

    const { data, error } = await query;
    if (error) throw error;

    let rows = (data || []).map(unwrapRow);
    if (order?.field) {
      const dir = order.direction === 'desc' ? -1 : 1;
      rows = rows.sort((a, b) => {
        const av = a?.[order.field];
        const bv = b?.[order.field];
        const ad = new Date(av).getTime();
        const bd = new Date(bv).getTime();
        if (!Number.isNaN(ad) && !Number.isNaN(bd)) return (ad - bd) * dir;
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
      });
    }
    return rows;
  }

  async function insertRow(rawName, payload, forcedId = null) {
    const name = tableName(rawName);
    const clean = normalizeValue(payload || {});
    const wrapped = await isWrappedTable(name);

    if (wrapped) {
      const row = forcedId ? { id: forcedId, data: clean } : { data: clean };
      let res = await sb.from(name).insert(row).select('*').single();
      if (res.error && forcedId && isGeneratedIdError(res.error)) {
        // Some schemas generate their own primary key and do not permit a
        // client supplied id. Retry without it and use the returned id.
        res = await sb.from(name).insert({ data: clean }).select('*').single();
      }
      if (res.error) throw res.error;
      return unwrapRow(res.data);
    }

    const direct = forcedId ? { id: forcedId, ...clean } : clean;
    const { data, error } = await sb.from(name).insert(direct).select('*').single();
    if (error) throw error;
    return unwrapRow(data);
  }

  async function getRow(rawName, id) {
    const name = tableName(rawName);
    const { data, error } = await sb.from(name).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? unwrapRow(data) : null;
  }

  async function updateRow(rawName, id, patch, merge = true) {
    const name = tableName(rawName);
    const clean = normalizeValue(patch || {});
    const wrapped = await isWrappedTable(name);

    if (wrapped) {
      let next = clean;
      if (merge) {
        const current = await getRow(name, id);
        next = { ...(current || {}), ...clean };
        delete next.id;
        delete next.created_at;
        delete next.updated_at;
      }
      const { data, error } = await sb.from(name).update({ data: next }).eq('id', id).select('*').maybeSingle();
      if (error) throw error;
      return data ? unwrapRow(data) : { id, ...next };
    }

    const { data, error } = await sb.from(name).update(clean).eq('id', id).select('*').maybeSingle();
    if (error) throw error;
    return data ? unwrapRow(data) : { id, ...clean };
  }

  async function setRow(rawName, id, payload, merge = false) {
    const name = tableName(rawName);
    const clean = normalizeValue(payload || {});
    const wrapped = await isWrappedTable(name);

    if (wrapped) {
      let next = clean;
      if (merge) {
        const current = await getRow(name, id);
        next = { ...(current || {}), ...clean };
        delete next.id;
        delete next.created_at;
        delete next.updated_at;
      }
      let res = await sb.from(name).upsert({ id, data: next }, { onConflict: 'id' }).select('*').maybeSingle();
      if (res.error) {
        if (!isGeneratedIdError(res.error)) throw res.error;
        const existing = res.error.code === '22P02' ? null : await getRow(name, id);
        if (existing) return updateRow(name, id, clean, merge);
        return insertRow(name, clean);
      }
      return res.data ? unwrapRow(res.data) : { id, ...next };
    }

    if (merge) {
      const existing = await getRow(name, id).catch(() => null);
      if (existing) return updateRow(name, id, clean, true);
    }

    const { data, error } = await sb.from(name).upsert({ id, ...clean }, { onConflict: 'id' }).select('*').maybeSingle();
    if (error) throw error;
    return data ? unwrapRow(data) : { id, ...clean };
  }

  async function deleteRow(rawName, id) {
    const name = tableName(rawName);
    const { error } = await sb.from(name).delete().eq('id', id);
    if (error) throw error;
  }

  function makeTableStoreSnapshot(rows) {
    const docs = (rows || []).map(row => ({
      id: String(row.id ?? ''),
      data: () => {
        const data = { ...row };
        delete data.id;
        return data;
      }
    }));

    return {
      docs,
      empty: docs.length === 0,
      size: docs.length,
      forEach(callback) { docs.forEach(callback); }
    };
  }

  function subscribeTable(rawName, callback, errorCallback, order = null) {
    const name = tableName(rawName);
    let active = true;

    const refresh = async () => {
      if (!active) return;
      try {
        const rows = await readRows(name, order);
        if (active) callback(rows);
      } catch (error) {
        if (active) errorCallback?.(error);
      }
    };

    refresh();

    const channel = sb
      .channel(`supabase-store-${name}-${uuid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: name }, refresh)
      .subscribe();

    channelRegistry.add(channel);

    return () => {
      active = false;
      channelRegistry.delete(channel);
      try { sb.removeChannel(channel); } catch {}
    };
  }

  class TableStoreQuery {
    constructor(name, order = null) {
      this.name = name;
      this.order = order;
    }

    orderBy(field, direction = 'asc') {
      return new TableStoreQuery(this.name, { field, direction });
    }

    onSnapshot(next, error) {
      return subscribeTable(
        this.name,
        rows => next(makeTableStoreSnapshot(rows)),
        error,
        this.order
      );
    }

    async get() {
      const rows = await readRows(this.name, this.order);
      return makeTableStoreSnapshot(rows);
    }
  }

  class TableStoreDocumentRef {
    constructor(name, id) {
      this.name = name;
      this.id = String(id);
    }

    async set(payload, options = {}) {
      return setRow(this.name, this.id, payload, !!options.merge);
    }

    async update(payload) {
      return updateRow(this.name, this.id, payload, true);
    }

    async delete() {
      return deleteRow(this.name, this.id);
    }

    async get() {
      const row = await getRow(this.name, this.id);
      return {
        id: this.id,
        exists: !!row,
        data: () => {
          if (!row) return undefined;
          const data = { ...row };
          delete data.id;
          return data;
        }
      };
    }
  }

  class TableStoreCollectionRef extends TableStoreQuery {
    constructor(name) {
      super(name, null);
      this.name = name;
    }

    doc(id = uuid()) {
      return new TableStoreDocumentRef(this.name, id);
    }

    async add(payload) {
      const row = await insertRow(this.name, payload);
      return new TableStoreDocumentRef(this.name, row.id || uuid());
    }
  }

  function makeValueSnapshot(value) {
    return {
      val: () => value,
      exists: () => value !== null && value !== undefined && !(typeof value === 'object' && Object.keys(value).length === 0)
    };
  }

  class RealtimeRef {
    constructor(path = '') {
      this.path = String(path || '').replace(/^\/+|\/+$/g, '');
      this._unsubs = [];
      this.key = this.path.split('/').filter(Boolean).pop() || null;
    }

    _parts() {
      return this.path.split('/').filter(Boolean);
    }

    child(childPath) {
      const child = String(childPath || '').replace(/^\/+|\/+$/g, '');
      return new RealtimeRef([this.path, child].filter(Boolean).join('/'));
    }

    push(value) {
      const child = this.child(uuid());
      if (value !== undefined) child.set(value).catch(console.error);
      return child;
    }

    async _read() {
      if (this.path === '.info/connected') return !!navigator.onLine;

      const [rawTable, id] = this._parts();
      if (!rawTable) return null;
      const name = tableName(rawTable);

      if (id) return getRow(name, id);

      const rows = await readRows(name);
      return Object.fromEntries(
        rows.map((row, index) => {
          const key = String(row.id ?? row.user_id ?? index);
          const value = { ...row };
          delete value.id;
          return [key, value];
        })
      );
    }

    async once(eventName) {
      if (eventName !== 'value') throw new Error(`Unsupported Supabase store event: ${eventName}`);
      return makeValueSnapshot(await this._read());
    }

    on(eventName, callback, errorCallback) {
      if (eventName !== 'value') return callback;

      if (this.path === '.info/connected') {
        const emit = () => callback(makeValueSnapshot(!!navigator.onLine));
        emit();
        addEventListener('online', emit);
        addEventListener('offline', emit);
        const unsub = () => {
          removeEventListener('online', emit);
          removeEventListener('offline', emit);
        };
        this._unsubs.push(unsub);
        return callback;
      }

      const [rawTable] = this._parts();
      if (!rawTable) return callback;
      const name = tableName(rawTable);
      let active = true;

      const refresh = async () => {
        if (!active) return;
        try {
          callback(makeValueSnapshot(await this._read()));
        } catch (error) {
          errorCallback?.(error);
        }
      };

      refresh();
      const channel = sb
        .channel(`supabase-realtime-${name}-${uuid()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: name }, refresh)
        .subscribe();
      channelRegistry.add(channel);

      const unsub = () => {
        active = false;
        channelRegistry.delete(channel);
        try { sb.removeChannel(channel); } catch {}
      };
      this._unsubs.push(unsub);
      return callback;
    }

    off() {
      this._unsubs.splice(0).forEach(fn => {
        try { fn(); } catch {}
      });
    }

    async set(value) {
      const [rawTable, id] = this._parts();
      if (!rawTable || !id) throw new Error('Supabase store set() requires a table/id path.');
      return setRow(rawTable, id, value, false);
    }

    async update(value) {
      const [rawTable, id] = this._parts();
      if (!rawTable || !id) throw new Error('Supabase store update() requires a table/id path.');
      return updateRow(rawTable, id, value, true);
    }

    async remove() {
      const [rawTable, id] = this._parts();
      if (!rawTable || !id) throw new Error('Supabase remove() requires a table/id path.');
      return deleteRow(rawTable, id);
    }
  }

  const authApi = {
    currentUser: null,
    onAuthStateChanged(callback) {
      let active = true;
      sb.auth.getSession().then(({ data }) => {
        const user = data?.session?.user || null;
        authApi.currentUser = user;
        if (active) callback(user);
      }).catch(() => active && callback(null));

      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        authApi.currentUser = session?.user || null;
        if (active) callback(authApi.currentUser);
      });

      return () => {
        active = false;
        try { data?.subscription?.unsubscribe?.(); } catch {}
      };
    },
    signOut() {
      return sb.auth.signOut();
    }
  };

  const tableStore = () => ({
    collection(name) {
      return new TableStoreCollectionRef(name);
    }
  });
  tableStore.FieldValue = {
    serverTimestamp: () => new Date().toISOString()
  };

  const realtimeStore = () => ({
    ref(path = '') {
      return new RealtimeRef(path);
    }
  });
  realtimeStore.ServerValue = {};
  Object.defineProperty(realtimeStore.ServerValue, 'TIMESTAMP', {
    enumerable: true,
    get: () => Date.now()
  });

  const supabaseStoreAdapter = {
    __pgenroSupabaseStore: true,
    clients: [{ name: '[PGENRO-SUPABASE]' }],
    connect() { return supabaseStoreAdapter.clients[0]; },
    auth: () => authApi,
    realtimeStore,
    tableStore
  };

  window.PGENRO_SUPABASE_STORE = supabaseStoreAdapter;
  window.PGENRO_SUPABASE_STORE_INFO = {
    client: sb,
    shutdown() {
      for (const channel of [...channelRegistry]) {
        try { sb.removeChannel(channel); } catch {}
      }
      channelRegistry.clear();
    }
  };
})();

/* ===== Page module ===== */
const supabaseStore = window.PGENRO_SUPABASE_STORE;
/**
 * PGENRO IMS — Service Request & Course of Action
 * Page controller only. Shared admin shell/profile behavior is handled by the page-owned admin shell below.
 * Storage remains routed through the Supabase data service.
 */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  document.addEventListener(
    'DOMContentLoaded',
    () => {
      window.lucide?.createIcons?.();

      const form = $('#serviceRequestForm');

      if (!form) return;

      const tabPanels = [
        'tab-client-info',
        'tab-service-request',
        'tab-course-action'
      ];

      const tabButtons = $$('.tab-btn');

      const displayActiveId = $('#displayActiveServiceNo');
      const displayStatusBadge = $('#displayActiveStatusBadge');

      const hiddenDocId = $('#docIdHidden');

      const btnPrevTab = $('#btnPrevTab');
      const btnNextTab = $('#btnNextTab');
      const btnSaveAction = $('#btnSaveAction');

      const summaryModal = $('#summaryModal');
      const searchModal = $('#searchModal');

      const modalSearchFilter = $('#modalSearchFilter');
      const quickSearchInput = $('#quickSearchInput');

      let activeTabIdx = 0;
      let serviceRecords = [];

      let db = null;
      let serviceRequestsRef = null;

      /* ================================================================
         UI HELPERS
      ================================================================= */

      const escapeHtml = (value) =>
        String(value ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');

      function showToast(message, type = 'success') {
        if (window.AdminUI?.toast) {
          window.AdminUI.toast(message, type);
          return;
        }

        const container = $('#toastContainer');

        if (!container) return;

        const toast = document.createElement('div');

        toast.className = `toast ${type}`;

        toast.innerHTML = `
          <i
            data-lucide="${
              type === 'error'
                ? 'alert-circle'
                : type === 'warning'
                  ? 'alert-triangle'
                  : 'circle-check'
            }"
          ></i>

          <span>${escapeHtml(message)}</span>
        `;

        container.appendChild(toast);

        window.lucide?.createIcons?.();

        setTimeout(() => {
          toast.classList.add('toast-leaving');

          setTimeout(() => {
            toast.remove();
          }, 220);
        }, 3500);
      }

      function setDbStatus(online, message) {
        const dot = $('#dbStatusDot');
        const text = $('#dbStatusText');

        if (dot) {
          dot.className = online
            ? 'status-dot online'
            : 'status-dot offline';
        }

        if (text) {
          text.textContent = message;
        }
      }

      function setButtonHidden(button, hidden) {
        if (!button) return;

        button.classList.toggle('is-hidden', hidden);

        button.setAttribute(
          'aria-hidden',
          hidden ? 'true' : 'false'
        );

        if (hidden) {
          button.setAttribute('tabindex', '-1');
        } else {
          button.removeAttribute('tabindex');
        }
      }

      /* ================================================================
         CLOCK
      ================================================================= */

      function updateClock() {
        const clock = $('#liveClockDisplay span');

        if (!clock) return;

        clock.textContent = new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }).format(new Date());
      }

      updateClock();

      window.setInterval(updateClock, 1000);

      /* ================================================================
         TAB VALIDATION
      ================================================================= */

      function validateTab(tabIndex) {
        const panel = document.getElementById(
          tabPanels[tabIndex]
        );

        if (!panel) return true;

        const fields = $$(
          'input[required], select[required], textarea[required]',
          panel
        );

        for (const field of fields) {
          const value =
            typeof field.value === 'string'
              ? field.value.trim()
              : field.value;

          field.classList.remove('field-error');

          if (!value || !field.checkValidity()) {
            field.classList.add('field-error');

            field.focus({
              preventScroll: true
            });

            field.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });

            field.reportValidity();

            const label =
              field.labels?.[0]?.textContent
                ?.replace('*', '')
                .trim() ||
              field.name ||
              'required field';

            showToast(
              `Please complete ${label}.`,
              'error'
            );

            return false;
          }
        }

        return true;
      }

      /* ================================================================
         STEP / TAB NAVIGATION
      ================================================================= */

      function switchTab(
        index,
        bypassValidation = false
      ) {
        if (
          index < 0 ||
          index >= tabPanels.length
        ) {
          return;
        }

        if (
          !bypassValidation &&
          index > activeTabIdx &&
          !validateTab(activeTabIdx)
        ) {
          return;
        }

        activeTabIdx = index;

        tabButtons.forEach((button, idx) => {
          const active =
            idx === activeTabIdx;

          button.classList.toggle(
            'active',
            active
          );

          button.setAttribute(
            'aria-selected',
            active ? 'true' : 'false'
          );

          button.setAttribute(
            'tabindex',
            active ? '0' : '-1'
          );
        });

        tabPanels.forEach(
          (panelId, idx) => {
            const panel =
              document.getElementById(panelId);

            if (!panel) return;

            const active =
              idx === activeTabIdx;

            panel.classList.toggle(
              'active',
              active
            );

            panel.setAttribute(
              'aria-hidden',
              active ? 'false' : 'true'
            );
          }
        );

        setButtonHidden(
          btnPrevTab,
          activeTabIdx === 0
        );

        setButtonHidden(
          btnNextTab,
          activeTabIdx ===
            tabPanels.length - 1
        );

        setButtonHidden(
          btnSaveAction,
          activeTabIdx !==
            tabPanels.length - 1
        );

        window.lucide?.createIcons?.();

        const card = $('.service-form-card');

        if (card) {
          const top =
            card.getBoundingClientRect().top +
            window.scrollY -
            82;

          if (window.scrollY > top + 160) {
            window.scrollTo({
              top,
              behavior: 'smooth'
            });
          }
        }
      }

      tabButtons.forEach(
        (button, idx) => {
          button.addEventListener(
            'click',
            () => {
              switchTab(idx);
            }
          );

          button.addEventListener(
            'keydown',
            (event) => {
              if (
                ![
                  'ArrowLeft',
                  'ArrowRight',
                  'Home',
                  'End'
                ].includes(event.key)
              ) {
                return;
              }

              event.preventDefault();

              let next = idx;

              if (
                event.key === 'ArrowLeft'
              ) {
                next = Math.max(
                  0,
                  idx - 1
                );
              }

              if (
                event.key === 'ArrowRight'
              ) {
                next = Math.min(
                  tabButtons.length - 1,
                  idx + 1
                );
              }

              if (event.key === 'Home') {
                next = 0;
              }

              if (event.key === 'End') {
                next =
                  tabButtons.length - 1;
              }

              tabButtons[next]?.focus();

              switchTab(next);
            }
          );
        }
      );

      btnPrevTab?.addEventListener(
        'click',
        () => {
          switchTab(
            activeTabIdx - 1,
            true
          );
        }
      );

      btnNextTab?.addEventListener(
        'click',
        () => {
          switchTab(activeTabIdx + 1);
        }
      );

      /* ================================================================
         SERVICE NUMBER
      ================================================================= */

      function generateNewServiceNo() {
        const year =
          new Date().getFullYear();

        const existingNumbers =
          serviceRecords
            .map((record) =>
              String(
                record.serviceNo || ''
              )
            )
            .filter((number) =>
              number.startsWith(
                `SR-${year}-`
              )
            )
            .map((number) =>
              Number(
                number
                  .split('-')
                  .pop()
              )
            )
            .filter(Number.isFinite);

        const next =
          existingNumbers.length
            ? Math.max(
                ...existingNumbers
              ) + 1
            : 1;

        return `SR-${year}-${String(
          next
        ).padStart(4, '0')}`;
      }

      /* ================================================================
         STATUS
      ================================================================= */

      function updateStatusBadge(
        status = 'Pending Review'
      ) {
        if (!displayStatusBadge) return;

        const normalized =
          status.toLowerCase();

        let type = 'warning';

        if (
          normalized.includes(
            'complete'
          ) ||
          normalized.includes('closed')
        ) {
          type = 'success';
        } else if (
          normalized.includes(
            'progress'
          ) ||
          normalized.includes(
            'assessed'
          ) ||
          normalized.includes(
            'evaluat'
          )
        ) {
          type = 'info';
        } else if (
          normalized.includes(
            'disapproved'
          ) ||
          normalized.includes('cancel')
        ) {
          type = 'danger';
        }

        displayStatusBadge.className =
          `badge-status ${type}`;

        displayStatusBadge.replaceChildren();

        const dot =
          document.createElement('span');

        dot.className = 'dot';

        displayStatusBadge.append(
          dot,
          document.createTextNode(
            ` ${status}`
          )
        );
      }

      /* ================================================================
         RESET FORM
      ================================================================= */

      function resetFormToNew({
        notify = true
      } = {}) {
        form.reset();

        if (hiddenDocId) {
          hiddenDocId.value = '';
        }

        const serviceNo =
          generateNewServiceNo();

        const serviceNoInput =
          $('#serviceNo');

        const dateRequest =
          $('#dateRequest');

        const serviceStatus =
          $('#serviceStatus');

        if (serviceNoInput) {
          serviceNoInput.value =
            serviceNo;
        }

        if (displayActiveId) {
          displayActiveId.textContent =
            serviceNo;
        }

        if (dateRequest) {
          dateRequest.value =
            new Date()
              .toISOString()
              .slice(0, 10);
        }

        if (serviceStatus) {
          serviceStatus.value =
            'Pending Review';
        }

        updateStatusBadge(
          'Pending Review'
        );

        $$('.field-error', form).forEach(
          (field) =>
            field.classList.remove(
              'field-error'
            )
        );

        switchTab(0, true);

        if (notify) {
          showToast(
            'New service request form is ready.',
            'success'
          );
        }
      }

      /* ================================================================
         WORKFLOW STEP
      ================================================================= */

      function calculateCurrentStep(
        status,
        data
      ) {
        if (
          String(
            data.serviceReceivedBy || ''
          ).trim()
        ) {
          return 5;
        }

        if (
          String(
            data.processedBy || ''
          ).trim()
        ) {
          return 4;
        }

        if (
          String(
            data.pgdhAction || ''
          ).trim()
        ) {
          return 3;
        }

        if (
          String(
            data.assessedBy || ''
          ).trim()
        ) {
          return 2;
        }

        const normalized =
          String(status || '')
            .toLowerCase();

        if (
          normalized.includes(
            'complete'
          ) ||
          normalized.includes('release')
        ) {
          return 5;
        }

        if (
          normalized.includes(
            'progress'
          ) ||
          normalized.includes(
            'process'
          ) ||
          normalized.includes(
            'rendered'
          )
        ) {
          return 4;
        }

        if (
          normalized.includes('pgdh') ||
          normalized.includes('approved')
        ) {
          return 3;
        }

        if (
          normalized.includes(
            'assessed'
          ) ||
          normalized.includes(
            'evaluat'
          )
        ) {
          return 2;
        }

        return 1;
      }

      /* ================================================================
         FORM DATA
      ================================================================= */

      function getFormData() {
        const values =
          new FormData(form);

        const data = {};

        values.forEach(
          (value, key) => {
            data[key] =
              typeof value === 'string'
                ? value.trim()
                : value;
          }
        );

        data.primaryCategory =
          data.technicalAssistance ||
          data.certifications ||
          data.plantingMaterials ||
          data.environmentalConcerns ||
          data.iecService ||
          'TECHNICAL ASSISTANCE';

        data.secondaryCategory =
          data.iecService ||
          data.certifications ||
          data.otherServices ||
          '--';

        data.concernsCategory =
          data.environmentalConcerns ||
          '--';

        data.endorsedBy =
          data.notedBy || '--';

        data.recDate =
          data.recommendedDate
            ? `${data.recommendedDate}${
                data.recommendedTime
                  ? ` • ${data.recommendedTime}`
                  : ''
              }`
            : '--';

        data.recRemarks =
          data.recommendedRemarks ||
          '--';

        data.pgdhDateActed =
          data.pgdhDateActed
            ? `${data.pgdhDateActed}${
                data.pgdhTimeActed
                  ? ` • ${data.pgdhTimeActed}`
                  : ''
              }`
            : '--';

        data.dateProcessed =
          data.dateProcessed
            ? `${data.dateProcessed}${
                data.timeProcessed
                  ? ` • ${data.timeProcessed}`
                  : ''
              }`
            : '--';

        data.finalDateRec =
          data.clientDateReceived ||
          data.clientDateActed
            ? `${
                data.clientDateReceived ||
                data.clientDateActed
              }${
                data.clientTimeReceived
                  ? ` • ${data.clientTimeReceived}`
                  : ''
              }`
            : '--';

        data.finalRemarks =
          data.clientRemarks || '--';

        data.currentStep =
          calculateCurrentStep(
            data.serviceStatus,
            data
          );

        data.updatedAt =
          new Date().toISOString();

        return data;
      }

      /* ================================================================
         LOAD RECORD INTO FORM
      ================================================================= */

      function populateForm(
        data,
        docId
      ) {
        form.reset();

        if (hiddenDocId) {
          hiddenDocId.value =
            docId || '';
        }

        Object.entries(
          data || {}
        ).forEach(
          ([key, value]) => {
            const field =
              form.elements.namedItem(
                key
              );

            if (
              !field ||
              value == null
            ) {
              return;
            }

            if ('value' in field) {
              field.value =
                String(value);
            }
          }
        );

        if (displayActiveId) {
          displayActiveId.textContent =
            data?.serviceNo ||
            'SR-RECORD';
        }

        updateStatusBadge(
          data?.serviceStatus ||
            'Pending Review'
        );

        switchTab(0, true);
      }

      $('#serviceStatus')
        ?.addEventListener(
          'change',
          (event) => {
            updateStatusBadge(
              event.target.value
            );
          }
        );

      $('#btnNewRecord')
        ?.addEventListener(
          'click',
          () => {
            resetFormToNew();
          }
        );

      $('#btnClearAction')
        ?.addEventListener(
          'click',
          () => {
            const confirmed =
              window.confirm(
                'Clear the current form and start a new service request?'
              );

            if (confirmed) {
              resetFormToNew();
            }
          }
        );

      /* ================================================================
         DATABASE
      ================================================================= */

      function initializeDatabase() {
        try {
          if (
            !window.PGENRO_SUPABASE_STORE?.realtimeStore
          ) {
            throw new Error(
              'Supabase data service is unavailable.'
            );
          }

          if (
            !window.PGENRO_SUPABASE_STORE.clients?.length
          ) {
            window.PGENRO_SUPABASE_STORE
              .connect?.({});
          }

          db =
            window.PGENRO_SUPABASE_STORE.realtimeStore();

          serviceRequestsRef =
            db.ref(
              'service_requests'
            );

          return true;
        } catch (error) {
          console.error(
            'Service Request database initialization failed:',
            error
          );

          setDbStatus(
            false,
            'Database unavailable'
          );

          showToast(
            'Database is unavailable. The form can still be viewed, but records cannot be saved yet.',
            'error'
          );

          return false;
        }
      }

      /* ================================================================
         REALTIME DATABASE
      ================================================================= */

      function startRealtimeListeners() {
        if (
          !db ||
          !serviceRequestsRef
        ) {
          return;
        }

        db.ref(
          '.info/connected'
        ).on(
          'value',
          (snapshot) => {
            const online =
              snapshot.val() === true;

            setDbStatus(
              online,
              online
                ? 'Live Synchronized'
                : 'Connecting / Offline'
            );
          },
          (error) => {
            console.warn(
              'Connection status listener failed:',
              error
            );

            setDbStatus(
              false,
              'Sync unavailable'
            );
          }
        );

        serviceRequestsRef.on(
          'value',
          (snapshot) => {
            const raw =
              snapshot.val();

            serviceRecords = raw
              ? Object.entries(
                  raw
                ).map(
                  ([
                    key,
                    value
                  ]) => ({
                    id: key,
                    ...(value ||
                      {})
                  })
                )
              : [];

            serviceRecords.sort(
              (a, b) => {
                const aTime =
                  new Date(
                    a.updatedAt ||
                      a.dateRequest ||
                      a.createdAt ||
                      0
                  ).getTime();

                const bTime =
                  new Date(
                    b.updatedAt ||
                      b.dateRequest ||
                      b.createdAt ||
                      0
                  ).getTime();

                return bTime - aTime;
              }
            );

            const openCount =
              serviceRecords.filter(
                (item) => {
                  const status =
                    String(
                      item.serviceStatus ||
                        ''
                    ).toLowerCase();

                  return (
                    !status.includes(
                      'complete'
                    ) &&
                    !status.includes(
                      'closed'
                    ) &&
                    !status.includes(
                      'cancel'
                    )
                  );
                }
              ).length;

            const badge =
              $(
                '#sidebarOpenServicesBadge'
              );

            if (badge) {
              badge.textContent =
                `${openCount} Open`;
            }

            renderSummaryTable(
              serviceRecords
            );

            /*
             * Keep a fresh service number only when
             * the admin has not started entering data.
             */
            if (
              !hiddenDocId?.value &&
              !$('#clientName')?.value &&
              !$('#organization')
                ?.value
            ) {
              const nextNo =
                generateNewServiceNo();

              if ($('#serviceNo')) {
                $('#serviceNo').value =
                  nextNo;
              }

              if (displayActiveId) {
                displayActiveId.textContent =
                  nextNo;
              }
            }
          },
          (error) => {
            console.error(
              'Service request read error:',
              error
            );

            setDbStatus(
              false,
              'Sync Error'
            );

            showToast(
              error?.message ||
                'Unable to load service requests.',
              'error'
            );
          }
        );

        /*
         * Account request sidebar badge
         */
        try {
          db.ref(
            'access_requests'
          ).on(
            'value',
            (snapshot) => {
              const requests =
                snapshot.val() || {};

              const pending =
                Object.values(
                  requests
                ).filter(
                  (request) =>
                    String(
                      request?.status ||
                        ''
                    ).toLowerCase() ===
                    'pending'
                ).length;

              const badge =
                $(
                  '#sidebarPendingAccBadge'
                );

              if (badge) {
                badge.textContent =
                  `${pending} New`;
              }
            },
            (error) => {
              console.warn(
                'Account request badge could not be loaded:',
                error
              );
            }
          );
        } catch (error) {
          console.warn(
            'Account request badge listener failed:',
            error
          );
        }
      }

      /* ================================================================
         SAVE / UPDATE SERVICE REQUEST
      ================================================================= */

      form.addEventListener(
        'submit',
        async (event) => {
          event.preventDefault();

          if (!validateTab(0)) {
            switchTab(0, true);
            return;
          }

          if (!validateTab(1)) {
            switchTab(1, true);
            return;
          }

          if (!serviceRequestsRef) {
            showToast(
              'Database connection is not ready. Please check Supabase configuration.',
              'error'
            );

            return;
          }

          const record =
            getFormData();

          const docId =
            hiddenDocId?.value ||
            '';

          const originalMarkup =
            btnSaveAction?.innerHTML ||
            '';

          if (btnSaveAction) {
            btnSaveAction.disabled =
              true;

            btnSaveAction.innerHTML = `
              <i
                data-lucide="loader-2"
                class="spin-icon"
              ></i>

              <span>Saving...</span>
            `;

            window.lucide
              ?.createIcons?.();
          }

          try {
            /*
             * Existing record
             */
            if (docId) {
              await serviceRequestsRef
                .child(docId)
                .update(record);

              showToast(
                `Service request ${record.serviceNo} was updated.`,
                'success'
              );
            }

            /*
             * New record
             */
            else {
              record.createdAt =
                window.PGENRO_SUPABASE_STORE
                  ?.realtimeStore
                  ?.ServerValue
                  ?.TIMESTAMP ??
                new Date()
                  .toISOString();

              const newRef =
                serviceRequestsRef.push();

              record.id =
                newRef.key;

              await newRef.set(
                record
              );

              if (hiddenDocId) {
                hiddenDocId.value =
                  newRef.key;
              }

              showToast(
                `Service request ${record.serviceNo} was saved.`,
                'success'
              );
            }

            if (displayActiveId) {
              displayActiveId.textContent =
                record.serviceNo;
            }

            updateStatusBadge(
              record.serviceStatus
            );
          } catch (error) {
            console.error(
              'Service request save failed:',
              error
            );

            showToast(
              error?.message ||
                'Unable to save this service request.',
              'error'
            );
          } finally {
            if (btnSaveAction) {
              btnSaveAction.disabled =
                false;

              btnSaveAction.innerHTML =
                originalMarkup ||
                `
                  <i data-lucide="save"></i>
                  <span>SAVE RECORD</span>
                `;

              window.lucide
                ?.createIcons?.();
            }
          }
        }
      );

      /* ================================================================
         MODALS
      ================================================================= */

      function openModal(modal) {
        if (!modal) return;

        modal.classList.add('open');

        modal.setAttribute(
          'aria-hidden',
          'false'
        );

        document.body.classList.add(
          'service-modal-open'
        );
      }

      function closeModal(modal) {
        if (!modal) return;

        modal.classList.remove('open');

        modal.setAttribute(
          'aria-hidden',
          'true'
        );

        if (
          !summaryModal?.classList.contains(
            'open'
          ) &&
          !searchModal?.classList.contains(
            'open'
          )
        ) {
          document.body.classList.remove(
            'service-modal-open'
          );
        }
      }

      $('#btnOpenSummaryModal')
        ?.addEventListener(
          'click',
          () => {
            openModal(
              summaryModal
            );
          }
        );

      $('#closeSummaryModal')
        ?.addEventListener(
          'click',
          () => {
            closeModal(
              summaryModal
            );
          }
        );

      $('#btnOpenSearchModal')
        ?.addEventListener(
          'click',
          () => {
            renderSearchModalResults(
              serviceRecords
            );

            openModal(
              searchModal
            );

            window.setTimeout(
              () => {
                modalSearchFilter?.focus();
              },
              50
            );
          }
        );

      $('#closeSearchModal')
        ?.addEventListener(
          'click',
          () => {
            closeModal(
              searchModal
            );
          }
        );

      [
        summaryModal,
        searchModal
      ].forEach((modal) => {
        modal?.addEventListener(
          'click',
          (event) => {
            if (
              event.target === modal
            ) {
              closeModal(modal);
            }
          }
        );
      });

      /* ================================================================
         KEYBOARD
      ================================================================= */

      document.addEventListener(
        'keydown',
        (event) => {
          /*
           * Escape closes modal
           */
          if (
            event.key === 'Escape'
          ) {
            closeModal(
              summaryModal
            );

            closeModal(
              searchModal
            );
          }

          /*
           * Ctrl + K / Cmd + K
           */
          if (
            (event.ctrlKey ||
              event.metaKey) &&
            event.key.toLowerCase() ===
              'k'
          ) {
            event.preventDefault();

            quickSearchInput?.focus();
            quickSearchInput?.select?.();
          }
        }
      );

      /* ================================================================
         SEARCH
      ================================================================= */

      function matchesRecord(
        record,
        term
      ) {
        if (!term) return true;

        return [
          record.serviceNo,
          record.clientName,
          record.organization,
          record.location
        ].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(term)
        );
      }

      modalSearchFilter
        ?.addEventListener(
          'input',
          (event) => {
            const term =
              event.target.value
                .toLowerCase()
                .trim();

            renderSearchModalResults(
              serviceRecords.filter(
                (record) =>
                  matchesRecord(
                    record,
                    term
                  )
              )
            );
          }
        );

      quickSearchInput
        ?.addEventListener(
          'keydown',
          (event) => {
            if (
              event.key !== 'Enter'
            ) {
              return;
            }

            event.preventDefault();

            const term =
              quickSearchInput.value
                .toLowerCase()
                .trim();

            if (!term) return;

            const record =
              serviceRecords.find(
                (item) =>
                  matchesRecord(
                    item,
                    term
                  )
              );

            if (!record) {
              showToast(
                `No service request matched “${quickSearchInput.value}”.`,
                'error'
              );

              return;
            }

            populateForm(
              record,
              record.id
            );

            showToast(
              `${record.serviceNo || 'Service request'} loaded.`,
              'success'
            );
          }
        );

      /* ================================================================
         STATUS CLASS
      ================================================================= */

      function statusClass(status) {
        const value =
          String(status || '')
            .toLowerCase();

        if (
          value.includes(
            'complete'
          ) ||
          value.includes('closed')
        ) {
          return 'success';
        }

        if (
          value.includes('cancel') ||
          value.includes(
            'disapproved'
          )
        ) {
          return 'danger';
        }

        if (
          value.includes('pending') ||
          value.includes('review')
        ) {
          return 'warning';
        }

        return 'info';
      }

      /* ================================================================
         SEARCH RESULTS
      ================================================================= */

      function renderSearchModalResults(
        list
      ) {
        const tbody =
          $(
            '#searchModalResultsBody'
          );

        if (!tbody) return;

        if (!list.length) {
          tbody.innerHTML = `
            <tr>
              <td
                colspan="6"
                class="empty-table-cell"
              >
                No matching service requests found.
              </td>
            </tr>
          `;

          return;
        }

        tbody.innerHTML =
          list
            .map(
              (item) => `
                <tr>
                  <td>
                    <strong>
                      ${escapeHtml(
                        item.serviceNo ||
                          '--'
                      )}
                    </strong>
                  </td>

                  <td>
                    ${escapeHtml(
                      item.clientName ||
                        '--'
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      item.organization ||
                        '--'
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      item.dateRequest ||
                        '--'
                    )}
                  </td>

                  <td>
                    <span
                      class="badge-status ${statusClass(
                        item.serviceStatus
                      )}"
                    >
                      ${escapeHtml(
                        item.serviceStatus ||
                          'Pending'
                      )}
                    </span>
                  </td>

                  <td
                    class="table-action-cell"
                  >
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm js-load-record"
                      data-record-id="${escapeHtml(
                        item.id
                      )}"
                    >
                      Load
                    </button>
                  </td>
                </tr>
              `
            )
            .join('');
      }

      /* ================================================================
         SUMMARY TABLE
      ================================================================= */

      function renderSummaryTable(
        list
      ) {
        const tbody =
          $('#summaryMasterBody');

        const label =
          $('#summaryCountLabel');

        if (label) {
          label.textContent = `${
            list.length
          } service record${
            list.length === 1
              ? ''
              : 's'
          } in database`;
        }

        if (!tbody) return;

        if (!list.length) {
          tbody.innerHTML = `
            <tr>
              <td
                colspan="7"
                class="empty-table-cell"
              >
                No service records registered yet.
              </td>
            </tr>
          `;

          renderSearchModalResults(
            []
          );

          return;
        }

        tbody.innerHTML =
          list
            .map((item) => {
              const scope =
                item.primaryCategory ||
                item.technicalAssistance ||
                item.plantingMaterials ||
                item.certifications ||
                'General Service';

              return `
                <tr>
                  <td>
                    <strong
                      class="service-number-text"
                    >
                      ${escapeHtml(
                        item.serviceNo ||
                          '--'
                      )}
                    </strong>
                  </td>

                  <td>
                    ${escapeHtml(
                      item.dateRequest ||
                        '--'
                    )}
                  </td>

                  <td>
                    <strong>
                      ${escapeHtml(
                        item.clientName ||
                          'N/A'
                      )}
                    </strong>
                  </td>

                  <td>
                    ${escapeHtml(
                      item.organization ||
                        '--'
                    )}
                  </td>

                  <td>
                    <span
                      class="scope-text"
                    >
                      ${escapeHtml(
                        scope
                      )}
                    </span>
                  </td>

                  <td>
                    <span
                      class="badge-status ${statusClass(
                        item.serviceStatus
                      )}"
                    >
                      ${escapeHtml(
                        item.serviceStatus ||
                          'Pending'
                      )}
                    </span>
                  </td>

                  <td
                    class="table-action-cell"
                  >
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm js-load-record"
                      data-record-id="${escapeHtml(
                        item.id
                      )}"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              `;
            })
            .join('');

        renderSearchModalResults(
          list
        );
      }

      /* ================================================================
         EDIT / LOAD RECORD
      ================================================================= */

      document.addEventListener(
        'click',
        (event) => {
          const button =
            event.target.closest(
              '.js-load-record'
            );

          if (!button) return;

          const record =
            serviceRecords.find(
              (item) =>
                String(item.id) ===
                String(
                  button.dataset
                    .recordId
                )
            );

          if (!record) return;

          populateForm(
            record,
            record.id
          );

          closeModal(
            summaryModal
          );

          closeModal(
            searchModal
          );

          showToast(
            `${record.serviceNo || 'Service request'} loaded successfully.`,
            'success'
          );
        }
      );

      /* ================================================================
         CSV EXPORT
      ================================================================= */

      $('#btnExportSummaryCsv')
        ?.addEventListener(
          'click',
          () => {
            if (
              !serviceRecords.length
            ) {
              showToast(
                'There are no service records to export.',
                'warning'
              );

              return;
            }

            const csvCell =
              (value) =>
                `"${String(
                  value ?? ''
                ).replaceAll(
                  '"',
                  '""'
                )}"`;

            const headers = [
              'Service No',
              'Date Requested',
              'Client Name',
              'Organization',
              'Contact No',
              'Status',
              'Location',
              'Current Step'
            ];

            const rows =
              serviceRecords.map(
                (record) =>
                  [
                    record.serviceNo,
                    record.dateRequest,
                    record.clientName,
                    record.organization,
                    record.contactNo,
                    record.serviceStatus,
                    record.location,
                    record.currentStep ||
                      1
                  ]
                    .map(csvCell)
                    .join(',')
              );

            const blob =
              new Blob(
                [
                  [
                    headers
                      .map(csvCell)
                      .join(','),
                    ...rows
                  ].join('\n')
                ],
                {
                  type: 'text/csv;charset=utf-8'
                }
              );

            const url =
              URL.createObjectURL(
                blob
              );

            const link =
              document.createElement(
                'a'
              );

            link.href = url;

            link.download =
              `PGENRO_Service_Requests_${new Date()
                .toISOString()
                .slice(
                  0,
                  10
                )}.csv`;

            document.body.appendChild(
              link
            );

            link.click();

            link.remove();

            URL.revokeObjectURL(
              url
            );
          }
        );

      /* ================================================================
         REMOVE VALIDATION ERROR WHEN USER TYPES
      ================================================================= */

      form.addEventListener(
        'input',
        (event) => {
          event.target?.classList?.remove(
            'field-error'
          );
        }
      );

      form.addEventListener(
        'change',
        (event) => {
          event.target?.classList?.remove(
            'field-error'
          );
        }
      );

      /* ================================================================
         INITIAL LOAD
      ================================================================= */

      resetFormToNew({
        notify: false
      });

      if (initializeDatabase()) {
        startRealtimeListeners();
      }
    },
    {
      once: true
    }
  );
})();

/* ===== Page-contained admin shell controller ===== */
/* PGENRO IMS — shared admin UX enhancements. Safe to load after each module script. */
(() => {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const currentFile = (location.pathname.split('/').pop() || 'admin.html').toLowerCase();

  function normalizePath(href) {
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return '';
    try {
      const u = new URL(href, location.href);
      return (u.pathname.split('/').pop() || '').toLowerCase();
    } catch { return ''; }
  }

  function fixNavigation() {
    const map = {
      'Security Audit Trail': 'admin.html#audit',
      'System Backups': 'admin.html#backup',
      'Global Settings': 'admin.html#settings'
    };
    const links = $$('.sidebar a');

    links.forEach(a => {
      const label = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if ((!a.getAttribute('href') || a.getAttribute('href') === '#') && map[label]) {
        a.setAttribute('href', map[label]);
      }
    });

    let match = null;
    const currentHash = location.hash || '';
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('javascript:')) continue;
      let u;
      try { u = new URL(href, location.href); } catch { continue; }
      const file = (u.pathname.split('/').pop() || '').toLowerCase();
      if (file !== currentFile) continue;

      if (currentFile === 'admin.html') {
        if (u.hash && u.hash === currentHash) { match = a; break; }
        if (!u.hash && (!currentHash || currentHash === '#dashboard')) match = a;
      } else if (!u.hash) {
        match = a;
        break;
      }
    }

    if (match) {
      links.forEach(a => {
        a.classList.toggle('active', a === match);
        if (a === match) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    }
  }

  function cleanupDuplicateNavigation() {
    const seen = new Set();
    $$('.sidebar a').forEach(link => {
      const label = (link.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const href = link.getAttribute('href') || '';
      if (!label || !href) return;
      const key = `${href.toLowerCase()}|${label}`;
      if (!seen.has(key)) {
        seen.add(key);
        return;
      }
      const row = link.closest('li');
      (row || link).remove();
    });
  }

  function setupUnifiedProfileMenu() {
    const menu = $('#profileMenu');
    const button = $('#profileBtn');
    const dropdown = $('#profileDropdown');
    const notificationsButton = $('#notificationsBtn');
    const notificationsDropdown = $('#notificationDropdown');

    if (menu && button && dropdown) {
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-controls', 'profileDropdown');
      button.setAttribute('aria-expanded', 'false');
      dropdown.setAttribute('role', 'menu');
      dropdown.setAttribute('aria-hidden', 'true');
      menu.classList.remove('open', 'show', 'active');
      dropdown.classList.remove('open', 'show', 'active');
      dropdown.style.removeProperty('display');
    }

    if (notificationsButton && notificationsDropdown) {
      notificationsButton.setAttribute('aria-haspopup', 'true');
      notificationsButton.setAttribute('aria-controls', 'notificationDropdown');
      notificationsButton.setAttribute('aria-expanded', 'false');
      notificationsDropdown.setAttribute('aria-hidden', 'true');
      notificationsDropdown.classList.remove('open', 'show', 'active');
      notificationsDropdown.style.removeProperty('display');
    }
  }

  function addAccessibility() {
    if (!$('.admin-ui-skip-link')) {
      const skip = document.createElement('a');
      skip.className = 'admin-ui-skip-link';
      skip.href = '#adminMainContent';
      skip.textContent = 'Skip to main content';
      document.body.prepend(skip);
    }

    const main = $('.main-content');
    if (main && !main.id) main.id = 'adminMainContent';
    if (main) main.setAttribute('role', 'main');
    const sidebar = $('.sidebar');
    if (sidebar) sidebar.setAttribute('aria-label', 'Administrator navigation');

    $$('button').forEach(btn => {
      if (!btn.getAttribute('type')) btn.setAttribute('type', 'button');
      const text = (btn.textContent || '').trim();
      if (!text && !btn.getAttribute('aria-label')) {
        const title = btn.getAttribute('title');
        const icon = btn.querySelector('[data-lucide]')?.getAttribute('data-lucide');
        btn.setAttribute('aria-label', title || (icon ? icon.replace(/-/g, ' ') : 'Action'));
      }
    });

    $$('table').forEach(table => {
      if (!table.getAttribute('role')) table.setAttribute('role', 'table');
      $$('th', table).forEach(th => { if (!th.getAttribute('scope')) th.setAttribute('scope', 'col'); });
    });

    $$('input[required], select[required], textarea[required]').forEach(el => el.setAttribute('aria-required', 'true'));
  }

  function addMobileTitle() {
    const left = $('.topbar-left');
    if (!left || $('.admin-ui-mobile-title', left)) return;
    const h1 = $('.page-header h1, .ics-admin-header h1');
    if (!h1) return;
    const title = document.createElement('div');
    title.className = 'admin-ui-mobile-title';
    title.innerHTML = `<strong>${escapeHtml(h1.textContent.trim())}</strong><span>PGENRO IMS Admin</span>`;
    const menu = $('#mobileMenuBtn', left);
    if (menu?.nextSibling) left.insertBefore(title, menu.nextSibling);
    else left.prepend(title);
  }

  function setupKeyboardSearch() {
    const search = $('#globalSearchInput, #globalSearch, #quickSearchInput, #tableSearchInput, #visitorSearch');
    if (!search) return;
    document.addEventListener('keydown', e => {
      const target = e.target;
      const typing = target && /INPUT|TEXTAREA|SELECT/.test(target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.focus();
        if (typeof search.select === 'function') search.select();
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        search.focus();
      }
    });
  }

  function setupMobileBackdrop() {
    if ($('.overlay#overlay') || $('#sidebarOverlay') || $('#sidebarBackdrop')) return;
    const sidebar = $('#sidebar');
    const menu = $('#mobileMenuBtn');
    if (!sidebar || !menu) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'admin-sidebar-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.appendChild(backdrop);

    const sync = () => {
      const open = sidebar.classList.contains('mobile-open') || sidebar.classList.contains('open');
      backdrop.classList.toggle('active', open && innerWidth <= 900);
      backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    };

    menu.addEventListener('click', () => setTimeout(sync, 0));
    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open', 'open');
      backdrop.classList.remove('active');
      menu.setAttribute('aria-expanded', 'false');
    });
    new MutationObserver(sync).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  }

  function setupSidebarState() {
    const sidebar = $('#sidebar');
    const main = $('.main-wrapper');
    const collapse = $('#sidebarCollapseBtn');
    if (!sidebar) return;

    try {
      const collapsed = localStorage.getItem('pgenro_admin_sidebar') === 'collapsed';
      if (collapsed && innerWidth > 900) {
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
        main?.classList.add('sidebar-collapsed');
      }
    } catch {}

    if (collapse) collapse.setAttribute('aria-expanded', String(!sidebar.classList.contains('collapsed')));
  }

  function setupUnifiedShellControls() {
    const sidebar = $('#sidebar');
    const main = $('.main-wrapper');
    const profileMenu = $('#profileMenu');
    const profileBtn = $('#profileBtn');
    const profileDropdown = $('#profileDropdown');
    const notificationDropdown = $('#notificationDropdown');
    const mobileMenuBtn = $('#mobileMenuBtn');
    const collapseBtn = $('#sidebarCollapseBtn');

    // Always begin from a deterministic closed state. Legacy module CSS used
    // to leave these panels visible on first paint.
    profileMenu?.classList.remove('open', 'show', 'active');
    profileDropdown?.classList.remove('open', 'show', 'active');
    notificationDropdown?.classList.remove('open', 'show', 'active');
    profileDropdown?.style.removeProperty('display');
    notificationDropdown?.style.removeProperty('display');
    profileDropdown?.setAttribute('aria-hidden', 'true');
    notificationDropdown?.setAttribute('aria-hidden', 'true');
    profileBtn?.setAttribute('aria-expanded', 'false');
    $('#notificationsBtn')?.setAttribute('aria-expanded', 'false');

    const allBackdrops = () => [
      $('#sidebarBackdrop'),
      $('#sidebarOverlay'),
      $('.admin-sidebar-backdrop')
    ].filter(Boolean);

    const setBackdrop = open => {
      allBackdrops().forEach(node => node.classList.toggle('active', !!open));
      const overlay = $('#overlay');
      if (overlay && !$('#detailDrawer')?.classList.contains('open')) {
        overlay.classList.toggle('active', !!open);
      }
    };

    const closeMobile = () => {
      sidebar?.classList.remove('mobile-open', 'open');
      mobileMenuBtn?.setAttribute('aria-expanded', 'false');
      setBackdrop(false);
    };

    const closeProfile = () => {
      profileMenu?.classList.remove('open', 'show', 'active');
      profileDropdown?.classList.remove('open', 'show', 'active');
      profileDropdown?.style.removeProperty('display');
      profileDropdown?.setAttribute('aria-hidden', 'true');
      profileBtn?.setAttribute('aria-expanded', 'false');
    };

    const closeNotifications = () => {
      notificationDropdown?.classList.remove('open', 'show', 'active');
      notificationDropdown?.style.removeProperty('display');
      notificationDropdown?.setAttribute('aria-hidden', 'true');
      $('#notificationsBtn')?.setAttribute('aria-expanded', 'false');
    };

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      if (target.closest('#mobileMenuBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!sidebar) return;
        const opening = !sidebar.classList.contains('mobile-open');
        sidebar.classList.toggle('mobile-open', opening);
        mobileMenuBtn?.setAttribute('aria-expanded', String(opening));
        setBackdrop(opening && innerWidth <= 900);
        return;
      }

      if (target.closest('#sidebarCollapseBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!sidebar) return;

        if (innerWidth <= 900) {
          closeMobile();
          return;
        }

        const collapsed = !sidebar.classList.contains('collapsed');
        sidebar.classList.toggle('collapsed', collapsed);
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        main?.classList.toggle('sidebar-collapsed', collapsed);
        collapseBtn?.setAttribute('aria-expanded', String(!collapsed));
        try { localStorage.setItem('pgenro_admin_sidebar', collapsed ? 'collapsed' : 'expanded'); } catch {}
        return;
      }

      if (target.closest('#logoutBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const logoutButton = target.closest('#logoutBtn');
        logoutButton?.setAttribute('disabled', '');
        logoutButton?.setAttribute('aria-busy', 'true');

        (async () => {
          try {
            const client = window.pgenroSupabase || window.PGENRO_DB?.client;
            await client?.auth?.signOut?.();
          } catch (error) {
            console.warn('PGENRO IMS: sign-out request could not be completed.', error);
          } finally {
            try {
              Object.keys(sessionStorage)
                .filter(key => /^(pgenro|sb-)/i.test(key))
                .forEach(key => sessionStorage.removeItem(key));
            } catch {}
            window.location.href = '../User/login.html';
          }
        })();
        return;
      }

      if (target.closest('#profileBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!profileMenu) return;
        const opening = !profileMenu.classList.contains('open');
        closeProfile();
        closeNotifications();
        if (opening) {
          profileMenu.classList.add('open');
          profileDropdown?.setAttribute('aria-hidden', 'false');
          profileBtn?.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      if (target.closest('#notificationsBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!notificationDropdown) {
          window.AdminUI?.toast?.('No new notifications.', 'info');
          return;
        }
        const opening = !!notificationDropdown && !notificationDropdown.classList.contains('open');
        closeProfile();
        closeNotifications();
        if (opening) {
          notificationDropdown.classList.add('open');
          notificationDropdown.setAttribute('aria-hidden', 'false');
          $('#notificationsBtn')?.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      if (profileMenu && !profileMenu.contains(target)) closeProfile();
      const notificationWrapper = notificationDropdown?.closest('.notification-wrapper');
      if (notificationDropdown && notificationWrapper && !notificationWrapper.contains(target)) closeNotifications();

      if (innerWidth <= 900 && sidebar?.classList.contains('mobile-open')) {
        const insideSidebar = sidebar.contains(target);
        const isMenuButton = !!target.closest('#mobileMenuBtn');
        if (!insideSidebar && !isMenuButton && !target.closest('#overlay')) closeMobile();
      }
    }, true);

    window.addEventListener('resize', () => {
      if (innerWidth > 900) {
        sidebar?.classList.remove('mobile-open', 'open');
        setBackdrop(false);
      } else {
        document.body.classList.remove('sidebar-collapsed');
        main?.classList.remove('sidebar-collapsed');
      }
    });
  }

  function setupEscapeKey() {
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      $('#sidebar')?.classList.remove('mobile-open', 'open');
      $$('.admin-sidebar-backdrop, #sidebarOverlay, #sidebarBackdrop').forEach(el => el.classList.remove('active'));
      if (!$('#detailDrawer')?.classList.contains('open')) $('#overlay')?.classList.remove('active');
      $('#mobileMenuBtn')?.setAttribute('aria-expanded', 'false');
      $('#profileBtn')?.setAttribute('aria-expanded', 'false');
      $('#profileDropdown')?.classList.remove('open', 'show', 'active');
      $('#profileDropdown')?.setAttribute('aria-hidden', 'true');
      $('#profileMenu')?.classList.remove('open', 'show', 'active');
      $('#notificationDropdown')?.classList.remove('open', 'show', 'active');
      $('#notificationDropdown')?.setAttribute('aria-hidden', 'true');
      $('#notificationsBtn')?.setAttribute('aria-expanded', 'false');
      const drawer = $('#detailDrawer');
      if (drawer) {
        drawer.classList.remove('open', 'active');
        drawer.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function setupResponsiveTables() {
    $$('table').forEach(table => {
      if (table.closest('.table-responsive, .table-wrapper, .table-container, .ics-table-wrapper')) return;
      const parent = table.parentElement;
      if (!parent) return;
      const wrap = document.createElement('div');
      wrap.className = 'table-responsive admin-ui-auto-table-wrap';
      parent.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  function setupExternalLinkSafety() {
    $$('a[target="_blank"]').forEach(a => {
      const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
      rel.add('noopener'); rel.add('noreferrer');
      a.setAttribute('rel', [...rel].join(' '));
    });
  }

  function addFooterWhenMissing() {
    const main = $('.main-content');
    if (!main || $('footer', main) || $('.admin-footer', main)) return;
    const footer = document.createElement('footer');
    footer.className = 'admin-footer';
    footer.innerHTML = `<div><p>&copy; 2026 Provincial Government Environment and Natural Resources Office. Administrator workspace.</p></div><div class="footer-links"><a href="admin.html#audit">Audit Trail</a><a href="admin.html#backup">Backups</a><a href="admin.html#settings">Settings</a></div>`;
    main.appendChild(footer);
  }

  function setupOnlineState() {
    const apply = () => document.documentElement.dataset.network = navigator.onLine ? 'online' : 'offline';
    apply();
    addEventListener('online', apply);
    addEventListener('offline', apply);
  }

  function escapeHtml(v) {
    const d = document.createElement('div');
    d.textContent = v == null ? '' : String(v);
    return d.innerHTML;
  }

  window.AdminUI = window.AdminUI || {};
  window.AdminUI.toast = (message, type = 'success', timeout = 2800) => {
    let stack = $('.admin-ui-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'admin-ui-toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const toast = document.createElement('div');
    toast.className = 'admin-ui-toast';
    toast.dataset.type = type;
    toast.innerHTML = `<i data-lucide="${type === 'error' ? 'alert-circle' : type === 'warning' ? 'alert-triangle' : 'circle-check'}"></i><span>${escapeHtml(message)}</span>`;
    stack.appendChild(toast);
    window.lucide?.createIcons?.();
    setTimeout(() => {
      toast.style.opacity = '0'; toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 200);
    }, timeout);
  };

  function init() {
    document.documentElement.classList.add('admin-ui-ready');
    cleanupDuplicateNavigation();
    fixNavigation();
    setupUnifiedProfileMenu();
    window.addEventListener('hashchange', fixNavigation);
    addAccessibility();
    addMobileTitle();
    setupKeyboardSearch();
    setupMobileBackdrop();
    setupSidebarState();
    setupUnifiedShellControls();
    // Motion is owned by shared/pgenro-global.js.
    setupEscapeKey();
    setupResponsiveTables();
    setupExternalLinkSafety();
    addFooterWhenMissing();
    setupOnlineState();
    // shared/supabase.js owns authorization and sign-out.
    window.lucide?.createIcons?.();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

/* Module-owned motion; content remains visible if JavaScript is unavailable. */
/* Progressive, one-time entrance effects for the administrator workspace. */
(() => {
  'use strict';
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const targets = [
    '.main-content > .page-header',
    '.main-content > .ics-admin-header',
    '.main-content :is(.kpi-grid,.stats-grid,.metrics-grid,.ics-kpi-grid) > *',
    '.main-content .module-control-grid > *',
    '.main-content :is(.section-header,.panel-header,.ics-panel-header)',
    '.main-content :is(.chart-card,.table-card,.ics-panel,.service-form-card)'
  ].join(',');

  function init() {
    if (motionQuery?.matches || !('IntersectionObserver' in window)) return;
    const seen = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: .04, rootMargin: '0px 0px -18px 0px' });

    const register = root => {
      const elements = root.matches?.(targets) ? [root] : [...root.querySelectorAll(targets)];
      for (const element of elements) {
        if (seen.has(element) || element.closest('[hidden],.modal-backdrop,.modal-overlay')) continue;
        seen.add(element);
        const siblings = [...element.parentElement.children].filter(el => el.matches(targets));
        element.style.setProperty('--admin-stagger', `${Math.min(siblings.indexOf(element), 5) * 45}ms`);
        element.classList.add('admin-motion-pending');
        observer.observe(element);
      }
    };

    register(document.querySelector('.main-content') || document.body);
    const main = document.querySelector('.main-content');
    if (main) {
      const changes = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1) register(node);
        }
      });
      changes.observe(main, { childList: true, subtree: true });
      window.addEventListener('pagehide', () => { changes.disconnect(); observer.disconnect(); }, { once: true });
    }
    motionQuery?.addEventListener?.('change', event => {
      if (!event.matches) return;
      observer.disconnect();
      document.querySelectorAll('.admin-motion-pending').forEach(el => el.classList.add('is-visible'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();


/* ===================== MODULE NOTIFICATION ENGINE V3 =====================
 * Only alerts when this module receives new visible records.
 */
(function(){
  const moduleName=document.body?.dataset?.adminPage || location.pathname.split('/').pop();
  const key='pgenro_module_seen_'+moduleName;
  function addNotification(text){
    const list=document.querySelector('#notificationList');
    const badge=document.querySelector('#notifBadgeCount');
    if(!list)return;
    const empty=list.querySelector('.empty-notif-state'); if(empty) empty.remove();
    const item=document.createElement('div');
    item.className='notification-item';
    item.innerHTML='<strong>New update</strong><br><span>'+text.replace(/[<>]/g,'')+'</span>';
    list.prepend(item);
    let count=parseInt((badge?.textContent||'0').match(/\d+/)?.[0]||0)+1;
    if(badge) badge.textContent=count+' Unread';
    const ping=document.querySelector('#notifPing'); if(ping) ping.style.display='block';
  }
  function scan(){
    const rows=document.querySelectorAll('tbody tr');
    const count=rows.length;
    const old=parseInt(localStorage.getItem(key)||count);
    if(count>old) addNotification((count-old)+' new record(s) added in this module.');
    localStorage.setItem(key,String(count));
  }
  window.addEventListener('load',()=>setTimeout(scan,1500));
  const observer=new MutationObserver(()=>scan());
  observer.observe(document.body,{childList:true,subtree:true});
})();
