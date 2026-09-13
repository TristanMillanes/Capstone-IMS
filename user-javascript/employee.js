const hamburgerMenu = document.getElementById("hamburgerMenu");
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const mainContent = document.querySelector(".main-content");

const employeeTable = document.getElementById("employeeTable");
const searchInput = document.getElementById("searchInput");
const filterEmploymentType = document.getElementById("filterEmploymentType");
const filterDepartment = document.getElementById("filterDepartment");
const filterStatus = document.getElementById("filterStatus");
const exportBtn = document.getElementById("exportBtn");
const profileModal = document.getElementById("profileModal");

// Database State: Empty Base
let employees = window.PGENRO_SUPABASE?.configured ? [] : (() => { try { const rows = JSON.parse(localStorage.getItem("employees") || "[]"); return Array.isArray(rows) ? rows : []; } catch { return []; } })();

if (window.lucide) lucide.createIcons();

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

function getInitials(first, last) {
  if (!first || !last) return "EE";
  return (first[0] + last[0]).toUpperCase();
}

function updateMetrics() {
  const total = employees.length;
  const activeCount = employees.filter(e => e.status === "Active").length;
  const leaveCount = employees.filter(e => e.status === "On Leave").length;
  const depts = [...new Set(employees.map(e => e.department?.trim()).filter(Boolean))];

  document.getElementById("metricTotal").textContent = total;
  document.getElementById("metricActive").textContent = activeCount;
  document.getElementById("metricLeave").textContent = leaveCount;
  document.getElementById("metricDepts").textContent = depts.length;

  const pct = total > 0 ? Math.round((activeCount / total) * 100) : 0;
  document.getElementById("metricActivePct").textContent = `${pct}% of workforce`;
}

function populateDepartmentFilter() {
  const uniqueDepts = [...new Set(employees.map(e => e.department?.trim()).filter(Boolean))].sort();
  filterDepartment.innerHTML = '<option value="">All Departments</option>';
  uniqueDepts.forEach(dept => {
    const option = document.createElement("option");
    option.value = dept;
    option.textContent = dept;
    filterDepartment.appendChild(option);
  });
}

function displayEmployees() {
  const keyword = searchInput.value.toLowerCase();
  const selectedEmploymentType = filterEmploymentType.value;
  const selectedDept = filterDepartment.value;
  const selectedStatus = filterStatus.value;

  const filtered = employees.filter(employee => {
    const fullName = `${employee.firstName || ""} ${employee.lastName || ""}`.toLowerCase();
    const matchesKeyword = (
      (employee.employeeId || "").toLowerCase().includes(keyword) ||
      fullName.includes(keyword) ||
      (employee.designation || "").toLowerCase().includes(keyword) ||
      (employee.department || "").toLowerCase().includes(keyword)
    );
    const matchesEmploymentType = !selectedEmploymentType || employee.employmentStatus === selectedEmploymentType;
    const matchesDept = !selectedDept || employee.department === selectedDept;
    const matchesStatus = !selectedStatus || employee.status === selectedStatus;

    return matchesKeyword && matchesEmploymentType && matchesDept && matchesStatus;
  });

  employeeTable.innerHTML = "";
  document.getElementById("recordCounter").textContent = `Showing ${filtered.length} of ${employees.length} Records`;

  if (filtered.length === 0) {
    employeeTable.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 40px; color: var(--muted); font-weight: 700;">
          No employee records found in database.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach((employee) => {
    const originalIndex = employees.indexOf(employee);
    const fullName = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
    const initials = getInitials(employee.firstName, employee.lastName);

    employeeTable.innerHTML += `
      <tr>
        <td><strong>${employee.employeeId || "-"}</strong></td>
        <td>
          <div class="avatar-cell">
            <div class="avatar" style="background: var(--primary);">${initials}</div>
            <div class="employee-main-info">
              <span class="emp-name">${fullName}</span>
            </div>
          </div>
        </td>
        <td>${employee.designation || "-"}</td>
        <td><span class="emp-status-pill">${employee.employmentStatus || "-"}</span></td>
        <td>${employee.department || "-"}</td>
        <td>
          <div class="contact-cell-info">
            <span class="contact-email">${employee.email || "-"}</span>
            <span class="contact-phone">${employee.mobile1 || "-"}</span>
          </div>
        </td>
        <td><span class="status ${(employee.status || "Active").replace(" ", "")}">${employee.status || "Active"}</span></td>
        <td class="text-center">
          <button class="action-btn view-btn" onclick="viewEmployee(${originalIndex})" title="Inspect Profile">
            <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
          </button>
        </td>
      </tr>
    `;
  });

  if (window.lucide) lucide.createIcons();
}

window.viewEmployee = function(index) {
  const emp = employees[index];
  if (!emp) return;
  
  const fullName = `${emp.firstName || ""} ${emp.middleName || ""} ${emp.lastName || ""}`.trim();
  document.getElementById("viewHeadingName").textContent = fullName || "Employee Profile";
  document.getElementById("viewAvatar").textContent = getInitials(emp.firstName, emp.lastName);
  document.getElementById("viewPillStatus").textContent = emp.status || "Active";

  document.getElementById("v_id").textContent = emp.employeeId || "—";
  document.getElementById("v_dob").textContent = emp.dob || "—";
  document.getElementById("v_pob").textContent = emp.birthPlace || "—";
  document.getElementById("v_gender").textContent = emp.gender || "—";
  document.getElementById("v_civil").textContent = emp.civilStatus || "—";
  document.getElementById("v_blood").textContent = emp.bloodType || "—";

  document.getElementById("v_desig").textContent = emp.designation || "—";
  document.getElementById("v_emp_status").textContent = emp.employmentStatus || "—";
  document.getElementById("v_dept").textContent = emp.department || "—";
  document.getElementById("v_item").textContent = emp.itemNo || "—";
  document.getElementById("v_date_employed").textContent = emp.dateEmployed || "—";
  document.getElementById("v_salary_gradestep").textContent = emp.salaryGrade ? `SG ${emp.salaryGrade}` : "—";

  document.getElementById("v_mobile").textContent = emp.mobile1 || "—";
  document.getElementById("v_email").textContent = emp.email || "—";
  document.getElementById("v_address").textContent = [emp.purok, emp.barangay, emp.municipality, emp.province].filter(Boolean).join(", ") || "—";

  profileModal.classList.add("active");
  if (window.lucide) lucide.createIcons();
};

window.closeProfileModal = function() {
  profileModal.classList.remove("active");
};

// Hook for database integration
window.loadDatabaseEmployees = function(dbEmployees) {
  employees = dbEmployees || [];
  updateMetrics();
  populateDepartmentFilter();
  displayEmployees();
};

searchInput.addEventListener("input", displayEmployees);
filterEmploymentType.addEventListener("change", displayEmployees);
filterDepartment.addEventListener("change", displayEmployees);
filterStatus.addEventListener("change", displayEmployees);

updateMetrics();
populateDepartmentFilter();
displayEmployees();