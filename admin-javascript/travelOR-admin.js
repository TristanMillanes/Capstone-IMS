import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* ============================================================
   SUPABASE CONFIGURATION
   ============================================================ */
const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY";

const isSupabaseConfigured =
  SUPABASE_URL.startsWith("http") && !SUPABASE_URL.includes("YOUR_SUPABASE");

const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// Helpers
const $ = (id) => document.getElementById(id);

let travelOrders = [];
let editingId = null;
let currentViewingId = null;

// Initial Mock Seed Data (used when Supabase is unlinked or offline)
const DEMO_TRAVEL_ORDERS = [
  {
    id: "tor_001",
    tor_no: "TOR-2026-001",
    traveler_name: "Engr. Roberto Reyes, Jr.",
    traveler_position: "Senior Environmental Management Specialist",
    department: "Environmental Management & Pollution Control",
    destination: "Narra & Sofronio Española, Palawan",
    departure_date: "2026-09-08",
    return_date: "2026-09-11",
    travel_type: "Field Inspection",
    transportation: "Provincial Service Vehicle (SJD-401)",
    purpose: "Conduct industrial wastewater effluent sampling and air quality monitoring of processing facilities.",
    per_diem: "Standard Per Diem per EO 77",
    fund_source: "ENRO Clean Air & Water Program",
    approver: "Provincial Environment & Natural Resources Officer",
    remarks: "Coordinate with Municipal MENRO prior to inspection.",
    status: "Approved",
    created_at: new Date(Date.now() - 3600000 * 24).toISOString()
  },
  {
    id: "tor_002",
    tor_no: "TOR-2026-002",
    traveler_name: "Aileen Castro, Michael Lim",
    traveler_position: "Forest Ranger / GIS Mapping Assistant",
    department: "Forest Management Unit",
    destination: "El Nido & Taytay Protected Areas",
    departure_date: "2026-09-14",
    return_date: "2026-09-17",
    travel_type: "Official Business",
    transportation: "Public Utility Van / Hired Motorboat",
    purpose: "Ground truthing of satellite-detected mangrove canopy disturbances and community warden validation.",
    per_diem: "Actual travel and food expenses",
    fund_source: "Mangrove & Coastal Resources Protection Fund",
    approver: "Provincial Environment & Natural Resources Officer",
    remarks: "Coordinate with PAMB Secretariat.",
    status: "Pending",
    created_at: new Date().toISOString()
  },
  {
    id: "tor_003",
    tor_no: "TOR-2026-003",
    traveler_name: "Maria Santos Dela Cruz",
    traveler_position: "Provincial ENR Officer",
    department: "Office of the Provincial ENR Officer",
    destination: "DENR Central Office, Visayas Ave., Quezon City",
    departure_date: "2026-08-20",
    return_date: "2026-08-23",
    travel_type: "Seminar / Workshop",
    transportation: "Commercial Airline (Roundtrip PPS-MNL)",
    purpose: "Attend National Environmental Summit and National Greening Program Regional Assessment Conference.",
    per_diem: "Allowable per diem pursuant to EO 77",
    fund_source: "General Administration Fund",
    approver: "Provincial Governor",
    remarks: "Accomplishment report and re-echo session required.",
    status: "Completed",
    created_at: new Date(Date.now() - 3600000 * 240).toISOString()
  }
];

// Document Ready Initialization
document.addEventListener("DOMContentLoaded", async () => {
  lucide.createIcons();
  bindUIEvents();
  initStorage();

  if (isSupabaseConfigured) {
    await loadTravelOrders();
  } else {
    setStatus(false, "Offline / Demo Mode (Set Supabase URL)");
    loadFromLocalStorage();
  }
});

function initStorage() {
  if (!localStorage.getItem("pgenro_admin_travel_orders")) {
    localStorage.setItem("pgenro_admin_travel_orders", JSON.stringify(DEMO_TRAVEL_ORDERS));
  }
}

function loadFromLocalStorage() {
  travelOrders = JSON.parse(localStorage.getItem("pgenro_admin_travel_orders")) || [];
  render();
}

function saveToLocalStorage() {
  localStorage.setItem("pgenro_admin_travel_orders", JSON.stringify(travelOrders));
}

// Event Bindings
function bindUIEvents() {
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

  // Top action buttons
  $("addOrderBtn").onclick = () => openOrderModal();
  $("exportBtn").onclick = exportCSV;
  $("printDocBtn").onclick = () => window.print();

  $("refreshBtn").onclick = async () => {
    if (isSupabaseConfigured) await loadTravelOrders();
    else loadFromLocalStorage();
    toast("Travel orders refreshed", "success");
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

  // Modal dismiss buttons
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });

  // Keyboard Shortcuts (Ctrl/Cmd + K & Esc)
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

// Supabase Loader
async function loadTravelOrders() {
  setStatus(true, "Connecting...");
  const { data, error } = await supabase
    .from("travel_orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    setStatus(false, "Connection error");
    toast(error.message, "error");
    loadFromLocalStorage();
    return;
  }

  travelOrders = data || [];
  saveToLocalStorage();
  setStatus(true, "Connected • Live");
  render();
}

function setStatus(online, text) {
  $("statusDot").className = `status-dot ${online ? "online" : "offline"}`;
  $("statusText").textContent = text;
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

  lucide.createIcons();
}

function rowHTML(tor) {
  const status = tor.status || "Pending";
  const statusClass = status.toLowerCase();

  // Format dates: e.g. "Sep 08 – Sep 11, 2026"
  const dep = tor.departure_date ? new Date(tor.departure_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  const ret = tor.return_date ? new Date(tor.return_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  const dateFormatted = `${dep} – ${ret}`;

  return `<tr>
    <td><span class="tor-badge">${escapeHTML(tor.tor_no || "—")}</span></td>
    <td>
      <div class="traveler-cell">
        <span class="traveler-name">${escapeHTML(tor.traveler_name || "—")}</span>
        <span class="traveler-sub">${escapeHTML(tor.traveler_position || "Staff")} &bull; ${escapeHTML(tor.department || "PGENRO")}</span>
      </div>
    </td>
    <td>
      <span class="dest-text">${escapeHTML(tor.destination || "—")}</span>
      <span class="purpose-text">${escapeHTML(tor.purpose || "Official Mission")}</span>
    </td>
    <td>
      <b>${dateFormatted}</b>
    </td>
    <td><span class="type-tag">${escapeHTML(tor.travel_type || "Official")}</span></td>
    <td><small style="font-weight:700; color:var(--slate-700);">${escapeHTML(tor.transportation || "Official")}</small></td>
    <td>
      <button class="badge ${statusClass}" title="Click to cycle status" data-status="${tor.id}" style="cursor:pointer; border:none;">
        ${escapeHTML(status)}
      </button>
    </td>
    <td>
      <div class="actions">
        <button class="action print" title="View & Print Official Travel Order" data-print="${tor.id}">
          <i data-lucide="printer"></i>
        </button>
        <button class="action approve" title="Advance Status" data-status="${tor.id}">
          <i data-lucide="check"></i>
        </button>
        <button class="action" title="Edit Travel Order" data-edit="${tor.id}">
          <i data-lucide="pencil"></i>
        </button>
        <button class="action delete" title="Delete Travel Order" data-delete="${tor.id}">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </td>
  </tr>`;
}

// Add or Edit Modal
function openOrderModal(id = null) {
  editingId = id;
  $("orderForm").reset();

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
    $("torNo").value = `TOR-2026-${String(travelOrders.length + 1).padStart(3, "0")}`;
    $("departureDate").value = new Date().toISOString().slice(0, 10);
    $("returnDate").value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  }

  openModal("orderModal");
}

async function saveTravelOrder(e) {
  e.preventDefault();
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

  if (!payload.tor_no || !payload.traveler_name || !payload.destination || !payload.departure_date || !payload.return_date) {
    return toast("Please fill in all mandatory fields.", "error");
  }

  $("saveOrderBtn").disabled = true;

  if (isSupabaseConfigured) {
    let result;
    if (editingId) {
      result = await supabase.from("travel_orders").update(payload).eq("id", editingId);
    } else {
      result = await supabase.from("travel_orders").insert(payload);
    }
    $("saveOrderBtn").disabled = false;

    if (result.error) return toast(result.error.message, "error");
    await loadTravelOrders();
  } else {
    // Offline Storage
    if (editingId) {
      const idx = travelOrders.findIndex((x) => String(x.id) === String(editingId));
      if (idx !== -1) travelOrders[idx] = { ...travelOrders[idx], ...payload };
    } else {
      payload.id = "tor_" + Date.now();
      payload.created_at = new Date().toISOString();
      travelOrders.unshift(payload);
    }
    saveToLocalStorage();
    render();
    $("saveOrderBtn").disabled = false;
  }

  closeModal("orderModal");
  toast(editingId ? "Travel order updated." : "New travel order logged.", "success");
}

// Cycle Status (Quick Approval workflow)
async function quickStatusCycle(id) {
  const tor = travelOrders.find((x) => String(x.id) === String(id));
  if (!tor) return;

  const order = ["Pending", "Approved", "Completed", "Disapproved"];
  const nextIndex = (order.indexOf(tor.status) + 1) % order.length;
  const newStatus = order[nextIndex];

  if (isSupabaseConfigured) {
    const { error } = await supabase.from("travel_orders").update({ status: newStatus }).eq("id", id);
    if (error) return toast(error.message, "error");
    await loadTravelOrders();
  } else {
    tor.status = newStatus;
    saveToLocalStorage();
    render();
  }
  toast(`${tor.tor_no} status changed to ${newStatus}.`, "success");
}

async function deleteOrder(id) {
  const tor = travelOrders.find((x) => String(x.id) === String(id));
  if (!tor || !confirm(`Delete Travel Order "${tor.tor_no}" for ${tor.traveler_name}?`)) return;

  if (isSupabaseConfigured) {
    const { error } = await supabase.from("travel_orders").delete().eq("id", id);
    if (error) return toast(error.message, "error");
    await loadTravelOrders();
  } else {
    travelOrders = travelOrders.filter((x) => String(x.id) !== String(id));
    saveToLocalStorage();
    render();
  }
  toast("Travel order deleted.", "success");
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