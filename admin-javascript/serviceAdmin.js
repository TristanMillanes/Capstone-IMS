/**
 * =========================================================================
 * PGENRO IMS - SERVICE REQUEST ENCODING & REALTIME DB CONTROLLER
 * Directive Step-by-Step Navigation & Responsive Realtime DB Integration
 * =========================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();

  // --- 1. LIVE SYSTEM CLOCK ---
  const clockEl = document.querySelector("#liveClockDisplay span");
  if (clockEl) {
    const updateClock = () => {
      clockEl.textContent = new Date().toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
    };
    updateClock();
    setInterval(updateClock, 1000);
  }

  // --- 2. SIDEBAR NAVIGATION CONTROLS ---
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const sidebar = document.getElementById("sidebar");
  const sidebarCollapseBtn = document.getElementById("sidebarCollapseBtn");
  const sidebarBackdrop = document.getElementById("sidebarBackdrop");
  const mainWrapper = document.getElementById("mainWrapper");

  function toggleMobileMenu() {
    sidebar?.classList.toggle("mobile-open");
    sidebarBackdrop?.classList.toggle("active");
  }

  function closeMobileMenu() {
    sidebar?.classList.remove("mobile-open");
    sidebarBackdrop?.classList.remove("active");
  }

  mobileMenuBtn?.addEventListener("click", toggleMobileMenu);
  sidebarBackdrop?.addEventListener("click", closeMobileMenu);

  sidebarCollapseBtn?.addEventListener("click", () => {
    sidebar?.classList.toggle("collapsed");
    mainWrapper?.classList.toggle("sidebar-collapsed");
  });

  // --- 3. FIREBASE REALTIME DATABASE CONFIGURATION ---
  const firebaseConfig = {
    apiKey: "AIzaSyAwiRrYub7tl1EXwehKbsCjfwQiyGKxiyE",
    authDomain: "ims-capstone-bc65f.firebaseapp.com",
    databaseURL: "https://ims-capstone-bc65f-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ims-capstone-bc65f",
    storageBucket: "ims-capstone-bc65f.firebasestorage.app",
    messagingSenderId: "972207120140",
    appId: "1:972207120140:web:6a94e2e1e9e8511e933329",
    measurementId: "G-W4TPE7CHC8"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const db = firebase.database();

  function setDbStatus(online, msg) {
    const dot = document.getElementById("dbStatusDot");
    const text = document.getElementById("dbStatusText");
    if (dot) dot.className = online ? "status-dot online" : "status-dot offline";
    if (text) text.textContent = msg;
  }

  // Monitor Database Connection Status
  db.ref(".info/connected").on("value", (snap) => {
    if (snap.val() === true) {
      setDbStatus(true, "Live Synchronized");
    } else {
      setDbStatus(false, "Connecting / Offline");
    }
  });

  // --- 4. FORM & STATE VARIABLES ---
  let serviceRecords = [];
  let activeTabIdx = 0;
  const tabPanels = ["tab-client-info", "tab-service-request", "tab-course-action"];

  const form = document.getElementById("serviceRequestForm");
  const displayActiveId = document.getElementById("displayActiveServiceNo");
  const displayStatusBadge = document.getElementById("displayActiveStatusBadge");
  const hiddenDocId = document.getElementById("docIdHidden");

  // Navigation Directive Controls
  const tabButtons = document.querySelectorAll(".tab-btn");
  const btnPrevTab = document.getElementById("btnPrevTab");
  const btnNextTab = document.getElementById("btnNextTab");
  const btnSaveAction = document.getElementById("btnSaveAction");
  const saveBtnText = document.getElementById("saveBtnText");

  // Validate fields for a given tab panel before advancing
  function validateCurrentTab(tabIndex) {
    const panelId = tabPanels[tabIndex];
    const panel = document.getElementById(panelId);
    if (!panel) return true;

    const requiredInputs = panel.querySelectorAll("input[required], select[required], textarea[required]");
    for (let input of requiredInputs) {
      if (!input.value.trim()) {
        input.focus();
        input.reportValidity();
        showToast(`Please complete "${input.labels?.[0]?.innerText || input.name}" before proceeding.`, "error");
        return false;
      }
    }
    return true;
  }

  // Directive Step Tab Switcher (Show Next on Tabs 1/2, Show Save on Tab 3)
  function switchTab(index, bypassValidation = false) {
    if (index < 0 || index >= tabPanels.length) return;

    // Validate if stepping forward
    if (!bypassValidation && index > activeTabIdx) {
      if (!validateCurrentTab(activeTabIdx)) return;
    }

    activeTabIdx = index;

    // Update Tab Navigation Buttons
    tabButtons.forEach((btn, idx) => btn.classList.toggle("active", idx === activeTabIdx));
    tabPanels.forEach((panelId, idx) => {
      const panel = document.getElementById(panelId);
      if (panel) panel.classList.toggle("active", idx === activeTabIdx);
    });

    // DIRECTIVE FLOW LOGIC:
    // Tab 1: Show Next only
    // Tab 2: Show Prev & Next
    // Tab 3: Show Prev & SAVE RECORD button
    if (activeTabIdx === 0) {
      if (btnPrevTab) btnPrevTab.style.display = "none";
      if (btnNextTab) btnNextTab.style.display = "inline-flex";
      if (btnSaveAction) btnSaveAction.style.display = "none";
    } else if (activeTabIdx === 1) {
      if (btnPrevTab) btnPrevTab.style.display = "inline-flex";
      if (btnNextTab) btnNextTab.style.display = "inline-flex";
      if (btnSaveAction) btnSaveAction.style.display = "none";
    } else if (activeTabIdx === 2) {
      if (btnPrevTab) btnPrevTab.style.display = "inline-flex";
      if (btnNextTab) btnNextTab.style.display = "none";
      if (btnSaveAction) btnSaveAction.style.display = "inline-flex";
    }

    if (window.lucide) lucide.createIcons();
    window.scrollTo({ top: 140, behavior: "smooth" });
  }

  // Event Listeners for Directive Controls
  tabButtons.forEach((btn, idx) => {
    btn.addEventListener("click", () => switchTab(idx, false));
  });

  btnPrevTab?.addEventListener("click", () => {
    switchTab(activeTabIdx - 1, true);
  });

  btnNextTab?.addEventListener("click", () => {
    switchTab(activeTabIdx + 1, false);
  });

  // Auto Generate Service No (e.g. SR-2026-1045)
  function generateNewServiceNo() {
    const currentYear = new Date().getFullYear();
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `SR-${currentYear}-${randomSuffix}`;
  }

  function resetFormToNew() {
    form.reset();
    hiddenDocId.value = "";
    const newServiceNo = generateNewServiceNo();
    document.getElementById("serviceNo").value = newServiceNo;
    displayActiveId.textContent = newServiceNo;
    document.getElementById("dateRequest").value = new Date().toISOString().split("T")[0];
    updateStatusBadge("Pending Review");
    switchTab(0, true);
    showToast("Ready for new service request entry.", "success");
  }

  function updateStatusBadge(status) {
    if (!displayStatusBadge) return;
    displayStatusBadge.className = "badge-status";
    const s = (status || "Pending Review").toLowerCase();

    if (s.includes("complete") || s.includes("closed")) {
      displayStatusBadge.classList.add("success");
    } else if (s.includes("progress") || s.includes("assessed") || s.includes("evaluat")) {
      displayStatusBadge.classList.add("info");
    } else if (s.includes("disapproved") || s.includes("cancel")) {
      displayStatusBadge.classList.add("danger");
    } else {
      displayStatusBadge.classList.add("warning");
    }

    displayStatusBadge.innerHTML = `<span class="dot"></span> ${status || "Draft"}`;
  }

  // Stepper Progression Calculation (1 to 5) for the User View
  function calculateCurrentStep(status, data) {
    if (data.serviceReceivedBy && data.serviceReceivedBy.trim() !== "") return 5;
    if (data.processedBy && data.processedBy.trim() !== "") return 4;
    if (data.pgdhAction && data.pgdhAction.trim() !== "") return 3;
    if (data.assessedBy && data.assessedBy.trim() !== "") return 2;

    const s = (status || "").toLowerCase();
    if (s.includes("complete") || s.includes("release")) return 5;
    if (s.includes("progress") || s.includes("process") || s.includes("rendered")) return 4;
    if (s.includes("pgdh") || s.includes("approved")) return 3;
    if (s.includes("assessed") || s.includes("evaluat")) return 2;
    return 1;
  }

  // --- 5. DATA EXTRACTION & USER-SCHEMA COMPATIBILITY ---
  function getFormData() {
    const formData = new FormData(form);
    const data = {};
    formData.forEach((val, key) => (data[key] = val.trim()));

    // Map Category Helpers for User Portal
    data.primaryCategory = data.technicalAssistance || data.certifications || data.plantingMaterials || data.environmentalConcerns || data.iecService || "TECHNICAL ASSISTANCE";
    data.secondaryCategory = data.iecService || data.certifications || data.otherServices || "--";
    data.concernsCategory = data.environmentalConcerns || "--";
    data.endorsedBy = data.notedBy || "--";

    // Formatted composite timestamps
    data.recDate = data.recommendedDate ? `${data.recommendedDate}${data.recommendedTime ? ` • ${data.recommendedTime}` : ""}` : "--";
    data.recRemarks = data.recommendedRemarks || "--";

    data.pgdhDateActed = data.pgdhDateActed ? `${data.pgdhDateActed}${data.pgdhTimeActed ? ` • ${data.pgdhTimeActed}` : ""}` : "--";
    data.dateProcessed = data.dateProcessed ? `${data.dateProcessed}${data.timeProcessed ? ` • ${data.timeProcessed}` : ""}` : "--";
    
    data.finalDateRec = (data.clientDateReceived || data.clientDateActed) 
      ? `${data.clientDateReceived || data.clientDateActed}${data.clientTimeReceived ? ` • ${data.clientTimeReceived}` : ""}` 
      : "--";
    data.finalRemarks = data.clientRemarks || "--";

    data.currentStep = calculateCurrentStep(data.serviceStatus, data);
    data.updatedAt = new Date().toISOString();

    return data;
  }

  function populateForm(data, docId) {
    form.reset();
    hiddenDocId.value = docId || "";

    for (const [key, value] of Object.entries(data)) {
      const field = form.elements[key];
      if (field) field.value = value || "";
    }

    displayActiveId.textContent = data.serviceNo || "SR-RECORD";
    updateStatusBadge(data.serviceStatus || "Pending Review");
    switchTab(0, true);
  }

  // --- 6. REALTIME DATABASE LISTENERS ---
  const serviceRequestsRef = db.ref("service_requests");

  serviceRequestsRef.on("value", (snapshot) => {
    serviceRecords = [];
    let openCount = 0;
    const data = snapshot.val();

    if (data) {
      Object.keys(data).forEach((key) => {
        const item = { id: key, ...data[key] };
        serviceRecords.push(item);

        const st = (item.serviceStatus || "").toLowerCase();
        if (st.includes("pending") || st.includes("progress") || st.includes("evaluat") || st.includes("review")) {
          openCount++;
        }
      });
    }

    // Sort by latest date
    serviceRecords.sort((a, b) => new Date(b.dateRequest || 0) - new Date(a.dateRequest || 0));

    // Update Badges
    const badge = document.getElementById("sidebarServiceBadge");
    if (badge) badge.textContent = `${openCount} Open`;

    renderSummaryTable(serviceRecords);
  }, (error) => {
    console.error("Firebase read error:", error);
    setDbStatus(false, "Sync Error");
    showToast("Database connection error.", "error");
  });

  // Account Requests Badge
  db.ref("account_requests").on("value", (snapshot) => {
    const data = snapshot.val();
    let pendingCount = 0;
    if (data) {
      Object.values(data).forEach(req => {
        if (req.status === "pending") pendingCount++;
      });
    }
    const pBadge = document.getElementById("sidebarPendingBadge");
    if (pBadge) pBadge.textContent = `${pendingCount} New`;
  });

  // --- 7. FORM SUBMISSION (RESPONSIVE SAVE BUTTON) ---
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Final full validation
    if (!validateCurrentTab(0) || !validateCurrentTab(1)) {
      return;
    }

    const recordData = getFormData();
    const docId = hiddenDocId.value;

    // Enter Responsive Loading State
    btnSaveAction.disabled = true;
    btnSaveAction.innerHTML = `<i data-lucide="loader-2" class="spin-icon"></i> <span>Saving to Database...</span>`;
    if (window.lucide) lucide.createIcons();

    try {
      if (docId) {
        // Update existing record
        await serviceRequestsRef.child(docId).update(recordData);
        showToast(`Request [${recordData.serviceNo}] successfully updated!`, "success");
      } else {
        // Create new record
        recordData.createdAt = firebase.database.ServerValue.TIMESTAMP;
        const newRef = serviceRequestsRef.push();
        recordData.id = newRef.key;
        await newRef.set(recordData);
        hiddenDocId.value = newRef.key;
        showToast(`New Request [${recordData.serviceNo}] published live!`, "success");
      }

      displayActiveId.textContent = recordData.serviceNo;
      updateStatusBadge(recordData.serviceStatus);
    } catch (err) {
      console.error("Error writing to database:", err);
      showToast("Error saving record to database.", "error");
    } finally {
      // Restore Button State
      btnSaveAction.disabled = false;
      btnSaveAction.innerHTML = `<i data-lucide="save"></i> <span>SAVE RECORD</span>`;
      if (window.lucide) lucide.createIcons();
    }
  });

  document.getElementById("btnNewRecord")?.addEventListener("click", resetFormToNew);
  document.getElementById("btnClearAction")?.addEventListener("click", () => {
    if (confirm("Clear all input fields and start fresh?")) {
      resetFormToNew();
    }
  });

  // --- 8. MODAL MANAGERS ---
  const summaryModal = document.getElementById("summaryModal");
  const searchModal = document.getElementById("searchModal");

  document.getElementById("btnOpenSummaryModal")?.addEventListener("click", () => summaryModal?.classList.add("open"));
  document.getElementById("closeSummaryModal")?.addEventListener("click", () => summaryModal?.classList.remove("open"));

  document.getElementById("btnOpenSearchModal")?.addEventListener("click", () => {
    searchModal?.classList.add("open");
    document.getElementById("modalSearchFilter")?.focus();
  });
  document.getElementById("closeSearchModal")?.addEventListener("click", () => searchModal?.classList.remove("open"));

  window.addEventListener("click", (e) => {
    if (e.target === summaryModal) summaryModal.classList.remove("open");
    if (e.target === searchModal) searchModal.classList.remove("open");
  });

  // --- 9. SEARCH & SUMMARY TABLES ---
  const modalSearchFilter = document.getElementById("modalSearchFilter");
  modalSearchFilter?.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase().trim();
    const filtered = serviceRecords.filter(r => 
      (r.serviceNo && r.serviceNo.toLowerCase().includes(term)) ||
      (r.clientName && r.clientName.toLowerCase().includes(term)) ||
      (r.organization && r.organization.toLowerCase().includes(term)) ||
      (r.location && r.location.toLowerCase().includes(term))
    );
    renderSearchModalResults(filtered);
  });

  const quickSearchInput = document.getElementById("quickSearchInput");
  quickSearchInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const term = quickSearchInput.value.toLowerCase().trim();
      if (!term) return;
      const found = serviceRecords.find(r => 
        (r.serviceNo && r.serviceNo.toLowerCase().includes(term)) ||
        (r.clientName && r.clientName.toLowerCase().includes(term))
      );
      if (found) {
        populateForm(found, found.id);
        showToast(`Loaded ${found.serviceNo}`, "success");
      } else {
        showToast(`No match found for "${quickSearchInput.value}"`, "error");
      }
    }
  });

  function renderSearchModalResults(list) {
    const tbody = document.getElementById("searchModalResultsBody");
    if (!tbody) return;

    if (!list || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-table-cell">No matching service requests found.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(item => `
      <tr>
        <td><strong>${item.serviceNo || '--'}</strong></td>
        <td>${item.clientName || '--'}</td>
        <td>${item.organization || '--'}</td>
        <td>${item.dateRequest || '--'}</td>
        <td><span class="badge-status info">${item.serviceStatus || 'Pending'}</span></td>
        <td style="text-align:center;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="selectRecordFromModal('${item.id}')">
            Load
          </button>
        </td>
      </tr>
    `).join("");
  }

  function renderSummaryTable(list) {
    const tbody = document.getElementById("summaryMasterBody");
    const label = document.getElementById("summaryCountLabel");

    if (label) label.textContent = `${list.length} Service records in database`;
    if (!tbody) return;

    if (!list || list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-table-cell">No service records registered yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(item => {
      const scope = item.primaryCategory || item.technicalAssistance || item.plantingMaterials || item.certifications || 'General Service';
      const isComplete = (item.serviceStatus || "").toLowerCase().includes("complete");

      return `
        <tr>
          <td><strong style="color:var(--emerald-accent);">${item.serviceNo || '--'}</strong></td>
          <td>${item.dateRequest || '--'}</td>
          <td><strong>${item.clientName || 'N/A'}</strong></td>
          <td>${item.organization || '--'}</td>
          <td><span style="font-size:11px;font-weight:700;">${scope}</span></td>
          <td><span class="badge-status ${isComplete ? 'success' : 'info'}">${item.serviceStatus || 'Pending'}</span></td>
          <td style="text-align:center;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="selectRecordFromModal('${item.id}')">
              Edit
            </button>
          </td>
        </tr>
      `;
    }).join("");

    renderSearchModalResults(list);
  }

  window.selectRecordFromModal = (docId) => {
    const record = serviceRecords.find(r => r.id === docId);
    if (record) {
      populateForm(record, record.id);
      summaryModal?.classList.remove("open");
      searchModal?.classList.remove("open");
      showToast(`Record ${record.serviceNo} loaded successfully.`, "success");
    }
  };

  // --- 10. EXPORT SUMMARY TO CSV ---
  document.getElementById("btnExportSummaryCsv")?.addEventListener("click", () => {
    if (!serviceRecords.length) {
      showToast("No data to export.", "error");
      return;
    }

    const headers = ["Service No", "Date Requested", "Client Name", "Organization", "Contact No", "Status", "Location", "Current Step"];
    const rows = serviceRecords.map(r => [
      `"${r.serviceNo || ''}"`,
      `"${r.dateRequest || ''}"`,
      `"${r.clientName || ''}"`,
      `"${r.organization || ''}"`,
      `"${r.contactNo || ''}"`,
      `"${r.serviceStatus || ''}"`,
      `"${r.location || ''}"`,
      `"${r.currentStep || 1}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `PGENRO_Service_Requests_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // --- 11. TOAST NOTIFICATIONS ---
  function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}"></i>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      toast.style.transition = "all 0.25s ease";
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  // Ctrl + K search shortcut
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      document.getElementById("quickSearchInput")?.focus();
    }
  });

  // Initial load
  resetFormToNew();
});