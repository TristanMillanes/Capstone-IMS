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
// ==========================================================================
// PGENRO IMS - ACCOUNT ACCESS REQUESTS CONTROLLER (SUPABASE)
// Uses the shared Supabase data service during the Supabase-to-Supabase migration.
// ==========================================================================

const supabaseStore = window.PGENRO_SUPABASE_STORE || null;
const auth = supabaseStore?.auth?.() || null;
const db = supabaseStore?.realtimeStore?.() || null;
const supabase = window.pgenroSupabase;
const PGENRO_API = window.PGENRO_API;

const onAuthStateChanged = (authApi, callback) => authApi.onAuthStateChanged(callback);
const signOut = (authApi) => authApi.signOut();
const ref = (_db, path = "") => _db.ref(path);
const get = (reference) => reference.once("value");
const onValue = (reference, callback, errorCallback) => reference.on("value", callback, errorCallback);
const off = (reference) => reference.off();
const set = (reference, value) => reference.set(value);
const update = (reference, value) => reference.update(value);
const remove = (reference) => reference.remove();
const push = async (reference, value) => {
    const child = reference.push();
    if (value !== undefined) await child.set(value);
    return child;
};
const serverTimestamp = () => new Date().toISOString();

// --- GLOBAL STATE ---
let requestsData = [];
let selectedRequest = null;
let currentAdmin = null;
let requestsRef = null;

// --- DOM ELEMENTS ---
const requestTableBody = document.getElementById("requestTableBody");
const requestSearchInput = document.getElementById("requestSearchInput");
const divisionFilterSelect = document.getElementById("divisionFilterSelect");
const statusFilterSelect = document.getElementById("statusFilterSelect");
const selectAllCheckbox = document.getElementById("selectAllCheckbox");
const bulkApproveBtn = document.getElementById("bulkApproveBtn");
const bulkRejectBtn = document.getElementById("bulkRejectBtn");

// Modals
const reviewModal = document.getElementById("reviewModal");
const declineModal = document.getElementById("declineModal");
const systemConfirmModal = document.getElementById("systemConfirmModal");
const closeReviewModalBtn = document.getElementById("closeReviewModalBtn");
const closeDeclineModalBtn = document.getElementById("closeDeclineModalBtn");
const cancelDeclineModalBtn = document.getElementById("cancelDeclineModalBtn");

// Review Modal Fields
const reviewReqId = document.getElementById("reviewReqId");
const reviewDate = document.getElementById("reviewDate");
const reviewFullName = document.getElementById("reviewFullName");
const reviewEmail = document.getElementById("reviewEmail");
const reviewContact = document.getElementById("reviewContact");
const reviewGovId = document.getElementById("reviewGovId");
const reviewPosition = document.getElementById("reviewPosition");
const reviewDivision = document.getElementById("reviewDivision");
const reviewRole = document.getElementById("reviewRole");
const reviewEndorser = document.getElementById("reviewEndorser");
const reviewReason = document.getElementById("reviewReason");
const assignAccountTypeSelect = document.getElementById("assignAccountTypeSelect");
const assignRoleSelect = document.getElementById("assignRoleSelect");
const approveModalActionBtn = document.getElementById("approveModalActionBtn");
const declineModalActionBtn = document.getElementById("declineModalActionBtn");

// Decline Modal Fields
const declineReasonSelect = document.getElementById("declineReasonSelect");
const declineNotesInput = document.getElementById("declineNotesInput");
const confirmDeclineBtn = document.getElementById("confirmDeclineBtn");

// Custom Confirmation Dialog Elements
const confirmModalTitle = document.getElementById("confirmModalTitle");
const confirmModalDesc = document.getElementById("confirmModalDesc");
const confirmModalIconBox = document.getElementById("confirmModalIconBox");
const confirmModalCancelBtn = document.getElementById("confirmModalCancelBtn");
const confirmModalActionBtn = document.getElementById("confirmModalActionBtn");

// Topbar & Navigation Elements
const profileBtn = document.getElementById("profileBtn");
const profileDropdown = document.getElementById("profileDropdown");
const notificationsBtn = document.getElementById("notificationsBtn");
const notificationDropdown = document.getElementById("notificationDropdown");
const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const sidebar = document.getElementById("sidebar");
const sidebarCollapseBtn = document.getElementById("sidebarCollapseBtn");
const logoutBtn = document.getElementById("logoutBtn");
const globalSearchInput = document.getElementById("globalSearchInput");

// KPI Counters
const statPendingCount = document.getElementById("statPendingCount");
const statApprovedCount = document.getElementById("statApprovedCount");
const statRejectedCount = document.getElementById("statRejectedCount");
const statTotalCount = document.getElementById("statTotalCount");
const sidebarPendingAccBadge = document.getElementById("sidebarPendingAccBadge");
const notifBadgeCount = document.getElementById("notifBadgeCount");
const notifPing = document.getElementById("notifPing");
const notificationList = document.getElementById("notificationList");

// Database Status Indicator
const dbStatusDot = document.getElementById("dbStatusDot");
const dbStatusText = document.getElementById("dbStatusText");

// Toast
const toast = document.getElementById("toast");
const toastMessage = document.getElementById("toastMessage");

// ==========================================================================
// CUSTOM SYSTEM CONFIRMATION MODAL HELPER
// ==========================================================================
function showCustomConfirm({
    title = "Confirm Action",
    message = "Are you sure you want to proceed?",
    confirmText = "Confirm",
    cancelText = "Cancel",
    type = "danger", // 'danger' | 'primary' | 'warning'
    icon = "alert-triangle"
} = {}) {
    return new Promise((resolve) => {
        if (!systemConfirmModal) {
            resolve(confirm(message));
            return;
        }

        if (confirmModalTitle) confirmModalTitle.textContent = title;
        if (confirmModalDesc) confirmModalDesc.textContent = message;
        if (confirmModalCancelBtn) confirmModalCancelBtn.textContent = cancelText;

        if (confirmModalActionBtn) {
            confirmModalActionBtn.textContent = confirmText;
            confirmModalActionBtn.className = `btn btn-${type === 'danger' ? 'danger' : 'primary'}`;
        }

        if (confirmModalIconBox) {
            confirmModalIconBox.className = `confirm-icon-box ${type}`;
            confirmModalIconBox.innerHTML = `<i data-lucide="${icon}"></i>`;
        }

        renderIcons();
        systemConfirmModal.classList.add("open");

        const cleanup = (result) => {
            systemConfirmModal.classList.remove("open");
            confirmModalCancelBtn.onclick = null;
            confirmModalActionBtn.onclick = null;
            resolve(result);
        };

        if (confirmModalCancelBtn) confirmModalCancelBtn.onclick = () => cleanup(false);
        if (confirmModalActionBtn) confirmModalActionBtn.onclick = () => cleanup(true);

        systemConfirmModal.onclick = (e) => {
            if (e.target === systemConfirmModal) cleanup(false);
        };
    });
}

// ==========================================================================
// INITIALIZATION
// ==========================================================================
document.addEventListener("DOMContentLoaded", async () => {
    renderIcons();
    setupUIInteractions();
    setupEventListeners();
    monitorDatabaseConnection();

    try {
        if (!supabase || window.PGENRO_SUPABASE?.configured === false) {
            throw new Error("Supabase is not configured. Add the Publishable/Anon key in shared/supabase.js.");
        }

        const profile = await PGENRO_API.requireAdmin();
        currentAdmin = {
            uid: profile.user_id,
            email: profile.email || profile.authUser?.email || "",
            name: profile.full_name || profile.username || profile.authUser?.email?.split("@")[0] || "PGENRO Admin",
            role: profile.role || "Super Admin"
        };

        updateAdminProfileUI(currentAdmin);
        listenToRealtimeRequests();
    } catch (err) {
        console.warn("Admin authorization failed:", err);
        try { await supabase?.auth?.signOut(); } catch {}
        window.location.href = "../User/login.html";
    }
});

// ==========================================================================
// MONITOR SUPABASE REALTIME CONNECTION
// ==========================================================================
function monitorDatabaseConnection() {
    if (!db) {
        if (dbStatusDot) dbStatusDot.className = "status-dot offline";
        if (dbStatusText) dbStatusText.textContent = "Service unavailable";
        return;
    }
    const connectedRef = ref(db, ".info/connected");
    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            console.log("🟢 Supabase Realtime: Connected Successfully");
            if (dbStatusDot) dbStatusDot.className = "status-dot online";
            if (dbStatusText) dbStatusText.textContent = "Live Synchronized";
        } else {
            if (dbStatusDot) dbStatusDot.className = "status-dot offline";
            if (dbStatusText) dbStatusText.textContent = "Loading System...";
        }
    });
}

// ==========================================================================
// REALTIME DATABASE LISTENER (access_requests)
// ==========================================================================
function listenToRealtimeRequests() {
    if (!db) {
        requestsData = [];
        filterAndRender();
        return;
    }
    if (requestsRef) off(requestsRef);

    requestsRef = ref(db, "access_requests");

    onValue(requestsRef, (snapshot) => {
        requestsData = [];
        if (snapshot.exists()) {
            const data = snapshot.val();
            Object.keys(data).forEach((key) => {
                const item = data[key];
                if (item && typeof item === "object") {
                    requestsData.push({
                        ...item,
                        key: key, // Unique database key (e.g. -Nx...)
                        id: item.id || item.refCode || key // Display Ref Code
                    });
                }
            });
            // Sort: Pending first, then newest timestamp
            requestsData.sort((a, b) => {
                const isPendingA = (a.status || "").toLowerCase() === "pending" ? 1 : 0;
                const isPendingB = (b.status || "").toLowerCase() === "pending" ? 1 : 0;
                if (isPendingA !== isPendingB) return isPendingB - isPendingA;

                const timeA = a.timestamp || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
                const timeB = b.timestamp || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
                return timeB - timeA;
            });
        }
        filterAndRender();
        updateNotificationsUI();
    }, (error) => {
        console.error("🔴 Database Error:", error);
        if (error.code === "PERMISSION_DENIED" || error.message.includes("PERMISSION_DENIED")) {
            showToast("Database Permission Denied: Ensure current account is listed in /admins.");
            if (dbStatusText) dbStatusText.textContent = "Permission Denied";
            if (dbStatusDot) dbStatusDot.className = "status-dot offline";
        } else {
            showToast("Failed to connect to Supabase Realtime Database.");
        }
        filterAndRender();
    });
}

// ==========================================================================
// RENDER TABLE & DATA
// ==========================================================================
function renderTable(data = requestsData) {
    if (!requestTableBody) return;
    requestTableBody.innerHTML = "";

    if (data.length === 0) {
        requestTableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: #64748b;">
                    <i data-lucide="inbox" style="width: 36px; height: 36px; margin: 0 auto 8px auto; display: block; stroke-width: 1.5; color: #94a3b8;"></i>
                    <p style="font-weight: 700; color: #334155;">No account requests found</p>
                    <small style="color: #64748b;">New registration requests and approval history will appear here.</small>
                </td>
            </tr>
        `;
        renderIcons();
        updateKPICounters();
        return;
    }

    data.forEach((req) => {
        const initials = (req.fullName || req.name || "User")
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
            .toUpperCase();

        const rawStatus = req.status || "Pending";
        const statusLower = rawStatus.toLowerCase();
        
        let formattedDate = req.date || "Recent";
        if (req.timestamp && typeof req.timestamp === "number") {
            formattedDate = new Date(req.timestamp).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            });
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><input type="checkbox" class="row-checkbox" data-key="${escapeHTML(req.key)}" /></td>
            <td>
                <strong class="font-mono" style="color: #0f172a; font-weight: 700;">${escapeHTML(req.id)}</strong><br>
                <small class="text-muted" style="font-size: 11px;">${escapeHTML(formattedDate)}</small>
            </td>
            <td>
                <div class="user-cell" style="display: flex; align-items: center; gap: 10px;">
                    <div class="avatar-circle ${getAvatarColor(req.role)}">${initials}</div>
                    <div>
                        <strong>${escapeHTML(req.fullName || req.name || 'N/A')}</strong>
                        <small style="display: block; color: #64748b; font-size: 11px;">${escapeHTML(req.email || '')}</small>
                    </div>
                </div>
            </td>
            <td><span class="division-tag">${escapeHTML(req.division || 'Unassigned')}</span></td>
            <td>
                <span class="role-badge-pill">
                    <i data-lucide="${req.role?.includes('Admin') ? 'shield-alert' : 'shield'}" style="width: 12px; height: 12px;"></i>
                    ${escapeHTML(req.role || 'System Staff')}
                </span>
            </td>
            <td>
                ${(req.endorser && req.endorser !== 'N/A') || req.isEndorsed 
                    ? `<span class="endorsement-badge"><i data-lucide="file-check-2"></i> Verified</span>`
                    : `<span class="text-muted" style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="clock" style="width: 12px; height: 12px;"></i> For Review</span>`
                }
            </td>
            <td>
                <span class="status-badge-dot ${statusLower}">
                    <span class="dot"></span> ${escapeHTML(rawStatus)}
                </span>
            </td>
            <td style="text-align: right;">
                <div class="action-buttons">
                    <button class="btn-icon-action review-btn" data-key="${escapeHTML(req.key)}" title="Review Details & Privileges">
                        <i data-lucide="eye"></i>
                    </button>
                    ${statusLower === 'pending' ? `
                        <button class="btn-icon-action approve approve-quick-btn" data-key="${escapeHTML(req.key)}" title="Approve Request">
                            <i data-lucide="user-check"></i>
                        </button>
                        <button class="btn-icon-action reject reject-quick-btn" data-key="${escapeHTML(req.key)}" title="Decline Request">
                            <i data-lucide="user-x"></i>
                        </button>
                    ` : `
                        <button class="btn-icon-action delete delete-req-btn" data-key="${escapeHTML(req.key)}" title="Delete Request from Database">
                            <i data-lucide="trash-2"></i>
                        </button>
                    `}
                </div>
            </td>
        `;
        requestTableBody.appendChild(tr);
    });

    renderIcons();
    attachRowActions();
    updateKPICounters();
}

// ==========================================================================
// FILTERS & SEARCH
// ==========================================================================
function filterAndRender() {
    const searchTerm = (requestSearchInput?.value || globalSearchInput?.value || "").toLowerCase().trim();
    const selectedDivision = divisionFilterSelect?.value || "ALL";
    const selectedStatus = (statusFilterSelect?.value || "ALL").toLowerCase();

    const filtered = requestsData.filter((req) => {
        const name = (req.fullName || req.name || "").toLowerCase();
        const email = (req.email || "").toLowerCase();
        const id = (req.id || req.refCode || "").toLowerCase();
        const position = (req.position || "").toLowerCase();
        const reqStatus = (req.status || "Pending").toLowerCase();

        const matchesSearch = name.includes(searchTerm) || email.includes(searchTerm) || id.includes(searchTerm) || position.includes(searchTerm);
        const matchesDivision = (selectedDivision === "ALL") || (req.division === selectedDivision);
        const matchesStatus = (selectedStatus === "all") || (reqStatus === selectedStatus);

        return matchesSearch && matchesDivision && matchesStatus;
    });

    renderTable(filtered);

    const rangeText = document.getElementById("tableRangeText");
    if (rangeText) {
        rangeText.textContent = `Showing ${filtered.length} of ${requestsData.length} access requests`;
    }
}

// ==========================================================================
// KPI & NOTIFICATIONS UI
// ==========================================================================
function updateKPICounters() {
    const pending = requestsData.filter((r) => (r.status || "").toLowerCase() === "pending").length;
    const approved = requestsData.filter((r) => (r.status || "").toLowerCase() === "approved").length;
    const rejected = requestsData.filter((r) => (r.status || "").toLowerCase() === "rejected").length;

    if (statPendingCount) statPendingCount.textContent = pending;
    if (statApprovedCount) statApprovedCount.textContent = approved;
    if (statRejectedCount) statRejectedCount.textContent = rejected;
    if (statTotalCount) statTotalCount.textContent = requestsData.length;

    if (sidebarPendingAccBadge) {
        sidebarPendingAccBadge.textContent = `${pending} New`;
        sidebarPendingAccBadge.style.display = pending > 0 ? "inline-block" : "none";
    }
}

function updateNotificationsUI() {
    const pendingRequests = requestsData.filter((r) => (r.status || "").toLowerCase() === "pending");
    
    if (notifBadgeCount) notifBadgeCount.textContent = `${pendingRequests.length} Requests`;
    if (notifPing) notifPing.style.display = pendingRequests.length > 0 ? "block" : "none";

    if (notificationList) {
        if (pendingRequests.length === 0) {
            notificationList.innerHTML = `<div class="notif-item" style="padding: 12px; color: #64748b; font-size: 12px;">No pending account requests.</div>`;
        } else {
            notificationList.innerHTML = pendingRequests.slice(0, 5).map(req => `
                <div class="notif-item" style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; cursor: pointer;" data-key="${escapeHTML(req.key)}">
                    <strong style="display: block; font-size: 12px; color: #0f172a;">${escapeHTML(req.fullName || req.name || 'New User')}</strong>
                    <small style="color: #64748b; font-size: 11px;">Requested ${escapeHTML(req.role || 'Staff')} access for ${escapeHTML(req.division || 'Office')}</small>
                </div>
            `).join("");

            notificationList.querySelectorAll(".notif-item").forEach(item => {
                item.addEventListener("click", () => {
                    const key = item.getAttribute("data-key");
                    if (key) openReviewModal(key);
                    if (notificationDropdown) notificationDropdown.style.display = "none";
                });
            });
        }
    }
}

// ==========================================================================
// MODAL LOGIC (USER VS ADMIN SELECTION)
// ==========================================================================
function openReviewModal(requestKey) {
    selectedRequest = requestsData.find((r) => r.key === requestKey || r.id === requestKey);
    if (!selectedRequest) return;

    if (reviewReqId) reviewReqId.textContent = selectedRequest.id || selectedRequest.refCode || selectedRequest.key;
    if (reviewDate) reviewDate.textContent = selectedRequest.date || "Recent";
    if (reviewFullName) reviewFullName.textContent = selectedRequest.fullName || selectedRequest.name || "N/A";
    if (reviewEmail) reviewEmail.textContent = selectedRequest.email || "N/A";
    if (reviewContact) reviewContact.textContent = selectedRequest.contact || "N/A";
    if (reviewGovId) reviewGovId.textContent = "Account Authentication";
    if (reviewPosition) reviewPosition.textContent = selectedRequest.position || "N/A";
    if (reviewDivision) reviewDivision.textContent = selectedRequest.division || "Unassigned";
    if (reviewRole) reviewRole.textContent = selectedRequest.role || "System Staff";
    if (reviewEndorser) reviewEndorser.textContent = selectedRequest.endorser || "None Provided";
    if (reviewReason) reviewReason.textContent = selectedRequest.reason || "None Provided";

    const requestedRole = selectedRequest.role || "System Staff";
    const normalizedRequestedRole = requestedRole === "User" ? "System Staff" : requestedRole;
    const isRequestedAdmin = normalizedRequestedRole.includes("Admin");

    if (assignAccountTypeSelect) {
        assignAccountTypeSelect.value = isRequestedAdmin ? "ADMIN" : "USER";
        updateRoleOptionsByAccountType(assignAccountTypeSelect.value);
    }

    if (assignRoleSelect) {
        assignRoleSelect.value = normalizedRequestedRole;
    }

    reviewModal?.classList.add("open");
    renderIcons();
}

function updateRoleOptionsByAccountType(accountType) {
    if (!assignRoleSelect) return;
    
    if (accountType === "ADMIN") {
        assignRoleSelect.innerHTML = `
            <option value="Super Admin">Super Admin (Full Database & User Control)</option>
            <option value="Admin">System Administrator (Administrative Module Access)</option>
        `;
    } else {
        assignRoleSelect.innerHTML = `
            <option value="System Staff">System Staff (Standard IMS Data Entry)</option>
            <option value="Division Head">Division Head (Document Signatory & Approver)</option>
            <option value="Viewer">Read-Only Viewer (View Office Records Only)</option>
        `;
    }
}

function openDeclineModal(requestKey) {
    selectedRequest = requestsData.find((r) => r.key === requestKey || r.id === requestKey);
    if (!selectedRequest) return;

    if (declineNotesInput) declineNotesInput.value = "";
    declineModal?.classList.add("open");
    renderIcons();
}

function closeAllModals() {
    reviewModal?.classList.remove("open");
    declineModal?.classList.remove("open");
    systemConfirmModal?.classList.remove("open");
}

// ==========================================================================
// DATABASE WRITE OPERATIONS
// ==========================================================================
async function grantAccountAccess(requestObj, confirmedRole, accountType = "USER") {
    const rawRoleToAssign = confirmedRole || requestObj.role || "System Staff";
    const roleToAssign = rawRoleToAssign === "User" ? "System Staff" : rawRoleToAssign;
    const targetKey = requestObj.key || requestObj.id;

    try {
        if (!PGENRO_API?.invokeAdmin) {
            throw new Error("Supabase administrator service is unavailable.");
        }

        await PGENRO_API.invokeAdmin("approve_request", {
            requestId: targetKey,
            userId: requestObj.uid || "",
            role: roleToAssign,
            accountType
        });

        showToast(`Access granted: ${requestObj.fullName || requestObj.name} approved as ${roleToAssign}`);
    } catch (err) {
        console.error("Supabase approval error:", err);
        showToast(`Failed to approve: ${err.message}`);
    }

    closeAllModals();
}

async function declineAccountAccess(requestObj, reason, remarks) {
    const targetKey = requestObj.key || requestObj.id;

    try {
        if (!PGENRO_API?.invokeAdmin) {
            throw new Error("Supabase administrator service is unavailable.");
        }

        await PGENRO_API.invokeAdmin("reject_request", {
            requestId: targetKey,
            userId: requestObj.uid || "",
            reason,
            remarks: remarks || ""
        });

        showToast(`Request for ${requestObj.fullName || requestObj.name} declined.`);
    } catch (err) {
        console.error("Supabase decline error:", err);
        showToast(`Failed to decline: ${err.message}`);
    }

    closeAllModals();
}

// Custom Deletion with System Confirm Dialog
async function deleteAccountRequest(requestKey) {
    const confirmed = await showCustomConfirm({
        title: "Delete Access Request",
        message: "Are you sure you want to permanently delete this request record from the database? This action cannot be undone.",
        confirmText: "Delete Record",
        cancelText: "Cancel",
        type: "danger",
        icon: "trash-2"
    });

    if (!confirmed) return;

    try {
        if (!db) throw new Error("Supabase is not connected.");
        await remove(ref(db, `access_requests/${requestKey}`));
        showToast("Request record removed from database.");
    } catch (err) {
        console.error("Delete Error:", err);
        showToast(`Failed to delete record: ${err.message}`);
    }
}

// ==========================================================================
// ATTACH ROW ACTIONS & EVENT LISTENERS
// ==========================================================================
function attachRowActions() {
    document.querySelectorAll(".review-btn").forEach((btn) => {
        btn.addEventListener("click", () => openReviewModal(btn.getAttribute("data-key")));
    });

    document.querySelectorAll(".approve-quick-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const key = btn.getAttribute("data-key");
            const req = requestsData.find((r) => r.key === key || r.id === key);
            if (!req) return;

            const confirmed = await showCustomConfirm({
                title: "Grant Account Access",
                message: `Are you sure you want to approve access for ${req.fullName || req.name} as ${req.role || 'Staff'}?`,
                confirmText: "Grant Access",
                cancelText: "Cancel",
                type: "primary",
                icon: "user-check"
            });

            if (confirmed) {
                const isAdmin = (req.role || "").includes("Admin");
                grantAccountAccess(req, req.role, isAdmin ? "ADMIN" : "USER");
            }
        });
    });

    document.querySelectorAll(".reject-quick-btn").forEach((btn) => {
        btn.addEventListener("click", () => openDeclineModal(btn.getAttribute("data-key")));
    });

    document.querySelectorAll(".delete-req-btn").forEach((btn) => {
        btn.addEventListener("click", () => deleteAccountRequest(btn.getAttribute("data-key")));
    });

    document.querySelectorAll(".row-checkbox").forEach((cb) => {
        cb.addEventListener("change", updateBulkActionButtons);
    });
}

function updateBulkActionButtons() {
    const checkedCount = document.querySelectorAll(".row-checkbox:checked").length;
    if (bulkApproveBtn) bulkApproveBtn.disabled = checkedCount === 0;
    if (bulkRejectBtn) bulkRejectBtn.disabled = checkedCount === 0;
}

function setupEventListeners() {
    requestSearchInput?.addEventListener("input", filterAndRender);
    globalSearchInput?.addEventListener("input", filterAndRender);
    divisionFilterSelect?.addEventListener("change", filterAndRender);
    statusFilterSelect?.addEventListener("change", filterAndRender);

    assignAccountTypeSelect?.addEventListener("change", (e) => {
        updateRoleOptionsByAccountType(e.target.value);
    });

    selectAllCheckbox?.addEventListener("change", (e) => {
        document.querySelectorAll(".row-checkbox").forEach((cb) => {
            cb.checked = e.target.checked;
        });
        updateBulkActionButtons();
    });

    bulkApproveBtn?.addEventListener("click", async () => {
        const checked = Array.from(document.querySelectorAll(".row-checkbox:checked"));
        if (checked.length === 0) return;

        const confirmed = await showCustomConfirm({
            title: "Bulk Approve Requests",
            message: `Are you sure you want to approve all ${checked.length} selected access request(s)?`,
            confirmText: "Approve All",
            cancelText: "Cancel",
            type: "primary",
            icon: "check-circle-2"
        });

        if (confirmed) {
            for (const cb of checked) {
                const key = cb.getAttribute("data-key");
                const req = requestsData.find((r) => r.key === key || r.id === key);
                if (req) {
                    const isAdmin = (req.role || "").includes("Admin");
                    await grantAccountAccess(req, req.role, isAdmin ? "ADMIN" : "USER");
                }
            }
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            updateBulkActionButtons();
        }
    });

    bulkRejectBtn?.addEventListener("click", async () => {
        const checked = Array.from(document.querySelectorAll(".row-checkbox:checked"));
        if (checked.length === 0) return;

        const confirmed = await showCustomConfirm({
            title: "Bulk Decline Requests",
            message: `Are you sure you want to decline all ${checked.length} selected request(s)?`,
            confirmText: "Decline All",
            cancelText: "Cancel",
            type: "danger",
            icon: "user-x"
        });

        if (confirmed) {
            for (const cb of checked) {
                const key = cb.getAttribute("data-key");
                const req = requestsData.find((r) => r.key === key || r.id === key);
                if (req) await declineAccountAccess(req, "Declined via Bulk Review", "Bulk decline action by admin");
            }
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            updateBulkActionButtons();
        }
    });

    closeReviewModalBtn?.addEventListener("click", closeAllModals);
    closeDeclineModalBtn?.addEventListener("click", closeAllModals);
    cancelDeclineModalBtn?.addEventListener("click", closeAllModals);

    approveModalActionBtn?.addEventListener("click", () => {
        if (!selectedRequest) return;
        const accountType = assignAccountTypeSelect?.value || "USER";
        const role = assignRoleSelect?.value || selectedRequest.role;
        grantAccountAccess(selectedRequest, role, accountType);
    });

    declineModalActionBtn?.addEventListener("click", () => {
        reviewModal?.classList.remove("open");
        declineModal?.classList.add("open");
    });

    confirmDeclineBtn?.addEventListener("click", () => {
        if (!selectedRequest) return;
        const reason = declineReasonSelect?.value || "Unverified credentials";
        const notes = declineNotesInput?.value || "";
        declineAccountAccess(selectedRequest, reason, notes);
    });
}

function setupUIInteractions() {
    // Shared admin navigation/profile/logout behavior is owned by the page-owned admin shell below.
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            (requestSearchInput || globalSearchInput)?.focus();
        }
    });
}

function updateAdminProfileUI(admin) {
    const userNameEl = document.getElementById("currentUserName");
    const userRoleEl = document.getElementById("currentUserRole");
    const dropdownNameEl = document.getElementById("dropdownUserName");
    const dropdownEmailEl = document.getElementById("dropdownUserEmail");
    const dropdownRoleEl = document.getElementById("dropdownUserRole");

    if (userNameEl) userNameEl.textContent = admin.name;
    if (userRoleEl) userRoleEl.textContent = admin.role || "Super Admin";
    if (dropdownNameEl) dropdownNameEl.textContent = admin.name;
    if (dropdownEmailEl) dropdownEmailEl.textContent = admin.email;
    if (dropdownRoleEl) dropdownRoleEl.textContent = admin.role || "Super Admin";
}

// ==========================================================================
// UTILITY FUNCTIONS
// ==========================================================================
function renderIcons() {
    if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
        window.lucide?.createIcons?.();
    }
}

function showToast(msg) {
    if (!toast || !toastMessage) return;
    toastMessage.textContent = msg;
    toast.classList.add("show");
    renderIcons();
    setTimeout(() => toast.classList.remove("show"), 3500);
}

function getAvatarColor(role) {
    if (role === "Super Admin" || role === "Admin") return "purple";
    if (role === "Division Head") return "blue";
    return "emerald";
}

function escapeHTML(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

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
