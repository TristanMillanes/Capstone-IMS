// Sidebar & Navbar Elements
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

let employees = JSON.parse(localStorage.getItem("employees")) || [];

// Initialize Lucide Icons
if (window.lucide) {
  lucide.createIcons();
}

// Sidebar Toggles
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

// Toggle Form Visibility
toggleFormBtn.addEventListener("click", () => {
  formSection.classList.remove("hidden");
});

cancelBtn.addEventListener("click", () => {
  formSection.classList.add("hidden");
  employeeForm.reset();
  document.getElementById("editIndex").value = "";
  submitBtn.textContent = "Save Employee";
});

// Form Submission
employeeForm.addEventListener("submit", function (e) {
  e.preventDefault();

  const editIndex = document.getElementById("editIndex").value;

  const employee = {
    employeeId: document.getElementById("employeeId").value,
    fullName: document.getElementById("fullName").value,
    position: document.getElementById("position").value,
    department: document.getElementById("department").value,
    email: document.getElementById("email").value,
    contact: document.getElementById("contact").value,
    dateHired: document.getElementById("dateHired").value,
    status: document.getElementById("status").value
  };

  if (editIndex === "") {
    employees.push(employee);
  } else {
    employees[editIndex] = employee;
    submitBtn.textContent = "Save Employee";
    document.getElementById("editIndex").value = "";
  }

  localStorage.setItem("employees", JSON.stringify(employees));
  employeeForm.reset();
  formSection.classList.add("hidden"); // Close form on save
  displayEmployees();
});

// Display Table
function displayEmployees(data = employees) {
  employeeTable.innerHTML = "";

  if (data.length === 0) {
    employeeTable.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding: 30px; color: var(--muted); font-weight: 800;">
          No employee records found
        </td>
      </tr>
    `;
    return;
  }

  data.forEach((employee, index) => {
    // Remove space for CSS class (e.g., "On Leave" -> "OnLeave")
    const statusClass = employee.status.replace(" ", "");

    employeeTable.innerHTML += `
      <tr>
        <td><strong>${employee.employeeId}</strong></td>
        <td>${employee.fullName}</td>
        <td>${employee.position}</td>
        <td>${employee.department}</td>
        <td>${employee.email}</td>
        <td>${employee.contact}</td>
        <td>${employee.dateHired}</td>
        <td>
          <span class="status ${statusClass}">
            ${employee.status}
          </span>
        </td>
        <td class="text-center">
          <button class="action-btn edit" onclick="editEmployee(${index})" title="Edit">
            <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
          </button>
          <button class="action-btn delete" onclick="deleteEmployee(${index})" title="Delete">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
          </button>
        </td>
      </tr>
    `;
  });

  // Re-render dynamically injected icons
  if (window.lucide) {
    lucide.createIcons();
  }
}

// Edit Record
window.editEmployee = function(index) {
  const employee = employees[index];

  document.getElementById("employeeId").value = employee.employeeId;
  document.getElementById("fullName").value = employee.fullName;
  document.getElementById("position").value = employee.position;
  document.getElementById("department").value = employee.department;
  document.getElementById("email").value = employee.email;
  document.getElementById("contact").value = employee.contact;
  document.getElementById("dateHired").value = employee.dateHired;
  document.getElementById("status").value = employee.status;
  document.getElementById("editIndex").value = index;

  submitBtn.textContent = "Update Employee";
  formSection.classList.remove("hidden"); // Open form
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// Delete Record
window.deleteEmployee = function(index) {
  if (confirm("Are you sure you want to delete this employee record?")) {
    employees.splice(index, 1);
    localStorage.setItem("employees", JSON.stringify(employees));
    displayEmployees();
  }
};

// Search Filter
searchInput.addEventListener("input", function () {
  const keyword = searchInput.value.toLowerCase();

  const filteredEmployees = employees.filter(employee =>
    employee.employeeId.toLowerCase().includes(keyword) ||
    employee.fullName.toLowerCase().includes(keyword) ||
    employee.position.toLowerCase().includes(keyword) ||
    employee.department.toLowerCase().includes(keyword) ||
    employee.status.toLowerCase().includes(keyword)
  );

  displayEmployees(filteredEmployees);
});

// Initial Load
displayEmployees();