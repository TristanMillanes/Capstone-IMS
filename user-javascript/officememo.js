// Database State: Empty Base
let memoDataset = JSON.parse(localStorage.getItem("officeMemos")) || [];

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();

  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const mainContent = document.getElementById("mainContent");

  if (hamburgerMenu && sidebar && overlay && mainContent) {
    hamburgerMenu.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      overlay.classList.toggle("active");
      mainContent.classList.toggle("blur");
    });

    overlay.addEventListener("click", () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("active");
      mainContent.classList.remove("blur");
    });
  }

  const searchInput = document.getElementById("searchInput");
  if (searchInput) searchInput.addEventListener("input", renderTable);

  const closeViewModalBtn = document.getElementById("closeViewModalBtn");
  const cancelViewModalBtn = document.getElementById("cancelViewModalBtn");

  if (closeViewModalBtn) closeViewModalBtn.addEventListener("click", closeViewModal);
  if (cancelViewModalBtn) cancelViewModalBtn.addEventListener("click", closeViewModal);

  renderTable();
  updateKPIs();
});

function renderTable() {
  const tbody = document.getElementById("memoTableBody");
  if (!tbody) return;

  const searchVal = document.getElementById("searchInput")?.value.toLowerCase() || "";
  tbody.innerHTML = "";

  const filtered = memoDataset.filter(item => 
    (item.subject || "").toLowerCase().includes(searchVal) ||
    (item.id || "").toLowerCase().includes(searchVal) ||
    (item.target || "").toLowerCase().includes(searchVal)
  );

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--text-muted);">No memorandums found in database.</td></tr>`;
    return;
  }

  filtered.forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="memo-code-badge">${item.id || "-"}</span></td>
      <td>${item.date || "-"}</td>
      <td><strong style="color:var(--primary-dark); font-size:12px;">${item.target || "-"}</strong></td>
      <td class="memo-subject-cell">${item.subject || "-"}</td>
      <td><span style="font-size:12px; color:var(--text);">${item.receivedBy || "-"}</span></td>
      <td style="text-align: center;">
        <button class="action-btn" onclick="openViewModal(${index})" title="View Attachment">
          <i data-lucide="eye"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (window.lucide) lucide.createIcons();
}

function updateKPIs() {
  const kpiTotal = document.getElementById("kpiTotal");
  const kpiPinned = document.getElementById("kpiPinned");

  if (kpiTotal) kpiTotal.textContent = memoDataset.length;
  if (kpiPinned) kpiPinned.textContent = memoDataset.filter(m => m.pinned).length;
}

window.openViewModal = function(index) {
  const memo = memoDataset[index];
  if (!memo) return;

  const pdfFrame = document.getElementById("pdfFrame");
  const noPdfMessage = document.getElementById("noPdfMessage");
  const headerTitle = document.getElementById("viewModalHeaderTitle");

  if (headerTitle) headerTitle.textContent = `${memo.id || "Memo"} - Document Viewer`;

  if (memo.fileUrl && pdfFrame) {
    pdfFrame.style.display = "block";
    pdfFrame.src = memo.fileUrl;
    if (noPdfMessage) noPdfMessage.classList.add("hidden");
  } else if (pdfFrame) {
    pdfFrame.style.display = "none";
    pdfFrame.src = "";
    if (noPdfMessage) noPdfMessage.classList.remove("hidden");
  }

  document.getElementById("viewMemoModal").classList.add("open");
};

function closeViewModal() {
  document.getElementById("viewMemoModal").classList.remove("open");
}

// Hook for database integration
window.loadDatabaseMemos = function(dbMemos) {
  memoDataset = dbMemos || [];
  renderTable();
  updateKPIs();
};