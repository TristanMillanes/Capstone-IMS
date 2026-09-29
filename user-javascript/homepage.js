/* ============================================================================
   PGENRO IMS HOMEPAGE - EXECUTIVE DASHBOARD ENGINE
   Configured for Supabase Integration (Strict 0-Baseline & Decoupled DB Architecture)
   ============================================================================ */

document.addEventListener("DOMContentLoaded", () => {
  // --- Chart Instances ---
  let commCompareChartInstance = null;
  let operationsDistChartInstance = null;

  // --- Strict 0-Baseline Dashboard State ---
  const dashboardState = {
    // Aggregated Metrics
    kpis: {
      totalComms: 0,
      incomingComms: 0,
      outgoingComms: 0,
      totalServices: 0,
      pendingServices: 0,
      totalEmployees: 0,
      totalTravel: 0,
      activeTravel: 0,
      totalAssets: 0,
      totalIcs: 0,
      visitorsToday: 0,
      visitorsInside: 0
    },
    // Operations Volume Tracking
    operations: {
      comms: 0,
      services: 0,
      employees: 0,
      travel: 0,
      inventory: 0,
      visitors: 0
    },
    // Document Flow Line Chart Data (Defaults to 0 baseline)
    documentFlow: {
      labels: ["Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6"],
      incoming: [0, 0, 0, 0, 0, 0],
      outgoing: [0, 0, 0, 0, 0, 0]
    },
    // Dynamic Record Collections
    visitors: [],
    serviceRequests: [],
    memos: []
  };

  // --- DOM Selectors ---
  const $ = (selector) => document.querySelector(selector);
  const hamburgerMenu = $("#hamburgerMenu");
  const sidebar = $("#sidebar");
  const overlay = $("#overlay");
  const mainContent = $("#mainContent");
  const profileMenu = $("#profileMenu");
  const profileBtn = $("#profileBtn");
  const logoutBtn = $("#logoutBtn");
  const scrollToTopBtn = $("#scrollToTopBtn");

  // Telemetry & Status Nodes
  const dbStatusIndicator = $("#dbStatusIndicator") || $("#firebaseStatusIndicator");
  const dbStatusText = $("#dbStatusText") || $("#firebaseStatusText");
  const visitorRecentList = $("#visitorRecentList");
  const todayVisitorsTotal = $("#todayVisitorsTotal");
  const serviceRecentList = $("#serviceRecentList");
  const servicePendingSummary = $("#servicePendingSummary");
  const memoGrid = $("#memoGrid");
  const heroTotalRecords = $("#heroTotalRecords");
  const currentDateText = $("#currentDateText");

  // KPI Counter Nodes
  const kpiNodes = {
    totalComms: $("#kpiTotalComms"),
    incomingComms: $("#kpiIncomingCount"),
    outgoingComms: $("#kpiOutgoingCount"),
    totalServices: $("#kpiTotalServices"),
    pendingServices: $("#kpiPendingServices"),
    totalEmployees: $("#kpiTotalEmployees"),
    totalTravel: $("#kpiTotalTravel"),
    activeTravel: $("#kpiActiveTravel"),
    totalAssets: $("#kpiTotalAssets"),
    totalIcs: $("#kpiTotalIcs"),
    visitorsToday: $("#kpiVisitorsToday"),
    visitorsInside: $("#kpiVisitorsInside")
  };

  // --- Utility Functions ---
  const refreshIcons = () => {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  };

  const escapeHtml = (value) => {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  };

  const normalizeRecords = (records) => {
    if (!records) return [];
    if (Array.isArray(records)) {
      return records.map((val, idx) => ({
        id: val?.id !== undefined ? String(val.id) : String(idx),
        ...(val && typeof val === "object" ? val : { value: val })
      }));
    }
    if (typeof records === "object") {
      return Object.entries(records).map(([id, val]) => ({
        id,
        ...(val && typeof val === "object" ? val : { value: val })
      }));
    }
    return [];
  };

  const getFirstValue = (record, keys, fallback = "") => {
    if (!record) return fallback;
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
        return record[key];
      }
    }
    return fallback;
  };

  const parseDate = (value) => {
    if (value == null || value === "") return null;
    if (typeof value === "number") {
      const ms = value < 100000000000 ? value * 1000 : value;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const formatTime = (record) => {
    const raw = getFirstValue(record, [
      "created_at", "timestamp", "time", "checkInTime", "checkedInAt", "createdAt", "dateTime"
    ]);
    const date = parseDate(raw);
    if (!date) return getFirstValue(record, ["displayTime", "timeLabel"], "—");
    return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(date);
  };

  const isToday = (record) => {
    const raw = getFirstValue(record, [
      "created_at", "timestamp", "time", "checkInTime", "checkedInAt", "createdAt", "date"
    ]);
    const date = parseDate(raw);
    if (!date) return false;
    const now = new Date();
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  };

  const sortNewest = (records) => {
    return [...records].sort((a, b) => {
      const aDate = parseDate(getFirstValue(a, ["created_at", "timestamp", "createdAt", "dateTime", "time", "date"], 0));
      const bDate = parseDate(getFirstValue(b, ["created_at", "timestamp", "createdAt", "dateTime", "time", "date"], 0));
      if (aDate && bDate) return bDate - aDate;
      if (aDate) return -1;
      if (bDate) return 1;
      return 0;
    });
  };

  const initials = (name) => {
    const words = String(name || "Visitor").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "V";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  };

  // --- Live Date & Time Display ---
  const updateLiveDateTime = () => {
    if (!currentDateText) return;
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("en-PH", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(now);
    currentDateText.textContent = formatted;
  };
  updateLiveDateTime();
  setInterval(updateLiveDateTime, 60000);

  // --- System / Database Status Badge ---
  const setDatabaseStatus = (statusType = "ready", message = "Ready for Supabase Connection") => {
    if (!dbStatusIndicator || !dbStatusText) return;
    dbStatusIndicator.className = `status-indicator ${statusType}`;
    dbStatusText.textContent = message;
  };

  // --- Render KPI Cards & Aggregated Counters ---
  const renderKPIs = () => {
    const { kpis } = dashboardState;

    if (kpiNodes.totalComms) kpiNodes.totalComms.textContent = kpis.totalComms;
    if (kpiNodes.incomingComms) kpiNodes.incomingComms.textContent = kpis.incomingComms;
    if (kpiNodes.outgoingComms) kpiNodes.outgoingComms.textContent = kpis.outgoingComms;

    if (kpiNodes.totalServices) kpiNodes.totalServices.textContent = kpis.totalServices;
    if (kpiNodes.pendingServices) kpiNodes.pendingServices.textContent = kpis.pendingServices;

    if (kpiNodes.totalEmployees) kpiNodes.totalEmployees.textContent = kpis.totalEmployees;

    if (kpiNodes.totalTravel) kpiNodes.totalTravel.textContent = kpis.totalTravel;
    if (kpiNodes.activeTravel) kpiNodes.activeTravel.textContent = kpis.activeTravel;

    if (kpiNodes.totalAssets) kpiNodes.totalAssets.textContent = kpis.totalAssets;
    if (kpiNodes.totalIcs) kpiNodes.totalIcs.textContent = kpis.totalIcs;

    if (kpiNodes.visitorsToday) kpiNodes.visitorsToday.textContent = kpis.visitorsToday;
    if (kpiNodes.visitorsInside) kpiNodes.visitorsInside.textContent = kpis.visitorsInside;

    // Total records counter on Hero
    if (heroTotalRecords) {
      const grandTotal = kpis.totalComms + kpis.totalServices + kpis.totalEmployees +
                         kpis.totalTravel + kpis.totalAssets + kpis.totalIcs;
      heroTotalRecords.textContent = grandTotal.toLocaleString();
    }
  };

  // --- Render Visitor Logs List ---
  const renderVisitors = (records = dashboardState.visitors) => {
    const normalized = normalizeRecords(records);
    dashboardState.visitors = normalized;
    dashboardState.operations.visitors = normalized.length;

    const todayCount = normalized.filter(isToday).length;
    const insideCount = normalized.filter(r => {
      const st = String(getFirstValue(r, ["status", "visit_status", "visitStatus"], "Checked In"));
      return /checked.?in|active|inside/i.test(st);
    }).length;

    dashboardState.kpis.visitorsToday = todayCount;
    dashboardState.kpis.visitorsInside = insideCount;
    renderKPIs();

    if (todayVisitorsTotal) {
      todayVisitorsTotal.textContent = `${todayCount} Total Visitors Today`;
    }

    if (!visitorRecentList) return;

    if (!normalized.length) {
      visitorRecentList.innerHTML = `
        <div class="empty-state-box">
          <div class="empty-icon"><i data-lucide="clipboard-list"></i></div>
          <h4>No Visitor Records</h4>
          <p>Logged office visitors from the database will display here automatically.</p>
        </div>`;
      refreshIcons();
      updateOperationsChart();
      return;
    }

    const sorted = sortNewest(normalized).slice(0, 5);
    visitorRecentList.innerHTML = sorted.map(visitor => {
      const name = getFirstValue(visitor, ["full_name", "name", "fullName", "visitorName"], "Visitor");
      const office = getFirstValue(visitor, ["office", "organization", "agency", "company"], "Office / Guest");
      const purpose = getFirstValue(visitor, ["purpose", "reason", "visitPurpose"], "General Transaction");
      const status = String(getFirstValue(visitor, ["status", "visit_status", "visitStatus"], "Checked In"));
      const isInside = /checked.?in|active|inside/i.test(status);

      return `
        <div class="visitor-item">
          <div class="visitor-avatar">${escapeHtml(initials(name))}</div>
          <div class="visitor-info">
            <h4>${escapeHtml(name)}</h4>
            <p>${escapeHtml(office)} • ${escapeHtml(purpose)}</p>
          </div>
          <div class="visitor-meta">
            <span class="visitor-time">${escapeHtml(formatTime(visitor))}</span>
            <span class="badge-status ${isInside ? "active" : "completed"}">
              ${isInside ? '<span class="status-dot"></span>' : ''}
              ${escapeHtml(status)}
            </span>
          </div>
        </div>`;
    }).join("");

    refreshIcons();
    updateOperationsChart();
  };

  // --- Render Service Requests List ---
  const renderServiceRequests = (records = dashboardState.serviceRequests) => {
    const normalized = normalizeRecords(records);
    dashboardState.serviceRequests = normalized;
    dashboardState.operations.services = normalized.length;

    const pendingCount = normalized.filter(r => {
      const st = String(getFirstValue(r, ["status", "request_status", "serviceStatus"], "pending"));
      return /pending|open|queue|review|in.?progress/i.test(st);
    }).length;

    dashboardState.kpis.totalServices = normalized.length;
    dashboardState.kpis.pendingServices = pendingCount;
    renderKPIs();

    if (servicePendingSummary) {
      servicePendingSummary.textContent = `${pendingCount} Pending / In Queue`;
    }

    if (!serviceRecentList) return;

    if (!normalized.length) {
      serviceRecentList.innerHTML = `
        <div class="empty-state-box">
          <div class="empty-icon"><i data-lucide="shield-alert"></i></div>
          <h4>No Active Service Requests</h4>
          <p>Maintenance, IT, and administrative requests will appear here once registered.</p>
        </div>`;
      refreshIcons();
      updateOperationsChart();
      return;
    }

    const sorted = sortNewest(normalized).slice(0, 5);
    serviceRecentList.innerHTML = sorted.map(ticket => {
      const title = getFirstValue(ticket, ["title", "subject", "service_type", "serviceType"], "Service Request");
      const requester = getFirstValue(ticket, ["requested_by", "requester", "employee_name", "staff"], "Office Staff");
      const status = String(getFirstValue(ticket, ["status", "request_status", "serviceStatus"], "Pending"));
      const isPending = /pending|open|queue/i.test(status);

      return `
        <div class="visitor-item">
          <div class="visitor-avatar" style="background: ${isPending ? 'rgba(235, 87, 87, 0.12)' : 'var(--primary-glow)'}; color: ${isPending ? '#eb5757' : 'var(--primary-dark)'};">
            <i data-lucide="${isPending ? 'alert-circle' : 'check-circle'}" style="width:16px;height:16px;"></i>
          </div>
          <div class="visitor-info">
            <h4>${escapeHtml(title)}</h4>
            <p>Requester: ${escapeHtml(requester)}</p>
          </div>
          <div class="visitor-meta">
            <span class="badge-status ${isPending ? 'completed' : 'active'}">
              ${escapeHtml(status)}
            </span>
          </div>
        </div>`;
    }).join("");

    refreshIcons();
    updateOperationsChart();
  };

  // --- Render Pinned Memorandums ---
  const renderMemos = (records = dashboardState.memos) => {
    const normalized = normalizeRecords(records);
    dashboardState.memos = normalized;

    if (!memoGrid) return;

    const pinned = normalized
      .filter(memo => String(getFirstValue(memo, ["pinned", "is_pinned", "isPinned"], true)).toLowerCase() !== "false")
      .slice(0, 6);

    if (!pinned.length) {
      memoGrid.innerHTML = `
        <div class="memo-empty-card reveal show">
          <div class="empty-state-box">
            <div class="empty-icon"><i data-lucide="file-text"></i></div>
            <h4>No Pinned Office Memorandums</h4>
            <p>Directives, notices, and official executive orders from the database will display here.</p>
          </div>
        </div>`;
      refreshIcons();
      return;
    }

    memoGrid.innerHTML = pinned.map(memo => {
      const title = getFirstValue(memo, ["title", "subject", "memo_title", "memoTitle"], "Official Notice");
      const description = getFirstValue(memo, ["description", "content", "summary", "body"], "No synopsis available.");
      const code = getFirstValue(memo, ["code", "memo_code", "reference_no", "referenceNo"], "MEMO");
      const priority = getFirstValue(memo, ["priority", "priority_level", "category"], "Standard");
      const issuedDate = getFirstValue(memo, ["issued_date", "date_issued", "created_at", "date"], "—");
      const issuedBy = getFirstValue(memo, ["issued_by", "author", "department"], "PGENRO Admin");
      const target = getFirstValue(memo, ["target", "audience"], "All Units");
      const detailsUrl = getFirstValue(memo, ["details_url", "url", "link"], "officememo-admin.html");
      const downloadUrl = getFirstValue(memo, ["download_url", "file_url", "fileUrl"], "");
      const isHigh = String(priority).toLowerCase() === "high";

      return `
        <div class="memo-card pinned reveal show">
          <div class="memo-header">
            <div class="memo-badge-group">
              <span class="memo-pinned-tag"><i data-lucide="pin"></i> Pinned</span>
              <span class="memo-code">${escapeHtml(code)}</span>
            </div>
            <span class="priority-tag ${isHigh ? 'high' : 'standard'}">${escapeHtml(priority)}</span>
          </div>

          <div class="memo-body">
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(description)}</p>
          </div>

          <div class="memo-meta">
            <div class="meta-item"><i data-lucide="calendar"></i><span>Issued: ${escapeHtml(issuedDate)}</span></div>
            <div class="meta-item"><i data-lucide="user-check"></i><span>By: ${escapeHtml(issuedBy)}</span></div>
            <div class="meta-item"><i data-lucide="users"></i><span>Target: ${escapeHtml(target)}</span></div>
          </div>

          <div class="memo-footer">
            <a href="${escapeHtml(detailsUrl)}" class="btn-memo-link">
              <i data-lucide="file-text"></i> Read Details
            </a>
            ${downloadUrl ? `
              <a class="btn-icon-action" title="Download Attachment" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener">
                <i data-lucide="download"></i>
              </a>` : `
              <button class="btn-icon-action" title="No attached file" type="button" disabled>
                <i data-lucide="download"></i>
              </button>`}
          </div>
        </div>`;
    }).join("");

    refreshIcons();
  };

  // --- Document Flow Line Chart (With Graceful 0-Baseline) ---
  const renderDocumentFlowChart = (flowData = dashboardState.documentFlow) => {
    if (!window.Chart) return;
    const canvas = $("#commCompareChart");
    if (!canvas) return;

    if (commCompareChartInstance) {
      commCompareChartInstance.destroy();
      commCompareChartInstance = null;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const brandPrimary = "#0f6b3d";
    const brandLight = "#46b86b";

    const gradIn = ctx.createLinearGradient(0, 0, 0, 260);
    gradIn.addColorStop(0, "rgba(15, 107, 61, 0.18)");
    gradIn.addColorStop(1, "rgba(15, 107, 61, 0.0)");

    const gradOut = ctx.createLinearGradient(0, 0, 0, 260);
    gradOut.addColorStop(0, "rgba(70, 184, 107, 0.15)");
    gradOut.addColorStop(1, "rgba(70, 184, 107, 0.0)");

    const datasets = [
      {
        label: "Incoming Transmissions",
        data: flowData.incoming || [0, 0, 0, 0, 0, 0],
        borderColor: brandPrimary,
        backgroundColor: gradIn,
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointBackgroundColor: brandPrimary,
        pointRadius: 3.5,
        pointHoverRadius: 6
      },
      {
        label: "Outgoing Releases",
        data: flowData.outgoing || [0, 0, 0, 0, 0, 0],
        borderColor: brandLight,
        backgroundColor: gradOut,
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointBackgroundColor: brandLight,
        pointRadius: 3.5,
        pointHoverRadius: 6
      }
    ];

    commCompareChartInstance = new Chart(canvas, {
      type: "line",
      data: {
        labels: flowData.labels || ["Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6"],
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            labels: {
              color: "#5e7264",
              usePointStyle: true,
              boxWidth: 8,
              font: { weight: "600", family: "Plus Jakarta Sans", size: 11 }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: "#5e7264", font: { family: "Plus Jakarta Sans", size: 10 } },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            suggestedMax: 5,
            ticks: {
              color: "#5e7264",
              font: { family: "Plus Jakarta Sans", size: 10 },
              precision: 0,
              stepSize: 1
            },
            grid: { color: "rgba(15, 107, 61, 0.05)" }
          }
        }
      }
    });
  };

  // --- Operations Distribution Doughnut Chart (With 0-Safe Handling) ---
  const updateOperationsChart = () => {
    if (!window.Chart) return;
    const canvas = $("#operationsDistChart");
    if (!canvas) return;

    if (operationsDistChartInstance) {
      operationsDistChartInstance.destroy();
      operationsDistChartInstance = null;
    }

    const { operations } = dashboardState;
    const dataValues = [
      operations.comms,
      operations.services,
      operations.employees,
      operations.travel,
      operations.inventory,
      operations.visitors
    ];

    const hasData = dataValues.some(val => val > 0);

    const labels = hasData
      ? ["Comms", "Service Requests", "Staff", "Travel Orders", "Assets/ICS", "Visitors"]
      : ["No Database Records Recorded"];

    const chartData = hasData ? dataValues : [1];

    const backgroundColors = hasData
      ? ["#0f6b3d", "#eb5757", "#46b86b", "#2d9cdb", "#f2c94c", "#9b51e0"]
      : ["rgba(15, 107, 61, 0.08)"];

    operationsDistChartInstance = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: chartData,
          backgroundColor: backgroundColors,
          borderWidth: 2,
          borderColor: "#ffffff"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          tooltip: {
            enabled: hasData
          },
          legend: {
            position: "right",
            labels: {
              boxWidth: 10,
              usePointStyle: true,
              color: "#5e7264",
              font: { family: "Plus Jakarta Sans", size: 11, weight: "600" }
            }
          }
        },
        cutout: "70%"
      }
    });
  };

  // --- Sidebar & Mobile Navigation Handlers ---
  if (hamburgerMenu && sidebar && overlay && mainContent) {
    const toggleMenu = () => {
      const isOpen = sidebar.classList.toggle("open");
      hamburgerMenu.classList.toggle("active", isOpen);
      overlay.classList.toggle("active", isOpen);
      mainContent.classList.toggle("blur", isOpen);
      hamburgerMenu.setAttribute("aria-expanded", String(isOpen));
      document.body.classList.toggle("menu-open", isOpen);
    };

    const closeMenu = () => {
      sidebar.classList.remove("open");
      hamburgerMenu.classList.remove("active");
      overlay.classList.remove("active");
      mainContent.classList.remove("blur");
      hamburgerMenu.setAttribute("aria-expanded", "false");
      document.body.classList.remove("menu-open");
    };

    hamburgerMenu.setAttribute("aria-expanded", "false");
    hamburgerMenu.addEventListener("click", toggleMenu);
    overlay.addEventListener("click", closeMenu);
    sidebar.querySelectorAll("a").forEach(link => link.addEventListener("click", closeMenu));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 1100) closeMenu();
    });
  }

  // --- Profile Menu Dropdown ---
  if (profileBtn && profileMenu) {
    profileBtn.setAttribute("aria-expanded", "false");
    profileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = profileMenu.classList.toggle("open");
      profileBtn.setAttribute("aria-expanded", String(isOpen));
    });

    profileMenu.addEventListener("click", (e) => e.stopPropagation());

    document.addEventListener("click", () => {
      profileMenu.classList.remove("open");
      profileBtn.setAttribute("aria-expanded", "false");
    });
  }

  // --- Logout Trigger ---
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

  // --- Scroll to Top Button ---
  const updateScrollToTopButton = () => {
    if (!scrollToTopBtn) return;
    scrollToTopBtn.classList.toggle("visible", window.scrollY > 300);
  };
  window.addEventListener("scroll", updateScrollToTopButton, { passive: true });
  if (scrollToTopBtn) {
    scrollToTopBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }
  updateScrollToTopButton();

  // --- Scroll Spy Nav Highlighting ---
  const highlightActiveNavigation = () => {
    const anchors = document.querySelectorAll(".nav-links a");
    const sections = document.querySelectorAll("section[id], footer[id]");
    const scrollPosition = window.scrollY + 180;
    let activeId = "";

    sections.forEach(sec => {
      if (sec.offsetTop <= scrollPosition) {
        activeId = sec.id;
      }
    });

    if (!activeId && sections.length) {
      activeId = sections[0].id;
    }

    anchors.forEach(a => {
      const href = a.getAttribute("href");
      const isActive = href === `#${activeId}`;
      a.classList.toggle("active", isActive);
    });
  };
  window.addEventListener("scroll", highlightActiveNavigation, { passive: true });
  highlightActiveNavigation();

  // --- Intersection Observer (Scroll Reveal) ---
  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("show");
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -40px 0px", threshold: 0.05 });

    document.querySelectorAll(".reveal").forEach(el => revealObserver.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach(el => el.classList.add("show"));
  }

  // --- Responsive Chart Auto-Redraw ---
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      renderDocumentFlowChart();
      updateOperationsChart();
    }, 150);
  });

  // ==========================================================================
  // PUBLIC DASHBOARD API (Easily connect Supabase or custom queries here)
  // ==========================================================================
  window.PGENRO_DASHBOARD = {
    // 1. Update Communications
    setCommunications: (records = []) => {
      const list = normalizeRecords(records);
      dashboardState.operations.comms = list.length;
      let inCount = 0;
      let outCount = 0;

      list.forEach(doc => {
        const type = String(getFirstValue(doc, ["type", "direction", "category", "document_type"], "incoming")).toLowerCase();
        if (type.includes("out")) outCount++;
        else inCount++;
      });

      dashboardState.kpis.totalComms = list.length;
      dashboardState.kpis.incomingComms = inCount;
      dashboardState.kpis.outgoingComms = outCount;
      renderKPIs();
      updateOperationsChart();
    },

    // 2. Update Visitors
    setVisitors: (records = []) => {
      renderVisitors(records);
    },

    // 3. Update Service Requests
    setServiceRequests: (records = []) => {
      renderServiceRequests(records);
    },

    // 4. Update Employees
    setEmployees: (records = []) => {
      const list = normalizeRecords(records);
      dashboardState.operations.employees = list.length;
      dashboardState.kpis.totalEmployees = list.length;
      renderKPIs();
      updateOperationsChart();
    },

    // 5. Update Travel Orders
    setTravelOrders: (records = []) => {
      const list = normalizeRecords(records);
      dashboardState.operations.travel = list.length;
      const active = list.filter(to => {
        const st = String(getFirstValue(to, ["status", "travel_status", "travelStatus"], "active"));
        return /active|ongoing|approved|field/i.test(st);
      }).length;

      dashboardState.kpis.totalTravel = list.length;
      dashboardState.kpis.activeTravel = active;
      renderKPIs();
      updateOperationsChart();
    },

    // 6. Update Assets & ICS
    setInventory: (inventoryRecords = [], icsRecords = []) => {
      const invList = normalizeRecords(inventoryRecords);
      const icsList = normalizeRecords(icsRecords);

      dashboardState.operations.inventory = invList.length + icsList.length;
      dashboardState.kpis.totalAssets = invList.length;
      dashboardState.kpis.totalIcs = icsList.length;
      renderKPIs();
      updateOperationsChart();
    },

    // 7. Update Memos
    setMemos: (records = []) => {
      renderMemos(records);
    },

    // 8. Update Flow Line Chart
    setDocumentFlow: (flowData) => {
      if (flowData && typeof flowData === "object") {
        dashboardState.documentFlow = flowData;
        renderDocumentFlowChart(flowData);
      }
    },

    // 9. Update Database Status Badge
    setDatabaseStatus: (type = "online", message = "Database Live & Connected") => {
      setDatabaseStatus(type, message);
    },

    // 10. Bulk Payload Loader (Useful when fetching from Supabase all-in-one)
    loadDatabasePayload: (payload = {}) => {
      if (payload.communications) window.PGENRO_DASHBOARD.setCommunications(payload.communications);
      if (payload.visitors) window.PGENRO_DASHBOARD.setVisitors(payload.visitors);
      if (payload.serviceRequests) window.PGENRO_DASHBOARD.setServiceRequests(payload.serviceRequests);
      if (payload.employees) window.PGENRO_DASHBOARD.setEmployees(payload.employees);
      if (payload.travelOrders) window.PGENRO_DASHBOARD.setTravelOrders(payload.travelOrders);
      if (payload.inventory || payload.ics) window.PGENRO_DASHBOARD.setInventory(payload.inventory || [], payload.ics || []);
      if (payload.memos) window.PGENRO_DASHBOARD.setMemos(payload.memos);
      if (payload.documentFlow) window.PGENRO_DASHBOARD.setDocumentFlow(payload.documentFlow);
      if (payload.status) setDatabaseStatus(payload.status.type, payload.status.message);
    },

    // 11. Reset Everything to Strict 0
    resetToZero: () => {
      Object.keys(dashboardState.kpis).forEach(k => { dashboardState.kpis[k] = 0; });
      Object.keys(dashboardState.operations).forEach(k => { dashboardState.operations[k] = 0; });
      dashboardState.visitors = [];
      dashboardState.serviceRequests = [];
      dashboardState.memos = [];
      dashboardState.documentFlow = {
        labels: ["Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6"],
        incoming: [0, 0, 0, 0, 0, 0],
        outgoing: [0, 0, 0, 0, 0, 0]
      };
      renderKPIs();
      renderVisitors([]);
      renderServiceRequests([]);
      renderMemos([]);
      renderDocumentFlowChart();
      updateOperationsChart();
    },

    getState: () => ({ ...dashboardState })
  };

  // --- Initial Clean Boot ---
  renderKPIs();
  renderVisitors([]);
  renderServiceRequests([]);
  renderMemos([]);
  renderDocumentFlowChart();
  updateOperationsChart();
  setDatabaseStatus("standby", "Standby • Ready for Supabase Sync");
  refreshIcons();
});