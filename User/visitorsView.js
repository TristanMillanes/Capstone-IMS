document.addEventListener("DOMContentLoaded", () => {
  // 1. Initializations
  if (window.lucide) lucide.createIcons();

  // DOM Elements
  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const searchInput = document.getElementById("visitorSearch");
  const purposeFilter = document.getElementById("purposeFilter");
  const statusFilter = document.getElementById("statusFilter");
  const visitorTableBody = document.getElementById("visitorTableBody");
  const emptyState = document.getElementById("emptyState");

  // Summary Metrics
  const summaryTotal = document.getElementById("summaryTotal");
  const summaryToday = document.getElementById("summaryToday");
  const summaryInside = document.getElementById("summaryInside");
  const todayDateStr = document.getElementById("todayDateStr");
  const liveClock = document.getElementById("liveClock");

  // Slide Drawer Elements
  const detailDrawer = document.getElementById("detailDrawer");
  const closeDrawerBtn = document.getElementById("closeDrawerBtn");
  const toggleCheckoutBtn = document.getElementById("toggleCheckoutBtn");
  const printPassBtn = document.getElementById("printPassBtn");

  // Pagination Elements
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");
  const pageIndicator = document.getElementById("pageIndicator");
  const showingCountText = document.getElementById("showingCountText");

  // Storage & State
  const storageKey = "pgenro_visitors";
  let visitors = [];
  let selectedVisitor = null;
  let activeDateFilter = "all"; // "all" | "today" | "week"
  let currentPage = 1;
  const rowsPerPage = 10;

  // Live Clock & Current Date display
  function updateLiveClock() {
    const now = new Date();
    if (liveClock) {
      liveClock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    if (todayDateStr) {
      todayDateStr.textContent = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
  }
  setInterval(updateLiveClock, 1000);
  updateLiveClock();

  // Sidebar Controls
  if (hamburgerMenu && sidebar && overlay) {
    hamburgerMenu.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      hamburgerMenu.classList.toggle("active");
      overlay.classList.toggle("active");
    });

    overlay.addEventListener("click", () => {
      sidebar.classList.remove("open");
      hamburgerMenu.classList.remove("active");
      closeDrawer();
      overlay.classList.remove("active");
    });
  }

  // Load Database (Firebase with sample fallback)
  function loadVisitors() {
    if (window.firebaseDB) {
      const ref = window.firebaseDB.ref("visitors");
      ref.on("value", (snapshot) => {
        const data = snapshot.val() || {};
        visitors = Object.keys(data).map(key => ({ ...data[key], _id: key }));
        ensureSampleData();
        render();
      }, (err) => {
        console.warn("Firebase Read Failed, loading local storage:", err);
        fallbackLocalData();
      });
    } else {
      fallbackLocalData();
    }
  }

  function fallbackLocalData() {
    visitors = JSON.parse(localStorage.getItem(storageKey)) || [];
    ensureSampleData();
    render();
  }

  // Inject friendly mock data if list is completely empty
  function ensureSampleData() {
    if (visitors.length === 0) {
      const todayStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      visitors = [
        {
          _id: "demo_1",
          fullName: "Engr. Maria Santos",
          contact: "+63 917 482 9102",
          address: "Brgy. Poblacion, Provincial Capitol",
          personToVisit: "PGENRO Dept Head",
          purposeCategory: "Environmental Concerns - Water Quality",
          date: todayStr,
          time: "09:30 AM",
          status: "inside",
          timeOut: null
        },
        {
          _id: "demo_2",
          fullName: "Juan Dela Cruz Jr.",
          contact: "+63 920 112 3456",
          address: "LGU San Jose Environment Office",
          personToVisit: "Solid Waste Div.",
          purposeCategory: "Technical Assistance - WACS",
          date: todayStr,
          time: "10:15 AM",
          status: "inside",
          timeOut: null
        },
        {
          _id: "demo_3",
          fullName: "Dr. Roberto Aquino",
          contact: "+63 908 554 9918",
          address: "Batangas State University",
          personToVisit: "IEC Unit Head",
          purposeCategory: "Request for Speaker",
          date: "May 12, 2025",
          time: "02:00 PM",
          status: "completed",
          timeOut: "04:15 PM"
        }
      ];
      localStorage.setItem(storageKey, JSON.stringify(visitors));
    }
  }

  // Helpers
  function getInitials(name) {
    if (!name) return "??";
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0].toUpperCase())
      .join("");
  }

  function getPurposeTagClass(purpose) {
    if (!purpose) return "tag-gray";
    if (purpose.includes("Speaker")) return "tag-purple";
    if (purpose.includes("Water Quality")) return "tag-blue";
    if (purpose.includes("Technical")) return "tag-orange";
    if (purpose.includes("Information") || purpose.includes("I.E.C")) return "tag-green";
    return "tag-gray";
  }

  // Filter Logic
  function getFilteredVisitors() {
    const search = searchInput.value.trim().toLowerCase();
    const purpose = purposeFilter.value;
    const status = statusFilter.value;

    const todayStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    return visitors.filter((visitor) => {
      // Search matches
      const text = [
        visitor.fullName,
        visitor.contact,
        visitor.address,
        visitor.personToVisit,
        visitor.purposeCategory
      ].join(" ").toLowerCase();
      const searchMatch = !search || text.includes(search);

      // Purpose filter
      const purposeMatch = purpose === "all" || visitor.purposeCategory === purpose;

      // Status filter
      const visitorStatus = visitor.status || "inside";
      const statusMatch = status === "all" || visitorStatus === status;

      // Date chips
      let dateMatch = true;
      if (activeDateFilter === "today") {
        dateMatch = visitor.date === todayStr;
      } else if (activeDateFilter === "week") {
        const visitDate = new Date(visitor.date);
        dateMatch = !isNaN(visitDate) && visitDate >= oneWeekAgo;
      }

      return searchMatch && purposeMatch && statusMatch && dateMatch;
    });
  }

  // Metric Counter
  function updateMetrics() {
    const todayStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const todayCount = visitors.filter(item => item.date === todayStr).length;
    const insideCount = visitors.filter(item => (item.status || "inside") === "inside").length;

    summaryTotal.textContent = visitors.length;
    summaryToday.textContent = todayCount;
    summaryInside.textContent = insideCount;
  }

  // Render Table
  function renderTable(list) {
    visitorTableBody.innerHTML = "";
    const totalRecords = list.length;
    const totalPages = Math.ceil(totalRecords / rowsPerPage) || 1;

    // Boundary adjust
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * rowsPerPage;
    const pageRecords = list.slice(startIdx, startIdx + rowsPerPage);

    showingCountText.textContent = totalRecords 
      ? `Showing ${startIdx + 1} - ${Math.min(startIdx + rowsPerPage, totalRecords)} of ${totalRecords} visitors`
      : "No records found";

    pageIndicator.textContent = `${currentPage} / ${totalPages}`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;

    if (!pageRecords.length) {
      emptyState.classList.remove("hidden");
      return;
    }

    emptyState.classList.add("hidden");

    pageRecords.forEach((visitor) => {
      const row = document.createElement("tr");
      if (selectedVisitor && selectedVisitor._id === visitor._id) {
        row.classList.add("selected-row");
      }

      const isInside = (visitor.status || "inside") === "inside";
      const initials = getInitials(visitor.fullName);
      const tagClass = getPurposeTagClass(visitor.purposeCategory);

      row.innerHTML = `
        <td>
          <div class="visitor-profile-cell">
            <div class="table-avatar">${initials}</div>
            <div class="profile-meta">
              <strong>${visitor.fullName || "Anonymous Guest"}</strong>
              <span>${visitor.address || "Address unspecified"}</span>
            </div>
          </div>
        </td>
        <td>
          <div style="font-weight: 700; color: var(--dark);">${visitor.contact || "No Contact"}</div>
        </td>
        <td>
          <span class="dept-pill">${visitor.personToVisit || "General Personnel"}</span>
        </td>
        <td>
          <span class="tag-badge ${tagClass}">${visitor.purposeCategory || "General Inquiry"}</span>
        </td>
        <td>
          <div style="font-weight: 700; font-size: 13px;">${visitor.time || "--:--"}</div>
          <small style="color: var(--muted); font-size: 11px;">${visitor.date || ""}</small>
        </td>
        <td>
          <span class="status-pill ${isInside ? 'status-inside' : 'status-completed'}">
            ${isInside ? "In Building" : "Checked Out"}
          </span>
        </td>
        <td style="text-align: right;">
          <button class="btn-view-row" title="Open details">
            <i data-lucide="chevron-right"></i>
          </button>
        </td>
      `;

      row.addEventListener("click", () => openDrawer(visitor));
      visitorTableBody.appendChild(row);
    });

    if (window.lucide) lucide.createIcons();
  }

  // Open & Populate Slide Drawer
  function openDrawer(visitor) {
    selectedVisitor = visitor;

    document.getElementById("drawerName").textContent = visitor.fullName || "Guest Details";
    document.getElementById("drawerFullname").textContent = visitor.fullName || "—";
    document.getElementById("drawerAvatar").textContent = getInitials(visitor.fullName);
    document.getElementById("drawerContact").textContent = visitor.contact || "—";
    document.getElementById("drawerAddress").textContent = visitor.address || "—";
    document.getElementById("drawerPerson").textContent = visitor.personToVisit || "—";
    document.getElementById("drawerPurpose").textContent = visitor.purposeCategory || "—";
    document.getElementById("drawerTimeIn").textContent = visitor.time || "—";
    document.getElementById("drawerDate").textContent = visitor.date || "—";
    document.getElementById("drawerTimeOut").textContent = visitor.timeOut || "Still in Premises";

    const isInside = (visitor.status || "inside") === "inside";
    const statusBadge = document.getElementById("drawerStatusBadge");

    if (isInside) {
      statusBadge.textContent = "Currently Inside";
      statusBadge.style.background = "#dcfce7";
      statusBadge.style.color = "#15803d";
      toggleCheckoutBtn.innerHTML = `<i data-lucide="log-out"></i> Log Departure`;
      toggleCheckoutBtn.className = "btn btn-success";
    } else {
      statusBadge.textContent = "Signed Out";
      statusBadge.style.background = "#f1f5f9";
      statusBadge.style.color = "#64748b";
      toggleCheckoutBtn.innerHTML = `<i data-lucide="rotate-ccw"></i> Re-open Visit`;
      toggleCheckoutBtn.className = "btn btn-secondary";
    }

    detailDrawer.classList.add("open");
    overlay.classList.add("active");
    if (window.lucide) lucide.createIcons();
  }

  function closeDrawer() {
    detailDrawer.classList.remove("open");
    overlay.classList.remove("active");
  }

  closeDrawerBtn.addEventListener("click", closeDrawer);

  // Toggle Departure / Check-in State
  toggleCheckoutBtn.addEventListener("click", () => {
    if (!selectedVisitor) return;

    const isInside = (selectedVisitor.status || "inside") === "inside";
    const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    selectedVisitor.status = isInside ? "completed" : "inside";
    selectedVisitor.timeOut = isInside ? nowTime : null;

    // Sync state locally
    const idx = visitors.findIndex(v => v._id === selectedVisitor._id);
    if (idx !== -1) visitors[idx] = selectedVisitor;
    localStorage.setItem(storageKey, JSON.stringify(visitors));

    // Sync to Firebase if available
    if (window.firebaseDB && selectedVisitor._id) {
      window.firebaseDB.ref(`visitors/${selectedVisitor._id}`).update({
        status: selectedVisitor.status,
        timeOut: selectedVisitor.timeOut
      });
    }

    openDrawer(selectedVisitor);
    render();
  });

  // Print Visitor Pass Action
  printPassBtn.addEventListener("click", () => {
    if (!selectedVisitor) return;
    const printWindow = window.open("", "_blank", "width=600,height=600");
    printWindow.document.write(`
      <html>
        <head>
          <title>Visitor Pass - ${selectedVisitor.fullName}</title>
          <style>
            body { font-family: sans-serif; padding: 30px; text-align: center; }
            .pass-card { border: 2px dashed #0f6b3d; padding: 25px; border-radius: 12px; }
            h2 { color: #0f6b3d; margin-bottom: 5px; }
            .meta { font-size: 14px; color: #555; margin-bottom: 20px; }
            .field { text-align: left; margin: 10px 0; border-bottom: 1px solid #eee; padding-bottom: 5px; }
            .field label { font-size: 11px; text-transform: uppercase; color: #777; font-weight: bold; }
            .field div { font-size: 16px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="pass-card">
            <h2>PGENRO VISITOR PASS</h2>
            <div class="meta">Provincial Environmental & Natural Resources Office</div>
            <div class="field"><label>Visitor Name</label><div>${selectedVisitor.fullName}</div></div>
            <div class="field"><label>Visiting Dept / Host</label><div>${selectedVisitor.personToVisit}</div></div>
            <div class="field"><label>Purpose</label><div>${selectedVisitor.purposeCategory}</div></div>
            <div class="field"><label>Date / Time In</label><div>${selectedVisitor.date} @ ${selectedVisitor.time}</div></div>
            <p style="margin-top: 25px; font-size: 12px; color: #888;">Please wear this badge visibly while inside premises.</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  });

  // Export CSV Feature
  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    const list = getFilteredVisitors();
    if (!list.length) return alert("No visitors to export.");

    const headers = ["Full Name", "Contact", "Address", "Host Dept", "Purpose", "Date", "Time In", "Time Out", "Status"];
    const rows = list.map(v => [
      `"${v.fullName || ''}"`,
      `"${v.contact || ''}"`,
      `"${v.address || ''}"`,
      `"${v.personToVisit || ''}"`,
      `"${v.purposeCategory || ''}"`,
      `"${v.date || ''}"`,
      `"${v.time || ''}"`,
      `"${v.timeOut || ''}"`,
      `"${v.status || 'inside'}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `PGENRO_Visitors_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // Refresh Sync
  document.getElementById("refreshBtn").addEventListener("click", () => {
    loadVisitors();
  });

  // Date Range Quick Filter Chips
  document.querySelectorAll(".date-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".date-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeDateFilter = chip.getAttribute("data-range");
      currentPage = 1;
      render();
    });
  });

  // Pagination Controls
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      render();
    }
  });

  nextPageBtn.addEventListener("click", () => {
    currentPage++;
    render();
  });

  // Listeners for Live Filtering
  searchInput.addEventListener("input", () => { currentPage = 1; render(); });
  purposeFilter.addEventListener("change", () => { currentPage = 1; render(); });
  statusFilter.addEventListener("change", () => { currentPage = 1; render(); });

  function render() {
    const filtered = getFilteredVisitors();
    updateMetrics();
    renderTable(filtered);
  }

  // Kickstart
  loadVisitors();
});