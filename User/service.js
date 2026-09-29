(() => {
  "use strict";

  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP",
    serviceTable: "service_requests",
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
      ...parent.querySelectorAll(selector)
    ];

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

      refreshBtn: $("#refreshRecordsBtn"),

      quickSearchInput: $("#quickSearchInput"),
      btnTrack: $("#btnTrack"),

      kpiTotal: $("#kpiTotal"),
      kpiEvaluation: $("#kpiEvaluation"),
      kpiInProgress: $("#kpiInProgress"),
      kpiCompleted: $("#kpiCompleted"),

      tableSearchInput: $("#tableSearchInput"),
      filterStatusSelect: $("#filterStatusSelect"),
      tableBody: $("#tableBody"),
      tableSummaryText: $("#tableSummaryText"),

      inspectModal: $("#inspectModal"),
      dismissModalIcon: $("#dismissModalIcon"),
      closeInspectModalBottom: $("#closeInspectModalBottom"),
      printRecordBtn: $("#printRecordBtn"),

      popupModalTitle: $("#popupModalTitle"),
      stepperServiceNo: $("#stepperServiceNo"),
      stepperStatusBadge: $("#stepperStatusBadge"),

      tabButtons: $$(".tab-btn"),
      tabPanes: $$(".tab-pane"),

      toastContainer: $("#toastContainer")
    };

    const state = {
      records: [],
      currentRecord: null,
      realtimeChannel: null,
      loading: false,
      modalOpen: false,
      currentProfile: null,
      lastFocusedElement: null
    };

    const mobileQuery =
      window.matchMedia(
        "(max-width: 1024px)"
      );

    const text = (value) =>
      String(value ?? "").trim();

    const lower = (value) =>
      text(value).toLowerCase();

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

    function setText(id, value) {
      const element =
        document.getElementById(id);

      if (!element) return;

      element.textContent =
        text(value) || "--";
    }

    function showToast(
      message,
      type = "success"
    ) {
      if (!ui.toastContainer) return;

      const icons = {
        success: "circle-check",
        warning: "triangle-alert",
        error: "circle-alert"
      };

      const toast =
        document.createElement("div");

      toast.className =
        `toast ${type}`;

      toast.innerHTML = `
        <i data-lucide="${
          icons[type] ||
          icons.success
        }"></i>
        <span></span>
      `;

      toast
        .querySelector("span")
        .textContent = message;

      ui.toastContainer.appendChild(
        toast
      );

      refreshIcons();

      window.setTimeout(
        () => toast.remove(),
        3200
      );
    }

    function setDbStatus(
      type,
      message
    ) {
      if (ui.dbStatusIndicator) {
        ui.dbStatusIndicator.className =
          `status-indicator ${type}`;
      }

      if (ui.dbStatusText) {
        ui.dbStatusText.textContent =
          message;
      }
    }

    function populateProfile(
      profile = {}
    ) {
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

      $$(
        ".profile-text strong"
      ).forEach((node) => {
        node.textContent = name;
      });

      $$(
        ".profile-text small"
      ).forEach((node) => {
        node.textContent = role;
      });

      $$(
        ".profile-dropdown-header h3"
      ).forEach((node) => {
        node.textContent = name;
      });

      $$(
        ".profile-dropdown-header p"
      ).forEach((node) => {
        node.textContent = email;
      });
    }

    function cacheProfile(
      user,
      profile = {}
    ) {
      const cached = {
        id: user.id,
        uid: user.id,

        fullName:
          text(profile.full_name) ||
          text(profile.username) ||
          text(user.email) ||
          "PGENRO User",

        username:
          text(profile.username),

        email:
          text(profile.email) ||
          text(user.email),

        contact:
          text(profile.contact),

        position:
          text(profile.position),

        division:
          text(profile.division),

        role:
          text(profile.role) ||
          "user",

        accountType:
          text(
            profile.account_type
          ) ||
          "Standard User",

        status:
          text(profile.status) ||
          "Active"
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
      if (
        !client ||
        !ui.body.dataset.requiresAuth
      ) {
        return true;
      }

      try {
        const {
          data,
          error
        } =
          await client.auth.getSession();

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
          error: profileError
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

          populateProfile(
            state.currentProfile
          );

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
          typeof profile?.is_active ===
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
              ].includes(status)
            )
          )
        ) {
          await logout({
            ask: false
          });

          return false;
        }

        state.currentProfile = {
          ...(profile || {}),

          email:
            text(profile?.email) ||
            text(user.email),

          authUser: user
        };

        cacheProfile(
          user,
          state.currentProfile
        );

        return true;

      } catch (error) {
        console.error(
          "Unable to verify current PGENRO session:",
          error
        );

        setDbStatus(
          "offline",
          "Session verification failed"
        );

        showToast(
          "Unable to verify your account session.",
          "error"
        );

        return false;
      }
    }

    function redirectToLogin() {
      window.location.replace(
        ui.body.dataset.loginUrl ||
        "login.html"
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
        await client?.auth.signOut();
      } catch (error) {
        console.warn(
          "Remote sign-out was unavailable:",
          error
        );
      }

      try {
        for (
          const key of
          Object.keys(localStorage)
        ) {
          if (
            key.startsWith("sb-") ||
            key.startsWith("pgenro_")
          ) {
            localStorage.removeItem(
              key
            );
          }
        }

        sessionStorage.clear();

      } catch {
        // Continue even if storage cleanup fails.
      }

      redirectToLogin();
    }

    function closeProfile() {
      ui.profileMenu
        ?.classList
        .remove("open");

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
          .contains("open");

      closeProfile();

      if (shouldOpen) {
        ui.profileMenu
          .classList
          .add("open");

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

    function syncOverlay() {
      const sidebarOpen =
        mobileQuery.matches &&
        Boolean(
          ui.sidebar
            ?.classList
            .contains("open")
        );

      ui.overlay
        ?.classList
        .toggle(
          "active",
          sidebarOpen
        );

      ui.overlay
        ?.setAttribute(
          "aria-hidden",
          String(!sidebarOpen)
        );

      ui.body.classList.toggle(
        "sidebar-open",
        sidebarOpen
      );

      ui.body.classList.toggle(
        "modal-open",
        state.modalOpen
      );
    }

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

      ui.hamburger
        ?.setAttribute(
          "aria-expanded",
          String(shouldOpen)
        );

      ui.hamburger
        ?.setAttribute(
          "aria-label",
          shouldOpen
            ? "Close module menu"
            : "Open module menu"
        );

      syncOverlay();
    }

    function serviceField(
      item,
      ...keys
    ) {
      for (
        const key of keys
      ) {
        if (
          item?.[key] !== undefined &&
          item?.[key] !== null &&
          text(item[key]) !== ""
        ) {
          return item[key];
        }
      }

      return undefined;
    }

    function calculateCurrentStep(
      status
    ) {
      const value =
        lower(status);

      if (
        value.includes("release") ||
        value.includes("complete")
      ) {
        return 5;
      }

      if (
        value.includes("process") ||
        value.includes("rendered")
      ) {
        return 4;
      }

      if (
        value.includes("pgdh") ||
        value.includes("approved") ||
        value.includes("action")
      ) {
        return 3;
      }

      if (
        value.includes("assess") ||
        value.includes("evaluat") ||
        value.includes("inspect")
      ) {
        return 2;
      }

      return 1;
    }

    function normalizeRecord(
      raw = {}
    ) {
      const item =
        raw?.data &&
        typeof raw.data === "object"
          ? {
              ...raw,
              ...raw.data
            }
          : raw;

      const status =
        serviceField(
          item,
          "serviceStatus",
          "service_status",
          "status"
        ) ||
        "Under Evaluation";

      const id =
        serviceField(
          item,
          "id",
          "serviceNo",
          "service_no",
          "trackingNo",
          "tracking_no"
        ) ||
        crypto.randomUUID();

      const joinDateTime = (
        dateKeys,
        timeKeys
      ) => {
        const date =
          serviceField(
            item,
            ...dateKeys
          );

        const time =
          serviceField(
            item,
            ...timeKeys
          );

        return date
          ? `${date}${
              time
                ? ` • ${time}`
                : ""
            }`
          : "--";
      };

      return {
        id:
          String(id),

        serviceNo:
          serviceField(
            item,
            "serviceNo",
            "service_no",
            "trackingNo",
            "tracking_no"
          ) ||
          String(id),

        clientName:
          serviceField(
            item,
            "clientName",
            "client_name",
            "fullName",
            "full_name",
            "name"
          ) ||
          "--",

        organization:
          serviceField(
            item,
            "organization",
            "agency"
          ) ||
          "--",

        contactNo:
          serviceField(
            item,
            "contactNo",
            "contact_no",
            "contact"
          ) ||
          "--",

        emailAddress:
          serviceField(
            item,
            "emailAddress",
            "email_address",
            "email"
          ) ||
          "--",

        dateRequest:
          serviceField(
            item,
            "dateRequest",
            "date_request",
            "dateRequested",
            "date_requested",
            "created_at"
          ) ||
          "--",

        primaryCategory:
          serviceField(
            item,
            "primaryCategory",
            "primary_category",
            "category"
          ) ||
          "TECHNICAL ASSISTANCE",

        secondaryCategory:
          serviceField(
            item,
            "secondaryCategory",
            "secondary_category",
            "type"
          ) ||
          "--",

        concernsCategory:
          serviceField(
            item,
            "concernsCategory",
            "concerns_category",
            "concern"
          ) ||
          "--",

        certifications:
          serviceField(
            item,
            "certifications"
          ) ||
          "--",

        otherServices:
          serviceField(
            item,
            "otherServices",
            "other_services"
          ) ||
          "--",

        requestDetails:
          serviceField(
            item,
            "requestDetails",
            "request_details",
            "details",
            "scope"
          ) ||
          "--",

        dateNeeded:
          serviceField(
            item,
            "dateNeeded",
            "date_needed"
          ) ||
          "--",

        location:
          serviceField(
            item,
            "location",
            "site"
          ) ||
          "--",

        requestedBy:
          serviceField(
            item,
            "requestedBy",
            "requested_by",
            "clientName",
            "client_name"
          ) ||
          "--",

        endorsedBy:
          serviceField(
            item,
            "endorsedBy",
            "endorsed_by"
          ) ||
          "--",

        serviceStatus:
          String(status),

        receivedBy:
          serviceField(
            item,
            "receivedBy",
            "received_by"
          ) ||
          "--",

        dateReceived:
          serviceField(
            item,
            "dateReceived",
            "date_received"
          ) ||
          "--",

        timeReceived:
          serviceField(
            item,
            "timeReceived",
            "time_received"
          ) ||
          "--",

        receivedRemarks:
          serviceField(
            item,
            "receivedRemarks",
            "received_remarks"
          ) ||
          "--",

        assessedBy:
          serviceField(
            item,
            "assessedBy",
            "assessed_by"
          ) ||
          "--",

        dateAssessed:
          serviceField(
            item,
            "dateAssessed",
            "date_assessed"
          ) ||
          "--",

        timeAssessed:
          serviceField(
            item,
            "timeAssessed",
            "time_assessed"
          ) ||
          "--",

        assessedRemarks:
          serviceField(
            item,
            "assessedRemarks",
            "assessed_remarks"
          ) ||
          "--",

        recommendedBy:
          serviceField(
            item,
            "recommendedBy",
            "recommended_by"
          ) ||
          "--",

        recDate:
          joinDateTime(
            [
              "recDate",
              "rec_date"
            ],
            [
              "recTime",
              "rec_time"
            ]
          ),

        recRemarks:
          serviceField(
            item,
            "recRemarks",
            "rec_remarks"
          ) ||
          "--",

        pgdhAction:
          serviceField(
            item,
            "pgdhAction",
            "pgdh_action"
          ) ||
          "--",

        pgdhDateActed:
          joinDateTime(
            [
              "pgdhDateActed",
              "pgdh_date_acted"
            ],
            [
              "pgdhTimeActed",
              "pgdh_time_acted"
            ]
          ),

        pgdhInstructions:
          serviceField(
            item,
            "pgdhInstructions",
            "pgdh_instructions"
          ) ||
          "--",

        processedBy:
          serviceField(
            item,
            "processedBy",
            "processed_by"
          ) ||
          "--",

        dateProcessed:
          joinDateTime(
            [
              "dateProcessed",
              "date_processed"
            ],
            [
              "timeProcessed",
              "time_processed"
            ]
          ),

        processedRemarks:
          serviceField(
            item,
            "processedRemarks",
            "processed_remarks"
          ) ||
          "--",

        serviceReceivedBy:
          serviceField(
            item,
            "serviceReceivedBy",
            "service_received_by"
          ) ||
          "--",

        finalDateRec:
          joinDateTime(
            [
              "finalDateRec",
              "final_date_rec"
            ],
            [
              "finalTimeRec",
              "final_time_rec"
            ]
          ),

        finalRemarks:
          serviceField(
            item,
            "finalRemarks",
            "final_remarks"
          ) ||
          "--",

        currentStep:
          Number(
            serviceField(
              item,
              "currentStep",
              "current_step"
            )
          ) ||
          calculateCurrentStep(
            status
          )
      };
    }

    function getStatusType(
      status
    ) {
      const value =
        lower(status);

      if (
        value.includes("complete") ||
        value.includes("release")
      ) {
        return "completed";
      }

      if (
        value.includes("progress") ||
        value.includes("field") ||
        value.includes("process") ||
        value.includes("pgdh")
      ) {
        return "progress";
      }

      if (
        value.includes("evaluation") ||
        value.includes("assess") ||
        value.includes("inspect")
      ) {
        return "evaluation";
      }

      return "default";
    }

    function statusClass(
      status
    ) {
      return `status-${
        getStatusType(status)
      }`;
    }

    function updateMetrics() {
      const total =
        state.records.length;

      const evaluation =
        state.records.filter(
          (record) =>
            getStatusType(
              record.serviceStatus
            ) === "evaluation"
        ).length;

      const completed =
        state.records.filter(
          (record) =>
            getStatusType(
              record.serviceStatus
            ) === "completed"
        ).length;

      const inProgress =
        Math.max(
          0,
          total -
            evaluation -
            completed
        );

      if (ui.kpiTotal) {
        ui.kpiTotal.textContent =
          total.toLocaleString();
      }

      if (ui.kpiEvaluation) {
        ui.kpiEvaluation.textContent =
          evaluation.toLocaleString();
      }

      if (ui.kpiInProgress) {
        ui.kpiInProgress.textContent =
          inProgress.toLocaleString();
      }

      if (ui.kpiCompleted) {
        ui.kpiCompleted.textContent =
          completed.toLocaleString();
      }
    }

    function matchesStatusFilter(
      record,
      filterValue
    ) {
      if (
        filterValue === "ALL"
      ) {
        return true;
      }

      const status =
        lower(
          record.serviceStatus
        );

      const filter =
        lower(filterValue);

      if (
        filter === "completed"
      ) {
        return (
          getStatusType(
            record.serviceStatus
          ) === "completed"
        );
      }

      if (
        filter === "in progress"
      ) {
        return (
          getStatusType(
            record.serviceStatus
          ) === "progress"
        );
      }

      if (
        filter ===
        "field inspection active"
      ) {
        return (
          status.includes("field") ||
          status.includes("inspect")
        );
      }

      if (
        filter ===
        "under evaluation"
      ) {
        return (
          getStatusType(
            record.serviceStatus
          ) === "evaluation"
        );
      }

      return status === filter;
    }

    function getFilteredRecords() {
      const query =
        lower(
          ui.tableSearchInput?.value
        );

      const statusFilter =
        ui.filterStatusSelect
          ?.value ||
        "ALL";

      return state.records.filter(
        (record) => {
          const haystack = [
            record.serviceNo,
            record.clientName,
            record.organization,
            record.primaryCategory,
            record.secondaryCategory,
            record.serviceStatus
          ]
            .map(lower)
            .join(" ");

          const matchesSearch =
            !query ||
            haystack.includes(
              query
            );

          const matchesStatus =
            matchesStatusFilter(
              record,
              statusFilter
            );

          return (
            matchesSearch &&
            matchesStatus
          );
        }
      );
    }

    function renderTable() {
      if (!ui.tableBody) return;

      const filtered =
        getFilteredRecords();

      if (
        ui.tableSummaryText
      ) {
        ui.tableSummaryText.textContent =
          `Showing ${
            filtered.length
          } of ${
            state.records.length
          } requests`;
      }

      if (!filtered.length) {
        ui.tableBody.innerHTML = `
          <tr>
            <td
              class="empty-table-cell"
              colspan="7"
            >
              No matching service requests found.
            </td>
          </tr>
        `;

        return;
      }

      ui.tableBody.innerHTML =
        filtered
          .map(
            (record) => `
        <tr>
          <td>
            <span
              class="service-no font-mono"
            >
              ${escapeHtml(
                record.serviceNo
              )}
            </span>
          </td>

          <td class="client-cell">
            <strong>
              ${escapeHtml(
                record.clientName
              )}
            </strong>
          </td>

          <td>
            <div
              class="organization-cell"
              title="${escapeHtml(
                record.organization
              )}"
            >
              ${escapeHtml(
                record.organization
              )}
            </div>
          </td>

          <td>
            <span
              class="category-pill"
              title="${escapeHtml(
                record.primaryCategory
              )}"
            >
              ${escapeHtml(
                record.primaryCategory
              )}
            </span>
          </td>

          <td>
            ${escapeHtml(
              record.dateRequest
            )}
          </td>

          <td>
            <span
              class="status-badge ${
                statusClass(
                  record.serviceStatus
                )
              }"
            >
              ${escapeHtml(
                record.serviceStatus
              )}
            </span>
          </td>

          <td class="action-column">
            <button
              class="btn-inspect"
              type="button"
              data-record-id="${escapeHtml(
                record.id
              )}"
            >
              <i data-lucide="eye"></i>
              <span>Inspect</span>
            </button>
          </td>
        </tr>
      `
          )
          .join("");

      refreshIcons();
    }

    function render() {
      updateMetrics();
      renderTable();
    }

    function loadLocalRecords() {
      try {
        const local =
          JSON.parse(
            localStorage.getItem(
              "serviceRequests"
            ) ||
            "[]"
          );

        state.records =
          Array.isArray(local)
            ? local.map(
                normalizeRecord
              )
            : [];

      } catch (error) {
        console.warn(
          "Unable to read local service records:",
          error
        );

        state.records = [];
      }

      render();
    }

    async function loadServiceRecords({
      notify = false
    } = {}) {
      if (state.loading) return;

      if (!client) {
        setDbStatus(
          "offline",
          "Local service mode"
        );

        loadLocalRecords();

        if (notify) {
          showToast(
            "Supabase is unavailable. Showing local service records.",
            "warning"
          );
        }

        return;
      }

      state.loading = true;

      setDbStatus(
        "standby",
        "Loading service records…"
      );

      if (ui.refreshBtn) {
        ui.refreshBtn.disabled =
          true;
      }

      try {
        const {
          data,
          error
        } =
          await client
            .from(
              CONFIG.serviceTable
            )
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

        state.records =
          (data || [])
            .map(
              normalizeRecord
            );

        setDbStatus(
          "online",
          "Service database connected"
        );

        render();

        if (notify) {
          showToast(
            "Service requests synchronized."
          );
        }

      } catch (error) {
        console.error(
          "Unable to load service requests:",
          error
        );

        setDbStatus(
          "offline",
          "Service database unavailable"
        );

        loadLocalRecords();

        showToast(
          state.records.length
            ? "Database unavailable. Showing local service records."
            : "Unable to load service requests.",
          state.records.length
            ? "warning"
            : "error"
        );

      } finally {
        state.loading = false;

        if (ui.refreshBtn) {
          ui.refreshBtn.disabled =
            false;
        }
      }
    }

    function subscribeRealtime() {
      if (
        !client ||
        state.realtimeChannel
      ) {
        return;
      }

      state.realtimeChannel =
        client
          .channel(
            "user-service-requests-live"
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table:
                CONFIG.serviceTable
            },
            () => {
              loadServiceRecords();
            }
          )
          .subscribe(
            (status) => {
              if (
                status ===
                "SUBSCRIBED"
              ) {
                setDbStatus(
                  "online",
                  "Service database connected"
                );
              }

              if (
                status ===
                "CHANNEL_ERROR"
              ) {
                setDbStatus(
                  "standby",
                  "Realtime connection interrupted"
                );
              }
            }
          );
    }

    function updateStepper(
      activeStepNumber
    ) {
      for (
        let index = 1;
        index <= 5;
        index += 1
      ) {
        const step =
          document.getElementById(
            `step${index}`
          );

        const line =
          document.getElementById(
            `line${index}`
          );

        if (!step) continue;

        step.classList.remove(
          "completed",
          "active"
        );

        line?.classList.remove(
          "active"
        );

        if (
          index <
          activeStepNumber
        ) {
          step.classList.add(
            "completed"
          );

          line?.classList.add(
            "active"
          );

        } else if (
          index ===
          activeStepNumber
        ) {
          step.classList.add(
            "active"
          );
        }
      }
    }

    function switchTab(
      tabNumber
    ) {
      ui.tabButtons.forEach(
        (button) => {
          const isActive =
            Number(
              button.dataset.tab
            ) === tabNumber;

          button.classList.toggle(
            "active",
            isActive
          );

          button.setAttribute(
            "aria-selected",
            String(isActive)
          );
        }
      );

      ui.tabPanes.forEach(
        (pane) => {
          pane.classList.toggle(
            "active",
            pane.id ===
              `tabPane${tabNumber}`
          );
        }
      );

      refreshIcons();
    }

    function populateModal(
      record
    ) {
      if (!record) return;

      if (
        ui.popupModalTitle
      ) {
        ui.popupModalTitle.textContent =
          `Service Record: ${
            record.serviceNo
          }`;
      }

      if (
        ui.stepperServiceNo
      ) {
        ui.stepperServiceNo.textContent =
          record.serviceNo;
      }

      if (
        ui.stepperStatusBadge
      ) {
        ui.stepperStatusBadge.textContent =
          record.serviceStatus;

        ui.stepperStatusBadge.className =
          `status-badge ${
            statusClass(
              record.serviceStatus
            )
          }`;
      }

      setText(
        "viewServiceNo",
        record.serviceNo
      );

      setText(
        "viewClientName",
        record.clientName
      );

      setText(
        "viewOrganization",
        record.organization
      );

      setText(
        "viewContactNo",
        record.contactNo
      );

      setText(
        "viewEmailAddress",
        record.emailAddress
      );

      setText(
        "viewDateRequest",
        record.dateRequest
      );

      setText(
        "viewPrimaryCategory",
        record.primaryCategory
      );

      setText(
        "viewSecondaryCategory",
        record.secondaryCategory
      );

      setText(
        "viewConcernsCategory",
        record.concernsCategory
      );

      setText(
        "viewCertifications",
        record.certifications
      );

      setText(
        "viewOtherServices",
        record.otherServices
      );

      setText(
        "viewRequestDetails",
        record.requestDetails
      );

      setText(
        "viewDateNeeded",
        record.dateNeeded
      );

      setText(
        "viewLocation",
        record.location
      );

      setText(
        "viewRequestedBy",
        record.requestedBy
      );

      setText(
        "viewEndorsedBy",
        record.endorsedBy
      );

      setText(
        "viewServiceStatus",
        record.serviceStatus
      );

      setText(
        "viewReceivedBy",
        record.receivedBy
      );

      setText(
        "viewDateReceived",
        record.dateReceived
      );

      setText(
        "viewTimeReceived",
        record.timeReceived
      );

      setText(
        "viewReceivedRemarks",
        record.receivedRemarks
      );

      setText(
        "viewAssessedBy",
        record.assessedBy
      );

      setText(
        "viewDateAssessed",
        record.dateAssessed
      );

      setText(
        "viewTimeAssessed",
        record.timeAssessed
      );

      setText(
        "viewAssessedRemarks",
        record.assessedRemarks
      );

      setText(
        "viewRecommendedBy",
        record.recommendedBy
      );

      setText(
        "viewRecDate",
        record.recDate
      );

      setText(
        "viewRecRemarks",
        record.recRemarks
      );

      setText(
        "viewPgdhAction",
        record.pgdhAction
      );

      setText(
        "viewPgdhDateActed",
        record.pgdhDateActed
      );

      setText(
        "viewPgdhInstructions",
        record.pgdhInstructions
      );

      setText(
        "viewProcessedBy",
        record.processedBy
      );

      setText(
        "viewDateProcessed",
        record.dateProcessed
      );

      setText(
        "viewProcessedRemarks",
        record.processedRemarks
      );

      setText(
        "viewServiceReceivedBy",
        record.serviceReceivedBy
      );

      setText(
        "viewFinalDateRec",
        record.finalDateRec
      );

      setText(
        "viewFinalRemarks",
        record.finalRemarks
      );

      updateStepper(
        record.currentStep || 1
      );

      switchTab(1);
    }

    function openInspectModal(
      record
    ) {
      if (
        !record ||
        !ui.inspectModal
      ) {
        return;
      }

      closeProfile();

      setSidebarOpen(false);

      state.currentRecord =
        record;

      state.modalOpen =
        true;

      state.lastFocusedElement =
        document.activeElement;

      populateModal(record);

      ui.inspectModal
        .classList
        .add("open");

      ui.inspectModal
        .setAttribute(
          "aria-hidden",
          "false"
        );

      syncOverlay();

      refreshIcons();

      requestAnimationFrame(
        () => {
          ui.dismissModalIcon
            ?.focus();
        }
      );
    }

    function closeInspectModal() {
      if (
        !state.modalOpen ||
        !ui.inspectModal
      ) {
        return;
      }

      state.modalOpen =
        false;

      ui.inspectModal
        .classList
        .remove("open");

      ui.inspectModal
        .setAttribute(
          "aria-hidden",
          "true"
        );

      syncOverlay();

      state.lastFocusedElement
        ?.focus?.();
    }

    function searchAndTrack(
      query
    ) {
      const value =
        lower(query);

      if (!value) {
        showToast(
          "Enter a Service No. or requester name to track a request.",
          "warning"
        );

        ui.quickSearchInput
          ?.focus();

        return;
      }

      const found =
        state.records.find(
          (record) => {
            return (
              lower(
                record.serviceNo
              ).includes(value) ||
              lower(
                record.clientName
              ).includes(value)
            );
          }
        );

      if (!found) {
        showToast(
          `No service request matched "${text(
            query
          )}".`,
          "warning"
        );

        return;
      }

      openInspectModal(
        found
      );
    }

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
                .contains("open")
            );
          }
        );

      ui.overlay
        ?.addEventListener(
          "click",
          () => {
            if (
              ui.sidebar
                ?.classList
                .contains("open")
            ) {
              setSidebarOpen(
                false
              );
            }
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
                mobileQuery.matches
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

      document.addEventListener(
        "click",
        (event) => {
          if (
            ui.profileMenu
              ?.classList
              .contains("open") &&
            !ui.profileMenu.contains(
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

      ui.refreshBtn
        ?.addEventListener(
          "click",
          () => {
            loadServiceRecords({
              notify: true
            });
          }
        );

      ui.btnTrack
        ?.addEventListener(
          "click",
          () => {
            searchAndTrack(
              ui.quickSearchInput
                ?.value
            );
          }
        );

      ui.quickSearchInput
        ?.addEventListener(
          "keydown",
          (event) => {
            if (
              event.key === "Enter"
            ) {
              event.preventDefault();

              searchAndTrack(
                ui.quickSearchInput
                  ?.value
              );
            }
          }
        );

      ui.tableSearchInput
        ?.addEventListener(
          "input",
          renderTable
        );

      ui.filterStatusSelect
        ?.addEventListener(
          "change",
          renderTable
        );

      ui.tableBody
        ?.addEventListener(
          "click",
          (event) => {
            const button =
              event.target.closest(
                "[data-record-id]"
              );

            if (!button) return;

            const record =
              state.records.find(
                (item) =>
                  String(
                    item.id
                  ) ===
                  String(
                    button.dataset
                      .recordId
                  )
              );

            if (record) {
              openInspectModal(
                record
              );
            }
          }
        );

      ui.dismissModalIcon
        ?.addEventListener(
          "click",
          closeInspectModal
        );

      ui.closeInspectModalBottom
        ?.addEventListener(
          "click",
          closeInspectModal
        );

      ui.inspectModal
        ?.addEventListener(
          "click",
          (event) => {
            if (
              event.target ===
              ui.inspectModal
            ) {
              closeInspectModal();
            }
          }
        );

      ui.printRecordBtn
        ?.addEventListener(
          "click",
          () => {
            window.print();
          }
        );

      ui.tabButtons.forEach(
        (button) => {
          button.addEventListener(
            "click",
            () => {
              switchTab(
                Number(
                  button.dataset.tab
                )
              );
            }
          );
        }
      );

      document
        .getElementById(
          "arrowNextTo2"
        )
        ?.addEventListener(
          "click",
          () => switchTab(2)
        );

      document
        .getElementById(
          "arrowBackTo1"
        )
        ?.addEventListener(
          "click",
          () => switchTab(1)
        );

      document
        .getElementById(
          "arrowNextTo3"
        )
        ?.addEventListener(
          "click",
          () => switchTab(3)
        );

      document
        .getElementById(
          "arrowBackTo2"
        )
        ?.addEventListener(
          "click",
          () => switchTab(2)
        );

      document.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key !== "Escape"
          ) {
            return;
          }

          if (
            state.modalOpen
          ) {
            closeInspectModal();
            return;
          }

          if (
            ui.profileMenu
              ?.classList
              .contains("open")
          ) {
            closeProfile();

            ui.profileBtn
              ?.focus();

            return;
          }

          if (
            ui.sidebar
              ?.classList
              .contains("open")
          ) {
            setSidebarOpen(false);

            ui.hamburger
              ?.focus();
          }
        }
      );

      const onBreakpointChange =
        () => {
          closeProfile();
          setSidebarOpen(false);
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
            ) ||
            "{}"
          );

        populateProfile(
          cached
        );

      } catch {
        populateProfile();
      }

      const allowed =
        await verifySession();

      if (
        !allowed &&
        ui.body.dataset
          .requiresAuth
      ) {
        return;
      }

      await loadServiceRecords();

      subscribeRealtime();
    }

    start();
  }
})();