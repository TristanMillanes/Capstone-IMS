/* ==========================================================================
   SELF-CONTAINED SUPABASE BOOTSTRAP
   Database client, access checks, profile sync, and logout for this page.
   ========================================================================== */
(() => {
  "use strict";

  if (window.pgenroSupabase) return;

  const config = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP"
  });

  const sdkReady = typeof window.supabase?.createClient === "function";
  const client = sdkReady
    ? window.supabase.createClient(config.url, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      })
    : null;

  window.PGENRO_SUPABASE = Object.freeze({
    ...config,
    sdkReady,
    configured: Boolean(client)
  });
  window.pgenroSupabase = client;

  const adminRoles = new Set([
    "admin",
    "administrator",
    "super admin",
    "superadmin",
    "system administrator"
  ]);
  const normalizeRole = (role) => String(role || "").trim().toLowerCase().replace(/\s+/g, " ");

  async function getCurrentProfile() {
    if (!client) return null;

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;

    const user = sessionData?.session?.user;
    if (!user) return null;

    const { data: profile, error } = await client
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    return profile ? { ...profile, authUser: user } : null;
  }

  async function requireApprovedUser() {
    const profile = await getCurrentProfile();
    if (!profile) throw new Error("No active PGENRO account session was found.");

    const status = String(profile.status || "").trim().toLowerCase();
    if (profile.is_active !== true || !["active", "approved"].includes(status)) {
      throw new Error("Account access is " + (profile.status || "inactive") + ".");
    }

    return profile;
  }


  function showLogoutDialog() {
    return new Promise((resolve) => {
      let overlay = document.getElementById("pgenroLogoutDialog");

      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "pgenroLogoutDialog";
        overlay.className = "pgenro-logout-dialog";
        overlay.setAttribute("aria-hidden", "true");
        overlay.innerHTML = `
          <div class="pgenro-logout-dialog__panel" role="alertdialog" aria-modal="true" aria-labelledby="pgenroLogoutTitle" aria-describedby="pgenroLogoutMessage">
            <div class="pgenro-logout-dialog__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 17l5-5-5-5"></path>
                <path d="M15 12H3"></path>
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
              </svg>
            </div>
            <div class="pgenro-logout-dialog__content">
              <span class="pgenro-logout-dialog__eyebrow">Session</span>
              <h2 id="pgenroLogoutTitle">Log out of PGENRO IMS?</h2>
              <p id="pgenroLogoutMessage">You’ll need to sign in again to access your workspace.</p>
            </div>
            <div class="pgenro-logout-dialog__actions">
              <button class="pgenro-logout-dialog__button pgenro-logout-dialog__button--cancel" type="button" data-logout-cancel>Cancel</button>
              <button class="pgenro-logout-dialog__button pgenro-logout-dialog__button--confirm" type="button" data-logout-confirm>
                <span>Yes, log out</span>
              </button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
      }

      const panel = overlay.querySelector(".pgenro-logout-dialog__panel");
      const cancelButton = overlay.querySelector("[data-logout-cancel]");
      const confirmButton = overlay.querySelector("[data-logout-confirm]");
      const previousFocus = document.activeElement;
      let settled = false;

      const finish = (confirmed) => {
        if (settled) return;
        settled = true;

        overlay.classList.remove("is-open");
        overlay.setAttribute("aria-hidden", "true");
        document.body.classList.remove("pgenro-logout-dialog-open");
        document.removeEventListener("keydown", onKeyDown);
        overlay.removeEventListener("click", onBackdropClick);
        cancelButton?.removeEventListener("click", onCancel);
        confirmButton?.removeEventListener("click", onConfirm);

        window.setTimeout(() => {
          if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
            previousFocus.focus({ preventScroll: true });
          }
        }, 120);

        resolve(confirmed);
      };

      const onCancel = () => finish(false);
      const onConfirm = () => finish(true);
      const onBackdropClick = (event) => {
        if (event.target === overlay) finish(false);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
          return;
        }

        if (event.key !== "Tab" || !panel) return;
        const focusable = [...panel.querySelectorAll("button:not([disabled])")];
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      cancelButton?.addEventListener("click", onCancel);
      confirmButton?.addEventListener("click", onConfirm);
      overlay.addEventListener("click", onBackdropClick);
      document.addEventListener("keydown", onKeyDown);

      overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("pgenro-logout-dialog-open");
      requestAnimationFrame(() => {
        overlay.classList.add("is-open");
        cancelButton?.focus({ preventScroll: true });
      });
    });
  }

  async function signOut({ ask = true } = {}) {
    if (ask && !(await showLogoutDialog())) return false;

    try {
      await client?.auth.signOut();
    } catch (error) {
      console.warn("Remote sign-out was unavailable:", error);
    }

    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("sb-") || key.startsWith("pgenro_")) localStorage.removeItem(key);
      }
      sessionStorage.clear();
    } catch {}

    window.location.assign("login.html");
    return true;
  }

  window.PGENRO_API = Object.freeze({
    client,
    getCurrentProfile,
    requireApprovedUser,
    signOut,
    isAdminRole: (role) => adminRoles.has(normalizeRole(role))
  });

  window.PGENRO_DB = Object.freeze({
    client,
    table: "visitors",
    configured: Boolean(client),
    async getSession() {
      if (!client) return null;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session || null;
    },
    async getCurrentRole() {
      const profile = await getCurrentProfile();
      if (!profile) return null;
      return adminRoles.has(normalizeRole(profile.role)) ? "admin" : "user";
    }
  });

  const cacheProfile = (profile) => {
    if (!profile) return;

    const cached = {
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
    };

    try {
      localStorage.setItem("pgenro_current_user", JSON.stringify(cached));
      sessionStorage.setItem("pgenro_session_active", "true");
      sessionStorage.setItem("pgenro_session_token", String(profile.user_id));
    } catch {}

    document.dispatchEvent(new CustomEvent("pgenro:profile-updated", { detail: cached }));
  };

  async function guardPage() {
    if (!document.body?.dataset.requiresAuth) return;
    if (!client) return;

    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;

      if (!data.session) {
        window.location.replace("login.html");
        return;
      }

      const profile = await requireApprovedUser();
      if (adminRoles.has(normalizeRole(profile.role))) {
        window.location.replace("../admin/admin.html");
        return;
      }

      cacheProfile(profile);
    } catch (error) {
      console.error("Unable to verify this PGENRO session:", error);
    }
  }

  document.addEventListener("click", (event) => {
    const logout = event.target instanceof Element
      ? event.target.closest("#logoutBtn,[data-pgenro-logout]")
      : null;

    if (!logout) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    signOut();
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", guardPage, { once: true });
  } else {
    queueMicrotask(guardPage);
  }
})();

document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.getElementById("travelOrderTable");
  const supabase = window.pgenroSupabase;
  let realtimeChannel = null;

  // Database State: Empty Base
  let travelOrders = window.PGENRO_SUPABASE?.configured ? [] : (() => { try { const rows = JSON.parse(localStorage.getItem("travelOrders") || "[]"); return Array.isArray(rows) ? rows : []; } catch { return []; } })();

  if (window.lucide) lucide.createIcons();

  // Responsive navigation is owned below by this page.

  const escapeHtml = (value) => {
    const node = document.createElement("div");
    node.textContent = value == null ? "" : String(value);
    return node.innerHTML;
  };

  function renderTable() {
    if (!tableBody) return;
    tableBody.innerHTML = "";

    if (travelOrders.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding: 24px; color: var(--muted); font-weight:700;">
            No travel orders found in database.
          </td>
        </tr>
      `;
      return;
    }

    travelOrders.forEach(order => {
      const statusClass = String(order.status || "Pending")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-");
      tableBody.innerHTML += `
        <tr>
          <td><strong>${escapeHtml(order.toNumber || "-")}</strong></td>
          <td>${escapeHtml(order.travelerName || "-")}</td>
          <td>${escapeHtml(order.destination || "-")}</td>
          <td>${escapeHtml(order.startDate || "-")} to ${escapeHtml(order.endDate || "-")}</td>
          <td>${escapeHtml(order.travelType || "Local")}</td>
          <td><span class="status-pill status-${statusClass}">${escapeHtml(order.status || "Pending")}</span></td>
        </tr>
      `;
    });

    // Update Counters
    document.getElementById("metricTotal").textContent = travelOrders.length;
    document.getElementById("metricPending").textContent = travelOrders.filter(t => t.status === "Pending").length;
    document.getElementById("metricApproved").textContent = travelOrders.filter(t => t.status === "Approved").length;

    if (window.lucide) lucide.createIcons();
  }

  // Hook for database integration
  window.loadDatabaseTravelOrders = function(dbOrders) {
    travelOrders = dbOrders || [];
    renderTable();
  };

  const normalizeTravelOrder = (row) => ({
    id: row.id,
    toNumber: row.tor_no,
    travelerName: row.traveler_name,
    travelerPosition: row.traveler_position,
    department: row.department,
    travelType: row.travel_type,
    status: row.status,
    destination: row.destination,
    startDate: row.departure_date,
    endDate: row.return_date,
    transportation: row.transportation,
    purpose: row.purpose,
    perDiem: row.per_diem,
    fundSource: row.fund_source,
    approver: row.approver,
    remarks: row.remarks,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

  async function loadTravelOrders() {
    if (!window.PGENRO_SUPABASE?.configured || !supabase) return;

    try {
      const { data, error } = await supabase
        .from("travel_orders")
        .select("*")
        .order("departure_date", { ascending: false });

      if (error) throw error;
      window.loadDatabaseTravelOrders((data || []).map(normalizeTravelOrder));
    } catch (error) {
      console.error("Unable to load travel orders:", error);
    }
  }

  renderTable();

  loadTravelOrders().then(() => {
    if (!supabase || realtimeChannel) return;
    realtimeChannel = supabase
      .channel("user-travel-orders-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "travel_orders" }, loadTravelOrders)
      .subscribe();
  });

  window.addEventListener("beforeunload", () => {
    if (realtimeChannel && supabase) supabase.removeChannel(realtimeChannel);
  }, { once: true });
});

/* ==========================================================================
   SELF-CONTAINED USER SHELL CONTROLLER
   This page owns its sidebar, profile menu, and responsive behavior.
   ========================================================================== */
(() => {
  "use strict";

  function initUserShell() {
    const body = document.body;
    if (!body?.classList.contains("pgenro-user") || body.dataset.userShellReady === "true") return;
    body.dataset.userShellReady = "true";

    const sidebar = document.getElementById("sidebar");
    const hamburger = document.getElementById("hamburgerMenu");
    const overlay = document.getElementById("overlay");
    const profileMenu = document.getElementById("profileMenu");
    const profileButton = document.getElementById("profileBtn");
    const profileDropdown = document.getElementById("profileDropdown");
    const logoutButton = document.getElementById("logoutBtn");
    const mobileQuery = window.matchMedia("(max-width: 1024px)");

    const hasOpenDialog = () => Boolean(document.querySelector(
      ".form-modal.open, .modal-backdrop.open, .modal-backdrop.active, " +
      ".modal-wrapper.open, .modal-wrapper.active, .detail-drawer.open, " +
      ".drawer-panel.open, [role='dialog'].open, [role='dialog'].active"
    ));

    const syncOverlay = () => {
      const sidebarOpen = Boolean(mobileQuery.matches && sidebar?.classList.contains("open"));
      overlay?.classList.toggle("active", sidebarOpen || hasOpenDialog());
    };

    const closeProfile = () => {
      profileMenu?.classList.remove("open");
      profileButton?.setAttribute("aria-expanded", "false");
      profileDropdown?.setAttribute("aria-hidden", "true");
    };

    const setSidebarOpen = (open) => {
      const shouldOpen = Boolean(open && mobileQuery.matches);
      sidebar?.classList.toggle("open", shouldOpen);
      hamburger?.classList.toggle("active", shouldOpen);
      hamburger?.setAttribute("aria-expanded", String(shouldOpen));
      hamburger?.setAttribute("aria-label", shouldOpen ? "Close module menu" : "Open module menu");
      body.classList.toggle("sidebar-open", shouldOpen);
      syncOverlay();
    };

    hamburger?.addEventListener("click", (event) => {
      event.preventDefault();
      closeProfile();
      setSidebarOpen(!sidebar?.classList.contains("open"));
    });

    overlay?.addEventListener("click", () => {
      if (sidebar?.classList.contains("open")) setSidebarOpen(false);
    });

    sidebar?.querySelectorAll(".modules-list a").forEach((link) => {
      link.addEventListener("click", () => {
        closeProfile();
        if (mobileQuery.matches) setSidebarOpen(false);
      });
    });

    if (profileButton && profileMenu && profileDropdown) {
      profileDropdown.setAttribute("aria-hidden", "true");

      profileButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = !profileMenu.classList.contains("open");
        closeProfile();

        if (open) {
          profileMenu.classList.add("open");
          profileButton.setAttribute("aria-expanded", "true");
          profileDropdown.setAttribute("aria-hidden", "false");
        }
      });

      profileMenu.addEventListener("click", (event) => event.stopPropagation());
    }

    document.addEventListener("click", (event) => {
      if (profileMenu?.classList.contains("open") && !profileMenu.contains(event.target)) {
        closeProfile();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      if (profileMenu?.classList.contains("open")) {
        closeProfile();
        profileButton?.focus();
      }

      if (sidebar?.classList.contains("open")) {
        setSidebarOpen(false);
        hamburger?.focus();
      }
    });

    const populateProfile = (profile = {}) => {
      const name = profile.fullName || profile.full_name || profile.username || profile.name || "PGENRO User";
      const role = profile.position || profile.role || profile.accountType || "Authorized account";
      const email = profile.email || profile.authUser?.email || "Office account";

      document.querySelectorAll(".profile-text strong, .profile-text h4").forEach((node) => {
        node.textContent = name;
      });
      document.querySelectorAll(".profile-text small").forEach((node) => {
        node.textContent = role;
      });
      document.querySelectorAll(".profile-dropdown-header h3").forEach((node) => {
        node.textContent = name;
      });
      document.querySelectorAll(".profile-dropdown-header p").forEach((node) => {
        node.textContent = email;
      });
    };

    try {
      populateProfile(JSON.parse(localStorage.getItem("pgenro_current_user") || "{}"));
    } catch {
      populateProfile();
    }

    document.addEventListener("pgenro:profile-updated", (event) => {
      populateProfile(event.detail || {});
    });

    logoutButton?.addEventListener("click", async (event) => {
      if (window.PGENRO_API?.signOut) return;
      event.preventDefault();

      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("sb-") || key.startsWith("pgenro_")) localStorage.removeItem(key);
        }
        sessionStorage.clear();
      } catch {}

      window.location.assign(document.body.dataset.loginUrl || "login.html");
    });

    const onBreakpointChange = () => {
      closeProfile();
      setSidebarOpen(false);
    };

    if (typeof mobileQuery.addEventListener === "function") {
      mobileQuery.addEventListener("change", onBreakpointChange);
    } else {
      mobileQuery.addListener(onBreakpointChange);
    }

    window.lucide?.createIcons?.();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUserShell, { once: true });
  } else {
    initUserShell();
  }
})();
