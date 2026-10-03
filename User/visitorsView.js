(() => {
  "use strict";

  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP",
    visitorTable: "visitors",
    profileTable: "profiles",
    rowsPerPage: 10
  });

  const client = window.pgenroSupabase || (typeof window.supabase?.createClient === "function"
    ? window.supabase.createClient(CONFIG.url, CONFIG.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      })
    : null);

  window.pgenroSupabase = client;
  window.PGENRO_SUPABASE = Object.freeze({
    ...CONFIG,
    sdkReady: Boolean(client),
    configured: Boolean(client)
  });

  document.addEventListener("DOMContentLoaded", init, { once: true });

  function init() {
    const $ = (selector, parent = document) => parent.querySelector(selector);
    const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

    const ui = {
      body: document.body,

      overlay: $("#overlay"),
      sidebar: $("#sidebar"),
      hamburger: $("#hamburgerMenu"),

      profileMenu: $("#profileMenu"),
      profileBtn: $("#profileBtn"),
      profileDropdown: $("#profileDropdown"),
      logoutBtn: $("#logoutBtn"),

      dbStatusIndicator: $("#dbStatusIndicator"),
      dbStatusText: $("#dbStatusText"),

      total: $("#summaryTotal"),
      today: $("#summaryToday"),
      inside: $("#summaryInside"),
      todayDate: $("#todayDateStr"),

      search: $("#visitorSearch"),
      purpose: $("#purposeFilter"),
      status: $("#statusFilter"),
      tableBody: $("#visitorTableBody"),
      emptyState: $("#emptyState"),

      showing: $("#showingCountText"),
      pageSummary: $("#pageSummary"),
      pageIndicator: $("#pageIndicator"),
      prevPage: $("#prevPageBtn"),
      nextPage: $("#nextPageBtn"),

      exportCsv: $("#exportCsvBtn"),
      refresh: $("#refreshBtn"),

      drawer: $("#detailDrawer"),
      closeDrawer: $("#closeDrawerBtn"),
      toggleCheckout: $("#toggleCheckoutBtn"),
      printPass: $("#printPassBtn"),

      drawerName: $("#drawerName"),
      drawerFullname: $("#drawerFullname"),
      drawerAvatar: $("#drawerAvatar"),
      drawerStatusBadge: $("#drawerStatusBadge"),
      drawerContact: $("#drawerContact"),
      drawerAddress: $("#drawerAddress"),
      drawerPerson: $("#drawerPerson"),
      drawerPurpose: $("#drawerPurpose"),
      drawerTimeIn: $("#drawerTimeIn"),
      drawerDate: $("#drawerDate"),
      drawerTimeOut: $("#drawerTimeOut"),

      toastContainer: $("#toastContainer")
    };

    const state = {
      visitors: [],
      selectedVisitor: null,
      currentPage: 1,
      activeDateFilter: "all",
      realtimeChannel: null,
      loading: false,
      drawerOpen: false,
      lastFocusedElement: null,
      currentProfile: null
    };

    const mobileQuery = window.matchMedia("(max-width: 1024px)");

    const text = (value) => String(value ?? "").trim();
    const lower = (value) => text(value).toLowerCase();

    function refreshIcons() {
      window.lucide?.createIcons?.();
    }

    function escapeHtml(value) {
      return text(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function showToast(message, type = "success") {
      if (!ui.toastContainer) return;

      const icons = {
        success: "circle-check",
        warning: "triangle-alert",
        error: "circle-alert"
      };

      const toast = document.createElement("div");
      toast.className = `toast ${type}`;
      toast.innerHTML = `
        <i data-lucide="${icons[type] || icons.success}"></i>
        <span></span>
      `;

      toast.querySelector("span").textContent = message;
      ui.toastContainer.appendChild(toast);

      refreshIcons();
      window.setTimeout(() => toast.remove(), 3200);
    }

    function setDatabaseStatus(type, message) {
      if (ui.dbStatusIndicator) {
        ui.dbStatusIndicator.className = `status-indicator ${type}`;
      }

      if (ui.dbStatusText) {
        ui.dbStatusText.textContent = message;
      }
    }

    function formatDate(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return "";
      }

      return new Intl.DateTimeFormat("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric"
      }).format(date);
    }

    function formatTime(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return "";
      }

      return new Intl.DateTimeFormat("en-PH", {
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
    }

    function normalizeVisitor(row = {}) {
      const timeInDate = row.time_in
        ? new Date(row.time_in)
        : row.created_at
          ? new Date(row.created_at)
          : null;

      const timeOutDate = row.time_out ? new Date(row.time_out) : null;

      let visitDate = null;

      if (row.visit_date) {
        visitDate = new Date(`${row.visit_date}T00:00:00`);
      } else if (timeInDate && !Number.isNaN(timeInDate.getTime())) {
        visitDate = timeInDate;
      }

      const timestamp =
        timeInDate && !Number.isNaN(timeInDate.getTime())
          ? timeInDate.getTime()
          : 0;

      return {
        id: row.id,
        fullName: text(row.full_name),
        contact: text(row.contact),
        address: text(row.address),
        personToVisit: text(row.person_to_visit),
        purposeCategory: text(row.purpose_category),
        otherPurposeSpecific: text(row.other_purpose_specific),
        dateISO: text(row.visit_date),
        date: visitDate ? formatDate(visitDate) : "",
        dateKey: visitDate
          ? `${visitDate.getFullYear()}-${String(visitDate.getMonth() + 1).padStart(2, "0")}-${String(visitDate.getDate()).padStart(2, "0")}`
          : "",
        timeIn: timeInDate ? formatTime(timeInDate) : "",
        timeOut: timeOutDate ? formatTime(timeOutDate) : "",
        timestamp,
        status: text(row.status) || (row.time_out ? "completed" : "inside"),
        raw: row
      };
    }

    function getInitials(name) {
      return (text(name) || "Guest")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "??";
    }

    function purposeClass(purpose = "") {
      const value = lower(purpose);

      if (value.includes("speaker")) return "tag-purple";
      if (value.includes("water quality")) return "tag-blue";
      if (value.includes("technical")) return "tag-orange";
      if (value.includes("information") || value.includes("i.e.c")) return "tag-green";

      return "tag-gray";
    }

    function populateProfile(profile = {}) {
      const name =
        text(profile.fullName) ||
        text(profile.full_name) ||
        text(profile.username) ||
        text(profile.name) ||
        "PGENRO User";

      const role =
        text(profile.position) ||
        text(profile.role) ||
        text(profile.accountType) ||
        text(profile.account_type) ||
        "Authorized account";

      const email =
        text(profile.email) ||
        text(profile.authUser?.email) ||
        "Office account";

      $$(".profile-text strong").forEach((node) => {
        node.textContent = name;
      });

      $$(".profile-text small").forEach((node) => {
        node.textContent = role;
      });

      $$(".profile-dropdown-header h3").forEach((node) => {
        node.textContent = name;
      });

      $$(".profile-dropdown-header p").forEach((node) => {
        node.textContent = email;
      });
    }

    function cacheProfile(user, profile = {}) {
      const cached = {
        id: user.id,
        uid: user.id,
        fullName:
          text(profile.full_name) ||
          text(profile.username) ||
          text(user.email) ||
          "PGENRO User",
        username: text(profile.username),
        email: text(profile.email) || text(user.email),
        contact: text(profile.contact),
        position: text(profile.position),
        division: text(profile.division),
        role: text(profile.role) || "user",
        accountType: text(profile.account_type) || "Standard User",
        status: text(profile.status) || "Active"
      };

      try {
        localStorage.setItem("pgenro_current_user", JSON.stringify(cached));
        sessionStorage.setItem("pgenro_session_active", "true");
        sessionStorage.setItem("pgenro_session_token", String(user.id));
      } catch {
        // Browser storage is optional.
      }

      populateProfile(cached);
    }

    async function verifySession() {
      if (!client || !ui.body.dataset.requiresAuth) {
        return true;
      }

      try {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;

        const user = data?.session?.user;

        if (!user) {
          redirectToLogin();
          return false;
        }

        const { data: profile, error: profileError } = await client
          .from(CONFIG.profileTable)
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (profileError) {
          console.warn("Profile details were unavailable:", profileError);

          state.currentProfile = {
            email: user.email,
            role: "user",
            authUser: user
          };

          populateProfile(state.currentProfile);
          return true;
        }

        const currentRole = lower(profile?.role).replace(/\s+/g, " ").trim();
        if (["admin", "administrator", "super admin", "superadmin", "system administrator"].includes(currentRole)) {
          window.location.replace("../admin/admin.html");
          return false;
        }

        const status = lower(profile?.status);
        const hasExplicitActiveFlag = typeof profile?.is_active === "boolean";

        if (
          profile &&
          (
            (hasExplicitActiveFlag && profile.is_active === false) ||
            (status && !["active", "approved"].includes(status))
          )
        ) {
          await logout({ ask: false });
          return false;
        }

        state.currentProfile = {
          ...(profile || {}),
          email: text(profile?.email) || text(user.email),
          authUser: user
        };

        cacheProfile(user, state.currentProfile);
        return true;
      } catch (error) {
        console.error("Unable to verify the current session:", error);
        setDatabaseStatus("offline", "Session verification failed");
        showToast("Unable to verify your account session.", "error");
        return false;
      }
    }

    function redirectToLogin() {
      window.location.replace(ui.body.dataset.loginUrl || "login.html");
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

    async function logout({ ask = true } = {}) {
      if (ask && !(await showLogoutDialog())) {
        return;
      }

      try {
        await client?.auth.signOut();
      } catch (error) {
        console.warn("Remote sign-out was unavailable:", error);
      }

      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("sb-") || key.startsWith("pgenro_")) {
            localStorage.removeItem(key);
          }
        }

        sessionStorage.clear();
      } catch {
        // Continue even if browser storage is unavailable.
      }

      redirectToLogin();
    }

    function closeProfile() {
      ui.profileMenu?.classList.remove("open");
      ui.profileBtn?.setAttribute("aria-expanded", "false");
      ui.profileDropdown?.setAttribute("aria-hidden", "true");
    }

    function toggleProfile() {
      if (!ui.profileMenu || !ui.profileBtn || !ui.profileDropdown) return;

      const shouldOpen = !ui.profileMenu.classList.contains("open");
      closeProfile();

      if (shouldOpen) {
        ui.profileMenu.classList.add("open");
        ui.profileBtn.setAttribute("aria-expanded", "true");
        ui.profileDropdown.setAttribute("aria-hidden", "false");
      }
    }

    function syncOverlay() {
      const sidebarOpen =
        mobileQuery.matches &&
        Boolean(ui.sidebar?.classList.contains("open"));

      const active = sidebarOpen || state.drawerOpen;

      ui.overlay?.classList.toggle("active", active);
      ui.overlay?.setAttribute("aria-hidden", String(!active));

      ui.body.classList.toggle("sidebar-open", sidebarOpen);
      ui.body.classList.toggle("drawer-open", state.drawerOpen);
    }

    function setSidebarOpen(open) {
      const shouldOpen = Boolean(open && mobileQuery.matches);

      ui.sidebar?.classList.toggle("open", shouldOpen);
      ui.hamburger?.classList.toggle("active", shouldOpen);
      ui.hamburger?.setAttribute("aria-expanded", String(shouldOpen));
      ui.hamburger?.setAttribute(
        "aria-label",
        shouldOpen ? "Close module menu" : "Open module menu"
      );

      syncOverlay();
    }

    function getTodayKey() {
      const now = new Date();

      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }

    function getWeekStart() {
      const now = new Date();
      const start = new Date(now);
      const day = start.getDay();
      const diff = day === 0 ? -6 : 1 - day;

      start.setDate(start.getDate() + diff);
      start.setHours(0, 0, 0, 0);

      return start;
    }

    function getFilteredVisitors() {
      const search = lower(ui.search?.value);
      const purpose = ui.purpose?.value || "all";
      const status = ui.status?.value || "all";
      const todayKey = getTodayKey();
      const weekStart = getWeekStart();

      return state.visitors
        .filter((visitor) => {
          const haystack = [
            visitor.fullName,
            visitor.contact,
            visitor.address,
            visitor.personToVisit,
            visitor.purposeCategory,
            visitor.otherPurposeSpecific
          ]
            .map(lower)
            .join(" ");

          const matchesSearch = !search || haystack.includes(search);

          const matchesPurpose =
            purpose === "all" ||
            visitor.purposeCategory === purpose;

          const matchesStatus =
            status === "all" ||
            lower(visitor.status) === lower(status);

          let matchesDate = true;

          if (state.activeDateFilter === "today") {
            matchesDate = visitor.dateKey === todayKey;
          }

          if (state.activeDateFilter === "week") {
            const visitorDate = visitor.timestamp
              ? new Date(visitor.timestamp)
              : visitor.dateKey
                ? new Date(`${visitor.dateKey}T00:00:00`)
                : null;

            matchesDate =
              visitorDate instanceof Date &&
              !Number.isNaN(visitorDate.getTime()) &&
              visitorDate >= weekStart;
          }

          return (
            matchesSearch &&
            matchesPurpose &&
            matchesStatus &&
            matchesDate
          );
        })
        .sort((a, b) => b.timestamp - a.timestamp);
    }

    function updateMetrics() {
      const todayKey = getTodayKey();

      if (ui.total) {
        ui.total.textContent = String(state.visitors.length);
      }

      if (ui.today) {
        ui.today.textContent = String(
          state.visitors.filter((visitor) => visitor.dateKey === todayKey).length
        );
      }

      if (ui.inside) {
        ui.inside.textContent = String(
          state.visitors.filter(
            (visitor) => lower(visitor.status) === "inside"
          ).length
        );
      }

      if (ui.todayDate) {
        ui.todayDate.textContent = formatDate(new Date());
      }
    }

    function renderTable() {
      if (!ui.tableBody) return;

      const filtered = getFilteredVisitors();
      const total = filtered.length;

      const totalPages = Math.max(
        1,
        Math.ceil(total / CONFIG.rowsPerPage)
      );

      state.currentPage = Math.min(
        Math.max(state.currentPage, 1),
        totalPages
      );

      const startIndex =
        (state.currentPage - 1) * CONFIG.rowsPerPage;

      const rows = filtered.slice(
        startIndex,
        startIndex + CONFIG.rowsPerPage
      );

      if (ui.showing) {
        ui.showing.textContent = total
          ? `Showing ${startIndex + 1}–${Math.min(startIndex + CONFIG.rowsPerPage, total)} of ${total} visitors`
          : "Showing 0 visitors";
      }

      if (ui.pageSummary) {
        ui.pageSummary.textContent =
          `Page ${state.currentPage} of ${totalPages}`;
      }

      if (ui.pageIndicator) {
        ui.pageIndicator.textContent =
          `${state.currentPage} / ${totalPages}`;
      }

      if (ui.prevPage) {
        ui.prevPage.disabled = state.currentPage <= 1;
      }

      if (ui.nextPage) {
        ui.nextPage.disabled = state.currentPage >= totalPages;
      }

      if (!rows.length) {
        ui.tableBody.innerHTML = "";
        ui.emptyState?.classList.remove("hidden");
        return;
      }

      ui.emptyState?.classList.add("hidden");

      ui.tableBody.innerHTML = rows
        .map((visitor) => {
          const inside = lower(visitor.status) === "inside";

          return `
            <tr data-visitor-id="${escapeHtml(visitor.id)}">
              <td>
                <div class="visitor-profile-cell">
                  <div class="table-avatar">
                    ${escapeHtml(getInitials(visitor.fullName))}
                  </div>

                  <div class="profile-meta">
                    <strong title="${escapeHtml(visitor.fullName || "Anonymous Guest")}">
                      ${escapeHtml(visitor.fullName || "Anonymous Guest")}
                    </strong>

                    <span title="${escapeHtml(visitor.address || "Address unspecified")}">
                      ${escapeHtml(visitor.address || "Address unspecified")}
                    </span>
                  </div>
                </div>
              </td>

              <td>
                <div class="contact-cell">
                  <strong>${escapeHtml(visitor.contact || "No contact")}</strong>
                  <span title="${escapeHtml(visitor.address || "Address unspecified")}">
                    ${escapeHtml(visitor.address || "Address unspecified")}
                  </span>
                </div>
              </td>

              <td>
                <span class="dept-pill"
                      title="${escapeHtml(visitor.personToVisit || "General Personnel")}">
                  ${escapeHtml(visitor.personToVisit || "General Personnel")}
                </span>
              </td>

              <td>
                <span class="tag-badge ${purposeClass(visitor.purposeCategory)}"
                      title="${escapeHtml(visitor.purposeCategory || "General Inquiry")}">
                  ${escapeHtml(visitor.purposeCategory || "General Inquiry")}
                </span>
              </td>

              <td>
                <div class="time-cell">
                  <strong>${escapeHtml(visitor.timeIn || "--:--")}</strong>
                  <span>${escapeHtml(visitor.date || "")}</span>
                </div>
              </td>

              <td>
                <span class="status-pill ${inside ? "status-inside" : "status-completed"}">
                  ${inside ? "In Building" : "Checked Out"}
                </span>
              </td>

              <td class="action-column">
                <button class="btn-view-row"
                        type="button"
                        data-open-visitor="${escapeHtml(visitor.id)}"
                        aria-label="Open details for ${escapeHtml(visitor.fullName || "visitor")}"
                        title="Open visitor details">
                  <i data-lucide="chevron-right"></i>
                </button>
              </td>
            </tr>
          `;
        })
        .join("");

      refreshIcons();
    }

    function render() {
      updateMetrics();
      renderTable();
    }

    async function loadVisitors({ notify = false } = {}) {
      if (state.loading) return;

      if (!client) {
        state.visitors = [];
        render();
        setDatabaseStatus("offline", "Supabase client unavailable");
        showToast("The visitor database client could not be initialized.", "error");
        return;
      }

      state.loading = true;
      setDatabaseStatus("standby", "Loading visitor records…");

      if (ui.refresh) {
        ui.refresh.disabled = true;
      }

      try {
        const { data, error } = await client
          .from(CONFIG.visitorTable)
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;

        state.visitors = (data || []).map(normalizeVisitor);

        setDatabaseStatus("online", "Visitor database connected");
        render();

        if (state.selectedVisitor) {
          const updatedSelected = state.visitors.find(
            (visitor) => String(visitor.id) === String(state.selectedVisitor.id)
          );

          if (updatedSelected) {
            state.selectedVisitor = updatedSelected;

            if (state.drawerOpen) {
              populateDrawer(updatedSelected);
            }
          }
        }

        if (notify) {
          showToast("Visitor records synchronized.");
        }
      } catch (error) {
        console.error("Unable to load visitor records:", error);

        state.visitors = [];
        render();

        setDatabaseStatus("offline", "Unable to load visitor records");

        showToast(
          error?.code === "42501"
            ? "Supabase denied access. Check the visitor RLS policy for this user."
            : "Unable to load visitor records from the database.",
          "error"
        );
      } finally {
        state.loading = false;

        if (ui.refresh) {
          ui.refresh.disabled = false;
        }
      }
    }

    function subscribeToRealtime() {
      if (!client || state.realtimeChannel) return;

      state.realtimeChannel = client
        .channel("user-visitors-live")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: CONFIG.visitorTable
          },
          () => {
            loadVisitors();
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setDatabaseStatus("online", "Visitor database connected");
          }

          if (status === "CHANNEL_ERROR") {
            setDatabaseStatus("standby", "Realtime connection interrupted");
          }
        });
    }

    function populateDrawer(visitor) {
      const inside = lower(visitor.status) === "inside";

      if (ui.drawerName) {
        ui.drawerName.textContent =
          visitor.fullName || "Guest Details";
      }

      if (ui.drawerFullname) {
        ui.drawerFullname.textContent =
          visitor.fullName || "—";
      }

      if (ui.drawerAvatar) {
        ui.drawerAvatar.textContent =
          getInitials(visitor.fullName);
      }

      if (ui.drawerContact) {
        ui.drawerContact.textContent =
          visitor.contact || "—";
      }

      if (ui.drawerAddress) {
        ui.drawerAddress.textContent =
          visitor.address || "—";
      }

      if (ui.drawerPerson) {
        ui.drawerPerson.textContent =
          visitor.personToVisit || "—";
      }

      if (ui.drawerPurpose) {
        ui.drawerPurpose.textContent =
          [
            visitor.purposeCategory,
            visitor.otherPurposeSpecific
          ]
            .filter(Boolean)
            .join(" — ") || "—";
      }

      if (ui.drawerTimeIn) {
        ui.drawerTimeIn.textContent =
          visitor.timeIn || "—";
      }

      if (ui.drawerDate) {
        ui.drawerDate.textContent =
          visitor.date || "—";
      }

      if (ui.drawerTimeOut) {
        ui.drawerTimeOut.textContent =
          visitor.timeOut || "Still in premises";
      }

      if (ui.drawerStatusBadge) {
        ui.drawerStatusBadge.textContent =
          inside ? "Currently Inside" : "Signed Out";

        ui.drawerStatusBadge.className =
          `status-pill ${inside ? "status-inside" : "status-completed"}`;
      }

      if (ui.toggleCheckout) {
        ui.toggleCheckout.className =
          inside ? "success-action" : "secondary-action";

        ui.toggleCheckout.innerHTML = inside
          ? `<i data-lucide="log-out"></i><span>Mark Departure</span>`
          : `<i data-lucide="rotate-ccw"></i><span>Re-open Visit</span>`;
      }

      refreshIcons();
    }

    function openDrawer(visitor) {
      if (!visitor || !ui.drawer) return;

      closeProfile();
      setSidebarOpen(false);

      state.selectedVisitor = visitor;
      state.drawerOpen = true;
      state.lastFocusedElement = document.activeElement;

      populateDrawer(visitor);

      ui.drawer.classList.add("open");
      ui.drawer.setAttribute("aria-hidden", "false");

      syncOverlay();

      requestAnimationFrame(() => {
        ui.closeDrawer?.focus();
      });
    }

    function closeDrawer() {
      if (!state.drawerOpen || !ui.drawer) return;

      state.drawerOpen = false;

      ui.drawer.classList.remove("open");
      ui.drawer.setAttribute("aria-hidden", "true");

      syncOverlay();

      state.lastFocusedElement?.focus?.();
    }

    async function toggleCheckout() {
      showToast("Only administrators can update visitor records.", "warning");
    }

    function exportCsv() {
      const list = getFilteredVisitors();

      if (!list.length) {
        showToast("No visitor records are available to export.", "warning");
        return;
      }

      const quote = (value) =>
        `"${String(value ?? "").replaceAll('"', '""')}"`;

      const headers = [
        "Full Name",
        "Contact",
        "Address",
        "Person / Department To Visit",
        "Purpose Category",
        "Specific Purpose",
        "Visit Date",
        "Time In",
        "Time Out",
        "Status"
      ];

      const rows = list.map((visitor) => [
        visitor.fullName,
        visitor.contact,
        visitor.address,
        visitor.personToVisit,
        visitor.purposeCategory,
        visitor.otherPurposeSpecific,
        visitor.date,
        visitor.timeIn,
        visitor.timeOut,
        visitor.status
      ]);

      const csv = [
        headers.map(quote).join(","),
        ...rows.map((row) => row.map(quote).join(","))
      ].join("\n");

      const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8"
      });

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download =
        `PGENRO_Visitors_${new Date().toISOString().slice(0, 10)}.csv`;

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      URL.revokeObjectURL(url);

      showToast("Visitor CSV exported.");
    }

    function printPass() {
      const visitor = state.selectedVisitor;

      if (!visitor) return;

      const printWindow = window.open(
        "",
        "_blank",
        "width=700,height=760"
      );

      if (!printWindow) {
        showToast(
          "The print window was blocked. Allow popups and try again.",
          "warning"
        );
        return;
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>Visitor Pass - ${escapeHtml(visitor.fullName)}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              padding: 34px;
              color: #1d2922;
              background: #ffffff;
              font-family: Arial, sans-serif;
            }
            .pass {
              max-width: 620px;
              margin: 0 auto;
              padding: 28px;
              border: 2px solid #17633a;
              border-radius: 16px;
            }
            .head {
              padding-bottom: 18px;
              border-bottom: 1px solid #dce5df;
              text-align: center;
            }
            h1 {
              margin: 0;
              color: #103d28;
              font-size: 24px;
            }
            .sub {
              margin: 6px 0 0;
              color: #66736b;
              font-size: 12px;
            }
            .field {
              margin-top: 16px;
            }
            .field span {
              display: block;
              margin-bottom: 4px;
              color: #66736b;
              font-size: 10px;
              font-weight: 700;
              letter-spacing: .08em;
              text-transform: uppercase;
            }
            .field strong {
              font-size: 15px;
            }
          </style>
        </head>
        <body>
          <div class="pass">
            <div class="head">
              <h1>PGENRO Visitor Pass</h1>
              <p class="sub">Provincial Government Environment and Natural Resources Office</p>
            </div>

            <div class="field">
              <span>Visitor Name</span>
              <strong>${escapeHtml(visitor.fullName || "—")}</strong>
            </div>

            <div class="field">
              <span>Person / Department To Visit</span>
              <strong>${escapeHtml(visitor.personToVisit || "—")}</strong>
            </div>

            <div class="field">
              <span>Purpose</span>
              <strong>${escapeHtml(
                [visitor.purposeCategory, visitor.otherPurposeSpecific]
                  .filter(Boolean)
                  .join(" — ") || "—"
              )}</strong>
            </div>

            <div class="field">
              <span>Date / Time In</span>
              <strong>${escapeHtml(visitor.date || "—")} ${visitor.timeIn ? `@ ${escapeHtml(visitor.timeIn)}` : ""}</strong>
            </div>

            <div class="field">
              <span>Status</span>
              <strong>${lower(visitor.status) === "inside" ? "Currently Inside" : "Checked Out"}</strong>
            </div>
          </div>
        </body>
        </html>
      `);

      printWindow.document.close();
      printWindow.focus();

      window.setTimeout(() => {
        printWindow.print();
      }, 150);
    }

    function bindEvents() {
      ui.hamburger?.addEventListener("click", (event) => {
        event.preventDefault();
        closeProfile();
        setSidebarOpen(!ui.sidebar?.classList.contains("open"));
      });

      ui.overlay?.addEventListener("click", () => {
        if (state.drawerOpen) {
          closeDrawer();
          return;
        }

        if (ui.sidebar?.classList.contains("open")) {
          setSidebarOpen(false);
        }
      });

      $$(".modules-list a").forEach((link) => {
        link.addEventListener("click", () => {
          closeProfile();

          if (mobileQuery.matches) {
            setSidebarOpen(false);
          }
        });
      });

      ui.profileBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleProfile();
      });

      ui.profileMenu?.addEventListener("click", (event) => {
        event.stopPropagation();
      });

      document.addEventListener("click", (event) => {
        if (
          ui.profileMenu?.classList.contains("open") &&
          !ui.profileMenu.contains(event.target)
        ) {
          closeProfile();
        }
      });

      ui.logoutBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        logout();
      });

      ui.search?.addEventListener("input", () => {
        state.currentPage = 1;
        renderTable();
      });

      ui.purpose?.addEventListener("change", () => {
        state.currentPage = 1;
        renderTable();
      });

      ui.status?.addEventListener("change", () => {
        state.currentPage = 1;
        renderTable();
      });

      $$(".date-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          $$(".date-chip").forEach((item) => {
            item.classList.remove("active");
          });

          chip.classList.add("active");

          state.activeDateFilter =
            chip.dataset.range || "all";

          state.currentPage = 1;
          renderTable();
        });
      });

      ui.prevPage?.addEventListener("click", () => {
        if (state.currentPage <= 1) return;

        state.currentPage -= 1;
        renderTable();
      });

      ui.nextPage?.addEventListener("click", () => {
        const totalPages = Math.max(
          1,
          Math.ceil(
            getFilteredVisitors().length / CONFIG.rowsPerPage
          )
        );

        if (state.currentPage >= totalPages) return;

        state.currentPage += 1;
        renderTable();
      });

      ui.tableBody?.addEventListener("click", (event) => {
        const row = event.target.closest("tr[data-visitor-id]");
        if (!row) return;

        const visitor = state.visitors.find(
          (item) => String(item.id) === String(row.dataset.visitorId)
        );

        if (visitor) {
          openDrawer(visitor);
        }
      });

      ui.closeDrawer?.addEventListener("click", closeDrawer);
      ui.toggleCheckout?.addEventListener("click", toggleCheckout);
      ui.printPass?.addEventListener("click", printPass);

      ui.exportCsv?.addEventListener("click", exportCsv);

      ui.refresh?.addEventListener("click", () => {
        loadVisitors({ notify: true });
      });

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        if (state.drawerOpen) {
          closeDrawer();
          return;
        }

        if (ui.profileMenu?.classList.contains("open")) {
          closeProfile();
          ui.profileBtn?.focus();
          return;
        }

        if (ui.sidebar?.classList.contains("open")) {
          setSidebarOpen(false);
          ui.hamburger?.focus();
        }
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

      window.addEventListener("beforeunload", () => {
        if (state.realtimeChannel && client) {
          client.removeChannel(state.realtimeChannel);
        }
      }, { once: true });
    }

    async function start() {
      refreshIcons();
      bindEvents();

      try {
        const cached = JSON.parse(
          localStorage.getItem("pgenro_current_user") || "{}"
        );

        populateProfile(cached);
      } catch {
        populateProfile();
      }

      updateMetrics();

      const allowed = await verifySession();

      if (!allowed && ui.body.dataset.requiresAuth) {
        return;
      }

      await loadVisitors();
      subscribeToRealtime();
    }

    start();
  }
})();
