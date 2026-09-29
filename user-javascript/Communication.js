document.addEventListener("DOMContentLoaded", () => {
  // Initialize Lucide Icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // DOM Elements Selection
  const overlay = document.getElementById("overlay");
  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const sidebar = document.getElementById("sidebar");
  const mainContent = document.getElementById("mainContent");
  const profileMenu = document.getElementById("profileMenu");
  const profileBtn = document.getElementById("profileBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const scrollToTopBtn = document.getElementById("scrollToTopBtn");

  const viewModal = document.getElementById("viewModal");
  const viewModalClose = document.getElementById("viewModalClose");

  // Database State: Communication Records
  let records = window.PGENRO_SUPABASE?.configured ? [] : (() => { try { const rows = JSON.parse(localStorage.getItem("communicationRecords") || "[]"); return Array.isArray(rows) ? rows : []; } catch { return []; } })();
  let currentFilter = "All";

  // Sidebar Menu Interaction
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
      if (!viewModal?.classList.contains("open")) {
        overlay.classList.remove("active");
        mainContent.classList.remove("blur");
      }
    };

    hamburgerMenu.addEventListener("click", toggleMenu);
    overlay.addEventListener("click", () => {
      if (viewModal?.classList.contains("open")) {
        viewModal.classList.remove("open");
      }
      closeMenu();
    });

    const sidebarAnchors = sidebar.querySelectorAll("a");
    sidebarAnchors.forEach((link) => {
      link.addEventListener("click", closeMenu);
    });
  }

  // Profile Dropdown Toggle
  if (profileBtn && profileMenu) {
    profileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("open");
    });
  }

  document.addEventListener("click", () => {
    profileMenu?.classList.remove("open");
  });

  // Logout Trigger
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

  // Modal Close Action
  if (viewModalClose) {
    viewModalClose.addEventListener("click", () => {
      viewModal.classList.remove("open");
      if (!sidebar?.classList.contains("open")) {
        overlay.classList.remove("active");
        mainContent.classList.remove("blur");
      }
    });
  }

  // Scroll Reveal Animation
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

  // Scroll to top
  window.addEventListener("scroll", () => {
    if (scrollToTopBtn) {
      if (window.scrollY > 300) {
        scrollToTopBtn.classList.add("visible");
      } else {
        scrollToTopBtn.classList.remove("visible");
      }
    }
  });

  if (scrollToTopBtn) {
    scrollToTopBtn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Display Records in Table
  window.displayRecords = function () {
    const table = document.getElementById("recordsTable");
    const searchInput = document.getElementById("searchInput");
    const statusFilter = document.getElementById("statusFilter");

    if (!table) return;

    const search = (searchInput?.value || "").toLowerCase();
    const status = statusFilter?.value || "All";

    table.innerHTML = "";

    const filteredRecords = records.filter((record) => {
      const matchesType = currentFilter === "All" || record.type === currentFilter;
      const matchesStatus = status === "All" || record.status === status;

      const matchesSearch =
        (record.controlNo || "").toLowerCase().includes(search) ||
        (record.subject || "").toLowerCase().includes(search) ||
        (record.office || "").toLowerCase().includes(search) ||
        (record.documentType || "").toLowerCase().includes(search);

      return matchesType && matchesStatus && matchesSearch;
    });

    if (filteredRecords.length === 0) {
      table.innerHTML = `
        <tr>
          <td colspan="7" class="empty">No matching records found in database.</td>
        </tr>
      `;
      return;
    }

    filteredRecords.forEach((record) => {
      const originalIndex = records.indexOf(record);
      table.innerHTML += `
        <tr>
          <td>
            <strong>${record.controlNo || "-"}</strong><br>
            <small>${record.type || ""} • ${record.documentType || ""}</small>
          </td>
          <td>${record.date || "-"}</td>
          <td>${record.office || "-"}</td>
          <td>${record.subject || "-"}</td>
          <td>${record.dateForwarded || "-"}</td>
          <td><span class="badge-status ${record.status || "Pending"}">${record.status || "Pending"}</span></td>
          <td style="text-align: center;">
            <button class="btn-icon-action" onclick="openRecordView(${originalIndex})" title="Inspect Details" type="button">
              <i data-lucide="eye"></i>
            </button>
          </td>
        </tr>
      `;
    });

    if (window.lucide) lucide.createIcons();
  };

  // Inspect Modal Open
  window.openRecordView = function (index) {
    const record = records[index];
    if (!record) return;

    document.getElementById("viewControlNo").value = record.controlNo || "";
    document.getElementById("viewType").value = record.type || "";
    document.getElementById("viewDocType").value = record.documentType || "";
    document.getElementById("viewStatus").value = record.status || "";
    document.getElementById("viewOffice").value = record.office || "";
    document.getElementById("viewSubject").value = record.subject || "";
    document.getElementById("viewDateForwarded").value = record.dateForwarded || "";
    document.getElementById("viewOcrText").value = record.ocrText || "No text data available.";

    viewModal.classList.add("open");
    overlay.classList.add("active");
    mainContent.classList.add("blur");

    if (window.lucide) lucide.createIcons();
  };

  // Tab Filtering
  window.setFilter = function (type, button) {
    currentFilter = type;
    document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    displayRecords();
  };

  // Update Metrics Dashboard
  function updateDashboard() {
    const totalEl = document.getElementById("totalRecords");
    const incomingEl = document.getElementById("incomingCount");
    const outgoingEl = document.getElementById("outgoingCount");
    const pendingEl = document.getElementById("pendingCount");

    if (totalEl) totalEl.textContent = records.length;
    if (incomingEl) incomingEl.textContent = records.filter((r) => r.type === "Incoming").length;
    if (outgoingEl) outgoingEl.textContent = records.filter((r) => r.type === "Outgoing").length;
    if (pendingEl) pendingEl.textContent = records.filter((r) => r.status === "Pending").length;
  }

  // Hook for Database Data Ingestion
  window.loadDatabaseRecords = function (dbRecords) {
    records = dbRecords || [];
    displayRecords();
    updateDashboard();
  };

  // Run on Initial Load
  displayRecords();
  updateDashboard();
});