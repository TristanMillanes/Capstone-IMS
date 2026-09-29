/* ===== Page module ===== */
/* ============================================================
   SHARED SUPABASE CONFIGURATION
   Configure credentials once in ../shared/supabase.js
   ============================================================ */
const supabase = window.pgenroSupabase;
const isSupabaseConfigured = !!supabase && window.PGENRO_SUPABASE?.configured !== false;

// Helpers
const $ = (id) => document.getElementById(id);

let travelOrders = [];
let editingId = null;
let currentViewingId = null;

// Read-only cache of live travel orders for temporary connection loss.
const TRAVEL_CACHE = "pgenro_admin_travel_orders_live_cache_v2";
let dbOnline = false;
function requireLiveDatabase() {
  if (isSupabaseConfigured && dbOnline) return true;
  toast("Database unavailable. Reconnect before changing travel orders.", "error");
  return false;
}

// Document Ready Initialization
document.addEventListener("DOMContentLoaded", async () => {
  window.lucide?.createIcons?.();
  bindUIEvents();

  if (isSupabaseConfigured) {
    await loadTravelOrders();
    supabase.channel("travel-orders-admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "travel_orders" }, loadTravelOrders)
      .subscribe();
  } else {
    setStatus(false, "Database offline • Cached records are read-only");
    loadFromLocalStorage();
  }
});

function loadFromLocalStorage() {
  try {
    const cached = JSON.parse(localStorage.getItem(TRAVEL_CACHE) || "[]");
    travelOrders = Array.isArray(cached) ? cached : [];
  } catch { travelOrders = []; }
  render();
}

function saveToLocalStorage() {
  try { localStorage.setItem(TRAVEL_CACHE, JSON.stringify(travelOrders)); }
  catch { /* Browser storage may be disabled. */ }
}

// Event Bindings
function bindUIEvents() {
  // Sidebar and profile controls live in this page script.

  // Top action buttons
  $("addOrderBtn").onclick = () => openOrderModal();
  $("exportBtn").onclick = exportCSV;
  $("printDocBtn").onclick = () => window.print();

  $("refreshBtn").onclick = async () => {
    const button = $("refreshBtn");
    const original = button.innerHTML;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = '<i data-lucide="loader-circle" class="spin"></i>';
    window.lucide?.createIcons?.();
    try {
      if (isSupabaseConfigured) await loadTravelOrders();
      else loadFromLocalStorage();
      toast(dbOnline ? "Travel orders refreshed" : "Database unavailable; showing cached records only", dbOnline ? "success" : "warning");
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.innerHTML = original;
      window.lucide?.createIcons?.();
    }
  };

  // Form submission
  $("orderForm").onsubmit = saveTravelOrder;

  // Search & Filters
  $("searchInput").oninput = render;
  $("globalSearch").oninput = () => {
    $("searchInput").value = $("globalSearch").value;
    render();
  };
  $("filterStatus").onchange = render;
  $("filterType").onchange = render;
  $("filterSort").onchange = render;
  $("clearFiltersBtn")?.addEventListener("click", () => {
    $("searchInput").value = "";
    $("globalSearch").value = "";
    $("filterStatus").value = "";
    $("filterType").value = "";
    $("filterSort").value = "newest";
    render();
    toast("Registry filters cleared.", "success");
  });

  // Live form UX
  const liveFields = [
    "torNo", "travelerName", "travelerDept", "destination",
    "departureDate", "returnDate", "travelType", "travelStatus",
    "purpose", "remarks"
  ];
  liveFields.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
      el.classList.remove("field-invalid");
      updateTravelFormUX();
    });
  });
  $("departureDate")?.addEventListener("change", syncReturnDateMinimum);
  $("returnDate")?.addEventListener("change", updateTravelFormUX);

  // Modal dismiss buttons
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("mousedown", (event) => {
      if (event.target === backdrop) closeModal(backdrop.id);
    });
  });

  // Keyboard Shortcuts (Ctrl/Cmd + K & Esc)
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("globalSearch").focus();
    }
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.open").forEach((m) => closeModal(m.id));
    }
  });
}

// Supabase Loader
async function loadTravelOrders() {
  dbOnline = false;
  setStatus(false, "Connecting...");
  let data, error;
  try {
    ({ data, error } = await supabase.from("travel_orders").select("*").order("created_at", { ascending: false }));
  } catch (connectionError) { error = connectionError; }

  if (error) {
    console.error(error);
    dbOnline = false;
    setStatus(false, "Database offline • Cached records are read-only");
    toast(error?.message || "Unable to reach the travel orders database.", "error");
    loadFromLocalStorage();
    return false;
  }

  travelOrders = data || [];
  dbOnline = true;
  saveToLocalStorage();
  setStatus(true, "Connected • Live");
  render();
  return true;
}

function setStatus(online, text) {
  $("statusDot").className = `status-dot ${online ? "online" : "offline"}`;
  $("statusText").textContent = text;
  $("addOrderBtn").disabled = !online;
  document.querySelectorAll("#travelOrderBody [data-edit], #travelOrderBody [data-delete], #travelOrderBody [data-status]")
    .forEach(button => { button.disabled = !online; });
}

// Table & Metrics Renderer
function render() {
  const search = $("searchInput").value.trim().toLowerCase();
  const filterStat = $("filterStatus").value;
  const filterType = $("filterType").value;
  const sort = $("filterSort").value;

  let rows = travelOrders.filter((tor) => {
    const query = `${tor.tor_no || ""} ${tor.traveler_name || ""} ${tor.destination || ""} ${tor.purpose || ""} ${tor.transportation || ""} ${tor.department || ""}`.toLowerCase();
    const matchesSearch = !search || query.includes(search);
    const matchesStat = !filterStat || tor.status === filterStat;
    const matchesType = !filterType || tor.travel_type === filterType;

    return matchesSearch && matchesStat && matchesType;
  });

  // Sorting
  rows.sort((a, b) => {
    if (sort === "date-asc") return new Date(a.departure_date) - new Date(b.departure_date);
    if (sort === "date-desc") return new Date(b.departure_date) - new Date(a.departure_date);
    if (sort === "traveler") return (a.traveler_name || "").localeCompare(b.traveler_name || "");
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  const tbody = $("travelOrderBody");
  tbody.innerHTML = rows.length
    ? rows.map(rowHTML).join("")
    : `<tr><td colspan="8" class="empty">No travel order records found matching criteria.</td></tr>`;

  // Attach dynamic button handlers
  tbody.querySelectorAll("[data-print]").forEach((b) => (b.onclick = () => openPrintModal(b.dataset.print)));
  tbody.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openOrderModal(b.dataset.edit)));
  tbody.querySelectorAll("[data-delete]").forEach((b) => (b.onclick = () => deleteOrder(b.dataset.delete)));
  tbody.querySelectorAll("[data-status]").forEach((b) => (b.onclick = () => quickStatusCycle(b.dataset.status)));
  if (!dbOnline) tbody.querySelectorAll("[data-edit], [data-delete], [data-status]").forEach(b => { b.disabled = true; });

  // KPI calculations
  const total = travelOrders.length;
  const pending = travelOrders.filter((t) => t.status === "Pending").length;
  const approved = travelOrders.filter((t) => t.status === "Approved").length;
  const completed = travelOrders.filter((t) => t.status === "Completed").length;

  $("metricTotal").textContent = total.toLocaleString();
  $("metricPending").textContent = pending.toLocaleString();
  $("metricApproved").textContent = approved.toLocaleString();
  $("metricCompleted").textContent = completed.toLocaleString();
  $("recordCounter").textContent = `Showing ${rows.length} of ${total} Orders`;
  updateRegistryFilterState(rows.length, total);

  window.lucide?.createIcons?.();
}

function rowHTML(tor) {
  const status = tor.status || "Pending";
  const statusClass = status.toLowerCase();

  // Format dates: e.g. "Sep 08 – Sep 11, 2026"
  const dep = tor.departure_date ? new Date(`${tor.departure_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  const ret = tor.return_date ? new Date(`${tor.return_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  const dateFormatted = `${dep} – ${ret}`;

  return `<tr>
    <td data-label="TOR No."><span class="tor-badge">${escapeHTML(tor.tor_no || "—")}</span></td>
    <td data-label="Traveler & Office">
      <div class="traveler-cell">
        <span class="traveler-name">${escapeHTML(tor.traveler_name || "—")}</span>
        <span class="traveler-sub">${escapeHTML(tor.traveler_position || "Staff")} &bull; ${escapeHTML(tor.department || "PGENRO")}</span>
      </div>
    </td>
    <td data-label="Destination & Purpose">
      <span class="dest-text">${escapeHTML(tor.destination || "—")}</span>
      <span class="purpose-text" title="${escapeHTML(tor.purpose || "Official Mission")}">${escapeHTML(tor.purpose || "Official Mission")}</span>
    </td>
    <td data-label="Travel Schedule"><b>${dateFormatted}</b></td>
    <td data-label="Travel Type"><span class="type-tag">${escapeHTML(tor.travel_type || "Official")}</span></td>
    <td data-label="Transportation"><small style="font-weight:700; color:var(--slate-700);">${escapeHTML(tor.transportation || "Official")}</small></td>
    <td data-label="Status">
      <button class="badge ${statusClass}" title="Click to advance workflow status" data-status="${escapeHTML(tor.id)}" style="cursor:pointer; border:none;">
        ${escapeHTML(status)}
      </button>
    </td>
    <td data-label="Actions">
      <div class="actions">
        <button class="action print" type="button" aria-label="View and print ${escapeHTML(tor.tor_no || "travel order")}" title="View & Print Official Travel Order" data-print="${escapeHTML(tor.id)}"><i data-lucide="printer"></i></button>
        <button class="action approve" type="button" aria-label="Advance status for ${escapeHTML(tor.tor_no || "travel order")}" title="Advance Status" data-status="${escapeHTML(tor.id)}"><i data-lucide="check"></i></button>
        <button class="action" type="button" aria-label="Edit ${escapeHTML(tor.tor_no || "travel order")}" title="Edit Travel Order" data-edit="${escapeHTML(tor.id)}"><i data-lucide="pencil"></i></button>
        <button class="action delete" type="button" aria-label="Delete ${escapeHTML(tor.tor_no || "travel order")}" title="Delete Travel Order" data-delete="${escapeHTML(tor.id)}"><i data-lucide="trash-2"></i></button>
      </div>
    </td>
  </tr>`;
}

function updateRegistryFilterState(visibleCount = 0, totalCount = travelOrders.length) {
  const parts = [];
  const query = $("searchInput")?.value.trim();
  const status = $("filterStatus")?.value;
  const type = $("filterType")?.value;
  const sort = $("filterSort")?.value || "newest";

  if (query) parts.push(`Search: “${query}”`);
  if (status) parts.push(status);
  if (type) parts.push(type);
  if (sort !== "newest") {
    const labels = { "date-asc": "Earliest departure", "date-desc": "Latest departure", traveler: "Traveler A–Z" };
    parts.push(labels[sort] || sort);
  }

  const target = $("activeFilterText");
  if (target) target.textContent = parts.length
    ? `${visibleCount} result${visibleCount === 1 ? "" : "s"} • ${parts.join(" • ")}`
    : `Showing all ${totalCount} travel order${totalCount === 1 ? "" : "s"}`;

  const sync = $("registrySyncText");
  if (sync) sync.textContent = dbOnline ? "Supabase live registry" : "Offline • cached records (read-only)";
}

function formatTravelDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function generateNextTorNo() {
  const year = new Date().getFullYear();
  const prefix = `TOR-${year}-`;
  const used = travelOrders
    .map((row) => String(row.tor_no || ""))
    .filter((value) => value.startsWith(prefix))
    .map((value) => Number(value.slice(prefix.length)))
    .filter(Number.isFinite);
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

function syncReturnDateMinimum() {
  const departure = $("departureDate")?.value || "";
  const ret = $("returnDate");
  if (!ret) return;
  ret.min = departure;
  if (departure && ret.value && ret.value < departure) ret.value = departure;
  updateTravelFormUX();
}

function updateTravelFormUX() {
  const purpose = $("purpose");
  const remarks = $("remarks");
  if ($("purposeCounter") && purpose) $("purposeCounter").textContent = `${purpose.value.length} / ${purpose.maxLength || 600}`;
  if ($("remarksCounter") && remarks) $("remarksCounter").textContent = `${remarks.value.length} / ${remarks.maxLength || 500}`;

  const dep = $("departureDate")?.value || "";
  const ret = $("returnDate")?.value || "";
  const durationStrip = $("tripDurationStrip");
  const durationText = $("tripDurationText");
  const rangeText = $("tripDateRangeText");
  let schedule = "—";

  if (dep && ret) {
    const start = new Date(`${dep}T00:00:00`);
    const end = new Date(`${ret}T00:00:00`);
    const days = Math.floor((end - start) / 86400000) + 1;
    const invalid = days < 1;
    durationStrip?.classList.toggle("invalid", invalid);
    if (durationText) durationText.textContent = invalid ? "Return date must be on or after departure" : `${days} day${days === 1 ? "" : "s"} official travel`;
    if (rangeText) rangeText.textContent = `${formatTravelDate(dep)} → ${formatTravelDate(ret)}`;
    if (!invalid) schedule = `${formatTravelDate(dep)} – ${formatTravelDate(ret)}`;
  } else {
    durationStrip?.classList.remove("invalid");
    if (durationText) durationText.textContent = "Travel period not complete";
    if (rangeText) rangeText.textContent = "Select departure and return dates.";
  }

  const summaryValues = {
    summaryTorNo: $("torNo")?.value.trim() || "—",
    summaryTraveler: $("travelerName")?.value.trim() || "—",
    summaryDept: $("travelerDept")?.value.trim() || "—",
    summaryDestination: $("destination")?.value.trim() || "—",
    summarySchedule: schedule,
    summaryType: $("travelType")?.value || "Official Business",
    summaryStatus: $("travelStatus")?.selectedOptions?.[0]?.textContent || "Pending Review"
  };
  Object.entries(summaryValues).forEach(([id, value]) => { if ($(id)) $(id).textContent = value; });
  const statusRow = $("summaryStatus")?.closest(".summary-status-row");
  if (statusRow) statusRow.dataset.status = $("travelStatus")?.value || "Pending";
}

function markFieldInvalid(id, message) {
  const field = $(id);
  if (!field) return;
  field.classList.add("field-invalid");
  field.focus({ preventScroll: true });
  field.scrollIntoView({ behavior: "smooth", block: "center" });
  toast(message, "error");
}

// Add or Edit Modal
function openOrderModal(id = null) {
  editingId = id;
  $("orderForm").reset();
  $("orderDbId").value = id || "";
  document.querySelectorAll("#orderForm .field-invalid").forEach((field) => field.classList.remove("field-invalid"));

  if (id) {
    const tor = travelOrders.find((x) => String(x.id) === String(id));
    if (!tor) return;
    $("orderModalTitle").textContent = "Edit Travel Order";
    $("torNo").value = tor.tor_no || "";
    $("travelerName").value = tor.traveler_name || "";
    $("travelerPosition").value = tor.traveler_position || "";
    $("travelerDept").value = tor.department || "";
    $("travelType").value = tor.travel_type || "Official Business";
    $("travelStatus").value = tor.status || "Pending";
    $("destination").value = tor.destination || "";
    $("departureDate").value = tor.departure_date || "";
    $("returnDate").value = tor.return_date || "";
    $("transportation").value = tor.transportation || "";
    $("purpose").value = tor.purpose || "";
    $("perDiem").value = tor.per_diem || "";
    $("fundSource").value = tor.fund_source || "";
    $("approverName").value = tor.approver || "Provincial Environment & Natural Resources Officer";
    $("remarks").value = tor.remarks || "";
  } else {
    $("orderModalTitle").textContent = "Create Travel Order";
    $("torNo").value = generateNextTorNo();
    $("travelStatus").value = "Pending";
    $("travelType").value = "Official Business";
    $("approverName").value = "Provincial Environment & Natural Resources Officer";
    const today = new Date();
    $("departureDate").value = today.toISOString().slice(0, 10);
    const tomorrow = new Date(today.getTime() + 86400000);
    $("returnDate").value = tomorrow.toISOString().slice(0, 10);
  }

  syncReturnDateMinimum();
  updateTravelFormUX();
  openModal("orderModal");
  const body = document.querySelector("#orderModal .travel-order-modal-body");
  if (body) body.scrollTop = 0;
  setTimeout(() => $("torNo")?.focus({ preventScroll: true }), 120);
}

async function saveTravelOrder(e) {
  e.preventDefault();
  const form = $("orderForm");
  const saveButton = $("saveOrderBtn");

  document.querySelectorAll("#orderForm .field-invalid").forEach((field) => field.classList.remove("field-invalid"));

  const payload = {
    tor_no: $("torNo").value.trim(),
    traveler_name: $("travelerName").value.trim(),
    traveler_position: $("travelerPosition").value.trim(),
    department: $("travelerDept").value.trim(),
    travel_type: $("travelType").value,
    status: $("travelStatus").value,
    destination: $("destination").value.trim(),
    departure_date: $("departureDate").value,
    return_date: $("returnDate").value,
    transportation: $("transportation").value.trim(),
    purpose: $("purpose").value.trim(),
    per_diem: $("perDiem").value.trim(),
    fund_source: $("fundSource").value.trim(),
    approver: $("approverName").value.trim(),
    remarks: $("remarks").value.trim(),
    updated_at: new Date().toISOString()
  };

  const required = [
    ["torNo", payload.tor_no, "Enter the official Travel Order number."],
    ["travelerName", payload.traveler_name, "Enter the traveler or personnel name."],
    ["travelerPosition", payload.traveler_position, "Enter the traveler’s position or designation."],
    ["travelerDept", payload.department, "Enter the division or operating unit."],
    ["destination", payload.destination, "Enter the destination or official station."],
    ["departureDate", payload.departure_date, "Select the departure date."],
    ["returnDate", payload.return_date, "Select the return date."],
    ["transportation", payload.transportation, "Enter the transportation or vehicle."],
    ["purpose", payload.purpose, "Describe the specific purpose of travel."]
  ];
  const missing = required.find(([, value]) => !value);
  if (missing) return markFieldInvalid(missing[0], missing[2]);

  if (!form.checkValidity()) {
    const invalid = form.querySelector(":invalid");
    if (invalid?.id) return markFieldInvalid(invalid.id, "Please review the highlighted required field.");
    return toast("Please review the required fields.", "error");
  }

  if (payload.return_date < payload.departure_date) {
    return markFieldInvalid("returnDate", "Return date cannot be earlier than the departure date.");
  }

  const duplicate = travelOrders.find((row) =>
    String(row.tor_no || "").trim().toLowerCase() === payload.tor_no.toLowerCase() &&
    String(row.id) !== String(editingId || "")
  );
  if (duplicate) return markFieldInvalid("torNo", `Travel Order ${payload.tor_no} already exists.`);

  const originalButtonHtml = saveButton.innerHTML;
  saveButton.disabled = true;
  saveButton.setAttribute("aria-busy", "true");
  saveButton.innerHTML = '<i data-lucide="loader-circle" class="spin"></i><span>Saving...</span>';
  window.lucide?.createIcons?.();

  try {
    if (!requireLiveDatabase()) return;
    const result = editingId
      ? await supabase.from("travel_orders").update(payload).eq("id", editingId)
      : await supabase.from("travel_orders").insert(payload);
    if (result.error) throw result.error;
    const refreshed = await loadTravelOrders();
    closeModal("orderModal");
    toast(refreshed ? (editingId ? "Travel order updated successfully." : "New travel order logged successfully.") : "Change submitted; reconnect to verify the travel order.", refreshed ? "success" : "warning");
  } catch (error) {
    console.error("Travel order save failed:", error);
    toast(error?.message || "Unable to save the travel order. Please try again.", "error");
  } finally {
    saveButton.disabled = false;
    saveButton.removeAttribute("aria-busy");
    saveButton.innerHTML = originalButtonHtml;
    window.lucide?.createIcons?.();
  }
}

// Cycle Status (Quick Approval workflow)
async function quickStatusCycle(id) {
  const tor = travelOrders.find((x) => String(x.id) === String(id));
  if (!tor) return;

  const order = ["Pending", "Approved", "Completed", "Disapproved"];
  const nextIndex = (order.indexOf(tor.status) + 1) % order.length;
  const newStatus = order[nextIndex];

  if (!requireLiveDatabase()) return;
  try {
    const { error } = await supabase.from("travel_orders").update({ status: newStatus }).eq("id", id);
    if (error) throw error;
    if (await loadTravelOrders()) toast(`${tor.tor_no} status changed to ${newStatus}.`, "success");
  } catch (error) { toast(error?.message || "Could not update status.", "error"); }
}

async function deleteOrder(id) {
  const tor = travelOrders.find((x) => String(x.id) === String(id));
  if (!tor || !confirm(`Delete Travel Order "${tor.tor_no}" for ${tor.traveler_name}?`)) return;

  if (!requireLiveDatabase()) return;
  try {
    const { error } = await supabase.from("travel_orders").delete().eq("id", id);
    if (error) throw error;
    if (await loadTravelOrders()) toast("Travel order deleted.", "success");
  } catch (error) { toast(error?.message || "Could not delete travel order.", "error"); }
}

// Print Modal Preparation
function openPrintModal(id) {
  currentViewingId = id;
  const tor = travelOrders.find((x) => String(x.id) === String(id));
  if (!tor) return;

  const dep = tor.departure_date ? new Date(tor.departure_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";
  const ret = tor.return_date ? new Date(tor.return_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";

  $("p_torNo").textContent = tor.tor_no || "TOR-2026-000";
  $("p_dateFiled").textContent = new Date(tor.created_at || Date.now()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  $("p_traveler").textContent = tor.traveler_name || "—";
  $("p_position").textContent = tor.traveler_position || "—";
  $("p_dept").textContent = tor.department || "PGENRO";
  $("p_destination").textContent = tor.destination || "—";
  $("p_dates").textContent = `${dep} to ${ret}`;
  $("p_purpose").textContent = tor.purpose || "Official Mission";
  $("p_perDiem").textContent = tor.per_diem || "Pursuant to Executive Order 77 & COA Auditing Rules";
  $("p_transport").textContent = tor.transportation || "Official Government Conveyance";
  $("p_funds").textContent = tor.fund_source || "PGENRO Budgetary Allocation";
  $("p_remarks").textContent = tor.remarks || "Submit Certificate of Appearance upon return.";
  $("p_approver").textContent = (tor.approver || "PROVINCIAL ENR OFFICER").toUpperCase();

  openModal("printModal");
}

// Export CSV
function exportCSV() {
  if (!travelOrders.length) return toast("No travel orders to export.", "error");

  const headers = [
    "TOR No",
    "Traveler Name",
    "Position",
    "Department",
    "Travel Type",
    "Destination",
    "Departure Date",
    "Return Date",
    "Transportation",
    "Purpose",
    "Status",
    "Approver"
  ];

  const rows = travelOrders.map((t) => [
    t.tor_no,
    t.traveler_name,
    t.traveler_position,
    t.department,
    t.travel_type,
    t.destination,
    t.departure_date,
    t.return_date,
    t.transportation,
    t.purpose,
    t.status,
    t.approver
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pgenro_travel_orders_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Travel orders masterlist exported.", "success");
}

// Modal Helpers
function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("admin-modal-open");
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".modal-backdrop.open")) document.body.classList.remove("admin-modal-open");
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
