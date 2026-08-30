/**
 * =========================================================================
 * PGENRO IMS - ENTERPRISE ADMIN DASHBOARD CONTROLLER
 * =========================================================================
 * 
 * DATABASE ARCHITECTURE & SCHEMA NOTES FOR METRICS & CHARTS:
 *
 * 1. "office_memos" (Collection)
 *    - Fields: { memoNo: string, title: string, issuedBy: string, date: string, createdAt: timestamp }
 *    - Used by: Memo Stream Widget, Monthly Line Chart, Category Distribution.
 *
 * 2. "user_auth_logs" (Collection)
 *    - Fields: { 
 *        userName: string, 
 *        userEmail: string, 
 *        userInitials: string, 
 *        activity: "User Login" | "User Logout" | "Session Timeout", 
 *        role: string, 
 *        ipAddress: string, 
 *        sessionStatus: "Success" | "Terminated" | "Failed", 
 *        statusType: "success" | "info" | "urgent", 
 *        timestamp: timestamp 
 *      }
 *    - Used by: User Login & Logout Audit Trail Table & CSV Export.
 *
 * 3. "employees" (Collection)
 *    - Fields: { fullName: string, position: string, division: string, createdAt: timestamp }
 *    - Used by: Registered Personnel KPI & Category Chart.
 *
 * 4. "account_requests" (Collection)
 *    - Fields: { status: "pending" | "approved" | "rejected", userEmail: string }
 *    - Used by: Pending Account Requests KPI & Sidebar Badges.
 *
 * 5. "ics_records" (Collection)
 *    - Fields: { icsNo: string, itemDescription: string, status: "Active" | "Archived", createdAt: timestamp }
 *    - Used by: Active ICS Slips KPI & Line Chart.
 *
 * 6. "inventory" (Collection)
 *    - Fields: { itemName: string, quantity: number, threshold: number }
 *    - Used by: Low Supply Items KPI (quantity <= threshold).
 *
 * 7. "service_requests" (Collection)
 *    - Fields: { title: string, status: "Pending Review" | "In Progress" | "Completed / Closed" | "Archived", createdAt: timestamp }
 *    - Used by: Service Status Chart & Sidebar Badges.
 * =========================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  // =========================================================================
  // 1. FIREBASE CONFIGURATION
  // =========================================================================
  const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_FIREBASE_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_FIREBASE_PROJECT_ID",
    storageBucket: "YOUR_FIREBASE_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
    appId: "YOUR_FIREBASE_APP_ID"
  };

  let db = null;
  let firebaseInitialized = false;

  try {
    if (typeof firebase !== "undefined" && firebase.apps.length === 0) {
      firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      firebaseInitialized = true;
      updateDbStatusUI(true, "Firebase Connected (0-Baseline)");
    } else if (typeof firebase !== "undefined" && firebase.apps.length > 0) {
      db = firebase.firestore();
      firebaseInitialized = true;
      updateDbStatusUI(true, "Firebase Connected (0-Baseline)");
    }
  } catch (err) {
    console.warn("Firebase initialized in offline mode.", err);
    updateDbStatusUI(false, "Offline / Database Disconnected");
  }

  // =========================================================================
  // 2. CHART INSTANCES & DATA STATE (ALL 0 BASELINE)
  // =========================================================================
  let monthlyChartInstance = null;
  let categoryChartInstance = null;
  let statusChartInstance = null;

  let currentAuthLogs = []; // Stores auth logs for search & CSV export

  const liveStats = {
    memosPerMonth: Array(12).fill(0),
    commsPerMonth: Array(12).fill(0),
    icsPerMonth: Array(12).fill(0),
    totalMemos: 0,
    totalComms: 0,
    totalTravelOrders: 0,
    totalEmployees: 0,
    totalVisitors: 0,
    totalSupplies: 0,
    totalServices: 0,
    serviceStatusCounts: {
      "Completed / Closed": 0,
      "In Progress": 0,
      "Pending Review": 0,
      "Archived": 0
    }
  };

  // UI Indicator helper
  function updateDbStatusUI(isOnline, message) {
    const statusDot = document.getElementById("dbStatusDot");
    const statusText = document.getElementById("dbStatusText");

    if (statusDot) {
      statusDot.className = isOnline ? "status-dot online" : "status-dot offline";
    }
    if (statusText) {
      statusText.textContent = message || (isOnline ? "Connected" : "Disconnected");
    }
  }

  // DOM Elements
  const profileBtn = document.getElementById("profileBtn");
  const profileMenu = document.getElementById("profileMenu");
  const notificationsBtn = document.getElementById("notificationsBtn");
  const notificationDropdown = document.getElementById("notificationDropdown");
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const sidebar = document.getElementById("sidebar");
  const tableSearchInput = document.getElementById("tableSearchInput");
  const selectAllRows = document.getElementById("selectAllRows");
  const globalSearchInput = document.getElementById("globalSearchInput");
  const exportCsvBtn = document.getElementById("exportCsvBtn");

  // Profile & Notification Dropdown Toggles
  if (profileBtn && profileMenu) {
    profileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("open");
      if (notificationDropdown) notificationDropdown.classList.remove("open");
    });
  }

  if (notificationsBtn && notificationDropdown) {
    notificationsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      notificationDropdown.classList.toggle("open");
      if (profileMenu) profileMenu.classList.remove("open");
    });
  }

  document.addEventListener("click", () => {
    if (profileMenu) profileMenu.classList.remove("open");
    if (notificationDropdown) notificationDropdown.classList.remove("open");
  });

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to sign out of PGENRO IMS?")) {
        window.location.href = "../User/login.html";
      }
    });
  }

  if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      sidebar.classList.toggle("mobile-open");
    });
  }

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (globalSearchInput) globalSearchInput.focus();
    }
  });

  if (selectAllRows) {
    selectAllRows.addEventListener("change", (e) => {
      const rowCheckboxes = document.querySelectorAll(".row-checkbox");
      rowCheckboxes.forEach((cb) => (cb.checked = e.target.checked));
    });
  }

  // Live Table Search Filter
  if (tableSearchInput) {
    tableSearchInput.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase().trim();
      const rows = document.querySelectorAll("#auditTableBody tr:not(.empty-row)");

      rows.forEach((row) => {
        const rowText = row.textContent.toLowerCase();
        row.style.display = rowText.includes(term) ? "" : "none";
      });
    });
  }

  // Update Dynamic Counter Value
  function updateCounter(elementId, count) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = Number(count || 0).toLocaleString();
  }

  // =========================================================================
  // 3. INITIALIZE CHARTS (0 BASELINE)
  // =========================================================================
  function initCharts() {
    if (!window.Chart) return;

    // 1. Monthly Line Chart
    const monthlyCtx = document.getElementById("monthlyChart")?.getContext("2d");
    if (monthlyCtx) {
      monthlyChartInstance = new Chart(monthlyCtx, {
        type: "line",
        data: {
          labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
          datasets: [
            {
              label: "Office Memos",
              data: Array(12).fill(0),
              borderColor: "#059669",
              fill: false,
              tension: 0.4,
              borderWidth: 2
            },
            {
              label: "Communications Log",
              data: Array(12).fill(0),
              borderColor: "#3b82f6",
              fill: false,
              tension: 0.4,
              borderWidth: 2
            },
            {
              label: "ICS Slips Issued",
              data: Array(12).fill(0),
              borderColor: "#6366f1",
              fill: false,
              tension: 0.4,
              borderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "top", labels: { font: { family: "Plus Jakarta Sans", weight: "700" }, color: "#64748b" } }
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#64748b" } },
            y: { grid: { color: "#e2e8f0" }, ticks: { color: "#64748b" }, beginAtZero: true }
          }
        }
      });
    }

    // 2. Category Doughnut Chart
    const categoryCtx = document.getElementById("categoryChart")?.getContext("2d");
    if (categoryCtx) {
      categoryChartInstance = new Chart(categoryCtx, {
        type: "doughnut",
        data: {
          labels: ["Memos & Comms", "Travel Orders", "Personnel Directory", "Visitors Log", "Supplies & ICS", "Service Requests"],
          datasets: [
            {
              data: [0, 0, 0, 0, 0, 0],
              backgroundColor: ["#059669", "#0d9488", "#3b82f6", "#f59e0b", "#6366f1", "#f97316"],
              borderWidth: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "72%",
          plugins: {
            legend: { position: "bottom", labels: { font: { family: "Plus Jakarta Sans", weight: "700" }, color: "#64748b", padding: 10 } }
          }
        }
      });
    }

    // 3. Service Requests & Status Chart
    const statusCtx = document.getElementById("statusChart")?.getContext("2d");
    if (statusCtx) {
      statusChartInstance = new Chart(statusCtx, {
        type: "bar",
        data: {
          labels: ["Completed / Closed", "In Progress", "Pending Review", "Archived"],
          datasets: [
            {
              data: [0, 0, 0, 0],
              backgroundColor: ["#059669", "#3b82f6", "#f59e0b", "#94a3b8"],
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#64748b" } },
            y: { grid: { color: "#e2e8f0" }, ticks: { color: "#64748b" }, beginAtZero: true }
          }
        }
      });
    }
  }

  // =========================================================================
  // 4. REAL-TIME DATABASE LISTENERS
  // =========================================================================
  function attachRealtimeDatabaseListeners() {
    if (!firebaseInitialized || !db) return;

    const getMonthIndex = (docData) => {
      if (!docData.createdAt && !docData.date) return new Date().getMonth();
      const timestamp = docData.createdAt || docData.date;
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return isNaN(date.getMonth()) ? new Date().getMonth() : date.getMonth();
    };

    // 1. OFFICE MEMOS (STREAM WIDGET & CHARTS)
    db.collection("office_memos").orderBy("createdAt", "desc").onSnapshot((snapshot) => {
      const memos = [];
      const monthlyMemos = Array(12).fill(0);

      if (snapshot) {
        liveStats.totalMemos = snapshot.size;
        snapshot.forEach((doc) => {
          const data = doc.data();
          memos.push({ id: doc.id, ...data });
          const m = getMonthIndex(data);
          monthlyMemos[m] += 1;
        });
      }

      liveStats.memosPerMonth = monthlyMemos;
      renderMemoStream(memos);
      updateMonthlyChart();
      updateCategoryChart();
    });

    // 2. USER AUTH AUDIT TRAIL (LOGIN / LOGOUT)
    db.collection("user_auth_logs").orderBy("timestamp", "desc").limit(50).onSnapshot((snapshot) => {
      currentAuthLogs = [];
      if (snapshot) {
        snapshot.forEach((doc) => currentAuthLogs.push({ id: doc.id, ...doc.data() }));
      }
      renderAuthLogs(currentAuthLogs);
    });

    // 3. EMPLOYEES
    db.collection("employees").onSnapshot((snapshot) => {
      const count = snapshot ? snapshot.size : 0;
      liveStats.totalEmployees = count;
      updateCounter("kpiPersonnel", count);
      updateCategoryChart();
    });

    // 4. ACCOUNT REQUESTS
    db.collection("account_requests").where("status", "==", "pending").onSnapshot((snapshot) => {
      const pendingCount = snapshot ? snapshot.size : 0;
      updateCounter("kpiPendingAcc", pendingCount);
      const pendingBadge = document.getElementById("sidebarPendingAccBadge");
      if (pendingBadge) pendingBadge.textContent = `${pendingCount} New`;
    });

    // 5. ICS RECORDS
    db.collection("ics_records").onSnapshot((snapshot) => {
      const count = snapshot ? snapshot.size : 0;
      updateCounter("kpiActiveICS", count);
      
      const monthlyIcs = Array(12).fill(0);
      if (snapshot) {
        snapshot.forEach((doc) => {
          const m = getMonthIndex(doc.data());
          monthlyIcs[m] += 1;
        });
      }
      liveStats.icsPerMonth = monthlyIcs;
      updateMonthlyChart();
      updateCategoryChart();
    });

    // 6. INVENTORY
    db.collection("inventory").onSnapshot((snapshot) => {
      let lowStockTotal = 0;
      let totalItems = 0;

      if (snapshot) {
        totalItems = snapshot.size;
        snapshot.forEach((doc) => {
          const data = doc.data();
          const qty = Number(data.quantity) || 0;
          const minThreshold = Number(data.threshold) || 10;
          if (qty <= minThreshold) {
            lowStockTotal++;
          }
        });
      }
      liveStats.totalSupplies = totalItems;
      updateCounter("kpiLowStock", lowStockTotal);
      updateCategoryChart();
    });

    // 7. COMMUNICATIONS
    db.collection("communications").onSnapshot((snapshot) => {
      const monthlyComms = Array(12).fill(0);
      if (snapshot) {
        liveStats.totalComms = snapshot.size;
        snapshot.forEach((doc) => {
          const m = getMonthIndex(doc.data());
          monthlyComms[m] += 1;
        });
      }
      liveStats.commsPerMonth = monthlyComms;
      updateMonthlyChart();
      updateCategoryChart();
    });

    // 8. TRAVEL ORDERS & VISITORS
    db.collection("travel_orders").onSnapshot((snapshot) => {
      liveStats.totalTravelOrders = snapshot ? snapshot.size : 0;
      updateCategoryChart();
    });

    db.collection("visitors_log").onSnapshot((snapshot) => {
      liveStats.totalVisitors = snapshot ? snapshot.size : 0;
      updateCategoryChart();
    });

    // 9. SERVICE REQUESTS
    db.collection("service_requests").onSnapshot((snapshot) => {
      const statusCounts = {
        "Completed / Closed": 0,
        "In Progress": 0,
        "Pending Review": 0,
        "Archived": 0
      };
      let openCount = 0;

      if (snapshot) {
        liveStats.totalServices = snapshot.size;
        snapshot.forEach((doc) => {
          const data = doc.data();
          const s = data.status || "Pending Review";
          if (statusCounts[s] !== undefined) {
            statusCounts[s] += 1;
          } else {
            statusCounts["Pending Review"] += 1;
          }

          if (s === "Pending Review" || s === "In Progress") {
            openCount++;
          }
        });
      }

      liveStats.serviceStatusCounts = statusCounts;
      const openServicesBadge = document.getElementById("sidebarOpenServicesBadge");
      if (openServicesBadge) openServicesBadge.textContent = `${openCount} Open`;

      updateStatusChart();
      updateCategoryChart();
    });
  }

  // --- CHART RE-RENDER HELPERS ---
  function updateMonthlyChart() {
    if (!monthlyChartInstance) return;
    monthlyChartInstance.data.datasets[0].data = liveStats.memosPerMonth;
    monthlyChartInstance.data.datasets[1].data = liveStats.commsPerMonth;
    monthlyChartInstance.data.datasets[2].data = liveStats.icsPerMonth;
    monthlyChartInstance.update();
  }

  function updateCategoryChart() {
    if (!categoryChartInstance) return;
    categoryChartInstance.data.datasets[0].data = [
      liveStats.totalMemos + liveStats.totalComms,
      liveStats.totalTravelOrders,
      liveStats.totalEmployees,
      liveStats.totalVisitors,
      liveStats.totalSupplies,
      liveStats.totalServices
    ];
    categoryChartInstance.update();
  }

  function updateStatusChart() {
    if (!statusChartInstance) return;
    statusChartInstance.data.datasets[0].data = [
      liveStats.serviceStatusCounts["Completed / Closed"],
      liveStats.serviceStatusCounts["In Progress"],
      liveStats.serviceStatusCounts["Pending Review"],
      liveStats.serviceStatusCounts["Archived"]
    ];
    statusChartInstance.update();
  }

  // =========================================================================
  // 5. RENDER MEMO STREAM WIDGET
  // =========================================================================
  function renderMemoStream(memos) {
    const memoContainer = document.getElementById("memoStreamList");
    const countLabel = document.getElementById("memosTotalCountLabel");
    if (!memoContainer) return;

    if (countLabel) {
      countLabel.textContent = `${memos.length} Memos Recorded`;
    }

    if (!memos || memos.length === 0) {
      memoContainer.innerHTML = `<div class="empty-table-cell">No memos recorded in database.</div>`;
      return;
    }

    memoContainer.innerHTML = memos.slice(0, 5).map(memo => {
      let formattedDate = "Recent";
      if (memo.createdAt || memo.date) {
        const d = (memo.createdAt && memo.createdAt.toDate) ? memo.createdAt.toDate() : new Date(memo.createdAt || memo.date);
        formattedDate = !isNaN(d.getTime()) ? d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "Recent";
      }

      return `
        <div class="memo-stream-item">
          <div class="memo-stream-info">
            <span class="memo-stream-title">${memo.memoNo ? `[${memo.memoNo}] ` : ''}${memo.title || memo.subject || 'Office Memorandum'}</span>
            <span class="memo-stream-meta">${memo.issuedBy ? `By: ${memo.issuedBy} • ` : ''}${formattedDate}</span>
          </div>
          <a href="../User/officememo.html" class="icon-btn-sm" title="View Memo Details"><i data-lucide="external-link"></i></a>
        </div>
      `;
    }).join("");

    if (window.lucide) lucide.createIcons();
  }

  // =========================================================================
  // 6. RENDER USER AUTH (LOGIN / LOGOUT) AUDIT TRAIL TABLE
  // =========================================================================
  function renderAuthLogs(logs) {
    const tbody = document.getElementById("auditTableBody");
    const paginationInfo = document.getElementById("tablePaginationInfo");
    if (!tbody) return;

    if (!logs || logs.length === 0) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7" class="empty-table-cell">No login/logout activity recorded in database.</td></tr>`;
      if (paginationInfo) paginationInfo.textContent = "Showing 0 to 0 of 0 log entries";
      return;
    }

    tbody.innerHTML = logs.map(log => {
      let formattedTime = "Recently";
      if (log.timestamp) {
        const d = log.timestamp.toDate ? log.timestamp.toDate() : new Date(log.timestamp);
        formattedTime = !isNaN(d.getTime()) ? d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Recently";
      }

      const isLogin = (log.activity || "").toLowerCase().includes("login");
      const activityBadge = isLogin ? "badge-status success" : "badge-status info";

      return `
        <tr>
          <td><input type="checkbox" class="row-checkbox" /></td>
          <td class="text-muted">${formattedTime}</td>
          <td>
            <div class="user-cell">
              <div class="avatar-sm">${(log.userInitials || log.userName || 'U').substring(0, 2).toUpperCase()}</div>
              <div>
                <strong>${log.userName || 'System User'}</strong>
                <small>${log.userEmail || ''}</small>
              </div>
            </div>
          </td>
          <td><span class="${activityBadge}"><span class="dot"></span> ${log.activity || 'User Login'}</span></td>
          <td><span class="table-tag">${log.role || log.division || 'PGENRO Staff'}</span></td>
          <td class="font-mono">${log.ipAddress || '127.0.0.1'}</td>
          <td><span class="badge-status ${log.statusType || 'success'}">${log.sessionStatus || 'Success'}</span></td>
        </tr>
      `;
    }).join("");

    if (paginationInfo) {
      paginationInfo.textContent = `Showing 1 to ${logs.length} of ${logs.length} log entries`;
    }

    if (window.lucide) lucide.createIcons();
  }

  // =========================================================================
  // 7. EXPORT CSV GENERATOR
  // =========================================================================
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      if (!currentAuthLogs || currentAuthLogs.length === 0) {
        alert("No authentication logs available to export.");
        return;
      }

      const headers = ["Timestamp", "User Name", "Email", "Activity", "Role / Division", "IP Address", "Status"];
      const csvRows = [headers.join(",")];

      currentAuthLogs.forEach(log => {
        let timeStr = "";
        if (log.timestamp) {
          const d = log.timestamp.toDate ? log.timestamp.toDate() : new Date(log.timestamp);
          timeStr = !isNaN(d.getTime()) ? d.toISOString() : "";
        }

        const row = [
          `"${timeStr}"`,
          `"${log.userName || ''}"`,
          `"${log.userEmail || ''}"`,
          `"${log.activity || ''}"`,
          `"${log.role || log.division || ''}"`,
          `"${log.ipAddress || ''}"`,
          `"${log.sessionStatus || 'Success'}"`
        ];
        csvRows.push(row.join(","));
      });

      const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `PGENRO_Auth_Audit_Trail_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  // Initialize
  initCharts();
  attachRealtimeDatabaseListeners();
});