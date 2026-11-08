/* Page-owned UI helpers: render new placeholders without rebuilding existing SVGs. */
const PGENRO_PageUI = window.PGENRO_ViewerUI;

(() => {
  "use strict";

  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP",
    profileTable: "profiles",

    tables: {
      communications: "communications",
      serviceRequests: "service_requests",
      travelOrders: "travel_orders",
      supplyRequests: "pgenro_supply_requests",
      ics: "ics_records",
      memos: "office_memos"
    }
  });

  const client = window.pgenroSupabase || (typeof window.supabase?.createClient === "function"
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
      : null);

  window.pgenroSupabase = client;

  window.PGENRO_SUPABASE = Object.freeze({
    ...CONFIG,
    configured: Boolean(client)
  });

  document.addEventListener(
    "DOMContentLoaded",
    init,
    { once: true }
  );

  function init() {
    const $ = (
      selector,
      parent = document
    ) => parent.querySelector(selector);

    const $$ = (
      selector,
      parent = document
    ) => [
      ...parent.querySelectorAll(
        selector
      )
    ];

    const ui = {
      body: document.body,

      overlay:
        $("#overlay"),

      sidebar:
        $("#sidebar"),

      hamburger:
        $("#hamburgerMenu"),

      profileMenu:
        $("#profileMenu"),

      profileBtn:
        $("#profileBtn"),

      profileDropdown:
        $("#profileDropdown"),

      logoutBtn:
        $("#logoutBtn"),

      dbStatusIndicator:
        $("#dbStatusIndicator"),

      dbStatusText:
        $("#dbStatusText"),

      currentDateText:
        $("#currentDateText"),

      heroTotalRecords:
        $("#heroTotalRecords"),

      refreshDashboardBtn:
        $("#refreshDashboardBtn"),

      serviceRecentList:
        $("#serviceRecentList"),

      servicePendingSummary:
        $("#servicePendingSummary"),

      memoGrid:
        $("#memoGrid"),

      commCompareChart:
        $("#commCompareChart"),

      operationsDistChart:
        $("#operationsDistChart"),

      scrollToTopBtn:
        $("#scrollToTopBtn"),

      toastContainer:
        $("#toastContainer"),

      kpis: {
        totalComms:
          $("#kpiTotalComms"),

        incomingComms:
          $("#kpiIncomingCount"),

        outgoingComms:
          $("#kpiOutgoingCount"),

        totalServices:
          $("#kpiTotalServices"),

        pendingServices:
          $("#kpiPendingServices"),

        totalTravel:
          $("#kpiTotalTravel"),

        activeTravel:
          $("#kpiActiveTravel"),

        totalSupplyRequests:
          $("#kpiTotalSupplyRequests"),

        totalIcs:
          $("#kpiTotalIcs")
      }
    };

    const state = {
      profile: null,

      records: {
        communications: [],
        serviceRequests: [],
        travelOrders: [],
        supplyRequests: [],
        ics: [],
        memos: []
      },

      charts: {
        comm: null,
        operations: null
      },

      chartSources: {},

      realtimeChannel: null,
      refreshTimer: 0,
      loading: false
    };

    const refreshButtons = [ui.refreshDashboardBtn, $("#refreshUserAnalyticsBtn")].filter(Boolean);

    const mobileQuery =
      window.matchMedia(
        "(max-width: 900px)"
      );

    const text = (value) =>
      String(
        value ?? ""
      ).trim();

    const lower = (value) =>
      text(value).toLowerCase();

    /* =========================================================
       ICONS
       ========================================================= */

    function refreshIcons() {
      PGENRO_PageUI.icons();
    }

    /* =========================================================
       SECURITY / HTML ESCAPING
       ========================================================= */

    function escapeHtml(value) {
      return text(value)
        .replaceAll(
          "&",
          "&amp;"
        )
        .replaceAll(
          "<",
          "&lt;"
        )
        .replaceAll(
          ">",
          "&gt;"
        )
        .replaceAll(
          '"',
          "&quot;"
        )
        .replaceAll(
          "'",
          "&#039;"
        );
    }

    /* =========================================================
       TOAST
       ========================================================= */

    function showToast(
      message,
      type = "success"
    ) {
      if (!ui.toastContainer) {
        return;
      }

      const icons = {
        success:
          "circle-check",

        warning:
          "triangle-alert",

        error:
          "circle-alert"
      };

      const toast =
        document.createElement(
          "div"
        );

      toast.className =
        `toast ${type}`;

      toast.innerHTML = `
        <i
          data-lucide="${
            icons[type] ||
            icons.success
          }"
        ></i>

        <span></span>
      `;

      const messageNode =
        toast.querySelector(
          "span"
        );

      if (messageNode) {
        messageNode.textContent =
          message;
      }

      ui.toastContainer
        .replaceChildren(
          toast
        );

      refreshIcons();

      window.setTimeout(
        () => {
          toast.remove();
        },
        3200
      );
    }

    /* =========================================================
       DATABASE STATUS
       ========================================================= */

    function setDatabaseStatus(
      type,
      message
    ) {
      if (
        ui.dbStatusIndicator
      ) {
        ui.dbStatusIndicator
          .className =
          `status-indicator ${type}`;
      }

      if (
        ui.dbStatusText
      ) {
        ui.dbStatusText
          .textContent =
          message;
      }
    }

    /* =========================================================
       RECORD HELPERS
       ========================================================= */

    function normalizeRow(
      row = {}
    ) {
      return (
        row?.data &&
        typeof row.data ===
          "object"
      )
        ? {
            ...row,
            ...row.data
          }
        : row;
    }

    function getFirstValue(
      record,
      keys,
      fallback = ""
    ) {
      for (
        const key of keys
      ) {
        if (
          record?.[key] !==
            undefined &&
          record?.[key] !==
            null &&
          text(
            record[key]
          ) !== ""
        ) {
          return record[key];
        }
      }

      return fallback;
    }

    function parseDate(
      value
    ) {
      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return null;
      }

      if (
        value instanceof Date
      ) {
        return Number.isNaN(
          value.getTime()
        )
          ? null
          : value;
      }

      if (
        typeof value ===
        "number"
      ) {
        const milliseconds =
          value <
          100000000000
            ? value * 1000
            : value;

        const date =
          new Date(
            milliseconds
          );

        return Number.isNaN(
          date.getTime()
        )
          ? null
          : date;
      }

      const date =
        new Date(value);

      return Number.isNaN(
        date.getTime()
      )
        ? null
        : date;
    }

    function getRecordDate(
      record
    ) {
      return parseDate(
        getFirstValue(
          record,
          [
            "time_in",
            "visit_date",
            "created_at",
            "createdAt",
            "date_requested",
            "dateRequest",
            "date",
            "timestamp",
            "updated_at"
          ],
          null
        )
      );
    }

    function sortNewest(
      records
    ) {
      return [
        ...records
      ].sort(
        (
          firstRecord,
          secondRecord
        ) => {
          const firstDate =
            getRecordDate(
              firstRecord
            );

          const secondDate =
            getRecordDate(
              secondRecord
            );

          if (
            firstDate &&
            secondDate
          ) {
            return (
              secondDate -
              firstDate
            );
          }

          if (firstDate) {
            return -1;
          }

          if (secondDate) {
            return 1;
          }

          return 0;
        }
      );
    }

    function formatDate(
      value
    ) {
      const date =
        parseDate(value);

      if (!date) {
        return (
          text(value) ||
          "—"
        );
      }

      return new Intl
        .DateTimeFormat(
          "en-PH",
          {
            month:
              "short",

            day:
              "numeric",

            year:
              "numeric"
          }
        )
        .format(date);
    }

    /* =========================================================
       PROFILE
       ========================================================= */

    function populateProfile(
      profile = {}
    ) {
      const name =
        text(
          profile.fullName
        ) ||
        text(
          profile.full_name
        ) ||
        text(
          profile.username
        ) ||
        "PGENRO User";

      const role =
        text(
          profile.position
        ) ||
        text(
          profile.role
        ) ||
        text(
          profile.accountType
        ) ||
        text(
          profile.account_type
        ) ||
        "Authorized account";

      const email =
        text(
          profile.email
        ) ||
        text(
          profile.authUser
            ?.email
        ) ||
        "Office account";

      $$(
        ".profile-text strong"
      ).forEach(
        (node) => {
          node.textContent =
            name;
        }
      );

      $$(
        ".profile-text small"
      ).forEach(
        (node) => {
          node.textContent =
            role;
        }
      );

      $$(
        ".profile-dropdown-header h3"
      ).forEach(
        (node) => {
          node.textContent =
            name;
        }
      );

      $$(
        ".profile-dropdown-header p"
      ).forEach(
        (node) => {
          node.textContent =
            email;
        }
      );
    }

    function cacheProfile(
      user,
      profile = {}
    ) {
      const cached = {
        id:
          user.id,

        uid:
          user.id,

        fullName:
          text(
            profile.full_name
          ) ||
          text(
            profile.username
          ) ||
          text(
            user.email
          ) ||
          "PGENRO User",

        username:
          text(
            profile.username
          ),

        email:
          text(
            profile.email
          ) ||
          text(
            user.email
          ),

        contact:
          text(
            profile.contact
          ),

        position:
          text(
            profile.position
          ),

        division:
          text(
            profile.division
          ),

        role:
          text(
            profile.role
          ) ||
          "user",

        accountType:
          text(
            profile.account_type
          ) ||
          "Standard User",

        status:
          text(
            profile.status
          ) ||
          "Active"
      };

      try {
        localStorage
          .setItem(
            "pgenro_current_user",
            JSON.stringify(
              cached
            )
          );

        sessionStorage
          .setItem(
            "pgenro_session_active",
            "true"
          );

        sessionStorage
          .setItem(
            "pgenro_session_token",
            String(
              user.id
            )
          );

      } catch {
        // Storage is optional.
      }

      populateProfile(
        cached
      );
    }

    /* =========================================================
       AUTH SESSION
       ========================================================= */

    async function verifySession() {
      if (
        !client ||
        !ui.body
          .dataset
          .requiresAuth
      ) {
        return true;
      }

      try {
        const {
          data,
          error
        } =
          await client
            .auth
            .getSession();

        if (error) {
          throw error;
        }

        const user =
          data?.session?.user;

        if (!user) {
          redirectToLogin();
          return false;
        }

        const {
          data: profile,
          error:
            profileError
        } =
          await client
            .from(
              CONFIG.profileTable
            )
            .select("*")
            .eq(
              "user_id",
              user.id
            )
            .maybeSingle();

        /*
         * Do not automatically
         * log the user out just
         * because the profile
         * query temporarily fails.
         */
        if (
          profileError
        ) {
          console.warn(
            "Profile details were unavailable:",
            profileError
          );

          populateProfile({
            email:
              user.email
          });

          return true;
        }

        const currentRole = lower(profile?.role).replace(/\s+/g, " ").trim();
        if (['admin'].includes(currentRole)) {
          window.location.replace("../admin/admin.html");
          return false;
        }

        const status =
          lower(
            profile?.status
          );

        const hasExplicitActiveFlag =
          typeof profile
            ?.is_active ===
          "boolean";

        if (
          profile &&
          (
            (
              hasExplicitActiveFlag &&
              profile.is_active ===
                false
            ) ||
            (
              status &&
              ![
                "active",
                "approved"
              ].includes(
                status
              )
            )
          )
        ) {
          await logout({
            ask: false
          });

          return false;
        }

        state.profile = {
          ...(profile || {}),

          email:
            text(
              profile?.email
            ) ||
            text(
              user.email
            ),

          authUser:
            user
        };

        cacheProfile(
          user,
          state.profile
        );

        return true;

      } catch (error) {
        console.error(
          "Unable to verify dashboard session:",
          error
        );

        setDatabaseStatus(
          "offline",
          "Session verification failed"
        );

        showToast(
          "Unable to verify your current account session.",
          "error"
        );

        return false;
      }
    }

    function redirectToLogin() {
      window.location
        .replace(
          ui.body
            .dataset
            .loginUrl ||
          "/User/login.html"
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

    async function logout({
      ask = true
    } = {}) {
      if (ask && !(await showLogoutDialog())) {
        return;
      }

      try {
        await client
          ?.auth
          .signOut();

      } catch (error) {
        console.warn(
          "Remote sign-out was unavailable:",
          error
        );
      }

      try {
        for (
          const key of
          Object.keys(
            localStorage
          )
        ) {
          if (
            key.startsWith(
              "sb-"
            ) ||
            key.startsWith(
              "pgenro_"
            )
          ) {
            localStorage
              .removeItem(
                key
              );
          }
        }

        sessionStorage
          .clear();

      } catch {
        // Continue to login.
      }

      redirectToLogin();
    }

    /* =========================================================
       PROFILE MENU
       ========================================================= */

    function closeProfile() {
      ui.profileMenu
        ?.classList
        .remove(
          "open"
        );

      ui.profileBtn
        ?.setAttribute(
          "aria-expanded",
          "false"
        );

      ui.profileDropdown
        ?.setAttribute(
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
        !ui.profileMenu
          .classList
          .contains(
            "open"
          );

      closeProfile();

      if (
        shouldOpen
      ) {
        ui.profileMenu
          .classList
          .add(
            "open"
          );

        ui.profileBtn
          .setAttribute(
            "aria-expanded",
            "true"
          );

        ui.profileDropdown
          .setAttribute(
            "aria-hidden",
            "false"
          );
      }
    }

    /* =========================================================
       SIDEBAR
       ========================================================= */

    function setSidebarOpen(
      open
    ) {
      const shouldOpen =
        Boolean(
          open &&
          mobileQuery.matches
        );

      ui.sidebar
        ?.classList
        .toggle(
          "open",
          shouldOpen
        );

      ui.hamburger
        ?.classList
        .toggle(
          "active",
          shouldOpen
        );

      ui.overlay
        ?.classList
        .toggle(
          "active",
          shouldOpen
        );

      ui.overlay
        ?.setAttribute(
          "aria-hidden",
          String(
            !shouldOpen
          )
        );

      ui.body
        .classList
        .toggle(
          "sidebar-open",
          shouldOpen
        );

      ui.hamburger
        ?.setAttribute(
          "aria-expanded",
          String(
            shouldOpen
          )
        );

      ui.hamburger
        ?.setAttribute(
          "aria-label",
          shouldOpen
            ? "Close module menu"
            : "Open module menu"
        );
    }

    /* =========================================================
       DATE / TIME
       ========================================================= */

    const officeCalendarDate = new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", year: "numeric"
    });
    function updateClock() {
      if (!ui.currentDateText) return;
      const now = new Date();
      ui.currentDateText.textContent = officeCalendarDate.format(now);
      ui.currentDateText.dateTime = now.toISOString();
    }

    function serviceInQueue(record) {
      const status = lower(getFirstValue(record, [
        "serviceStatus", "service_status", "status", "request_status"
      ], "pending"));
      return /pending|open|queue|review|evaluation|assess|in progress/.test(status);
    }

    function renderKPIs() {
      const {communications, serviceRequests, travelOrders, supplyRequests, ics} = state.records;
      const outgoing = communications.filter(record =>
        lower(getFirstValue(record, ["type", "direction", "document_type", "category"], "incoming")).includes("out")
      ).length;
      const activeTravel = travelOrders.filter(record =>
        /active|ongoing|approved|field/.test(lower(getFirstValue(record, ["status", "travel_status", "travelStatus"], "active")))
      ).length;
      const values = {
        totalComms: ["communications", communications.length],
        incomingComms: ["communications", communications.length - outgoing],
        outgoingComms: ["communications", outgoing],
        totalServices: ["serviceRequests", serviceRequests.length],
        pendingServices: ["serviceRequests", serviceRequests.filter(serviceInQueue).length],
        totalTravel: ["travelOrders", travelOrders.length],
        activeTravel: ["travelOrders", activeTravel],
        totalSupplyRequests: ["supplyRequests", supplyRequests.length],
        totalIcs: ["ics", ics.length]
      };
      for (const [key, [source, value]] of Object.entries(values)) {
        if (ui.kpis[key]) {
          ui.kpis[key].textContent = state.chartSources[source] === "live" ? value.toLocaleString() : "—";
        }
      }
      const sources = Object.keys(state.records).filter(key => state.chartSources[key] === "live");
      if (ui.heroTotalRecords) {
        const total = sources.reduce((sum, key) => sum + state.records[key].length, 0);
        ui.heroTotalRecords.textContent = sources.length ? total.toLocaleString() : "—";
      }
    }

    /* =========================================================
       SERVICE REQUEST ACTIVITY
       ========================================================= */

    function renderServices() {
      if (
        !ui.serviceRecentList
      ) {
        return;
      }

      const services =
        sortNewest(
          state.records
            .serviceRequests
        ).slice(
          0,
          5
        );

      const available = state.chartSources.serviceRequests === "live";
      if (ui.servicePendingSummary) {
        const pending = state.records.serviceRequests.filter(serviceInQueue).length;
        ui.servicePendingSummary.textContent = available ? `${pending.toLocaleString()} in queue` : "Unavailable";
      }

      if (
        !services.length
      ) {
        ui.serviceRecentList
          .innerHTML = `
            <div class="empty-state-box">
              <span class="empty-icon">
                <i data-lucide="wrench"></i>
              </span>

              <h3>
                ${available ? "No service requests yet" : "Service requests unavailable"}
              </h3>

              <p>
                ${available ? "New requests will appear here." : "Refresh the dashboard to try again."}
              </p>
            </div>
          `;

        refreshIcons();

        return;
      }

      ui.serviceRecentList
        .innerHTML =
        services
          .map(
            (record) => {
              const title =
                getFirstValue(
                  record,
                  [
                    "title",
                    "subject",
                    "primaryCategory",
                    "primary_category",
                    "service_type",
                    "serviceType",
                    "category"
                  ],
                  "Service Request"
                );

              const requester =
                getFirstValue(
                  record,
                  [
                    "requestedBy",
                    "requested_by",
                    "clientName",
                    "client_name",
                    "requester"
                  ],
                  "Office Staff"
                );

              const status =
                text(
                  getFirstValue(
                    record,
                    [
                      "serviceStatus",
                      "service_status",
                      "status",
                      "request_status"
                    ],
                    "Pending"
                  )
                );

              const pendingStatus =
                /pending|open|queue|review|evaluation|assess/i
                  .test(
                    status
                  );

              return `
                <div class="activity-item">
                  <span class="activity-avatar">
                    <i
                      data-lucide="${
                        pendingStatus
                          ? "clock-3"
                          : "circle-check"
                      }"
                    ></i>
                  </span>

                  <div class="activity-copy">
                    <strong>
                      ${escapeHtml(
                        title
                      )}
                    </strong>

                    <span>
                      Requester:
                      ${escapeHtml(
                        requester
                      )}
                    </span>
                  </div>

                  <div class="activity-meta">
                    <span class="status-badge ${
                      pendingStatus
                        ? "status-pending"
                        : "status-active"
                    }">
                      ${escapeHtml(
                        status
                      )}
                    </span>
                  </div>
                </div>
              `;
            }
          )
          .join("");

      refreshIcons();
    }

    /* =========================================================
       MEMOS
       ========================================================= */

    function renderMemos() {
      if (
        !ui.memoGrid
      ) {
        return;
      }

      const available = state.chartSources.memos === "live";
      const memos =
        state.records
          .memos
          .filter(
            (memo) => {
              const pinned =
                lower(
                  getFirstValue(
                    memo,
                    [
                      "pinned",
                      "is_pinned",
                      "isPinned"
                    ],
                    "true"
                  )
                );

              return (
                pinned !==
                "false"
              );
            }
          )
          .slice(
            0,
            6
          );

      if (
        !memos.length
      ) {
        ui.memoGrid
          .innerHTML = `
            <div class="memo-empty-card">
              <div class="empty-state-box">
                <span class="empty-icon">
                  <i data-lucide="file-text"></i>
                </span>

                <h3>
                  ${available ? "No pinned memos yet" : "Office memos unavailable"}
                </h3>

                <p>
                  ${available ? "Pinned notices will appear here." : "Refresh the dashboard to try again."}
                </p>
              </div>
            </div>
          `;

        refreshIcons();

        return;
      }

      ui.memoGrid
        .innerHTML =
        memos
          .map(
            (memo) => {
              const title =
                getFirstValue(
                  memo,
                  [
                    "title",
                    "subject",
                    "memo_title",
                    "memoTitle"
                  ],
                  "Official Notice"
                );

              const description =
                getFirstValue(
                  memo,
                  [
                    "description",
                    "content",
                    "summary",
                    "body"
                  ],
                  "No synopsis available."
                );

              const code =
                getFirstValue(
                  memo,
                  [
                    "code",
                    "memo_code",
                    "reference_no",
                    "referenceNo"
                  ],
                  "MEMO"
                );

              const priority =
                getFirstValue(
                  memo,
                  [
                    "priority",
                    "priority_level",
                    "category"
                  ],
                  "Standard"
                );

              const issuedDate =
                getFirstValue(
                  memo,
                  [
                    "issued_date",
                    "date_issued",
                    "created_at",
                    "date"
                  ],
                  "—"
                );

              const issuedBy =
                getFirstValue(
                  memo,
                  [
                    "issued_by",
                    "author",
                    "department"
                  ],
                  "PGENRO Admin"
                );

              const target =
                getFirstValue(
                  memo,
                  [
                    "target",
                    "audience"
                  ],
                  "All Units"
                );

              const attachment = PGENRO_PageUI.file(memo);

              return `
                <article class="memo-card">
                  <div class="memo-header">
                    <div class="memo-badge-group">
                      <span class="memo-pinned-tag">
                        <i data-lucide="pin"></i>
                        Pinned
                      </span>

                      <span class="memo-code">
                        ${escapeHtml(
                          code
                        )}
                      </span>
                    </div>

                    <span class="priority-tag ${
                      lower(
                        priority
                      ) ===
                      "high"
                        ? "high"
                        : "standard"
                    }">
                      ${escapeHtml(
                        priority
                      )}
                    </span>
                  </div>

                  <div class="memo-body">
                    <h3>
                      ${escapeHtml(
                        title
                      )}
                    </h3>

                    <p>
                      ${escapeHtml(
                        description
                      )}
                    </p>
                  </div>

                  <div class="memo-meta">
                    <div class="meta-item">
                      <i data-lucide="calendar"></i>

                      <span>
                        ${escapeHtml(
                          formatDate(
                            issuedDate
                          )
                        )}
                      </span>
                    </div>

                    <div class="meta-item">
                      <i data-lucide="user-check"></i>

                      <span>
                        ${escapeHtml(
                          issuedBy
                        )}
                      </span>
                    </div>

                    <div class="meta-item">
                      <i data-lucide="users"></i>

                      <span>
                        ${escapeHtml(
                          target
                        )}
                      </span>
                    </div>
                  </div>

                  <div class="memo-footer">
                    ${attachment ? `<button type="button" class="viewer-button viewer-file-button" data-viewer-file="${escapeHtml(attachment.url)}" data-viewer-name="${escapeHtml(attachment.name)}" data-viewer-reference="${escapeHtml(code)}"><i data-lucide="file-text"></i>View file</button>` : '<span class="viewer-no-file">No file</span>'}
                    <a class="memo-link" href="officememo.html">All memos <i data-lucide="arrow-up-right"></i></a>
                  </div>
                </article>
              `;
            }
          )
          .join("");

      refreshIcons();
    }

    /* =========================================================
       DASHBOARD CHARTS
       ========================================================= */

    let chartPeriod = "90";
    const chartDayMs = 86400000;
    const chartFailures = new Set();
    const {
      chartTheme, chartOptions, chartPointerCoordinates, doughnutTotal, lineArea,
      hideChartTooltip, renderChartLegend, assertDistributionColors, distributionShare
    } = window.PGENRO_DashboardCharts;
    const chartActivityModules = [
      { key: "communications", sourceKey: "communications", group: "documents", label: "Communications", color: "#059669" },
      { key: "memos", sourceKey: "memos", group: "documents", label: "Office Memos", color: "#35a7a0" },
      { key: "travel", sourceKey: "travelOrders", group: "travel", label: "Travel Orders", color: "#8b7fc6" },
      { key: "services", sourceKey: "serviceRequests", group: "services", label: "Service Requests", color: "#d77988" },
      { key: "ics", sourceKey: "ics", group: "documents", label: "ICS Property Slips", color: "#709fa8" }
    ];

    const officeDateFormat=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'});
  const moduleDateFields = {
    communications: ['receivedDate', 'received_date', 'date_received', 'dateReceived', 'sentDate', 'sent_date', 'date_sent', 'letterDate', 'docDate', 'document_date'],
    memos: ['memoDate', 'memo_date', 'dateIssued', 'date_issued', 'issuedDate', 'issued_date'],
    travel: ['departureDate', 'departure_date', 'travelDate', 'travel_date', 'date_from', 'dateFrom', 'start_date', 'startDate'],
    services: ['requestDate', 'request_date', 'date_requested', 'dateRequested'],
    ics: ['dateIssued', 'date_issued', 'issuedDate', 'issued_date', 'icsDate', 'ics_date']
  };
  function chartRecordDay(row, key) {
    const fields = [...(moduleDateFields[key] || []), 'date', 'created_at', 'createdAt', 'timestamp'];
    for (const field of fields) {
      const raw = row?.[field];
      if (raw === null || raw === undefined || raw === '') continue;
      let date;
      if (typeof raw?.toDate === 'function') date = raw.toDate();
      else if (raw instanceof Date) date = raw;
      else if (typeof raw === 'number') date = new Date(raw > 1e11 ? raw : raw * 1000);
      else if (typeof raw === 'string') {
        const text = raw.trim();
        if (/^\d{1,2}:\d{2}/.test(text)) continue; // A time alone is not an activity date.
        const plain = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (plain) {
          const [year, month, day] = plain.slice(1).map(Number);
          const stamp = new Date(Date.UTC(year, month - 1, day));
          if (stamp.getUTCFullYear() !== year || stamp.getUTCMonth() !== month - 1 || stamp.getUTCDate() !== day) continue;
          return Math.floor(stamp.getTime() / chartDayMs);
        }
        date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:/.test(text) ? text.replace(' ', 'T') : text);
      }
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
      // The office reports in Philippine calendar days, including UTC timestamps near midnight.
      const parts = officeDateFormat.formatToParts(date);
      const part = type => Number(parts.find(p => p.type === type)?.value);
      return Math.floor(Date.UTC(part('year'), part('month') - 1, part('day')) / chartDayMs);
    }
    return null;
  }

    const shortBucketDate = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });
    const longBucketDate = new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric", timeZone: "UTC" });
    const reportDate = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    const formatCount = value => value.toLocaleString("en-PH");

    function buildDashboardChartModel() {
      const end = chartRecordDay({ date: new Date() });
      let earliest = end;
      const breakdown = chartActivityModules.filter(module => canReadTable(CONFIG.tables[module.sourceKey])).map(module => {
        const dates = (state.records[module.sourceKey] || []).map(row => chartRecordDay(row, module.key));
        for (const date of dates) if (date !== null) earliest = Math.min(earliest, date);
        return {
          ...module, dates, available: state.chartSources[module.sourceKey] === "live",
          current: 0, previous: 0, missing: dates.filter(date => date === null).length
        };
      });
      const yearStart = Date.UTC(new Date(end * chartDayMs).getUTCFullYear(), 0, 1) / chartDayMs;
      const start = chartPeriod === "all" ? earliest : chartPeriod === "year" ? yearStart : end - Number(chartPeriod) + 1;
      const days = end - start + 1;
      const interval = days <= 45 ? "day" : days <= 120 ? "week" : "month";
      const bucketKey = day => interval === "month"
        ? new Date(day * chartDayMs).toISOString().slice(0, 7)
        : Math.floor((day - start) / (interval === "week" ? 7 : 1));
      const buckets = new Map();
      for (let day = start; day <= end;) {
        const date = new Date(day * chartDayMs);
        const label = (interval === "month" ? longBucketDate : shortBucketDate).format(date);
        buckets.set(bucketKey(day), { label, documents: 0, travel: 0, services: 0 });
        day = interval === "month"
          ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / chartDayMs
          : day + (interval === "week" ? 7 : 1);
      }
      for (const module of breakdown) {
        for (const date of module.dates) {
          if (date === null) continue;
          if (date >= start && date <= end) {
            module.current++;
            buckets.get(bucketKey(date))[module.group]++;
          } else if (date >= start - days && date < start) {
            module.previous++;
          }
        }
      }
      return {
        start, end, interval, buckets: [...buckets.values()], breakdown,
        total: breakdown.reduce((sum, module) => sum + module.current, 0),
        previous: breakdown.reduce((sum, module) => sum + module.previous, 0),
        availableCount: breakdown.filter(module => module.available).length,
        missingDates: breakdown.reduce((sum, module) => sum + module.missing, 0)
      };
    }

    // Native charts occupy the same fixed-size wrappers if Chart.js is unavailable.
    function renderNativeUserChart(canvas, config) {
      canvas.hidden = true;
      let fallback = canvas.parentElement.querySelector(".homepage-chart-fallback");
      if (!fallback) {
        fallback = document.createElement("div");
        fallback.className = "homepage-chart-fallback";
        fallback.setAttribute("role", "img");
        canvas.parentElement.appendChild(fallback);
      }
      fallback.setAttribute("aria-label", canvas.getAttribute("aria-label"));
      fallback.setAttribute("aria-describedby", canvas.getAttribute("aria-describedby"));
      const { labels, datasets } = config.data;
      let svg;
      let legend;

      if (config.type === "line") {
        const maximum = Math.max(1, ...datasets.flatMap((dataset) => dataset.data));
        const x = (index) => 35 + (index / Math.max(1, labels.length - 1)) * 550;
        const y = (value) => 180 - (value / maximum) * 160;
        const ticks = labels.map((label, index) => index % Math.ceil(labels.length / 4) === 0
          ? `<text x="${x(index)}" y="207" text-anchor="middle">${escapeHtml(label)}</text>` : "").join("");
        const lines = datasets.map((dataset) => {
          const points = dataset.data.map((value, index) => `${x(index)},${y(value)}`).join(" ");
          const area = dataset.fill ? `<polygon points="35,180 ${points} 585,180" fill="${dataset.borderColor}18"/>` : "";
          const dots = dataset.data.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="2.5" fill="${dataset.borderColor}"><title>${escapeHtml(`${labels[index]} · ${dataset.label}: ${value}`)}</title></circle>`).join("");
          return `${area}<polyline points="${points}" fill="none" stroke="${dataset.borderColor}" stroke-width="2"/>${dots}`;
        }).join("");
        svg = `<svg viewBox="0 0 620 220" aria-hidden="true"><g fill="#64748b" font-size="10"><path d="M35 20H585 M35 100H585 M35 180H585" stroke="#e2e8f0"/><text x="3" y="24">${maximum}</text><text x="18" y="184">0</text>${ticks}</g>${lines}</svg>`;
        legend = datasets.map((dataset) => `<span><i style="background:${dataset.borderColor}"></i>${escapeHtml(dataset.label)}</span>`).join("");
      } else {
        const dataset = datasets[0];
        const total = dataset.data.reduce((sum, value) => sum + value, 0);
        const circumference = 2 * Math.PI * 76.5;
        let offset = 0;
        const segments = dataset.data.map((value, index) => {
          if (!value || !total) return "";
          const length = value / total * circumference;
          const segment = `<circle cx="120" cy="100" r="76.5" fill="none" stroke="${dataset.backgroundColor[index]}" stroke-width="27" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 120 100)"><title>${escapeHtml(`${labels[index]}: ${value}`)}</title></circle>`;
          offset += length;
          return segment;
        }).join("");
        svg = `<svg viewBox="0 0 240 200" aria-hidden="true">${segments}</svg>`;
        legend = "";
      }
      fallback.innerHTML = legend ? `${svg}<div class="homepage-chart-legend">${legend}</div>` : svg;
    }

    function updateUserChart(key, canvas, config) {
      if (!canvas) return;
      if (typeof window.Chart === "function" && !chartFailures.has(key)) {
        try {
          canvas.hidden = false;
          if (state.charts[key]) {
            state.charts[key].data = config.data;
            state.charts[key].options = config.options;
            state.charts[key].update("none");
          } else {
            state.charts[key] = new window.Chart(canvas, config);
          }
          if (config.type === "doughnut") assertDistributionColors(state.charts[key]);
          canvas.parentElement.querySelector(".homepage-chart-fallback")?.remove();
          return;
        } catch (error) {
          window.Chart.getChart(canvas)?.destroy();
          state.charts[key] = null;
          chartFailures.add(key);
          console.warn("Dashboard chart is using its native fallback:", error);
        }
      }
      renderNativeUserChart(canvas, config);
    }

    function renderCommunicationChart(model) {
      const datasets = [
        { group: "documents", label: "Documents & ICS", borderColor: "#059669", backgroundColor: lineArea, fill: true },
        { group: "travel", label: "Travel orders", borderColor: "#8b7fc6" },
        { group: "services", label: "Service requests", borderColor: "#d77988" }
      ].filter(({ group }) => model.breakdown.some(module => module.group === group && module.available))
        .map(({ group, ...series }) => ({
          ...series, data: model.buckets.map(bucket => bucket[group]),
          tension: .25, borderWidth: 2.3, pointRadius: 2, pointHoverRadius: 5, pointHitRadius: 12
        }));
      updateUserChart("comm", ui.commCompareChart, {
        type: "line", data: { labels: model.buckets.map(bucket => bucket.label), datasets },
        options: chartOptions({ legend: true }),
        plugins: [chartPointerCoordinates]
      });
    }

    function renderOperationsChart(categories) {
      updateUserChart("operations", ui.operationsDistChart, {
        type: "doughnut",
        data: {
          labels: categories.map(category => category.label),
          datasets: [{
            label: "Records",
            data: categories.map(category => category.value ?? 0),
            backgroundColor: categories.map(category => category.color),
            borderWidth: 3, borderColor: chartTheme().surface, borderRadius: 5, spacing: 2
          }]
        },
        options: chartOptions({ doughnut: true }),
        plugins: [chartPointerCoordinates, doughnutTotal]
      });
    }

    const rangeSelect = $("#dashboardChartRange");
    rangeSelect?.addEventListener("change", event => {
      chartPeriod = event.target.value;
      renderDashboardCharts();
    });

    function setAnalyticsText(id, value) {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    }

    function renderAnalyticsMetrics(model) {
      const servicesAvailable = state.chartSources.serviceRequests === "live";
      const supplyAvailable = state.chartSources.supplyRequests === "live";
      const services = state.records.serviceRequests;
      let serviceTotal = 0, completed = 0, open = 0, aged = 0;
      for (const record of services) {
        const date = chartRecordDay(record, "services");
        if (date !== null && date >= model.start && date <= model.end) {
          const status = lower(getFirstValue(record, ["serviceStatus", "service_status", "status", "request_status"]));
          serviceTotal++;
          if (/^(complete|completed|closed|resolved|done)$/.test(status)) completed++;
        }
        if (serviceInQueue(record)) {
          open++;
          if (date !== null && model.end - date >= 7) aged++;
        }
      }
      setAnalyticsText("userAnalyticsVolume", model.availableCount ? formatCount(model.total) : "—");
      const change = model.previous ? (model.total - model.previous) / model.previous : null;
      setAnalyticsText("userAnalyticsVolumeChange", !model.availableCount ? "Activity data unavailable"
        : chartPeriod === "all" ? "All recorded dates"
        : change !== null ? `${change > 0 ? "+" : ""}${distributionShare.format(change)} vs preceding period`
        : model.total ? "New activity vs preceding period" : "No dated activity in this period");
      setAnalyticsText("userAnalyticsCompletion", servicesAvailable && serviceTotal ? distributionShare.format(completed / serviceTotal) : "—");
      setAnalyticsText("userAnalyticsCompletionDetail", !servicesAvailable ? "Service data unavailable"
        : serviceTotal ? `${formatCount(completed)} of ${formatCount(serviceTotal)} completed` : "No dated requests in this period");
      setAnalyticsText("userAnalyticsBacklog", servicesAvailable ? formatCount(open) : "—");
      setAnalyticsText("userAnalyticsBacklogDetail", servicesAvailable ? `${formatCount(aged)} open 7+ days` : "Service data unavailable");
      setAnalyticsText("userAnalyticsSupply", supplyAvailable ? formatCount(state.records.supplyRequests.length) : "—");
      setAnalyticsText("userAnalyticsSupplyDetail", supplyAvailable ? "Current request history" : "Supply data unavailable");
    }

    function renderDashboardCharts() {
      hideChartTooltip();
      const model = buildDashboardChartModel();
      renderAnalyticsMetrics(model);
      const categories = model.breakdown.map(({ label, color, available, current }) => ({
        label, color, value: available ? current : null
      }));
      const availability = `${model.availableCount} of ${model.breakdown.length} approved activity modules loaded.`;
      const missing = model.missingDates ? ` ${formatCount(model.missingDates)} undated records excluded.` : "";
      setAnalyticsText("userAnalyticsPeriodLabel", `${reportDate.format(model.start * chartDayMs)} – ${reportDate.format(model.end * chartDayMs)}`);
      setAnalyticsText("userAnalyticsSourceStatus", availability);
      setAnalyticsText("userAnalyticsBucketLabel", { day: "Daily", week: "Weekly", month: "Monthly" }[model.interval]);
      setAnalyticsText("dashboardTrendSummary", `${formatCount(model.total)} dated records · ${model.buckets.length} ${model.interval} intervals.${missing}`);
      setAnalyticsText("dashboardDistributionSummary", `${formatCount(model.total)} dated records · ${availability}`);
      for (const canvas of [ui.commCompareChart, ui.operationsDistChart]) {
        if (canvas) canvas.parentElement.hidden = model.total === 0;
      }
      for (const id of ["dashboardTrendEmpty", "dashboardDistributionEmpty"]) {
        const empty = document.getElementById(id);
        if (!empty) continue;
        empty.hidden = model.total > 0;
        empty.textContent = model.availableCount ? "No dated activity recorded in this period." : "Chart data is unavailable.";
      }
      if (model.total) {
        renderCommunicationChart(model);
        renderOperationsChart(categories);
      }
      renderChartLegend($("#operationsDistChartLegend"), state.charts.operations, categories);
    }

    const chartThemeObserver = new MutationObserver(renderDashboardCharts);
    chartThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("pagehide", event => {
      hideChartTooltip();
      if (event.persisted) return;
      chartThemeObserver.disconnect();
      Object.values(state.charts).forEach(chart => chart?.destroy());
    });

    /* =========================================================
       RENDER EVERYTHING
       ========================================================= */

    function renderAll() {
      renderKPIs();

      renderServices();

      renderMemos();

      renderDashboardCharts();

      refreshIcons();
    }

    /* =========================================================
       SUPABASE QUERY
       ========================================================= */

    function canReadTable(table) {
      const permission = table === 'pgenro_supply_requests' ? 'supply_requests' : table;
      return state.profile?.user_modules?.includes(permission) === true;
    }

    async function queryTable(
      table
    ) {
      const {
        data,
        error
      } =
        await client
          .from(table)
          .select("*");

      if (error) {
        throw error;
      }

      return (
        data || []
      ).map(
        normalizeRow
      );
    }

    /* =========================================================
       LOAD DASHBOARD DATA
       ========================================================= */

    async function loadDashboardData({
      notify = false
    } = {}) {
      if (
        state.loading
      ) {
        return;
      }

      if (!client) {
        setDatabaseStatus(
          "offline",
          "Dashboard database unavailable"
        );

        renderAll();
        showToast("Dashboard data is unavailable.", "error");
        return;
      }

      state.loading =
        true;

      setDatabaseStatus(
        "standby",
        "Loading office records…"
      );

      refreshButtons.forEach(button => { button.disabled = true; });

      const requests =
        Object.entries(
          CONFIG.tables
        ).filter(([, table]) => canReadTable(table));

      const results =
        await Promise
          .allSettled(
            requests.map(
              ([
                ,
                table
              ]) =>
                queryTable(
                  table
                )
            )
          );

      let failed = 0;

      results.forEach(
        (
          result,
          index
        ) => {
          const [
            key
          ] =
            requests[
              index
            ];

          if (
            result.status ===
            "fulfilled"
          ) {
            state.records[
              key
            ] =
              result.value;

            state.chartSources[key] = "live";

          } else {
            failed += 1;

            state.records[
              key
            ] = [];

            state.chartSources[key] = "unavailable";

            console.error(
              `Unable to load ${
                requests[
                  index
                ][1]
              }:`,
              result.reason
            );
          }
        }
      );

      renderAll();

      setDatabaseStatus(
        failed && failed === requests.length ? "offline" : failed || !requests.length ? "standby" : "online",
        !requests.length ? "No dashboard data modules assigned" : failed === requests.length ? "Records unavailable" : failed
          ? `${failed} of ${requests.length} sources unavailable`
          : "Office records synced"
      );

      if (notify) {
        showToast(
          failed
            ? `Dashboard synchronized with ${failed} unavailable module${
                failed === 1
                  ? ""
                  : "s"
              }.`
            : "Dashboard synchronized.",

          failed
            ? "warning"
            : "success"
        );
      }

      state.loading =
        false;

      refreshButtons.forEach(button => { button.disabled = false; });
    }

    /* =========================================================
       REALTIME REFRESH
       ========================================================= */

    function scheduleDashboardRefresh() {
      window.clearTimeout(
        state.refreshTimer
      );

      state.refreshTimer =
        window.setTimeout(
          () =>
            loadDashboardData(),
          220
        );
    }

    function subscribeRealtime() {
      if (
        !client ||
        state.realtimeChannel
      ) {
        return;
      }

      state.realtimeChannel =
        client.channel(
          "user-dashboard-live"
        );

      Object.values(
        CONFIG.tables
      ).filter(canReadTable).forEach(
        (table) => {
          state.realtimeChannel
            .on(
              "postgres_changes",
              {
                event:
                  "*",

                schema:
                  "public",

                table
              },
              scheduleDashboardRefresh
            );
        }
      );

      state.realtimeChannel.subscribe();
    }

    /* =========================================================
       EVENTS
       ========================================================= */

    function bindEvents() {
      ui.hamburger
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();

            closeProfile();

            setSidebarOpen(
              !ui.sidebar
                ?.classList
                .contains(
                  "open"
                )
            );
          }
        );

      ui.overlay
        ?.addEventListener(
          "click",
          () => {
            setSidebarOpen(
              false
            );
          }
        );

      $$(
        ".modules-list a"
      ).forEach(
        (link) => {
          link.addEventListener(
            "click",
            () => {
              closeProfile();

              if (
                mobileQuery
                  .matches
              ) {
                setSidebarOpen(
                  false
                );
              }
            }
          );
        }
      );

      ui.profileBtn
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();

            toggleProfile();
          }
        );

      ui.profileMenu
        ?.addEventListener(
          "click",
          (event) => {
            event.stopPropagation();
          }
        );

      document
        .addEventListener(
          "click",
          (event) => {
            if (
              ui.profileMenu
                ?.classList
                .contains(
                  "open"
                ) &&
              !ui.profileMenu
                .contains(
                  event.target
                )
            ) {
              closeProfile();
            }
          }
        );

      ui.logoutBtn
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();

            logout();
          }
        );

      refreshButtons.forEach(button => {
        button.addEventListener("click", () => loadDashboardData({ notify: true }));
      });

      ui.scrollToTopBtn
        ?.addEventListener(
          "click",
          () => {
            window.scrollTo({
              top: 0,
              behavior:
                "smooth"
            });
          }
        );

      window.addEventListener(
        "scroll",
        () => {
          ui.scrollToTopBtn
            ?.classList
            .toggle(
              "visible",
              window.scrollY >
                300
            );
        },
        {
          passive: true
        }
      );

      document
        .addEventListener(
          "keydown",
          (event) => {
            if (
              event.key !==
              "Escape"
            ) {
              return;
            }

            if (
              ui.profileMenu
                ?.classList
                .contains(
                  "open"
                )
            ) {
              closeProfile();

              ui.profileBtn
                ?.focus();

              return;
            }

            if (
              ui.sidebar
                ?.classList
                .contains(
                  "open"
                )
            ) {
              setSidebarOpen(
                false
              );

              ui.hamburger
                ?.focus();
            }
          }
        );

      const onBreakpointChange =
        () => {
          closeProfile();

          setSidebarOpen(
            false
          );
        };

      if (
        typeof mobileQuery
          .addEventListener ===
        "function"
      ) {
        mobileQuery
          .addEventListener(
            "change",
            onBreakpointChange
          );

      } else {
        mobileQuery
          .addListener(
            onBreakpointChange
          );
      }

      window.addEventListener(
        "beforeunload",
        () => {
          window.clearTimeout(
            state.refreshTimer
          );

          if (
            state.realtimeChannel &&
            client
          ) {
            client.removeChannel(
              state.realtimeChannel
            );
          }
        },
        {
          once: true
        }
      );
    }

    /* =========================================================
       START
       ========================================================= */

    async function start() {
      refreshIcons();

      bindEvents();

      try {
        populateProfile(
          JSON.parse(
            localStorage
              .getItem(
                "pgenro_current_user"
              ) ||
            "{}"
          )
        );

      } catch {
        populateProfile();
      }

      updateClock();

      window.setInterval(
        updateClock,
        60000
      );

      const allowed =
        await verifySession();

      if (
        !allowed &&
        ui.body
          .dataset
          .requiresAuth
      ) {
        return;
      }

      await loadDashboardData();

      subscribeRealtime();
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

/* PGENRO module notifications, 10 October 2026. */
/* Module-owned notifications: copies live inside each workspace page script. */
(() => {
  'use strict';
  if (window.PGENRO_Notifications) return;
  const modules = {
    communications:['Communications','admincommunication.html','communication.html'],
    travel_orders:['Travel Orders','travelOR-admin.html','travelOR.html'],
    office_memos:['Office Memos','officememo-admin.html','officememo.html'],
    employees:['Employees','employee-admin.html',null],
    inventory:['Inventory','invetoryadmin.html','inventory.html'],
    service_requests:['Service Requests','serviceAdmin.html','service.html'],
    ics_records:['Property Slips','ics-admin.html','ics.html'],
    user_accounts:['User Management','Usermanagement.html',null],
    account_requests:['Account Requests','requestacc.html',null]
  };
  const empty=()=>({total:0,counts:{},items:[],workspace:'user'});
  let feed=empty(),status='loading',db,userId='',generation=0,loading=false,again=false,disposed=false;
  let wrapper,button,panel,list,count,markAll,badge,channel,timer,debounce,authSubscription;
  const element=(tag,className,text)=>{const el=document.createElement(tag);el.className=className||'';if(text!==undefined)el.textContent=text;return el;};
  function destination(module){
    const info=modules[module],admin=feed.workspace==='admin',file=info?.[admin?1:2];
    return file?new URL(`../${admin?'admin':'User'}/${file}`,location.href).href:null;
  }
  function render(){
    if(!button)return;
    const total=Number(feed.total)||0;
    badge.textContent=total>99?'99+':String(total);badge.hidden=!total;
    count.textContent=`${total} unread`;markAll.disabled=!total||status!=='ready';
    button.setAttribute('aria-label',`Notifications${total?`, ${total} unread`:''}`);
    list.replaceChildren();
    if(status==='loading')list.append(element('p','module-notification-empty','Loading notifications…'));
    else if(status==='unavailable')list.append(element('p','module-notification-empty','Notifications are unavailable. Try again.'));
    else if(!total)list.append(element('p','module-notification-empty','No new notifications'));
    for(const item of feed.items||[]){
      const href=destination(item.module);if(!href)continue;
      const link=element('a','module-notification-item');link.href=href;link.dataset.notificationId=item.id;
      const dot=element('span','module-notification-dot');dot.setAttribute('aria-hidden','true');
      const copy=element('span','module-notification-copy');copy.append(element('strong','',modules[item.module][0]));
      copy.append(element('span','module-notification-title',item.title||'New record added'));
      const date=new Date(item.createdAt);copy.append(element('small','',Number.isNaN(date.getTime())?'New record':date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})));
      link.append(dot,copy);link.addEventListener('click',async event=>{
        event.preventDefault();link.setAttribute('aria-busy','true');
        try{await markRead({p_ids:[item.id]});}catch{/* The destination remains usable if marking read fails. */}
        location.assign(href);
      });list.append(link);
    }
    if(total>(feed.items||[]).length&&status==='ready')list.append(element('p','module-notification-more',`Showing the latest ${(feed.items||[]).length} new records`));
    document.querySelectorAll('aside a[href], .sidebar a[href]').forEach(link=>{
      const path=new URL(link.getAttribute('href'),location.href).pathname;
      const module=Object.keys(modules).find(key=>destination(key)&&new URL(destination(key)).pathname===path);
      let chip=link.querySelector('.module-new-badge');
      if(!module){chip?.remove();return;}
      const value=Number(feed.counts?.[module])||0;
      if(!chip){chip=element('span','module-new-badge');link.append(chip);}
      chip.dataset.module=module;chip.hidden=!value;chip.textContent=value>99?'99+':String(value);
      chip.setAttribute('aria-label',`${value} new ${modules[module][0]} records`);
    });
    document.body.dataset.notificationsState=status;
  }
  function close(){if(!panel)return;panel.hidden=true;button.setAttribute('aria-expanded','false');}
  function position(){
    const rect=button.getBoundingClientRect(),width=Math.min(390,innerWidth-24);
    panel.style.width=`${width}px`;panel.style.right=`${Math.min(Math.max(12,innerWidth-rect.right),innerWidth-width-12)}px`;
    panel.style.top=`${Math.min(Math.max(12,rect.bottom+10),innerHeight-160)}px`;
  }
  async function refresh(){
    if(disposed||!db||!userId)return;
    if(loading){again=true;return;}
    loading=true;const token=generation;
    try{
      const result=await db.rpc('pgenro_get_module_notifications',{p_limit:30});
      if(token!==generation||disposed)return;
      if(result.error)throw result.error;
      const data=result.data;
      if(!data||!Array.isArray(data.items)||!data.counts||typeof data.counts!=='object')throw new Error('Invalid notification response');
      const counts = Object.fromEntries(Object.entries(data.counts).filter(([module]) => modules[module]?.[2]));
      const items = data.items.filter(item => modules[item.module]?.[2]);
      const total = Object.values(counts).reduce((sum, count) => sum + (Number(count) || 0), 0);
      feed = { counts, items, total, workspace:'user' }; status='ready'; render();
    }catch{if(token===generation&&!disposed){feed=empty();status='unavailable';render();}}
    finally{loading=false;if(again){again=false;scheduleRefresh();}}
  }
  function scheduleRefresh(){clearTimeout(debounce);debounce=setTimeout(refresh,250);}
  async function markRead(args={}){
    const result=await db.rpc('pgenro_mark_notifications_read',args);if(result.error)throw result.error;
    await refresh();
  }
  async function attachSession(user){
    if(disposed)return;
    if(!user?.id){generation++;userId='';feed=empty();status='unavailable';close();render();if(channel)db.removeChannel(channel);channel=null;return;}
    if(userId===user.id){scheduleRefresh();return;}
    generation++;userId=user.id;feed=empty();status='loading';render();
    if(channel)db.removeChannel(channel);
    channel=db.channel(`pgenro-module-notifications-${user.id}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'pgenro_module_notifications'},scheduleRefresh)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'pgenro_notification_reads',filter:`user_id=eq.${user.id}`},scheduleRefresh)
      .subscribe(state=>{if(state==='SUBSCRIBED')scheduleRefresh();});
    await refresh();
  }
  function init(){
    const header=document.querySelector('.topbar-right,.depth-topbar-actions,.settings-topbar');if(!header)return;
    document.getElementById('notificationsBtn')?.closest('.notification-wrapper')?.remove();
    wrapper=element('div','module-notifications');button=element('button','module-notification-button');button.type='button';button.id='moduleNotificationButton';
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','moduleNotificationPanel');
    button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>';
    badge=element('span','module-notification-badge');badge.hidden=true;button.append(badge);wrapper.append(button);
    if(header.classList.contains('settings-topbar'))header.insertBefore(wrapper,header.lastElementChild);else header.prepend(wrapper);
    panel=element('section','module-notification-panel');panel.id='moduleNotificationPanel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','moduleNotificationTitle');
    const top=element('div','module-notification-heading'),heading=element('div');const title=element('h3','','Notifications');title.id='moduleNotificationTitle';
    count=element('small','','0 unread');count.setAttribute('aria-live','polite');heading.append(title,count);
    const closeBtn=element('button','module-notification-close','×');closeBtn.type='button';closeBtn.setAttribute('aria-label','Close notifications');closeBtn.onclick=()=>{close();button.focus();};top.append(heading,closeBtn);
    const tools=element('div','module-notification-tools'),retry=element('button','','Refresh');retry.type='button';retry.onclick=refresh;
    markAll=element('button','','Mark all read');markAll.type='button';markAll.onclick=async()=>{markAll.disabled=true;try{await markRead();}catch{count.textContent='Could not mark read. Try again.';}finally{markAll.disabled=!feed.total;}};
    tools.append(retry,markAll);list=element('div','module-notification-list');panel.append(top,tools,list);document.body.append(panel);
    button.addEventListener('click',()=>{const open=panel.hidden;close();if(open){panel.hidden=false;position();button.setAttribute('aria-expanded','true');closeBtn.focus();refresh();}});
    document.addEventListener('click',event=>{if(!wrapper.contains(event.target)&&!panel.contains(event.target))close();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();button.focus();}});
    window.addEventListener('resize',()=>{if(!panel.hidden)position();});
    window.addEventListener('focus',scheduleRefresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleRefresh();});
    window.addEventListener('pageshow',event=>{if(event.persisted)scheduleRefresh();});
    render();db=window.pgenroSupabase||window.PGENRO_DB?.client;
    if(!db){status='unavailable';render();return;}
    db.auth.getUser().then(result=>attachSession(result.data?.user)).catch(()=>attachSession(null));
    const subscription=db.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>attachSession(session?.user),0);});authSubscription=subscription.data?.subscription;
    timer=setInterval(()=>{if(!document.hidden)refresh();},30000);
    window.addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;generation++;clearInterval(timer);clearTimeout(debounce);authSubscription?.unsubscribe();if(channel)db.removeChannel(channel);});
  }
  window.PGENRO_Notifications={refresh,scheduleRefresh};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

