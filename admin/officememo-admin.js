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
 * =========================================================================
 * PGENRO IMS - OFFICE MEMORANDUM ADMINISTRATION CONTROLLER
 * =========================================================================
 * Collection target: "office_memos"
 * Schema:
 * {
 *    memoNo: string,            // Control No. (e.g., "MEMO-2026-001")
 *    date: string,              // YYYY-MM-DD
 *    addressedTo: string,       // Target recipient / Division
 *    subject: string,           // Directive Subject Matter
 *    title: string,             // Synchronized alias for subject
 *    issuedBy: string,          // Signatory / Division
 *    remarks: string,           // Action notes / remarks
 *    isPinned: boolean,         // Pinned directive status
 *    pdfUrl: string,            // Base64 Data URI or remote Cloud Storage URL
 *    pdfFileName: string,       // Scanned document filename
 *    createdAt: timestamp       // Creation timestamp
 * }
 * =========================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    window.lucide?.createIcons?.();
  }

  // =========================================================================
  // 1. SUPABASE CONFIGURATION & INITIALIZATION
  // =========================================================================
  const supabaseStoreConfig = {}; // Supabase store configuration; all persistence is routed to Supabase. // Supabase store adapter; configure Supabase in shared/supabase.js.

  let db = null;
  let supabaseStoreInitialized = false;

  try {
    if (typeof supabaseStore !== "undefined") {
      if (supabaseStore.clients.length === 0) {
        supabaseStore.connect(supabaseStoreConfig);
      }
      db = supabaseStore.tableStore();
      supabaseStoreInitialized = true;
      updateDbStatusUI(true, "System Connected (office_memos)");
    }
  } catch (err) {
    console.warn("Operating with local storage fallback mode:", err);
    updateDbStatusUI(false, "Local Storage Mode");
  }

  function updateDbStatusUI(isOnline, msg) {
    const dot = document.getElementById("dbStatusDot");
    const text = document.getElementById("dbStatusText");
    if (dot) dot.className = isOnline ? "status-dot online" : "status-dot offline";
    if (text) text.textContent = msg;
  }

  // =========================================================================
  // 2. STATE MANAGEMENT & DOM ELEMENTS
  // =========================================================================
  let rawMemos = [];
  let filteredMemos = [];
  let deleteTargetId = null;
  let currentPage = 1;
  const rowsPerPage = 8;

  // Table & Filters
  const memoTableBody = document.getElementById("memoAdminTableBody");
  const tableFilterInput = document.getElementById("tableFilterInput");
  const globalSearchInput = document.getElementById("globalSearchInput");
  const pinnedFilterSelect = document.getElementById("pinnedFilterSelect");
  const attachmentFilterSelect = document.getElementById("attachmentFilterSelect");
  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  const paginationInfo = document.getElementById("memoPaginationInfo");
  const paginationBtns = document.getElementById("tablePaginationBtns");
  const printRegistryBtn = document.getElementById("printRegistryBtn");

  // Memo Form Modal
  const memoFormModal = document.getElementById("memoFormModal");
  const memoForm = document.getElementById("memoForm");
  const openCreateModalBtn = document.getElementById("openCreateModalBtn");
  const closeFormModalBtn = document.getElementById("closeFormModalBtn");
  const cancelFormModalBtn = document.getElementById("cancelFormModalBtn");
  const modalFormTitle = document.getElementById("modalFormTitle");

  // Form Inputs
  const memoDocId = document.getElementById("memoDocId");
  const formControlNo = document.getElementById("formControlNo");
  const formDate = document.getElementById("formDate");
  const formAddressedTo = document.getElementById("formAddressedTo");
  const formSubject = document.getElementById("formSubject");
  const formIssuedBy = document.getElementById("formIssuedBy");
  const formRemarks = document.getElementById("formRemarks");
  const formIsPinned = document.getElementById("formIsPinned");
  const formPdfFile = document.getElementById("formPdfFile");
  const formExistingPdfBase64 = document.getElementById("formExistingPdfBase64");
  const attachedFileInfo = document.getElementById("attachedFileInfo");
  const attachedFileName = document.getElementById("attachedFileName");
  const removeAttachmentBtn = document.getElementById("removeAttachmentBtn");
  const fileDropzone = document.getElementById("fileDropzone");
  const attachedFileMeta = document.getElementById("attachedFileMeta");
  const attachedFileState = document.getElementById("attachedFileState");
  const previewSelectedPdfBtn = document.getElementById("previewSelectedPdfBtn");
  const memoUploadStatus = document.getElementById("memoUploadStatus");
  const memoUploadStatusText = document.getElementById("memoUploadStatusText");
  const memoUploadProgress = document.getElementById("memoUploadProgress");
  const memoUploadProgressBar = document.getElementById("memoUploadProgressBar");
  const memoUploadProgressLabel = document.getElementById("memoUploadProgressLabel");
  const saveMemoSubmitBtn = document.getElementById("saveMemoSubmitBtn");
  const saveMemoSubmitText = document.getElementById("saveMemoSubmitText");

  // Memorandum OCR
  const runMemoOcrBtn = document.getElementById("runMemoOcrBtn");
  const memoOcrStatus = document.getElementById("memoOcrStatus");
  const memoOcrText = document.getElementById("memoOcrText");
  const OCR_SERVER_URL = "http://127.0.0.1:5000";
  let selectedMemoFile = null;
  let memoOcrToken = 0;

  // PDF Viewer Modal
  const viewPdfModal = document.getElementById("viewPdfModal");
  const adminPdfFrame = document.getElementById("adminPdfFrame");
  const adminNoPdfState = document.getElementById("adminNoPdfState");
  const viewPdfTitle = document.getElementById("viewPdfTitle");
  const viewPdfSubtitle = document.getElementById("viewPdfSubtitle");
  const downloadPdfBtn = document.getElementById("downloadPdfBtn");
  const closeViewPdfBtn = document.getElementById("closeViewPdfBtn");
  const dismissViewPdfBtn = document.getElementById("dismissViewPdfBtn");

  // Delete Confirmation Modal
  const deleteConfirmModal = document.getElementById("deleteConfirmModal");
  const deleteMemoNoLabel = document.getElementById("deleteMemoNoLabel");
  const closeDeleteModalBtn = document.getElementById("closeDeleteModalBtn");
  const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
  const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

  // KPI Counters
  const kpiTotalMemos = document.getElementById("kpiTotalMemos");
  const kpiPinnedMemos = document.getElementById("kpiPinnedMemos");
  const kpiThisMonthMemos = document.getElementById("kpiThisMonthMemos");
  const kpiWithAttachments = document.getElementById("kpiWithAttachments");

  // Shared profile/mobile navigation is centralized in the page-owned admin shell below.
  const exportCsvBtn = document.getElementById("exportCsvBtn");

  if (printRegistryBtn) {
    printRegistryBtn.addEventListener("click", () => window.print());
  }

  // =========================================================================
  // 3. TOAST NOTIFICATIONS
  // =========================================================================
  function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}"></i>
      <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    if (window.lucide) window.lucide?.createIcons?.();

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 200);
    }, 3200);
  }

  // =========================================================================
  // 4. DATA SYNCHRONIZATION
  // =========================================================================
  function listenToMemos() {
    if (supabaseStoreInitialized && db) {
      db.collection("office_memos")
        .orderBy("createdAt", "desc")
        .onSnapshot(
          (snapshot) => {
            rawMemos = [];
            snapshot.forEach((doc) => {
              rawMemos.push({ id: doc.id, ...doc.data() });
            });
            applyFiltersAndRender();
            calculateKpis();
          },
          (err) => {
            console.error("Supabase error, switching to localStorage:", err);
            loadLocalMemos();
          }
        );
    } else {
      loadLocalMemos();
    }
  }

  function loadLocalMemos() {
    const local = localStorage.getItem("pgenro_office_memos");
    if (local) {
      rawMemos = JSON.parse(local);
    } else {
      // Seed default baseline memos if empty
      rawMemos = [
        {
          id: "local-1",
          memoNo: "MEMO-2026-001",
          date: new Date().toISOString().slice(0, 10),
          addressedTo: "All Division Chiefs & Unit Heads",
          subject: "Strict Enforcement of Watershed Protection Protocol within Provincial Reserves",
          title: "Strict Enforcement of Watershed Protection Protocol within Provincial Reserves",
          issuedBy: "Office of the Provincial ENR Officer",
          remarks: "For Strict Compliance",
          isPinned: true,
          pdfUrl: "",
          pdfFileName: ""
        }
      ];
      saveLocalMemos();
    }
    applyFiltersAndRender();
    calculateKpis();
  }

  function saveLocalMemos() {
    localStorage.setItem("pgenro_office_memos", JSON.stringify(rawMemos));
  }

  // =========================================================================
  // 5. KPI METRICS
  // =========================================================================
  function calculateKpis() {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let pinnedCount = 0;
    let thisMonthCount = 0;
    let attachmentCount = 0;

    rawMemos.forEach((memo) => {
      if (memo.isPinned) pinnedCount++;
      if (memo.pdfUrl && memo.pdfUrl.trim() !== "") attachmentCount++;

      if (memo.date) {
        const d = new Date(memo.date);
        if (!isNaN(d.getTime()) && d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
          thisMonthCount++;
        }
      }
    });

    if (kpiTotalMemos) kpiTotalMemos.textContent = rawMemos.length.toLocaleString();
    if (kpiPinnedMemos) kpiPinnedMemos.textContent = pinnedCount.toLocaleString();
    if (kpiThisMonthMemos) kpiThisMonthMemos.textContent = thisMonthCount.toLocaleString();
    if (kpiWithAttachments) kpiWithAttachments.textContent = attachmentCount.toLocaleString();
  }

  // =========================================================================
  // 6. FILTERING, SEARCH & PAGINATION
  // =========================================================================
  function applyFiltersAndRender() {
    const term = (tableFilterInput?.value || globalSearchInput?.value || "").toLowerCase().trim();
    const pinnedFilter = pinnedFilterSelect?.value || "all";
    const attachmentFilter = attachmentFilterSelect?.value || "all";

    filteredMemos = rawMemos.filter((memo) => {
      const controlNo = (memo.memoNo || "").toLowerCase();
      const subject = (memo.subject || memo.title || "").toLowerCase();
      const addressedTo = (memo.addressedTo || "").toLowerCase();
      const remarks = (memo.remarks || "").toLowerCase();

      const matchesSearch = !term || controlNo.includes(term) || subject.includes(term) || addressedTo.includes(term) || remarks.includes(term);

      let matchesPinned = true;
      if (pinnedFilter === "pinned") matchesPinned = memo.isPinned === true;
      if (pinnedFilter === "unpinned") matchesPinned = !memo.isPinned;

      let matchesAttachment = true;
      const hasAttachment = Boolean(memo.pdfUrl && memo.pdfUrl.trim() !== "");
      if (attachmentFilter === "with_pdf") matchesAttachment = hasAttachment;
      if (attachmentFilter === "no_pdf") matchesAttachment = !hasAttachment;

      return matchesSearch && matchesPinned && matchesAttachment;
    });

    // Pinned records float to top
    filteredMemos.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));

    currentPage = 1;
    renderTable();
  }

  function renderTable() {
    if (!memoTableBody) return;

    if (filteredMemos.length === 0) {
      memoTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-table-cell">No matching office memorandum records found.</td>
        </tr>
      `;
      if (paginationInfo) paginationInfo.textContent = "Showing 0 to 0 of 0 directives";
      if (paginationBtns) paginationBtns.innerHTML = `<button class="page-btn" disabled>1</button>`;
      return;
    }

    const totalPages = Math.ceil(filteredMemos.length / rowsPerPage);
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const currentMemos = filteredMemos.slice(startIndex, startIndex + rowsPerPage);

    memoTableBody.innerHTML = currentMemos.map((memo) => {
      const hasPdf = Boolean(memo.pdfUrl && memo.pdfUrl.trim() !== "");
      return `
        <tr>
          <td><input type="checkbox" class="row-checkbox" value="${memo.id}" /></td>
          <td>
            <strong style="color: var(--slate-900);">${escapeHtml(memo.memoNo || "UNTITLED")}</strong>
            ${memo.isPinned ? `<span class="badge-pinned"><i data-lucide="pin" style="width:10px;height:10px;"></i> PINNED</span>` : ""}
          </td>
          <td class="text-muted font-mono">${memo.date || "N/A"}</td>
          <td>
            <div class="memo-recipient-cell">${escapeHtml(memo.addressedTo || "—")}</div>
          </td>
          <td>
            <div class="memo-title-cell">${escapeHtml(memo.subject || memo.title || "No subject specified")}</div>
          </td>
          <td>
            <span class="table-tag">${escapeHtml(memo.remarks || "General Directive")}</span>
          </td>
          <td>
            ${
              hasPdf
                ? `<button type="button" class="badge-status success preview-pdf-btn" data-id="${memo.id}" style="cursor: pointer; border: none;">
                    <i data-lucide="file-check" style="width:12px;height:12px;"></i> View PDF
                  </button>`
                : `<span class="badge-status" style="background: var(--slate-100); color: var(--slate-500);"><span class="dot" style="background: var(--slate-400);"></span> None</span>`
            }
          </td>
          <td style="text-align: right;">
            <div class="action-btn-group">
              <button type="button" class="btn-action pin-toggle-btn ${memo.isPinned ? "active" : ""}" data-id="${memo.id}" title="${memo.isPinned ? "Unpin directive" : "Pin to top"}">
                <i data-lucide="pin"></i>
              </button>
              <button type="button" class="btn-action edit-memo-btn" data-id="${memo.id}" title="Edit memorandum">
                <i data-lucide="edit-3"></i>
              </button>
              <button type="button" class="btn-action delete delete-memo-btn" data-id="${memo.id}" data-no="${escapeHtml(memo.memoNo || "")}" title="Delete record">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    if (paginationInfo) {
      const endItem = Math.min(startIndex + rowsPerPage, filteredMemos.length);
      paginationInfo.textContent = `Showing ${startIndex + 1} to ${endItem} of ${filteredMemos.length} directives`;
    }

    renderPaginationControls(totalPages);
    attachRowActions();
    if (window.lucide) window.lucide?.createIcons?.();
  }

  function renderPaginationControls(totalPages) {
    if (!paginationBtns) return;
    let html = `<button class="page-btn" ${currentPage === 1 ? "disabled" : ""} data-page="${currentPage - 1}">&laquo;</button>`;

    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="page-btn ${i === currentPage ? "active" : ""}" data-page="${i}">${i}</button>`;
    }

    html += `<button class="page-btn" ${currentPage === totalPages ? "disabled" : ""} data-page="${currentPage + 1}">&raquo;</button>`;
    paginationBtns.innerHTML = html;

    paginationBtns.querySelectorAll(".page-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = parseInt(btn.getAttribute("data-page"), 10);
        if (!isNaN(p) && p >= 1 && p <= totalPages) {
          currentPage = p;
          renderTable();
        }
      });
    });
  }

  // =========================================================================
  // 7. ROW ACTIONS
  // =========================================================================
  function attachRowActions() {
    // Preview PDF
    document.querySelectorAll(".preview-pdf-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const memo = rawMemos.find((m) => m.id === id);
        if (memo) openPdfViewer(memo);
      });
    });

    // Pin/Unpin
    document.querySelectorAll(".pin-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const memo = rawMemos.find((m) => m.id === id);
        if (!memo) return;

        const newPinnedState = !memo.isPinned;
        if (supabaseStoreInitialized && db) {
          await db.collection("office_memos").doc(id).update({ isPinned: newPinnedState });
        } else {
          memo.isPinned = newPinnedState;
          saveLocalMemos();
          applyFiltersAndRender();
          calculateKpis();
        }
        showToast(`Directive ${memo.memoNo || ""} ${newPinnedState ? "pinned to top" : "unpinned"}.`);
      });
    });

    // Edit
    document.querySelectorAll(".edit-memo-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const memo = rawMemos.find((m) => m.id === id);
        if (memo) openEditModal(memo);
      });
    });

    // Delete
    document.querySelectorAll(".delete-memo-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        deleteTargetId = btn.getAttribute("data-id");
        const memoNo = btn.getAttribute("data-no") || "this record";
        if (deleteMemoNoLabel) deleteMemoNoLabel.textContent = memoNo;
        if (deleteConfirmModal) deleteConfirmModal.classList.add("open");
      });
    });
  }


  // =========================================================================
  // 8. MEMORANDUM OCR ENGINE
  // =========================================================================
  function normalizeMemoOcrText(value = "") {
    return String(value || "")
      .replace(/\u00A0/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function memoParseDate(value = "") {
    const text = String(value || "").trim();
    if (!text) return "";

    const dayFirst = text.match(
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i
    );

    if (dayFirst) {
      const months = [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december"
      ];
      const idx = months.indexOf(dayFirst[2].toLowerCase());
      if (idx >= 0) {
        return `${dayFirst[3]}-${String(idx + 1).padStart(2, "0")}-${String(dayFirst[1]).padStart(2, "0")}`;
      }
    }

    const monthFirst = text.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i
    );

    if (monthFirst) {
      const months = [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december"
      ];
      const idx = months.indexOf(monthFirst[1].toLowerCase());
      if (idx >= 0) {
        return `${monthFirst[3]}-${String(idx + 1).padStart(2, "0")}-${String(monthFirst[2]).padStart(2, "0")}`;
      }
    }

    const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) {
      return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
    }

    return "";
  }

  function memoLines(text = "") {
    return normalizeMemoOcrText(text)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function memoCleanField(value = "") {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^[\s:;,.|-]+|[\s:;,.|-]+$/g, "")
      .trim();
  }

  function memoExtractLabeledField(text, labels, maxLines = 3) {
    const lines = memoLines(text);
    const labelRegex = new RegExp(
      `^(?:${labels.join("|")})\\s*[:\\-]\\s*(.*)$`,
      "i"
    );

    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(labelRegex);
      if (!match) continue;

      const collected = [];
      if (match[1]) collected.push(match[1].trim());

      for (let j = i + 1; j < Math.min(lines.length, i + 1 + maxLines); j += 1) {
        const line = lines[j];

        if (
          /^(?:DATE|TO|T0|FROM|THRU|REF|RE|SUBJECT|SUBJ|SUBJECT\s+MATTER)\s*[:\-]/i.test(line) ||
          /^(?:DEAR|GREETINGS|SIR|MADAM|1\.|\d+\.)\s*/i.test(line)
        ) {
          break;
        }

        collected.push(line);
      }

      const result = memoCleanField(collected.join(" "));
      if (result) return result;
    }

    return "";
  }

  function detectMemoSubject(text = "", metadata = {}) {
    // Prefer server metadata when it contains a strict subject.
    const serverSubject = memoCleanField(metadata?.subject || "");
    if (
      serverSubject &&
      !/^(?:republic of the philippines|province of|provincial government|department of)/i.test(serverSubject)
    ) {
      return serverSubject;
    }

    // Exact labeled subject only.
    const lines = memoLines(text);
    const labelRegex = /^(?:SUBJECT\s+MATTER|SUBJECT|SUBJ|RE)\s*[:\-]\s*(.*)$/i;

    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(labelRegex);
      if (!match) continue;

      const collected = [];
      if (match[1]) collected.push(match[1].trim());

      // Wrapped subject lines may follow the label.
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
        const line = lines[j];

        // Stop at the next labeled document field or body paragraph.
        if (
          /^(?:DATE|TO|T0|FROM|THRU|REF|SUBJECT|SUBJ)\s*[:\-]/i.test(line) ||
          /^(?:DEAR|GREETINGS|SIR|MADAM)\b/i.test(line) ||
          /^\d+\.\s+/.test(line)
        ) {
          break;
        }

        collected.push(line);
      }

      const candidate = memoCleanField(collected.join(" "));
      if (
        candidate &&
        !/^(?:republic of the philippines|province of|provincial government|department of)/i.test(candidate)
      ) {
        return candidate
          .replace(/\s+/g, " ")
          .replace(/\bAUGNENTATION\b/gi, "AUGMENTATION");
      }
    }

    return "";
  }

  function detectMemoDocumentType(text = "", metadata = {}) {
    const combined = String(text || "");
    const upper = combined.toUpperCase();

    // Strong headings / explicit document labels only.
    if (/\b(?:OFFICE\s+MEMORANDUM|OFFICE\s+MEMO)\b/.test(upper)) return "Memorandum";
    if (/(?:^|\n)\s*MEMORANDUM\s*(?:NO\.?|NUMBER)?\s*[:#\-0-9]/i.test(combined)) return "Memorandum";
    if (/\bMEMORANDUM\b/.test(upper) && /\bSUBJECT\b/.test(upper)) return "Memorandum";

    const serverType = memoCleanField(metadata?.documentType || "");
    if (serverType) return serverType;

    // Avoid false classification from filename/body words.
    return "Memorandum";
  }

  function parseMemoOcr(rawText = "", serverMetadata = {}) {
    const text = normalizeMemoOcrText(rawText);
    const metadata = serverMetadata && typeof serverMetadata === "object"
      ? serverMetadata
      : {};

    const result = {
      memoNo: memoCleanField(metadata.controlNo || ""),
      date: memoParseDate(metadata.date || ""),
      addressedTo: memoCleanField(metadata.recipient || ""),
      subject: "",
      issuedBy: memoCleanField(metadata.issuedBy || metadata.sourceOffice || ""),
      documentType: detectMemoDocumentType(text, metadata),
      remarks: ""
    };

    if (!result.memoNo) {
      const controlPatterns = [
        /\b(?:OFFICE\s+MEMORANDUM|MEMORANDUM|MEMO)\s+(?:NO\.?|NUMBER)\s*[:#\-]?\s*([A-Z0-9._\/-]+)/i,
        /(?:^|\n)\s*(?:NO\.?|NUMBER)\s*[:#\-]?\s*([A-Z0-9._\/-]+)/i
      ];

      for (const pattern of controlPatterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
          result.memoNo = memoCleanField(match[1]);
          break;
        }
      }
    }

    if (!result.date) {
      const explicitDate =
        text.match(/(?:^|\n)\s*(?:DATE|DATE\s+ISSUED|DATED)\s*[:\-]?\s*([^\n]+)/i);

      if (explicitDate?.[1]) {
        result.date = memoParseDate(explicitDate[1]);
      }

      if (!result.date) {
        result.date = memoParseDate(text);
      }
    }

    if (!result.addressedTo) {
      result.addressedTo = memoExtractLabeledField(
        text,
        ["TO", "T0", "MEMORANDUM FOR", "ADDRESSED TO", "FOR"],
        2
      );
    }

    result.subject = detectMemoSubject(text, metadata);

    if (!result.issuedBy) {
      result.issuedBy = memoExtractLabeledField(
        text,
        ["FROM", "ISSUED BY", "ISSUING OFFICE", "ORIGINATING OFFICE"],
        2
      );
    }

    return result;
  }

  function setMemoOcrStatus(message, state = "ready") {
    if (memoOcrStatus) {
      memoOcrStatus.textContent = message;
      memoOcrStatus.dataset.state = state;
    }

    if (selectedMemoFile && attachedFileState) {
      if (state === "working") {
        attachedFileState.innerHTML = '<i data-lucide="loader-2" class="spin-icon"></i> OCR';
      } else if (state === "success") {
        attachedFileState.innerHTML = '<i data-lucide="check-circle-2"></i> OCR ready';
      } else if (state === "error") {
        attachedFileState.innerHTML = '<i data-lucide="file-check-2"></i> PDF ready';
      } else {
        attachedFileState.innerHTML = '<i data-lucide="check-circle-2"></i> Ready';
      }
      if (window.lucide) window.lucide?.createIcons?.();
    }
  }

  async function checkMemoOcrServer() {
    try {
      const response = await fetch(`${OCR_SERVER_URL}/health`, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(3000)
      });
      if (!response.ok) return false;
      const data = await response.json();
      return Boolean(data?.ok);
    } catch {
      return false;
    }
  }

  async function runMemoOcr(file) {
    if (!file) return;

    const token = ++memoOcrToken;

    if (runMemoOcrBtn) {
      runMemoOcrBtn.disabled = true;
      runMemoOcrBtn.innerHTML = '<i data-lucide="loader-2" class="spin-icon"></i><span>Reading...</span>';
      if (window.lucide) window.lucide?.createIcons?.();
    }

    setMemoOcrStatus("Connecting to OCR server...", "working");

    try {
      if (!serverOnlineForMemo) {
        const online = await checkMemoOcrServer();
        if (!online) {
          throw new Error("OCR Server is offline. Start it with: python OCR.py");
        }
        serverOnlineForMemo = true;
      }

      const formData = new FormData();
      formData.append("file", file, file.name);

      setMemoOcrStatus("Scanning memorandum and extracting fields...", "working");

      const response = await fetch(`${OCR_SERVER_URL}/ocr`, {
        method: "POST",
        body: formData
      });

      let result = null;
      try {
        result = await response.json();
      } catch {
        throw new Error("OCR Server returned an invalid response.");
      }

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || `OCR failed with status ${response.status}.`);
      }

      if (token !== memoOcrToken) return;

      const text = String(result.text || "").trim();
      const metadata = result.metadata || {};
      if (!text) {
        throw new Error("No readable text was detected.");
      }

      const detected = parseMemoOcr(text, metadata);

      // Fill memorandum form fields from actual document content.
      if (formControlNo && detected.memoNo) {
        formControlNo.value = detected.memoNo;
      }

      if (formDate && detected.date) {
        formDate.value = detected.date;
      }

      if (formAddressedTo && detected.addressedTo) {
        formAddressedTo.value = detected.addressedTo;
      }

      if (formSubject && detected.subject) {
        formSubject.value = detected.subject;
      }

      if (formIssuedBy && detected.issuedBy) {
        formIssuedBy.value = detected.issuedBy;
      }

      if (memoOcrText) {
        memoOcrText.value = text;
      }

      setMemoOcrStatus(
        `OCR complete • ${text.length.toLocaleString()} characters • ${detected.documentType || "Document"}`,
        "success"
      );

      showToast(
        `OCR complete: ${[
          detected.memoNo && `No. ${detected.memoNo}`,
          detected.addressedTo && `To: ${detected.addressedTo}`,
          detected.subject && `Subject: ${detected.subject}`,
          detected.date && `Date: ${detected.date}`
        ].filter(Boolean).join(" | ") || "Document read successfully."}`,
        "success"
      );
    } catch (error) {
      console.error("Memorandum OCR:", error);
      serverOnlineForMemo = false;
      setMemoOcrStatus(error.message || "OCR failed.", "error");
      showToast(error.message || "Failed to read memorandum.", "error");
    } finally {
      if (token === memoOcrToken) {
        if (runMemoOcrBtn) {
          runMemoOcrBtn.disabled = !selectedMemoFile;
          runMemoOcrBtn.innerHTML = '<i data-lucide="scan-text"></i><span>Run OCR</span>';
          if (window.lucide) window.lucide?.createIcons?.();
        }
      }
    }
  }

  let serverOnlineForMemo = false;

  // =========================================================================
  // 8. FORM & MODAL CONTROLS
  // =========================================================================
  const MAX_MEMO_PDF_SIZE = 10 * 1024 * 1024;

  function formatMemoFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 100 * 1024 ? 1 : 0)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  function setMemoUploadStatus(message, state = "idle") {
    if (memoUploadStatus) memoUploadStatus.dataset.state = state;
    if (memoUploadStatusText) memoUploadStatusText.textContent = message;
  }

  function setMemoUploadProgress(percent = 0, label = "Preparing document...", visible = true) {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    if (memoUploadProgress) {
      memoUploadProgress.hidden = !visible;
      memoUploadProgress.setAttribute("aria-hidden", visible ? "false" : "true");
    }
    if (memoUploadProgressBar) memoUploadProgressBar.style.width = `${safePercent}%`;
    if (memoUploadProgressLabel) memoUploadProgressLabel.textContent = label;
  }

  function setSaveMemoState(isSaving, text = "Save Memorandum") {
    if (!saveMemoSubmitBtn) return;
    saveMemoSubmitBtn.disabled = Boolean(isSaving);
    saveMemoSubmitBtn.classList.toggle("is-saving", Boolean(isSaving));
    saveMemoSubmitBtn.innerHTML = isSaving
      ? '<i data-lucide="loader-2" class="spin-icon"></i><span>Saving...</span>'
      : `<i data-lucide="save"></i><span id="saveMemoSubmitText">${escapeHtml(text)}</span>`;
    if (window.lucide) window.lucide?.createIcons?.();
  }

  function refreshMemoFileCard({ name = "", meta = "", existing = false } = {}) {
    if (!attachedFileInfo) return;

    if (!name) {
      attachedFileInfo.classList.remove("show");
      if (attachedFileName) attachedFileName.textContent = "";
      if (attachedFileMeta) attachedFileMeta.textContent = "";
      if (previewSelectedPdfBtn) previewSelectedPdfBtn.disabled = true;
      return;
    }

    attachedFileInfo.classList.add("show");
    if (attachedFileName) attachedFileName.textContent = name;
    if (attachedFileMeta) attachedFileMeta.textContent = meta || (existing ? "Existing PDF attachment" : "PDF document");
    if (previewSelectedPdfBtn) previewSelectedPdfBtn.disabled = false;
    if (attachedFileState) {
      attachedFileState.innerHTML = '<i data-lucide="check-circle-2"></i> Ready';
    }
    if (window.lucide) window.lucide?.createIcons?.();
  }

  function resetMemoAttachmentUi() {
    if (formPdfFile) formPdfFile.value = "";
    if (formExistingPdfBase64) formExistingPdfBase64.value = "";
    selectedMemoFile = null;
    memoOcrToken += 1;

    refreshMemoFileCard();
    setMemoUploadProgress(0, "Preparing document...", false);
    setMemoUploadStatus("No document selected yet.", "idle");

    if (memoOcrText) memoOcrText.value = "";
    setMemoOcrStatus("Select a PDF to read and extract memorandum details.", "ready");

    if (runMemoOcrBtn) {
      runMemoOcrBtn.disabled = true;
      runMemoOcrBtn.innerHTML = '<i data-lucide="scan-text"></i><span>Run OCR</span>';
    }

    if (window.lucide) window.lucide?.createIcons?.();
  }

  function validateMemoPdf(file) {
    if (!file) return "No file was selected.";

    const name = String(file.name || "").toLowerCase();
    const type = String(file.type || "").toLowerCase();
    const looksLikePdf = type === "application/pdf" || name.endsWith(".pdf");

    if (!looksLikePdf) return "Please select a PDF document.";
    if (!file.size) return "The selected PDF is empty.";
    if (file.size > MAX_MEMO_PDF_SIZE) return "The PDF exceeds the 10 MB upload limit.";

    return "";
  }

  function readMemoPdfAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onloadstart = () => {
        setMemoUploadProgress(8, "Preparing document...", true);
      };

      reader.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.max(10, Math.min(92, Math.round((event.loaded / event.total) * 92)));
        setMemoUploadProgress(pct, "Reading PDF...", true);
      };

      reader.onerror = () => reject(reader.error || new Error("The PDF could not be read."));
      reader.onabort = () => reject(new Error("File reading was cancelled."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  async function acceptMemoPdf(file) {
    const validationError = validateMemoPdf(file);

    if (validationError) {
      if (formPdfFile) formPdfFile.value = "";
      selectedMemoFile = null;
      refreshMemoFileCard();
      setMemoUploadProgress(0, "Preparing document...", false);
      setMemoUploadStatus(validationError, "error");
      if (runMemoOcrBtn) runMemoOcrBtn.disabled = true;
      showToast(validationError, "error");
      return false;
    }

    selectedMemoFile = file;
    setMemoUploadStatus(`Reading ${file.name}...`, "working");
    setMemoUploadProgress(8, "Preparing document...", true);

    try {
      const dataUrl = await readMemoPdfAsDataUrl(file);

      if (!dataUrl.startsWith("data:application/pdf") && !dataUrl.startsWith("data:")) {
        throw new Error("The selected document could not be prepared for preview.");
      }

      formExistingPdfBase64.value = dataUrl;
      refreshMemoFileCard({
        name: file.name,
        meta: `${formatMemoFileSize(file.size)} • PDF document`
      });

      setMemoUploadProgress(100, "Document ready", true);
      setMemoUploadStatus("PDF attached successfully. You can preview it or run OCR to extract details.", "success");

      if (runMemoOcrBtn) {
        runMemoOcrBtn.disabled = false;
        runMemoOcrBtn.innerHTML = '<i data-lucide="scan-text"></i><span>Run OCR</span>';
      }

      window.setTimeout(() => setMemoUploadProgress(0, "Preparing document...", false), 650);
      if (window.lucide) window.lucide?.createIcons?.();

      // Preserve the convenient automatic OCR behavior without showing a failure
      // when the optional local OCR service is not running.
      checkMemoOcrServer().then((online) => {
        if (selectedMemoFile !== file) return;

        if (online) {
          serverOnlineForMemo = true;
          setMemoOcrStatus("OCR service detected. Extracting memorandum details...", "working");
          runMemoOcr(file);
        } else {
          setMemoOcrStatus("PDF ready. OCR service is offline; you can still save the memorandum.", "ready");
        }
      });

      return true;
    } catch (error) {
      console.error("PDF preparation error:", error);
      if (formPdfFile) formPdfFile.value = "";
      formExistingPdfBase64.value = "";
      selectedMemoFile = null;
      refreshMemoFileCard();
      setMemoUploadProgress(0, "Preparing document...", false);
      setMemoUploadStatus(error.message || "Failed to prepare the selected PDF.", "error");
      showToast(error.message || "Failed to prepare the selected PDF.", "error");
      return false;
    }
  }

  function resetForm() {
    memoForm.reset();
    memoDocId.value = "";
    modalFormTitle.textContent = "Issue Office Memorandum";
    formDate.value = new Date().toISOString().slice(0, 10);
    resetMemoAttachmentUi();
    setSaveMemoState(false, "Save Memorandum");
  }

  function setMemoFormModalOpen(isOpen) {
    if (!memoFormModal) return;

    memoFormModal.classList.toggle("open", isOpen);
    document.body.classList.toggle("memo-modal-open", isOpen);

    if (isOpen) {
      const scrollArea = memoFormModal.querySelector(".memo-form-body");
      if (scrollArea) scrollArea.scrollTop = 0;
      memoFormModal.setAttribute("aria-hidden", "false");
    } else {
      memoFormModal.setAttribute("aria-hidden", "true");
    }
  }

  if (openCreateModalBtn) {
    openCreateModalBtn.addEventListener("click", () => {
      resetForm();
      setMemoFormModalOpen(true);
      window.setTimeout(() => formControlNo?.focus(), 80);
    });
  }

  if (closeFormModalBtn) {
    closeFormModalBtn.addEventListener("click", () => setMemoFormModalOpen(false));
  }

  if (cancelFormModalBtn) {
    cancelFormModalBtn.addEventListener("click", () => setMemoFormModalOpen(false));
  }

  memoFormModal?.addEventListener("click", (event) => {
    if (event.target === memoFormModal) setMemoFormModalOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && memoFormModal?.classList.contains("open")) {
      setMemoFormModalOpen(false);
    }
  });

  function openEditModal(memo) {
    resetForm();
    modalFormTitle.textContent = "Update Office Memorandum";
    memoDocId.value = memo.id;
    formControlNo.value = memo.memoNo || "";
    formDate.value = memo.date || "";
    formAddressedTo.value = memo.addressedTo || "";
    formSubject.value = memo.subject || memo.title || "";
    formIssuedBy.value = memo.issuedBy || "";
    formRemarks.value = memo.remarks || "";
    formIsPinned.checked = Boolean(memo.isPinned);

    if (memo.pdfUrl) {
      formExistingPdfBase64.value = memo.pdfUrl;
      refreshMemoFileCard({
        name: memo.pdfFileName || "Attached_Document.pdf",
        meta: "Existing PDF attachment",
        existing: true
      });
      selectedMemoFile = null;
      if (runMemoOcrBtn) runMemoOcrBtn.disabled = true;
      setMemoUploadStatus("Existing PDF attachment loaded. Choose a new PDF to replace it.", "success");
      setMemoOcrStatus("Existing attachment loaded. Choose a new PDF to run OCR again.", "ready");
    }

    setSaveMemoState(false, "Update Memorandum");
    setMemoFormModalOpen(true);
    window.setTimeout(() => formControlNo?.focus(), 80);
  }

  if (formPdfFile) {
    formPdfFile.addEventListener("change", async (event) => {
      const file = event.target.files?.[0] || null;
      if (file) await acceptMemoPdf(file);
    });
  }

  if (fileDropzone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      fileDropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        fileDropzone.classList.add("drag-active");
      });
    });

    ["dragleave", "dragend"].forEach((eventName) => {
      fileDropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
        fileDropzone.classList.remove("drag-active");
      });
    });

    fileDropzone.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      fileDropzone.classList.remove("drag-active");

      const files = Array.from(event.dataTransfer?.files || []);
      const file = files[0] || null;

      if (!file) {
        setMemoUploadStatus("No file was dropped.", "error");
        return;
      }

      if (files.length > 1) {
        showToast("Only one memorandum PDF can be attached at a time.", "error");
      }

      await acceptMemoPdf(file);
    });

    fileDropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        formPdfFile?.click();
      }
    });
  }

  if (runMemoOcrBtn) {
    runMemoOcrBtn.addEventListener("click", async () => {
      if (!selectedMemoFile) {
        showToast("Choose a new memorandum PDF before running OCR.", "error");
        return;
      }
      await runMemoOcr(selectedMemoFile);
    });
  }

  if (previewSelectedPdfBtn) {
    previewSelectedPdfBtn.addEventListener("click", () => {
      const pdfUrl = formExistingPdfBase64?.value || "";
      if (!pdfUrl) {
        showToast("Attach a PDF before opening the preview.", "error");
        return;
      }

      if (viewPdfTitle) {
        viewPdfTitle.textContent = formControlNo.value.trim()
          ? `Directive ${formControlNo.value.trim()}`
          : "Memorandum Preview";
      }
      if (viewPdfSubtitle) viewPdfSubtitle.textContent = formSubject.value.trim() || "Unsaved PDF attachment";

      if (adminPdfFrame) {
        adminPdfFrame.src = pdfUrl;
        adminPdfFrame.style.display = "block";
      }
      adminNoPdfState?.classList.add("hidden");

      if (downloadPdfBtn) {
        downloadPdfBtn.href = pdfUrl;
        downloadPdfBtn.download = attachedFileName?.textContent || "Memorandum.pdf";
        downloadPdfBtn.style.display = "inline-flex";
      }

      viewPdfModal?.classList.add("open");
    });
  }

  if (removeAttachmentBtn) {
    removeAttachmentBtn.addEventListener("click", () => {
      resetMemoAttachmentUi();
      showToast("PDF attachment removed.");
    });
  }

  // Submit Handler
  if (memoForm) {
    memoForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!memoForm.checkValidity()) {
        memoForm.reportValidity();
        setMemoUploadStatus("Complete the required memorandum details before saving.", "error");
        showToast("Please complete all required memorandum fields.", "error");
        return;
      }

      const docId = memoDocId.value.trim();
      const normalizedControlNo = formControlNo.value.trim().toLowerCase();
      const duplicate = rawMemos.some((memo) =>
        String(memo.id) !== docId &&
        String(memo.memoNo || "").trim().toLowerCase() === normalizedControlNo
      );

      if (duplicate) {
        formControlNo.focus();
        showToast("That control number is already in the memorandum registry.", "error");
        return;
      }

      const hasPdf = Boolean(formExistingPdfBase64.value);
      const payload = {
        memoNo: formControlNo.value.trim(),
        date: formDate.value,
        addressedTo: formAddressedTo.value.trim(),
        subject: formSubject.value.trim(),
        title: formSubject.value.trim(),
        issuedBy: formIssuedBy.value.trim() || "PGENRO Management",
        remarks: formRemarks.value.trim() || "For Strict Compliance",
        isPinned: formIsPinned.checked,
        pdfUrl: hasPdf ? formExistingPdfBase64.value : "",
        pdfFileName: hasPdf ? (attachedFileName.textContent || "Memorandum.pdf") : "",
        updatedAt: new Date()
      };

      setSaveMemoState(true);

      try {
        if (supabaseStoreInitialized && db) {
          if (docId) {
            await db.collection("office_memos").doc(docId).update(payload);
            showToast("Memorandum updated successfully.");
          } else {
            payload.createdAt = supabaseStore.tableStore.FieldValue.serverTimestamp();
            await db.collection("office_memos").add(payload);
            showToast("Memorandum issued successfully.");
          }
        } else {
          // Local storage fallback
          if (docId) {
            const idx = rawMemos.findIndex((m) => m.id === docId);
            if (idx !== -1) rawMemos[idx] = { ...rawMemos[idx], ...payload };
            showToast("Memorandum updated in local records.");
          } else {
            rawMemos.unshift({
              id: "local-" + Date.now(),
              ...payload,
              createdAt: new Date()
            });
            showToast("Memorandum recorded locally.");
          }
          saveLocalMemos();
          applyFiltersAndRender();
          calculateKpis();
        }

        setMemoFormModalOpen(false);
      } catch (error) {
        console.error("Save error:", error);
        showToast(`Failed to save directive: ${error.message || "Unknown error"}`, "error");
      } finally {
        setSaveMemoState(false, docId ? "Update Memorandum" : "Save Memorandum");
      }
    });
  }

  // =========================================================================
  // 9. DELETE MODAL HANDLER
  // =========================================================================
  if (closeDeleteModalBtn) closeDeleteModalBtn.addEventListener("click", () => deleteConfirmModal.classList.remove("open"));
  if (cancelDeleteBtn) cancelDeleteBtn.addEventListener("click", () => deleteConfirmModal.classList.remove("open"));

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener("click", async () => {
      if (!deleteTargetId) return;

      try {
        if (supabaseStoreInitialized && db) {
          await db.collection("office_memos").doc(deleteTargetId).delete();
        } else {
          rawMemos = rawMemos.filter((m) => m.id !== deleteTargetId);
          saveLocalMemos();
          applyFiltersAndRender();
          calculateKpis();
        }
        showToast("Memorandum deleted permanently.");
      } catch (err) {
        console.error("Delete error:", err);
        showToast("Error deleting directive.", "error");
      } finally {
        deleteTargetId = null;
        deleteConfirmModal.classList.remove("open");
      }
    });
  }

  // =========================================================================
  // 10. PDF PREVIEW MODAL
  // =========================================================================
  function openPdfViewer(memo) {
    if (viewPdfTitle) viewPdfTitle.textContent = memo.memoNo ? `Directive ${memo.memoNo}` : "Directive Viewer";
    if (viewPdfSubtitle) viewPdfSubtitle.textContent = memo.subject || memo.title || "Office Directive";

    if (memo.pdfUrl && memo.pdfUrl.trim() !== "") {
      adminPdfFrame.src = memo.pdfUrl;
      adminPdfFrame.style.display = "block";
      adminNoPdfState.classList.add("hidden");
      downloadPdfBtn.href = memo.pdfUrl;
      downloadPdfBtn.style.display = "inline-flex";
    } else {
      adminPdfFrame.src = "";
      adminPdfFrame.style.display = "none";
      adminNoPdfState.classList.remove("hidden");
      downloadPdfBtn.style.display = "none";
    }

    viewPdfModal.classList.add("open");
  }

  if (closeViewPdfBtn) closeViewPdfBtn.addEventListener("click", () => viewPdfModal.classList.remove("open"));
  if (dismissViewPdfBtn) dismissViewPdfBtn.addEventListener("click", () => viewPdfModal.classList.remove("open"));

  // =========================================================================
  // 11. SEARCH, SHORTCUTS & SELECT ALL
  // =========================================================================
  if (tableFilterInput) tableFilterInput.addEventListener("input", applyFiltersAndRender);
  if (globalSearchInput) globalSearchInput.addEventListener("input", applyFiltersAndRender);
  if (pinnedFilterSelect) pinnedFilterSelect.addEventListener("change", applyFiltersAndRender);
  if (attachmentFilterSelect) attachmentFilterSelect.addEventListener("change", applyFiltersAndRender);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (tableFilterInput) tableFilterInput.focus();
    }
  });

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", (e) => {
      document.querySelectorAll(".row-checkbox").forEach((cb) => (cb.checked = e.target.checked));
    });
  }

  // =========================================================================
  // 12. EXPORT CSV
  // =========================================================================
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      if (rawMemos.length === 0) {
        alert("No memorandum records available to export.");
        return;
      }

      const headers = ["Control No", "Date", "Addressed To", "Subject", "Signatory", "Remarks", "Is Pinned", "Has PDF"];
      const rows = [headers.join(",")];

      rawMemos.forEach((m) => {
        const row = [
          `"${m.memoNo || ""}"`,
          `"${m.date || ""}"`,
          `"${(m.addressedTo || "").replace(/"/g, '""')}"`,
          `"${(m.subject || m.title || "").replace(/"/g, '""')}"`,
          `"${(m.issuedBy || "").replace(/"/g, '""')}"`,
          `"${(m.remarks || "").replace(/"/g, '""')}"`,
          `"${m.isPinned ? "Yes" : "No"}"`,
          `"${m.pdfUrl ? "Yes" : "No"}"`
        ];
        rows.push(row.join(","));
      });

      const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `PGENRO_Office_Memorandums_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("CSV Registry export generated.");
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initial Sync
  listenToMemos();
});

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
