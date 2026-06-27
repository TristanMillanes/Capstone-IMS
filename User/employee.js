// Navigation Elements
const hamburgerMenu = document.getElementById("hamburgerMenu");
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const mainContent = document.querySelector(".main-content");

// Form Elements
const employeeForm = document.getElementById("employeeForm");
const employeeTable = document.getElementById("employeeTable");
const searchInput = document.getElementById("searchInput");
const submitBtn = document.getElementById("submitBtn");
const toggleFormBtn = document.getElementById("toggleFormBtn");
const formSection = document.getElementById("formSection");
const cancelBtn = document.getElementById("cancelBtn");
const clearFormBtn = document.getElementById("clearFormBtn");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const formTitle = document.getElementById("formTitle");

// Form Tabs
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

// Toolbar Dropdown Filters
const filterEmploymentType = document.getElementById("filterEmploymentType");
const filterDepartment = document.getElementById("filterDepartment");
const filterStatus = document.getElementById("filterStatus");

// Data Export
const exportBtn = document.getElementById("exportBtn");

// Modals
const profileModal = document.getElementById("profileModal");
const uniformModal = document.getElementById("uniformModal");
const uniformPrescriptionForm = document.getElementById("uniformPrescriptionForm");
const uniformEmpIndexInput = document.getElementById("uniformEmpIndex");
const uniformTypeSelect = document.getElementById("uniformType");
const uniformSizeSelect = document.getElementById("uniformSize");

// Context Menu Element
const customContextMenu = document.getElementById("customContextMenu");
let contextSelectedEmployeeIndex = null;

let employees = JSON.parse(localStorage.getItem("employees")) || [];

// Initialize Lucide Icons
if (window.lucide) {
  lucide.createIcons();
}

// Toast Alert System
function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  let iconName = "check-circle";
  if (type === "danger") iconName = "alert-triangle";
  if (type === "info") iconName = "info";

  toast.innerHTML = `
    <i data-lucide="${iconName}" style="width: 16px; height: 16px;"></i>
    <span class="toast-message">${message}</span>
  `;
  
  container.appendChild(toast);
  if (window.lucide) {
    lucide.createIcons();
  }

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

// Drawer Controls
function openDrawer(isEdit = false) {
  formSection.classList.add("open");
  drawerBackdrop.classList.add("active");
  formTitle.textContent = isEdit ? "Modify Employee Record" : "Add New Employee Folder";
  switchTab("tabPersonal");
}

function closeDrawer() {
  formSection.classList.remove("open");
  drawerBackdrop.classList.remove("active");
  employeeForm.reset();
  document.getElementById("editIndex").value = "";
  submitBtn.textContent = "Save Employee Folder";
}

// Sidebar Navigation
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

// Bind UI triggers
toggleFormBtn.addEventListener("click", () => openDrawer(false));
cancelBtn.addEventListener("click", closeDrawer);
drawerBackdrop.addEventListener("click", closeDrawer);

// Clear Form Trigger
clearFormBtn.addEventListener("click", () => {
  if (confirm("Clear all entries on this form?")) {
    employeeForm.reset();
    showToast("Form fields cleared.", "info");
  }
});

// Tab navigation handler
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const targetTab = btn.getAttribute("data-tab");
    switchTab(targetTab);
  });
});

function switchTab(tabId) {
  tabButtons.forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
  });
  tabContents.forEach(content => {
    content.classList.toggle("active", content.id === tabId);
  });
}

// Initials Avatar generator
function getInitials(first, last) {
  if (!first || !last) return "EE";
  return (first[0] + last[0]).toUpperCase();
}

function getAvatarGradient(name) {
  const gradients = [
    "linear-gradient(135deg, #10b981, #059669)", 
    "linear-gradient(135deg, #3b82f6, #1d4ed8)", 
    "linear-gradient(135deg, #8b5cf6, #6d28d9)", 
    "linear-gradient(135deg, #f59e0b, #d97706)", 
    "linear-gradient(135deg, #ec4899, #be185d)"
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
}

// Calculate KPI cards
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

// Department dropdown filter values populator
function populateDepartmentFilter() {
  const currentSelectedValue = filterDepartment.value;
  const uniqueDepts = [...new Set(employees.map(e => e.department?.trim()).filter(Boolean))].sort();
  
  filterDepartment.innerHTML = '<option value="">All Departments</option>';
  uniqueDepts.forEach(dept => {
    const option = document.createElement("option");
    option.value = dept;
    option.textContent = dept;
    filterDepartment.appendChild(option);
  });

  if (uniqueDepts.includes(currentSelectedValue)) {
    filterDepartment.value = currentSelectedValue;
  }
}

// Save & Update Submit Handlers
employeeForm.addEventListener("submit", function (e) {
  e.preventDefault();

  const editIndex = document.getElementById("editIndex").value;
  const employeeIdVal = document.getElementById("employeeId").value.trim();

  const duplicateExists = employees.some((emp, idx) => {
    return emp.employeeId.toLowerCase() === employeeIdVal.toLowerCase() && idx.toString() !== editIndex;
  });

  if (duplicateExists) {
    showToast(`Employee ID "${employeeIdVal}" is already registered.`, "danger");
    return;
  }

  // Preserve existing custom context fields (uniform, flag) if editing
  let existingUniform = "";
  let existingFlag = "";
  if (editIndex !== "") {
    existingUniform = employees[editIndex].prescribedUniform || "";
    existingFlag = employees[editIndex].lastFlagCeremony || "";
  }

  const employee = {
    employeeId: employeeIdVal,
    firstName: document.getElementById("firstName").value.trim(),
    lastName: document.getElementById("lastName").value.trim(),
    middleName: document.getElementById("middleName").value.trim(),
    extName: document.getElementById("extName").value.trim(),
    dob: document.getElementById("dob").value,
    birthPlace: document.getElementById("birthPlace").value.trim(),
    gender: document.getElementById("gender").value,
    civilStatus: document.getElementById("civilStatus").value,
    religion: document.getElementById("religion").value.trim(),
    height: document.getElementById("height").value,
    weight: document.getElementById("weight").value,
    bloodType: document.getElementById("bloodType").value.trim(),
    
    purok: document.getElementById("purok").value.trim(),
    barangay: document.getElementById("barangay").value.trim(),
    municipality: document.getElementById("municipality").value.trim(),
    province: document.getElementById("province").value.trim(),
    zipCode: document.getElementById("zipCode").value.trim(),
    
    employmentStatus: document.getElementById("employmentStatus").value,
    designation: document.getElementById("designation").value.trim(),
    department: document.getElementById("department").value.trim(),
    itemNo: document.getElementById("itemNo").value.trim(),
    dateEmployed: document.getElementById("dateEmployed").value,
    dateAssumption: document.getElementById("dateAssumption").value,
    salaryGrade: document.getElementById("salaryGrade").value,
    stepNo: document.getElementById("stepNo").value,
    nosa: document.getElementById("nosa").value,
    basicSalary: document.getElementById("basicSalary").value,
    eligibility: document.getElementById("eligibility").value.trim(),
    status: document.getElementById("status").value,
    
    tin: document.getElementById("tin").value.trim(),
    gsis: document.getElementById("gsis").value.trim(),
    pagibig: document.getElementById("pagibig").value.trim(),
    philhealth: document.getElementById("philhealth").value.trim(),
    
    spouseLastName: document.getElementById("spouseLastName").value.trim(),
    spouseFirstName: document.getElementById("spouseFirstName").value.trim(),
    spouseMiddleName: document.getElementById("spouseMiddleName").value.trim(),
    spouseExtName: document.getElementById("spouseExtName").value.trim(),
    spouseOccupation: document.getElementById("spouseOccupation").value.trim(),
    spouseEmployer: document.getElementById("spouseEmployer").value.trim(),
    spouseContact: document.getElementById("spouseContact").value.trim(),
    spouseEmail: document.getElementById("spouseEmail").value.trim(),
    
    landline: document.getElementById("landline").value.trim(),
    mobile1: document.getElementById("mobile1").value.trim(),
    mobile2: document.getElementById("mobile2").value.trim(),
    email: document.getElementById("email").value.trim(),
    facebook: document.getElementById("facebook").value.trim(),
    instagram: document.getElementById("instagram").value.trim(),
    twitter: document.getElementById("twitter").value.trim(),
    
    eduLevel: document.getElementById("eduLevel").value,
    eduCourse: document.getElementById("eduCourse").value.trim(),
    eduSchool: document.getElementById("eduSchool").value.trim(),
    eduYear: document.getElementById("eduYear").value,
    
    prescribedUniform: existingUniform,
    lastFlagCeremony: existingFlag
  };

  if (editIndex === "") {
    employees.push(employee);
    showToast("Added new employee successfully.", "success");
  } else {
    employees[editIndex] = employee;
    showToast("Employee record successfully updated.", "success");
  }

  localStorage.setItem("employees", JSON.stringify(employees));
  closeDrawer();
  displayEmployees();
  updateMetrics();
  populateDepartmentFilter();
});

// Render Core Directory Table with filters matching both drop-downs
function displayEmployees() {
  const keyword = searchInput.value.toLowerCase();
  const selectedEmploymentType = filterEmploymentType.value;
  const selectedDept = filterDepartment.value;
  const selectedStatus = filterStatus.value;

  const filtered = employees.filter(employee => {
    const fullNameCombined = `${employee.firstName} ${employee.lastName}`.toLowerCase();
    
    const matchesKeyword = (
      employee.employeeId.toLowerCase().includes(keyword) ||
      fullNameCombined.includes(keyword) ||
      (employee.designation && employee.designation.toLowerCase().includes(keyword)) ||
      (employee.eligibility && employee.eligibility.toLowerCase().includes(keyword)) ||
      (employee.department && employee.department.toLowerCase().includes(keyword))
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
        <td colspan="8" style="text-align:center; padding: 40px; color: var(--muted); font-weight: 700; background: #fafafa;">
          <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
            <i data-lucide="folder-open" style="width: 32px; height: 32px; color: var(--muted); stroke-width: 1.5;"></i>
            <span>No matching employee folders found</span>
          </div>
        </td>
      </tr>
    `;
    if (window.lucide) {
      lucide.createIcons();
    }
    return;
  }

  filtered.forEach((employee) => {
    const originalIndex = employees.findIndex(emp => emp.employeeId === employee.employeeId);
    
    const statusClass = (employee.status || "Active").replace(" ", "");
    const initials = getInitials(employee.firstName, employee.lastName);
    const fullName = `${employee.firstName} ${employee.lastName}`;
    const bgGradient = getAvatarGradient(fullName);

    // Map correct employment pill class
    let employmentPillClass = "ep-permanent";
    const empStatusStr = (employee.employmentStatus || "").toUpperCase();
    if (empStatusStr.includes("CASUAL")) employmentPillClass = "ep-casual";
    else if (empStatusStr.includes("JOB ORDER")) employmentPillClass = "ep-joborder";
    else if (empStatusStr.includes("CONTRACTUAL")) employmentPillClass = "ep-contractual";
    else if (empStatusStr.includes("CO-TERMINUS")) employmentPillClass = "ep-coterminus";

    employeeTable.innerHTML += `
      <tr data-original-index="${originalIndex}">
        <td><strong>${employee.employeeId}</strong></td>
        <td>
          <div class="avatar-cell">
            <div class="avatar" style="background: ${bgGradient};">${initials}</div>
            <div class="employee-main-info">
              <span class="emp-name">${fullName}</span>
            </div>
          </div>
        </td>
        <td>${employee.designation || "N/A"}</td>
        <td><span class="emp-status-pill ${employmentPillClass}">${employee.employmentStatus || "N/A"}</span></td>
        <td>${employee.department || "N/A"}</td>
        <td>
          <div class="contact-cell-info">
            <span class="contact-email">${employee.email || "N/A"}</span>
            <span class="contact-phone">${employee.mobile1 || "N/A"}</span>
          </div>
        </td>
        <td>
          <span class="status ${statusClass}">
            ${employee.status || "Active"}
          </span>
        </td>
        <td class="text-center" onclick="event.stopPropagation();">
          <button class="action-btn view-btn" onclick="viewEmployee(${originalIndex})" title="View Full Folder">
            <i data-lucide="eye" style="width: 13px; height: 13px;"></i>
          </button>
          <button class="action-btn edit" onclick="editEmployee(${originalIndex})" title="Edit Record">
            <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i>
          </button>
          <button class="action-btn delete" onclick="deleteEmployee(${originalIndex})" title="Delete Record">
            <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
          </button>
        </td>
      </tr>
    `;
  });

  if (window.lucide) {
    lucide.createIcons();
  }
}

// View Employee Profile Dossier Details
window.viewEmployee = function(index) {
  const emp = employees[index];
  const fullName = `${emp.firstName} ${emp.middleName || ""} ${emp.lastName} ${emp.extName || ""}`.trim();
  
  document.getElementById("viewHeadingName").textContent = fullName;
  document.getElementById("viewAvatar").textContent = getInitials(emp.firstName, emp.lastName);
  document.getElementById("viewAvatar").style.background = getAvatarGradient(fullName);
  document.getElementById("viewPillStatus").className = `view-status-pill ${emp.status || "Active"}`;
  document.getElementById("viewPillStatus").textContent = emp.status || "Active";

  // Bind parameters
  document.getElementById("v_id").textContent = emp.employeeId;
  document.getElementById("v_dob").textContent = emp.dob || "N/A";
  document.getElementById("v_pob").textContent = emp.birthPlace || "N/A";
  document.getElementById("v_gender").textContent = emp.gender === "M" ? "Male (M)" : emp.gender === "F" ? "Female (F)" : "N/A";
  document.getElementById("v_civil").textContent = emp.civilStatus || "N/A";
  document.getElementById("v_religion").textContent = emp.religion || "N/A";
  document.getElementById("v_metrics").textContent = `${emp.height ? emp.height + " cm" : "N/A"} / ${emp.weight ? emp.weight + " kg" : "N/A"}`;
  document.getElementById("v_blood").textContent = emp.bloodType || "N/A";

  document.getElementById("v_desig").textContent = emp.designation || "N/A";
  document.getElementById("v_emp_status").textContent = emp.employmentStatus || "N/A";
  document.getElementById("v_dept").textContent = emp.department || "N/A";
  document.getElementById("v_item").textContent = emp.itemNo || "N/A";
  document.getElementById("v_date_employed").textContent = emp.dateEmployed || "N/A";
  document.getElementById("v_date_assumption").textContent = emp.dateAssumption || "N/A";
  document.getElementById("v_salary_gradestep").textContent = `SG ${emp.salaryGrade || "N/A"} - Step ${emp.stepNo || "N/A"}`;
  document.getElementById("v_salary").textContent = emp.basicSalary ? `₱${parseFloat(emp.basicSalary).toLocaleString('en-US', {minimumFractionDigits: 2})}` : "N/A";
  document.getElementById("v_nosa").textContent = emp.nosa || "N/A";
  document.getElementById("v_eligibility").textContent = emp.eligibility || "N/A";

  document.getElementById("v_tin").textContent = emp.tin || "N/A";
  document.getElementById("v_gsis").textContent = emp.gsis || "N/A";
  document.getElementById("v_pagibig").textContent = emp.pagibig || "N/A";
  document.getElementById("v_philhealth").textContent = emp.philhealth || "N/A";

  document.getElementById("v_street").textContent = emp.purok || "N/A";
  document.getElementById("v_barangay").textContent = emp.barangay || "N/A";
  document.getElementById("v_municipality").textContent = emp.municipality || "N/A";
  document.getElementById("v_province").textContent = emp.province || "N/A";
  document.getElementById("v_zip").textContent = emp.zipCode || "N/A";

  document.getElementById("v_edu_level").textContent = emp.eduLevel || "N/A";
  document.getElementById("v_edu_course").textContent = emp.eduCourse || "N/A";
  document.getElementById("v_edu_school").textContent = emp.eduSchool || "N/A";
  document.getElementById("v_edu_year").textContent = emp.eduYear || "N/A";

  document.getElementById("v_landline").textContent = emp.landline || "N/A";
  document.getElementById("v_mobile1").textContent = emp.mobile1 || "N/A";
  document.getElementById("v_mobile2").textContent = emp.mobile2 || "N/A";
  document.getElementById("v_email").textContent = emp.email || "N/A";
  document.getElementById("v_facebook").textContent = emp.facebook || "N/A";
  document.getElementById("v_instagram").textContent = emp.instagram || "N/A";
  document.getElementById("v_twitter").textContent = emp.twitter || "N/A";

  const spouseFullName = `${emp.spouseFirstName || ""} ${emp.spouseMiddleName || ""} ${emp.spouseLastName || ""}`.trim();
  document.getElementById("v_spouse_name").textContent = spouseFullName || "N/A";
  document.getElementById("v_spouse_job").textContent = emp.spouseOccupation || "N/A";
  document.getElementById("v_spouse_employer").textContent = emp.spouseEmployer || "N/A";
  document.getElementById("v_spouse_phone").textContent = emp.spouseContact || "N/A";
  document.getElementById("v_spouse_email").textContent = emp.spouseEmail || "N/A";

  // Bind Dynamic Uniform and Flag logs
  document.getElementById("v_uniform_display").textContent = emp.prescribedUniform || "Not Prescribed";
  document.getElementById("v_flag_display").textContent = emp.lastFlagCeremony || "None Logged";

  profileModal.classList.add("active");
  if (window.lucide) {
    lucide.createIcons();
  }
};

window.closeProfileModal = function() {
  profileModal.classList.remove("active");
};

// Edit Record Trigger
window.editEmployee = function(index) {
  const emp = employees[index];

  document.getElementById("employeeId").value = emp.employeeId;
  document.getElementById("firstName").value = emp.firstName || "";
  document.getElementById("lastName").value = emp.lastName || "";
  document.getElementById("middleName").value = emp.middleName || "";
  document.getElementById("extName").value = emp.extName || "";
  document.getElementById("dob").value = emp.dob || "";
  document.getElementById("birthPlace").value = emp.birthPlace || "";
  document.getElementById("gender").value = emp.gender || "";
  document.getElementById("civilStatus").value = emp.civilStatus || "";
  document.getElementById("religion").value = emp.religion || "";
  document.getElementById("height").value = emp.height || "";
  document.getElementById("weight").value = emp.weight || "";
  document.getElementById("bloodType").value = emp.bloodType || "";
  
  document.getElementById("purok").value = emp.purok || "";
  document.getElementById("barangay").value = emp.barangay || "";
  document.getElementById("municipality").value = emp.municipality || "";
  document.getElementById("province").value = emp.province || "";
  document.getElementById("zipCode").value = emp.zipCode || "";
  
  document.getElementById("employmentStatus").value = emp.employmentStatus || "";
  document.getElementById("designation").value = emp.designation || "";
  document.getElementById("department").value = emp.department || "";
  document.getElementById("itemNo").value = emp.itemNo || "";
  document.getElementById("dateEmployed").value = emp.dateEmployed || "";
  document.getElementById("dateAssumption").value = emp.dateAssumption || "";
  document.getElementById("salaryGrade").value = emp.salaryGrade || "";
  document.getElementById("stepNo").value = emp.stepNo || "";
  document.getElementById("nosa").value = emp.nosa || "";
  document.getElementById("basicSalary").value = emp.basicSalary || "";
  document.getElementById("eligibility").value = emp.eligibility || "";
  document.getElementById("status").value = emp.status || "Active";
  
  document.getElementById("tin").value = emp.tin || "";
  document.getElementById("gsis").value = emp.gsis || "";
  document.getElementById("pagibig").value = emp.pagibig || "";
  document.getElementById("philhealth").value = emp.philhealth || "";
  
  document.getElementById("spouseLastName").value = emp.spouseLastName || "";
  document.getElementById("spouseFirstName").value = emp.spouseFirstName || "";
  document.getElementById("spouseMiddleName").value = emp.spouseMiddleName || "";
  document.getElementById("spouseExtName").value = emp.spouseExtName || "";
  document.getElementById("spouseOccupation").value = emp.spouseOccupation || "";
  document.getElementById("spouseEmployer").value = emp.spouseEmployer || "";
  document.getElementById("spouseContact").value = emp.spouseContact || "";
  document.getElementById("spouseEmail").value = emp.spouseEmail || "";
  
  document.getElementById("landline").value = emp.landline || "";
  document.getElementById("mobile1").value = emp.mobile1 || "";
  document.getElementById("mobile2").value = emp.mobile2 || "";
  document.getElementById("email").value = emp.email || "";
  document.getElementById("facebook").value = emp.facebook || "";
  document.getElementById("instagram").value = emp.instagram || "";
  document.getElementById("twitter").value = emp.twitter || "";
  
  document.getElementById("eduLevel").value = emp.eduLevel || "";
  document.getElementById("eduCourse").value = emp.eduCourse || "";
  document.getElementById("eduSchool").value = emp.eduSchool || "";
  document.getElementById("eduYear").value = emp.eduYear || "";

  document.getElementById("editIndex").value = index;
  submitBtn.textContent = "Update Profile";
  openDrawer(true);
};

// Delete Record Trigger
window.deleteEmployee = function(index) {
  if (confirm("Are you sure you want to permanently delete this employee record?")) {
    employees.splice(index, 1);
    localStorage.setItem("employees", JSON.stringify(employees));
    showToast("Employee record successfully deleted.", "danger");
    displayEmployees();
    updateMetrics();
    populateDepartmentFilter();
  }
};

// Custom desktop context menu handler
employeeTable.addEventListener("contextmenu", function(e) {
  const row = e.target.closest("tr");
  if (row) {
    const originalIndex = row.getAttribute("data-original-index");
    if (originalIndex !== null) {
      e.preventDefault();
      contextSelectedEmployeeIndex = parseInt(originalIndex);
      showContextMenu(e.clientX, e.clientY);
    }
  }
});

function showContextMenu(x, y) {
  customContextMenu.style.display = "block";
  
  // Viewport checking to avoid rendering context overflow bounds
  const menuWidth = 200;
  const menuHeight = 220;
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  
  let leftPos = x;
  let topPos = y;
  
  if ((x + menuWidth) > screenWidth) {
    leftPos = x - menuWidth;
  }
  if ((y + menuHeight) > screenHeight) {
    topPos = y - menuHeight;
  }
  
  customContextMenu.style.left = `${leftPos}px`;
  customContextMenu.style.top = `${topPos}px`;
}

function hideContextMenu() {
  customContextMenu.style.display = "none";
}

// Close Context menu when clicking elsewhere
document.addEventListener("click", function(e) {
  if (!customContextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

// Bind Context Menu Items
document.getElementById("menuEdit").addEventListener("click", () => {
  if (contextSelectedEmployeeIndex !== null) {
    editEmployee(contextSelectedEmployeeIndex);
    hideContextMenu();
  }
});

document.getElementById("menuView").addEventListener("click", () => {
  if (contextSelectedEmployeeIndex !== null) {
    viewEmployee(contextSelectedEmployeeIndex);
    hideContextMenu();
  }
});

document.getElementById("menuFlag").addEventListener("click", () => {
  if (contextSelectedEmployeeIndex !== null) {
    const emp = employees[contextSelectedEmployeeIndex];
    const timestamp = new Date().toLocaleDateString() + ' @ ' + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    emp.lastFlagCeremony = `Attended on ${timestamp}`;
    localStorage.setItem("employees", JSON.stringify(employees));
    
    showToast(`Flag Ceremony compliance logged for ${emp.firstName} ${emp.lastName}`, "success");
    displayEmployees();
    hideContextMenu();
  }
});

document.getElementById("menuUniform").addEventListener("click", () => {
  if (contextSelectedEmployeeIndex !== null) {
    openUniformModal(contextSelectedEmployeeIndex);
    hideContextMenu();
  }
});

document.getElementById("menuDelete").addEventListener("click", () => {
  if (contextSelectedEmployeeIndex !== null) {
    deleteEmployee(contextSelectedEmployeeIndex);
    hideContextMenu();
  }
});

// Prescribe Uniform Actions
function openUniformModal(index) {
  const emp = employees[index];
  uniformEmpIndexInput.value = index;
  
  // Set existing value if any
  if (emp.prescribedUniform) {
    const parts = emp.prescribedUniform.split(" (Size: ");
    if (parts.length === 2) {
      uniformTypeSelect.value = parts[0];
      uniformSizeSelect.value = parts[1].replace(")", "");
    }
  } else {
    uniformTypeSelect.value = "";
    uniformSizeSelect.value = "M";
  }
  
  uniformModal.classList.add("active");
}

window.closeUniformModal = function() {
  uniformModal.classList.remove("active");
  uniformPrescriptionForm.reset();
};

uniformPrescriptionForm.addEventListener("submit", function(e) {
  e.preventDefault();
  const index = parseInt(uniformEmpIndexInput.value);
  const type = uniformTypeSelect.value;
  const size = uniformSizeSelect.value;
  
  if (!isNaN(index) && employees[index]) {
    employees[index].prescribedUniform = `${type} (Size: ${size})`;
    localStorage.setItem("employees", JSON.stringify(employees));
    
    showToast(`Uniform prescribed for ${employees[index].firstName} ${employees[index].lastName}`, "success");
    closeUniformModal();
    displayEmployees();
  }
});

// Print Dossier trigger
window.printProfile = function() {
  window.print();
};

// Filter event triggers
searchInput.addEventListener("input", displayEmployees);
filterEmploymentType.addEventListener("change", displayEmployees);
filterDepartment.addEventListener("change", displayEmployees);
filterStatus.addEventListener("change", displayEmployees);

// Comprehensive CSV Exporter
exportBtn.addEventListener("click", () => {
  if (employees.length === 0) {
    showToast("No employee records to export.", "info");
    return;
  }

  const headers = [
    "Employee ID", "First Name", "Last Name", "Middle Name", "Ext Name", "Date of Birth", "Birth Place", "Gender", "Civil Status", "Religion", "Height (cm)", "Weight (kg)", "Blood Type",
    "Purok/Street Address", "Barangay", "Municipality", "Province", "Zip Code",
    "Employment Status", "Designation", "Department", "Item No.", "Date Employed", "Assumption Date", "Salary Grade", "Step No.", "NOSA Date", "Basic Salary", "Eligibility",
    "TIN", "GSIS No.", "PAGIBIG ID", "PhilHealth No.",
    "Spouse First Name", "Spouse Last Name", "Spouse Middle Name", "Spouse Extension", "Spouse Job", "Spouse Employer", "Spouse Phone", "Spouse Email",
    "Landline", "Mobile Line 1", "Mobile Line 2", "Official Email Address", "Facebook ID", "Instagram", "Twitter",
    "Education Level", "Course", "Institution", "Graduation Year", "Directory Status", "Prescribed Uniform", "Last Flag Ceremony Log"
  ];

  const rows = employees.map(emp => [
    `"${(emp.employeeId || "").replace(/"/g, '""')}"`,
    `"${(emp.firstName || "").replace(/"/g, '""')}"`,
    `"${(emp.lastName || "").replace(/"/g, '""')}"`,
    `"${(emp.middleName || "").replace(/"/g, '""')}"`,
    `"${(emp.extName || "").replace(/"/g, '""')}"`,
    `"${emp.dob || ""}"`,
    `"${(emp.birthPlace || "").replace(/"/g, '""')}"`,
    `"${emp.gender || ""}"`,
    `"${emp.civilStatus || ""}"`,
    `"${(emp.religion || "").replace(/"/g, '""')}"`,
    `"${emp.height || ""}"`,
    `"${emp.weight || ""}"`,
    `"${(emp.bloodType || "").replace(/"/g, '""')}"`,
    `"${(emp.purok || "").replace(/"/g, '""')}"`,
    `"${(emp.barangay || "").replace(/"/g, '""')}"`,
    `"${(emp.municipality || "").replace(/"/g, '""')}"`,
    `"${(emp.province || "").replace(/"/g, '""')}"`,
    `"${(emp.zipCode || "").replace(/"/g, '""')}"`,
    `"${emp.employmentStatus || ""}"`,
    `"${(emp.designation || "").replace(/"/g, '""')}"`,
    `"${(emp.department || "").replace(/"/g, '""')}"`,
    `"${(emp.itemNo || "").replace(/"/g, '""')}"`,
    `"${emp.dateEmployed || ""}"`,
    `"${emp.dateAssumption || ""}"`,
    `"${emp.salaryGrade || ""}"`,
    `"${emp.stepNo || ""}"`,
    `"${emp.nosa || ""}"`,
    `"${emp.basicSalary || ""}"`,
    `"${(emp.eligibility || "").replace(/"/g, '""')}"`,
    `"${(emp.tin || "").replace(/"/g, '""')}"`,
    `"${(emp.gsis || "").replace(/"/g, '""')}"`,
    `"${(emp.pagibig || "").replace(/"/g, '""')}"`,
    `"${(emp.philhealth || "").replace(/"/g, '""')}"`,
    `"${(emp.spouseFirstName || "").replace(/"/g, '""')}"`,
    `"${(emp.spouseLastName || "").replace(/"/g, '""')}"`,
    `"${(emp.spouseMiddleName || "").replace(/"/g, '""')}"`,
    `"${(emp.spouseExtName || "").replace(/"/g, '""')}"`,
    `"${(emp.spouseOccupation || "").replace(/"/g, '""')}"`,
    `"${(emp.spouseEmployer || "").replace(/"/g, '""')}"`,
    `"${(emp.spouseContact || "").replace(/"/g, '""')}"`,
    `"${(emp.spouseEmail || "").replace(/"/g, '""')}"`,
    `"${(emp.landline || "").replace(/"/g, '""')}"`,
    `"${(emp.mobile1 || "").replace(/"/g, '""')}"`,
    `"${(emp.mobile2 || "").replace(/"/g, '""')}"`,
    `"${(emp.email || "").replace(/"/g, '""')}"`,
    `"${(emp.facebook || "").replace(/"/g, '""')}"`,
    `"${(emp.instagram || "").replace(/"/g, '""')}"`,
    `"${(emp.twitter || "").replace(/"/g, '""')}"`,
    `"${emp.eduLevel || ""}"`,
    `"${(emp.eduCourse || "").replace(/"/g, '""')}"`,
    `"${(emp.eduSchool || "").replace(/"/g, '""')}"`,
    `"${emp.eduYear || ""}"`,
    `"${emp.status || "Active"}"`,
    `"${(emp.prescribedUniform || "").replace(/"/g, '""')}"`,
    `"${(emp.lastFlagCeremony || "").replace(/"/g, '""')}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," 
    + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `PGENRO_Master_Records_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  
  link.click();
  document.body.removeChild(link);
  showToast("Master directory successfully exported to CSV file.", "success");
});

// App Startup Initializers
updateMetrics();
populateDepartmentFilter();
displayEmployees();