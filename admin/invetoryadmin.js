/* ===== Page module ===== */
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

// Read-only cache of records previously retrieved from the live database.
const INVENTORY_CACHE = "pgenro_admin_inventory_live_cache_v2";
const MOVEMENTS_CACHE = "pgenro_admin_movements_live_cache_v2";
let dbOnline = false;

function cachedRows(key) {
  try { const rows = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(rows) ? rows : []; }
  catch { return []; }
}

function requireLiveDatabase() {
  if (isSupabaseConfigured && dbOnline) return true;
  toast("Database is offline. Reconnect before changing inventory records.", "error");
  return false;
}

// Document Ready
document.addEventListener("DOMContentLoaded", async () => {
  window.lucide?.createIcons?.();
  bindUIEvents();

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
    setStatus(false, "Database offline • Cached records are read-only");
    loadFromLocalStorage();
  }
});

function loadFromLocalStorage() {
  inventory = cachedRows(INVENTORY_CACHE);
  movements = cachedRows(MOVEMENTS_CACHE);
  render();
  renderMovements();
}

function saveToLocalStorage() {
  try {
    localStorage.setItem(INVENTORY_CACHE, JSON.stringify(inventory));
    localStorage.setItem(MOVEMENTS_CACHE, JSON.stringify(movements));
  } catch { /* Private browsing can disable persistent browser storage. */ }
}

// Bind DOM Events
function bindUIEvents() {
  // Shared mobile/sidebar controls are centralized in the page-owned admin shell below.

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
    toast(dbOnline ? "Inventory data refreshed" : "Database unavailable; showing cached records only", dbOnline ? "success" : "warning");
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
  dbOnline = false;
  setStatus(false, "Connecting...");
  try {
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
      .order("item_name", { ascending: true });
    if (error) throw error;
    inventory = data || [];
    dbOnline = true;
    saveToLocalStorage();
    setStatus(true, "Connected • Live");
    render();
    return true;
  } catch (error) {
    console.error(error);
    dbOnline = false;
    setStatus(false, "Database offline • Cached records are read-only");
    toast(error?.message || "Inventory could not load from Supabase.", "error");
    loadFromLocalStorage();
    return false;
  }
}

async function loadMovements() {
  try {
    const { data, error } = await supabase
      .from("inventory_movements")
      .select("*, inventory:item_id(control_no, item_name)")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    movements = data || [];
    saveToLocalStorage();
    renderMovements();
  } catch (error) {
    console.warn(error);
    movements = cachedRows(MOVEMENTS_CACHE);
    renderMovements();
  }
}

function setStatus(online, text) {
  $("statusDot").className = `status-dot ${online ? "online" : "offline"}`;
  $("statusText").textContent = text;
  $("addItemBtn").disabled = !online;
  $("movementBtn").disabled = !online;
  renderActionState();
}

function renderActionState() {
  document.querySelectorAll("#inventoryBody [data-edit], #inventoryBody [data-delete], #inventoryBody [data-move]")
    .forEach((button) => { button.disabled = !dbOnline; });
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
    : `<tr><td colspan="9" class="empty">${!dbOnline && !inventory.length ? "Database unavailable. No cached inventory records to show." : "No inventory records matching your filter criteria."}</td></tr>`;

  // Attach dynamic button events
  tbody.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openItemModal(b.dataset.edit)));
  tbody.querySelectorAll("[data-delete]").forEach((b) => (b.onclick = () => deleteItem(b.dataset.delete)));
  tbody.querySelectorAll("[data-move]").forEach((b) => (b.onclick = () => openMovementModal(b.dataset.move)));
  renderActionState();

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
  window.lucide?.createIcons?.();
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
        <button class="action move" title="Record Movement" data-move="${escapeAttr(item.id)}">
          <i data-lucide="arrow-left-right"></i>
        </button>
        <button class="action" title="Edit Item" data-edit="${escapeAttr(item.id)}">
          <i data-lucide="pencil"></i>
        </button>
        <button class="action delete" title="Delete Item" data-delete="${escapeAttr(item.id)}">
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
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    const highest = inventory.reduce((max, item) => {
      const control = String(item.control_no || "");
      const suffix = control.startsWith(prefix) ? Number(control.slice(prefix.length)) : 0;
      return Math.max(max, Number.isInteger(suffix) ? suffix : 0);
    }, 0);
    $("controlNo").value = `${prefix}${String(highest + 1).padStart(3, "0")}`;
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

  if (!requireLiveDatabase()) return;
  $("saveItemBtn").disabled = true;
  try {
    const result = editingId
      ? await supabase.from("inventory").update(payload).eq("id", editingId)
      : await supabase.from("inventory").insert(payload);
    if (result.error) throw result.error;
    const refreshed = await loadInventory();
    closeModal("itemModal");
    toast(refreshed ? (editingId ? "Item details updated." : "New item registered.") : "Change submitted; reconnect to verify the updated inventory.", refreshed ? "success" : "warning");
  } catch (error) {
    toast(error?.message || "Could not save this inventory item.", "error");
  } finally {
    $("saveItemBtn").disabled = false;
  }
}

async function deleteItem(id) {
  const item = inventory.find((x) => String(x.id) === String(id));
  if (!item || !requireLiveDatabase() || !confirm(`Permanently delete "${item.item_name}"?`)) return;

  try {
    const { error } = await supabase.from("inventory").delete().eq("id", id);
    if (error) throw error;
    const refreshed = await loadInventory();
    await loadMovements();
    if (refreshed) toast("Inventory record deleted.", "success");
  } catch (error) {
    toast(error?.message || "Could not delete this inventory item.", "error");
  }
}

// Stock Movements
function openMovementModal(id = null) {
  const select = $("movementItem");
  select.innerHTML = inventory.length
    ? inventory
        .map(
          (i) =>
            `<option value="${escapeAttr(i.id)}">${escapeHTML(i.control_no)} — ${escapeHTML(i.item_name)} (${Number(i.quantity)} ${escapeHTML(i.unit)} on hand)</option>`
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
  if (!requireLiveDatabase()) return;

  try {
    const { error } = await supabase.rpc("record_inventory_movement", {
      p_item_id: item.id,
      p_movement_type: type,
      p_quantity: qty,
      p_reference_no: ref || null,
      p_remarks: remarks || null,
      p_recorded_by: $("adminName").textContent.trim() || "PGENRO Administrator"
    });

    if (error) throw error;

    const refreshed = await loadInventory();
    await loadMovements();
    closeModal("movementModal");
    toast(refreshed ? "Stock movement successfully recorded." : "Movement submitted; reconnect to verify the updated balance.", refreshed ? "success" : "warning");
  } catch (error) {
    toast(error?.message || "Unable to record stock movement.", "error");
  }
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

  window.lucide?.createIcons?.();
}

// Report Printing Modal
function openReportModal() {
  const tbody = $("reportItemsBody");
  $("selectAllReport").checked = true;
  if (!inventory.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">No inventory items available.</td></tr>`;
  } else {
    tbody.innerHTML = inventory
      .map((item) => {
        const status = statusOf(item);
        const label = status === "out" ? "Out of Stock" : status === "low" ? "Low Stock" : "In Stock";
        return `<tr>
        <td style="text-align: center;">
          <input type="checkbox" class="report-item-check" value="${escapeAttr(item.id)}" checked>
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
  // Create printable ledger window
  const printWindow = window.open("", "_blank");
  if (!printWindow) return toast("Allow pop-ups to print the inventory report.", "warning");
  closeModal("reportModal");
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
          <div class="sig">${escapeHTML($("adminName").textContent.trim())}<br><small>Inventory Custodian</small></div>
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
    .map((r) => r.map((cell) => {
      const value = String(cell ?? "");
      const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
      return `"${safe.replaceAll('"', '""')}"`;
    }).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pgenro_inventory_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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

/* ===== Page-contained admin shell controller ===== */
/* PGENRO IMS — shared admin UX enhancements. Safe to load after each module script. */
(() => {
  'use strict';

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const currentFile = (location.pathname.split('/').pop() || 'admin.html').toLowerCase();

  function normalizePath(href) {
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return '';
    try {
      const u = new URL(href, location.href);
      return (u.pathname.split('/').pop() || '').toLowerCase();
    } catch { return ''; }
  }

  function fixNavigation() {
    const map = {
      'Security Audit Trail': 'admin.html#audit',
      'System Backups': 'admin.html#backup',
      'Global Settings': 'admin.html#settings'
    };
    const links = $$('.sidebar a');

    links.forEach(a => {
      const label = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if ((!a.getAttribute('href') || a.getAttribute('href') === '#') && map[label]) {
        a.setAttribute('href', map[label]);
      }
    });

    let match = null;
    const currentHash = location.hash || '';
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('javascript:')) continue;
      let u;
      try { u = new URL(href, location.href); } catch { continue; }
      const file = (u.pathname.split('/').pop() || '').toLowerCase();
      if (file !== currentFile) continue;

      if (currentFile === 'admin.html') {
        if (u.hash && u.hash === currentHash) { match = a; break; }
        if (!u.hash && (!currentHash || currentHash === '#dashboard')) match = a;
      } else if (!u.hash) {
        match = a;
        break;
      }
    }

    if (match) {
      links.forEach(a => {
        a.classList.toggle('active', a === match);
        if (a === match) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    }
  }

  function cleanupDuplicateNavigation() {
    const seen = new Set();
    $$('.sidebar a').forEach(link => {
      const label = (link.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const href = link.getAttribute('href') || '';
      if (!label || !href) return;
      const key = `${href.toLowerCase()}|${label}`;
      if (!seen.has(key)) {
        seen.add(key);
        return;
      }
      const row = link.closest('li');
      (row || link).remove();
    });
  }

  function setupUnifiedProfileMenu() {
    const menu = $('#profileMenu');
    const button = $('#profileBtn');
    const dropdown = $('#profileDropdown');
    const notificationsButton = $('#notificationsBtn');
    const notificationsDropdown = $('#notificationDropdown');

    if (menu && button && dropdown) {
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-controls', 'profileDropdown');
      button.setAttribute('aria-expanded', 'false');
      dropdown.setAttribute('role', 'menu');
      dropdown.setAttribute('aria-hidden', 'true');
      menu.classList.remove('open', 'show', 'active');
      dropdown.classList.remove('open', 'show', 'active');
      dropdown.style.removeProperty('display');
    }

    if (notificationsButton && notificationsDropdown) {
      notificationsButton.setAttribute('aria-haspopup', 'true');
      notificationsButton.setAttribute('aria-controls', 'notificationDropdown');
      notificationsButton.setAttribute('aria-expanded', 'false');
      notificationsDropdown.setAttribute('aria-hidden', 'true');
      notificationsDropdown.classList.remove('open', 'show', 'active');
      notificationsDropdown.style.removeProperty('display');
    }
  }

  function addAccessibility() {
    if (!$('.admin-ui-skip-link')) {
      const skip = document.createElement('a');
      skip.className = 'admin-ui-skip-link';
      skip.href = '#adminMainContent';
      skip.textContent = 'Skip to main content';
      document.body.prepend(skip);
    }

    const main = $('.main-content');
    if (main && !main.id) main.id = 'adminMainContent';
    if (main) main.setAttribute('role', 'main');
    const sidebar = $('.sidebar');
    if (sidebar) sidebar.setAttribute('aria-label', 'Administrator navigation');

    $$('button').forEach(btn => {
      if (!btn.getAttribute('type')) btn.setAttribute('type', 'button');
      const text = (btn.textContent || '').trim();
      if (!text && !btn.getAttribute('aria-label')) {
        const title = btn.getAttribute('title');
        const icon = btn.querySelector('[data-lucide]')?.getAttribute('data-lucide');
        btn.setAttribute('aria-label', title || (icon ? icon.replace(/-/g, ' ') : 'Action'));
      }
    });

    $$('table').forEach(table => {
      if (!table.getAttribute('role')) table.setAttribute('role', 'table');
      $$('th', table).forEach(th => { if (!th.getAttribute('scope')) th.setAttribute('scope', 'col'); });
    });

    $$('input[required], select[required], textarea[required]').forEach(el => el.setAttribute('aria-required', 'true'));
  }

  function addMobileTitle() {
    const left = $('.topbar-left');
    if (!left || $('.admin-ui-mobile-title', left)) return;
    const h1 = $('.page-header h1, .ics-admin-header h1');
    if (!h1) return;
    const title = document.createElement('div');
    title.className = 'admin-ui-mobile-title';
    title.innerHTML = `<strong>${escapeHtml(h1.textContent.trim())}</strong><span>PGENRO IMS Admin</span>`;
    const menu = $('#mobileMenuBtn', left);
    if (menu?.nextSibling) left.insertBefore(title, menu.nextSibling);
    else left.prepend(title);
  }

  function setupKeyboardSearch() {
    const search = $('#globalSearchInput, #globalSearch, #quickSearchInput, #tableSearchInput, #visitorSearch');
    if (!search) return;
    document.addEventListener('keydown', e => {
      const target = e.target;
      const typing = target && /INPUT|TEXTAREA|SELECT/.test(target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.focus();
        if (typeof search.select === 'function') search.select();
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        search.focus();
      }
    });
  }

  function setupMobileBackdrop() {
    if ($('.overlay#overlay') || $('#sidebarOverlay') || $('#sidebarBackdrop')) return;
    const sidebar = $('#sidebar');
    const menu = $('#mobileMenuBtn');
    if (!sidebar || !menu) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'admin-sidebar-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.appendChild(backdrop);

    const sync = () => {
      const open = sidebar.classList.contains('mobile-open') || sidebar.classList.contains('open');
      backdrop.classList.toggle('active', open && innerWidth <= 900);
      backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    };

    menu.addEventListener('click', () => setTimeout(sync, 0));
    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open', 'open');
      backdrop.classList.remove('active');
      menu.setAttribute('aria-expanded', 'false');
    });
    new MutationObserver(sync).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  }

  function setupSidebarState() {
    const sidebar = $('#sidebar');
    const main = $('.main-wrapper');
    const collapse = $('#sidebarCollapseBtn');
    if (!sidebar) return;

    try {
      const collapsed = localStorage.getItem('pgenro_admin_sidebar') === 'collapsed';
      if (collapsed && innerWidth > 900) {
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
        main?.classList.add('sidebar-collapsed');
      }
    } catch {}

    if (collapse) collapse.setAttribute('aria-expanded', String(!sidebar.classList.contains('collapsed')));
  }

  function setupUnifiedShellControls() {
    const sidebar = $('#sidebar');
    const main = $('.main-wrapper');
    const profileMenu = $('#profileMenu');
    const profileBtn = $('#profileBtn');
    const profileDropdown = $('#profileDropdown');
    const notificationDropdown = $('#notificationDropdown');
    const mobileMenuBtn = $('#mobileMenuBtn');
    const collapseBtn = $('#sidebarCollapseBtn');

    // Always begin from a deterministic closed state. Legacy module CSS used
    // to leave these panels visible on first paint.
    profileMenu?.classList.remove('open', 'show', 'active');
    profileDropdown?.classList.remove('open', 'show', 'active');
    notificationDropdown?.classList.remove('open', 'show', 'active');
    profileDropdown?.style.removeProperty('display');
    notificationDropdown?.style.removeProperty('display');
    profileDropdown?.setAttribute('aria-hidden', 'true');
    notificationDropdown?.setAttribute('aria-hidden', 'true');
    profileBtn?.setAttribute('aria-expanded', 'false');
    $('#notificationsBtn')?.setAttribute('aria-expanded', 'false');

    const allBackdrops = () => [
      $('#sidebarBackdrop'),
      $('#sidebarOverlay'),
      $('.admin-sidebar-backdrop')
    ].filter(Boolean);

    const setBackdrop = open => {
      allBackdrops().forEach(node => node.classList.toggle('active', !!open));
      const overlay = $('#overlay');
      if (overlay && !$('#detailDrawer')?.classList.contains('open')) {
        overlay.classList.toggle('active', !!open);
      }
    };

    const closeMobile = () => {
      sidebar?.classList.remove('mobile-open', 'open');
      mobileMenuBtn?.setAttribute('aria-expanded', 'false');
      setBackdrop(false);
    };

    const closeProfile = () => {
      profileMenu?.classList.remove('open', 'show', 'active');
      profileDropdown?.classList.remove('open', 'show', 'active');
      profileDropdown?.style.removeProperty('display');
      profileDropdown?.setAttribute('aria-hidden', 'true');
      profileBtn?.setAttribute('aria-expanded', 'false');
    };

    const closeNotifications = () => {
      notificationDropdown?.classList.remove('open', 'show', 'active');
      notificationDropdown?.style.removeProperty('display');
      notificationDropdown?.setAttribute('aria-hidden', 'true');
      $('#notificationsBtn')?.setAttribute('aria-expanded', 'false');
    };

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      if (target.closest('#mobileMenuBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!sidebar) return;
        const opening = !sidebar.classList.contains('mobile-open');
        sidebar.classList.toggle('mobile-open', opening);
        mobileMenuBtn?.setAttribute('aria-expanded', String(opening));
        setBackdrop(opening && innerWidth <= 900);
        return;
      }

      if (target.closest('#sidebarCollapseBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!sidebar) return;

        if (innerWidth <= 900) {
          closeMobile();
          return;
        }

        const collapsed = !sidebar.classList.contains('collapsed');
        sidebar.classList.toggle('collapsed', collapsed);
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        main?.classList.toggle('sidebar-collapsed', collapsed);
        collapseBtn?.setAttribute('aria-expanded', String(!collapsed));
        try { localStorage.setItem('pgenro_admin_sidebar', collapsed ? 'collapsed' : 'expanded'); } catch {}
        return;
      }

      if (target.closest('#logoutBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();

        const logoutButton = target.closest('#logoutBtn');
        logoutButton?.setAttribute('disabled', '');
        logoutButton?.setAttribute('aria-busy', 'true');

        (async () => {
          try {
            const client = window.pgenroSupabase || window.PGENRO_DB?.client;
            await client?.auth?.signOut?.();
          } catch (error) {
            console.warn('PGENRO IMS: sign-out request could not be completed.', error);
          } finally {
            try {
              Object.keys(sessionStorage)
                .filter(key => /^(pgenro|sb-)/i.test(key))
                .forEach(key => sessionStorage.removeItem(key));
            } catch {}
            window.location.href = '../User/login.html';
          }
        })();
        return;
      }

      if (target.closest('#profileBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!profileMenu) return;
        const opening = !profileMenu.classList.contains('open');
        closeProfile();
        closeNotifications();
        if (opening) {
          profileMenu.classList.add('open');
          profileDropdown?.setAttribute('aria-hidden', 'false');
          profileBtn?.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      if (target.closest('#notificationsBtn')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!notificationDropdown) {
          window.AdminUI?.toast?.('No new notifications.', 'info');
          return;
        }
        const opening = !!notificationDropdown && !notificationDropdown.classList.contains('open');
        closeProfile();
        closeNotifications();
        if (opening) {
          notificationDropdown.classList.add('open');
          notificationDropdown.setAttribute('aria-hidden', 'false');
          $('#notificationsBtn')?.setAttribute('aria-expanded', 'true');
        }
        return;
      }

      if (profileMenu && !profileMenu.contains(target)) closeProfile();
      const notificationWrapper = notificationDropdown?.closest('.notification-wrapper');
      if (notificationDropdown && notificationWrapper && !notificationWrapper.contains(target)) closeNotifications();

      if (innerWidth <= 900 && sidebar?.classList.contains('mobile-open')) {
        const insideSidebar = sidebar.contains(target);
        const isMenuButton = !!target.closest('#mobileMenuBtn');
        if (!insideSidebar && !isMenuButton && !target.closest('#overlay')) closeMobile();
      }
    }, true);

    window.addEventListener('resize', () => {
      if (innerWidth > 900) {
        sidebar?.classList.remove('mobile-open', 'open');
        setBackdrop(false);
      } else {
        document.body.classList.remove('sidebar-collapsed');
        main?.classList.remove('sidebar-collapsed');
      }
    });
  }

  function setupEscapeKey() {
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      $('#sidebar')?.classList.remove('mobile-open', 'open');
      $$('.admin-sidebar-backdrop, #sidebarOverlay, #sidebarBackdrop').forEach(el => el.classList.remove('active'));
      if (!$('#detailDrawer')?.classList.contains('open')) $('#overlay')?.classList.remove('active');
      $('#mobileMenuBtn')?.setAttribute('aria-expanded', 'false');
      $('#profileBtn')?.setAttribute('aria-expanded', 'false');
      $('#profileDropdown')?.classList.remove('open', 'show', 'active');
      $('#profileDropdown')?.setAttribute('aria-hidden', 'true');
      $('#profileMenu')?.classList.remove('open', 'show', 'active');
      $('#notificationDropdown')?.classList.remove('open', 'show', 'active');
      $('#notificationDropdown')?.setAttribute('aria-hidden', 'true');
      $('#notificationsBtn')?.setAttribute('aria-expanded', 'false');
      const drawer = $('#detailDrawer');
      if (drawer) {
        drawer.classList.remove('open', 'active');
        drawer.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function setupResponsiveTables() {
    $$('table').forEach(table => {
      if (table.closest('.table-responsive, .table-wrapper, .table-container, .ics-table-wrapper')) return;
      const parent = table.parentElement;
      if (!parent) return;
      const wrap = document.createElement('div');
      wrap.className = 'table-responsive admin-ui-auto-table-wrap';
      parent.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  function setupExternalLinkSafety() {
    $$('a[target="_blank"]').forEach(a => {
      const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
      rel.add('noopener'); rel.add('noreferrer');
      a.setAttribute('rel', [...rel].join(' '));
    });
  }

  function addFooterWhenMissing() {
    const main = $('.main-content');
    if (!main || $('footer', main) || $('.admin-footer', main)) return;
    const footer = document.createElement('footer');
    footer.className = 'admin-footer';
    footer.innerHTML = `<div><p>&copy; 2026 Provincial Government Environment and Natural Resources Office. Administrator workspace.</p></div><div class="footer-links"><a href="admin.html#audit">Audit Trail</a><a href="admin.html#backup">Backups</a><a href="admin.html#settings">Settings</a></div>`;
    main.appendChild(footer);
  }

  function setupOnlineState() {
    const apply = () => document.documentElement.dataset.network = navigator.onLine ? 'online' : 'offline';
    apply();
    addEventListener('online', apply);
    addEventListener('offline', apply);
  }

  function escapeHtml(v) {
    const d = document.createElement('div');
    d.textContent = v == null ? '' : String(v);
    return d.innerHTML;
  }

  window.AdminUI = window.AdminUI || {};
  window.AdminUI.toast = (message, type = 'success', timeout = 2800) => {
    let stack = $('.admin-ui-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'admin-ui-toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const toast = document.createElement('div');
    toast.className = 'admin-ui-toast';
    toast.dataset.type = type;
    toast.innerHTML = `<i data-lucide="${type === 'error' ? 'alert-circle' : type === 'warning' ? 'alert-triangle' : 'circle-check'}"></i><span>${escapeHtml(message)}</span>`;
    stack.appendChild(toast);
    window.lucide?.createIcons?.();
    setTimeout(() => {
      toast.style.opacity = '0'; toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 200);
    }, timeout);
  };

  function init() {
    document.documentElement.classList.add('admin-ui-ready');
    cleanupDuplicateNavigation();
    fixNavigation();
    setupUnifiedProfileMenu();
    window.addEventListener('hashchange', fixNavigation);
    addAccessibility();
    addMobileTitle();
    setupKeyboardSearch();
    setupMobileBackdrop();
    setupSidebarState();
    setupUnifiedShellControls();
    // Motion is owned by shared/pgenro-global.js.
    setupEscapeKey();
    setupResponsiveTables();
    setupExternalLinkSafety();
    addFooterWhenMissing();
    setupOnlineState();
    // shared/supabase.js owns authorization and sign-out.
    window.lucide?.createIcons?.();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

/* Module-owned motion; content remains visible if JavaScript is unavailable. */
/* Progressive, one-time entrance effects for the administrator workspace. */
(() => {
  'use strict';
  const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const targets = [
    '.main-content > .page-header',
    '.main-content > .ics-admin-header',
    '.main-content :is(.kpi-grid,.stats-grid,.metrics-grid,.ics-kpi-grid) > *',
    '.main-content .module-control-grid > *',
    '.main-content :is(.section-header,.panel-header,.ics-panel-header)',
    '.main-content :is(.chart-card,.table-card,.ics-panel,.service-form-card)'
  ].join(',');

  function init() {
    if (motionQuery?.matches || !('IntersectionObserver' in window)) return;
    const seen = new WeakSet();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: .04, rootMargin: '0px 0px -18px 0px' });

    const register = root => {
      const elements = root.matches?.(targets) ? [root] : [...root.querySelectorAll(targets)];
      for (const element of elements) {
        if (seen.has(element) || element.closest('[hidden],.modal-backdrop,.modal-overlay')) continue;
        seen.add(element);
        const siblings = [...element.parentElement.children].filter(el => el.matches(targets));
        element.style.setProperty('--admin-stagger', `${Math.min(siblings.indexOf(element), 5) * 45}ms`);
        element.classList.add('admin-motion-pending');
        observer.observe(element);
      }
    };

    register(document.querySelector('.main-content') || document.body);
    const main = document.querySelector('.main-content');
    if (main) {
      const changes = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1) register(node);
        }
      });
      changes.observe(main, { childList: true, subtree: true });
      window.addEventListener('pagehide', () => { changes.disconnect(); observer.disconnect(); }, { once: true });
    }
    motionQuery?.addEventListener?.('change', event => {
      if (!event.matches) return;
      observer.disconnect();
      document.querySelectorAll('.admin-motion-pending').forEach(el => el.classList.add('is-visible'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();


/* ===================== MODULE NOTIFICATION ENGINE V3 =====================
 * Only alerts when this module receives new visible records.
 */
(function(){
  const moduleName=document.body?.dataset?.adminPage || location.pathname.split('/').pop();
  const key='pgenro_module_seen_'+moduleName;
  function addNotification(text){
    const list=document.querySelector('#notificationList');
    const badge=document.querySelector('#notifBadgeCount');
    if(!list)return;
    const empty=list.querySelector('.empty-notif-state'); if(empty) empty.remove();
    const item=document.createElement('div');
    item.className='notification-item';
    item.innerHTML='<strong>New update</strong><br><span>'+text.replace(/[<>]/g,'')+'</span>';
    list.prepend(item);
    let count=parseInt((badge?.textContent||'0').match(/\d+/)?.[0]||0)+1;
    if(badge) badge.textContent=count+' Unread';
    const ping=document.querySelector('#notifPing'); if(ping) ping.style.display='block';
  }
  function scan(){
    const rows=document.querySelectorAll('tbody tr');
    const count=rows.length;
    const old=parseInt(localStorage.getItem(key)||count);
    if(count>old) addNotification((count-old)+' new record(s) added in this module.');
    localStorage.setItem(key,String(count));
  }
  window.addEventListener('load',()=>setTimeout(scan,1500));
  const observer=new MutationObserver(()=>scan());
  observer.observe(document.body,{childList:true,subtree:true});
})();
