// Initializing DOM Elements
const form = document.getElementById("inventoryForm");
const formModal = document.getElementById("formModal");
const openEncodingBtn = document.getElementById("openEncodingBtn");
const formModalClose = document.getElementById("formModalClose");
const overlay = document.getElementById("overlay");
const hamburgerMenu = document.getElementById("hamburgerMenu");
const sidebar = document.getElementById("sidebar");
const mainContent = document.querySelector(".main-content");

// Form Inputs
const inputId = document.getElementById("itemId");
const inputName = document.getElementById("itemName");
const inputUnit = document.getElementById("itemUnit");
const inputDesc = document.getElementById("itemDesc");
const inputQty = document.getElementById("itemQty");
const inputUsed = document.getElementById("itemUsed");
const inputBalance = document.getElementById("itemBalance");
const inputThreshold = document.getElementById("itemThreshold");
const inputRemarks = document.getElementById("itemRemarks");
const editIndexInput = document.getElementById("editIndex");

// Report Elements
const generateReportBtn = document.getElementById("generateReportBtn");
const reportModal = document.getElementById("reportModal");
const reportModalClose = document.getElementById("reportModalClose");
const cancelReportBtn = document.getElementById("cancelReportBtn");
const reportTableBody = document.getElementById("reportTableBody");
const reportSelectAll = document.getElementById("reportSelectAll");
const confirmPrintBtn = document.getElementById("confirmPrintBtn");

// LocalStorage Integration
let inventoryRecords = JSON.parse(localStorage.getItem("inventoryRecords")) || [];
let currentFilter = "All";

// Initialize Lucide Icons
function reloadIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}
reloadIcons();

/* ==========================================================================
   TOAST SYSTEM (Non-disruptive feedback alerts)
   ========================================================================== */
function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  let iconName = "check-circle";
  if (type === "error") iconName = "alert-circle";
  if (type === "warning") iconName = "alert-triangle";

  toast.innerHTML = `
    <i data-lucide="${iconName}" style="width: 18px; height: 18px;"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  reloadIcons();

  // Fade out and remove
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => {
      toast.remove();
    }, 200);
  }, 3500);
}

/* ==========================================================================
   INPUT LOGIC & VALIDATIONS
   ========================================================================== */

// Auto Calculate Balance dynamically + Prevent invalid inputs
function calculateBalance() {
  const qty = Math.max(0, parseInt(inputQty.value) || 0);
  let used = Math.max(0, parseInt(inputUsed.value) || 0);

  // Prevent consumption exceeding initial quantities
  if (used > qty) {
    used = qty;
    inputUsed.value = used;
    showToast("Consumption cannot exceed current stock quantity", "warning");
  }

  inputBalance.value = qty - used;
}
inputQty.addEventListener("input", calculateBalance);
inputUsed.addEventListener("input", calculateBalance);

// Generate Unique Control No / ID
function generateControlNumber() {
  const year = new Date().getFullYear();
  const count = inventoryRecords.length + 1;
  return `ITEM-${year}-${String(count).padStart(4, "0")}`;
}

/* ==========================================================================
   MODALS & ACCESSIBILITY UX
   ========================================================================== */

// Close Modals dynamically on Escape key press
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeEncodingModal();
    closeReportModal();
  }
});

function openEncodingModal() {
  clearForm();
  document.getElementById("formTitle").textContent = "Encode Inventory Record";
  document.getElementById("submitBtn").textContent = "Save Record";
  inputId.value = generateControlNumber(); 

  formModal.classList.add("open");
  overlay.classList.add("active");
  
  // Accessibility Focus Trap start
  setTimeout(() => inputName.focus(), 80);
  reloadIcons();
}

function closeEncodingModal() {
  formModal.classList.remove("open");
  if (!sidebar.classList.contains("open") && !reportModal.classList.contains("open")) {
    overlay.classList.remove("active");
    mainContent.classList.remove("blur");
  }
}

openEncodingBtn.addEventListener("click", openEncodingModal);
formModalClose.addEventListener("click", closeEncodingModal);

// Hamburger Logic
hamburgerMenu.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  hamburgerMenu.classList.toggle("active");
  overlay.classList.toggle("active");
  mainContent.classList.toggle("blur");
});

overlay.addEventListener("click", () => {
  formModal.classList.remove("open");
  reportModal.classList.remove("open");
  sidebar.classList.remove("open");
  hamburgerMenu.classList.remove("active");
  overlay.classList.remove("active");
  mainContent.classList.remove("blur");
});

/* ==========================================================================
   CRUD SUBMIT LOGIC
   ========================================================================== */
form.addEventListener("submit", function(e) {
  e.preventDefault();

  const editIndex = editIndexInput.value;
  const qtyVal = Math.max(0, parseInt(inputQty.value) || 0);
  const usedVal = Math.max(0, parseInt(inputUsed.value) || 0);
  const balanceVal = qtyVal - usedVal;
  const alertThreshold = Math.max(0, parseInt(inputThreshold.value) || 5);

  // Status mapping
  let status = "In-Stock";
  if (balanceVal <= 0) {
    status = "Out-of-Stock";
  } else if (balanceVal <= alertThreshold) {
    status = "Low-Stock";
  }

  const record = {
    itemId: inputId.value,
    name: inputName.value.trim().toUpperCase(),
    unit: inputUnit.value.trim().toUpperCase(),
    desc: inputDesc.value.trim(),
    qty: qtyVal,
    used: usedVal,
    balance: balanceVal,
    threshold: alertThreshold,
    remarks: inputRemarks.value.trim(),
    status: status
  };

  if (editIndex === "") {
    inventoryRecords.push(record);
    showToast("Inventory item encoded successfully.");
  } else {
    inventoryRecords[editIndex] = record;
    showToast("Inventory item updated successfully.");
  }

  localStorage.setItem("inventoryRecords", JSON.stringify(inventoryRecords));

  clearForm();
  closeEncodingModal();
  displayRecords();
  updateDashboard();
});

function clearForm() {
  form.reset();
  editIndexInput.value = "";
  inputId.value = "";
  inputThreshold.value = "5";
  document.getElementById("formTitle").textContent = "Encode Inventory Record";
  document.getElementById("submitBtn").textContent = "Save Record";
}

/* ==========================================================================
   RENDER TABLE DATA (With Progress Stocks)
   ========================================================================== */
function displayRecords() {
  const table = document.getElementById("recordsTable");
  const search = document.getElementById("searchInput").value.toLowerCase();

  table.innerHTML = "";

  const filteredRecords = inventoryRecords.filter(record => {
    const matchesFilter = currentFilter === "All" || record.status === currentFilter;
    const matchesSearch =
      (record.itemId || "").toLowerCase().includes(search) ||
      (record.name || "").toLowerCase().includes(search) ||
      (record.desc || "").toLowerCase().includes(search);

    return matchesFilter && matchesSearch;
  });

  if (filteredRecords.length === 0) {
    table.innerHTML = `<tr><td colspan="7" class="empty">No inventory records found matching criteria.</td></tr>`;
    return;
  }

  filteredRecords.forEach((record) => {
    const originalIndex = inventoryRecords.indexOf(record);

    // Calculate Stock Health Bar metrics
    const fillPercent = record.qty > 0 ? Math.min(100, Math.round((record.balance / record.qty) * 100)) : 0;
    
    let barColorClass = "normal";
    if (record.status === "Low-Stock") barColorClass = "warning";
    if (record.status === "Out-of-Stock") barColorClass = "critical";

    table.innerHTML += `
      <tr>
        <td><strong>${record.itemId}</strong></td>
        <td>
          <strong>${record.name}</strong>
          <small>${record.unit} ${record.desc ? `| ${record.desc}` : ''}</small>
        </td>
        <td>${record.qty}</td>
        <td>${record.used}</td>
        <td>
          <div class="stock-bar-container">
            <span class="badge ${record.status}">${record.balance}</span>
            <div class="stock-bar" title="${fillPercent}% remaining">
              <div class="stock-bar-fill ${barColorClass}" style="width: ${fillPercent}%;"></div>
            </div>
          </div>
        </td>
        <td>${record.remarks || "-"}</td>
        <td>
          <div class="action-group">
            <button class="action-btn edit" onclick="editRecord(${originalIndex})" title="Edit Item Details">
              <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
            </button>
            <button class="action-btn delete" onclick="deleteRecord(${originalIndex})" title="Remove Item Record">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  reloadIcons();
}

// Edit Record Logic
window.editRecord = function(index) {
  const record = inventoryRecords[index];

  editIndexInput.value = index;
  inputId.value = record.itemId;
  inputName.value = record.name;
  inputUnit.value = record.unit;
  inputDesc.value = record.desc || "";
  inputQty.value = record.qty;
  inputUsed.value = record.used;
  inputBalance.value = record.balance;
  inputThreshold.value = record.threshold || 5;
  inputRemarks.value = record.remarks || "";

  document.getElementById("formTitle").textContent = "Edit Inventory Record";
  document.getElementById("submitBtn").textContent = "Update Record";

  formModal.classList.add("open");
  overlay.classList.add("active");
  setTimeout(() => inputName.focus(), 80);
}

// Delete Record Logic
window.deleteRecord = function(index) {
  if (confirm("Are you sure you want to delete this inventory item? This action is irreversible.")) {
    inventoryRecords.splice(index, 1);
    localStorage.setItem("inventoryRecords", JSON.stringify(inventoryRecords));
    displayRecords();
    updateDashboard();
    showToast("Inventory item deleted.", "warning");
  }
}

// Tab Filter switching
window.setFilter = function(type, button) {
  currentFilter = type;
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  button.classList.add("active");
  displayRecords();
}

/* ==========================================================================
   DASHBOARD METRICS & REAL-TIME COUNTERS
   ========================================================================== */
function updateDashboard() {
  let totalQty = 0;
  let lowStock = 0;
  let outOfStock = 0;
  let inStock = 0;

  inventoryRecords.forEach(record => {
    // Determine status actively
    const currentThreshold = record.threshold || 5;
    if (record.balance <= 0) {
      outOfStock++;
      record.status = "Out-of-Stock";
    } else if (record.balance <= currentThreshold) {
      lowStock++;
      record.status = "Low-Stock";
    } else {
      inStock++;
      record.status = "In-Stock";
    }
    totalQty += record.balance;
  });

  // Top metric counters
  document.getElementById("statTotalItems").textContent = inventoryRecords.length;
  document.getElementById("statTotalQty").textContent = totalQty;
  document.getElementById("statLowStock").textContent = lowStock;
  document.getElementById("statOutOfStock").textContent = outOfStock;

  // Dynamic filter counters
  document.getElementById("countAll").textContent = inventoryRecords.length;
  document.getElementById("countInStock").textContent = inStock;
  document.getElementById("countLowStock").textContent = lowStock;
  document.getElementById("countOutOfStock").textContent = outOfStock;
}

/* ==========================================================================
   REPORT MODAL & SECURE PRINTING ENGINE
   ========================================================================== */

// Open Report Modal
generateReportBtn.addEventListener("click", () => {
  const search = document.getElementById("searchInput").value.toLowerCase();
  
  const filteredItems = inventoryRecords.filter(record => {
    const matchesFilter = currentFilter === "All" || record.status === currentFilter;
    const matchesSearch =
      (record.itemId || "").toLowerCase().includes(search) ||
      (record.name || "").toLowerCase().includes(search) ||
      (record.desc || "").toLowerCase().includes(search);
    return matchesFilter && matchesSearch;
  });

  if (filteredItems.length === 0) {
    showToast("No printable records found matching filter.", "error");
    return;
  }

  reportTableBody.innerHTML = "";
  reportSelectAll.checked = false;

  filteredItems.forEach((record) => {
    const originalIndex = inventoryRecords.indexOf(record);
    
    reportTableBody.innerHTML += `
      <tr>
        <td class="checkbox-cell">
          <input type="checkbox" class="report-item-checkbox" value="${originalIndex}">
        </td>
        <td><strong>${record.itemId}</strong></td>
        <td>${record.name}</td>
        <td><span class="badge ${record.status}">${record.balance}</span></td>
      </tr>
    `;
  });

  reportModal.classList.add("open");
  overlay.classList.add("active");
  reloadIcons();
});

// Close Report Modal
function closeReportModal() {
  reportModal.classList.remove("open");
  if (!sidebar.classList.contains("open") && !formModal.classList.contains("open")) {
    overlay.classList.remove("active");
    mainContent.classList.remove("blur");
  }
}
reportModalClose.addEventListener("click", closeReportModal);
cancelReportBtn.addEventListener("click", closeReportModal);

// Select All inside printing modal
reportSelectAll.addEventListener("change", function(e) {
  const checkboxes = document.querySelectorAll(".report-item-checkbox");
  checkboxes.forEach(cb => cb.checked = e.target.checked);
});

// Confirm and execute native Landscape Print Layout
confirmPrintBtn.addEventListener("click", () => {
  const selectedCheckboxes = document.querySelectorAll('.report-item-checkbox:checked');
  let itemsToPrint = [];

  if (selectedCheckboxes.length === 0) {
    showToast("Please choose at least one item to prepare print layout.", "error");
    return;
  }

  selectedCheckboxes.forEach(cb => {
    const index = cb.value;
    itemsToPrint.push(inventoryRecords[index]);
  });

  const printWindow = window.open('', '_blank');
  
  let tableRows = '';
  itemsToPrint.forEach(record => {
    let balanceStyle = record.balance <= 0 ? 'color: #d9383a; font-weight: bold;' : '';
    tableRows += `
      <tr>
        <td>${record.itemId}</td>
        <td><strong>${record.name}</strong></td>
        <td>${record.unit}</td>
        <td>${record.desc || '-'}</td>
        <td style="text-align: center;">${record.qty}</td>
        <td style="text-align: center;">${record.used}</td>
        <td style="text-align: center; ${balanceStyle}">${record.balance}</td>
        <td>${record.remarks || '-'}</td>
      </tr>
    `;
  });

  const printHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Inventory Report - PGENRO</title>
      <style>
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
          padding: 30px; 
          color: #111; 
          background-color: #fff;
        }
        
        .header-container { 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          margin-bottom: 25px; 
          position: relative; 
          min-height: 90px;
        }
        
        .left-logo { 
          width: 80px; 
          height: auto; 
          position: absolute; 
          left: 40px; 
        }
        
        .right-logo { 
          width: 85px; 
          height: auto; 
          position: absolute; 
          right: 40px; 
        }
        
        .header-text { text-align: center; }
        .header-text h3 { margin: 0; font-size: 13px; font-weight: normal; text-transform: uppercase; letter-spacing: 0.5px; }
        .header-text h2 { margin: 4px 0; font-size: 17px; font-weight: bold; color: #0f6b3d; }
        .header-text h4 { margin: 0; font-size: 12px; font-weight: normal; font-style: italic; color: #444; }
        
        .report-title-container { text-align: center; margin-top: 30px; margin-bottom: 25px; }
        .report-title { 
          font-size: 18px; 
          font-weight: 800; 
          text-transform: uppercase; 
          border-bottom: 2px solid #0f6b3d; 
          display: inline-block; 
          padding-bottom: 4px; 
          color: #084b2a;
        }
        
        table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
        th, td { border: 1px solid #bbb; padding: 8px 10px; text-align: left; }
        th { background-color: #f3f9f5; color: #084b2a; font-weight: bold; text-transform: uppercase; font-size: 11px; }
        
        .date-printed { margin-top: 25px; font-size: 11px; color: #555; text-align: right; }
        
        /* Government-style Signatures/Approval blocks */
        .signatures-section {
          margin-top: 50px;
          display: flex;
          justify-content: space-between;
          font-size: 13px;
        }
        .signature-block {
          width: 250px;
          text-align: center;
        }
        .signature-line {
          margin-top: 45px;
          border-top: 1px solid #111;
          font-weight: bold;
          padding-top: 5px;
          text-transform: uppercase;
        }
        .signature-title {
          font-size: 11px;
          color: #555;
          margin-top: 2px;
        }

        @media print {
          @page { margin: 1.2cm; size: landscape; }
          body { -webkit-print-color-adjust: exact; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header-container">
        <img src="../logo/Quezonlogo.png" class="left-logo" alt="Quezon Logo" onerror="this.style.display='none'">
        
        <div class="header-text">
          <h3>Republic of the Philippines</h3>
          <h3>Province of Quezon</h3>
          <h2>Provincial Government Environment and Natural Resources Office</h2>
          <h4>Lucena City, Quezon</h4>
        </div>
        
        <img src="../logo/enro.png" class="right-logo" alt="PGENRO Seal" onerror="this.style.display='none'">
      </div>
      
      <div class="report-title-container">
        <div class="report-title">Office Supplies & Inventory Report</div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 15%;">Item ID</th>
            <th style="width: 25%;">Item Name</th>
            <th style="width: 10%;">Unit</th>
            <th style="width: 20%;">Description</th>
            <th style="text-align: center; width: 10%;">Total Stock</th>
            <th style="text-align: center; width: 10%;">Used</th>
            <th style="text-align: center; width: 10%;">Balance</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>

      <!-- Signatures Grid -->
      <div class="signatures-section">
        <div class="signature-block">
          <p>Prepared By:</p>
          <div class="signature-line">Administrative Assistant</div>
          <p class="signature-title">Office Supply Officer</p>
        </div>
        <div class="signature-block">
          <p>Noted & Approved By:</p>
          <div class="signature-line">Provincial Head, PGENRO</div>
          <p class="signature-title">Department Head</p>
        </div>
      </div>

      <div class="date-printed">
        <strong>Date Generated:</strong> ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
      </div>
      
      <script>
        window.addEventListener("DOMContentLoaded", () => {
          setTimeout(() => {
            window.print();
          }, 300);
        });
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(printHTML);
  printWindow.document.close();
  closeReportModal(); 
});

/* ==========================================================================
   INITIAL STOCKS / PLACEHOLDER DATA fallbacks
   ========================================================================== */
if (inventoryRecords.length === 0) {
  inventoryRecords = [
    { itemId: "ITEM-2024-0001", name: "A4 BOND PAPER", unit: "REAM", desc: "White, 80gsm, 8.27x11.69 inches", qty: 250, used: 124, balance: 126, threshold: 10, remarks: "Restocked Dec 4", status: "In-Stock" },
    { itemId: "ITEM-2024-0002", name: "ALCOHOL 70%", unit: "GALLON", desc: "Isopropyl Antiseptic Disinfectant", qty: 15, used: 12, balance: 3, threshold: 5, remarks: "Refill requested", status: "Low-Stock" },
    { itemId: "ITEM-2024-0003", name: "ARCH FILE FOLDER", unit: "PCS", desc: "Hardboard, legal-size clip binder", qty: 20, used: 20, balance: 0, threshold: 5, remarks: "Distributed across administrative desks", status: "Out-of-Stock" }
  ];
  localStorage.setItem("inventoryRecords", JSON.stringify(inventoryRecords));
}

// Initializing application layouts
displayRecords();
updateDashboard();