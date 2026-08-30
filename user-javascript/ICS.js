document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();

  // Database State: Empty Base
  let records = JSON.parse(localStorage.getItem("icsRecords")) || [];

  const tableBody = document.getElementById("slipTableBody");
  const tableSearchInput = document.getElementById("tableSearchInput");
  const filterStatusSelect = document.getElementById("filterStatusSelect");

  const statTotalSlips = document.getElementById("statTotalSlips");
  const statIssuedItems = document.getElementById("statIssuedItems");
  const statPendingReturn = document.getElementById("statPendingReturn");

  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const mainContent = document.getElementById("mainContent");

  if (hamburgerMenu && sidebar && overlay && mainContent) {
    hamburgerMenu.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      hamburgerMenu.classList.toggle("active");
      overlay.classList.toggle("active");
      mainContent.classList.toggle("blur");
    });

    overlay.addEventListener("click", () => {
      sidebar.classList.remove("open");
      hamburgerMenu.classList.remove("active");
      overlay.classList.remove("active");
      mainContent.classList.remove("blur");
    });
  }

  function renderRecords() {
    if (!tableBody) return;

    const query = tableSearchInput?.value.toLowerCase().trim() || "";
    const statusFilter = filterStatusSelect?.value || "ALL";

    const filtered = records.filter((item) => {
      const matchSearch =
        (item.slipNo || "").toLowerCase().includes(query) ||
        (item.custodian || "").toLowerCase().includes(query) ||
        (item.itemDesc || "").toLowerCase().includes(query) ||
        (item.officeUnit || "").toLowerCase().includes(query);

      const matchStatus = statusFilter === "ALL" || item.status === statusFilter;
      return matchSearch && matchStatus;
    });

    tableBody.innerHTML = "";

    if (filtered.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">
            No custodian slips recorded in database.
          </td>
        </tr>
      `;
    } else {
      filtered.forEach((item) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td><strong style="color:var(--primary);">${item.slipNo || "-"}</strong></td>
          <td>
            <strong style="color:var(--primary-dark);">${item.custodian || "-"}</strong>
            <br><small style="color:var(--text-muted);">${item.officeUnit || "-"}</small>
          </td>
          <td>
            ${item.itemDesc || "-"} 
            <br><small style="font-weight:700;color:var(--text-muted);">Qty: ${item.quantity || 1}</small>
          </td>
          <td>
            <span class="status-pill ${(item.status || "Issued").toLowerCase()}">${item.status || "Issued"}</span>
          </td>
          <td><small style="color: var(--text-muted);">${item.notes || "-"}</small></td>
        `;
        tableBody.appendChild(row);
      });
    }

    if (statTotalSlips) statTotalSlips.textContent = records.length;
    if (statIssuedItems) {
      statIssuedItems.textContent = records.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    }
    if (statPendingReturn) {
      statPendingReturn.textContent = records.filter((item) => item.status === "Pending").length;
    }

    if (window.lucide) lucide.createIcons();
  }

  if (tableSearchInput) tableSearchInput.addEventListener("input", renderRecords);
  if (filterStatusSelect) filterStatusSelect.addEventListener("change", renderRecords);

  // Hook for database integration
  window.loadDatabaseICS = function(dbRecords) {
    records = dbRecords || [];
    renderRecords();
  };

  renderRecords();
});