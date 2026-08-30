document.addEventListener("DOMContentLoaded", () => {
  // Initialize Lucide Icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // --- FIREBASE REALTIME DB CONFIGURATION ---
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

  let serviceRecords = [];

  // Fallback demo data
  const defaultFallbackData = [
    {
      id: "demo-1",
      serviceNo: "SR-2025-001",
      clientName: "Engr. Ricardo Mendoza",
      organization: "LGU Tayabas City - City Engineer Office",
      contactNo: "0917-554-3210",
      emailAddress: "r.mendoza@tayabas.gov.ph",
      dateRequest: "10/24/2025",
      primaryCategory: "TECHNICAL ASSISTANCE",
      secondaryCategory: "INFORMATION & EDUCATION (IEC)",
      concernsCategory: "Tree Cutting / Pruning Clearance Inspection",
      certifications: "Environmental Clearance Certificate (ECC Audit)",
      otherServices: "Joint inspection with DPWH 1st District Engineering Office.",
      requestDetails: "Assessment of 14 roadside trees along the Maharlika Highway widening corridor for safety clearance.",
      dateNeeded: "11/05/2025",
      location: "Brgy. Isabang, Tayabas City, Quezon",
      requestedBy: "Engr. Ricardo Mendoza",
      endorsedBy: "Mayor Lovely Reynoso-Pontillas",
      serviceStatus: "Under Evaluation",
      receivedBy: "ASD Records Officer - J. Del Rosario",
      dateReceived: "10/24/2025",
      timeReceived: "09:15 AM",
      receivedRemarks: "Complete supporting documents attached.",
      assessedBy: "Forester Maria Clara Ramos (FNRD)",
      dateAssessed: "10/25/2025",
      timeAssessed: "02:30 PM",
      assessedRemarks: "Site inspection verified. Tree inventory prepared.",
      recommendedBy: "Division Chief - Roberto Alcantara",
      recDate: "10/26/2025 • 03:45 PM",
      recRemarks: "Endorsed for PGDH issuance of technical certificate.",
      pgdhAction: "APPROVED FOR CLEARANCE",
      pgdhDateActed: "10/27/2025 • 04:00 PM",
      pgdhInstructions: "Release permit with seedling replacement condition (1:50 ratio).",
      processedBy: "Technical Staff - D. Mendoza",
      dateProcessed: "10/28/2025 • 10:30 AM",
      processedRemarks: "Clearance documents dispatched for client release.",
      serviceReceivedBy: "Pending Client Pick-up",
      finalDateRec: "--",
      finalRemarks: "Client notified via SMS & Email.",
      currentStep: 3
    },
    {
      id: "demo-2",
      serviceNo: "SR-2025-002",
      clientName: "Maria Santos",
      organization: "Quezon Eco-Tourism Association",
      contactNo: "0928-112-9843",
      emailAddress: "m.santos@quezonecotour.org",
      dateRequest: "10/25/2025",
      primaryCategory: "CLEARANCE & PERMIT",
      secondaryCategory: "ENVIRONMENTAL CERTIFICATE",
      concernsCategory: "Watershed Impact Review",
      certifications: "Watershed Compliance Certificate",
      otherServices: "Resource sustainability mapping.",
      requestDetails: "Request for technical assessment of eco-trail campsite in Lucban watershed buffer zone.",
      dateNeeded: "11/12/2025",
      location: "Brgy. Samil, Lucban, Quezon",
      requestedBy: "Maria Santos",
      endorsedBy: "Hon. Celso Dator",
      serviceStatus: "Completed",
      receivedBy: "Reception Desk - A. Gomez",
      dateReceived: "10/25/2025",
      timeReceived: "10:30 AM",
      receivedRemarks: "Formal request letter attached.",
      assessedBy: "EnP. Gabriel Reyes",
      dateAssessed: "10/26/2025",
      timeAssessed: "11:00 AM",
      assessedRemarks: "Site passed safety and watershed buffer standards.",
      recommendedBy: "Division Chief - Roberto Alcantara",
      recDate: "10/27/2025 • 02:15 PM",
      recRemarks: "Recommended for immediate approval.",
      pgdhAction: "APPROVED",
      pgdhDateActed: "10/28/2025 • 09:00 AM",
      pgdhInstructions: "Grant temporary eco-camp clearance.",
      processedBy: "Records Unit - R. Cruz",
      dateProcessed: "10/29/2025 • 01:30 PM",
      processedRemarks: "Official permit issued.",
      serviceReceivedBy: "Maria Santos",
      finalDateRec: "10/30/2025 • 03:00 PM",
      finalRemarks: "Original signed copy released.",
      currentStep: 5
    }
  ];

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
    logoutBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to end your current session?")) {
        window.location.href = "login.html";
      }
    });
  }

  // --- REAL-TIME DATABASE LISTENER ---
  const serviceRequestsRef = db.ref("service_requests");

  serviceRequestsRef.on("value", (snapshot) => {
    const data = snapshot.val();
    serviceRecords = [];

    if (data) {
      Object.keys(data).forEach((key) => {
        const item = data[key];
        serviceRecords.push({
          id: key,
          serviceNo: item.serviceNo || item.trackingNo || key,
          clientName: item.clientName || item.fullName || item.name || "--",
          organization: item.organization || item.agency || "--",
          contactNo: item.contactNo || item.contact || "--",
          emailAddress: item.emailAddress || item.email || "--",
          dateRequest: item.dateRequest || item.dateRequested || "--",
          primaryCategory: item.primaryCategory || item.category || "TECHNICAL ASSISTANCE",
          secondaryCategory: item.secondaryCategory || item.type || "--",
          concernsCategory: item.concernsCategory || item.concern || "--",
          certifications: item.certifications || "--",
          otherServices: item.otherServices || "--",
          requestDetails: item.requestDetails || item.details || item.scope || "--",
          dateNeeded: item.dateNeeded || "--",
          location: item.location || item.site || "--",
          requestedBy: item.requestedBy || item.clientName || "--",
          endorsedBy: item.endorsedBy || "--",
          serviceStatus: item.serviceStatus || item.status || "Under Evaluation",

          receivedBy: item.receivedBy || "--",
          dateReceived: item.dateReceived || "--",
          timeReceived: item.timeReceived || "--",
          receivedRemarks: item.receivedRemarks || "--",

          assessedBy: item.assessedBy || "--",
          dateAssessed: item.dateAssessed || "--",
          timeAssessed: item.timeAssessed || "--",
          assessedRemarks: item.assessedRemarks || "--",

          recommendedBy: item.recommendedBy || "--",
          recDate: item.recDate ? `${item.recDate} • ${item.recTime || ""}` : "--",
          recRemarks: item.recRemarks || "--",

          pgdhAction: item.pgdhAction || "--",
          pgdhDateActed: item.pgdhDateActed ? `${item.pgdhDateActed} • ${item.pgdhTimeActed || ""}` : "--",
          pgdhInstructions: item.pgdhInstructions || "--",

          processedBy: item.processedBy || "--",
          dateProcessed: item.dateProcessed ? `${item.dateProcessed} • ${item.timeProcessed || ""}` : "--",
          processedRemarks: item.processedRemarks || "--",

          serviceReceivedBy: item.serviceReceivedBy || "--",
          finalDateRec: item.finalDateRec ? `${item.finalDateRec} • ${item.finalTimeRec || ""}` : "--",
          finalRemarks: item.finalRemarks || "--",

          currentStep: item.currentStep ? parseInt(item.currentStep, 10) : calculateCurrentStep(item.serviceStatus || item.status)
        });
      });
    }

    if (serviceRecords.length === 0) {
      serviceRecords = [...defaultFallbackData];
    }

    updateMetricsSummary();
    renderTable();
  }, (error) => {
    console.error("Firebase read error:", error);
    serviceRecords = [...defaultFallbackData];
    updateMetricsSummary();
    renderTable();
  });

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
});