/* ============================================================
   SHARED SUPABASE CONFIGURATION
   Configure credentials once in ../shared/supabase.js
   ============================================================ */
const supabase = window.pgenroSupabase;
const isSupabaseConfigured = !!supabase && window.PGENRO_SUPABASE?.configured !== false;

// Shorthand selector
const $ = (id) => document.getElementById(id);

// Local State
let inventory = [];
let movements = [];
let activeFilter = "all";
let editingId = null;

// Initial Mock / Offline Seed Data (used when Supabase isn't linked yet)
const DEMO_INVENTORY = [
  {
    id: "item_001",
    control_no: "INV-2026-001",
    item_name: "A4 Copy Paper 80 GSM",
    category: "Office Supplies",
    unit: "REAM",
    quantity: 120,
    threshold: 25,
    description: "Multi-purpose premium laser/copy paper",
    remarks: "Cabinet A-1, Admin Supply Room",
    updated_at: new Date().toISOString()
  },
  {
    id: "item_002",
    control_no: "INV-2026-002",
    item_name: "Permanent Marker (Black)",
    category: "Office Supplies",
    unit: "BOX",
    quantity: 6,
    threshold: 10,
    description: "Bullet point, quick-drying waterproof ink",
    remarks: "Reorder required soon",
    updated_at: new Date().toISOString()
  },
  {
    id: "item_003",
    control_no: "INV-2026-003",
    item_name: "Hand Sanitizer 500ml",
    category: "Cleaning & Janitorial",
    unit: "BOTTLE",
    quantity: 0,
    threshold: 15,
    description: "70% Isopropyl alcohol antiseptic gel",
    remarks: "Out of stock - PO requested",
    updated_at: new Date().toISOString()
  },
  {
    id: "item_004",
    control_no: "INV-2026-004",
    item_name: "Ethernet Cable Cat6 (3M)",
    category: "Computer & IT Supplies",
    unit: "PCS",
    quantity: 18,
    threshold: 5,
    description: "Snagless molded high speed patch cable",
    remarks: "IT Storage Drawer 4",
    updated_at: new Date().toISOString()
  }
];

const DEMO_MOVEMENTS = [
  {
    id: "mov_001",
    item_id: "item_001",
    movement_type: "IN",
    quantity: 50,
    balance_after: 120,
    reference_no: "PO-2026-044",
    remarks: "Delivery from Provincial General Services",
    recorded_by: "Admin User",
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    inventory: { control_no: "INV-2026-001", item_name: "A4 Copy Paper 80 GSM" }
  },
  {
    id: "mov_002",
    item_id: "item_003",
    movement_type: "OUT",
    quantity: 10,
    balance_after: 0,
    reference_no: "RIS-0089",
    remarks: "Issued to Coastal Resource Division",
    recorded_by: "Admin User",
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    inventory: { control_no: "INV-2026-003", item_name: "Hand Sanitizer 500ml" }
  }
];

// Document Ready
document.addEventListener("DOMContentLoaded", async () => {
  lucide.createIcons();
  bindUIEvents();
  initStorage();

  if (isSupabaseConfigured) {
    await loadInventory();
    await loadMovements();
    supabase.channel("inventory-admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, async () => {
        await loadInventory();
        await loadMovements();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_movements" }, loadMovements)
      .subscribe();
  } else {
    setStatus(false, "Offline / Demo Mode (Set Supabase URL)");
    loadFromLocalStorage();
  }
});

function initStorage() {
  if (!localStorage.getItem("pgenro_admin_inventory")) {
    localStorage.setItem("pgenro_admin_inventory", JSON.stringify(DEMO_INVENTORY));
  }
  if (!localStorage.getItem("pgenro_admin_movements")) {
    localStorage.setItem("pgenro_admin_movements", JSON.stringify(DEMO_MOVEMENTS));
  }
}

function loadFromLocalStorage() {
  inventory = JSON.parse(localStorage.getItem("pgenro_admin_inventory")) || [];
  movements = JSON.parse(localStorage.getItem("pgenro_admin_movements")) || [];
  render();
  renderMovements();
}

function saveToLocalStorage() {
  localStorage.setItem("pgenro_admin_inventory", JSON.stringify(inventory));
  localStorage.setItem("pgenro_admin_movements", JSON.stringify(movements));
}

// Bind DOM Events
function bindUIEvents() {
  // Mobile & Sidebar toggles
  const sidebar = $("sidebar");
  const overlay = $("sidebarOverlay");

  $("mobileMenuBtn").onclick = () => {
    sidebar.classList.add("mobile-open");
    overlay.classList.add("active");
  };

  $("sidebarCollapseBtn").onclick = () => {
    sidebar.classList.remove("mobile-open");
    overlay.classList.remove("active");
  };

  overlay.onclick = () => {
    sidebar.classList.remove("mobile-open");
    overlay.classList.remove("active");
  };

  // Buttons & Forms
  $("addItemBtn").onclick = () => openItemModal();
  $("movementBtn").onclick = () => openMovementModal();
  $("openReportBtn").onclick = openReportModal;
  $("confirmPrintBtn").onclick = printReport;
  $("exportBtn").onclick = exportCSV;

  $("refreshBtn").onclick = async () => {
    if (isSupabaseConfigured) {
      await loadInventory();
      await loadMovements();
    } else {
      loadFromLocalStorage();
    }
    toast("Inventory data refreshed", "success");
  };

  // Searching & Filtering
  $("searchInput").oninput = render;
  $("globalSearch").oninput = () => {
    $("searchInput").value = $("globalSearch").value;
    render();
  };
  $("categoryFilter").onchange = render;
  $("sortFilter").onchange = render;

  $("itemForm").onsubmit = saveItem;
  $("movementForm").onsubmit = saveMovement;
  $("movementItem").onchange = updateMovementPreview;
  $("movementType").onchange = updateMovementPreview;
  $("movementQty").oninput = updateMovementPreview;

  // Filter tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      activeFilter = tab.dataset.filter;
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      tab.classList.add("active");
      render();
    };
  });

  // Modal dismiss buttons
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });

  // Select all for report
  $("selectAllReport").onchange = (e) => {
    const checkboxes = document.querySelectorAll(".report-item-check");
    checkboxes.forEach((cb) => (cb.checked = e.target.checked));
  };

  // Keyboard shortcut (Ctrl/Cmd + K)
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("globalSearch").focus();
    }
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.open").forEach((m) => m.classList.remove("open"));
    }
  });
}

// Database Helpers
async function loadInventory() {
  setStatus(true, "Connecting...");
  const { data, error } = await supabase
    .from("inventory")
    .select("*")
    .order("item_name", { ascending: true });

  if (error) {
    console.error(error);
    setStatus(false, "Connection error");
    toast(error.message, "error");
    loadFromLocalStorage();
    return;
  }
  inventory = data || [];
  saveToLocalStorage();
  setStatus(true, "Connected • Live");
  render();
}

async function loadMovements() {
  const { data, error } = await supabase
    .from("inventory_movements")
    .select("*, inventory:item_id(control_no, item_name)")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    console.warn(error);
    movements = JSON.parse(localStorage.getItem("pgenro_admin_movements")) || [];
    renderMovements();
    return;
  }
  movements = data || [];
  saveToLocalStorage();
  renderMovements();
}

function setStatus(online, text) {
  $("statusDot").className = `status-dot ${online ? "online" : "offline"}`;
  $("statusText").textContent = text;
}

function statusOf(item) {
  const qty = Number(item.quantity) || 0;
  const th = Number(item.threshold) || 0;
  if (qty <= 0) return "out";
  if (qty <= th) return "low";
  return "in";
}

// Render Main Inventory Directory
function render() {
  const search = $("searchInput").value.trim().toLowerCase();
  const cat = $("categoryFilter").value;

  let rows = inventory.filter((item) => {
    const status = statusOf(item);
    const text = `${item.control_no || ""} ${item.item_name || ""} ${item.category || ""} ${item.unit || ""} ${item.description || ""} ${item.remarks || ""}`.toLowerCase();
    const filterOK =
      activeFilter === "all" ||
      (activeFilter === "in" && status === "in") ||
      (activeFilter === "low" && status === "low") ||
      (activeFilter === "out" && status === "out");

    return filterOK && (!search || text.includes(search)) && (!cat || item.category === cat);
  });

  const sort = $("sortFilter").value;
  rows.sort((a, b) => {
    if (sort === "stock-low") return Number(a.quantity) - Number(b.quantity);
    if (sort === "stock-high") return Number(b.quantity) - Number(a.quantity);
    if (sort === "newest") return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    return (a.item_name || "").localeCompare(b.item_name || "");
  });

  const tbody = $("inventoryBody");
  tbody.innerHTML = rows.length
    ? rows.map(rowHTML).join("")
    : `<tr><td colspan="9" class="empty">No inventory records matching your filter criteria.</td></tr>`;

  // Attach dynamic button events
  tbody.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openItemModal(b.dataset.edit)));
  tbody.querySelectorAll("[data-delete]").forEach((b) => (b.onclick = () => deleteItem(b.dataset.delete)));
  tbody.querySelectorAll("[data-move]").forEach((b) => (b.onclick = () => openMovementModal(b.dataset.move)));

  // Recalculate KPIs
  const totalStock = inventory.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const low = inventory.filter((i) => statusOf(i) === "low").length;
  const out = inventory.filter((i) => statusOf(i) === "out").length;
  const inStock = inventory.filter((i) => statusOf(i) === "in").length;

  $("totalItems").textContent = inventory.length.toLocaleString();
  $("totalStock").textContent = totalStock.toLocaleString();
  $("lowStock").textContent = low.toLocaleString();
  $("outStock").textContent = out.toLocaleString();

  $("countAll").textContent = inventory.length;
  $("countIn").textContent = inStock;
  $("countLow").textContent = low;
  $("countOut").textContent = out;

  // Sync Category Filter
  const categories = [...new Set(inventory.map((i) => i.category).filter(Boolean))].sort();
  const currentCat = $("categoryFilter").value;
  $("categoryFilter").innerHTML =
    `<option value="">All Categories</option>` +
    categories.map((c) => `<option value="${escapeAttr(c)}">${escapeHTML(c)}</option>`).join("");
  if (categories.includes(currentCat)) $("categoryFilter").value = currentCat;

  // Render Lucide Icons for table buttons
  lucide.createIcons();
}

function rowHTML(item) {
  const status = statusOf(item);
  const label = status === "out" ? "Out of Stock" : status === "low" ? "Low Stock" : "In Stock";
  const updated = item.updated_at ? new Date(item.updated_at).toLocaleDateString() : "—";

  return `<tr>
    <td><span class="control">${escapeHTML(item.control_no || "—")}</span></td>
    <td>
      <span class="item-name">${escapeHTML(item.item_name || "—")}</span>
      <span class="item-desc">${escapeHTML(item.description || item.remarks || "No specifications")}</span>
    </td>
    <td>${escapeHTML(item.category || "General")}</td>
    <td><b>${escapeHTML(item.unit || "PCS")}</b></td>
    <td><span class="stock-number">${Number(item.quantity || 0).toLocaleString()}</span></td>
    <td>${Number(item.threshold || 0).toLocaleString()}</td>
    <td><span class="badge ${status}">${label}</span></td>
    <td><small style="color: var(--slate-500); font-weight: 600;">${updated}</small></td>
    <td>
      <div class="actions">
        <button class="action move" title="Record Movement" data-move="${item.id}">
          <i data-lucide="arrow-left-right"></i>
        </button>
        <button class="action" title="Edit Item" data-edit="${item.id}">
          <i data-lucide="pencil"></i>
        </button>
        <button class="action delete" title="Delete Item" data-delete="${item.id}">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </td>
  </tr>`;
}

// Add or Edit Item
function openItemModal(id = null) {
  editingId = id;
  $("itemForm").reset();
  $("itemQuantity").value = 0;
  $("itemThreshold").value = 5;

  if (id) {
    const item = inventory.find((x) => String(x.id) === String(id));
    if (!item) return;
    $("itemModalTitle").textContent = "Edit Inventory Masterfile";
    $("controlNo").value = item.control_no || "";
    $("itemName").value = item.item_name || "";
    $("itemCategory").value = item.category || "";
    $("itemUnit").value = item.unit || "";
    $("itemQuantity").value = item.quantity ?? 0;
    $("itemThreshold").value = item.threshold ?? 5;
    $("itemDescription").value = item.description || "";
    $("itemRemarks").value = item.remarks || "";
  } else {
    $("itemModalTitle").textContent = "Add Inventory Item";
    $("controlNo").value = `INV-2026-${String(inventory.length + 1).padStart(3, "0")}`;
  }
  openModal("itemModal");
}

async function saveItem(e) {
  e.preventDefault();
  const payload = {
    control_no: $("controlNo").value.trim(),
    item_name: $("itemName").value.trim(),
    category: $("itemCategory").value.trim() || "Office Supplies",
    unit: $("itemUnit").value.trim().toUpperCase(),
    quantity: Number($("itemQuantity").value),
    threshold: Number($("itemThreshold").value),
    description: $("itemDescription").value.trim(),
    remarks: $("itemRemarks").value.trim(),
    updated_at: new Date().toISOString()
  };

  if (!payload.control_no || !payload.item_name || !payload.unit) {
    return toast("Please fill in all mandatory fields.", "error");
  }

  $("saveItemBtn").disabled = true;

  if (isSupabaseConfigured) {
    let result;
    if (editingId) {
      result = await supabase.from("inventory").update(payload).eq("id", editingId);
    } else {
      result = await supabase.from("inventory").insert(payload);
    }
    $("saveItemBtn").disabled = false;

    if (result.error) return toast(result.error.message, "error");
    await loadInventory();
  } else {
    // Offline / LocalStorage Mode
    if (editingId) {
      const idx = inventory.findIndex((x) => String(x.id) === String(editingId));
      if (idx !== -1) inventory[idx] = { ...inventory[idx], ...payload };
    } else {
      payload.id = "item_" + Date.now();
      inventory.unshift(payload);
    }
    saveToLocalStorage();
    render();
    $("saveItemBtn").disabled = false;
  }

  closeModal("itemModal");
  toast(editingId ? "Item details updated." : "New item registered.", "success");
}

async function deleteItem(id) {
  const item = inventory.find((x) => String(x.id) === String(id));
  if (!item || !confirm(`Permanently delete "${item.item_name}"?`)) return;

  if (isSupabaseConfigured) {
    const { error } = await supabase.from("inventory").delete().eq("id", id);
    if (error) return toast(error.message, "error");
    await loadInventory();
    await loadMovements();
  } else {
    inventory = inventory.filter((x) => String(x.id) !== String(id));
    movements = movements.filter((m) => String(m.item_id) !== String(id));
    saveToLocalStorage();
    render();
    renderMovements();
  }
  toast("Inventory record deleted.", "success");
}

// Stock Movements
function openMovementModal(id = null) {
  const select = $("movementItem");
  select.innerHTML = inventory.length
    ? inventory
        .map(
          (i) =>
            `<option value="${i.id}">${escapeHTML(i.control_no)} — ${escapeHTML(i.item_name)} (${Number(i.quantity)} ${escapeHTML(i.unit)} on hand)</option>`
        )
        .join("")
    : `<option value="">No registered items available</option>`;

  $("movementForm").reset();
  if (id) select.value = id;
  $("movementQty").value = 1;
  openModal("movementModal");
  updateMovementPreview();
}

function updateMovementPreview() {
  const item = inventory.find((i) => String(i.id) === String($("movementItem").value));
  if (!item) {
    $("movementPreview").textContent = "Select an item to preview balance updates.";
    return;
  }

  const qty = Number($("movementQty").value) || 0;
  const type = $("movementType").value;
  const current = Number(item.quantity) || 0;
  let next = current;

  if (type === "IN") next = current + qty;
  else if (type === "OUT") next = current - qty;
  else next = qty;

  const colorStyle = next < 0 ? "color: var(--rose-700);" : "color: var(--emerald-700);";

  $("movementPreview").innerHTML = `
    <b>Current Count:</b> ${current.toLocaleString()} ${escapeHTML(item.unit || "")} 
    &nbsp; &rarr; &nbsp; 
    <b style="${colorStyle}">Projected Balance:</b> ${Math.max(next, 0).toLocaleString()} ${escapeHTML(item.unit || "")}
    ${next < 0 ? "<br><span style='color:var(--rose-700); font-weight:700;'>Warning: Stock out exceeds available inventory.</span>" : ""}
  `;
}

async function saveMovement(e) {
  e.preventDefault();
  const itemId = $("movementItem").value;
  const type = $("movementType").value;
  const qty = Number($("movementQty").value);
  const ref = $("movementReference").value.trim();
  const remarks = $("movementRemarks").value.trim();

  const item = inventory.find((i) => String(i.id) === String(itemId));
  if (!item || !qty || qty < 1) {
    return toast("Please select an item and enter a valid quantity.", "error");
  }

  const oldQty = Number(item.quantity || 0);
  let newQty = oldQty;

  if (type === "IN") newQty = oldQty + qty;
  else if (type === "OUT") newQty = oldQty - qty;
  else newQty = qty;

  if (newQty < 0) {
    return toast("Stock out quantity cannot exceed current inventory balance.", "error");
  }

  if (isSupabaseConfigured) {
    const { error } = await supabase.rpc("record_inventory_movement", {
      p_item_id: item.id,
      p_movement_type: type,
      p_quantity: qty,
      p_reference_no: ref || null,
      p_remarks: remarks || null,
      p_recorded_by: $("adminName").textContent.trim() || "PGENRO Administrator"
    });

    if (error) return toast(error.message || "Unable to record stock movement.", "error");

    toast("Stock movement successfully recorded.", "success");
    await loadInventory();
    await loadMovements();
  } else {
    // Offline local persistence
    item.quantity = newQty;
    item.updated_at = new Date().toISOString();

    const newMov = {
      id: "mov_" + Date.now(),
      item_id: item.id,
      movement_type: type,
      quantity: qty,
      balance_after: newQty,
      reference_no: ref,
      remarks: remarks,
      recorded_by: $("adminName").textContent.trim(),
      created_at: new Date().toISOString(),
      inventory: { control_no: item.control_no, item_name: item.item_name }
    };

    movements.unshift(newMov);
    saveToLocalStorage();
    render();
    renderMovements();
    toast("Stock movement recorded locally.", "success");
  }

  closeModal("movementModal");
}

function renderMovements() {
  const tbody = $("movementBody");
  if (!movements.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No stock transactions logged yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = movements
    .map((m) => {
      const isOut = m.movement_type === "OUT";
      const isAdj = m.movement_type === "ADJUSTMENT";
      const badgeClass = isOut ? "out" : isAdj ? "low" : "in";
      const timeFormatted = new Date(m.created_at).toLocaleString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });

      return `<tr>
      <td>${timeFormatted}</td>
      <td><span class="control">${escapeHTML(m.inventory?.control_no || "—")}</span></td>
      <td><b>${escapeHTML(m.inventory?.item_name || "—")}</b></td>
      <td><span class="badge ${badgeClass}">${escapeHTML(m.movement_type)}</span></td>
      <td><b>${Number(m.quantity || 0).toLocaleString()}</b></td>
      <td><span class="stock-number">${Number(m.balance_after || 0).toLocaleString()}</span></td>
      <td>${escapeHTML(m.reference_no || "—")}${m.remarks ? ` <span class="item-desc">${escapeHTML(m.remarks)}</span>` : ""}</td>
      <td><small style="color:var(--slate-600); font-weight:700;">${escapeHTML(m.recorded_by || "Admin")}</small></td>
    </tr>`;
    })
    .join("");

  lucide.createIcons();
}

// Report Printing Modal
function openReportModal() {
  const tbody = $("reportItemsBody");
  if (!inventory.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">No inventory items available.</td></tr>`;
  } else {
    tbody.innerHTML = inventory
      .map((item) => {
        const status = statusOf(item);
        const label = status === "out" ? "Out of Stock" : status === "low" ? "Low Stock" : "In Stock";
        return `<tr>
        <td style="text-align: center;">
          <input type="checkbox" class="report-item-check" value="${item.id}" checked>
        </td>
        <td class="control">${escapeHTML(item.control_no)}</td>
        <td><b>${escapeHTML(item.item_name)}</b></td>
        <td>${Number(item.quantity)} ${escapeHTML(item.unit)}</td>
        <td><span class="badge ${status}">${label}</span></td>
      </tr>`;
      })
      .join("");
  }
  openModal("reportModal");
}

function printReport() {
  const selectedIds = Array.from(document.querySelectorAll(".report-item-check:checked")).map(
    (cb) => cb.value
  );

  if (!selectedIds.length) {
    return toast("Please select at least one item to generate a report.", "warning");
  }

  const selectedItems = inventory.filter((i) => selectedIds.includes(String(i.id)));
  closeModal("reportModal");

  // Create printable ledger window
  const printWindow = window.open("", "_blank");
  const now = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });

  const printHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>PGENRO IMS - Office Supplies & Inventory Report</title>
      <style>
        body { font-family: 'Arial', sans-serif; padding: 24px; color: #111; font-size: 12px; }
        .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #059669; padding-bottom: 12px; }
        .header h1 { font-size: 16px; margin: 0; text-transform: uppercase; color: #064e3b; }
        .header p { margin: 3px 0 0; color: #555; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { border: 1px solid #ccc; padding: 8px 10px; text-align: left; }
        th { background: #f0fdf4; font-size: 11px; text-transform: uppercase; }
        .text-right { text-align: right; }
        .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 11px; }
        .sig { margin-top: 45px; border-top: 1px solid #000; width: 220px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Provincial Government Environment and Natural Resources Office</h1>
        <p>Official Inventory & Office Supplies Physical Ledger &bull; Date: ${now}</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Control No.</th>
            <th>Item Name & Description</th>
            <th>Category</th>
            <th>Unit</th>
            <th class="text-right">Quantity on Hand</th>
            <th class="text-right">Reorder Threshold</th>
            <th>Remarks / Location</th>
          </tr>
        </thead>
        <tbody>
          ${selectedItems
            .map(
              (i) => `
            <tr>
              <td><b>${escapeHTML(i.control_no)}</b></td>
              <td>${escapeHTML(i.item_name)}</td>
              <td>${escapeHTML(i.category)}</td>
              <td>${escapeHTML(i.unit)}</td>
              <td class="text-right">${Number(i.quantity).toLocaleString()}</td>
              <td class="text-right">${Number(i.threshold).toLocaleString()}</td>
              <td>${escapeHTML(i.remarks || "—")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <div class="footer">
        <div>
          <p>Prepared by:</p>
          <div class="sig">${$("adminName").textContent.trim()}<br><small>Inventory Custodian</small></div>
        </div>
        <div>
          <p>Verified by:</p>
          <div class="sig">PGENRO Department Head<br><small>Provincial Office Head</small></div>
        </div>
      </div>
      <script>
        window.onload = function() { window.print(); };
      <\/script>
    </body>
    </html>
  `;

  printWindow.document.write(printHTML);
  printWindow.document.close();
}

// CSV Export
function exportCSV() {
  if (!inventory.length) return toast("No inventory data to export.", "error");

  const header = [
    "Control No",
    "Item Name",
    "Category",
    "Unit",
    "Current Stock",
    "Alert Threshold",
    "Status",
    "Description",
    "Remarks",
    "Last Updated"
  ];

  const rows = inventory.map((i) => [
    i.control_no,
    i.item_name,
    i.category,
    i.unit,
    i.quantity,
    i.threshold,
    statusOf(i).toUpperCase(),
    i.description,
    i.remarks,
    i.updated_at
  ]);

  const csvContent = [header, ...rows]
    .map((r) => r.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pgenro_inventory_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("CSV exported successfully.", "success");
}

// Utility Helpers
function openModal(id) {
  $(id).classList.add("open");
}

function closeModal(id) {
  $(id).classList.remove("open");
}

function toast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  $("toastContainer").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function escapeHTML(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[c])
  );
}

function escapeAttr(v) {
  return escapeHTML(v);
}