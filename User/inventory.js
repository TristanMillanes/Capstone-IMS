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

// Initialize Icons
if (window.lucide) {
  lucide.createIcons();
}

// Auto Calculate Balance dynamically
function calculateBalance() {
  const qty = parseInt(inputQty.value) || 0;
  const used = parseInt(inputUsed.value) || 0;
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

// UI Modals & Sidebar Logic
function openEncodingModal() {
  clearForm();
  document.getElementById("formTitle").textContent = "Encode Inventory Record";
  document.getElementById("submitBtn").textContent = "Save Record";
  inputId.value = generateControlNumber(); // Pre-fill ID

  formModal.classList.add("open");
  overlay.classList.add("active");
  if (window.lucide) lucide.createIcons();
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

// Submit Form Logic
form.addEventListener("submit", function(e) {
  e.preventDefault();

  const editIndex = editIndexInput.value;
  const balanceVal = (parseInt(inputQty.value) || 0) - (parseInt(inputUsed.value) || 0);

  // Determine status for badge based on logic
  let status = "In-Stock";
  if (balanceVal <= 0) status = "Out-of-Stock";
  else if (balanceVal <= 5) status = "Low-Stock";

  const record = {
    itemId: inputId.value,
    name: inputName.value.toUpperCase(),
    unit: inputUnit.value.toUpperCase(),
    desc: inputDesc.value,
    qty: parseInt(inputQty.value) || 0,
    used: parseInt(inputUsed.value) || 0,
    balance: balanceVal,
    remarks: inputRemarks.value,
    status: status
  };

  if (editIndex === "") {
    inventoryRecords.push(record);
    alert("Inventory record saved successfully.");
  } else {
    inventoryRecords[editIndex] = record;
    alert("Inventory record updated successfully.");
  }

  // Save to LocalStorage
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
  document.getElementById("formTitle").textContent = "Encode Inventory Record";
  document.getElementById("submitBtn").textContent = "Save Record";
}

// Render Main Table Data
function displayRecords() {
  const table = document.getElementById("recordsTable");
  const search = document.getElementById("searchInput").value.toLowerCase();

  table.innerHTML = "";

  const filteredRecords = inventoryRecords.filter(record => {
    // Tab Filters
    const matchesFilter = currentFilter === "All" || record.status === currentFilter;

    // Search bar functionality
    const matchesSearch =
      (record.itemId || "").toLowerCase().includes(search) ||
      (record.name || "").toLowerCase().includes(search) ||
      (record.desc || "").toLowerCase().includes(search);

    return matchesFilter && matchesSearch;
  });

  if (filteredRecords.length === 0) {
    table.innerHTML = `<tr><td colspan="7" class="empty">No inventory records found.</td></tr>`;
    return;
  }

  filteredRecords.forEach((record) => {
    const originalIndex = inventoryRecords.indexOf(record);

    table.innerHTML += `
      <tr>
        <td><strong>${record.itemId}</strong></td>
        <td>
          <strong>${record.name}</strong>
          <small>${record.unit} | ${record.desc}</small>
        </td>
        <td>${record.qty}</td>
        <td>${record.used}</td>
        <td><span class="badge ${record.status}">${record.balance}</span></td>
        <td>${record.remarks || "-"}</td>
        <td>
          <div class="action-group">
            <button class="action-btn edit" onclick="editRecord(${originalIndex})" title="Edit">
              <i data-lucide="edit-3" style="width: 16px; height: 16px;"></i>
            </button>
            <button class="action-btn delete" onclick="deleteRecord(${originalIndex})" title="Delete">
              <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  if (window.lucide) lucide.createIcons();
}

// Edit Record Logic
window.editRecord = function(index) {
  const record = inventoryRecords[index];

  editIndexInput.value = index;
  inputId.value = record.itemId;
  inputName.value = record.name;
  inputUnit.value = record.unit;
  inputDesc.value = record.desc;
  inputQty.value = record.qty;
  inputUsed.value = record.used;
  inputBalance.value = record.balance;
  inputRemarks.value = record.remarks;

  document.getElementById("formTitle").textContent = "Edit Inventory Record";
  document.getElementById("submitBtn").textContent = "Update Record";

  formModal.classList.add("open");
  overlay.classList.add("active");
}

// Delete Record Logic
window.deleteRecord = function(index) {
  if (confirm("Are you sure you want to delete this inventory item?")) {
    inventoryRecords.splice(index, 1);
    localStorage.setItem("inventoryRecords", JSON.stringify(inventoryRecords));
    displayRecords();
    updateDashboard();
  }
}

// Tab Filter switching
window.setFilter = function(type, button) {
  currentFilter = type;
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  button.classList.add("active");
  displayRecords();
}

// Update Top Dashboard Stats
function updateDashboard() {
  let totalQty = 0;
  let lowStock = 0;
  let outOfStock = 0;

  inventoryRecords.forEach(record => {
    totalQty += record.balance;
    if (record.balance <= 0) outOfStock++;
    else if (record.balance <= 5) lowStock++;
  });

  document.getElementById("statTotalItems").textContent = inventoryRecords.length;
  document.getElementById("statTotalQty").textContent = totalQty;
  document.getElementById("statLowStock").textContent = lowStock;
  document.getElementById("statOutOfStock").textContent = outOfStock;
}

// ==========================================
// REPORT MODAL & GENERATION LOGIC
// ==========================================

// 1. Open the Report Modal
generateReportBtn.addEventListener("click", () => {
  const search = document.getElementById("searchInput").value.toLowerCase();
  
  // Get currently filtered items based on tabs and search
  const filteredItems = inventoryRecords.filter(record => {
    const matchesFilter = currentFilter === "All" || record.status === currentFilter;
    const matchesSearch =
      (record.itemId || "").toLowerCase().includes(search) ||
      (record.name || "").toLowerCase().includes(search) ||
      (record.desc || "").toLowerCase().includes(search);
    return matchesFilter && matchesSearch;
  });

  if (filteredItems.length === 0) {
    alert("No records available to print based on current filters.");
    return;
  }

  // Populate the Report Modal Table
  reportTableBody.innerHTML = "";
  reportSelectAll.checked = false;

  filteredItems.forEach((record) => {
    // Find the real index in the main array so we can reference it correctly
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

  // Show Modal
  reportModal.classList.add("open");
  overlay.classList.add("active");
  if (window.lucide) lucide.createIcons();
});

// 2. Close Report Modal
function closeReportModal() {
  reportModal.classList.remove("open");
  if (!sidebar.classList.contains("open") && !formModal.classList.contains("open")) {
    overlay.classList.remove("active");
    mainContent.classList.remove("blur");
  }
}
reportModalClose.addEventListener("click", closeReportModal);
cancelReportBtn.addEventListener("click", closeReportModal);

// 3. Select All Logic inside the Modal
reportSelectAll.addEventListener("change", function(e) {
  const checkboxes = document.querySelectorAll(".report-item-checkbox");
  checkboxes.forEach(cb => cb.checked = e.target.checked);
});

// 4. Confirm Print Logic (With Two Logos)
confirmPrintBtn.addEventListener("click", () => {
  const selectedCheckboxes = document.querySelectorAll('.report-item-checkbox:checked');
  let itemsToPrint = [];

  if (selectedCheckboxes.length === 0) {
    alert("Please select at least one item to print.");
    return;
  }

  selectedCheckboxes.forEach(cb => {
    const index = cb.value;
    itemsToPrint.push(inventoryRecords[index]);
  });

  const printWindow = window.open('', '_blank');
  
  let tableRows = '';
  itemsToPrint.forEach(record => {
    let balanceStyle = record.balance <= 0 ? 'color: red; font-weight: bold;' : '';
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
    <html>
    <head>
      <title>Inventory Report - PGENRO</title>
      <style>
        body { font-family: 'Arial', sans-serif; padding: 40px; color: #222; }
        
        /* Updated Header for Two Logos */
        .header-container { 
          display: flex; 
          align-items: center; 
          justify-content: center; 
          margin-bottom: 30px; 
          position: relative; 
          min-height: 100px;
        }
        .left-logo { 
          width: 90px; 
          height: auto; 
          position: absolute; 
          left: 250px; 
        }
        .right-logo { 
          width: 100px; 
          height: auto; 
          position: absolute; 
          right: 250px; 
        }
        
        .header-text { text-align: center; }
        .header-text h3 { margin: 0; font-size: 15px; font-weight: normal; }
        .header-text h2 { margin: 6px 0; font-size: 18px; font-weight: bold; color: #0f6b3d; }
        .header-text h4 { margin: 0; font-size: 13px; font-weight: normal; font-style: italic; }
        .report-title-container { text-align: center; margin-top: 40px; margin-bottom: 20px; }
        .report-title { font-size: 22px; font-weight: bold; text-transform: uppercase; border-bottom: 2px solid #222; display: inline-block; padding-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
        th, td { border: 1px solid #ccc; padding: 10px 12px; text-align: left; }
        th { background-color: #f0f7f3; color: #084b2a; font-weight: bold; text-transform: uppercase; font-size: 12px; }
        .date-printed { margin-top: 40px; font-size: 12px; color: #666; text-align: right; }
        @media print {
          @page { margin: 1cm; size: landscape; }
          body { -webkit-print-color-adjust: exact; }
        }
      </style>
    </head>
    <body>
      <div class="header-container">
        <img src="../logo/Quezonlogo.png" class="left-logo" alt="PGENRO Logo" onerror="this.style.display='none'">
        
        <div class="header-text">
          <h3>Republic of the Philippines</h3>
          <h3>Province of Quezon</h3>
          <h2>Provincial Government Environment and Natural Resources Office</h2>
          <h4>Lucena City, Quezon</h4>
        </div>
        
        <img src="../logo/enro.png" class="right-logo" alt="Quezon Seal" onerror="this.style.display='none'">
      </div>
      
      <div class="report-title-container">
        <div class="report-title">Office Supplies & Inventory Report</div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Item ID</th>
            <th>Item Name</th>
            <th>Unit</th>
            <th>Description</th>
            <th style="text-align: center;">Total Qty</th>
            <th style="text-align: center;">Used</th>
            <th style="text-align: center;">Balance</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>

      <div class="date-printed">
        <strong>Date Printed:</strong> ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
      </div>
      
      <script>
        setTimeout(() => {
          window.print();
        }, 500);
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(printHTML);
  printWindow.document.close();
  closeReportModal(); // Close modal after generating
});

// Pre-load Dummy Data if the local storage is completely empty
if (inventoryRecords.length === 0) {
  inventoryRecords = [
    { itemId: "ITEM-2024-0001", name: "4A BOND PAPER", unit: "REAM", desc: "WHITE 8.27X11", qty: 192, used: 98, balance: 94, remarks: "Restocked 12/4", status: "In-Stock" },
    { itemId: "ITEM-2024-0002", name: "ALCOHOL 70%", unit: "GALLON", desc: "ISOPROPYL", qty: 4, used: 1, balance: 3, remarks: "Need refill", status: "Low-Stock" },
    { itemId: "ITEM-2024-0003", name: "ARCH FILE", unit: "PCS", desc: "FOLDER TOP CLIP", qty: 3, used: 3, balance: 0, remarks: "", status: "Out-of-Stock" }
  ];
  localStorage.setItem("inventoryRecords", JSON.stringify(inventoryRecords));
}

// Initializing UI upon page load
displayRecords();
updateDashboard();