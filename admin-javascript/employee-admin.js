/* ============================================================
   SHARED SUPABASE CONFIGURATION
   Configure credentials once in ../shared/supabase.js
   ============================================================ */
const supabase = window.pgenroSupabase;
const isSupabaseConfigured = !!supabase && window.PGENRO_SUPABASE?.configured !== false;

// Helpers
const $ = (id) => document.getElementById(id);

let employees = [];
let editingId = null;
let currentViewingId = null;

// Initial Mock Seed Data (used when Supabase is unlinked or offline)
const DEMO_EMPLOYEES = [
  {
    id: "emp_001",
    employee_id: "EMP-2026-001",
    first_name: "Maria",
    middle_name: "Santos",
    last_name: "Dela Cruz",
    name_extension: "",
    gender: "Female",
    dob: "1988-04-12",
    pob: "Puerto Princesa City, Palawan",
    civil_status: "Married",
    blood_type: "O+",
    designation: "Provincial Environment & Natural Resources Officer",
    department: "Office of the Provincial ENR Officer",
    employment_type: "PERMANENT",
    item_code: "PENRO-1-001",
    date_employed: "2015-06-01",
    salary_grade: "SG 26 - Step 4",
    duty_status: "Active",
    mobile: "0917-555-0101",
    email: "maria.delacruz@pgenro.gov.ph",
    address: "Bgy. San Pedro, Puerto Princesa City, Palawan",
    updated_at: new Date().toISOString()
  },
  {
    id: "emp_002",
    employee_id: "EMP-2026-002",
    first_name: "Roberto",
    middle_name: "Alcantara",
    last_name: "Reyes",
    name_extension: "Jr.",
    gender: "Male",
    dob: "1992-09-23",
    pob: "Roxas, Palawan",
    civil_status: "Single",
    blood_type: "A+",
    designation: "Senior Environmental Management Specialist",
    department: "Environmental Management & Pollution Control",
    employment_type: "PERMANENT",
    item_code: "SEMS-2-005",
    date_employed: "2018-03-15",
    salary_grade: "SG 18 - Step 2",
    duty_status: "Active",
    mobile: "0920-555-0188",
    email: "roberto.reyes@pgenro.gov.ph",
    address: "Bgy. Santa Monica, Puerto Princesa City, Palawan",
    updated_at: new Date().toISOString()
  },
  {
    id: "emp_003",
    employee_id: "EMP-2026-003",
    first_name: "Aileen",
    middle_name: "Villanueva",
    last_name: "Castro",
    name_extension: "",
    gender: "Female",
    dob: "1995-11-04",
    pob: "Brooke's Point, Palawan",
    civil_status: "Single",
    blood_type: "B+",
    designation: "Forest Ranger / Field Inspector",
    department: "Forest Management Unit",
    employment_type: "CASUAL",
    item_code: "FR-CAS-012",
    date_employed: "2021-08-10",
    salary_grade: "SG 8 - Step 1",
    duty_status: "On Leave",
    mobile: "0998-555-0142",
    email: "aileen.castro@pgenro.gov.ph",
    address: "Poblacion, Brooke's Point, Palawan",
    updated_at: new Date().toISOString()
  },
  {
    id: "emp_004",
    employee_id: "EMP-2026-004",
    first_name: "Michael",
    middle_name: "Tan",
    last_name: "Lim",
    name_extension: "",
    gender: "Male",
    dob: "1997-02-18",
    pob: "Coron, Palawan",
    civil_status: "Single",
    blood_type: "AB+",
    designation: "GIS & Mapping Technician",
    department: "Coastal & Marine Resources Division",
    employment_type: "JOB ORDER",
    item_code: "JO-GIS-009",
    date_employed: "2023-01-16",
    salary_grade: "SG 11 - Flat",
    duty_status: "Active",
    mobile: "0919-555-0163",
    email: "michael.lim@pgenro.gov.ph",
    address: "Bgy. Bancao-Bancao, Puerto Princesa City",
    updated_at: new Date().toISOString()
  }
];

// Document Initialization
document.addEventListener("DOMContentLoaded", async () => {
  lucide.createIcons();
  bindUIEvents();
  initStorage();

  if (isSupabaseConfigured) {
    await loadEmployees();
    supabase.channel("employees-admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, loadEmployees)
      .subscribe();
  } else {
    setStatus(false, "Offline / Demo Mode (Set Supabase URL)");
    loadFromLocalStorage();
  }
});

function initStorage() {
  if (!localStorage.getItem("pgenro_admin_employees")) {
    localStorage.setItem("pgenro_admin_employees", JSON.stringify(DEMO_EMPLOYEES));
  }
}

function loadFromLocalStorage() {
  employees = JSON.parse(localStorage.getItem("pgenro_admin_employees")) || [];
  render();
}

function saveToLocalStorage() {
  localStorage.setItem("pgenro_admin_employees", JSON.stringify(employees));
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

  // Action buttons
  $("addEmployeeBtn").onclick = () => openEmployeeModal();
  $("exportBtn").onclick = exportCSV;
  $("printDossierBtn").onclick = () => window.print();

  $("refreshBtn").onclick = async () => {
    if (isSupabaseConfigured) await loadEmployees();
    else loadFromLocalStorage();
    toast("Personnel directory refreshed", "success");
  };

  $("dossierEditBtn").onclick = () => {
    if (currentViewingId) {
      closeModal("profileModal");
      openEmployeeModal(currentViewingId);
    }
  };

  // Form submission
  $("employeeForm").onsubmit = saveEmployee;

  // Search & Filters
  $("searchInput").oninput = render;
  $("globalSearch").oninput = () => {
    $("searchInput").value = $("globalSearch").value;
    render();
  };
  $("filterEmploymentType").onchange = render;
  $("filterDepartment").onchange = render;
  $("filterStatus").onchange = render;

  // Modals close button handlers
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });

  // Shortcuts (Ctrl/Cmd + K and ESC)
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
async function loadEmployees() {
  setStatus(true, "Connecting...");
  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .order("last_name", { ascending: true });

  if (error) {
    console.error(error);
    setStatus(false, "Connection error");
    toast(error.message, "error");
    loadFromLocalStorage();
    return;
  }
  employees = data || [];
  saveToLocalStorage();
  setStatus(true, "Connected • Live");
  render();
}

function setStatus(online, text) {
  $("statusDot").className = `status-dot ${online ? "online" : "offline"}`;
  $("statusText").textContent = text;
}

// Render Table and Metrics
function render() {
  const search = $("searchInput").value.trim().toLowerCase();
  const filterType = $("filterEmploymentType").value;
  const filterDept = $("filterDepartment").value;
  const filterStat = $("filterStatus").value;

  const rows = employees.filter((emp) => {
    const fullName = `${emp.first_name || ""} ${emp.middle_name || ""} ${emp.last_name || ""} ${emp.name_extension || ""}`.toLowerCase();
    const query = `${fullName} ${emp.employee_id || ""} ${emp.designation || ""} ${emp.department || ""} ${emp.item_code || ""} ${emp.email || ""}`.toLowerCase();

    const matchesSearch = !search || query.includes(search);
    const matchesType = !filterType || emp.employment_type === filterType;
    const matchesDept = !filterDept || emp.department === filterDept;
    const matchesStat = !filterStat || emp.duty_status === filterStat;

    return matchesSearch && matchesType && matchesDept && matchesStat;
  });

  const tbody = $("employeeTable");
  tbody.innerHTML = rows.length
    ? rows.map(rowHTML).join("")
    : `<tr><td colspan="8" class="empty">No personnel records found matching filters.</td></tr>`;

  // Attach dynamic row actions
  tbody.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => openProfileModal(b.dataset.view)));
  tbody.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openEmployeeModal(b.dataset.edit)));
  tbody.querySelectorAll("[data-delete]").forEach((b) => (b.onclick = () => deleteEmployee(b.dataset.delete)));

  // Update Counters & Metrics
  const total = employees.length;
  const active = employees.filter((e) => e.duty_status === "Active").length;
  const leave = employees.filter((e) => e.duty_status === "On Leave").length;
  const departments = [...new Set(employees.map((e) => e.department).filter(Boolean))];
  const activePct = total > 0 ? Math.round((active / total) * 100) : 0;

  $("metricTotal").textContent = total.toLocaleString();
  $("metricActive").textContent = active.toLocaleString();
  $("metricActivePct").textContent = `${activePct}% of workforce`;
  $("metricLeave").textContent = leave.toLocaleString();
  $("metricDepts").textContent = departments.length.toLocaleString();

  $("recordCounter").textContent = `Showing ${rows.length} of ${total} Staff`;

  // Populate Department dropdown filter if needed
  const currentDept = $("filterDepartment").value;
  $("filterDepartment").innerHTML =
    `<option value="">All Divisions</option>` +
    departments.sort().map((d) => `<option value="${escapeAttr(d)}">${escapeHTML(d)}</option>`).join("");
  if (departments.includes(currentDept)) $("filterDepartment").value = currentDept;

  lucide.createIcons();
}

function rowHTML(emp) {
  const initials = `${(emp.first_name || "")[0] || ""}${(emp.last_name || "")[0] || ""}`.toUpperCase() || "--";
  const fullName = `${emp.last_name || ""}, ${emp.first_name || ""} ${emp.middle_name ? emp.middle_name[0] + "." : ""} ${emp.name_extension || ""}`.trim();
  const duty = emp.duty_status || "Active";
  const dutyClass = duty === "Active" ? "active" : duty === "On Leave" ? "leave" : "inactive";

  return `<tr>
    <td><span class="id-badge">${escapeHTML(emp.employee_id || "—")}</span></td>
    <td>
      <div class="employee-cell">
        <div class="profile-avatar">${initials}</div>
        <div>
          <span class="employee-name">${escapeHTML(fullName)}</span>
          <span class="employee-sub">${escapeHTML(emp.gender || "—")} &bull; ${escapeHTML(emp.civil_status || "—")}</span>
        </div>
      </div>
    </td>
    <td>
      <b>${escapeHTML(emp.designation || "—")}</b>
      <span class="employee-sub">Item: ${escapeHTML(emp.item_code || "Plantilla N/A")}</span>
    </td>
    <td><span class="type-pill">${escapeHTML(emp.employment_type || "N/A")}</span></td>
    <td>${escapeHTML(emp.department || "—")}</td>
    <td>
      <span style="font-weight:700; color:var(--slate-800);">${escapeHTML(emp.mobile || "—")}</span>
      <span class="employee-sub">${escapeHTML(emp.email || "No email on file")}</span>
    </td>
    <td><span class="badge ${dutyClass}">${escapeHTML(duty)}</span></td>
    <td>
      <div class="actions">
        <button class="action view" title="View 201 Dossier" data-view="${emp.id}">
          <i data-lucide="eye"></i>
        </button>
        <button class="action" title="Edit Profile" data-edit="${emp.id}">
          <i data-lucide="pencil"></i>
        </button>
        <button class="action delete" title="Delete Record" data-delete="${emp.id}">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </td>
  </tr>`;
}

// Add or Edit Employee Form
function openEmployeeModal(id = null) {
  editingId = id;
  $("employeeForm").reset();

  if (id) {
    const emp = employees.find((x) => String(x.id) === String(id));
    if (!emp) return;
    $("employeeModalTitle").textContent = "Edit Employee Masterfile";
    $("empId").value = emp.employee_id || "";
    $("empFirstName").value = emp.first_name || "";
    $("empMiddleName").value = emp.middle_name || "";
    $("empLastName").value = emp.last_name || "";
    $("empExtension").value = emp.name_extension || "";
    $("empGender").value = emp.gender || "Male";
    $("empDob").value = emp.dob || "";
    $("empPob").value = emp.pob || "";
    $("empCivilStatus").value = emp.civil_status || "Single";
    $("empBloodType").value = emp.blood_type || "";
    $("empDesignation").value = emp.designation || "";
    $("empDepartment").value = emp.department || "";
    $("empStatusType").value = emp.employment_type || "PERMANENT";
    $("empItemCode").value = emp.item_code || "";
    $("empDateEmployed").value = emp.date_employed || "";
    $("empSalaryGrade").value = emp.salary_grade || "";
    $("empDutyStatus").value = emp.duty_status || "Active";
    $("empMobile").value = emp.mobile || "";
    $("empEmail").value = emp.email || "";
    $("empAddress").value = emp.address || "";
  } else {
    $("employeeModalTitle").textContent = "Add New Employee";
    $("empId").value = `EMP-2026-${String(employees.length + 1).padStart(3, "0")}`;
  }

  openModal("employeeFormModal");
}

async function saveEmployee(e) {
  e.preventDefault();
  const payload = {
    employee_id: $("empId").value.trim(),
    first_name: $("empFirstName").value.trim(),
    middle_name: $("empMiddleName").value.trim(),
    last_name: $("empLastName").value.trim(),
    name_extension: $("empExtension").value.trim(),
    gender: $("empGender").value,
    dob: $("empDob").value || null,
    pob: $("empPob").value.trim(),
    civil_status: $("empCivilStatus").value,
    blood_type: $("empBloodType").value.trim(),
    designation: $("empDesignation").value.trim(),
    department: $("empDepartment").value.trim(),
    employment_type: $("empStatusType").value,
    item_code: $("empItemCode").value.trim(),
    date_employed: $("empDateEmployed").value || null,
    salary_grade: $("empSalaryGrade").value.trim(),
    duty_status: $("empDutyStatus").value,
    mobile: $("empMobile").value.trim(),
    email: $("empEmail").value.trim(),
    address: $("empAddress").value.trim(),
    updated_at: new Date().toISOString()
  };

  if (!payload.employee_id || !payload.first_name || !payload.last_name || !payload.designation || !payload.department) {
    return toast("Please fill in all mandatory fields indicated with an asterisk (*).", "error");
  }

  $("saveEmployeeBtn").disabled = true;

  if (isSupabaseConfigured) {
    let result;
    if (editingId) {
      result = await supabase.from("employees").update(payload).eq("id", editingId);
    } else {
      result = await supabase.from("employees").insert(payload);
    }
    $("saveEmployeeBtn").disabled = false;

    if (result.error) return toast(result.error.message, "error");
    await loadEmployees();
  } else {
    // Offline Storage
    if (editingId) {
      const idx = employees.findIndex((x) => String(x.id) === String(editingId));
      if (idx !== -1) employees[idx] = { ...employees[idx], ...payload };
    } else {
      payload.id = "emp_" + Date.now();
      employees.unshift(payload);
    }
    saveToLocalStorage();
    render();
    $("saveEmployeeBtn").disabled = false;
  }

  closeModal("employeeFormModal");
  toast(editingId ? "Employee profile updated." : "New employee enrolled.", "success");
}

async function deleteEmployee(id) {
  const emp = employees.find((x) => String(x.id) === String(id));
  if (!emp || !confirm(`Permanently remove ${emp.first_name} ${emp.last_name} from personnel records?`)) return;

  if (isSupabaseConfigured) {
    const { error } = await supabase.from("employees").delete().eq("id", id);
    if (error) return toast(error.message, "error");
    await loadEmployees();
  } else {
    employees = employees.filter((x) => String(x.id) !== String(id));
    saveToLocalStorage();
    render();
  }
  toast("Employee record deleted.", "success");
}

// View 201 Dossier Modal
function openProfileModal(id) {
  currentViewingId = id;
  const emp = employees.find((x) => String(x.id) === String(id));
  if (!emp) return;

  const initials = `${(emp.first_name || "")[0] || ""}${(emp.last_name || "")[0] || ""}`.toUpperCase() || "--";
  const fullName = `${emp.first_name || ""} ${emp.middle_name || ""} ${emp.last_name || ""} ${emp.name_extension || ""}`.trim();
  const duty = emp.duty_status || "Active";
  const dutyClass = duty === "Active" ? "active" : duty === "On Leave" ? "leave" : "inactive";

  $("viewAvatar").textContent = initials;
  $("viewHeadingName").textContent = fullName;
  $("viewPillStatus").textContent = duty;
  $("viewPillStatus").className = `badge ${dutyClass}`;

  // Fill Dossier Fields
  $("v_id").textContent = emp.employee_id || "—";
  $("v_name").textContent = fullName || "—";
  $("v_dob").textContent = emp.dob ? new Date(emp.dob).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—";
  $("v_pob").textContent = emp.pob || "—";
  $("v_gender").textContent = emp.gender || "—";
  $("v_civil").textContent = emp.civil_status || "—";
  $("v_blood").textContent = emp.blood_type || "—";

  $("v_desig").textContent = emp.designation || "—";
  $("v_emp_status").textContent = emp.employment_type || "—";
  $("v_dept").textContent = emp.department || "—";
  $("v_item").textContent = emp.item_code || "—";
  $("v_date_employed").textContent = emp.date_employed ? new Date(emp.date_employed).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—";
  $("v_salary_gradestep").textContent = emp.salary_grade || "—";

  $("v_mobile").textContent = emp.mobile || "—";
  $("v_email").textContent = emp.email || "—";
  $("v_address").textContent = emp.address || "—";

  openModal("profileModal");
}

// Export CSV Masterlist
function exportCSV() {
  if (!employees.length) return toast("No employee records to export.", "error");

  const headers = [
    "Employee ID",
    "Last Name",
    "First Name",
    "Middle Name",
    "Extension",
    "Gender",
    "Date of Birth",
    "Designation",
    "Department",
    "Employment Type",
    "Item No",
    "Duty Status",
    "Mobile",
    "Email"
  ];

  const rows = employees.map((e) => [
    e.employee_id,
    e.last_name,
    e.first_name,
    e.middle_name,
    e.name_extension,
    e.gender,
    e.dob,
    e.designation,
    e.department,
    e.employment_type,
    e.item_code,
    e.duty_status,
    e.mobile,
    e.email
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pgenro_personnel_roster_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Personnel masterlist exported.", "success");
}

// Modal & UI Utils
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