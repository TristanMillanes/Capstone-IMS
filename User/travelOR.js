/* Page-owned UI helpers: render new placeholders without rebuilding existing SVGs. */
const PGENRO_PageUI = (() => {
  function icons() {
    if (!window.lucide?.createIcons) return;
    const pending = document.querySelectorAll('i[data-lucide]');
    if (!pending.length) return;
    pending.forEach(el => el.setAttribute('data-pgenro-pending', el.getAttribute('data-lucide')));
    window.lucide.createIcons({nameAttr: 'data-pgenro-pending'});
    document.querySelectorAll('svg[data-pgenro-pending]').forEach(el => el.removeAttribute('data-pgenro-pending'));
  }

  const pages = new Map();
  let printing = false;
  function search(render) {
    let timer;
    return () => { clearTimeout(timer); timer = setTimeout(render, 100); };
  }
  function paginate(rows, tbody, render) {
    if (printing) return rows;
    let state = pages.get(tbody);
    if (!state) {
      const nav = document.createElement('nav');
      nav.className = 'registry-pagination';
      nav.setAttribute('aria-label', 'Registry pagination');
      nav.innerHTML = '<span class="registry-range" role="status" aria-live="polite"></span><div class="registry-page-controls"><button type="button" data-page="first" aria-label="First page">«</button><button type="button" data-page="previous">Previous</button><span class="registry-page-label"></span><button type="button" data-page="next">Next</button><button type="button" data-page="last" aria-label="Last page">»</button></div>';
      const table = tbody.closest('table');
      const region = table.closest('.table-wrapper, .table-responsive, .table-wrap, .table-container, .table-scroll, .table-frame') || table;
      region.after(nav);
      state = {page: 1, totalPages: 1, key: null, nav, render};
      pages.set(tbody, state);
      nav.addEventListener('click', event => {
        const button = event.target.closest('button[data-page]');
        if (!button || button.disabled) return;
        const action = button.dataset.page;
        state.page = action === 'first' ? 1 : action === 'last' ? state.totalPages : state.page + (action === 'next' ? 1 : -1);
        state.render();
      });
    }
    // Filter changes start at page one; realtime updates clamp the current page.
    const key = [...document.querySelectorAll('main input, main select, main .tab-btn.active')]
      .map(el => `${el.id}:${el.value || el.dataset.filter || ''}`).join('\u001f');
    if (state.key !== key) state.page = 1;
    state.key = key;
    state.render = render;
    state.totalPages = Math.max(1, Math.ceil(rows.length / 25));
    state.page = Math.max(1, Math.min(state.page, state.totalPages));
    const start = (state.page - 1) * 25;
    state.nav.hidden = rows.length === 0;
    const range = `${rows.length ? start + 1 : 0}–${Math.min(start + 25, rows.length)} of ${rows.length.toLocaleString()} records`;
    const label = `Page ${state.page} of ${state.totalPages}`;
    const rangeEl = state.nav.querySelector('.registry-range');
    const labelEl = state.nav.querySelector('.registry-page-label');
    if (rangeEl.textContent !== range) rangeEl.textContent = range;
    if (labelEl.textContent !== label) labelEl.textContent = label;
    state.nav.querySelectorAll('button').forEach(button => {
      button.disabled = ['first', 'previous'].includes(button.dataset.page) ? state.page === 1 : state.page === state.totalPages;
    });
    return rows.slice(start, start + 25);
  }
  // Registry printing and export retain the complete filtered dataset.
  window.addEventListener('beforeprint', () => { printing = true; pages.forEach(state => state.render()); });
  window.addEventListener('afterprint', () => { printing = false; pages.forEach(state => state.render()); });
  return {icons, paginate, search};
})();

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

  PGENRO_PageUI.icons();

  // Responsive navigation is owned below by this page.

  const escapeHtml = (value) => {
    const node = document.createElement("div");
    node.textContent = value == null ? "" : String(value);
    return node.innerHTML;
  };

  function renderTable() {
    if (!tableBody) return;
    const pageRows = PGENRO_PageUI.paginate(travelOrders, tableBody, renderTable);
    document.getElementById("metricTotal").textContent = travelOrders.length;
    document.getElementById("metricPending").textContent = travelOrders.filter(t => String(t.status).toLowerCase() === "pending").length;
    document.getElementById("metricApproved").textContent = travelOrders.filter(t => ["approved", "active"].includes(String(t.status).toLowerCase())).length;

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

    tableBody.innerHTML = pageRows.map(order => {
      const statusClass = String(order.status || "Pending")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-");
      return `
        <tr>
          <td><strong>${escapeHtml(order.toNumber || "-")}</strong></td>
          <td>${escapeHtml(order.travelerName || "-")}</td>
          <td>${escapeHtml(order.destination || "-")}</td>
          <td>${escapeHtml(order.startDate || "-")} to ${escapeHtml(order.endDate || "-")}</td>
          <td>${escapeHtml(order.travelType || "Local")}</td>
          <td><span class="status-pill status-${statusClass}">${escapeHtml(order.status || "Pending")}</span></td>
        </tr>
      `;
    }).join("");

    PGENRO_PageUI.icons();
  }

  // Hook for database integration
  window.loadDatabaseTravelOrders = function(dbOrders) {
    travelOrders = dbOrders || [];
    renderTable();
  };

  const normalizeTravelOrder = (row) => {
    const record = row.data && typeof row.data === "object" ? {...row.data, id:row.id} : row;
    return {
      ...record,
      toNumber: record.toNumber || record.torNo || record.tor_no || record.controlNo || record.control_no || "",
      travelerName: record.travelerName || record.traveler_name || record.employeeName || record.traveler || "",
      travelerPosition: record.travelerPosition || record.traveler_position || "",
      travelType: record.travelType || record.travel_type || record.type || "Local",
      startDate: record.startDate || record.departure_date || record.dateFrom || "",
      endDate: record.endDate || record.return_date || record.dateTo || "",
      perDiem: record.perDiem ?? record.per_diem,
      fundSource: record.fundSource || record.fund_source || "",
      createdAt: row.created_at || record.createdAt,
      updatedAt: row.updated_at || record.updatedAt
    };
  };

  async function loadTravelOrders() {
    if (!window.PGENRO_SUPABASE?.configured || !supabase) return;

    try {
      const { data, error } = await supabase
        .from("travel_orders")
        .select("*")
        .order("id", { ascending: false });

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

    PGENRO_PageUI.icons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUserShell, { once: true });
  } else {
    initUserShell();
  }
})();

/* ===== PGENRO DEPTH MOTION · page-owned, short animations only ===== */
(() => {
  'use strict';
  function initDepthWorkspace() {
    const body = document.body;
    if (!body?.classList.contains('depth-workspace') || body.dataset.depthReady) return;
    body.dataset.depthReady = 'true';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    document.querySelectorAll('main .kpi-card, main .stat-card, main .metric-card, main .module-control-card')
      .forEach(card => card.classList.add('depth-tilt'));
    let observer;
    function configure() {
      observer?.disconnect();
      body.classList.toggle('depth-motion-paused', document.hidden || reduce.matches);
      if (reduce.matches) {
        document.querySelectorAll('.depth-entered').forEach(el => el.classList.remove('depth-entered'));
        return;
      }
      if (!('IntersectionObserver' in window)) return;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          if (body.dataset.pageTransition === 'entering') { observer.unobserve(el); return; }
          el.classList.add('depth-entered');
          el.addEventListener('animationend', event => {
            if (event.target === el) el.classList.remove('depth-entered');
          }, {once: true});
          observer.unobserve(el);
        });
      }, {threshold: .04});
      document.querySelectorAll('.main-content > section, .main-content > .card, .main-content > .panel, .content-shell > section, .settings-panel.active')
        .forEach((el, index) => {
          if (el.dataset.depthSeen) return;
          el.dataset.depthSeen = 'true';
          el.style.setProperty('--depth-delay', `${Math.min(index, 3) * 40}ms`);
          observer.observe(el);
        });
    }
    configure();
    reduce.addEventListener?.('change', configure);
    document.addEventListener('visibilitychange', () => body.classList.toggle('depth-motion-paused', document.hidden || reduce.matches));
    window.addEventListener('pagehide', () => observer?.disconnect());
    window.addEventListener('pageshow', event => { if (event.persisted) configure(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDepthWorkspace, {once: true});
  else initDepthWorkspace();
})();
/* ===== END PGENRO DEPTH MOTION ===== */

/* ===== PGENRO SLIDE NAVIGATION AND LOGOUT · module-owned presentation ===== */
(() => {
  'use strict';
  function initWorkspaceNavigation() {
    const body = document.body;
    if (!body?.classList.contains('depth-workspace') || body.dataset.navigationReady) return;
    body.dataset.navigationReady = 'true';
    const surface = document.querySelector('main');
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => media.matches || body.classList.contains('pgenro-reduced-motion');
    let navigationPending = false, navigationTimer = 0, entranceTimer = 0;

    function resetTransition() {
      clearTimeout(entranceTimer);
      clearTimeout(navigationTimer);
      navigationPending = false;
      surface?.classList.remove('workspace-slide-enter', 'workspace-slide-leave');
      body.classList.remove('workspace-transitioning');
      body.dataset.pageTransition = 'idle';
    }
    function enter() {
      resetTransition();
      if (!surface || reduced()) return;
      body.classList.add('workspace-transitioning');
      body.dataset.pageTransition = 'entering';
      surface.classList.add('workspace-slide-enter');
      entranceTimer = setTimeout(resetTransition, 280);
    }
    // One short compositor animation, with no continuous rendering loop.
    enter();
    window.addEventListener('pageshow', event => { if (event.persisted) enter(); });
    media.addEventListener?.('change', () => { if (!navigationPending) resetTransition(); });

    window.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self') || link.getAttribute('aria-disabled') === 'true') return;
      const destination = new URL(link.href, location.href);
      if (destination.origin !== location.origin || !/\/(?:admin|User|SettingIMS)\/[^/]+\.html$/i.test(destination.pathname)) return;
      if (destination.pathname === location.pathname && destination.search === location.search) return;
      event.preventDefault();
      if (navigationPending || document.querySelector('dialog[open]')) return;
      navigationPending = true;
      clearTimeout(entranceTimer);
      const go = () => location.assign(destination.href);
      if (reduced() || !surface) { go(); return; }
      surface.classList.remove('workspace-slide-enter');
      surface.classList.add('workspace-slide-leave');
      body.classList.add('workspace-transitioning');
      body.dataset.pageTransition = 'leaving';
      navigationTimer = setTimeout(go, 140);
    });

    let dialog = null, resolveConfirmation = null, confirmationPromise = null, busy = false, returnFocus = null;
    function setBusy(value) {
      busy = value;
      dialog.classList.toggle('is-busy', value);
      dialog.setAttribute('aria-busy', String(value));
      dialog.querySelector('[data-workspace-logout-cancel]').disabled = value;
      dialog.querySelector('[data-workspace-logout-confirm]').disabled = value;
      dialog.querySelector('[data-workspace-logout-confirm] span').textContent = value ? 'Logging out…' : 'Yes, log out';
    }
    function dismiss() {
      if (busy) return;
      const done = resolveConfirmation;
      resolveConfirmation = null; confirmationPromise = null;
      dialog.close();
      body.classList.remove('workspace-logout-open');
      done?.(false);
      if (returnFocus?.isConnected && returnFocus.getClientRects().length && !returnFocus.closest('[inert]')) returnFocus.focus({preventScroll: true});
      else document.querySelector('#profileBtn, [data-pgenro-logout]')?.focus({preventScroll: true});
    }
    function confirmLogout() {
      if (busy) return;
      dialog.querySelector('.workspace-logout-error').textContent = '';
      setBusy(true);
      if (resolveConfirmation) {
        const done = resolveConfirmation; resolveConfirmation = null; done(true);
      } else {
        // Retry uses the existing session gateway; never opens a second prompt.
        window.PGENRO_API?.signOut?.({confirm: false, ask: false});
      }
    }
    function createDialog() {
      if (dialog) return;
      dialog = document.createElement('dialog');
      dialog.id = 'workspaceLogoutDialog';
      dialog.className = 'workspace-logout-dialog';
      dialog.setAttribute('aria-labelledby', 'workspaceLogoutTitle');
      dialog.setAttribute('aria-describedby', 'workspaceLogoutDescription');
      dialog.innerHTML = `
        <div class="workspace-logout-content">
          <div class="workspace-logout-heading"><span class="workspace-logout-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg></span><span class="workspace-logout-brand">PGENRO IMS<span>Secure workspace</span></span></div>
          <h2 id="workspaceLogoutTitle">Log out of your workspace?</h2>
          <p id="workspaceLogoutDescription">You’ll need to sign in again to access your records and office modules.</p>
          <p class="workspace-logout-error" role="alert"></p>
          <div class="workspace-logout-actions"><button type="button" class="workspace-logout-cancel" data-workspace-logout-cancel autofocus>Cancel</button><button type="button" class="workspace-logout-confirm" data-workspace-logout-confirm><span>Yes, log out</span></button></div>
        </div>`;
      body.appendChild(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
      dialog.addEventListener('click', event => {
        event.stopPropagation();
        if (event.target.closest('[data-workspace-logout-cancel]')) dismiss();
        else if (event.target.closest('[data-workspace-logout-confirm]')) confirmLogout();
        else if (event.target === dialog) {
          const rect = dialog.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
        }
      });
    }
    // The auth gateway asks this page-owned UI for confirmation before signing out.
    window.PGENRO_ConfirmLogout = () => {
      if (confirmationPromise) return confirmationPromise;
      createDialog();
      returnFocus = document.activeElement;
      dialog.querySelector('.workspace-logout-error').textContent = '';
      setBusy(false);
      confirmationPromise = new Promise(resolve => { resolveConfirmation = resolve; });
      if (!dialog.open) dialog.showModal();
      body.classList.add('workspace-logout-open');
      dialog.querySelector('[data-workspace-logout-cancel]').focus({preventScroll: true});
      return confirmationPromise;
    };
    window.addEventListener('pgenro:logout-error', () => {
      if (!dialog?.open) return;
      confirmationPromise = null; resolveConfirmation = null;
      setBusy(false);
      dialog.querySelector('.workspace-logout-error').textContent = 'Could not log out. Check your connection and try again.';
      dialog.querySelector('[data-workspace-logout-confirm]').focus({preventScroll: true});
    });
    window.addEventListener('keydown', event => {
      if (!dialog?.open) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); dismiss();
      } else if (event.key === 'Tab') {
        const buttons = [...dialog.querySelectorAll('button:not(:disabled)')];
        if (!buttons.length) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
      }
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initWorkspaceNavigation, {once: true});
  else initWorkspaceNavigation();
})();
/* ===== END PGENRO SLIDE NAVIGATION AND LOGOUT ===== */
