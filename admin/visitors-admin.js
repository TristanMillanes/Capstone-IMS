/* ============================================================================
   PGENRO IMS — VISITORS ADMIN CONTROLLER
   Full Realtime Synchronization, Supabase Integration & Direct Admin Parity
   ============================================================================ */

(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    if (window.lucide) {
      window.lucide.createIcons();
    }

    const $ = (id) => document.getElementById(id);
    const body = document.body;
    const VISITORS_TABLE = "visitors";
    const rowsPerPage = 10;

    // Route storage through the shared Supabase client
    const supabaseClient = window.pgenroSupabase || window.PGENRO_DB?.client || null;

    const els = {
      sidebar: $("sidebar"),
      overlay: $("overlay"),
      mobileMenuBtn: $("mobileMenuBtn"),
      sidebarCollapseBtn: $("sidebarCollapseBtn"),
      globalSearchInput: $("globalSearchInput"),
      profileMenu: $("profileMenu"),
      profileBtn: $("profileBtn"),
      profileDropdown: $("profileDropdown"),
      notificationsBtn: $("notificationsBtn"),
      notificationDropdown: $("notificationDropdown"),
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
      visitorModalBackdrop: $("visitorModalBackdrop"),
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
      visitorNotesCount: $("visitorNotesCount"),
      saveVisitorSubmitBtn: $("saveVisitorSubmitBtn"),
      saveVisitorSubmitText: $("saveVisitorSubmitText"),
      adminToast: $("adminToast"),
      dbStatusDot: $("dbStatusDot"),
      dbStatusText: $("dbStatusText"),
      notificationList: $("notificationList"),
      notifBadgeCount: $("notifBadgeCount"),
      notifPing: $("notifPing"),
      visitorLiveText: $("visitorLiveText"),
      registryResultCount: $("registryResultCount"),
      filterStateText: $("filterStateText")
    };

    let visitors = [];
    let selectedVisitor = null;
    let activeDateFilter = "all";
    let currentPage = 1;
    let syncTimer = null;
    let syncInFlight = false;
    let toastTimer = null;

    const escapeHTML = (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[c]));

    const getLocalDateKey = (date = new Date()) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    const parseDateKey = (value) => {
      if (!value) return null;
      const normalized = String(value).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
      const [y, m, d] = normalized.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      return Number.isNaN(date.getTime()) ? null : date;
    };

    const dateString = (date = new Date()) => date.toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric"
    });

    const timeString = (date = new Date()) => date.toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit"
    });

    function toast(message) {
      if (!els.adminToast) return;
      els.adminToast.textContent = message;
      els.adminToast.classList.add("show");
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        els.adminToast?.classList.remove("show");
      }, 3000);
    }

    function setDatabaseStatus(online, text) {
      if (els.dbStatusDot) els.dbStatusDot.className = `status-dot ${online ? "online" : "offline"}`;
      if (els.dbStatusText) els.dbStatusText.textContent = text;
      if (els.visitorLiveText) els.visitorLiveText.textContent = text;
    }

    function logSystemAudit(action, details) {
      if (window.PGENRO_AUDIT?.log) {
        window.PGENRO_AUDIT.log(action, details, { module: "Visitor Management" });
      }
    }

    function normalizeStatus(status, timeOut) {
      const value = String(status || "").trim().toLowerCase();
      if (["completed", "checked_out", "checked-out", "signed out", "departed", "closed"].includes(value)) return "completed";
      if (!value && timeOut) return "completed";
      return "inside";
    }

    function normalizeVisitor(row) {
      const timeInISO = row.time_in || row.timeIn || row.created_at || null;
      const timeOutISO = row.time_out || row.timeOut || null;
      const parsedTimeIn = timeInISO ? new Date(timeInISO) : null;
      const fallbackDateKey = parsedTimeIn && !Number.isNaN(parsedTimeIn.getTime()) ? getLocalDateKey(parsedTimeIn) : "";
      const dateKey = row.visit_date ? String(row.visit_date).slice(0, 10) : fallbackDateKey;

      return {
        _id: row.id ?? row._id ?? "",
        fullName: row.full_name ?? row.fullName ?? "",
        contact: row.contact ?? "",
        address: row.address ?? "",
        personToVisit: row.person_to_visit ?? row.personToVisit ?? "",
        purposeCategory: row.purpose_category ?? row.purposeCategory ?? "",
        otherPurposeSpecific: row.other_purpose_specific ?? row.otherPurposeSpecific ?? "",
        dateKey,
        date: dateKey ? dateString(parseDateKey(dateKey) || new Date()) : "Today",
        time: timeInISO ? timeString(new Date(timeInISO)) : "",
        timestamp: timeInISO ? new Date(timeInISO).getTime() || 0 : 0,
        status: normalizeStatus(row.status, timeOutISO),
        timeOut: timeOutISO ? timeString(new Date(timeOutISO)) : null,
        timeInISO,
        timeOutISO
      };
    }

    function isInside(visitor) {
      return (visitor?.status || "inside") === "inside";
    }

    function getInitials(name) {
      const parts = String(name || "Guest").trim().split(/\s+/).filter(Boolean).slice(0, 2);
      return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "JD";
    }

    function isWithinCurrentWeek(dateKey) {
      const date = parseDateKey(dateKey);
      if (!date) return false;
      const now = new Date();
      const firstDayOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      firstDayOfWeek.setHours(0, 0, 0, 0);
      return date >= firstDayOfWeek;
    }

    function getFilteredVisitors() {
      const search = String(els.visitorSearch?.value || "").trim().toLowerCase();
      const purpose = els.purposeFilter?.value || "all";
      const status = els.statusFilter?.value || "all";
      const todayKey = getLocalDateKey();

      return visitors.filter((visitor) => {
        const haystack = [
          visitor.fullName,
          visitor.contact,
          visitor.address,
          visitor.personToVisit,
          visitor.purposeCategory,
          visitor.otherPurposeSpecific
        ].join(" ").toLowerCase();

        if (search && !haystack.includes(search)) return false;
        if (purpose !== "all" && visitor.purposeCategory !== purpose) return false;
        if (status !== "all" && visitor.status !== status) return false;

        if (activeDateFilter === "today" && visitor.dateKey !== todayKey) return false;
        if (activeDateFilter === "week" && !isWithinCurrentWeek(visitor.dateKey)) return false;

        return true;
      }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    function updateMetrics() {
      const todayKey = getLocalDateKey();
      const todayVisitors = visitors.filter((v) => v.dateKey === todayKey);

      if (els.summaryTotal) els.summaryTotal.textContent = visitors.length;
      if (els.summaryToday) els.summaryToday.textContent = todayVisitors.length;
      if (els.summaryInside) els.summaryInside.textContent = visitors.filter(isInside).length;
      if (els.summaryCompletedToday) els.summaryCompletedToday.textContent = todayVisitors.filter((v) => !isInside(v)).length;
      if (els.todayDateStr) els.todayDateStr.textContent = dateString();
    }

    function updateFilterMeta(total) {
      if (els.registryResultCount) {
        els.registryResultCount.textContent = `${total} ${total === 1 ? "record" : "records"}`;
      }

      const activeParts = [];
      const search = String(els.visitorSearch?.value || "").trim();
      if (search) activeParts.push("Search");
      if ((els.purposeFilter?.value || "all") !== "all") activeParts.push("Purpose");
      if ((els.statusFilter?.value || "all") !== "all") activeParts.push("Status");
      if (activeDateFilter !== "all") activeParts.push(activeDateFilter === "today" ? "Today" : "This week");

      if (els.filterStateText) {
        els.filterStateText.innerHTML = `<i data-lucide="list-filter"></i> ${activeParts.length ? `${activeParts.length} active filter${activeParts.length > 1 ? "s" : ""}` : "All records"}`;
      }
      if (els.resetFiltersBtn) els.resetFiltersBtn.disabled = activeParts.length === 0;
    }

    function renderTable(list) {
      if (!els.visitorTableBody) return;
      els.visitorTableBody.replaceChildren();

      const total = list.length;
      updateFilterMeta(total);
      const pages = Math.max(1, Math.ceil(total / rowsPerPage));
      currentPage = Math.min(Math.max(currentPage, 1), pages);
      const start = (currentPage - 1) * rowsPerPage;
      const rows = list.slice(start, start + rowsPerPage);

      if (els.showingCountText) {
        els.showingCountText.textContent = total ? `Showing ${start + 1}–${Math.min(start + rowsPerPage, total)} of ${total} entries` : "Showing 0 entries";
      }
      if (els.pageIndicator) els.pageIndicator.textContent = `${currentPage} / ${pages}`;
      if (els.prevPageBtn) els.prevPageBtn.disabled = currentPage <= 1;
      if (els.nextPageBtn) els.nextPageBtn.disabled = currentPage >= pages;
      els.emptyState?.classList.toggle("hidden", rows.length > 0);

      const fragment = document.createDocumentFragment();
      rows.forEach((v) => {
        const tr = document.createElement("tr");
        const active = isInside(v);
        const code = v._id ? `VIS-${String(v._id).replace(/-/g, "").slice(0, 8).toUpperCase()}` : "VISITOR";

        tr.innerHTML = `
          <td data-label="Visitor">
            <div class="user-cell">
              <div class="avatar-sm">${escapeHTML(getInitials(v.fullName))}</div>
              <div>
                <strong>${escapeHTML(v.fullName || "Guest")}</strong>
                <small class="font-mono">${escapeHTML(code)}</small>
              </div>
            </div>
          </td>
          <td data-label="Contact & origin">
            <div>
              <strong>${escapeHTML(v.contact || "None")}</strong>
              <small class="text-muted" style="display:block;">${escapeHTML(v.address || "Unspecified")}</small>
            </div>
          </td>
          <td data-label="Host / office">
            <span class="dept-pill"><i data-lucide="building-2"></i><span>${escapeHTML(v.personToVisit || "Staff")}</span></span>
          </td>
          <td data-label="Purpose">
            <span class="table-tag">${escapeHTML(v.purposeCategory || "General Inquiry")}</span>
          </td>
          <td data-label="Check-in">
            <div>
              <strong>${escapeHTML(v.time || "--:--")}</strong>
              <small class="text-muted" style="display:block;">${escapeHTML(v.date || "Today")}</small>
            </div>
          </td>
          <td data-label="Status">
            <span class="badge-status ${active ? "success" : "info"}">
              <span class="dot"></span> ${active ? "In Building" : "Departed"}
            </span>
          </td>
          <td data-label="Manage" style="text-align: right;">
            <button class="btn btn-secondary btn-sm btn-view-row" type="button"><i data-lucide="eye"></i> Inspect</button>
          </td>
        `;

        tr.tabIndex = 0;
        tr.setAttribute("role", "button");
        tr.setAttribute("aria-label", `Inspect visitor ${v.fullName || "record"}`);
        tr.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openDrawer(v);
          }
        });
        tr.addEventListener("click", () => openDrawer(v));
        tr.querySelector(".btn-view-row")?.addEventListener("click", (e) => {
          e.stopPropagation();
          openDrawer(v);
        });
        fragment.appendChild(tr);
      });

      els.visitorTableBody.appendChild(fragment);
      if (window.lucide) window.lucide.createIcons();
    }

    function render() {
      updateMetrics();
      renderTable(getFilteredVisitors());
    }

    function openDrawer(visitor) {
      if (!visitor) return;
      selectedVisitor = visitor;

      $("drawerName").textContent = visitor.fullName || "Guest Details";
      $("drawerFullname").textContent = visitor.fullName || "—";
      $("drawerAvatar").textContent = getInitials(visitor.fullName);
      $("drawerContact").textContent = visitor.contact || "—";
      $("drawerAddress").textContent = visitor.address || "—";
      $("drawerPerson").textContent = visitor.personToVisit || "—";
      $("drawerPurpose").textContent = [visitor.purposeCategory, visitor.otherPurposeSpecific].filter(Boolean).join(" — ") || "—";
      $("drawerTimeIn").textContent = visitor.time || "—";
      $("drawerDate").textContent = visitor.date || "—";
      $("drawerTimeOut").textContent = visitor.timeOut || "Still Inside";

      const inside = isInside(visitor);
      const badge = $("drawerStatusBadge");
      badge.textContent = inside ? "In Building" : "Departed";
      badge.className = `badge-status ${inside ? "success" : "info"}`;

      els.toggleCheckoutBtn.innerHTML = inside ? '<i data-lucide="log-out"></i> Log Departure' : '<i data-lucide="rotate-ccw"></i> Re-open Visit';
      els.detailDrawer?.classList.add("open");
      els.detailDrawer?.setAttribute("aria-hidden", "false");
      els.overlay?.classList.add("active");
      if (window.lucide) window.lucide.createIcons();
    }

    function closeDrawer() {
      els.detailDrawer?.classList.remove("open");
      els.detailDrawer?.setAttribute("aria-hidden", "true");
      if (!els.visitorModalBackdrop?.classList.contains("open")) {
        els.overlay?.classList.remove("active");
      }
      selectedVisitor = null;
    }

    function updateVisitorNotesCount() {
      if (!els.visitorNotesCount || !els.otherPurposeSpecific) return;
      els.visitorNotesCount.textContent = `${els.otherPurposeSpecific.value.length} / 300`;
    }

    function setVisitorSaveBusy(busy) {
      if (!els.saveVisitorSubmitBtn) return;
      els.saveVisitorSubmitBtn.disabled = Boolean(busy);
      if (els.saveVisitorSubmitText) {
        els.saveVisitorSubmitText.textContent = busy ? "Saving..." : "Save Record";
      }
      const iconName = busy ? "loader-2" : "save";
      els.saveVisitorSubmitBtn.querySelector("svg")?.remove();
      els.saveVisitorSubmitBtn.insertAdjacentHTML("afterbegin", `<i data-lucide="${iconName}" class="${busy ? "visitor-save-spinner" : ""}"></i>`);
      if (window.lucide) window.lucide.createIcons();
    }

    function openVisitorModal(mode, visitor = null) {
      els.visitorAdminForm.reset();
      setVisitorSaveBusy(false);
      if (mode === "edit" && visitor) {
        els.visitorModalTitle.textContent = "Edit Visitor Record";
        els.visitorId.value = visitor._id;
        els.fullName.value = visitor.fullName;
        els.contact.value = visitor.contact;
        els.address.value = visitor.address;
        els.personToVisit.value = visitor.personToVisit;
        els.purposeCategory.value = visitor.purposeCategory;
        els.otherPurposeSpecific.value = visitor.otherPurposeSpecific;
      } else {
        els.visitorModalTitle.textContent = "New Visitor Registration";
        els.visitorId.value = "";
      }
      updateVisitorNotesCount();
      els.visitorModalBackdrop?.classList.add("open");
      els.visitorModalBackdrop?.setAttribute("aria-hidden", "false");
      body.classList.add("visitor-modal-open");
      window.setTimeout(() => els.fullName?.focus(), 80);
    }

    function closeVisitorModal() {
      els.visitorModalBackdrop?.classList.remove("open");
      els.visitorModalBackdrop?.setAttribute("aria-hidden", "true");
      body.classList.remove("visitor-modal-open");
      setVisitorSaveBusy(false);
    }

    async function saveVisitor(event) {
      event.preventDefault();
      const existingId = els.visitorId.value.trim();
      const fullName = els.fullName.value.trim();
      const contact = els.contact.value.trim();
      const address = els.address.value.trim();
      const personToVisit = els.personToVisit.value.trim();
      const purposeCategory = els.purposeCategory.value;
      const otherPurposeSpecific = els.otherPurposeSpecific.value.trim();

      if (!fullName || !contact || !address || !personToVisit || !purposeCategory) {
        toast("Please fill in all required fields.");
        return;
      }

      const payload = {
        full_name: fullName,
        contact,
        address,
        person_to_visit: personToVisit,
        purpose_category: purposeCategory,
        other_purpose_specific: otherPurposeSpecific
      };

      setVisitorSaveBusy(true);
      try {
        if (existingId) {
          const { error } = await supabaseClient.from(VISITORS_TABLE).update(payload).eq("id", existingId);
          if (error) throw error;
          logSystemAudit("UPDATE_VISITOR", `Updated visitor details for ${fullName}`);
          toast("Record updated successfully.");
        } else {
          payload.visit_date = getLocalDateKey();
          payload.time_in = new Date().toISOString();
          payload.status = "inside";
          const { error } = await supabaseClient.from(VISITORS_TABLE).insert(payload);
          if (error) throw error;
          logSystemAudit("ADD_VISITOR", `Registered new visitor pass for ${fullName}`);
          toast("Visitor registered successfully.");
        }
        closeVisitorModal();
        loadVisitors({ silent: true });
      } catch (err) {
        console.error("Save failed:", err);
        toast("Error saving record: " + (err.message || "Network issue"));
      } finally {
        setVisitorSaveBusy(false);
      }
    }

    async function toggleCheckout() {
      if (!selectedVisitor?._id) return;
      const inside = isInside(selectedVisitor);
      const patch = {
        status: inside ? "completed" : "inside",
        time_out: inside ? new Date().toISOString() : null
      };

      try {
        const { error } = await supabaseClient.from(VISITORS_TABLE).update(patch).eq("id", selectedVisitor._id);
        if (error) throw error;
        logSystemAudit(inside ? "VISITOR_DEPARTURE" : "VISITOR_REOPEN", `Marked ${selectedVisitor.fullName} as ${inside ? "Departed" : "Inside"}`);
        toast(inside ? "Departure logged." : "Visit reopened.");
        closeDrawer();
        loadVisitors({ silent: true });
      } catch (err) {
        toast("Status change failed: " + err.message);
      }
    }

    async function deleteVisitor() {
      if (!selectedVisitor?._id) return;
      if (!confirm(`Delete visitor record for ${selectedVisitor.fullName}?`)) return;

      try {
        const { error } = await supabaseClient.from(VISITORS_TABLE).delete().eq("id", selectedVisitor._id);
        if (error) throw error;
        logSystemAudit("DELETE_VISITOR", `Removed visitor record for ${selectedVisitor.fullName}`);
        toast("Visitor record removed.");
        closeDrawer();
        loadVisitors({ silent: true });
      } catch (err) {
        toast("Delete failed: " + err.message);
      }
    }

    function printVisitorPass() {
      if (!selectedVisitor) return;

      const code = selectedVisitor._id ? `VIS-${String(selectedVisitor._id).replace(/-/g, "").slice(0, 8).toUpperCase()}` : "VISITOR";

      let printBox = document.getElementById("printableVisitorPass");
      if (!printBox) {
        printBox = document.createElement("div");
        printBox.id = "printableVisitorPass";
        document.body.appendChild(printBox);
      }

      printBox.innerHTML = `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 20px auto; border: 2px solid #059669; padding: 24px; border-radius: 8px;">
          <div style="text-align: center; border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 14px;">
            <h2 style="margin: 0; font-size: 16px; color: #064e3b; text-transform: uppercase;">Provincial Government Environment and Natural Resources Office</h2>
            <h3 style="margin: 4px 0 0; font-size: 13px; color: #059669;">VISITOR GATE PASS</h3>
            <span style="display: block; font-family: monospace; font-size: 12px; margin-top: 4px; font-weight: bold;">${escapeHTML(code)}</span>
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.6;">
            <tr><td style="width: 35%; font-weight: bold;">Visitor Name:</td><td>${escapeHTML(selectedVisitor.fullName)}</td></tr>
            <tr><td style="font-weight: bold;">Contact No:</td><td>${escapeHTML(selectedVisitor.contact)}</td></tr>
            <tr><td style="font-weight: bold;">Affiliation / Origin:</td><td>${escapeHTML(selectedVisitor.address)}</td></tr>
            <tr><td style="font-weight: bold;">Host Office:</td><td>${escapeHTML(selectedVisitor.personToVisit)}</td></tr>
            <tr><td style="font-weight: bold;">Purpose:</td><td>${escapeHTML(selectedVisitor.purposeCategory)}</td></tr>
            <tr><td style="font-weight: bold;">Date & Time In:</td><td>${escapeHTML(selectedVisitor.date)} — ${escapeHTML(selectedVisitor.time)}</td></tr>
          </table>

          <div style="margin-top: 28px; display: flex; justify-content: space-between; font-size: 11px;">
            <div style="text-align: center; width: 45%;">
              <div style="border-bottom: 1px solid #000; height: 35px;"></div>
              <span style="display: block; margin-top: 4px;">Visitor's Signature</span>
            </div>
            <div style="text-align: center; width: 45%;">
              <div style="border-bottom: 1px solid #000; height: 35px;"></div>
              <span style="display: block; margin-top: 4px;">Duty Security Officer</span>
            </div>
          </div>
        </div>
      `;

      window.print();
    }

    function exportCsv() {
      const list = getFilteredVisitors();
      if (!list.length) return toast("No records match the current filter.");
      const rows = [
        ["Full Name", "Contact", "Address", "Host / Department", "Purpose", "Date", "Status"],
        ...list.map((v) => [v.fullName, v.contact, v.address, v.personToVisit, v.purposeCategory, v.date, isInside(v) ? "Inside" : "Completed"])
      ];
      const csv = rows.map((r) => r.map((c) => `"${String(c || "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `PGENRO_Visitors_${getLocalDateKey()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast(`Exported ${list.length} records.`);
    }

    async function loadVisitors({ silent = false } = {}) {
      if (syncInFlight) return;
      syncInFlight = true;

      const refreshOriginal = els.refreshBtn?.innerHTML || "";
      if (!silent && els.refreshBtn) {
        els.refreshBtn.disabled = true;
        els.refreshBtn.innerHTML = '<i data-lucide="loader-2" class="spin-icon"></i><span>Syncing</span>';
        if (window.lucide) window.lucide.createIcons();
      }

      try {
        if (!supabaseClient) throw new Error("Supabase client unavailable");
        const { data, error } = await supabaseClient.from(VISITORS_TABLE).select("*").order("created_at", { ascending: false });
        if (error) throw error;

        visitors = (data || []).map(normalizeVisitor);
        setDatabaseStatus(true, "System Online");
        render();
        if (!silent) toast("Records synchronized.");
      } catch (err) {
        console.warn("Visitors sync fallback:", err);
        setDatabaseStatus(false, "Cloud connection issue");
      } finally {
        syncInFlight = false;
        if (!silent && els.refreshBtn) {
          els.refreshBtn.disabled = false;
          els.refreshBtn.innerHTML = refreshOriginal || '<i data-lucide="refresh-cw"></i><span>Sync Data</span>';
          if (window.lucide) window.lucide.createIcons();
        }
      }
    }

    // --- SHELL CONTROLS (Identical to admin.html) ---
    els.mobileMenuBtn?.setAttribute("aria-expanded", "false");
    els.mobileMenuBtn?.addEventListener("click", () => {
      els.sidebar?.classList.toggle("mobile-open");
      const open = els.sidebar?.classList.contains("mobile-open");
      els.overlay?.classList.toggle("active", open);
      els.mobileMenuBtn?.setAttribute("aria-expanded", String(Boolean(open)));
    });

    els.sidebarCollapseBtn?.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 900px)").matches) {
        els.sidebar?.classList.remove("mobile-open");
        els.overlay?.classList.remove("active");
        els.mobileMenuBtn?.setAttribute("aria-expanded", "false");
        return;
      }
      const collapsed = !body.classList.contains("sidebar-collapsed");
      body.classList.toggle("sidebar-collapsed", collapsed);
      try { localStorage.setItem("pgenro_admin_sidebar", collapsed ? "collapsed" : "expanded"); } catch (_) {}
    });

    els.profileBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      els.notificationDropdown?.classList.remove("open");
      els.profileMenu?.classList.toggle("open");
    });

    els.notificationsBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      els.profileMenu?.classList.remove("open");
      els.notificationDropdown?.classList.toggle("open");
    });

    document.addEventListener("click", (e) => {
      if (!els.profileMenu?.contains(e.target)) els.profileMenu?.classList.remove("open");
      if (!els.notificationDropdown?.contains(e.target) && e.target !== els.notificationsBtn) {
        els.notificationDropdown?.classList.remove("open");
      }
    });

    els.logoutBtn?.addEventListener("click", async () => {
      try {
        await supabaseClient?.auth?.signOut();
      } catch (_) {}
      sessionStorage.clear();
      window.location.href = "../User/login.html";
    });

    // Filtering & Dialog Events
    els.visitorSearch?.addEventListener("input", () => { currentPage = 1; render(); });
    els.globalSearchInput?.addEventListener("input", (e) => {
      if (els.visitorSearch) els.visitorSearch.value = e.target.value;
      currentPage = 1;
      render();
    });

    els.purposeFilter?.addEventListener("change", () => { currentPage = 1; render(); });
    els.statusFilter?.addEventListener("change", () => { currentPage = 1; render(); });
    els.resetFiltersBtn?.addEventListener("click", () => {
      if (els.visitorSearch) els.visitorSearch.value = "";
      if (els.globalSearchInput) els.globalSearchInput.value = "";
      if (els.purposeFilter) els.purposeFilter.value = "all";
      if (els.statusFilter) els.statusFilter.value = "all";
      activeDateFilter = "all";
      document.querySelectorAll(".date-chip").forEach((c) => c.classList.toggle("active", c.dataset.range === "all"));
      currentPage = 1;
      render();
      toast("Filters reset.");
    });

    document.querySelectorAll(".date-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".date-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        activeDateFilter = chip.dataset.range || "all";
        currentPage = 1;
        render();
      });
    });

    els.addVisitorBtn?.addEventListener("click", () => openVisitorModal("add"));
    els.closeDrawerBtn?.addEventListener("click", closeDrawer);
    els.closeVisitorModalBtn?.addEventListener("click", closeVisitorModal);
    els.cancelVisitorModalBtn?.addEventListener("click", closeVisitorModal);
    els.visitorAdminForm?.addEventListener("submit", saveVisitor);
    els.otherPurposeSpecific?.addEventListener("input", updateVisitorNotesCount);
    els.visitorModalBackdrop?.addEventListener("click", (event) => {
      if (event.target === els.visitorModalBackdrop) closeVisitorModal();
    });
    els.toggleCheckoutBtn?.addEventListener("click", toggleCheckout);
    els.deleteVisitorBtn?.addEventListener("click", deleteVisitor);
    els.printPassBtn?.addEventListener("click", printVisitorPass);
    els.exportCsvBtn?.addEventListener("click", exportCsv);
    els.refreshBtn?.addEventListener("click", () => loadVisitors({ silent: false }));
    els.editVisitorBtn?.addEventListener("click", () => selectedVisitor && openVisitorModal("edit", selectedVisitor));
    els.prevPageBtn?.addEventListener("click", () => { if (currentPage > 1) { currentPage--; render(); } });
    els.nextPageBtn?.addEventListener("click", () => { currentPage++; render(); });
    els.overlay?.addEventListener("click", () => {
      els.sidebar?.classList.remove("mobile-open");
      els.overlay?.classList.remove("active");
      els.mobileMenuBtn?.setAttribute("aria-expanded", "false");
      closeDrawer();
    });

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        els.globalSearchInput?.focus();
      }
      if (e.key === "Escape") {
        closeDrawer();
        closeVisitorModal();
        els.sidebar?.classList.remove("mobile-open");
        els.overlay?.classList.remove("active");
        els.mobileMenuBtn?.setAttribute("aria-expanded", "false");
      }
    });

    if (!window.matchMedia("(max-width: 900px)").matches) {
      try { body.classList.toggle("sidebar-collapsed", localStorage.getItem("pgenro_admin_sidebar") === "collapsed"); } catch (_) {}
    }

    window.addEventListener("resize", () => {
      if (!window.matchMedia("(max-width: 900px)").matches) {
        els.sidebar?.classList.remove("mobile-open");
        els.overlay?.classList.remove("active");
        els.mobileMenuBtn?.setAttribute("aria-expanded", "false");
      }
    });

    els.sidebar?.querySelectorAll("a.nav-item").forEach(link => {
      link.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 900px)").matches) {
          els.sidebar?.classList.remove("mobile-open");
          els.overlay?.classList.remove("active");
          els.mobileMenuBtn?.setAttribute("aria-expanded", "false");
        }
      });
    });

    // Start sync and initial load
    loadVisitors({ silent: true });
    syncTimer = setInterval(() => loadVisitors({ silent: true }), 15000);
  });
})();

/* Module-owned motion; content remains visible if JavaScript is unavailable. */
/* Progressive, one-time entrance effects for the administrator workspace. */
(() => {
  'use strict';
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const targets = [
    '.main-content > .page-header',
    '.main-content > .ics-admin-header',
    '.main-content :is(.kpi-grid,.stats-grid,.metrics-grid,.ics-kpi-grid) > *',
    '.main-content .module-control-grid > *',
    '.main-content :is(.section-header,.panel-header,.ics-panel-header)',
    '.main-content :is(.chart-card,.table-card,.ics-panel,.service-form-card)'
  ].join(',');

  function init() {
    if (motionQuery?.matches || !('IntersectionObserver' in window)) return;
    const seen = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: .04, rootMargin: '0px 0px -18px 0px' });

    const register = root => {
      const elements = root.matches?.(targets) ? [root] : [...root.querySelectorAll(targets)];
      for (const element of elements) {
        if (seen.has(element) || element.closest('[hidden],.modal-backdrop,.modal-overlay')) continue;
        seen.add(element);
        const siblings = [...element.parentElement.children].filter(el => el.matches(targets));
        element.style.setProperty('--admin-stagger', `${Math.min(siblings.indexOf(element), 5) * 45}ms`);
        element.classList.add('admin-motion-pending');
        observer.observe(element);
      }
    };

    register(document.querySelector('.main-content') || document.body);
    const main = document.querySelector('.main-content');
    if (main) {
      const changes = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1) register(node);
        }
      });
      changes.observe(main, { childList: true, subtree: true });
      window.addEventListener('pagehide', () => { changes.disconnect(); observer.disconnect(); }, { once: true });
    }
    motionQuery?.addEventListener?.('change', event => {
      if (!event.matches) return;
      observer.disconnect();
      document.querySelectorAll('.admin-motion-pending').forEach(el => el.classList.add('is-visible'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();


/* ===================== MODULE NOTIFICATION ENGINE V3 =====================
 * Only alerts when this module receives new visible records.
 */
(function(){
  const moduleName=document.body?.dataset?.adminPage || location.pathname.split('/').pop();
  const key='pgenro_module_seen_'+moduleName;
  function addNotification(text){
    const list=document.querySelector('#notificationList');
    const badge=document.querySelector('#notifBadgeCount');
    if(!list)return;
    const empty=list.querySelector('.empty-notif-state'); if(empty) empty.remove();
    const item=document.createElement('div');
    item.className='notification-item';
    item.innerHTML='<strong>New update</strong><br><span>'+text.replace(/[<>]/g,'')+'</span>';
    list.prepend(item);
    let count=parseInt((badge?.textContent||'0').match(/\d+/)?.[0]||0)+1;
    if(badge) badge.textContent=count+' Unread';
    const ping=document.querySelector('#notifPing'); if(ping) ping.style.display='block';
  }
  function scan(){
    const rows=document.querySelectorAll('tbody tr');
    const count=rows.length;
    const old=parseInt(localStorage.getItem(key)||count);
    if(count>old) addNotification((count-old)+' new record(s) added in this module.');
    localStorage.setItem(key,String(count));
  }
  window.addEventListener('load',()=>setTimeout(scan,1500));
  const observer=new MutationObserver(()=>scan());
  observer.observe(document.body,{childList:true,subtree:true});
})();
