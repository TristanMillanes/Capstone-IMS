document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();

  const $ = (id) => document.getElementById(id);

  const els = {
    sidebar: $("sidebar"),
    overlay: $("overlay"),
    mobileMenuBtn: $("mobileMenuBtn"),
    sidebarCollapseBtn: $("sidebarCollapseBtn"),
    globalSearchInput: $("globalSearchInput"),
    profileMenu: $("profileMenu"),
    profileBtn: $("profileBtn"),
    logoutBtn: $("logoutBtn"),
    todayDateStr: $("todayDateStr"),

    visitorSearch: $("visitorSearch"),
    purposeFilter: $("purposeFilter"),
    statusFilter: $("statusFilter"),
    visitorTableBody: $("visitorTableBody"),
    emptyState: $("emptyState"),

    summaryTotal: $("summaryTotal"),
    summaryToday: $("summaryToday"),
    summaryInside: $("summaryInside"),
    summaryCompletedToday: $("summaryCompletedToday"),

    resetFiltersBtn: $("resetFiltersBtn"),

    detailDrawer: $("detailDrawer"),
    closeDrawerBtn: $("closeDrawerBtn"),

    toggleCheckoutBtn: $("toggleCheckoutBtn"),
    printPassBtn: $("printPassBtn"),
    editVisitorBtn: $("editVisitorBtn"),
    deleteVisitorBtn: $("deleteVisitorBtn"),

    prevPageBtn: $("prevPageBtn"),
    nextPageBtn: $("nextPageBtn"),
    pageIndicator: $("pageIndicator"),
    showingCountText: $("showingCountText"),

    exportCsvBtn: $("exportCsvBtn"),
    refreshBtn: $("refreshBtn"),
    addVisitorBtn: $("addVisitorBtn"),

    visitorModal: $("visitorModal"),
    visitorModalTitle: $("visitorModalTitle"),
    closeVisitorModalBtn: $("closeVisitorModalBtn"),
    cancelVisitorModalBtn: $("cancelVisitorModalBtn"),

    visitorAdminForm: $("visitorAdminForm"),
    visitorId: $("visitorId"),

    fullName: $("fullName"),
    contact: $("contact"),
    address: $("address"),
    personToVisit: $("personToVisit"),
    purposeCategory: $("purposeCategory"),
    otherPurposeSpecific: $("otherPurposeSpecific"),

    adminToast: $("adminToast")
  };

  /* =========================================================
     SUPABASE
     ========================================================= */

  const supabaseDB = window.PGENRO_DB?.client || null;
  const VISITORS_TABLE = window.PGENRO_DB?.table || "visitors";

  let visitors = [];
  let selectedVisitor = null;

  let activeDateFilter = "all";
  let currentPage = 1;

  const rowsPerPage = 10;

  const dbAvailable = () => !!supabaseDB;

  /* =========================================================
     HELPERS
     ========================================================= */

  const dateString = (date = new Date()) =>
    date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric"
    });

  const timeString = (date = new Date()) =>
    date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

  const escapeHTML = (value) =>
    String(value ?? "").replace(
      /[&<>'"]/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;"
        })[c]
    );

  /* =========================================================
     TOAST
     ========================================================= */

  function toast(message) {
    if (!els.adminToast) return;

    els.adminToast.textContent = message;
    els.adminToast.classList.add("show");

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
      els.adminToast.classList.remove("show");
    }, 2600);
  }

  /* =========================================================
     DATE DISPLAY
     ========================================================= */

  function updateClock() {
    const now = new Date();

    if (els.todayDateStr) {
      els.todayDateStr.textContent = now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    }
  }

  updateClock();

  setInterval(updateClock, 1000);

  /* =========================================================
     NORMALIZE SUPABASE VISITOR DATA
     ========================================================= */

  function normalizeVisitor(row) {
    const timeIn =
      row.time_in ||
      row.timeIn ||
      row.created_at ||
      null;

    const timeOut =
      row.time_out ||
      row.timeOut ||
      null;

    const dateSource =
      row.visit_date ||
      (timeIn ? new Date(timeIn) : null);

    return {
      _id: row.id || row._id,

      fullName:
        row.full_name ??
        row.fullName ??
        "",

      contact:
        row.contact ??
        "",

      address:
        row.address ??
        "",

      personToVisit:
        row.person_to_visit ??
        row.personToVisit ??
        "",

      purposeCategory:
        row.purpose_category ??
        row.purposeCategory ??
        "",

      otherPurposeSpecific:
        row.other_purpose_specific ??
        row.otherPurposeSpecific ??
        "",

      date: row.visit_date
        ? new Date(
            `${row.visit_date}T00:00:00`
          ).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
          })
        : (
            dateSource instanceof Date &&
            !Number.isNaN(dateSource.getTime())
          )
          ? dateString(dateSource)
          : "",

      time: timeIn
        ? new Date(timeIn).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })
        : "",

      timestamp:
        timeIn
          ? new Date(timeIn).getTime()
          : 0,

      status:
        row.status ||
        (timeOut ? "completed" : "inside"),

      timeOut: timeOut
        ? new Date(timeOut).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })
        : null,

      timeInISO: timeIn,
      timeOutISO: timeOut,

      createdAt:
        row.created_at ||
        null,

      updatedAt:
        row.updated_at ||
        null
    };
  }

  /* =========================================================
     LOAD VISITORS
     ========================================================= */

  async function loadVisitors({ silent = false } = {}) {
    const table = document.querySelector(".visitor-table");

    if (!silent) {
      els.refreshBtn?.classList.add("is-syncing");
      table?.classList.add("is-loading");
      els.refreshBtn?.setAttribute("disabled", "true");
    }

    if (!dbAvailable()) {
      visitors = [];

      render();

      if (!silent) {
        toast(
          "Supabase is not configured. Update shared/supabase.js first."
        );
      }

      els.refreshBtn?.classList.remove("is-syncing");
      table?.classList.remove("is-loading");
      els.refreshBtn?.removeAttribute("disabled");

      return;
    }

    try {
      const { data, error } = await supabaseDB
        .from(VISITORS_TABLE)
        .select("*")
        .order("created_at", {
          ascending: false
        });

      if (error) throw error;

      visitors = (data || []).map(normalizeVisitor);

      render();

      if (!silent) {
        toast("Visitor records synchronized.");
      }
    } catch (err) {
      console.error(
        "Visitor sync failed:",
        err
      );

      visitors = [];

      render();

      const authHint =
        err?.code === "42501"
          ? " Admin access requires a signed-in Supabase user."
          : "";

      toast(
        `Unable to load visitor records.${authHint}`
      );
    } finally {
      if (!silent) {
        window.setTimeout(() => {
          els.refreshBtn?.classList.remove(
            "is-syncing"
          );

          table?.classList.remove(
            "is-loading"
          );

          els.refreshBtn?.removeAttribute(
            "disabled"
          );
        }, 280);
      }
    }
  }

  /* =========================================================
     SUPABASE REALTIME
     ========================================================= */

  function listenVisitors() {
    loadVisitors({
      silent: true
    });

    if (!dbAvailable()) return;

    supabaseDB
      .channel("pgenro-visitors-admin")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: VISITORS_TABLE
        },
        () => {
          loadVisitors({
            silent: true
          });
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn(
            "Supabase realtime channel could not connect."
          );
        }
      });
  }

  /* =========================================================
     VISITOR HELPERS
     ========================================================= */

  function getInitials(name) {
    return (
      (name || "Guest")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(
          (p) =>
            p[0]?.toUpperCase()
        )
        .join("") || "??"
    );
  }

  function getPurposeTagClass(purpose = "") {
    if (purpose.includes("Speaker")) {
      return "tag-purple";
    }

    if (purpose.includes("Water Quality")) {
      return "tag-blue";
    }

    if (purpose.includes("Technical")) {
      return "tag-orange";
    }

    if (
      purpose.includes("Information") ||
      purpose.includes("I.E.C")
    ) {
      return "tag-green";
    }

    return "tag-gray";
  }

  /* =========================================================
     FILTER VISITORS
     ========================================================= */

  function getFilteredVisitors() {
    const search =
      (
        els.visitorSearch?.value ||
        ""
      )
        .trim()
        .toLowerCase();

    const purpose =
      els.purposeFilter?.value ||
      "all";

    const status =
      els.statusFilter?.value ||
      "all";

    const today = dateString();

    const weekAgo = new Date();

    weekAgo.setDate(
      weekAgo.getDate() - 7
    );

    weekAgo.setHours(
      0,
      0,
      0,
      0
    );

    return visitors
      .filter((v) => {
        const haystack = [
          v.fullName,
          v.contact,
          v.address,
          v.personToVisit,
          v.purposeCategory,
          v.otherPurposeSpecific
        ]
          .join(" ")
          .toLowerCase();

        const searchMatch =
          !search ||
          haystack.includes(search);

        const purposeMatch =
          purpose === "all" ||
          v.purposeCategory === purpose;

        const currentStatus =
          v.status ||
          "inside";

        const statusMatch =
          status === "all" ||
          currentStatus === status;

        let dateMatch = true;

        if (
          activeDateFilter === "today"
        ) {
          dateMatch =
            v.date === today;
        }

        if (
          activeDateFilter === "week"
        ) {
          const parsed =
            new Date(
              v.timestamp ||
              v.date
            );

          dateMatch =
            !Number.isNaN(
              parsed.getTime()
            ) &&
            parsed >= weekAgo;
        }

        return (
          searchMatch &&
          purposeMatch &&
          statusMatch &&
          dateMatch
        );
      })
      .sort(
        (a, b) =>
          (b.timestamp || 0) -
          (a.timestamp || 0)
      );
  }

  /* =========================================================
     KPI ANIMATION
     ========================================================= */

  function animateMetric(
    el,
    value
  ) {
    if (!el) return;

    const nextValue =
      String(value);

    const changed =
      el.textContent !==
      nextValue;

    el.textContent =
      nextValue;

    if (changed) {
      el.classList.remove(
        "metric-pop"
      );

      void el.offsetWidth;

      el.classList.add(
        "metric-pop"
      );
    }
  }

  /* =========================================================
     UPDATE DASHBOARD METRICS
     ========================================================= */

  function updateMetrics() {
    const today =
      dateString();

    const todayVisitors =
      visitors.filter(
        (v) =>
          v.date === today
      );

    animateMetric(
      els.summaryTotal,
      visitors.length
    );

    animateMetric(
      els.summaryToday,
      todayVisitors.length
    );

    animateMetric(
      els.summaryInside,
      visitors.filter(
        (v) =>
          (
            v.status ||
            "inside"
          ) === "inside"
      ).length
    );

    animateMetric(
      els.summaryCompletedToday,
      todayVisitors.filter(
        (v) =>
          (
            v.status ||
            "inside"
          ) === "completed"
      ).length
    );
  }

  /* =========================================================
     RENDER VISITOR TABLE
     ========================================================= */

  function renderTable(list) {
    if (!els.visitorTableBody) {
      return;
    }

    els.visitorTableBody.innerHTML =
      "";

    const total =
      list.length;

    const pages =
      Math.max(
        1,
        Math.ceil(
          total /
          rowsPerPage
        )
      );

    currentPage =
      Math.min(
        Math.max(
          1,
          currentPage
        ),
        pages
      );

    const start =
      (
        currentPage -
        1
      ) *
      rowsPerPage;

    const pageRows =
      list.slice(
        start,
        start +
        rowsPerPage
      );

    if (
      els.showingCountText
    ) {
      els.showingCountText.textContent =
        total
          ? `Showing ${start + 1} - ${Math.min(
              start +
              rowsPerPage,
              total
            )} of ${total} visitors`
          : "No records found";
    }

    if (
      els.pageIndicator
    ) {
      els.pageIndicator.textContent =
        `${currentPage} / ${pages}`;
    }

    if (
      els.prevPageBtn
    ) {
      els.prevPageBtn.disabled =
        currentPage <= 1;
    }

    if (
      els.nextPageBtn
    ) {
      els.nextPageBtn.disabled =
        currentPage >= pages;
    }

    if (
      !pageRows.length
    ) {
      els.emptyState?.classList.remove(
        "hidden"
      );

      return;
    }

    els.emptyState?.classList.add(
      "hidden"
    );

    pageRows.forEach(
      (v, index) => {
        const isInside =
          (
            v.status ||
            "inside"
          ) === "inside";

        const tr =
          document.createElement(
            "tr"
          );

        tr.style.setProperty(
          "--row-index",
          index
        );

        tr.dataset.visitorId =
          v._id || "";

        const code =
          v._id
            ? `VIS-${String(
                v._id
              )
                .replace(
                  /-/g,
                  ""
                )
                .slice(
                  0,
                  6
                )
                .toUpperCase()}`
            : "VISITOR";

        tr.innerHTML = `
          <td>
            <div class="visitor-profile-cell">
              <div class="table-avatar">
                ${escapeHTML(
                  getInitials(
                    v.fullName
                  )
                )}
              </div>

              <div class="profile-meta">
                <strong
                  title="${escapeHTML(
                    v.fullName ||
                    "Anonymous Guest"
                  )}"
                >
                  ${escapeHTML(
                    v.fullName ||
                    "Anonymous Guest"
                  )}
                </strong>

                <span class="visitor-code">
                  ${escapeHTML(
                    code
                  )}
                </span>
              </div>
            </div>
          </td>

          <td>
            <span class="cell-main">
              ${escapeHTML(
                v.contact ||
                "No contact"
              )}
            </span>

            <span
              class="cell-subtext"
              title="${escapeHTML(
                v.address ||
                "Address unspecified"
              )}"
            >
              ${escapeHTML(
                v.address ||
                "Address unspecified"
              )}
            </span>
          </td>

          <td>
            <span class="dept-pill">
              <i data-lucide="building-2"></i>

              <span>
                ${escapeHTML(
                  v.personToVisit ||
                  "General Personnel"
                )}
              </span>
            </span>
          </td>

          <td>
            <span
              class="tag-badge ${getPurposeTagClass(
                v.purposeCategory
              )}"
              title="${escapeHTML(
                v.purposeCategory ||
                "General Inquiry"
              )}"
            >
              ${escapeHTML(
                v.purposeCategory ||
                "General Inquiry"
              )}
            </span>
          </td>

          <td>
            <div class="checkin-cell">
              <strong>
                ${escapeHTML(
                  v.time ||
                  "--:--"
                )}
              </strong>

              <span>
                ${escapeHTML(
                  v.date ||
                  "Date unavailable"
                )}
              </span>
            </div>
          </td>

          <td>
            <span
              class="status-pill ${
                isInside
                  ? "status-inside"
                  : "status-completed"
              }"
            >
              ${
                isInside
                  ? "In Building"
                  : "Checked Out"
              }
            </span>
          </td>

          <td style="text-align:right">
            <button
              class="btn-view-row"
              type="button"
              title="View and manage visitor"
            >
              <i data-lucide="arrow-up-right"></i>
              <span>View</span>
            </button>
          </td>
        `;

        tr.addEventListener(
          "click",
          () => {
            openDrawer(v);
          }
        );

        tr
          .querySelector(
            ".btn-view-row"
          )
          ?.addEventListener(
            "click",
            (event) => {
              event.stopPropagation();

              openDrawer(v);
            }
          );

        els.visitorTableBody.appendChild(
          tr
        );
      }
    );

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  /* =========================================================
     RENDER
     ========================================================= */

  function render() {
    updateMetrics();

    renderTable(
      getFilteredVisitors()
    );
  }

  /* =========================================================
     OPEN VISITOR DRAWER
     ========================================================= */

  function openDrawer(v) {
    selectedVisitor = v;

    $("drawerName").textContent =
      v.fullName ||
      "Guest Details";

    $("drawerFullname").textContent =
      v.fullName ||
      "—";

    $("drawerAvatar").textContent =
      getInitials(
        v.fullName
      );

    $("drawerContact").textContent =
      v.contact ||
      "—";

    $("drawerAddress").textContent =
      v.address ||
      "—";

    $("drawerPerson").textContent =
      v.personToVisit ||
      "—";

    $("drawerPurpose").textContent =
      [
        v.purposeCategory,
        v.otherPurposeSpecific
      ]
        .filter(Boolean)
        .join(" — ") ||
      "—";

    $("drawerTimeIn").textContent =
      v.time ||
      "—";

    $("drawerDate").textContent =
      v.date ||
      "—";

    $("drawerTimeOut").textContent =
      v.timeOut ||
      "Still in Premises";

    const inside =
      (
        v.status ||
        "inside"
      ) === "inside";

    const badge =
      $("drawerStatusBadge");

    badge.textContent =
      inside
        ? "Currently Inside"
        : "Signed Out";

    badge.className =
      `badge ${
        inside
          ? "status-inside"
          : "status-completed"
      }`;

    els.toggleCheckoutBtn.innerHTML =
      inside
        ? `
          <i data-lucide="log-out"></i>
          Log Departure
        `
        : `
          <i data-lucide="rotate-ccw"></i>
          Re-open Visit
        `;

    els.toggleCheckoutBtn.className =
      inside
        ? "btn btn-success"
        : "btn btn-secondary";

    document
      .querySelectorAll(
        "#visitorTableBody tr"
      )
      .forEach((row) => {
        row.classList.toggle(
          "selected-row",
          row.dataset.visitorId ===
            String(
              v._id ||
              ""
            )
        );
      });

    els.detailDrawer?.classList.add(
      "open"
    );

    els.detailDrawer?.setAttribute(
      "aria-hidden",
      "false"
    );

    els.overlay?.classList.add(
      "active"
    );

    if (window.lucide) {
      lucide.createIcons();
    }
  }

  /* =========================================================
     CLOSE VISITOR DRAWER
     ========================================================= */

  function closeDrawer() {
    els.detailDrawer?.classList.remove(
      "open"
    );

    els.detailDrawer?.setAttribute(
      "aria-hidden",
      "true"
    );

    els.overlay?.classList.remove(
      "active"
    );

    document
      .querySelectorAll(
        "#visitorTableBody tr.selected-row"
      )
      .forEach((row) => {
        row.classList.remove(
          "selected-row"
        );
      });
  }

  /* =========================================================
     VISITOR MODAL
     ========================================================= */

  function openVisitorModal(
    mode,
    v = null
  ) {
    els.visitorAdminForm?.reset();

    if (
      mode === "edit" &&
      v
    ) {
      els.visitorModalTitle.textContent =
        "Edit Visitor Record";

      els.visitorId.value =
        v._id ||
        "";

      els.fullName.value =
        v.fullName ||
        "";

      els.contact.value =
        v.contact ||
        "";

      els.address.value =
        v.address ||
        "";

      els.personToVisit.value =
        v.personToVisit ||
        "";

      els.purposeCategory.value =
        v.purposeCategory ||
        "";

      els.otherPurposeSpecific.value =
        v.otherPurposeSpecific ||
        "";
    } else {
      els.visitorModalTitle.textContent =
        "Add Visitor";

      els.visitorId.value =
        "";
    }

    els.visitorModal?.classList.add(
      "open"
    );

    els.visitorModal?.setAttribute(
      "aria-hidden",
      "false"
    );

    setTimeout(
      () =>
        els.fullName?.focus(),
      50
    );
  }

  function closeVisitorModal() {
    els.visitorModal?.classList.remove(
      "open"
    );

    els.visitorModal?.setAttribute(
      "aria-hidden",
      "true"
    );
  }

  /* =========================================================
     SAVE VISITOR
     ========================================================= */

  async function saveVisitor(
    event
  ) {
    event.preventDefault();

    const fullName =
      els.fullName.value.trim();

    const contact =
      els.contact.value.trim();

    const address =
      els.address.value.trim();

    const personToVisit =
      els.personToVisit.value.trim();

    const purposeCategory =
      els.purposeCategory.value;

    if (
      !fullName ||
      !contact ||
      !address ||
      !personToVisit ||
      !purposeCategory
    ) {
      return toast(
        "Please complete all required visitor fields."
      );
    }

    const existingId =
      els.visitorId.value;

    const existing =
      visitors.find(
        (v) =>
          v._id ===
          existingId
      );

    const payload = {
      full_name: fullName,
      contact: contact,
      address: address,
      person_to_visit:
        personToVisit,
      purpose_category:
        purposeCategory,
      other_purpose_specific:
        els.otherPurposeSpecific.value.trim()
    };

    if (!dbAvailable()) {
      return toast(
        "Supabase is not configured. Update shared/supabase.js first."
      );
    }

    try {
      if (existingId) {
        const { error } =
          await supabaseDB
            .from(
              VISITORS_TABLE
            )
            .update(
              payload
            )
            .eq(
              "id",
              existingId
            );

        if (error) {
          throw error;
        }
      } else {
        const { error } =
          await supabaseDB
            .from(
              VISITORS_TABLE
            )
            .insert({
              ...payload,
              status: "inside"
            });

        if (error) {
          throw error;
        }
      }

      await loadVisitors({
        silent: true
      });

      closeVisitorModal();

      closeDrawer();

      toast(
        existing
          ? "Visitor record updated."
          : "Visitor added successfully."
      );
    } catch (err) {
      console.error(err);

      toast(
        "Unable to save visitor record. Check admin authentication and RLS policies."
      );
    }
  }

  /* =========================================================
     LOG DEPARTURE / REOPEN VISIT
     ========================================================= */

  async function toggleCheckout() {
    if (!selectedVisitor) {
      return;
    }

    const inside =
      (
        selectedVisitor.status ||
        "inside"
      ) === "inside";

    const patch = {
      status:
        inside
          ? "completed"
          : "inside",

      time_out:
        inside
          ? new Date().toISOString()
          : null
    };

    if (!dbAvailable()) {
      return toast(
        "Supabase is not configured. Update shared/supabase.js first."
      );
    }

    try {
      const { error } =
        await supabaseDB
          .from(
            VISITORS_TABLE
          )
          .update(
            patch
          )
          .eq(
            "id",
            selectedVisitor._id
          );

      if (error) {
        throw error;
      }

      await loadVisitors({
        silent: true
      });

      selectedVisitor =
        visitors.find(
          (v) =>
            v._id ===
            selectedVisitor._id
        ) ||
        null;

      if (selectedVisitor) {
        openDrawer(
          selectedVisitor
        );
      }

      toast(
        inside
          ? "Visitor departure recorded."
          : "Visitor visit re-opened."
      );
    } catch (err) {
      console.error(err);

      toast(
        "Unable to update visitor status. Check admin authentication."
      );
    }
  }

  /* =========================================================
     DELETE VISITOR
     ========================================================= */

  async function deleteVisitor() {
    if (!selectedVisitor) {
      return;
    }

    if (
      !confirm(
        `Delete the visitor record for ${
          selectedVisitor.fullName ||
          "this visitor"
        }? This cannot be undone.`
      )
    ) {
      return;
    }

    if (!dbAvailable()) {
      return toast(
        "Supabase is not configured. Update shared/supabase.js first."
      );
    }

    try {
      const { error } =
        await supabaseDB
          .from(
            VISITORS_TABLE
          )
          .delete()
          .eq(
            "id",
            selectedVisitor._id
          );

      if (error) {
        throw error;
      }

      closeDrawer();

      selectedVisitor =
        null;

      await loadVisitors({
        silent: true
      });

      toast(
        "Visitor record deleted."
      );
    } catch (err) {
      console.error(err);

      toast(
        "Unable to delete visitor record. Check admin authentication."
      );
    }
  }

  /* =========================================================
     PRINT VISITOR PASS
     ========================================================= */

  function printPass() {
    if (!selectedVisitor) {
      return;
    }

    const v =
      selectedVisitor;

    const w =
      window.open(
        "",
        "_blank",
        "width=620,height=650"
      );

    if (!w) {
      return toast(
        "Popup blocked. Allow popups to print the pass."
      );
    }

    w.document.write(`
      <html>
        <head>
          <title>
            Visitor Pass -
            ${escapeHTML(
              v.fullName
            )}
          </title>

          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 30px;
              text-align: center;
            }

            .pass {
              border: 2px dashed #047857;
              padding: 25px;
              border-radius: 14px;
            }

            .pass h2 {
              color: #047857;
            }

            .field {
              text-align: left;
              margin: 12px 0;
              padding-bottom: 7px;
              border-bottom: 1px solid #eee;
            }

            .field small {
              display: block;
              color: #64748b;
              text-transform: uppercase;
              font-weight: bold;
            }

            .field strong {
              font-size: 16px;
            }
          </style>
        </head>

        <body>
          <div class="pass">
            <h2>
              PGENRO VISITOR PASS
            </h2>

            <p>
              Provincial Environment and Natural Resources Office
            </p>

            <div class="field">
              <small>
                Visitor Name
              </small>

              <strong>
                ${escapeHTML(
                  v.fullName
                )}
              </strong>
            </div>

            <div class="field">
              <small>
                Host / Department
              </small>

              <strong>
                ${escapeHTML(
                  v.personToVisit
                )}
              </strong>
            </div>

            <div class="field">
              <small>
                Purpose
              </small>

              <strong>
                ${escapeHTML(
                  v.purposeCategory
                )}
              </strong>
            </div>

            <div class="field">
              <small>
                Date / Time In
              </small>

              <strong>
                ${escapeHTML(
                  v.date
                )}
                @
                ${escapeHTML(
                  v.time
                )}
              </strong>
            </div>
          </div>
        </body>
      </html>
    `);

    w.document.close();
    w.focus();
    w.print();
  }

  /* =========================================================
     EXPORT CSV
     ========================================================= */

  function exportCsv() {
    const list =
      getFilteredVisitors();

    if (!list.length) {
      return toast(
        "No visitor records to export."
      );
    }

    const safe = (v) =>
      `"${String(
        v ?? ""
      ).replace(
        /"/g,
        '""'
      )}"`;

    const headers = [
      "Full Name",
      "Contact",
      "Address",
      "Host / Department",
      "Purpose",
      "Specific Purpose",
      "Date",
      "Time In",
      "Time Out",
      "Status"
    ];

    const rows =
      list.map((v) =>
        [
          v.fullName,
          v.contact,
          v.address,
          v.personToVisit,
          v.purposeCategory,
          v.otherPurposeSpecific,
          v.date,
          v.time,
          v.timeOut,
          v.status ||
            "inside"
        ]
          .map(safe)
          .join(",")
      );

    const blob =
      new Blob(
        [
          [
            headers
              .map(safe)
              .join(","),
            ...rows
          ].join("\n")
        ],
        {
          type:
            "text/csv;charset=utf-8"
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const a =
      document.createElement(
        "a"
      );

    a.href =
      url;

    a.download =
      `PGENRO_Visitors_${new Date()
        .toISOString()
        .slice(
          0,
          10
        )}.csv`;

    document.body.appendChild(
      a
    );

    a.click();

    a.remove();

    URL.revokeObjectURL(
      url
    );
  }

  /* =========================================================
     LEFT SIDEBAR / MOBILE NAVIGATION
     Same structure/behavior as admin.html
     ========================================================= */

  els.mobileMenuBtn?.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();

      els.sidebar?.classList.toggle(
        "mobile-open"
      );

      els.overlay?.classList.toggle(
        "active",
        els.sidebar?.classList.contains(
          "mobile-open"
        )
      );
    }
  );

  /* =========================================================
     COLLAPSE SIDEBAR
     ========================================================= */

  els.sidebarCollapseBtn?.addEventListener(
    "click",
    () => {
      document.body.classList.toggle(
        "sidebar-collapsed"
      );

      localStorage.setItem(
        "pgenro_admin_sidebar_collapsed",
        document.body.classList.contains(
          "sidebar-collapsed"
        )
          ? "1"
          : "0"
      );
    }
  );

  /*
   * Restore saved sidebar state.
   */

  if (
    localStorage.getItem(
      "pgenro_admin_sidebar_collapsed"
    ) === "1" &&
    window.innerWidth > 900
  ) {
    document.body.classList.add(
      "sidebar-collapsed"
    );
  }

  /* =========================================================
     PROFILE DROPDOWN
     ========================================================= */

  els.profileBtn?.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();

      els.profileMenu?.classList.toggle(
        "open"
      );
    }
  );

  document.addEventListener(
    "click",
    (event) => {
      if (
        els.profileMenu &&
        !els.profileMenu.contains(
          event.target
        )
      ) {
        els.profileMenu.classList.remove(
          "open"
        );
      }
    }
  );

  /* =========================================================
     TOPBAR GLOBAL SEARCH
     ========================================================= */

  els.globalSearchInput?.addEventListener(
    "input",
    () => {
      if (
        els.visitorSearch
      ) {
        els.visitorSearch.value =
          els.globalSearchInput.value;

        currentPage =
          1;

        render();
      }
    }
  );

  /* =========================================================
     CTRL + K SEARCH SHORTCUT
     ========================================================= */

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        (
          event.ctrlKey ||
          event.metaKey
        ) &&
        event.key.toLowerCase() ===
          "k"
      ) {
        event.preventDefault();

        els.globalSearchInput?.focus();
      }
    }
  );

  /* =========================================================
     LOGOUT
     ========================================================= */

  els.logoutBtn?.addEventListener(
    "click",
    async () => {
      if (
        !confirm(
          "Are you sure you want to sign out of PGENRO IMS?"
        )
      ) {
        return;
      }

      try {
        if (
          window.PGENRO_DB
            ?.client
            ?.auth
        ) {
          await window.PGENRO_DB.client.auth.signOut();
        }
      } catch (error) {
        console.warn(
          "Supabase sign out warning:",
          error
        );
      }

      sessionStorage.removeItem(
        "pgenro_session_token"
      );

      sessionStorage.removeItem(
        "pgenro_session_active"
      );

      window.location.href =
        "../User/login.html";
    }
  );

  /* =========================================================
     OVERLAY
     ========================================================= */

  els.overlay?.addEventListener(
    "click",
    () => {
      els.sidebar?.classList.remove(
        "mobile-open"
      );

      closeDrawer();

      els.overlay?.classList.remove(
        "active"
      );
    }
  );

  /* =========================================================
     VISITOR ACTION EVENTS
     ========================================================= */

  els.closeDrawerBtn?.addEventListener(
    "click",
    closeDrawer
  );

  els.addVisitorBtn?.addEventListener(
    "click",
    () =>
      openVisitorModal(
        "add"
      )
  );

  els.editVisitorBtn?.addEventListener(
    "click",
    () =>
      selectedVisitor &&
      openVisitorModal(
        "edit",
        selectedVisitor
      )
  );

  els.deleteVisitorBtn?.addEventListener(
    "click",
    deleteVisitor
  );

  els.toggleCheckoutBtn?.addEventListener(
    "click",
    toggleCheckout
  );

  els.printPassBtn?.addEventListener(
    "click",
    printPass
  );

  els.exportCsvBtn?.addEventListener(
    "click",
    exportCsv
  );

  els.refreshBtn?.addEventListener(
    "click",
    loadVisitors
  );

  /* =========================================================
     MODAL EVENTS
     ========================================================= */

  els.closeVisitorModalBtn?.addEventListener(
    "click",
    closeVisitorModal
  );

  els.cancelVisitorModalBtn?.addEventListener(
    "click",
    closeVisitorModal
  );

  els.visitorModal?.addEventListener(
    "click",
    (e) => {
      if (
        e.target ===
        els.visitorModal
      ) {
        closeVisitorModal();
      }
    }
  );

  els.visitorAdminForm?.addEventListener(
    "submit",
    saveVisitor
  );

  /* =========================================================
     PAGINATION
     ========================================================= */

  els.prevPageBtn?.addEventListener(
    "click",
    () => {
      if (
        currentPage > 1
      ) {
        currentPage--;

        render();
      }
    }
  );

  els.nextPageBtn?.addEventListener(
    "click",
    () => {
      currentPage++;

      render();
    }
  );

  /* =========================================================
     SEARCH
     ========================================================= */

  [
    els.visitorSearch
  ].forEach((el) =>
    el?.addEventListener(
      "input",
      () => {
        currentPage =
          1;

        render();
      }
    )
  );

  /* =========================================================
     SELECT FILTERS
     ========================================================= */

  [
    els.purposeFilter,
    els.statusFilter
  ].forEach((el) =>
    el?.addEventListener(
      "change",
      () => {
        currentPage =
          1;

        render();
      }
    )
  );

  /* =========================================================
     DATE FILTER CHIPS
     ========================================================= */

  document
    .querySelectorAll(
      ".date-chip"
    )
    .forEach(
      (chip) =>
        chip.addEventListener(
          "click",
          () => {
            document
              .querySelectorAll(
                ".date-chip"
              )
              .forEach(
                (c) =>
                  c.classList.remove(
                    "active"
                  )
              );

            chip.classList.add(
              "active"
            );

            activeDateFilter =
              chip.dataset.range;

            currentPage =
              1;

            render();
          }
        )
    );

  /* =========================================================
     RESET FILTERS
     ========================================================= */

  els.resetFiltersBtn?.addEventListener(
    "click",
    () => {
      if (
        els.visitorSearch
      ) {
        els.visitorSearch.value =
          "";
      }

      if (
        els.globalSearchInput
      ) {
        els.globalSearchInput.value =
          "";
      }

      if (
        els.purposeFilter
      ) {
        els.purposeFilter.value =
          "all";
      }

      if (
        els.statusFilter
      ) {
        els.statusFilter.value =
          "all";
      }

      activeDateFilter =
        "all";

      currentPage =
        1;

      document
        .querySelectorAll(
          ".date-chip"
        )
        .forEach(
          (chip) =>
            chip.classList.toggle(
              "active",
              chip.dataset.range ===
                "all"
            )
        );

      render();

      toast(
        "Visitor filters reset."
      );
    }
  );

  /* =========================================================
     ESCAPE KEY
     ========================================================= */

  document.addEventListener(
    "keydown",
    (e) => {
      if (
        e.key ===
        "Escape"
      ) {
        closeDrawer();

        closeVisitorModal();

        els.sidebar?.classList.remove(
          "mobile-open"
        );

        els.profileMenu?.classList.remove(
          "open"
        );
      }
    }
  );

  /* =========================================================
     BOOT ADMIN VISITORS
     ========================================================= */

  async function bootVisitorsAdmin() {
    if (!supabaseDB) {
      toast(
        "Supabase is not configured. Update shared/supabase.js first."
      );

      return;
    }

    try {
      /*
       * Verify Supabase session.
       */
      const session =
        await window.PGENRO_DB.getSession();

      if (!session) {
        toast(
          "Please sign in with an administrator account."
        );

        setTimeout(
          () => {
            window.location.href =
              "../User/login.html";
          },
          900
        );

        return;
      }

      /* =====================================================
         ADMIN PROFILE
         ===================================================== */

      const user =
        session.user ||
        {};

      const displayName =
        user.user_metadata
          ?.full_name ||
        user.user_metadata
          ?.name ||
        user.email
          ?.split("@")[0] ||
        "PGENRO Admin";

      const profileName =
        $("currentUserName");

      const profileRole =
        $("currentUserRole");

      const dropdownName =
        $("dropdownUserName");

      const dropdownEmail =
        $("dropdownUserEmail");

      if (
        profileName
      ) {
        profileName.textContent =
          displayName;
      }

      if (
        profileRole
      ) {
        profileRole.textContent =
          "System Administrator";
      }

      if (
        dropdownName
      ) {
        dropdownName.textContent =
          displayName;
      }

      if (
        dropdownEmail
      ) {
        dropdownEmail.textContent =
          user.email ||
          "Administrator Session";
      }

      /* =====================================================
         DATABASE STATUS
         ===================================================== */

      const dbDot =
        $("dbStatusDot");

      const dbText =
        $("dbStatusText");

      if (
        dbDot
      ) {
        dbDot.className =
          "status-dot online";
      }

      if (
        dbText
      ) {
        dbText.textContent =
          "Supabase Live";
      }

      /* =====================================================
         VERIFY ADMIN ROLE
         ===================================================== */

      const role =
        await window.PGENRO_DB.getCurrentRole();

      const normalizedRole = String(role || "").trim().toLowerCase();

      if (
        !normalizedRole.includes("admin")
      ) {
        toast(
          "Administrator access is required for this page."
        );

        setTimeout(
          () => {
            window.location.href =
              "../User/homepage.html";
          },
          1100
        );

        return;
      }

      /* =====================================================
         START VISITOR SYSTEM
         ===================================================== */

      listenVisitors();
    } catch (error) {
      console.error(
        "Admin authentication check failed:",
        error
      );

      toast(
        "Unable to verify administrator access."
      );
    }
  }

  /* =========================================================
     START
     ========================================================= */

  bootVisitorsAdmin();
});