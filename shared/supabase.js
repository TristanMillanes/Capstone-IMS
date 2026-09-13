/**
 * PGENRO IMS - ONE SHARED SUPABASE CLIENT
 * Project: zssrxubajhqryrwijyzm | Region: ap-southeast-1
 * --------------------------------------------------------------------------
 * This is the ONLY project-side Supabase bootstrap file used by the frontend.
 * The Supabase CDN still provides the official @supabase/supabase-js library.
 *
 * IMPORTANT:
 * Paste ONLY the browser-safe Publishable/Anon key below.
 * NEVER place a service_role / secret key in this file.
 */
(function () {
  "use strict";

  const CONFIG = Object.freeze({
    projectRef: "zssrxubajhqryrwijyzm",
    region: "ap-southeast-1",
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP"
  });

  const keyLooksConfigured =
    !!CONFIG.publishableKey &&
    !CONFIG.publishableKey.includes("PASTE_YOUR") &&
    !CONFIG.publishableKey.includes("YOUR_SUPABASE");

  const sdkReady = !!window.supabase?.createClient;
  const configured = sdkReady && keyLooksConfigured;

  window.PGENRO_SUPABASE = Object.freeze({ ...CONFIG, sdkReady, configured });

  if (!sdkReady) {
    console.error("PGENRO IMS: @supabase/supabase-js was not loaded.");
    window.pgenroSupabase = null;
    return;
  }

  const client = configured
    ? window.supabase.createClient(CONFIG.url, CONFIG.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      })
    : null;

  window.pgenroSupabase = client;

  if (!configured) {
    console.warn(
      "PGENRO IMS: Supabase project URL is set, but the Publishable/Anon key is still missing. " +
      "Edit shared/supabase.js and paste the browser-safe key."
    );
  }

  const ADMIN_ROLES = new Set([
    "admin",
    "administrator",
    "super admin",
    "superadmin",
    "system administrator"
  ]);

  const normalizeRole = (value) =>
    String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

  const nowIso = () => new Date().toISOString();
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const normalizePath = (path = "") => String(path).replace(/^\/+|\/+$/g, "");
  const pathParts = (path = "") => normalizePath(path).split("/").filter(Boolean);

  function requireClient() {
    if (!client) {
      throw new Error(
        "Supabase is not configured. Paste your Publishable/Anon key in shared/supabase.js."
      );
    }
    return client;
  }

  async function getCurrentProfile() {
    const sb = requireClient();
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError) throw userError;
    if (!user) return null;

    const { data: profile, error } = await sb
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    return profile ? { ...profile, authUser: user } : null;
  }

  async function requireApprovedUser() {
    const profile = await getCurrentProfile();
    if (!profile) throw new Error("No PGENRO personnel profile was found.");
    const status = String(profile.status || "").toLowerCase();
    if (!profile.is_active || !["active", "approved"].includes(status)) {
      throw new Error(`Account access is ${profile.status || "not active"}.`);
    }
    return profile;
  }

  async function requireAdmin() {
    const profile = await requireApprovedUser();
    if (!ADMIN_ROLES.has(normalizeRole(profile.role))) {
      throw new Error("Administrator permission is required.");
    }
    return profile;
  }

  async function invokeAdmin(action, payload = {}) {
    const sb = requireClient();
    const { data, error } = await sb.functions.invoke("admin-users", {
      body: { action, ...payload }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function testConnection() {
    if (!client || !configured) {
      return { ok: false, message: "Supabase client is not configured." };
    }

    try {
      const { data, error } = await client.rpc("pgenro_healthcheck");
      if (error) throw error;
      return {
        ok: data?.ok !== false,
        message: "Connected to Supabase and the PGENRO database schema is reachable.",
        data
      };
    } catch (error) {
      return {
        ok: false,
        message: error?.message || "Supabase database health check failed.",
        error
      };
    }
  }

  window.PGENRO_API = Object.freeze({
    config: CONFIG,
    get client() { return client; },
    getCurrentProfile,
    requireApprovedUser,
    requireAdmin,
    invokeAdmin,
    testConnection,
    isAdminRole: (role) => ADMIN_ROLES.has(normalizeRole(role))
  });

  // Visitors Log compatibility facade. Older visitor controllers referenced
  // PGENRO_DB; it now points to the SAME shared Supabase client/session used by
  // every other IMS page. No second client is created.
  window.PGENRO_DB = Object.freeze({
    client,
    table: "visitors",
    profilesTable: "profiles",
    configured,
    async getSession() {
      const { data, error } = await requireClient().auth.getSession();
      if (error) throw error;
      return data.session || null;
    },
    async getCurrentRole() {
      const profile = await getCurrentProfile();
      if (!profile) return null;
      const active = profile.is_active === true &&
        ["active", "approved"].includes(String(profile.status || "").trim().toLowerCase());
      if (!active) return null;
      return ADMIN_ROLES.has(normalizeRole(profile.role)) ? "admin" : "user";
    }
  });

  // ------------------------------------------------------------------------
  // Shared route guard + session termination
  // ------------------------------------------------------------------------
  async function syncBrowserProfile(profile) {
    if (!profile) return;
    const name = profile.full_name || profile.username || 'PGENRO Officer';
    const role = profile.role || 'Staff';
    const email = profile.email || profile.authUser?.email || '';
    const fields = {currentUserName:name, dropdownUserName:name, currentUserRole:role, dropdownUserRole:role, dropdownUserEmail:email, adminName:name};
    Object.entries(fields).forEach(([id, value]) => { const el=document.getElementById(id); if (el) el.textContent=value; });
    document.querySelectorAll('.profile-dropdown-header h3').forEach(el => el.textContent=name);
    if (document.body?.dataset.requiresAuth === 'admin') document.documentElement.dataset.adminAuth='verified';

    try {
      localStorage.setItem("pgenro_current_user", JSON.stringify({
        uid: profile.user_id,
        id: profile.user_id,
        fullName: profile.full_name || profile.username || "",
        username: profile.username || "",
        email: profile.email || profile.authUser?.email || "",
        contact: profile.contact || "",
        position: profile.position || "",
        division: profile.division || "",
        role: profile.role || "System Staff",
        accountType: profile.account_type || "Standard User",
        status: profile.status || "Active"
      }));
      sessionStorage.setItem("pgenro_session_active", "true");
      sessionStorage.setItem("pgenro_session_token", String(profile.user_id));
    } catch {}
  }

  async function endSessionAndRedirect() {
    try { if (client) await client.auth.signOut(); } catch {}
    try {
      localStorage.removeItem("pgenro_current_user");
      sessionStorage.removeItem("pgenro_session_active");
      sessionStorage.removeItem("pgenro_session_token");
    } catch {}
    const loginUrl = new URL("../User/login.html", window.location.href);
    window.location.replace(loginUrl.href);
  }

  async function applyRouteGuard() {
    const mode = document.body?.dataset?.requiresAuth;
    if (!mode) return;

    if (!client) {
      console.error("Protected page cannot initialize because Supabase is not configured.");
      return;
    }

    try {
      const profile = mode === "admin"
        ? await requireAdmin()
        : await requireApprovedUser();

      await syncBrowserProfile(profile);

      // Live authorization watch. If an administrator suspends/deactivates this
      // account, the next profile event closes the active browser session.
      const userId = profile.user_id;
      client
        .channel(`authz-watch-${userId}-${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `user_id=eq.${userId}`
          },
          async (payload) => {
            const next = payload.new || {};
            const nextActive = next.is_active === true &&
              ["active", "approved"].includes(String(next.status || "").toLowerCase());
            const nextAdmin = ADMIN_ROLES.has(normalizeRole(next.role));

            if (!nextActive || (mode === "admin" && !nextAdmin)) {
              await endSessionAndRedirect();
            } else {
              await syncBrowserProfile(next);
            }
          }
        )
        .subscribe();
    } catch (error) {
      console.warn("PGENRO route authorization denied:", error);
      await endSessionAndRedirect();
    }
  }

  document.addEventListener("click", async (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("#logoutBtn,[data-pgenro-logout]")
      : null;
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    await endSessionAndRedirect();
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyRouteGuard, { once: true });
  } else {
    queueMicrotask(applyRouteGuard);
  }

  // ------------------------------------------------------------------------
  // Legacy API adapter
  // ------------------------------------------------------------------------
  // A few existing modules were originally written with Supabase-style
  // database calls. This adapter keeps those screens working, but every read,
  // write and realtime subscription below is backed by Supabase/Postgres.
  // No Supabase SDK or Supabase network connection is used.
  const ALLOWED_TABLES = new Set([
    "profiles", "users", "admins", "access_requests", "service_requests",
    "visitors", "admin_logs", "audit_logs", "office_memos", "communications",
    "ics_records", "employees", "inventory", "inventory_movements",
    "travel_orders"
  ]);

  function assertConfigured() {
    requireClient();
  }

  function assertTable(table) {
    if (!ALLOWED_TABLES.has(table)) {
      throw new Error(`Unsupported Supabase table: ${table}`);
    }
  }

  async function listRows(table) {
    assertConfigured();
    assertTable(table);

    if (table === "profiles") {
      const { data, error } = await client.from(table).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    }

    const { data, error } = await client
      .from(table)
      .select("id,data,created_at,updated_at")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map((row) => ({
      id: String(row.id),
      ...(clone(row.data) || {}),
      createdAt: row.data?.createdAt ?? row.created_at,
      updatedAt: row.data?.updatedAt ?? row.updated_at
    }));
  }

  async function getRow(table, id) {
    assertConfigured();
    assertTable(table);

    if (table === "profiles") {
      const { data, error } = await client
        .from(table)
        .select("*")
        .eq("user_id", String(id))
        .maybeSingle();
      if (error) throw error;
      return data || null;
    }

    const { data, error } = await client
      .from(table)
      .select("id,data,created_at,updated_at")
      .eq("id", String(id))
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return {
      id: String(data.id),
      ...(clone(data.data) || {}),
      createdAt: data.data?.createdAt ?? data.created_at,
      updatedAt: data.data?.updatedAt ?? data.updated_at
    };
  }

  async function upsertRow(table, id, payload, merge = true) {
    assertConfigured();
    assertTable(table);

    if (table === "profiles") {
      const row = { ...(merge ? (await getRow(table, id) || {}) : {}), ...clone(payload), user_id: String(id) };
      delete row.authUser;
      const { error } = await client.from(table).upsert(row, { onConflict: "user_id" });
      if (error) throw error;
      return String(id);
    }

    const rowId = String(id || crypto.randomUUID());
    const previous = merge ? await getRow(table, rowId) : null;
    const nextData = merge ? { ...(previous || {}), ...clone(payload) } : clone(payload);
    delete nextData.id;
    delete nextData.created_at;
    delete nextData.updated_at;

    const { error } = await client.from(table).upsert({
      id: rowId,
      data: nextData || {},
      updated_at: nowIso()
    }, { onConflict: "id" });

    if (error) throw error;
    return rowId;
  }

  async function deleteRow(table, id) {
    assertConfigured();
    assertTable(table);
    const keyColumn = table === "profiles" ? "user_id" : "id";
    const { error } = await client.from(table).delete().eq(keyColumn, String(id));
    if (error) throw error;
  }

  function toObject(rows) {
    return Object.fromEntries(rows.map((row) => {
      const copy = { ...row };
      const id = String(copy.id ?? copy.user_id);
      delete copy.id;
      return [id, copy];
    }));
  }

  function makeSnapshot(value, key = null) {
    return new RealtimeSnapshot(value, key);
  }

  class RealtimeSnapshot {
    constructor(value, key = null) {
      this._value = value;
      this.key = key;
    }
    val() { return clone(this._value); }
    exists() { return this._value !== null && this._value !== undefined; }
    forEach(callback) {
      if (!this._value || typeof this._value !== "object") return false;
      for (const [key, value] of Object.entries(this._value)) {
        const result = callback(new RealtimeSnapshot(value, key));
        if (result === true) return true;
      }
      return false;
    }
  }

  async function readRealtimePath(path, queryState = {}) {
    const parts = pathParts(path);

    if (parts[0] === ".info" && parts[1] === "connected") {
      return makeSnapshot(!!client);
    }

    if (!parts.length) return makeSnapshot(null);

    const table = parts[0];
    assertTable(table);

    if (parts.length === 1) {
      let rows = await listRows(table);
      if (queryState.orderByChild && queryState.equalTo !== undefined) {
        rows = rows.filter((row) => row?.[queryState.orderByChild] === queryState.equalTo);
      }
      return makeSnapshot(toObject(rows));
    }

    const row = await getRow(table, parts[1]);
    let value = row;

    for (let i = 2; i < parts.length && value != null; i++) {
      value = value?.[parts[i]];
    }
    return makeSnapshot(value, parts.at(-1));
  }

  async function setRealtimePath(path, value, merge = false) {
    const parts = pathParts(path);
    if (!parts.length) {
      if (!value || typeof value !== "object") {
        throw new Error("Root update requires an object.");
      }
      const tasks = [];
      for (const [compoundPath, next] of Object.entries(value)) {
        tasks.push(setRealtimePath(compoundPath, next, true));
      }
      await Promise.all(tasks);
      return;
    }

    const table = parts[0];
    assertTable(table);

    if (parts.length === 1) {
      if (!value || typeof value !== "object") {
        throw new Error("Table update requires an object.");
      }
      const tasks = Object.entries(value).map(([id, row]) =>
        row === null ? deleteRow(table, id) : upsertRow(table, id, row, merge)
      );
      await Promise.all(tasks);
      return;
    }

    const id = parts[1];
    if (parts.length === 2) {
      if (value === null) return deleteRow(table, id);
      return upsertRow(table, id, value, merge);
    }

    const current = (await getRow(table, id)) || {};
    const next = clone(current) || {};
    let cursor = next;
    for (let i = 2; i < parts.length - 1; i++) {
      const segment = parts[i];
      cursor[segment] = cursor[segment] && typeof cursor[segment] === "object" ? cursor[segment] : {};
      cursor = cursor[segment];
    }
    const leaf = parts.at(-1);
    if (value === null) delete cursor[leaf];
    else cursor[leaf] = value;
    return upsertRow(table, id, next, false);
  }

  const activeChannels = new WeakMap();

  class RealtimeRef {
    constructor(path = "", queryState = {}) {
      this.path = normalizePath(path);
      this.query = { ...queryState };
      this.key = pathParts(this.path).at(-1) || null;
    }
    child(name) { return new RealtimeRef(`${this.path}/${name}`, this.query); }
    orderByChild(name) { return new RealtimeRef(this.path, { ...this.query, orderByChild: name }); }
    equalTo(value) { return new RealtimeRef(this.path, { ...this.query, equalTo: value }); }
    once(event) {
      if (event !== "value") return Promise.reject(new Error("Only value reads are supported."));
      return readRealtimePath(this.path, this.query);
    }
    async set(value) { return setRealtimePath(this.path, value, false); }
    async update(value) {
      if (pathParts(this.path).length <= 1 && value && typeof value === "object") {
        const prefix = this.path ? `${this.path}/` : "";
        await Promise.all(Object.entries(value).map(([key, val]) =>
          setRealtimePath(`${prefix}${key}`, val, true)
        ));
        return;
      }
      return setRealtimePath(this.path, value, true);
    }
    async remove() {
      const parts = pathParts(this.path);
      if (parts.length < 2) throw new Error("A record id is required for remove.");
      return deleteRow(parts[0], parts[1]);
    }
    push(value) {
      const table = pathParts(this.path)[0];
      const id = crypto.randomUUID();
      const child = new RealtimeRef(`${table}/${id}`);
      child.key = id;
      if (value !== undefined) child._pending = child.set(value);
      return child;
    }
    on(event, callback, errorCallback) {
      if (event !== "value") return;
      const run = () => readRealtimePath(this.path, this.query)
        .then(callback)
        .catch(errorCallback || console.error);
      run();

      const table = pathParts(this.path)[0];
      if (!client || !table || table === ".info") return;

      const channel = client
        .channel(`legacy-${table}-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, run)
        .subscribe();

      activeChannels.set(this, channel);
    }
    off() {
      const channel = activeChannels.get(this);
      if (channel && client) client.removeChannel(channel);
      activeChannels.delete(this);
    }
  }

  function database() {
    return { ref: (path = "") => new RealtimeRef(path) };
  }
  database.ServerValue = {};
  Object.defineProperty(database.ServerValue, "TIMESTAMP", { get: nowIso });

  class FirestoreDoc {
    constructor(table, id) {
      this.table = table;
      this.id = String(id);
    }
    async get() {
      const row = await getRow(this.table, this.id);
      return {
        id: this.id,
        exists: !!row,
        data: () => {
          if (!row) return undefined;
          const copy = { ...row };
          delete copy.id;
          return copy;
        }
      };
    }
    async update(payload) { return upsertRow(this.table, this.id, payload, true); }
    async set(payload, options = {}) { return upsertRow(this.table, this.id, payload, !!options.merge); }
    async delete() { return deleteRow(this.table, this.id); }
  }

  class FirestoreCollection {
    constructor(table, orderField = null, orderDirection = "asc") {
      assertTable(table);
      this.table = table;
      this.orderField = orderField;
      this.orderDirection = orderDirection;
    }
    doc(id) { return new FirestoreDoc(this.table, id); }
    orderBy(field, direction = "asc") {
      return new FirestoreCollection(this.table, field, direction);
    }
    async add(payload) {
      const id = crypto.randomUUID();
      await upsertRow(this.table, id, payload, false);
      return { id };
    }
    async _docs() {
      let rows = await listRows(this.table);
      if (this.orderField) {
        const dir = this.orderDirection === "desc" ? -1 : 1;
        rows.sort((a, b) => {
          const av = a[this.orderField] ?? "";
          const bv = b[this.orderField] ?? "";
          return (new Date(av).getTime() - new Date(bv).getTime() ||
            String(av).localeCompare(String(bv))) * dir;
        });
      }
      return rows.map((row) => ({
        id: String(row.id ?? row.user_id),
        data: () => {
          const copy = { ...row };
          delete copy.id;
          return copy;
        }
      }));
    }
    onSnapshot(callback, errorCallback) {
      const emit = async () => {
        try {
          const docs = await this._docs();
          callback({ forEach: (fn) => docs.forEach(fn), docs });
        } catch (err) {
          (errorCallback || console.error)(err);
        }
      };
      emit();

      if (!client) return () => {};
      const channel = client
        .channel(`legacy-firestore-${this.table}-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: this.table }, emit)
        .subscribe();

      return () => client.removeChannel(channel);
    }
  }

  function firestore() {
    return { collection: (table) => new FirestoreCollection(table) };
  }
  firestore.FieldValue = { serverTimestamp: nowIso };

  let wrappedCurrentUser = null;

  function wrapUser(user) {
    if (!user) return null;
    return {
      ...user,
      uid: user.id,
      displayName: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "",
      async updatePassword(password) {
        const { data, error } = await requireClient().auth.updateUser({ password });
        if (error) throw error;
        return data;
      }
    };
  }

  function auth() {
    return {
      get currentUser() { return wrappedCurrentUser; },
      onAuthStateChanged(callback) {
        if (!client) {
          queueMicrotask(() => callback(null));
          return () => {};
        }

        client.auth.getUser().then(({ data }) => {
          wrappedCurrentUser = wrapUser(data?.user || null);
          callback(wrappedCurrentUser);
        }).catch(() => callback(null));

        const { data } = client.auth.onAuthStateChange((_event, session) => {
          wrappedCurrentUser = wrapUser(session?.user || null);
          callback(wrappedCurrentUser);
        });

        return () => data?.subscription?.unsubscribe();
      },
      async signOut() {
        if (!client) return;
        const { error } = await client.auth.signOut();
        if (error) throw error;
        wrappedCurrentUser = null;
      },
      async signInWithEmailAndPassword(email, password) {
        const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
        if (error) throw error;
        wrappedCurrentUser = wrapUser(data.user);
        return { user: wrappedCurrentUser };
      },
      async createUserWithEmailAndPassword(email, password) {
        const { data, error } = await requireClient().auth.signUp({ email, password });
        if (error) throw error;
        wrappedCurrentUser = wrapUser(data.user);
        return { user: wrappedCurrentUser };
      }
    };
  }

  // Kept only as an internal compatibility namespace for older page controllers.
  // It routes to Supabase; it does not initialize or contact Supabase.
  window.firebase = {
    apps: configured ? [{}] : [],
    initializeApp() {
      if (!this.apps.length) this.apps.push({});
      return this.apps[0];
    },
    database,
    firestore,
    auth,
    storage() {
      // Current settings UI stores avatar data in the Supabase-backed users
      // profile document; no separate Supabase Storage API is required.
      return {};
    }
  };

  window.firebaseDB = database();
  window.PGENRO_DB_COMPAT = Object.freeze({
    configured,
    listRows,
    getRow,
    upsertRow,
    deleteRow
  });

  // ------------------------------------------------------------------------
  // Native Supabase page data bridge
  // ------------------------------------------------------------------------
  // Some of the original user-facing modules were display-only screens that
  // read browser localStorage.  The bridge below replaces that data source at
  // runtime with Supabase and keeps those screens live through Postgres
  // Changes.  Existing rendering/UI code stays unchanged.
  const pageBridgeChannels = [];

  const unwrapJsonRows = (rows = []) => (rows || []).map((row) => ({
    ...row,
    ...(clone(row.data) || {}),
    id: String(row.id),
    createdAt: row.data?.createdAt ?? row.created_at,
    updatedAt: row.data?.updatedAt ?? row.updated_at
  }));

  const mapEmployeeForUser = (row) => ({
    id: row.id,
    employeeId: row.employee_id || "",
    firstName: row.first_name || "",
    middleName: row.middle_name || "",
    lastName: row.last_name || "",
    extension: row.name_extension || "",
    gender: row.gender || "",
    dob: row.dob || "",
    birthPlace: row.pob || "",
    civilStatus: row.civil_status || "",
    bloodType: row.blood_type || "",
    designation: row.designation || "",
    department: row.department || "",
    employmentStatus: row.employment_type || "",
    itemNo: row.item_code || "",
    dateEmployed: row.date_employed || "",
    salaryGrade: row.salary_grade || "",
    status: row.duty_status || "Active",
    mobile1: row.mobile || "",
    email: row.email || "",
    purok: row.address || "",
    barangay: "",
    municipality: "",
    province: ""
  });

  const mapTravelForUser = (row) => ({
    id: row.id,
    toNumber: row.tor_no || "",
    travelerName: row.traveler_name || "",
    travelerPosition: row.traveler_position || "",
    department: row.department || "",
    travelType: row.travel_type || "Local",
    status: row.status || "Pending",
    destination: row.destination || "",
    startDate: row.departure_date || "",
    endDate: row.return_date || "",
    transportation: row.transportation || "",
    purpose: row.purpose || "",
    perDiem: row.per_diem || "",
    fundSource: row.fund_source || "",
    approver: row.approver || "",
    remarks: row.remarks || ""
  });

  async function selectRows(table, select = "*") {
    const { data, error } = await requireClient().from(table).select(select);
    if (error) throw error;
    return data || [];
  }

  function watchTable(table, loader) {
    if (!client) return null;
    const channel = client
      .channel(`page-bridge-${table}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => loader().catch((error) => console.warn(`PGENRO ${table} live reload failed:`, error))
      )
      .subscribe();
    pageBridgeChannels.push(channel);
    return channel;
  }

  async function startPageDataBridge() {
    if (!client || !configured) return;
    const path = window.location.pathname.toLowerCase();

    try {
      if (path.endsWith("/user/communication.html")) {
        const load = async () => {
          const rows = unwrapJsonRows(await selectRows("communications", "id,data,created_at,updated_at"));
          window.loadDatabaseRecords?.(rows);
        };
        await load();
        watchTable("communications", load);
      }

      if (path.endsWith("/user/employee.html")) {
        const load = async () => {
          const rows = (await selectRows("employees")).map(mapEmployeeForUser);
          window.loadDatabaseEmployees?.(rows);
        };
        await load();
        watchTable("employees", load);
      }

      if (path.endsWith("/user/travelor.html")) {
        const load = async () => {
          const rows = (await selectRows("travel_orders")).map(mapTravelForUser);
          window.loadDatabaseTravelOrders?.(rows);
        };
        await load();
        watchTable("travel_orders", load);
      }

      if (path.endsWith("/user/officememo.html")) {
        const load = async () => {
          const rows = unwrapJsonRows(await selectRows("office_memos", "id,data,created_at,updated_at"));
          window.loadDatabaseMemos?.(rows);
        };
        await load();
        watchTable("office_memos", load);
      }

      if (path.endsWith("/user/homepage.html")) {
        const loadDashboard = async () => {
          if (!window.PGENRO_DASHBOARD) return;
          const [communications, visitors, services, employees, travel, inventory, ics, memos] = await Promise.all([
            selectRows("communications", "id,data,created_at,updated_at").then(unwrapJsonRows),
            selectRows("visitors", "id,data,created_at,updated_at").then(unwrapJsonRows),
            selectRows("service_requests", "id,data,created_at,updated_at").then(unwrapJsonRows),
            selectRows("employees"),
            selectRows("travel_orders"),
            selectRows("inventory"),
            selectRows("ics_records", "id,data,created_at,updated_at").then(unwrapJsonRows),
            selectRows("office_memos", "id,data,created_at,updated_at").then(unwrapJsonRows)
          ]);
          window.PGENRO_DASHBOARD.loadDatabasePayload({
            communications,
            visitors,
            serviceRequests: services,
            employees,
            travelOrders: travel,
            inventory,
            ics,
            memos,
            status: { type: "online", message: "Supabase Live • All Modules Synced" }
          });
        };
        await loadDashboard();
        ["communications", "visitors", "service_requests", "employees", "travel_orders", "inventory", "ics_records", "office_memos"]
          .forEach((table) => watchTable(table, loadDashboard));
      }
    } catch (error) {
      console.warn("PGENRO page data bridge failed:", error);
      window.PGENRO_DASHBOARD?.setDatabaseStatus?.("offline", "Supabase sync unavailable");
    }
  }

  // Let each page's own DOMContentLoaded handler create its public rendering
  // hooks first, then attach Supabase data/realtime to those hooks.
  const queuePageBridge = () => window.setTimeout(startPageDataBridge, 0);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", queuePageBridge, { once: true });
  } else {
    queuePageBridge();
  }

  window.addEventListener("pagehide", () => {
    if (!client) return;
    pageBridgeChannels.splice(0).forEach((channel) => {
      try { client.removeChannel(channel); } catch {}
    });
  }, { once: true });
})();
