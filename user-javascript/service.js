document.addEventListener("DOMContentLoaded", () => {
  // Initialize Lucide Icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // --- SUPABASE REALTIME DB CONFIGURATION ---
  const supabase = window.pgenroSupabase;
  const isSupabaseConfigured = !!window.PGENRO_SUPABASE?.configured && !!supabase;
  let serviceRealtimeChannel = null;
  let serviceRecords = [];

  function calculateCurrentStep(status) {
    if (!status) return 1;
    const s = status.toLowerCase();
    if (s.includes("release") || s.includes("complete")) return 5;
    if (s.includes("process") || s.includes("rendered")) return 4;
    if (s.includes("pgdh") || s.includes("approved") || s.includes("action")) return 3;
    if (s.includes("assess") || s.includes("evaluat") || s.includes("inspect")) return 2;
    return 1;
  }

  // --- HAMBURGER & SIDEBAR NAVIGATION ---
  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const mainContent = document.getElementById("mainContent");

  const profileMenu = document.getElementById("profileMenu");
  const profileBtn = document.getElementById("profileBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const scrollToTopBtn = document.getElementById("scrollToTopBtn");

  if (hamburgerMenu && sidebar && overlay && mainContent) {
    const toggleMenu = () => {
      sidebar.classList.toggle("open");
      hamburgerMenu.classList.toggle("active");
      overlay.classList.toggle("active");
      mainContent.classList.toggle("blur");
    };

    const closeMenu = () => {
      sidebar.classList.remove("open");
      hamburgerMenu.classList.remove("active");
      overlay.classList.remove("active");
      mainContent.classList.remove("blur");
    };

    hamburgerMenu.addEventListener("click", toggleMenu);
    overlay.addEventListener("click", () => {
      closeMenu();
      closeInspectModal();
    });

    const sidebarAnchors = sidebar.querySelectorAll("a");
    sidebarAnchors.forEach((link) => {
      link.addEventListener("click", closeMenu);
    });
  }

  // Profile control toggles
  if (profileBtn && profileMenu) {
    profileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("open");
    });
  }

  document.addEventListener("click", () => {
    profileMenu?.classList.remove("open");
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      if (window.confirm("Are you sure you want to end your current session?")) {
        try { await window.pgenroSupabase?.auth?.signOut(); } catch (error) { console.warn("Sign-out warning:", error); }
        try {
          localStorage.removeItem("pgenro_current_user");
          sessionStorage.removeItem("pgenro_session_active");
          sessionStorage.removeItem("pgenro_session_token");
        } catch {}
        window.location.href = "login.html";
      }
    });
  }

  // --- REAL-TIME DATABASE LISTENER (SUPABASE) ---
  const serviceField = (item, ...keys) => {
    for (const key of keys) {
      if (item?.[key] !== undefined && item?.[key] !== null && item?.[key] !== "") return item[key];
    }
    return undefined;
  };

  function normalizeServiceRecord(raw = {}) {
    const item = raw?.data && typeof raw.data === "object" ? { ...raw, ...raw.data } : raw;
    const status = serviceField(item, "serviceStatus", "service_status", "status") || "Under Evaluation";
    const id = serviceField(item, "id", "serviceNo", "service_no", "trackingNo", "tracking_no") || crypto.randomUUID();
    const joinDateTime = (dateKeys, timeKeys) => {
      const date = serviceField(item, ...dateKeys);
      const time = serviceField(item, ...timeKeys);
      return date ? `${date}${time ? ` • ${time}` : ""}` : "--";
    };

    return {
      id: String(id),
      serviceNo: serviceField(item, "serviceNo", "service_no", "trackingNo", "tracking_no") || String(id),
      clientName: serviceField(item, "clientName", "client_name", "fullName", "full_name", "name") || "--",
      organization: serviceField(item, "organization", "agency") || "--",
      contactNo: serviceField(item, "contactNo", "contact_no", "contact") || "--",
      emailAddress: serviceField(item, "emailAddress", "email_address", "email") || "--",
      dateRequest: serviceField(item, "dateRequest", "date_request", "dateRequested", "date_requested", "created_at") || "--",
      primaryCategory: serviceField(item, "primaryCategory", "primary_category", "category") || "TECHNICAL ASSISTANCE",
      secondaryCategory: serviceField(item, "secondaryCategory", "secondary_category", "type") || "--",
      concernsCategory: serviceField(item, "concernsCategory", "concerns_category", "concern") || "--",
      certifications: serviceField(item, "certifications") || "--",
      otherServices: serviceField(item, "otherServices", "other_services") || "--",
      requestDetails: serviceField(item, "requestDetails", "request_details", "details", "scope") || "--",
      dateNeeded: serviceField(item, "dateNeeded", "date_needed") || "--",
      location: serviceField(item, "location", "site") || "--",
      requestedBy: serviceField(item, "requestedBy", "requested_by", "clientName", "client_name") || "--",
      endorsedBy: serviceField(item, "endorsedBy", "endorsed_by") || "--",
      serviceStatus: String(status),
      receivedBy: serviceField(item, "receivedBy", "received_by") || "--",
      dateReceived: serviceField(item, "dateReceived", "date_received") || "--",
      timeReceived: serviceField(item, "timeReceived", "time_received") || "--",
      receivedRemarks: serviceField(item, "receivedRemarks", "received_remarks") || "--",
      assessedBy: serviceField(item, "assessedBy", "assessed_by") || "--",
      dateAssessed: serviceField(item, "dateAssessed", "date_assessed") || "--",
      timeAssessed: serviceField(item, "timeAssessed", "time_assessed") || "--",
      assessedRemarks: serviceField(item, "assessedRemarks", "assessed_remarks") || "--",
      recommendedBy: serviceField(item, "recommendedBy", "recommended_by") || "--",
      recDate: joinDateTime(["recDate", "rec_date"], ["recTime", "rec_time"]),
      recRemarks: serviceField(item, "recRemarks", "rec_remarks") || "--",
      pgdhAction: serviceField(item, "pgdhAction", "pgdh_action") || "--",
      pgdhDateActed: joinDateTime(["pgdhDateActed", "pgdh_date_acted"], ["pgdhTimeActed", "pgdh_time_acted"]),
      pgdhInstructions: serviceField(item, "pgdhInstructions", "pgdh_instructions") || "--",
      processedBy: serviceField(item, "processedBy", "processed_by") || "--",
      dateProcessed: joinDateTime(["dateProcessed", "date_processed"], ["timeProcessed", "time_processed"]),
      processedRemarks: serviceField(item, "processedRemarks", "processed_remarks") || "--",
      serviceReceivedBy: serviceField(item, "serviceReceivedBy", "service_received_by") || "--",
      finalDateRec: joinDateTime(["finalDateRec", "final_date_rec"], ["finalTimeRec", "final_time_rec"]),
      finalRemarks: serviceField(item, "finalRemarks", "final_remarks") || "--",
      currentStep: Number(serviceField(item, "currentStep", "current_step")) || calculateCurrentStep(status)
    };
  }

  async function loadServiceRecords({ silent = false } = {}) {
    if (!isSupabaseConfigured) {
      try {
        const local = JSON.parse(localStorage.getItem("serviceRequests") || "[]");
        serviceRecords = Array.isArray(local) ? local.map(normalizeServiceRecord) : [];
      } catch { serviceRecords = []; }
      updateMetricsSummary();
      renderTable();
      return;
    }

    try {
      const { data, error } = await supabase
        .from("service_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      serviceRecords = (data || []).map(normalizeServiceRecord);
      updateMetricsSummary();
      renderTable();
    } catch (error) {
      console.error("Supabase service request read failed:", error);
      serviceRecords = [];
      updateMetricsSummary();
      renderTable();
      if (!silent) window.PGENRO_UI?.toast?.("Unable to load service requests from Supabase.", "error");
    }
  }

  function startServiceRealtime() {
    if (!isSupabaseConfigured) return;
    if (serviceRealtimeChannel) {
      try { supabase.removeChannel(serviceRealtimeChannel); } catch {}
    }
    serviceRealtimeChannel = supabase
      .channel(`user-service-requests-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "service_requests" }, () => loadServiceRecords({ silent: true }))
      .subscribe();
  }

  // --- KPI SUMMARY METRICS ---
  function updateMetricsSummary() {
    const kpiTotal = document.getElementById("kpiTotal");
    const kpiEvaluation = document.getElementById("kpiEvaluation");
    const kpiInProgress = document.getElementById("kpiInProgress");
    const kpiCompleted = document.getElementById("kpiCompleted");

    if (!kpiTotal) return;

    const total = serviceRecords.length;
    const underEval = serviceRecords.filter(r => r.serviceStatus.toLowerCase().includes("evaluation") || r.serviceStatus.toLowerCase().includes("assess")).length;
    const completed = serviceRecords.filter(r => r.serviceStatus.toLowerCase().includes("complete") || r.serviceStatus.toLowerCase().includes("release")).length;
    const inProgress = total - (underEval + completed);

    kpiTotal.textContent = total;
    kpiEvaluation.textContent = underEval;
    kpiInProgress.textContent = inProgress >= 0 ? inProgress : 0;
    kpiCompleted.textContent = completed;
  }

  // --- MODAL CONTROLS ---
  const inspectModal = document.getElementById("inspectModal");
  const dismissModalIcon = document.getElementById("dismissModalIcon");
  const closeInspectModalBtn = document.getElementById("closeInspectModalBtn");
  const closeInspectModalBottom = document.getElementById("closeInspectModalBottom");

  function openInspectModal(record) {
    if (!record) return;
    loadRecordIntoModal(record);
    inspectModal?.classList.add("active");
    overlay?.classList.add("active");
    if (window.lucide) lucide.createIcons();
  }

  function closeInspectModal() {
    inspectModal?.classList.remove("active");
    if (!sidebar?.classList.contains("open")) {
      overlay?.classList.remove("active");
    }
  }

  dismissModalIcon?.addEventListener("click", closeInspectModal);
  closeInspectModalBtn?.addEventListener("click", closeInspectModal);
  closeInspectModalBottom?.addEventListener("click", closeInspectModal);

  // --- TAB NAVIGATION ---
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  function switchTab(tabNum) {
    tabBtns.forEach((btn) => {
      btn.classList.toggle("active", parseInt(btn.getAttribute("data-tab"), 10) === tabNum);
    });

    tabPanes.forEach((pane) => {
      pane.classList.toggle("active", pane.id === `tabPane${tabNum}`);
    });

    if (window.lucide) lucide.createIcons();
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(parseInt(btn.getAttribute("data-tab"), 10)));
  });

  document.getElementById("arrowNextTo2")?.addEventListener("click", () => switchTab(2));
  document.getElementById("arrowBackTo1")?.addEventListener("click", () => switchTab(1));
  document.getElementById("arrowNextTo3")?.addEventListener("click", () => switchTab(3));
  document.getElementById("arrowBackTo2")?.addEventListener("click", () => switchTab(2));

  // --- POPULATE VIEW-ONLY MODAL ---
  function loadRecordIntoModal(record) {
    setText("popupModalTitle", `Service Record: ${record.serviceNo}`);
    setText("stepperServiceNo", record.serviceNo);

    const badge = document.getElementById("stepperStatusBadge");
    if (badge) {
      badge.textContent = record.serviceStatus;
      badge.className = `badge-status-tag ${record.serviceStatus.toLowerCase().includes("complete") ? "completed" : "inspection"}`;
    }

    // Tab 1: Client Information
    setText("viewServiceNo", record.serviceNo);
    setText("viewClientName", record.clientName);
    setText("viewOrganization", record.organization);
    setText("viewContactNo", record.contactNo);
    setText("viewEmailAddress", record.emailAddress);
    setText("viewDateRequest", record.dateRequest);

    // Tab 2: Service Request
    setText("viewPrimaryCategory", record.primaryCategory);
    setText("viewSecondaryCategory", record.secondaryCategory);
    setText("viewConcernsCategory", record.concernsCategory);
    setText("viewCertifications", record.certifications);
    setText("viewOtherServices", record.otherServices);
    setText("viewRequestDetails", record.requestDetails);
    setText("viewDateNeeded", record.dateNeeded);
    setText("viewLocation", record.location);
    setText("viewRequestedBy", record.requestedBy);
    setText("viewEndorsedBy", record.endorsedBy);
    setText("viewServiceStatus", record.serviceStatus);

    // Tab 3: Course of Action
    setText("viewReceivedBy", record.receivedBy);
    setText("viewDateReceived", record.dateReceived);
    setText("viewTimeReceived", record.timeReceived);
    setText("viewReceivedRemarks", record.receivedRemarks);

    setText("viewAssessedBy", record.assessedBy);
    setText("viewDateAssessed", record.dateAssessed);
    setText("viewTimeAssessed", record.timeAssessed);
    setText("viewAssessedRemarks", record.assessedRemarks);

    setText("viewRecommendedBy", record.recommendedBy);
    setText("viewRecDate", record.recDate);
    setText("viewRecRemarks", record.recRemarks);

    setText("viewPgdhAction", record.pgdhAction);
    setText("viewPgdhDateActed", record.pgdhDateActed);
    setText("viewPgdhInstructions", record.pgdhInstructions);

    setText("viewProcessedBy", record.processedBy);
    setText("viewDateProcessed", record.dateProcessed);
    setText("viewProcessedRemarks", record.processedRemarks);

    setText("viewServiceReceivedBy", record.serviceReceivedBy);
    setText("viewFinalDateRec", record.finalDateRec);
    setText("viewFinalRemarks", record.finalRemarks);

    updateStepper(record.currentStep || 1);
    switchTab(1);
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text !== undefined && text !== null && text !== "" ? text : "--";
  }

  function updateStepper(activeStepNumber) {
    for (let i = 1; i <= 5; i++) {
      const stepElem = document.getElementById(`step${i}`);
      const lineElem = document.getElementById(`line${i}`);
      if (!stepElem) continue;

      stepElem.classList.remove("completed", "active");
      if (lineElem) lineElem.classList.remove("active");

      if (i < activeStepNumber) {
        stepElem.classList.add("completed");
        if (lineElem) lineElem.classList.add("active");
      } else if (i === activeStepNumber) {
        stepElem.classList.add("active");
      }
    }
  }

  // --- QUICK SEARCH TRACKER ---
  const btnTrack = document.getElementById("btnTrack");
  const quickSearchInput = document.getElementById("quickSearchInput");

  function searchAndTrack(query) {
    if (!query) return;
    const q = query.toLowerCase().trim();
    const found = serviceRecords.find(
      (r) => (r.serviceNo && r.serviceNo.toLowerCase().includes(q)) || (r.clientName && r.clientName.toLowerCase().includes(q))
    );

    if (found) {
      openInspectModal(found);
    } else {
      alert(`No record found matching "${query}". Please verify your Service Code.`);
    }
  }

  btnTrack?.addEventListener("click", () => searchAndTrack(quickSearchInput?.value));
  quickSearchInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") searchAndTrack(quickSearchInput?.value);
  });

  // --- TABLE RENDERING & FILTERING ---
  const tableBody = document.getElementById("tableBody");
  const tableSearchInput = document.getElementById("tableSearchInput");
  const filterStatusSelect = document.getElementById("filterStatusSelect");
  const tableSummaryText = document.getElementById("tableSummaryText");

  function renderTable() {
    if (!tableBody) return;
    const query = tableSearchInput?.value.toLowerCase().trim() || "";
    const statusFilter = filterStatusSelect?.value || "ALL";

    const filtered = serviceRecords.filter((r) => {
      const matchSearch =
        (r.serviceNo && r.serviceNo.toLowerCase().includes(query)) ||
        (r.clientName && r.clientName.toLowerCase().includes(query)) ||
        (r.organization && r.organization.toLowerCase().includes(query)) ||
        (r.primaryCategory && r.primaryCategory.toLowerCase().includes(query));
      const matchStatus = statusFilter === "ALL" || r.serviceStatus === statusFilter;
      return matchSearch && matchStatus;
    });

    tableBody.innerHTML = "";

    if (filtered.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--text-muted);font-weight:600;">No matching service inquiries found.</td></tr>`;
      if (tableSummaryText) tableSummaryText.textContent = `Showing 0 requests`;
      return;
    }

    filtered.forEach((r) => {
      const tr = document.createElement("tr");
      const isCompleted = r.serviceStatus.toLowerCase().includes("complete");
      tr.innerHTML = `
        <td><strong style="color:var(--primary);">${r.serviceNo}</strong></td>
        <td><strong>${r.clientName}</strong></td>
        <td>${r.organization}</td>
        <td><span style="font-size:11px;font-weight:700;">${r.primaryCategory}</span></td>
        <td>${r.dateRequest}</td>
        <td><span class="badge-status-tag ${isCompleted ? "completed" : "inspection"}">${r.serviceStatus}</span></td>
        <td class="text-right">
          <button type="button" class="btn-inspect" data-sno="${r.serviceNo}">
            Inspect Record
          </button>
        </td>
      `;
      tableBody.appendChild(tr);
    });

    if (tableSummaryText) {
      tableSummaryText.textContent = `Showing ${filtered.length} of ${serviceRecords.length} registered service inquiries`;
    }

    tableBody.querySelectorAll(".btn-inspect").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetNo = btn.getAttribute("data-sno");
        const found = serviceRecords.find((r) => r.serviceNo === targetNo);
        if (found) openInspectModal(found);
      });
    });

    if (window.lucide) lucide.createIcons();
  }

  tableSearchInput?.addEventListener("input", renderTable);
  filterStatusSelect?.addEventListener("change", renderTable);

  // --- SCROLL ANIMATIONS ---
  window.addEventListener("scroll", () => {
    if (scrollToTopBtn) {
      if (window.scrollY > 300) {
        scrollToTopBtn.classList.add("visible");
      } else {
        scrollToTopBtn.classList.remove("visible");
      }
    }
  });

  scrollToTopBtn?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const revealElements = document.querySelectorAll(".reveal");
  function runScrollReveal() {
    const triggerHeight = window.innerHeight - 50;
    revealElements.forEach((el) => {
      const topOffset = el.getBoundingClientRect().top;
      if (topOffset < triggerHeight) {
        el.classList.add("show");
      }
    });
  }

  window.addEventListener("scroll", runScrollReveal);
  runScrollReveal();

  loadServiceRecords();
  startServiceRealtime();

  window.addEventListener("pagehide", () => {
    if (serviceRealtimeChannel && supabase) {
      try { supabase.removeChannel(serviceRealtimeChannel); } catch {}
    }
  }, { once: true });
});