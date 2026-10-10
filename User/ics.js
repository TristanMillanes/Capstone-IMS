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

(() => {
  "use strict";

  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP",
    table: "ics_records",
    profileTable: "profiles"
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

      dbStatusDot: $("#dbStatusDot"),
      dbStatusText: $("#dbStatusText"),

      statTotalSlips: $("#statTotalSlips"),
      statIssuedItems: $("#statIssuedItems"),
      statTotalValue: $("#statTotalValue"),
      statLatestControl: $("#statLatestControl"),

      searchInput: $("#tableSearchInput"),
      articleFilter: $("#filterArticleSelect"),
      tableBody: $("#slipTableBody"),
      recordsCounter: $("#recordsCounterText"),
      printRegistryBtn: $("#printRegistryBtn"),
      refreshBtn: $("#refreshRecordsBtn"),

      detailsModal: $("#viewDetailsModal"),
      closeDetailsBtn: $("#closeDetailsModalBtn"),
      modalCloseBtn: $("#modalCloseBtn"),
      modalPrintSlipBtn: $("#modalPrintSlipBtn"),

      modalControlNoTitle: $("#modalControlNoTitle"),
      modalArticleBadge: $("#modalArticleBadge"),
      modalAccountCode: $("#modalAccountCode"),
      modalDescription: $("#modalDescription"),
      modalSerialNo: $("#modalSerialNo"),
      modalIcsNo: $("#modalIcsNo"),
      modalEntryNo: $("#modalEntryNo"),
      modalQty: $("#modalQty"),
      modalUnit: $("#modalUnit"),
      modalUnitVal: $("#modalUnitVal"),
      modalTotalVal: $("#modalTotalVal"),
      modalDateAcquired: $("#modalDateAcquired"),
      modalPrNo: $("#modalPrNo"),
      modalPrDate: $("#modalPrDate"),
      modalAccountable: $("#modalAccountable"),
      modalRemarks: $("#modalRemarks"),

      printModal: $("#printSheetModal"),
      closePrintBtn: $("#closePrintSheetBtn"),
      dismissPrintBtn: $("#dismissPrintBtn"),
      printNowBtn: $("#printNowBtn"),

      printIcsNo: $("#printIcsNo"),
      printControlNo: $("#printControlNo"),
      printQty: $("#printQty"),
      printUnit: $("#printUnit"),
      printUnitVal: $("#printUnitVal"),
      printTotalVal: $("#printTotalVal"),
      printArticle: $("#printArticle"),
      printDesc: $("#printDesc"),
      printSerial: $("#printSerial"),
      printItemNo: $("#printItemNo"),
      printDateIssued: $("#printDateIssued"),
      printAccountablePerson: $("#printAccountablePerson"),
      printDateReceived: $("#printDateReceived"),

      toastContainer: $("#toastContainer")
    };

    const state = {
      records: [],
      currentRecord: null,
      realtimeChannel: null,
      loading: false,
      detailsOpen: false,
      printOpen: false,
      currentProfile: null,
      lastFocusedElement: null
    };

    const mobileQuery = window.matchMedia("(max-width: 1024px)");

    const text = (value) => String(value ?? "").trim();
    const lower = (value) => text(value).toLowerCase();

    const first = (...values) =>
      values.find((value) =>
        value !== undefined &&
        value !== null &&
        text(value) !== ""
      ) ?? "";

    function refreshIcons() {
      PGENRO_PageUI.icons();
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
      toast.innerHTML = `<i data-lucide="${icons[type] || icons.success}"></i><span></span>`;
      toast.querySelector("span").textContent = message;

      ui.toastContainer.appendChild(toast);
      refreshIcons();

      window.setTimeout(() => toast.remove(), 3200);
    }

    function setDbStatus(type, message) {
      if (ui.dbStatusDot) {
        ui.dbStatusDot.className = `status-indicator ${type}`;
      }

      if (ui.dbStatusText) {
        ui.dbStatusText.textContent = message;
      }
    }

    function currency(value) {
      return new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency: "PHP",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(Number(value) || 0);
    }

    function normalizeRecord(raw = {}) {
      const data =
        raw?.data && typeof raw.data === "object"
          ? raw.data
          : {};

      const row = {
        ...raw,
        ...data
      };

      const pick = (...keys) => {
        for (const key of keys) {
          if (
            row[key] !== undefined &&
            row[key] !== null &&
            text(row[key]) !== ""
          ) {
            return row[key];
          }
        }

        return "";
      };

      return {
        id: first(pick("id"), crypto.randomUUID()),
        controlNumber: text(pick(
          "controlNumber",
          "control_number",
          "control_no"
        )),
        accountCode: text(pick(
          "accountCode",
          "account_code"
        )),
        article: text(pick(
          "article",
          "category"
        )),
        description: text(pick(
          "description",
          "item_description"
        )),
        serialNumber: text(pick(
          "serialNumber",
          "serial_number",
          "serial_no"
        )),
        entryNumber: text(pick(
          "entryNumber",
          "entry_number"
        )),
        icsNo: text(pick(
          "icsNo",
          "ics_no"
        )),
        quantity: Number(pick("quantity", "qty")) || 0,
        unit: text(pick("unit")) || "unit",
        unitValue: Number(pick(
          "unitValue",
          "unit_value"
        )) || 0,
        totalValue: Number(pick(
          "totalValue",
          "total_value"
        )) || 0,
        dateAcquired: text(pick(
          "dateAcquired",
          "date_acquired"
        )),
        prNo: text(pick(
          "prNo",
          "pr_no"
        )),
        prDate: text(pick(
          "prDate",
          "pr_date"
        )),
        accountable: text(pick(
          "accountable",
          "accountable_person"
        )),
        remarks: text(pick("remarks")),
        createdAt: text(pick(
          "created_at",
          "createdAt"
        ))
      };
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
        accountType:
          text(profile.account_type) ||
          "Standard User",
        status: text(profile.status) || "Active"
      };

      try {
        localStorage.setItem(
          "pgenro_current_user",
          JSON.stringify(cached)
        );

        sessionStorage.setItem(
          "pgenro_session_active",
          "true"
        );

        sessionStorage.setItem(
          "pgenro_session_token",
          String(user.id)
        );
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

        const { data: profile, error: profileError } =
          await client
            .from(CONFIG.profileTable)
            .select("*")
            .eq("user_id", user.id)
            .maybeSingle();

        if (profileError) {
          console.warn(
            "Profile details were unavailable:",
            profileError
          );

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
        const hasExplicitActiveFlag =
          typeof profile?.is_active === "boolean";

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
        console.error(
          "Unable to verify the current session:",
          error
        );

        setDbStatus("offline", "Session verification failed");
        showToast(
          "Unable to verify your account session.",
          "error"
        );

        return false;
      }
    }

    function redirectToLogin() {
      window.location.replace(
        ui.body.dataset.loginUrl || "login.html"
      );
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
        console.warn(
          "Remote sign-out was unavailable:",
          error
        );
      }

      try {
        for (const key of Object.keys(localStorage)) {
          if (
            key.startsWith("sb-") ||
            key.startsWith("pgenro_")
          ) {
            localStorage.removeItem(key);
          }
        }

        sessionStorage.clear();
      } catch {
        // Continue even if storage cleanup fails.
      }

      redirectToLogin();
    }

    function closeProfile() {
      ui.profileMenu?.classList.remove("open");
      ui.profileBtn?.setAttribute(
        "aria-expanded",
        "false"
      );
      ui.profileDropdown?.setAttribute(
        "aria-hidden",
        "true"
      );
    }

    function toggleProfile() {
      if (
        !ui.profileMenu ||
        !ui.profileBtn ||
        !ui.profileDropdown
      ) {
        return;
      }

      const shouldOpen =
        !ui.profileMenu.classList.contains("open");

      closeProfile();

      if (shouldOpen) {
        ui.profileMenu.classList.add("open");

        ui.profileBtn.setAttribute(
          "aria-expanded",
          "true"
        );

        ui.profileDropdown.setAttribute(
          "aria-hidden",
          "false"
        );
      }
    }

    function syncOverlay() {
      const sidebarOpen =
        mobileQuery.matches &&
        Boolean(ui.sidebar?.classList.contains("open"));

      const modalOpen =
        state.detailsOpen ||
        state.printOpen;

      const active =
        sidebarOpen ||
        modalOpen;

      ui.overlay?.classList.toggle(
        "active",
        active && !modalOpen
      );

      ui.overlay?.setAttribute(
        "aria-hidden",
        String(!active)
      );

      ui.body.classList.toggle(
        "sidebar-open",
        sidebarOpen
      );

      ui.body.classList.toggle(
        "modal-open",
        modalOpen
      );
    }

    function setSidebarOpen(open) {
      const shouldOpen =
        Boolean(open && mobileQuery.matches);

      ui.sidebar?.classList.toggle(
        "open",
        shouldOpen
      );

      ui.hamburger?.classList.toggle(
        "active",
        shouldOpen
      );

      ui.hamburger?.setAttribute(
        "aria-expanded",
        String(shouldOpen)
      );

      ui.hamburger?.setAttribute(
        "aria-label",
        shouldOpen
          ? "Close module menu"
          : "Open module menu"
      );

      syncOverlay();
    }

    function getFilteredRecords() {
      const query = lower(ui.searchInput?.value);
      const article =
        ui.articleFilter?.value || "ALL";

      return state.records.filter((record) => {
        const haystack = [
          record.controlNumber,
          record.accountCode,
          record.article,
          record.description,
          record.serialNumber,
          record.icsNo,
          record.accountable,
          record.remarks
        ]
          .map(lower)
          .join(" ");

        const matchesSearch =
          !query ||
          haystack.includes(query);

        const matchesArticle =
          article === "ALL" ||
          record.article === article;

        return matchesSearch && matchesArticle;
      });
    }

    function populateArticleDropdown() {
      if (!ui.articleFilter) return;

      const current = ui.articleFilter.value;

      const articles = [
        ...new Set(
          state.records
            .map((record) => record.article)
            .filter(Boolean)
        )
      ].sort((a, b) =>
        a.localeCompare(b, undefined, {
          sensitivity: "base"
        })
      );

      ui.articleFilter.innerHTML =
        `<option value="ALL">All Articles / Categories</option>`;

      for (const article of articles) {
        const option =
          document.createElement("option");

        option.value = article;
        option.textContent = article;

        ui.articleFilter.appendChild(option);
      }

      if (articles.includes(current)) {
        ui.articleFilter.value = current;
      }
    }

    function updateKpis() {
      const totalSlips = state.records.length;

      const totalQuantity =
        state.records.reduce(
          (sum, record) =>
            sum + (Number(record.quantity) || 0),
          0
        );

      const totalValue =
        state.records.reduce(
          (sum, record) =>
            sum + (Number(record.totalValue) || 0),
          0
        );

      const numericControls =
        state.records
          .map((record) =>
            Number.parseInt(record.controlNumber, 10)
          )
          .filter(Number.isFinite);

      if (ui.statTotalSlips) {
        ui.statTotalSlips.textContent =
          totalSlips.toLocaleString();
      }

      if (ui.statIssuedItems) {
        ui.statIssuedItems.textContent =
          totalQuantity.toLocaleString();
      }

      if (ui.statTotalValue) {
        ui.statTotalValue.textContent =
          currency(totalValue);
      }

      if (ui.statLatestControl) {
        ui.statLatestControl.textContent =
          numericControls.length
            ? String(Math.max(...numericControls))
            : "---";
      }
    }

    function renderTable() {
      if (!ui.tableBody) return;

      const records = getFilteredRecords();
      const pageRows = PGENRO_PageUI.paginate(records, ui.tableBody, renderTable);

      if (ui.recordsCounter) {
        ui.recordsCounter.textContent =
          `Showing ${records.length} of ${state.records.length} custodian records`;
      }

      if (!records.length) {
        ui.tableBody.innerHTML = `
          <tr>
            <td class="empty-table-cell" colspan="9">
              No matching inventory custodian records found.
            </td>
          </tr>
        `;

        return;
      }

      ui.tableBody.innerHTML =
        pageRows.map((record) => `
          <tr data-record-id="${escapeHtml(record.id)}">
            <td>
              <span class="control-badge font-mono">
                ${escapeHtml(record.controlNumber || "—")}
              </span>
            </td>

            <td class="account-code-cell font-mono"
                title="${escapeHtml(record.accountCode || "—")}">
              ${escapeHtml(record.accountCode || "—")}
            </td>

            <td>
              <span class="article-pill"
                    title="${escapeHtml(record.article || "—")}">
                ${escapeHtml(record.article || "—")}
              </span>
            </td>

            <td>
              <div class="description-cell">
                <strong title="${escapeHtml(record.description || "—")}">
                  ${escapeHtml(record.description || "—")}
                </strong>

                ${
                  record.icsNo
                    ? `<small class="font-mono">Ref: ${escapeHtml(record.icsNo)}</small>`
                    : ""
                }
              </div>
            </td>

            <td class="serial-cell font-mono"
                title="${escapeHtml(record.serialNumber || "N/A")}">
              ${escapeHtml(record.serialNumber || "N/A")}
            </td>

            <td class="qty-column">
              <strong>${Number(record.quantity) || 0}</strong>
              <small>${escapeHtml(record.unit || "unit")}</small>
            </td>

            <td class="value-column">
              <span class="value-text">
                ${escapeHtml(currency(record.totalValue))}
              </span>
            </td>

            <td>
              <div class="accountable-cell"
                   title="${escapeHtml(record.accountable || "—")}">
                ${escapeHtml(record.accountable || "—")}
              </div>
            </td>

            <td class="action-column">
              <button class="btn-icon-view"
                      type="button"
                      data-open-record="${escapeHtml(record.id)}"
                      aria-label="View ICS record ${escapeHtml(record.controlNumber || "")}"
                      title="View complete ICS details">
                <i data-lucide="eye"></i>
              </button>
            </td>
          </tr>
        `).join("");

      refreshIcons();
    }

    function render() {
      populateArticleDropdown();
      updateKpis();
      renderTable();
    }

    function loadLocalRecords() {
      try {
        const localRaw =
          localStorage.getItem("pgenro_ics_records") ||
          localStorage.getItem("icsRecords") ||
          "[]";

        const local = JSON.parse(localRaw);

        state.records =
          Array.isArray(local)
            ? local.map(normalizeRecord)
            : [];
      } catch (error) {
        console.warn(
          "Unable to read local ICS records:",
          error
        );

        state.records = [];
      }

      render();
    }

    async function loadData({ notify = false } = {}) {
      if (state.loading) return;

      if (!client) {
        setDbStatus(
          "offline",
          "Local ICS mode"
        );

        loadLocalRecords();

        if (notify) {
          showToast(
            "Supabase is unavailable. Showing local ICS records.",
            "warning"
          );
        }

        return;
      }

      state.loading = true;
      setDbStatus(
        "standby",
        "Loading ICS records…"
      );

      if (ui.refreshBtn) {
        ui.refreshBtn.disabled = true;
      }

      try {
        const { data, error } =
          await client
            .from(CONFIG.table)
            .select("*")
            .order("created_at", {
              ascending: false
            });

        if (error) throw error;

        state.records =
          (data || []).map(normalizeRecord);

        setDbStatus(
          "online",
          "ICS database connected"
        );

        render();

        if (notify) {
          showToast(
            "ICS records synchronized."
          );
        }
      } catch (error) {
        console.error(
          "Unable to load ICS records:",
          error
        );

        setDbStatus(
          "offline",
          "ICS database unavailable"
        );

        loadLocalRecords();

        showToast(
          state.records.length
            ? "Database unavailable. Showing local ICS records."
            : "Unable to load ICS records.",
          state.records.length
            ? "warning"
            : "error"
        );
      } finally {
        state.loading = false;

        if (ui.refreshBtn) {
          ui.refreshBtn.disabled = false;
        }
      }
    }

    function subscribeToRealtime() {
      if (
        !client ||
        state.realtimeChannel
      ) {
        return;
      }

      state.realtimeChannel =
        client
          .channel("user-ics-live")
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: CONFIG.table
            },
            () => {
              loadData();
            }
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              setDbStatus(
                "online",
                "ICS database connected"
              );
            }

            if (status === "CHANNEL_ERROR") {
              setDbStatus(
                "standby",
                "Realtime connection interrupted"
              );
            }
          });
    }

    function populateDetails(record) {
      if (!record) return;

      if (ui.modalControlNoTitle) {
        ui.modalControlNoTitle.textContent =
          `Control No. ${record.controlNumber || "---"}`;
      }

      if (ui.modalArticleBadge) {
        ui.modalArticleBadge.textContent =
          record.article || "Article";
      }

      if (ui.modalAccountCode) {
        ui.modalAccountCode.textContent =
          `Acct Code: ${record.accountCode || "N/A"}`;
      }

      if (ui.modalDescription) {
        ui.modalDescription.textContent =
          record.description ||
          "No description provided.";
      }

      if (ui.modalSerialNo) {
        ui.modalSerialNo.textContent =
          record.serialNumber || "N/A";
      }

      if (ui.modalIcsNo) {
        ui.modalIcsNo.textContent =
          record.icsNo || "N/A";
      }

      if (ui.modalEntryNo) {
        ui.modalEntryNo.textContent =
          record.entryNumber || "N/A";
      }

      if (ui.modalQty) {
        ui.modalQty.textContent =
          String(record.quantity || 0);
      }

      if (ui.modalUnit) {
        ui.modalUnit.textContent =
          record.unit || "unit";
      }

      if (ui.modalUnitVal) {
        ui.modalUnitVal.textContent =
          currency(record.unitValue);
      }

      if (ui.modalTotalVal) {
        ui.modalTotalVal.textContent =
          currency(record.totalValue);
      }

      if (ui.modalDateAcquired) {
        ui.modalDateAcquired.textContent =
          record.dateAcquired || "N/A";
      }

      if (ui.modalPrNo) {
        ui.modalPrNo.textContent =
          record.prNo || "N/A";
      }

      if (ui.modalPrDate) {
        ui.modalPrDate.textContent =
          record.prDate || "N/A";
      }

      if (ui.modalAccountable) {
        ui.modalAccountable.textContent =
          record.accountable || "Unassigned";
      }

      if (ui.modalRemarks) {
        ui.modalRemarks.textContent =
          record.remarks ||
          "No historical remarks noted.";
      }
    }

    function openDetails(record) {
      if (!record || !ui.detailsModal) return;

      closeProfile();
      setSidebarOpen(false);

      state.currentRecord = record;
      state.detailsOpen = true;
      state.lastFocusedElement =
        document.activeElement;

      populateDetails(record);

      ui.detailsModal.classList.add("open");
      ui.detailsModal.setAttribute(
        "aria-hidden",
        "false"
      );

      syncOverlay();
      refreshIcons();

      requestAnimationFrame(() => {
        ui.closeDetailsBtn?.focus();
      });
    }

    function closeDetails({
      restoreFocus = true
    } = {}) {
      if (
        !state.detailsOpen ||
        !ui.detailsModal
      ) {
        return;
      }

      state.detailsOpen = false;

      ui.detailsModal.classList.remove("open");
      ui.detailsModal.setAttribute(
        "aria-hidden",
        "true"
      );

      syncOverlay();

      if (restoreFocus) {
        state.lastFocusedElement?.focus?.();
      }
    }

    function populatePrintSheet(record) {
      const today =
        new Date()
          .toISOString()
          .slice(0, 10);

      if (ui.printIcsNo) {
        ui.printIcsNo.textContent =
          record.icsNo || "N/A";
      }

      if (ui.printControlNo) {
        ui.printControlNo.textContent =
          record.controlNumber || "---";
      }

      if (ui.printQty) {
        ui.printQty.textContent =
          String(record.quantity || 1);
      }

      if (ui.printUnit) {
        ui.printUnit.textContent =
          record.unit || "unit";
      }

      if (ui.printUnitVal) {
        ui.printUnitVal.textContent =
          currency(record.unitValue);
      }

      if (ui.printTotalVal) {
        ui.printTotalVal.textContent =
          currency(record.totalValue);
      }

      if (ui.printArticle) {
        ui.printArticle.textContent =
          record.article || "Article";
      }

      if (ui.printDesc) {
        ui.printDesc.textContent =
          record.description ||
          "Item specifications";
      }

      if (ui.printSerial) {
        ui.printSerial.textContent =
          `SN: ${record.serialNumber || "N/A"}`;
      }

      if (ui.printItemNo) {
        ui.printItemNo.textContent =
          record.accountCode ||
          record.controlNumber ||
          "---";
      }

      if (ui.printDateIssued) {
        ui.printDateIssued.textContent =
          record.dateAcquired || today;
      }

      if (ui.printAccountablePerson) {
        ui.printAccountablePerson.textContent =
          (
            record.accountable ||
            "END-USER ACCOUNTABLE OFFICER"
          ).toUpperCase();
      }

      if (ui.printDateReceived) {
        ui.printDateReceived.textContent =
          record.dateAcquired || today;
      }
    }

    function openPrintModal(record) {
      if (!record || !ui.printModal) return;

      state.currentRecord = record;
      state.printOpen = true;

      populatePrintSheet(record);

      ui.printModal.classList.add("open");
      ui.printModal.setAttribute(
        "aria-hidden",
        "false"
      );

      syncOverlay();
      refreshIcons();

      requestAnimationFrame(() => {
        ui.closePrintBtn?.focus();
      });
    }

    function closePrintModal() {
      if (
        !state.printOpen ||
        !ui.printModal
      ) {
        return;
      }

      state.printOpen = false;

      ui.printModal.classList.remove("open");
      ui.printModal.setAttribute(
        "aria-hidden",
        "true"
      );

      syncOverlay();
      state.lastFocusedElement?.focus?.();
    }

    function bindEvents() {
      ui.hamburger?.addEventListener(
        "click",
        (event) => {
          event.preventDefault();

          closeProfile();

          setSidebarOpen(
            !ui.sidebar?.classList.contains("open")
          );
        }
      );

      ui.overlay?.addEventListener(
        "click",
        () => {
          if (
            ui.sidebar?.classList.contains("open")
          ) {
            setSidebarOpen(false);
          }
        }
      );

      $$(".modules-list a").forEach((link) => {
        link.addEventListener("click", () => {
          closeProfile();

          if (mobileQuery.matches) {
            setSidebarOpen(false);
          }
        });
      });

      ui.profileBtn?.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleProfile();
        }
      );

      ui.profileMenu?.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
        }
      );

      document.addEventListener(
        "click",
        (event) => {
          if (
            ui.profileMenu?.classList.contains("open") &&
            !ui.profileMenu.contains(event.target)
          ) {
            closeProfile();
          }
        }
      );

      ui.logoutBtn?.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          logout();
        }
      );

      ui.searchInput?.addEventListener(
        "input",
        PGENRO_PageUI.search(renderTable)
      );

      ui.articleFilter?.addEventListener(
        "change",
        renderTable
      );

      ui.refreshBtn?.addEventListener(
        "click",
        () => {
          loadData({ notify: true });
        }
      );

      ui.printRegistryBtn?.addEventListener(
        "click",
        () => {
          window.print();
        }
      );

      ui.tableBody?.addEventListener(
        "click",
        (event) => {
          const row =
            event.target.closest(
              "tr[data-record-id]"
            );

          if (!row) return;

          const record =
            state.records.find(
              (item) =>
                String(item.id) ===
                String(row.dataset.recordId)
            );

          if (record) {
            openDetails(record);
          }
        }
      );

      ui.closeDetailsBtn?.addEventListener(
        "click",
        () => closeDetails()
      );

      ui.modalCloseBtn?.addEventListener(
        "click",
        () => closeDetails()
      );

      ui.detailsModal?.addEventListener(
        "click",
        (event) => {
          if (event.target === ui.detailsModal) {
            closeDetails();
          }
        }
      );

      ui.modalPrintSlipBtn?.addEventListener(
        "click",
        () => {
          const record = state.currentRecord;

          if (!record) return;

          closeDetails({
            restoreFocus: false
          });

          openPrintModal(record);
        }
      );

      ui.closePrintBtn?.addEventListener(
        "click",
        closePrintModal
      );

      ui.dismissPrintBtn?.addEventListener(
        "click",
        closePrintModal
      );

      ui.printModal?.addEventListener(
        "click",
        (event) => {
          if (event.target === ui.printModal) {
            closePrintModal();
          }
        }
      );

      ui.printNowBtn?.addEventListener(
        "click",
        () => {
          window.print();
        }
      );

      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Escape") return;

          if (state.printOpen) {
            closePrintModal();
            return;
          }

          if (state.detailsOpen) {
            closeDetails();
            return;
          }

          if (
            ui.profileMenu?.classList.contains("open")
          ) {
            closeProfile();
            ui.profileBtn?.focus();
            return;
          }

          if (
            ui.sidebar?.classList.contains("open")
          ) {
            setSidebarOpen(false);
            ui.hamburger?.focus();
          }
        }
      );

      const onBreakpointChange = () => {
        closeProfile();
        setSidebarOpen(false);
      };

      if (
        typeof mobileQuery.addEventListener ===
        "function"
      ) {
        mobileQuery.addEventListener(
          "change",
          onBreakpointChange
        );
      } else {
        mobileQuery.addListener(
          onBreakpointChange
        );
      }

      window.addEventListener(
        "beforeunload",
        () => {
          if (
            state.realtimeChannel &&
            client
          ) {
            client.removeChannel(
              state.realtimeChannel
            );
          }
        },
        { once: true }
      );
    }

    async function start() {
      refreshIcons();
      bindEvents();

      try {
        const cached =
          JSON.parse(
            localStorage.getItem(
              "pgenro_current_user"
            ) || "{}"
          );

        populateProfile(cached);
      } catch {
        populateProfile();
      }

      const allowed =
        await verifySession();

      if (
        !allowed &&
        ui.body.dataset.requiresAuth
      ) {
        return;
      }

      await loadData();
      subscribeToRealtime();
    }

    start();
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
