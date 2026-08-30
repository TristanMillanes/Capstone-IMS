document.addEventListener("DOMContentLoaded", () => {
  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const mainContent = document.querySelector(".main-content");
  const tableBody = document.getElementById("travelOrderTable");

  // Database State: Empty Base
  let travelOrders = JSON.parse(localStorage.getItem("travelOrders")) || [];

  if (window.lucide) lucide.createIcons();

  if (hamburgerMenu && sidebar && overlay) {
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

  function renderTable() {
    if (!tableBody) return;
    tableBody.innerHTML = "";

    if (travelOrders.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding: 24px; color: var(--muted); font-weight:700;">
            No travel orders found in database.
          </td>
        </tr>
      `;
      return;
    }

    travelOrders.forEach(order => {
      const statusClass = (order.status || "Pending").toLowerCase();
      tableBody.innerHTML += `
        <tr>
          <td><strong>${order.toNumber || "-"}</strong></td>
          <td>${order.travelerName || "-"}</td>
          <td>${order.destination || "-"}</td>
          <td>${order.startDate || ""} to ${order.endDate || ""}</td>
          <td>${order.travelType || "Local"}</td>
          <td><span class="status-pill status-${statusClass}">${order.status || "Pending"}</span></td>
        </tr>
      `;
    });

    // Update Counters
    document.getElementById("metricTotal").textContent = travelOrders.length;
    document.getElementById("metricPending").textContent = travelOrders.filter(t => t.status === "Pending").length;
    document.getElementById("metricApproved").textContent = travelOrders.filter(t => t.status === "Approved").length;

    if (window.lucide) lucide.createIcons();
  }

  // Hook for database integration
  window.loadDatabaseTravelOrders = function(dbOrders) {
    travelOrders = dbOrders || [];
    renderTable();
  };

  renderTable();
});