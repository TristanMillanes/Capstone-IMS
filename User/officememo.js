(() => {
  "use strict";

  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP",
    memoTable: "office_memos",
    profileTable: "profiles"
  });

  const client = typeof window.supabase?.createClient === "function"
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

      kpiTotal: $("#kpiTotal"),
      kpiPinned: $("#kpiPinned"),

      recordsTable: $("#memoTableBody"),
      searchInput: $("#searchInput"),
      resultCount: $("#resultCount"),
      refreshBtn: $("#refreshRecordsBtn"),
      printBtn: $("#printRegistryBtn"),

      viewerModal: $("#viewMemoModal"),
      viewerPanel: $(".viewer-panel"),
      viewerTitle: $("#viewModalHeaderTitle"),
      pdfFrame: $("#pdfFrame"),
      noPdfMessage: $("#noPdfMessage"),
      closeViewerBtn: $("#closeViewModalBtn"),
      cancelViewerBtn: $("#cancelViewModalBtn"),

      toastContainer: $("#toastContainer")
    };

    const state = {
      records: [],
      currentProfile: null,
      realtimeChannel: null,
      loading: false,
      viewerOpen: false,
      lastFocusedElement: null
    };

    const mobileQuery = window.matchMedia("(max-width: 1024px)");

    const text = (value) => String(value ?? "").trim();
    const lower = (value) => text(value).toLowerCase();
    const first = (...values) =>
      values.find((value) => value !== undefined && value !== null && text(value) !== "") ?? "";

    const refreshIcons = () => window.lucide?.createIcons?.();

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
      toast.innerHTML = `<i data-lucide="${icons[type] || icons.success}"></i><span></span>`;
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

    function mapMemo(row = {}) {
      const data = row.data && typeof row.data === "object" ? row.data : {};

      return {
        databaseId: row.id,
        id: text(first(
          data.controlNo,
          data.control_no,
          data.memoNo,
          data.memo_no,
          data.id,
          row.control_no,
          row.memo_no,
          row.id
        )),
        date: text(first(
          data.date,
          data.memoDate,
          data.memo_date,
          row.memo_date,
          row.date,
          row.created_at
        )),
        target: text(first(
          data.target,
          data.addressedTo,
          data.addressed_to,
          data.recipient,
          row.addressed_to,
          row.target
        )),
        subject: text(first(
          data.subject,
          data.subjectMatter,
          data.subject_matter,
          row.subject,
          row.subject_matter
        )),
        remarks: text(first(
          data.remarks,
          data.receivedBy,
          data.received_by,
          row.remarks,
          row.received_by
        )),
        pinned: Boolean(first(
          data.pinned,
          data.isPinned,
          data.is_pinned,
          row.pinned,
          row.is_pinned,
          false
        )),
        fileUrl: text(first(
          data.fileUrl,
          data.fileURL,
          data.file_url,
          data.pdfUrl,
          data.pdf_url,
          data.attachmentUrl,
          data.attachment_url,
          row.file_url,
          row.pdf_url,
          row.attachment_url
        )),
        createdAt: text(first(
          data.createdAt,
          data.created_at,
          row.created_at
        )),
        updatedAt: text(first(
          data.updatedAt,
          data.updated_at,
          row.updated_at
        ))
      };
    }

    function formatDate(value) {
      const raw = text(value);
      if (!raw) return "-";

      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return raw;

      return new Intl.DateTimeFormat("en-PH", {
        year: "numeric",
        month: "short",
        day: "2-digit"
      }).format(date);
    }

    function populateProfile(profile = {}) {
      const name = text(first(
        profile.full_name,
        profile.fullName,
        profile.username,
        profile.name,
        "PGENRO User"
      ));

      const role = text(first(
        profile.position,
        profile.role,
        profile.account_type,
        profile.accountType,
        "Authorized account"
      ));

      const email = text(first(
        profile.email,
        profile.authUser?.email,
        "Office account"
      ));

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
        fullName: first(profile.full_name, profile.username, user.email),
        username: profile.username || "",
        email: first(profile.email, user.email),
        contact: profile.contact || "",
        position: profile.position || "",
        division: profile.division || "",
        role: first(profile.role, "user"),
        accountType: first(profile.account_type, "Standard User"),
        status: first(profile.status, "Active")
      };

      try {
        localStorage.setItem("pgenro_current_user", JSON.stringify(cached));
        sessionStorage.setItem("pgenro_session_active", "true");
        sessionStorage.setItem("pgenro_session_token", String(user.id));
      } catch {
        // Storage is optional. The current authenticated session is authoritative.
      }

      populateProfile(cached);
    }

    async function verifySession() {
      if (!client || !ui.body.dataset.requiresAuth) return true;

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
            role: "user"
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
          email: first(profile?.email, user.email),
          authUser: user
        };

        cacheProfile(user, state.currentProfile);
        return true;
      } catch (error) {
        console.error("Unable to verify the current session:", error);
        setDatabaseStatus("offline", "Session verification failed");
        return false;
      }
    }

    function redirectToLogin() {
      const target = ui.body.dataset.loginUrl || "login.html";
      window.location.replace(target);
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
        // Continue to the login page even if browser storage is unavailable.
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

      const active = sidebarOpen || state.viewerOpen;

      ui.overlay?.classList.toggle("active", active);
      ui.overlay?.setAttribute("aria-hidden", String(!active));

      ui.body.classList.toggle("sidebar-open", sidebarOpen);
      ui.body.classList.toggle("modal-open", state.viewerOpen);
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

    function getFilteredRecords() {
      const query = lower(ui.searchInput?.value);

      if (!query) return [...state.records];

      return state.records.filter((record) => {
        const haystack = [
          record.id,
          record.date,
          record.target,
          record.subject,
          record.remarks
        ]
          .map(lower)
          .join(" ");

        return haystack.includes(query);
      });
    }

    function updateStats() {
      if (ui.kpiTotal) {
        ui.kpiTotal.textContent = String(state.records.length);
      }

      if (ui.kpiPinned) {
        ui.kpiPinned.textContent = String(
          state.records.filter((record) => record.pinned).length
        );
      }
    }

    function renderTable() {
      if (!ui.recordsTable) return;

      const records = getFilteredRecords();

      if (ui.resultCount) {
        ui.resultCount.textContent =
          `${records.length} ${records.length === 1 ? "record" : "records"}`;
      }

      if (!records.length) {
        ui.recordsTable.innerHTML = `
          <tr>
            <td class="empty" colspan="6">
              No memorandum records matched your search.
            </td>
          </tr>
        `;
        return;
      }

      ui.recordsTable.innerHTML = records
        .map((record) => {
          const index = state.records.indexOf(record);

          return `
            <tr class="${record.pinned ? "is-pinned" : ""}">
              <td>
                <span class="memo-code-badge">
                  ${escapeHtml(record.id || "-")}
                </span>
              </td>

              <td>${escapeHtml(formatDate(record.date))}</td>

              <td>
                <span class="memo-recipient" title="${escapeHtml(record.target || "-")}">
                  ${escapeHtml(record.target || "-")}
                </span>
              </td>

              <td class="memo-subject-cell">
                <span title="${escapeHtml(record.subject || "-")}">
                  ${escapeHtml(record.subject || "-")}
                </span>
              </td>

              <td class="memo-remarks">
                <span title="${escapeHtml(record.remarks || "-")}">
                  ${escapeHtml(record.remarks || "-")}
                </span>
              </td>

              <td class="action-column">
                <button class="action-btn"
                        type="button"
                        data-view-index="${index}"
                        aria-label="View attachment for ${escapeHtml(record.id || "memo")}"
                        title="View attachment">
                  <i data-lucide="eye"></i>
                </button>
              </td>
            </tr>
          `;
        })
        .join("");

      refreshIcons();
    }

    function render() {
      updateStats();
      renderTable();
    }

    async function loadMemos({ notify = false } = {}) {
      if (state.loading) return;

      if (!client) {
        setDatabaseStatus("offline", "Supabase client unavailable");
        state.records = loadLocalRecords();
        render();
        return;
      }

      state.loading = true;
      setDatabaseStatus("standby", "Loading office memos…");

      if (ui.refreshBtn) {
        ui.refreshBtn.disabled = true;
      }

      try {
        const { data, error } = await client
          .from(CONFIG.memoTable)
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;

        state.records = (data || []).map(mapMemo);

        setDatabaseStatus("online", "Office memo database connected");
        render();

        if (notify) {
          showToast("Office memorandum records refreshed.");
        }
      } catch (error) {
        console.error("Unable to load office memorandums:", error);

        setDatabaseStatus("offline", "Unable to load office memos");

        const localRecords = loadLocalRecords();

        if (localRecords.length) {
          state.records = localRecords;
          render();
          showToast(
            "Database unavailable. Showing locally cached memorandum data.",
            "warning"
          );
        } else {
          state.records = [];
          render();
          showToast(
            "Unable to load memorandum records from the database.",
            "error"
          );
        }
      } finally {
        state.loading = false;

        if (ui.refreshBtn) {
          ui.refreshBtn.disabled = false;
        }
      }
    }

    function loadLocalRecords() {
      try {
        const raw =
          JSON.parse(localStorage.getItem("officeMemos") || "[]");

        return Array.isArray(raw)
          ? raw.map((record) => mapMemo({ data: record, id: record.id }))
          : [];
      } catch {
        return [];
      }
    }

    function subscribeToRealtime() {
      if (!client || state.realtimeChannel) return;

      state.realtimeChannel = client
        .channel("user-office-memos-live")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: CONFIG.memoTable
          },
          () => {
            loadMemos();
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setDatabaseStatus("online", "Office memo database connected");
          }
        });
    }

    function openViewer(index) {
      const record = state.records[index];
      if (!record || !ui.viewerModal) return;

      closeProfile();
      setSidebarOpen(false);

      state.lastFocusedElement = document.activeElement;
      state.viewerOpen = true;

      if (ui.viewerTitle) {
        ui.viewerTitle.textContent =
          `${record.id || "Memorandum"} — Document Viewer`;
      }

      if (record.fileUrl) {
        if (ui.pdfFrame) {
          ui.pdfFrame.style.display = "block";
          ui.pdfFrame.src = record.fileUrl;
        }

        ui.noPdfMessage?.classList.add("hidden");
      } else {
        if (ui.pdfFrame) {
          ui.pdfFrame.src = "";
          ui.pdfFrame.style.display = "none";
        }

        ui.noPdfMessage?.classList.remove("hidden");
      }

      ui.viewerModal.classList.add("open");
      ui.viewerModal.setAttribute("aria-hidden", "false");

      syncOverlay();
      refreshIcons();

      requestAnimationFrame(() => {
        ui.closeViewerBtn?.focus();
      });
    }

    function closeViewer() {
      if (!state.viewerOpen || !ui.viewerModal) return;

      state.viewerOpen = false;

      ui.viewerModal.classList.remove("open");
      ui.viewerModal.setAttribute("aria-hidden", "true");

      if (ui.pdfFrame) {
        ui.pdfFrame.src = "";
        ui.pdfFrame.style.display = "block";
      }

      ui.noPdfMessage?.classList.add("hidden");

      syncOverlay();
      state.lastFocusedElement?.focus?.();
    }

    function bindEvents() {
      ui.hamburger?.addEventListener("click", (event) => {
        event.preventDefault();
        closeProfile();
        setSidebarOpen(!ui.sidebar?.classList.contains("open"));
      });

      ui.overlay?.addEventListener("click", () => {
        if (state.viewerOpen) {
          closeViewer();
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

      ui.searchInput?.addEventListener("input", renderTable);

      ui.refreshBtn?.addEventListener("click", () => {
        loadMemos({ notify: true });
      });

      ui.printBtn?.addEventListener("click", () => {
        window.print();
      });

      ui.recordsTable?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-view-index]");
        if (!button) return;

        const index = Number(button.dataset.viewIndex);

        if (Number.isInteger(index)) {
          openViewer(index);
        }
      });

      ui.closeViewerBtn?.addEventListener("click", closeViewer);
      ui.cancelViewerBtn?.addEventListener("click", closeViewer);

      ui.viewerModal?.addEventListener("click", (event) => {
        if (event.target === ui.viewerModal) {
          closeViewer();
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        if (state.viewerOpen) {
          closeViewer();
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
        const cached =
          JSON.parse(localStorage.getItem("pgenro_current_user") || "{}");
        populateProfile(cached);
      } catch {
        populateProfile();
      }

      const allowed = await verifySession();

      if (!allowed && ui.body.dataset.requiresAuth) {
        return;
      }

      await loadMemos();
      subscribeToRealtime();
    }

    start();
  }
})();
