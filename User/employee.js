const employeeForm = document.getElementById("employeeForm");
const employeeTable = document.getElementById("employeeTable");
const searchInput = document.getElementById("searchInput");
const submitBtn = document.getElementById("submitBtn");

let employees = JSON.parse(localStorage.getItem("employees")) || [];

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
  displayEmployees();
});

function displayEmployees(data = employees) {
  employeeTable.innerHTML = "";

  if (data.length === 0) {
    employeeTable.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;">No employee records found</td>
      </tr>
    `;
    return;
  }

  data.forEach((employee, index) => {
    const statusClass = employee.status.replace(" ", "");

    employeeTable.innerHTML += `
      <tr>
        <td>${employee.employeeId}</td>
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
        <td>
          <button class="action-btn edit" onclick="editEmployee(${index})">Edit</button>
          <button class="action-btn delete" onclick="deleteEmployee(${index})">Delete</button>
        </td>
      </tr>
    `;
  });
}

function editEmployee(index) {
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
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteEmployee(index) {
  if (confirm("Are you sure you want to delete this employee record?")) {
    employees.splice(index, 1);
    localStorage.setItem("employees", JSON.stringify(employees));
    displayEmployees();
  }
}

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

displayEmployees();