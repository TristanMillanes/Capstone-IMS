/**
 * PGENRO IMS - ONE SHARED SUPABASE CLIENT
 * Project: zssrxubajhqryrwijyzm | Region: ap-southeast-1
 * --------------------------------------------------------------------------
 * This is the ONLY project-side Supabase bootstrap file used by the frontend.
 * The Supabase CDN provides the official @supabase/supabase-js library.
 *
 * IMPORTANT:
 * NEVER place a service_role or secret key in this frontend file.
 */
(function () {
  "use strict";

  const CONFIG = Object.freeze({
    projectRef: "zssrxubajhqryrwijyzm",
    region: "ap-southeast-1",
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP"
  });

  // Must exactly match the deployed Supabase Edge Function name.
  const ADMIN_FUNCTION = "admin-user";

  const keyLooksConfigured =
    Boolean(CONFIG.publishableKey) &&
    !CONFIG.publishableKey.includes("PASTE_YOUR") &&
    !CONFIG.publishableKey.includes("YOUR_SUPABASE");

  const sdkReady = Boolean(window.supabase?.createClient);
  const configured = sdkReady && keyLooksConfigured;

  window.PGENRO_SUPABASE = Object.freeze({
    ...CONFIG,
    sdkReady,
    configured
  });

  if (!sdkReady) {
    console.error(
      "PGENRO IMS: @supabase/supabase-js was not loaded."
    );

    window.pgenroSupabase = null;
    return;
  }

  const client = configured
    ? window.supabase.createClient(
        CONFIG.url,
        CONFIG.publishableKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: "pkce"
          }
        }
      )
    : null;

  window.pgenroSupabase = client;

  if (!configured) {
    console.warn(
      "PGENRO IMS: Supabase is not configured correctly."
    );
  }

  const ADMIN_ROLES = new Set([
    "admin",
    "administrator",
    "super admin",
    "superadmin",
    "system administrator"
  ]);

  const ALLOWED_TABLES = new Set([
    "profiles",
    "users",
    "admins",
    "access_requests",
    "service_requests",
    "visitors",
    "admin_logs",
    "audit_logs",
    "office_memos",
    "communications",
    "ics_records",
    "employees",
    "inventory",
    "inventory_movements",
    "travel_orders"
  ]);

  const LEGACY_TABLE_ALIASES = Object.freeze({
    users: "profiles"
  });

  const normalizeRole = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  function isAdminProfile(profile) {
    const metadata =
      profile?.authUser?.user_metadata ||
      profile?.user_metadata ||
      {};

    const appMetadata =
      profile?.authUser?.app_metadata ||
      profile?.app_metadata ||
      {};

    const roleCandidates = [
      profile?.role,
      profile?.assigned_role,
      profile?.assignedRole,
      metadata.role,
      metadata.assigned_role,
      appMetadata.role
    ];

    const accountTypeCandidates = [
      profile?.account_type,
      profile?.accountType,
      metadata.account_type,
      metadata.accountType,
      appMetadata.account_type,
      appMetadata.accountType
    ];

    return (
      roleCandidates.some((role) =>
        ADMIN_ROLES.has(normalizeRole(role))
      ) ||
      accountTypeCandidates.some((type) =>
        normalizeRole(type) === "admin"
      )
    );
  }

  const nowIso = () => new Date().toISOString();

  const clone = (value) =>
    value == null
      ? value
      : JSON.parse(JSON.stringify(value));

  const normalizePath = (path = "") =>
    String(path).replace(/^\/+|\/+$/g, "");

  const pathParts = (path = "") =>
    normalizePath(path)
      .split("/")
      .filter(Boolean);

  const resolveLegacyTable = (table) =>
    LEGACY_TABLE_ALIASES[table] || table;

  function accessError(code, message, details = null) {
    const error = new Error(message);
    error.code = code;

    if (details) {
      error.details = details;
    }

    return error;
  }

  function requireClient() {
    if (!client) {
      throw new Error(
        "Supabase is not configured. Check shared/supabase.js."
      );
    }

    return client;
  }

  function assertConfigured() {
    requireClient();
  }

  function assertTable(table) {
    if (!ALLOWED_TABLES.has(table)) {
      throw new Error(
        `Unsupported Supabase table: ${table}`
      );
    }
  }

  async function getCurrentSession() {
    const sb = requireClient();

    const {
      data,
      error
    } = await sb.auth.getSession();

    if (error) {
      throw error;
    }

    return data?.session || null;
  }

  async function getCurrentProfile() {
    const sb = requireClient();
    const session = await getCurrentSession();
    const user = session?.user || null;

    if (!user) {
      return null;
    }

    const {
      data: profile,
      error
    } = await sb
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return profile
      ? {
          ...profile,
          authUser: user
        }
      : null;
  }

  async function requireApprovedUser() {
    const profile = await getCurrentProfile();

    if (!profile) {
      throw accessError(
        "PGENRO_PROFILE_MISSING",
        "No PGENRO personnel profile was found."
      );
    }

    const status = String(profile.status || "")
      .trim()
      .toLowerCase();

    const approvedStatus = [
      "active",
      "approved"
    ].includes(status);

    if (profile.is_active !== true || !approvedStatus) {
      throw accessError(
        "PGENRO_ACCOUNT_INACTIVE",
        `Account access is ${profile.status || "not active"}.`,
        {
          status: profile.status || "inactive"
        }
      );
    }

    return profile;
  }

  async function requireAdmin() {
    const profile = await requireApprovedUser();

    if (!isAdminProfile(profile)) {
      throw accessError(
        "PGENRO_ADMIN_REQUIRED",
        "Administrator permission is required."
      );
    }

    return profile;
  }

  /**
   * Calls the protected Supabase Edge Function.
   *
   * Supported actions:
   * - create
   * - update
   * - set_status
   * - delete
   * - approve_request
   * - reject_request
   */
  async function invokeAdmin(action, payload = {}) {
    const sb = requireClient();

    const {
      data: sessionData,
      error: sessionError
    } = await sb.auth.getSession();

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    const accessToken =
      sessionData?.session?.access_token;

    if (!accessToken) {
      throw new Error(
        "Your login session has expired. Please log out and log in again."
      );
    }

    const {
      data,
      error
    } = await sb.functions.invoke(
      ADMIN_FUNCTION,
      {
        body: {
          action,
          ...payload
        },
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (error) {
      console.error(
        `PGENRO IMS: ${ADMIN_FUNCTION} Edge Function failed.`,
        error
      );

      let message =
        error.message ||
        `Failed to call the ${ADMIN_FUNCTION} Edge Function.`;

      try {
        if (error.context instanceof Response) {
          const details =
            await error.context.clone().json();

          message =
            details?.error ||
            details?.message ||
            message;
        }
      } catch {
        // Preserve the original error message.
      }

      throw new Error(message);
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  }

  async function testConnection() {
    if (!client || !configured) {
      return {
        ok: false,
        message:
          "Supabase client is not configured."
      };
    }

    try {
      const {
        data,
        error
      } = await client.rpc("pgenro_healthcheck");

      if (error) {
        throw error;
      }

      return {
        ok: data?.ok !== false,
        message:
          "Connected to Supabase and the PGENRO database schema is reachable.",
        data
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error?.message ||
          "Supabase database health check failed.",
        error
      };
    }
  }

  window.PGENRO_API = {
    config: CONFIG,

    get client() {
      return client;
    },

    getCurrentSession,
    getCurrentProfile,
    requireApprovedUser,
    requireAdmin,
    redirectToWorkspace,
    invokeAdmin,
    testConnection,

    isAdminRole(role) {
      return ADMIN_ROLES.has(
        normalizeRole(role)
      );
    },

    isAdminProfile(profile) {
      return isAdminProfile(profile);
    }
  };

  /*
   * Visitors Log compatibility facade.
   * This points to the same Supabase client.
   */
  window.PGENRO_DB = Object.freeze({
    client,
    table: "visitors",
    profilesTable: "profiles",
    configured,

    async getSession() {
      return getCurrentSession();
    },

    async getCurrentRole() {
      const profile = await getCurrentProfile();

      if (!profile) {
        return null;
      }

      const active =
        profile.is_active === true &&
        ["active", "approved"].includes(
          String(profile.status || "")
            .trim()
            .toLowerCase()
        );

      if (!active) {
        return null;
      }

      return isAdminProfile(profile)
        ? "admin"
        : "user";
    }
  });

  /*
   * Update the user information displayed on the page.
   */
  async function syncBrowserProfile(profile) {
    if (!profile) {
      return;
    }

    const name =
      profile.full_name ||
      profile.username ||
      "PGENRO Officer";

    const role =
      profile.role ||
      "Staff";

    const email =
      profile.email ||
      profile.authUser?.email ||
      "";

    const fields = {
      currentUserName: name,
      dropdownUserName: name,
      currentUserRole: role,
      dropdownUserRole: role,
      dropdownUserEmail: email,
      adminName: name
    };

    Object.entries(fields).forEach(
      ([id, value]) => {
        const element =
          document.getElementById(id);

        if (element) {
          element.textContent = value;
        }
      }
    );

    document
      .querySelectorAll(
        ".profile-dropdown-header h3"
      )
      .forEach((element) => {
        element.textContent = name;
      });

    if (
      document.body?.dataset.requiresAuth ===
      "admin"
    ) {
      document.documentElement.dataset.adminAuth =
        "verified";
    }

    try {
      localStorage.setItem(
        "pgenro_current_user",
        JSON.stringify({
          uid: profile.user_id,
          id: profile.user_id,
          fullName:
            profile.full_name ||
            profile.username ||
            "",
          username:
            profile.username ||
            "",
          email:
            profile.email ||
            profile.authUser?.email ||
            "",
          contact:
            profile.contact ||
            "",
          position:
            profile.position ||
            "",
          division:
            profile.division ||
            "",
          role:
            profile.role ||
            "System Staff",
          accountType:
            profile.account_type ||
            "Standard User",
          status:
            profile.status ||
            "Active"
        })
      );

      sessionStorage.setItem(
        "pgenro_session_active",
        "true"
      );

      sessionStorage.setItem(
        "pgenro_session_token",
        String(profile.user_id)
      );

      document.dispatchEvent(
        new CustomEvent(
          "pgenro:profile-updated",
          {
            detail: {
              ...profile,
              fullName:
                profile.full_name ||
                profile.username ||
                "",
              email:
                profile.email ||
                profile.authUser?.email ||
                ""
            }
          }
        )
      );
    } catch (error) {
      console.warn(
        "PGENRO browser profile storage warning:",
        error
      );
    }
  }

  function loginUrl() {
    return new URL(
      "../User/login.html",
      window.location.href
    ).href;
  }

  function userWorkspaceUrl() {
    return new URL(
      "../User/homepage.html",
      window.location.href
    ).href;
  }

  function adminWorkspaceUrl() {
    return new URL(
      "../admin/admin.html",
      window.location.href
    ).href;
  }

  function workspaceUrlFor(profile) {
    return isAdminProfile(profile)
      ? adminWorkspaceUrl()
      : userWorkspaceUrl();
  }

  async function redirectToWorkspace(
    profile = null,
    { replace = true } = {}
  ) {
    const approvedProfile =
      profile ||
      await requireApprovedUser();

    await syncBrowserProfile(
      approvedProfile
    );

    const destination =
      workspaceUrlFor(
        approvedProfile
      );

    if (replace) {
      window.location.replace(
        destination
      );
    } else {
      window.location.assign(
        destination
      );
    }

    return destination;
  }

  async function endSessionAndRedirect() {
    try {
      if (client) {
        await client.auth.signOut();
      }
    } catch (error) {
      console.warn(
        "PGENRO sign-out warning:",
        error
      );
    }

    try {
      localStorage.removeItem(
        "pgenro_current_user"
      );

      sessionStorage.removeItem(
        "pgenro_session_active"
      );

      sessionStorage.removeItem(
        "pgenro_session_token"
      );
    } catch (error) {
      console.warn(
        "PGENRO session cleanup warning:",
        error
      );
    }

    window.location.replace(loginUrl());
  }

  function showAuthorizationWarning(message) {
    document.documentElement.dataset.pgenroAuthState =
      "warning";

    const existing =
      document.getElementById(
        "pgenroAuthWarning"
      );

    if (existing) {
      const text =
        existing.querySelector(
          "[data-auth-warning-text]"
        );

      if (text) {
        text.textContent = message;
      }

      return;
    }

    const notice =
      document.createElement("div");

    notice.id = "pgenroAuthWarning";
    notice.setAttribute("role", "status");

    notice.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "left:auto",
      "top:auto",
      "z-index:2147483646",
      "width:min(430px,calc(100vw - 32px))",
      "display:flex",
      "align-items:center",
      "gap:10px",
      "flex-wrap:wrap",
      "padding:11px 12px",
      "border-radius:12px",
      "background:#fffaf3",
      "border:1px solid #fdba74",
      "color:#9a3412",
      "font:600 12px/1.45 system-ui,sans-serif",
      "box-shadow:0 12px 34px rgba(15,23,42,.16)"
    ].join(";");

    const text =
      document.createElement("span");

    text.dataset.authWarningText = "true";
    text.style.cssText =
      "flex:1 1 260px;min-width:0";
    text.textContent = message;

    const retry =
      document.createElement("button");

    retry.type = "button";
    retry.textContent = "Retry";

    retry.style.cssText = [
      "flex:0 0 auto",
      "min-height:32px",
      "padding:6px 10px",
      "border-radius:8px",
      "border:1px solid #fb923c",
      "background:#fff",
      "color:#9a3412",
      "font:700 12px system-ui,sans-serif",
      "cursor:pointer"
    ].join(";");

    retry.addEventListener(
      "click",
      async () => {
        retry.disabled = true;
        retry.textContent = "Checkingâ€¦";

        try {
          await applyRouteGuard();
        } finally {
          if (
            document.body?.contains(retry)
          ) {
            retry.disabled = false;
            retry.textContent = "Retry";
          }
        }
      }
    );

    notice.append(text, retry);
    document.body?.appendChild(notice);
  }

  function clearAuthorizationWarning() {
    delete document.documentElement.dataset
      .pgenroAuthState;

    document
      .getElementById("pgenroAuthWarning")
      ?.remove();
  }

  async function applyRouteGuard() {
    const mode =
      document.body?.dataset?.requiresAuth;

    if (!mode) {
      return;
    }

    if (!client) {
      console.error(
        "Protected page cannot initialize because Supabase is not configured."
      );

      showAuthorizationWarning(
        "Database connection is not configured. Protected data cannot be loaded."
      );

      return;
    }

    try {
      const profile =
        mode === "admin"
          ? await requireAdmin()
          : await requireApprovedUser();

      const profileIsAdmin =
        isAdminProfile(profile);

      // Keep the two workspaces separated. Admin accounts enter the Admin
      // Console, while regular personnel enter the User Homepage.
      if (
        mode === "user" &&
        profileIsAdmin
      ) {
        window.location.replace(
          adminWorkspaceUrl()
        );
        return;
      }

      clearAuthorizationWarning();
      await syncBrowserProfile(profile);

      const userId = profile.user_id;

      client
        .channel(
          `authz-watch-${userId}-${crypto.randomUUID()}`
        )
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

            const nextActive =
              next.is_active === true &&
              ["active", "approved"].includes(
                String(next.status || "")
                  .trim()
                  .toLowerCase()
              );

            const nextAdmin =
              isAdminProfile(next);

            if (!nextActive) {
              await endSessionAndRedirect();
              return;
            }

            if (
              mode === "admin" &&
              !nextAdmin
            ) {
              await syncBrowserProfile(next);

              window.location.replace(
                userWorkspaceUrl()
              );

              return;
            }

            await syncBrowserProfile(next);
          }
        )
        .subscribe();
    } catch (error) {
      if (
        error?.code ===
        "PGENRO_ADMIN_REQUIRED"
      ) {
        console.warn(
          "PGENRO admin route denied."
        );

        window.location.replace(
          userWorkspaceUrl()
        );

        return;
      }

      if (
        [
          "PGENRO_PROFILE_MISSING",
          "PGENRO_ACCOUNT_INACTIVE"
        ].includes(error?.code)
      ) {
        console.warn(
          "PGENRO account authorization denied:",
          error
        );

        await endSessionAndRedirect();
        return;
      }

      console.error(
        "PGENRO authorization check failed:",
        error
      );

      showAuthorizationWarning(
        "Unable to verify account access. Reconnect and refresh this page."
      );
    }
  }

  async function signOutFromUi(
    { confirm = true } = {}
  ) {
    if (
      confirm &&
      !window.confirm(
        "Are you sure you want to end your current session?"
      )
    ) {
      return false;
    }

    await endSessionAndRedirect();
    return true;
  }

  window.PGENRO_API.signOut =
    signOutFromUi;

  Object.freeze(window.PGENRO_API);

  document.addEventListener(
    "click",
    async (event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest(
              "#logoutBtn,[data-pgenro-logout]"
            )
          : null;

      if (!target) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      await signOutFromUi({
        confirm:
          target.dataset.logoutConfirm !==
          "false"
      });
    },
    true
  );

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      applyRouteGuard,
      {
        once: true
      }
    );
  } else {
    queueMicrotask(applyRouteGuard);
  }

  function isLoginPage() {
    return /\/user\/login\.html$/i.test(
      window.location.pathname
    );
  }

  async function routeSignedInLogin() {
    if (!isLoginPage() || !client) {
      return;
    }

    try {
      const session =
        await getCurrentSession();

      if (!session) {
        return;
      }

      const profile =
        await requireApprovedUser();

      await redirectToWorkspace(
        profile
      );
    } catch (error) {
      // Pending, rejected, inactive, or incomplete accounts remain on the
      // login page so its own UI can show the appropriate access message.
      if (
        ![
          "PGENRO_PROFILE_MISSING",
          "PGENRO_ACCOUNT_INACTIVE"
        ].includes(error?.code)
      ) {
        console.error(
          "PGENRO login routing failed:",
          error
        );
      }
    }
  }

  // Run once for an already persisted session and again after a successful
  // sign-in. The timeout avoids doing asynchronous Supabase work directly
  // inside the Auth state-change callback.
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      routeSignedInLogin,
      { once: true }
    );
  } else {
    queueMicrotask(routeSignedInLogin);
  }

  client?.auth.onAuthStateChange(
    (event, session) => {
      if (
        session &&
        [
          "INITIAL_SESSION",
          "SIGNED_IN"
        ].includes(event)
      ) {
        window.setTimeout(
          routeSignedInLogin,
          0
        );
      }
    }
  );

  window.addEventListener(
    "online",
    () => {
      if (
        document.documentElement.dataset
          .pgenroAuthState === "warning"
      ) {
        applyRouteGuard();
      }
    }
  );

  /*
   * Legacy Supabase adapter.
   */
  async function listRows(table) {
    assertConfigured();

    table = resolveLegacyTable(table);
    assertTable(table);

    if (table === "profiles") {
      const {
        data,
        error
      } = await client
        .from(table)
        .select("*")
        .order(
          "created_at",
          {
            ascending: false
          }
        );

      if (error) {
        throw error;
      }

      return data || [];
    }

    const {
      data,
      error
    } = await client
      .from(table)
      .select(
        "id,data,created_at,updated_at"
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      );

    if (error) {
      throw error;
    }

    return (data || []).map((row) => ({
      id: String(row.id),
      ...(clone(row.data) || {}),
      createdAt:
        row.data?.createdAt ??
        row.created_at,
      updatedAt:
        row.data?.updatedAt ??
        row.updated_at
    }));
  }

  async function getRow(table, id) {
    assertConfigured();

    table = resolveLegacyTable(table);
    assertTable(table);

    if (table === "profiles") {
      const {
        data,
        error
      } = await client
        .from(table)
        .select("*")
        .eq(
          "user_id",
          String(id)
        )
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data || null;
    }

    const {
      data,
      error
    } = await client
      .from(table)
      .select(
        "id,data,created_at,updated_at"
      )
      .eq(
        "id",
        String(id)
      )
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      id: String(data.id),
      ...(clone(data.data) || {}),
      createdAt:
        data.data?.createdAt ??
        data.created_at,
      updatedAt:
        data.data?.updatedAt ??
        data.updated_at
    };
  }

  async function upsertRow(
    table,
    id,
    payload,
    merge = true
  ) {
    assertConfigured();

    table = resolveLegacyTable(table);
    assertTable(table);

    if (table === "profiles") {
      const previous = merge
        ? (await getRow(table, id)) || {}
        : {};

      const row = {
        ...previous,
        ...clone(payload),
        user_id: String(id)
      };

      delete row.authUser;

      const {
        error
      } = await client
        .from(table)
        .upsert(
          row,
          {
            onConflict: "user_id"
          }
        );

      if (error) {
        throw error;
      }

      return String(id);
    }

    const rowId = String(
      id || crypto.randomUUID()
    );

    const previous = merge
      ? await getRow(table, rowId)
      : null;

    const nextData = merge
      ? {
          ...(previous || {}),
          ...clone(payload)
        }
      : clone(payload);

    delete nextData.id;
    delete nextData.created_at;
    delete nextData.updated_at;

    const {
      error
    } = await client
      .from(table)
      .upsert(
        {
          id: rowId,
          data: nextData || {},
          updated_at: nowIso()
        },
        {
          onConflict: "id"
        }
      );

    if (error) {
      throw error;
    }

    return rowId;
  }

  async function deleteRow(table, id) {
    assertConfigured();

    table = resolveLegacyTable(table);
    assertTable(table);

    const keyColumn =
      table === "profiles"
        ? "user_id"
        : "id";

    const {
      error
    } = await client
      .from(table)
      .delete()
      .eq(
        keyColumn,
        String(id)
      );

    if (error) {
      throw error;
    }
  }

  function toObject(rows) {
    return Object.fromEntries(
      rows.map((row) => {
        const copy = {
          ...row
        };

        const id = String(
          copy.id ??
          copy.user_id
        );

        delete copy.id;

        return [
          id,
          copy
        ];
      })
    );
  }

  function makeSnapshot(
    value,
    key = null
  ) {
    return new RealtimeSnapshot(
      value,
      key
    );
  }

  class RealtimeSnapshot {
    constructor(
      value,
      key = null
    ) {
      this._value = value;
      this.key = key;
    }

    val() {
      return clone(this._value);
    }

    exists() {
      return (
        this._value !== null &&
        this._value !== undefined
      );
    }

    forEach(callback) {
      if (
        !this._value ||
        typeof this._value !== "object"
      ) {
        return false;
      }

      for (
        const [key, value] of
        Object.entries(this._value)
      ) {
        const result = callback(
          new RealtimeSnapshot(
            value,
            key
          )
        );

        if (result === true) {
          return true;
        }
      }

      return false;
    }
  }

  async function readRealtimePath(
    path,
    queryState = {}
  ) {
    const parts =
      pathParts(path);

    if (
      parts[0] === ".info" &&
      parts[1] === "connected"
    ) {
      return makeSnapshot(
        Boolean(client) &&
        navigator.onLine !== false
      );
    }

    if (!parts.length) {
      return makeSnapshot(null);
    }

    const table = parts[0];
    assertTable(table);

    if (parts.length === 1) {
      let rows =
        await listRows(table);

      if (
        queryState.orderByChild &&
        queryState.equalTo !== undefined
      ) {
        rows = rows.filter(
          (row) =>
            row?.[
              queryState.orderByChild
            ] === queryState.equalTo
        );
      }

      return makeSnapshot(
        toObject(rows)
      );
    }

    const row =
      await getRow(
        table,
        parts[1]
      );

    let value = row;

    for (
      let index = 2;
      index < parts.length &&
      value != null;
      index += 1
    ) {
      value =
        value?.[parts[index]];
    }

    return makeSnapshot(
      value,
      parts.at(-1)
    );
  }

  async function setRealtimePath(
    path,
    value,
    merge = false
  ) {
    const parts =
      pathParts(path);

    if (!parts.length) {
      if (
        !value ||
        typeof value !== "object"
      ) {
        throw new Error(
          "Root update requires an object."
        );
      }

      await Promise.all(
        Object.entries(value).map(
          ([compoundPath, next]) =>
            setRealtimePath(
              compoundPath,
              next,
              true
            )
        )
      );

      return;
    }

    const table = parts[0];
    assertTable(table);

    if (parts.length === 1) {
      if (
        !value ||
        typeof value !== "object"
      ) {
        throw new Error(
          "Table update requires an object."
        );
      }

      await Promise.all(
        Object.entries(value).map(
          ([id, row]) =>
            row === null
              ? deleteRow(table, id)
              : upsertRow(
                  table,
                  id,
                  row,
                  merge
                )
        )
      );

      return;
    }

    const id = parts[1];

    if (parts.length === 2) {
      if (value === null) {
        return deleteRow(
          table,
          id
        );
      }

      return upsertRow(
        table,
        id,
        value,
        merge
      );
    }

    const current =
      (await getRow(table, id)) ||
      {};

    const next =
      clone(current) ||
      {};

    let cursor = next;

    for (
      let index = 2;
      index < parts.length - 1;
      index += 1
    ) {
      const segment =
        parts[index];

      cursor[segment] =
        cursor[segment] &&
        typeof cursor[segment] ===
          "object"
          ? cursor[segment]
          : {};

      cursor =
        cursor[segment];
    }

    const leaf =
      parts.at(-1);

    if (value === null) {
      delete cursor[leaf];
    } else {
      cursor[leaf] = value;
    }

    return upsertRow(
      table,
      id,
      next,
      false
    );
  }

  const activeChannels =
    new WeakMap();

  const activeConnectionListeners =
    new WeakMap();

  class RealtimeRef {
    constructor(
      path = "",
      queryState = {}
    ) {
      this.path =
        normalizePath(path);

      this.query = {
        ...queryState
      };

      this.key =
        pathParts(this.path).at(-1) ||
        null;
    }

    child(name) {
      return new RealtimeRef(
        `${this.path}/${name}`,
        this.query
      );
    }

    orderByChild(name) {
      return new RealtimeRef(
        this.path,
        {
          ...this.query,
          orderByChild: name
        }
      );
    }

    equalTo(value) {
      return new RealtimeRef(
        this.path,
        {
          ...this.query,
          equalTo: value
        }
      );
    }

    once(event) {
      if (event !== "value") {
        return Promise.reject(
          new Error(
            "Only value reads are supported."
          )
        );
      }

      return readRealtimePath(
        this.path,
        this.query
      );
    }

    async set(value) {
      return setRealtimePath(
        this.path,
        value,
        false
      );
    }

    async update(value) {
      if (
        pathParts(this.path).length <= 1 &&
        value &&
        typeof value === "object"
      ) {
        const prefix =
          this.path
            ? `${this.path}/`
            : "";

        await Promise.all(
          Object.entries(value).map(
            ([key, item]) =>
              setRealtimePath(
                `${prefix}${key}`,
                item,
                true
              )
          )
        );

        return;
      }

      return setRealtimePath(
        this.path,
        value,
        true
      );
    }

    async remove() {
      const parts =
        pathParts(this.path);

      if (parts.length < 2) {
        throw new Error(
          "A record id is required for remove."
        );
      }

      return deleteRow(
        parts[0],
        parts[1]
      );
    }

    push(value) {
      const table =
        pathParts(this.path)[0];

      const id =
        crypto.randomUUID();

      const child =
        new RealtimeRef(
          `${table}/${id}`
        );

      child.key = id;

      if (value !== undefined) {
        child._pending =
          child.set(value);
      }

      return child;
    }

    on(
      event,
      callback,
      errorCallback
    ) {
      if (event !== "value") {
        return;
      }

      const run = () =>
        readRealtimePath(
          this.path,
          this.query
        )
          .then(callback)
          .catch(
            errorCallback ||
            console.error
          );

      run();

      if (
        this.path ===
        ".info/connected"
      ) {
        const refreshConnection =
          () => run();

        window.addEventListener(
          "online",
          refreshConnection
        );

        window.addEventListener(
          "offline",
          refreshConnection
        );

        activeConnectionListeners.set(
          this,
          refreshConnection
        );

        return;
      }

      const rawTable =
        pathParts(this.path)[0];

      const table =
        resolveLegacyTable(rawTable);

      if (
        !client ||
        !table ||
        table === ".info"
      ) {
        return;
      }

      const channel = client
        .channel(
          `legacy-${table}-${crypto.randomUUID()}`
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table
          },
          run
        )
        .subscribe();

      activeChannels.set(
        this,
        channel
      );
    }

    off() {
      const channel =
        activeChannels.get(this);

      if (channel && client) {
        client.removeChannel(channel);
      }

      activeChannels.delete(this);

      const listener =
        activeConnectionListeners.get(
          this
        );

      if (listener) {
        window.removeEventListener(
          "online",
          listener
        );

        window.removeEventListener(
          "offline",
          listener
        );
      }

      activeConnectionListeners.delete(
        this
      );
    }
  }

  function database() {
    return {
      ref(path = "") {
        return new RealtimeRef(path);
      }
    };
  }

  database.ServerValue = {};

  Object.defineProperty(
    database.ServerValue,
    "TIMESTAMP",
    {
      get: nowIso
    }
  );

  class FirestoreDoc {
    constructor(table, id) {
      this.table = table;
      this.id = String(id);
    }

    async get() {
      const row =
        await getRow(
          this.table,
          this.id
        );

      return {
        id: this.id,
        exists: Boolean(row),

        data() {
          if (!row) {
            return undefined;
          }

          const copy = {
            ...row
          };

          delete copy.id;

          return copy;
        }
      };
    }

    async update(payload) {
      return upsertRow(
        this.table,
        this.id,
        payload,
        true
      );
    }

    async set(
      payload,
      options = {}
    ) {
      return upsertRow(
        this.table,
        this.id,
        payload,
        Boolean(options.merge)
      );
    }

    async delete() {
      return deleteRow(
        this.table,
        this.id
      );
    }
  }

  class FirestoreCollection {
    constructor(
      table,
      orderField = null,
      orderDirection = "asc"
    ) {
      assertTable(table);

      this.table = table;
      this.orderField = orderField;
      this.orderDirection =
        orderDirection;
    }

    doc(id) {
      return new FirestoreDoc(
        this.table,
        id
      );
    }

    orderBy(
      field,
      direction = "asc"
    ) {
      return new FirestoreCollection(
        this.table,
        field,
        direction
      );
    }

    async add(payload) {
      const id =
        crypto.randomUUID();

      await upsertRow(
        this.table,
        id,
        payload,
        false
      );

      return {
        id
      };
    }

    async _docs() {
      let rows =
        await listRows(this.table);

      if (this.orderField) {
        const direction =
          this.orderDirection === "desc"
            ? -1
            : 1;

        rows.sort((first, second) => {
          const firstValue =
            first[this.orderField] ??
            "";

          const secondValue =
            second[this.orderField] ??
            "";

          return (
            new Date(firstValue).getTime() -
              new Date(secondValue).getTime() ||
            String(firstValue).localeCompare(
              String(secondValue)
            )
          ) * direction;
        });
      }

      return rows.map((row) => ({
        id: String(
          row.id ??
          row.user_id
        ),

        data() {
          const copy = {
            ...row
          };

          delete copy.id;

          return copy;
        }
      }));
    }

    onSnapshot(
      callback,
      errorCallback
    ) {
      const emit = async () => {
        try {
          const docs =
            await this._docs();

          callback({
            docs,

            forEach(handler) {
              docs.forEach(handler);
            }
          });
        } catch (error) {
          (
            errorCallback ||
            console.error
          )(error);
        }
      };

      emit();

      if (!client) {
        return () => {};
      }

      const realtimeTable =
        resolveLegacyTable(
          this.table
        );

      const channel = client
        .channel(
          `legacy-firestore-${realtimeTable}-${crypto.randomUUID()}`
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: realtimeTable
          },
          emit
        )
        .subscribe();

      return () =>
        client.removeChannel(channel);
    }
  }

  function firestore() {
    return {
      collection(table) {
        return new FirestoreCollection(
          table
        );
      }
    };
  }

  firestore.FieldValue = {
    serverTimestamp: nowIso
  };

  let wrappedCurrentUser = null;

  function wrapUser(user) {
    if (!user) {
      return null;
    }

    return {
      ...user,
      uid: user.id,

      displayName:
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0] ||
        "",

      async updatePassword(password) {
        const {
          data,
          error
        } = await requireClient()
          .auth
          .updateUser({
            password
          });

        if (error) {
          throw error;
        }

        return data;
      }
    };
  }

  function auth() {
    return {
      get currentUser() {
        return wrappedCurrentUser;
      },

      onAuthStateChanged(callback) {
        if (!client) {
          queueMicrotask(
            () => callback(null)
          );

          return () => {};
        }

        client.auth
          .getUser()
          .then(({ data }) => {
            wrappedCurrentUser =
              wrapUser(
                data?.user ||
                null
              );

            callback(
              wrappedCurrentUser
            );
          })
          .catch(() => {
            callback(null);
          });

        const {
          data
        } = client.auth
          .onAuthStateChange(
            (_event, session) => {
              wrappedCurrentUser =
                wrapUser(
                  session?.user ||
                  null
                );

              callback(
                wrappedCurrentUser
              );
            }
          );

        return () =>
          data?.subscription?.unsubscribe();
      },

      async signOut() {
        if (!client) {
          return;
        }

        const {
          error
        } = await client.auth.signOut();

        if (error) {
          throw error;
        }

        wrappedCurrentUser = null;
      },

      async signInWithEmailAndPassword(
        email,
        password
      ) {
        const {
          data,
          error
        } = await requireClient()
          .auth
          .signInWithPassword({
            email,
            password
          });

        if (error) {
          throw error;
        }

        wrappedCurrentUser =
          wrapUser(data.user);

        const profile =
          await requireApprovedUser();

        const redirectUrl =
          await redirectToWorkspace(
            profile
          );

        return {
          user: wrappedCurrentUser,
          profile,
          redirectUrl
        };
      },

      async createUserWithEmailAndPassword(
        email,
        password
      ) {
        const {
          data,
          error
        } = await requireClient()
          .auth
          .signUp({
            email,
            password
          });

        if (error) {
          throw error;
        }

        wrappedCurrentUser =
          wrapUser(data.user);

        return {
          user: wrappedCurrentUser
        };
      }
    };
  }

  /*
   * Compatibility namespace for older page scripts.
   * These calls still use Supabase.
   */
  window.firebase = {
    __pgenroSupabaseCompat: true,
    apps: configured ? [{}] : [],

    initializeApp() {
      if (!this.apps.length) {
        this.apps.push({});
      }

      return this.apps[0];
    },

    database,
    firestore,
    auth,

    storage() {
      return {};
    }
  };

  window.firebaseDB = database();

  window.PGENRO_DB_COMPAT =
    Object.freeze({
      configured,
      listRows,
      getRow,
      upsertRow,
      deleteRow
    });

  /*
   * Native Supabase page-data bridge.
   */
  const pageBridgeChannels = [];

  const unwrapJsonRows =
    (rows = []) =>
      (rows || []).map((row) => ({
        ...row,
        ...(clone(row.data) || {}),
        id: String(row.id),
        createdAt:
          row.data?.createdAt ??
          row.created_at,
        updatedAt:
          row.data?.updatedAt ??
          row.updated_at
      }));

  const mapEmployeeForUser =
    (row) => ({
      id: row.id,
      employeeId:
        row.employee_id || "",
      firstName:
        row.first_name || "",
      middleName:
        row.middle_name || "",
      lastName:
        row.last_name || "",
      extension:
        row.name_extension || "",
      gender:
        row.gender || "",
      dob:
        row.dob || "",
      birthPlace:
        row.pob || "",
      civilStatus:
        row.civil_status || "",
      bloodType:
        row.blood_type || "",
      designation:
        row.designation || "",
      department:
        row.department || "",
      employmentStatus:
        row.employment_type || "",
      itemNo:
        row.item_code || "",
      dateEmployed:
        row.date_employed || "",
      salaryGrade:
        row.salary_grade || "",
      status:
        row.duty_status || "Active",
      mobile1:
        row.mobile || "",
      email:
        row.email || "",
      purok:
        row.address || "",
      barangay: "",
      municipality: "",
      province: ""
    });

  const mapTravelForUser =
    (row) => ({
      id: row.id,
      toNumber:
        row.tor_no || "",
      travelerName:
        row.traveler_name || "",
      travelerPosition:
        row.traveler_position || "",
      department:
        row.department || "",
      travelType:
        row.travel_type || "Local",
      status:
        row.status || "Pending",
      destination:
        row.destination || "",
      startDate:
        row.departure_date || "",
      endDate:
        row.return_date || "",
      transportation:
        row.transportation || "",
      purpose:
        row.purpose || "",
      perDiem:
        row.per_diem || "",
      fundSource:
        row.fund_source || "",
      approver:
        row.approver || "",
      remarks:
        row.remarks || ""
    });

  async function selectRows(
    table,
    select = "*"
  ) {
    const {
      data,
      error
    } = await requireClient()
      .from(table)
      .select(select);

    if (error) {
      throw error;
    }

    return data || [];
  }

  function watchTable(
    table,
    loader
  ) {
    if (!client) {
      return null;
    }

    const channel = client
      .channel(
        `page-bridge-${table}-${crypto.randomUUID()}`
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table
        },
        () => {
          loader().catch((error) => {
            console.warn(
              `PGENRO ${table} live reload failed:`,
              error
            );
          });
        }
      )
      .subscribe();

    pageBridgeChannels.push(channel);

    return channel;
  }

  async function startPageDataBridge() {
    if (!client || !configured) {
      return;
    }

    const path =
      window.location.pathname
        .toLowerCase();

    try {
      if (
        path.endsWith(
          "/user/communication.html"
        )
      ) {
        const load = async () => {
          const rows =
            unwrapJsonRows(
              await selectRows(
                "communications",
                "id,data,created_at,updated_at"
              )
            );

          window.loadDatabaseRecords?.(
            rows
          );
        };

        await load();
        watchTable(
          "communications",
          load
        );
      }

      if (
        path.endsWith(
          "/user/employee.html"
        )
      ) {
        const load = async () => {
          const rows =
            (
              await selectRows(
                "employees"
              )
            ).map(
              mapEmployeeForUser
            );

          window.loadDatabaseEmployees?.(
            rows
          );
        };

        await load();
        watchTable(
          "employees",
          load
        );
      }

      if (
        path.endsWith(
          "/user/travelor.html"
        )
      ) {
        const load = async () => {
          const rows =
            (
              await selectRows(
                "travel_orders"
              )
            ).map(
              mapTravelForUser
            );

          window.loadDatabaseTravelOrders?.(
            rows
          );
        };

        await load();
        watchTable(
          "travel_orders",
          load
        );
      }

      if (
        path.endsWith(
          "/user/officememo.html"
        )
      ) {
        const load = async () => {
          const rows =
            unwrapJsonRows(
              await selectRows(
                "office_memos",
                "id,data,created_at,updated_at"
              )
            );

          window.loadDatabaseMemos?.(
            rows
          );
        };

        await load();
        watchTable(
          "office_memos",
          load
        );
      }

      if (
        path.endsWith(
          "/user/homepage.html"
        )
      ) {
        const loadDashboard =
          async () => {
            if (
              !window.PGENRO_DASHBOARD
            ) {
              return;
            }

            const [
              communications,
              visitors,
              services,
              employees,
              travel,
              inventory,
              ics,
              memos
            ] = await Promise.all([
              selectRows(
                "communications",
                "id,data,created_at,updated_at"
              ).then(
                unwrapJsonRows
              ),

              selectRows(
                "visitors",
                "id,data,created_at,updated_at"
              ).then(
                unwrapJsonRows
              ),

              selectRows(
                "service_requests",
                "id,data,created_at,updated_at"
              ).then(
                unwrapJsonRows
              ),

              selectRows(
                "employees"
              ),

              selectRows(
                "travel_orders"
              ),

              selectRows(
                "inventory"
              ),

              selectRows(
                "ics_records",
                "id,data,created_at,updated_at"
              ).then(
                unwrapJsonRows
              ),

              selectRows(
                "office_memos",
                "id,data,created_at,updated_at"
              ).then(
                unwrapJsonRows
              )
            ]);

            window.PGENRO_DASHBOARD
              .loadDatabasePayload({
                communications,
                visitors,
                serviceRequests:
                  services,
                employees,
                travelOrders:
                  travel,
                inventory,
                ics,
                memos,
                status: {
                  type: "online",
                  message:
                    "Supabase Live â€¢ All Modules Synced"
                }
              });
          };

        await loadDashboard();

        [
          "communications",
          "visitors",
          "service_requests",
          "employees",
          "travel_orders",
          "inventory",
          "ics_records",
          "office_memos"
        ].forEach((table) => {
          watchTable(
            table,
            loadDashboard
          );
        });
      }
    } catch (error) {
      console.warn(
        "PGENRO page data bridge failed:",
        error
      );

      window.PGENRO_DASHBOARD
        ?.setDatabaseStatus?.(
          "offline",
          "Supabase sync unavailable"
        );
    }
  }

  const queuePageBridge = () => {
    window.setTimeout(
      startPageDataBridge,
      0
    );
  };

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      queuePageBridge,
      {
        once: true
      }
    );
  } else {
    queuePageBridge();
  }

  window.addEventListener(
    "pagehide",
    () => {
      if (!client) {
        return;
      }

      pageBridgeChannels
        .splice(0)
        .forEach((channel) => {
          try {
            client.removeChannel(
              channel
            );
          } catch (error) {
            console.warn(
              "Supabase channel cleanup warning:",
              error
            );
          }
        });
    },
    {
      once: true
    }
  );
})();