/* ============================================================================
   PGENRO IMS HOMEPAGE
   Firebase Realtime Database Edition
   ============================================================================ */

document.addEventListener("DOMContentLoaded", () => {
  let commCompareChartInstance = null;
  let latestFlowData = null;
  let visitorCache = [];

  // Firebase paths. Change these constants only if your existing database
  // uses different top-level node names.
  const DB_PATHS = {
    visitors: "visitors",
    memos: "memos",
    documentFlow: "documentFlow"
  };

  if (window.lucide) {
    lucide.createIcons();
  }

  const $ = (selector) => document.querySelector(selector);
  const hamburgerMenu = $("#hamburgerMenu");
  const sidebar = $("#sidebar");
  const overlay = $("#overlay");
  const mainContent = $("#mainContent");
  const profileMenu = $("#profileMenu");
  const profileBtn = $("#profileBtn");
  const logoutBtn = $("#logoutBtn");
  const scrollToTopBtn = $("#scrollToTopBtn");
  const visitorRecentList = $("#visitorRecentList");
  const todayVisitorsTotal = $("#todayVisitorsTotal");
  const memoGrid = $("#memoGrid");
  const firebaseStatusIndicator = $("#firebaseStatusIndicator");
  const firebaseStatusText = $("#firebaseStatusText");

  // --------------------------------------------------------------------------
  // Generic helpers
  // --------------------------------------------------------------------------
  const escapeHtml = (value) => {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  };

  const normalizeRecords = (snapshotValue) => {
    if (!snapshotValue) return [];

    if (Array.isArray(snapshotValue)) {
      return snapshotValue.map((value, index) => ({
        id: String(index),
        ...(value && typeof value === "object" ? value : { value })
      }));
    }

    if (typeof snapshotValue === "object") {
      return Object.entries(snapshotValue).map(([id, value]) => ({
        id,
        ...(value && typeof value === "object" ? value : { value })
      }));
    }

    return [];
  };

  const getFirstValue = (record, keys, fallback = "") => {
    for (const key of keys) {
      if (record && record[key] !== undefined && record[key] !== null && record[key] !== "") {
        return record[key];
      }
    }
    return fallback;
  };

  const parseDate = (value) => {
    if (value == null || value === "") return null;

    if (typeof value === "number") {
      const milliseconds = value < 100000000000 ? value * 1000 : value;
      const date = new Date(milliseconds);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatTime = (record) => {
    const raw = getFirstValue(record, [
      "timestamp",
      "time",
      "checkInTime",
      "checkedInAt",
      "createdAt",
      "dateTime"
    ]);

    const date = parseDate(raw);
    if (!date) return getFirstValue(record, ["displayTime", "timeLabel"], "—");

    return new Intl.DateTimeFormat("en-PH", {
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  };

  const isToday = (record) => {
    const raw = getFirstValue(record, [
      "timestamp",
      "time",
      "checkInTime",
      "checkedInAt",
      "createdAt",
      "dateTime",
      "date"
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
      const aRaw = getFirstValue(a, ["timestamp", "createdAt", "dateTime", "time", "date"], 0);
      const bRaw = getFirstValue(b, ["timestamp", "createdAt", "dateTime", "time", "date"], 0);
      const aDate = parseDate(aRaw);
      const bDate = parseDate(bRaw);
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

  // --------------------------------------------------------------------------
  // Sidebar / Hamburger
  // --------------------------------------------------------------------------
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

    sidebar.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMenu);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 1100) closeMenu();
    });
  }

  // --------------------------------------------------------------------------
  // Profile dropdown
  // --------------------------------------------------------------------------
  if (profileBtn && profileMenu) {
    profileBtn.setAttribute("aria-expanded", "false");

    profileBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = profileMenu.classList.toggle("open");
      profileBtn.setAttribute("aria-expanded", String(isOpen));
    });

    profileMenu.addEventListener("click", (event) => event.stopPropagation());

    document.addEventListener("click", () => {
      profileMenu.classList.remove("open");
      profileBtn.setAttribute("aria-expanded", "false");
    });
  }

  // --------------------------------------------------------------------------
  // Logout
  // --------------------------------------------------------------------------
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      const confirmed = window.confirm("Are you sure you want to end your current session?");
      if (!confirmed) return;

      try {
        if (window.firebase?.auth) {
          await firebase.auth().signOut();
        }
      } catch (error) {
        console.warn("Firebase sign-out was not completed:", error);
      } finally {
        window.location.href = "login.html";
      }
    });
  }

  // --------------------------------------------------------------------------
  // Smooth anchor scrolling
  // --------------------------------------------------------------------------
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const targetId = link.getAttribute("href");
      if (!targetId || targetId === "#") return;

      const targetElement = document.querySelector(targetId);
      if (!targetElement) return;

      event.preventDefault();
      targetElement.scrollIntoView({ behavior: "smooth", block: "start" });

      if (history.replaceState) {
        history.replaceState(null, "", targetId);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Scroll-to-top
  // --------------------------------------------------------------------------
  const updateScrollToTopButton = () => {
    if (!scrollToTopBtn) return;
    scrollToTopBtn.classList.toggle("visible", window.scrollY > 300);
  };

  window.addEventListener("scroll", updateScrollToTopButton, { passive: true });

  if (scrollToTopBtn) {
    scrollToTopBtn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  updateScrollToTopButton();

  // --------------------------------------------------------------------------
  // Reveal animations
  // --------------------------------------------------------------------------
  const runScrollReveal = () => {
    const triggerHeight = window.innerHeight - 50;
    document.querySelectorAll(".reveal").forEach((element) => {
      if (element.getBoundingClientRect().top < triggerHeight) {
        element.classList.add("show");
      }
    });
  };

  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("show");
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -50px 0px", threshold: 0.05 });

    document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));
  } else {
    window.addEventListener("scroll", runScrollReveal, { passive: true });
    runScrollReveal();
  }

  // --------------------------------------------------------------------------
  // Active navigation
  // --------------------------------------------------------------------------
  const highlightActiveNavigation = () => {
    const anchors = document.querySelectorAll(".nav-links a");
    const sections = document.querySelectorAll("section[id], footer[id]");
    const scrollPosition = window.scrollY + 160;
    let activeId = "";

    sections.forEach((section) => {
      if (section.offsetTop <= scrollPosition) activeId = section.id;
    });

    anchors.forEach((anchor) => {
      const isActive = anchor.getAttribute("href") === `#${activeId}`;
      anchor.classList.toggle("active", isActive);
      anchor.setAttribute("aria-current", isActive ? "page" : "false");
    });
  };

  window.addEventListener("scroll", highlightActiveNavigation, { passive: true });
  highlightActiveNavigation();

  // --------------------------------------------------------------------------
  // Firebase connection status
  // --------------------------------------------------------------------------
  const setFirebaseStatus = (online) => {
    if (!firebaseStatusIndicator || !firebaseStatusText) return;

    firebaseStatusIndicator.classList.toggle("online", online);
    firebaseStatusIndicator.classList.toggle("offline", !online);
    firebaseStatusText.textContent = online
      ? "Firebase Realtime Database Connected"
      : "Firebase Realtime Database Offline";
  };

  // --------------------------------------------------------------------------
  // Visitors
  // --------------------------------------------------------------------------
  const renderVisitors = (records) => {
    if (!visitorRecentList) return;

    const newest = sortNewest(records).slice(0, 5);
    visitorCache = records;

    if (!newest.length) {
      visitorRecentList.innerHTML = `
        <div class="visitor-item">\n          <div class="visitor-info">\n            <h4>No visitor records yet</h4>\n            <p>Visitor activity from Firebase will appear here automatically.</p>\n          </div>\n        </div>`;
    } else {
      visitorRecentList.innerHTML = newest.map((visitor) => {
        const name = getFirstValue(visitor, ["name", "fullName", "visitorName"], "Unknown Visitor");
        const office = getFirstValue(visitor, ["office", "organization", "company", "agency"], "Office/Organization");
        const purpose = getFirstValue(visitor, ["purpose", "reason", "visitPurpose"], "General Inquiry");
        const status = String(getFirstValue(visitor, ["status", "visitStatus"], "Checked In"));
        const checkedIn = /checked.?in|active|inside/i.test(status);
        const statusClass = checkedIn ? "active" : "completed";
        const statusLabel = escapeHtml(status || (checkedIn ? "Checked In" : "Checked Out"));

        return `
          <div class="visitor-item">
            <div class="visitor-avatar">${escapeHtml(initials(name))}</div>
            <div class="visitor-info">
              <h4>${escapeHtml(name)}</h4>
              <p>${escapeHtml(office)} • ${escapeHtml(purpose)}</p>
            </div>
            <div class="visitor-meta">
              <span class="visitor-time">${escapeHtml(formatTime(visitor))}</span>
              <span class="badge-status ${statusClass}">
                ${checkedIn ? '<span class="status-dot"></span>' : ''}
                ${statusLabel}
              </span>
            </div>
          </div>`;
      }).join("");
    }

    const totalToday = records.filter(isToday).length;
    if (todayVisitorsTotal) {
      todayVisitorsTotal.textContent = `${totalToday} Total Visitors Today`;
    }

    if (window.lucide) lucide.createIcons();
  };

  // --------------------------------------------------------------------------
  // Memos
  // --------------------------------------------------------------------------
  const renderMemos = (records) => {
    if (!memoGrid) return;

    const pinned = records
      .filter((memo) => String(getFirstValue(memo, ["pinned", "isPinned"], true)).toLowerCase() !== "false")
      .sort((a, b) => {
        const ap = String(getFirstValue(a, ["priority", "priorityLevel"], "standard")).toLowerCase();
        const bp = String(getFirstValue(b, ["priority", "priorityLevel"], "standard")).toLowerCase();
        return (ap === "high" ? -1 : 1) - (bp === "high" ? -1 : 1);
      })
      .slice(0, 6);

    if (!pinned.length) {
      memoGrid.innerHTML = `
        <div class="memo-card reveal show">
          <div class="memo-body">
            <h3>No pinned memorandums</h3>
            <p>Add memo records under the Firebase <strong>${escapeHtml(DB_PATHS.memos)}</strong> node to display them here.</p>
          </div>
        </div>`;
      return;
    }

    memoGrid.innerHTML = pinned.map((memo) => {
      const title = getFirstValue(memo, ["title", "subject", "memoTitle"], "Untitled Memorandum");
      const description = getFirstValue(memo, ["description", "content", "summary", "body"], "No memo description provided.");
      const code = getFirstValue(memo, ["code", "memoCode", "referenceNo", "reference"], "MEMO");
      const priority = getFirstValue(memo, ["priority", "priorityLevel", "category"], "Administrative");
      const issuedDate = getFirstValue(memo, ["issuedDate", "dateIssued", "date"], "—");
      const issuedBy = getFirstValue(memo, ["issuedBy", "author", "department", "from"], "Office Administration");
      const target = getFirstValue(memo, ["target", "audience", "targetAudience"], "All Personnel");
      const detailsUrl = getFirstValue(memo, ["detailsUrl", "url", "link"], "#");
      const downloadUrl = getFirstValue(memo, ["downloadUrl", "fileUrl", "documentUrl"], "");
      const isHigh = String(priority).toLowerCase() === "high";
      const priorityClass = isHigh ? "high" : String(priority).toLowerCase().replace(/\s+/g, "-");

      return `
        <div class="memo-card pinned reveal show">
          <div class="memo-header">
            <div class="memo-badge-group">
              <span class="memo-pinned-tag"><i data-lucide="pin"></i> Pinned Memo</span>
              <span class="memo-code">${escapeHtml(code)}</span>
            </div>
            <span class="priority-tag ${escapeHtml(priorityClass)}">${escapeHtml(priority)}</span>
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
              <a class="btn-icon-action" title="Download Document" href="${escapeHtml(downloadUrl)}" target="_blank" rel="noopener">
                <i data-lucide="download"></i>
              </a>` : `
              <button class="btn-icon-action" title="No document attached" type="button" disabled>
                <i data-lucide="download"></i>
              </button>`}
          </div>
        </div>`;
    }).join("");

    if (window.lucide) lucide.createIcons();
  };

  // --------------------------------------------------------------------------
  // Document flow chart
  // --------------------------------------------------------------------------
  const normalizeFlow = (value) => {
    if (!value || typeof value !== "object") return null;

    // Supports:
    // /documentFlow/{May:{incoming:54,outgoing:38}, ...}
    // /documentFlow/{labels:[...], incoming:[...], outgoing:[...]}
    const labels = Array.isArray(value.labels)
      ? value.labels
      : Array.isArray(value.months)
      ? value.months
      : null;

    if (labels) {
      return {
        labels,
        incoming: Array.isArray(value.incoming)
          ? value.incoming
          : Array.isArray(value.incomingDocuments)
          ? value.incomingDocuments
          : [],
        outgoing: Array.isArray(value.outgoing)
          ? value.outgoing
          : Array.isArray(value.outgoingReleases)
          ? value.outgoingReleases
          : []
      };
    }

    const entries = Object.entries(value)
      .filter(([, item]) => item && typeof item === "object" && !Array.isArray(item))
      .map(([label, item]) => ({
        label,
        incoming: Number(getFirstValue(item, ["incoming", "incomingDocuments", "inbound"], 0)) || 0,
        outgoing: Number(getFirstValue(item, ["outgoing", "outgoingReleases", "outbound"], 0)) || 0
      }));

    if (!entries.length) return null;

    return {
      labels: entries.map((entry) => entry.label),
      incoming: entries.map((entry) => entry.incoming),
      outgoing: entries.map((entry) => entry.outgoing)
    };
  };

  const renderSystemChart = (flow = null) => {
    if (!window.Chart) return;

    const canvas = $("#commCompareChart");
    if (!canvas) return;

    if (commCompareChartInstance) {
      commCompareChartInstance.destroy();
      commCompareChartInstance = null;
    }

    const dataset = flow || latestFlowData || {
      labels: ["May", "Jun", "Jul", "Aug", "Sep", "Oct"],
      incoming: [0, 0, 0, 0, 0, 0],
      outgoing: [0, 0, 0, 0, 0, 0]
    };

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const gridColor = "rgba(15, 107, 61, 0.04)";
    const textColor = "#5e7264";
    const brandColorPrimary = "#0f6b3d";
    const brandColorSecondary = "#46b86b";

    const gradientIncoming = ctx.createLinearGradient(0, 0, 0, 260);
    gradientIncoming.addColorStop(0, "rgba(15, 107, 61, 0.12)");
    gradientIncoming.addColorStop(1, "rgba(15, 107, 61, 0.0)");

    const gradientOutgoing = ctx.createLinearGradient(0, 0, 0, 260);
    gradientOutgoing.addColorStop(0, "rgba(70, 184, 107, 0.08)");
    gradientOutgoing.addColorStop(1, "rgba(70, 184, 107, 0.0)");

    commCompareChartInstance = new Chart(canvas, {
      type: "line",
      data: {
        labels: dataset.labels,
        datasets: [
          {
            label: "Incoming Documents",
            data: dataset.incoming,
            borderColor: brandColorPrimary,
            backgroundColor: gradientIncoming,
            fill: true,
            tension: 0.35,
            borderWidth: 3,
            pointBackgroundColor: brandColorPrimary,
            pointHoverRadius: 6
          },
          {
            label: "Outgoing Releases",
            data: dataset.outgoing,
            borderColor: brandColorSecondary,
            backgroundColor: gradientOutgoing,
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointBackgroundColor: brandColorSecondary,
            pointHoverRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            labels: {
              color: textColor,
              usePointStyle: true,
              boxWidth: 8,
              font: { weight: "600", family: "Plus Jakarta Sans", size: 11 }
            }
          },
          tooltip: {
            backgroundColor: "#09170f",
            padding: 12,
            titleColor: "#ffffff",
            bodyColor: "#ffffff"
          }
        },
        scales: {
          x: {
            ticks: { color: textColor, font: { family: "Plus Jakarta Sans", size: 10 } },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: textColor,
              font: { family: "Plus Jakarta Sans", size: 10 },
              precision: 0
            },
            grid: { color: gridColor }
          }
        }
      }
    });
  };

  // --------------------------------------------------------------------------
  // Firebase listeners
  // --------------------------------------------------------------------------
  const startFirebase = () => {
    if (!window.PGENRO_FIREBASE?.db) {
      setFirebaseStatus(false);
      console.error("PGENRO Firebase database is unavailable.");
      return;
    }

    const db = window.PGENRO_FIREBASE.db;

    db.ref(".info/connected").on("value", (snapshot) => {
      setFirebaseStatus(snapshot.val() === true);
    });

    db.ref(DB_PATHS.visitors).on("value", (snapshot) => {
      renderVisitors(normalizeRecords(snapshot.val()));
    }, (error) => {
      console.error("Visitor listener failed:", error);
      renderVisitors([]);
    });

    db.ref(DB_PATHS.memos).on("value", (snapshot) => {
      renderMemos(normalizeRecords(snapshot.val()));
    }, (error) => {
      console.error("Memo listener failed:", error);
      renderMemos([]);
    });

    db.ref(DB_PATHS.documentFlow).on("value", (snapshot) => {
      const flow = normalizeFlow(snapshot.val());
      if (flow) {
        latestFlowData = flow;
        renderSystemChart(flow);
      } else {
        renderSystemChart();
      }
    }, (error) => {
      console.error("Document flow listener failed:", error);
      renderSystemChart();
    });
  };

  // Initial chart plus live Firebase listeners.
  renderSystemChart();
  startFirebase();

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => renderSystemChart(), 150);
  });
});
