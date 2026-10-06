(() => {
  "use strict";

  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP",
    profileTable: "profiles",

    tables: {
      communications: "communications",
      serviceRequests: "service_requests",
      employees: "employees",
      travelOrders: "travel_orders",
      inventory: "inventory",
      ics: "ics_records",
      visitors: "visitors",
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

      visitorRecentList:
        $("#visitorRecentList"),

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

        totalEmployees:
          $("#kpiTotalEmployees"),

        totalTravel:
          $("#kpiTotalTravel"),

        activeTravel:
          $("#kpiActiveTravel"),

        totalAssets:
          $("#kpiTotalAssets"),

        totalIcs:
          $("#kpiTotalIcs"),

        visitorsToday:
          $("#kpiVisitorsToday"),

        visitorsInside:
          $("#kpiVisitorsInside")
      }
    };

    const state = {
      profile: null,

      records: {
        communications: [],
        serviceRequests: [],
        employees: [],
        travelOrders: [],
        inventory: [],
        ics: [],
        visitors: [],
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

    const mobileQuery =
      window.matchMedia(
        "(max-width: 1024px)"
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
      window.lucide
        ?.createIcons?.();
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

    function formatTime(
      record
    ) {
      const date =
        getRecordDate(
          record
        );

      if (!date) {
        return "—";
      }

      return new Intl
        .DateTimeFormat(
          "en-PH",
          {
            hour:
              "numeric",

            minute:
              "2-digit"
          }
        )
        .format(date);
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

    function isToday(
      record
    ) {
      const date =
        getRecordDate(
          record
        );

      if (!date) {
        return false;
      }

      const now =
        new Date();

      return (
        date.getFullYear() ===
          now.getFullYear() &&
        date.getMonth() ===
          now.getMonth() &&
        date.getDate() ===
          now.getDate()
      );
    }

    function getInitials(
      name
    ) {
      const words =
        text(
          name ||
          "Visitor"
        )
          .split(/\s+/)
          .filter(Boolean);

      if (
        !words.length
      ) {
        return "V";
      }

      if (
        words.length === 1
      ) {
        return words[0]
          .slice(0, 2)
          .toUpperCase();
      }

      return (
        `${words[0][0]}${
          words[
            words.length - 1
          ][0]
        }`
      ).toUpperCase();
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
        if (["admin", "administrator", "super admin", "superadmin", "system administrator"].includes(currentRole)) {
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

    function updateClock() {
      if (
        !ui.currentDateText
      ) {
        return;
      }

      ui.currentDateText
        .textContent =
        new Intl
          .DateTimeFormat(
            "en-PH",
            {
              weekday:
                "short",

              year:
                "numeric",

              month:
                "short",

              day:
                "numeric",

              hour:
                "2-digit",

              minute:
                "2-digit"
            }
          )
          .format(
            new Date()
          );
    }

    /* =========================================================
       KPI CALCULATION
       ========================================================= */

    function renderKPIs() {
      const communications =
        state.records
          .communications;

      const services =
        state.records
          .serviceRequests;

      const employees =
        state.records
          .employees;

      const travel =
        state.records
          .travelOrders;

      const inventory =
        state.records
          .inventory;

      const ics =
        state.records
          .ics;

      const visitors =
        state.records
          .visitors;

      let incoming = 0;
      let outgoing = 0;

      communications
        .forEach(
          (record) => {
            const type =
              lower(
                getFirstValue(
                  record,
                  [
                    "type",
                    "direction",
                    "document_type",
                    "category"
                  ],
                  "incoming"
                )
              );

            if (
              type.includes(
                "out"
              )
            ) {
              outgoing += 1;
            } else {
              incoming += 1;
            }
          }
        );

      const pendingServices =
        services.filter(
          (record) => {
            const status =
              lower(
                getFirstValue(
                  record,
                  [
                    "serviceStatus",
                    "service_status",
                    "status",
                    "request_status"
                  ],
                  "pending"
                )
              );

            return /pending|open|queue|review|evaluation|assess|in progress/
              .test(
                status
              );
          }
        ).length;

      const activeTravel =
        travel.filter(
          (record) => {
            const status =
              lower(
                getFirstValue(
                  record,
                  [
                    "status",
                    "travel_status",
                    "travelStatus"
                  ],
                  "active"
                )
              );

            return /active|ongoing|approved|field/
              .test(
                status
              );
          }
        ).length;

      const visitorsToday =
        visitors.filter(
          isToday
        ).length;

      const visitorsInside =
        visitors.filter(
          (record) => {
            const status =
              lower(
                getFirstValue(
                  record,
                  [
                    "status",
                    "visit_status",
                    "visitStatus"
                  ],
                  "inside"
                )
              );

            return /checked.?in|active|inside/
              .test(
                status
              );
          }
        ).length;

      const values = {
        totalComms:
          communications.length,

        incomingComms:
          incoming,

        outgoingComms:
          outgoing,

        totalServices:
          services.length,

        pendingServices,

        totalEmployees:
          employees.length,

        totalTravel:
          travel.length,

        activeTravel,

        totalAssets:
          inventory.length,

        totalIcs:
          ics.length,

        visitorsToday,

        visitorsInside
      };

      Object.entries(
        values
      ).forEach(
        ([
          key,
          value
        ]) => {
          if (
            ui.kpis[key]
          ) {
            ui.kpis[key]
              .textContent =
              Number(
                value
              ).toLocaleString();
          }
        }
      );

      if (
        ui.heroTotalRecords
      ) {
        const total =
          communications.length +
          services.length +
          employees.length +
          travel.length +
          inventory.length +
          ics.length +
          visitors.length +
          state.records
            .memos
            .length;

        ui.heroTotalRecords
          .textContent =
          total.toLocaleString();
      }
    }

    /* =========================================================
       VISITOR ACTIVITY
       ========================================================= */

    function renderVisitors() {
      if (
        !ui.visitorRecentList
      ) {
        return;
      }

      const visitors =
        sortNewest(
          state.records
            .visitors
        ).slice(
          0,
          5
        );

      if (
        !visitors.length
      ) {
        ui.visitorRecentList
          .innerHTML = `
            <div class="empty-state-box">
              <span class="empty-icon">
                <i data-lucide="clipboard-list"></i>
              </span>

              <h3>
                No Visitor Records
              </h3>

              <p>
                Visitor entries will appear here once available.
              </p>
            </div>
          `;

        refreshIcons();

        return;
      }

      ui.visitorRecentList
        .innerHTML =
        visitors
          .map(
            (visitor) => {
              const name =
                getFirstValue(
                  visitor,
                  [
                    "full_name",
                    "name",
                    "fullName",
                    "visitorName"
                  ],
                  "Visitor"
                );

              const destination =
                getFirstValue(
                  visitor,
                  [
                    "person_to_visit",
                    "personToVisit",
                    "office",
                    "organization",
                    "agency"
                  ],
                  "PGENRO Office"
                );

              const purpose =
                getFirstValue(
                  visitor,
                  [
                    "purpose_category",
                    "purposeCategory",
                    "purpose",
                    "reason"
                  ],
                  "General Transaction"
                );

              const status =
                text(
                  getFirstValue(
                    visitor,
                    [
                      "status",
                      "visit_status",
                      "visitStatus"
                    ],
                    "Inside"
                  )
                );

              const inside =
                /checked.?in|active|inside/i
                  .test(
                    status
                  );

              return `
                <div class="activity-item">
                  <span class="activity-avatar">
                    ${escapeHtml(
                      getInitials(
                        name
                      )
                    )}
                  </span>

                  <div class="activity-copy">
                    <strong>
                      ${escapeHtml(
                        name
                      )}
                    </strong>

                    <span>
                      ${escapeHtml(
                        destination
                      )}
                      ·
                      ${escapeHtml(
                        purpose
                      )}
                    </span>
                  </div>

                  <div class="activity-meta">
                    <span class="activity-time">
                      ${escapeHtml(
                        formatTime(
                          visitor
                        )
                      )}
                    </span>

                    <span class="status-badge ${
                      inside
                        ? "status-active"
                        : "status-completed"
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

      const pending =
        state.records
          .serviceRequests
          .filter(
            (record) => {
              const status =
                lower(
                  getFirstValue(
                    record,
                    [
                      "serviceStatus",
                      "service_status",
                      "status",
                      "request_status"
                    ],
                    "pending"
                  )
                );

              return /pending|open|queue|review|evaluation|assess|in progress/
                .test(
                  status
                );
            }
          ).length;

      if (
        ui.servicePendingSummary
      ) {
        ui.servicePendingSummary
          .textContent =
          `${pending} pending`;
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
                No Active Service Requests
              </h3>

              <p>
                Requests will appear here once registered.
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
                  No Pinned Memorandums
                </h3>

                <p>
                  Pinned office notices will appear here once available.
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

              const detailsUrl =
                getFirstValue(
                  memo,
                  [
                    "details_url",
                    "url",
                    "link"
                  ],
                  "officememo.html"
                );

              const downloadUrl =
                getFirstValue(
                  memo,
                  [
                    "download_url",
                    "file_url",
                    "fileUrl"
                  ],
                  ""
                );

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
                    <a
                      class="memo-link"
                      href="${escapeHtml(
                        detailsUrl
                      )}"
                    >
                      <i data-lucide="file-text"></i>
                      Read Details
                    </a>

                    ${
                      downloadUrl
                        ? `
                          <a
                            class="memo-download"
                            href="${escapeHtml(
                              downloadUrl
                            )}"
                            target="_blank"
                            rel="noopener"
                            aria-label="Download memo attachment"
                          >
                            <i data-lucide="download"></i>
                          </a>
                        `
                        : ""
                    }
                  </div>
                </article>
              `;
            }
          )
          .join("");

      refreshIcons();
    }

    /* =========================================================
       ADMIN-MATCHED CHARTS — existing user panels only
       Same six activity modules, date precedence, 90-day range,
       weekly buckets, datasets, palette, and options as admin.
       ========================================================= */

    const chartDayMs = 86400000;
    const chartActivityModules = [
      { key: "communications", sourceKey: "communications", label: "Communications", color: "#2563eb" },
      { key: "memos", sourceKey: "memos", label: "Office Memos", color: "#059669" },
      { key: "travel", sourceKey: "travelOrders", label: "Travel Orders", color: "#8b5cf6" },
      { key: "visitors", sourceKey: "visitors", label: "Visitors", color: "#d97706" },
      { key: "services", sourceKey: "serviceRequests", label: "Service Requests", color: "#e05271" },
      { key: "ics", sourceKey: "ics", label: "ICS Property Slips", color: "#0891b2" }
    ];

    function chartRecordDay(row) {
      const fields = [
        "date", "receivedDate", "date_received", "letterDate", "docDate",
        "requestDate", "date_requested", "dateIssued", "memoDate",
        "departureDate", "travelDate", "date_from", "dateFrom",
        "dateAcquired", "time_in", "timeIn", "created_at", "createdAt", "timestamp"
      ];
      for (const field of fields) {
        const raw = row?.[field];
        if (!raw) continue;
        let date;
        if (typeof raw?.toDate === "function") date = raw.toDate();
        else if (typeof raw === "string") {
          date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:/.test(raw) ? raw.replace(" ", "T") : raw);
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) date = new Date(`${raw}T00:00:00`);
        } else if (raw instanceof Date) date = raw;
        else if (typeof raw === "number") date = new Date(raw > 1e11 ? raw : raw * 1000);
        if (date instanceof Date && !Number.isNaN(date.getTime())) {
          return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / chartDayMs);
        }
      }
      return null;
    }

    function buildDashboardChartModel(now = new Date()) {
      const end = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / chartDayMs);
      const start = end - 89;
      const buckets = [];
      for (let day = start; day <= end; day += 7) {
        buckets.push({
          label: new Date(day * chartDayMs).toLocaleDateString("en-US", {
            month: "short", day: "numeric", timeZone: "UTC"
          }),
          documents: 0, travel: 0, visitors: 0, services: 0, total: 0
        });
      }

      const breakdown = chartActivityModules.map((module) => {
        let current = 0;
        let missing = 0;
        for (const row of state.records[module.sourceKey] || []) {
          const day = chartRecordDay(row);
          if (day === null) { missing++; continue; }
          if (day < start || day > end) continue;
          current++;
          const bucket = buckets[Math.floor((day - start) / 7)];
          const key = ["communications", "memos", "ics"].includes(module.key) ? "documents" : module.key;
          bucket[key]++;
          bucket.total++;
        }
        return { ...module, current, missing, available: state.chartSources[module.sourceKey] === "live" };
      });

      return {
        start, end, buckets, breakdown,
        total: breakdown.reduce((sum, module) => sum + module.current, 0),
        availableCount: breakdown.filter((module) => module.available).length,
        missingDates: breakdown.reduce((sum, module) => sum + module.missing, 0)
      };
    }

    function userChartBaseOptions() {
      return {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 400 },
        plugins: {
          legend: {
            position: "bottom",
            labels: { usePointStyle: true, boxWidth: 6, padding: 12, font: { size: 10, family: "Plus Jakarta Sans" } }
          }
        }
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
          const area = dataset.fill ? `<polygon points="35,180 ${points} 585,180" fill="${dataset.backgroundColor}"/>` : "";
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
        legend = labels.map((label, index) => `<span><i style="background:${dataset.backgroundColor[index]}"></i>${escapeHtml(label)} (${dataset.data[index]})</span>`).join("");
      }
      fallback.innerHTML = `${svg}<div class="homepage-chart-legend">${legend}</div>`;
    }

    function updateUserChart(key, canvas, config) {
      if (!canvas) return;
      if (typeof window.Chart === "function") {
        try {
          canvas.hidden = false;
          if (state.charts[key]) {
            state.charts[key].data = config.data;
            state.charts[key].options = config.options;
            state.charts[key].update();
          } else {
            state.charts[key] = new window.Chart(canvas, config);
          }
          canvas.parentElement.querySelector(".homepage-chart-fallback")?.remove();
          return;
        } catch (error) {
          state.charts[key]?.destroy();
          state.charts[key] = null;
          console.warn("Dashboard chart is using its native fallback:", error);
        }
      }
      renderNativeUserChart(canvas, config);
    }

    function renderCommunicationChart(model) {
      updateUserChart("comm", ui.commCompareChart, {
        type: "line",
        data: {
          labels: model.buckets.map((bucket) => bucket.label),
          datasets: [
            { label: "Documents & ICS", borderColor: "#059669", backgroundColor: "rgba(5, 150, 105, 0.08)", data: model.buckets.map((bucket) => bucket.documents), fill: true },
            { label: "Travel Orders", borderColor: "#8b5cf6", data: model.buckets.map((bucket) => bucket.travel) },
            { label: "Visitors", borderColor: "#d97706", data: model.buckets.map((bucket) => bucket.visitors) },
            { label: "Service Requests", borderColor: "#e05271", data: model.buckets.map((bucket) => bucket.services) }
          ].map((dataset) => ({ ...dataset, tension: 0.3, borderWidth: 2, pointRadius: 2.5 }))
        },
        options: {
          ...userChartBaseOptions(),
          scales: {
            x: { grid: { display: false }, ticks: { maxRotation: 0, font: { size: 10 } } },
            y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#e2e8f0" } }
          }
        }
      });
    }

    function renderOperationsChart(model) {
      updateUserChart("operations", ui.operationsDistChart, {
        type: "doughnut",
        data: {
          labels: chartActivityModules.map((module) => module.label),
          datasets: [{
            data: model.breakdown.map((module) => module.current),
            backgroundColor: chartActivityModules.map((module) => module.color),
            borderWidth: 2, borderColor: "#ffffff"
          }]
        },
        options: { ...userChartBaseOptions(), cutout: "70%" }
      });
    }

    function renderDashboardCharts() {
      const model = buildDashboardChartModel();
      const missingNote = model.missingDates ? ` ${model.missingDates} records without valid dates are excluded.` : "";
      const availabilityNote = `${model.availableCount} of 6 activity modules available.`;
      const trendSummary = $("#dashboardTrendSummary");
      const distributionSummary = $("#dashboardDistributionSummary");
      if (trendSummary) trendSummary.textContent = `${model.total} dated records over the last 90 days. ${availabilityNote}${missingNote}`;
      if (distributionSummary) distributionSummary.textContent = `${availabilityNote} ${model.breakdown.map((module) => `${module.label}: ${module.current}`).join("; ")}.${missingNote}`;
      for (const id of ["dashboardTrendEmpty", "dashboardDistributionEmpty"]) {
        const empty = $(`#${id}`);
        if (!empty) continue;
        empty.hidden = model.total > 0;
        empty.textContent = model.availableCount ? "No dated activity recorded in this period." : "Chart data is unavailable.";
      }
      renderCommunicationChart(model);
      renderOperationsChart(model);
    }

    /* =========================================================
       RENDER EVERYTHING
       ========================================================= */

    function renderAll() {
      renderKPIs();

      renderVisitors();

      renderServices();

      renderMemos();

      renderDashboardCharts();

      refreshIcons();
    }

    /* =========================================================
       SUPABASE QUERY
       ========================================================= */

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

        showToast(
          "Supabase client is unavailable.",
          "error"
        );

        return;
      }

      state.loading =
        true;

      setDatabaseStatus(
        "standby",
        "Loading office records…"
      );

      if (
        ui.refreshDashboardBtn
      ) {
        ui.refreshDashboardBtn
          .disabled =
          true;
      }

      const requests =
        Object.entries(
          CONFIG.tables
        );

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
        failed
          ? "standby"
          : "online",

        failed
          ? `Dashboard loaded with ${failed} unavailable module${
              failed === 1
                ? ""
                : "s"
            }`
          : "Office records connected"
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

      if (
        ui.refreshDashboardBtn
      ) {
        ui.refreshDashboardBtn
          .disabled =
          false;
      }
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
      ).forEach(
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

      state.realtimeChannel
        .subscribe(
          (status) => {
            if (
              status ===
              "SUBSCRIBED"
            ) {
              setDatabaseStatus(
                "online",
                "Office records connected"
              );
            }

            if (
              status ===
              "CHANNEL_ERROR"
            ) {
              setDatabaseStatus(
                "standby",
                "Realtime connection interrupted"
              );
            }
          }
        );
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

      ui.refreshDashboardBtn
        ?.addEventListener(
          "click",
          () => {
            loadDashboardData({
              notify: true
            });
          }
        );

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