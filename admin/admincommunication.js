/* ==========================================================================
   PGENRO IMS — EMPLOYEE MASTERFILE ADMIN CONTROLLER
   Full alignment with admin.html: Quick Actions, Batch Operations, Live
   Supabase Synchronization, Robust Icons, Pagination & 201 Dossiers
   ========================================================================== */

(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    /* ---------------- 1. HELPERS & RESILIENT ICONS ---------------- */
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]);
    }

    function refreshIcons() {
      try {
        window.lucide?.createIcons?.();
      } catch (err) {
        console.warn("Lucide notice:", err);
      }
    }

    refreshIcons();

    /* ---------------- 2. DOM ELEMENTS ---------------- */
    const statusDot = $("#dbStatusDot") || $("#statusDot");
    const statusText = $("#dbStatusText") || $("#statusText");

    // Table, Search & Filter Controls
    const employeeTableBody = $("#employeeTableBody");
    const searchInput = $("#searchInput");
    const globalSearchInput = $("#globalSearchInput");
    const filterEmploymentType = $("#filterEmploymentType");
    const filterDepartment = $("#filterDepartment");
    const filterStatus = $("#filterStatus");
    const resetFiltersBtn = $("#resetFiltersBtn");
    const recordCounter = $("#recordCounter");
    const selectAllRows = $("#selectAllRows");

    // Batch Actions Bar
    const batchActionsBar = $("#batchActionsBar");
    const selectedCountBadge = $("#selectedCountBadge");
    const batchExportBtn = $("#batchExportBtn");
    const batchDeleteBtn = $("#batchDeleteBtn");
    const batchClearBtn = $("#batchClearBtn");

    // Pagination
    const tablePaginationInfo = $("#tablePaginationInfo");
    const prevPageBtn = $("#prevPageBtn");
    const nextPageBtn = $("#nextPageBtn");
    const pageNumbers = $("#pageNumbers");

    // KPI Metrics
    const kpiPersonnel = $("#kpiPersonnel");
    const kpiActive = $("#kpiActive");
    const kpiActivePct = $("#kpiActivePct");
    const kpiLeave = $("#kpiLeave");
    const kpiDepts = $("#kpiDepts");

    // Composition Counters
    const countPermanent = $("#countPermanent");
    const countCasual = $("#countCasual");
    const countJO = $("#countJO");
    const countCOS = $("#countCOS");

    // Action Buttons
    const addEmployeeBtn = $("#addEmployeeBtn");
    const exportBtn = $("#exportBtn");
    const refreshBtn = $("#refreshBtn");
    const quickAddBtn = $("#quickAddBtn");
    const quickExportBtn = $("#quickExportBtn");
    const quickPrintBtn = $("#quickPrintBtn");
    const quickFilterPermanent = $("#quickFilterPermanent");
    const quickFilterCasual = $("#quickFilterCasual");
    const quickFilterLeave = $("#quickFilterLeave");

    // Modals
    const employeeFormModal = $("#employeeFormModal");
    const employeeForm = $("#employeeForm");
    const employeeModalTitle = $("#employeeModalTitle");
    const profileModal = $("#profileModal");
    const printDossierBtn = $("#printDossierBtn");
    const dossierEditBtn = $("#dossierEditBtn");
    const saveEmployeeBtn = $("#saveEmployeeBtn");

    // Form Inputs
    const empId = $("#empId");
    const empFirstName = $("#empFirstName");
    const empMiddleName = $("#empMiddleName");
    const empLastName = $("#empLastName");
    const empExtension = $("#empExtension");
    const empGender = $("#empGender");
    const empDob = $("#empDob");
    const empPob = $("#empPob");
    const empCivilStatus = $("#empCivilStatus");
    const empBloodType = $("#empBloodType");
    const empDesignation = $("#empDesignation");
    const empDepartment = $("#empDepartment");
    const empStatusType = $("#empStatusType");
    const empItemCode = $("#empItemCode");
    const empDateEmployed = $("#empDateEmployed");
    const empSalaryGrade = $("#empSalaryGrade");
    const empDutyStatus = $("#empDutyStatus");
    const empMobile = $("#empMobile");
    const empEmail = $("#empEmail");
    const empAddress = $("#empAddress");

    // Shell Controls
    const sidebar = $("#sidebar");
    const sidebarCollapseBtn = $("#sidebarCollapseBtn");
    const mobileMenuBtn = $("#mobileMenuBtn");
    const profileMenu = $("#profileMenu");
    const profileBtn = $("#profileBtn");
    const profileDropdown = $("#profileDropdown");
    const notificationsBtn = $("#notificationsBtn");
    const notificationDropdown = $("#notificationDropdown");
    const logoutBtn = $("#logoutBtn");

    /* ---------------- 3. SHELL TOPBAR & NAVIGATION ---------------- */
    function closeProfileDropdown() {
      if (!profileDropdown) return;
      profileDropdown.classList.remove("open");
      profileMenu?.classList.remove("open");
      profileBtn?.setAttribute("aria-expanded", "false");
    }

    function openProfileDropdown() {
      if (!profileDropdown) return;
      if (notificationDropdown) {
        notificationDropdown.classList.remove("open");
        notificationsBtn?.setAttribute("aria-expanded", "false");
      }
      profileDropdown.classList.add("open");
      profileMenu?.classList.add("open");
      profileBtn?.setAttribute("aria-expanded", "true");
    }

    profileBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (profileDropdown?.classList.contains("open")) closeProfileDropdown();
      else openProfileDropdown();
    });

    notificationsBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!notificationDropdown) return;
      const isOpen = notificationDropdown.classList.contains("open");
      closeProfileDropdown();
      notificationDropdown.classList.toggle("open", !isOpen);
      notificationsBtn.setAttribute("aria-expanded", String(!isOpen));
    });

    document.addEventListener("click", (e) => {
      if (!profileMenu?.contains(e.target)) closeProfileDropdown();
      if (notificationDropdown && !notificationDropdown.contains(e.target) && e.target !== notificationsBtn) {
        notificationDropdown.classList.remove("open");
        notificationsBtn?.setAttribute("aria-expanded", "false");
      }
    });

    /* ---------------- 4. STATE & DEMO DATA ---------------- */
    let employees = [];
    let selectedIds = new Set();
    let editingId = null;
    let currentViewingId = null;
    let databaseMode = "offline";
    let isMouseDownInsideModal = false;

    // Pagination State
    let currentPage = 1;
    const pageSize = 10;

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

    /* ---------------- 5. MODAL DISMISSAL SAFETY ---------------- */
    [employeeFormModal, profileModal].forEach((modal) => {
      if (!modal) return;
      const card = modal.querySelector(".modal-card");

      card?.addEventListener("mousedown", () => {
        isMouseDownInsideModal = true;
      });

      modal.addEventListener("mousedown", (e) => {
        if (e.target === modal) isMouseDownInsideModal = false;
      });

      modal.addEventListener("click", (e) => {
        if (e.target === modal && !isMouseDownInsideModal) {
          if (modal === employeeFormModal && empFirstName?.value.trim()) {
            if (confirm("Discard unsaved changes?")) closeModal(modal.id);
          } else {
            closeModal(modal.id);
          }
        }
        isMouseDownInsideModal = false;
      });
    });

    function openModal(id) {
      const modal = $(`#${id}`);
      if (!modal) return;
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("admin-modal-open");
      refreshIcons();
    }

    function closeModal(id) {
      const modal = $(`#${id}`);
      if (!modal) return;
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
      if (!$$(".modal-backdrop.open").length) {
        document.body.classList.remove("admin-modal-open");
      }
    }

    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(btn.dataset.close));
    });

    /* ---------------- 6. SUPABASE & LOCAL DATA ---------------- */
    const supabase = window.pgenroSupabase || window.PGENRO_DB?.client || null;

    function setStatus(online, text) {
      if (statusDot) {
        statusDot.className = `status-dot ${online ? "online" : "offline"}`;
      }
      if (statusText) {
        statusText.textContent = text || (online ? "Online Mode" : "Offline Mode");
      }
    }

    async function loadEmployees() {
      if (!supabase) {
        databaseMode = "offline";
        setStatus(false, "Offline / Local Mode");
        loadLocalEmployees();
        return;
      }

      setStatus(true, "Loading System...");

      try {
        const { data, error } = await supabase
          .from("employees")
          .select("*")
          .order("last_name", { ascending: true });

        if (error) throw error;

        employees = Array.isArray(data) && data.length ? data : [];
        databaseMode = "supabase";
        saveLocalEmployees();
        setStatus(true, `Online Mode (${employees.length} Staff)`);
        render();
      } catch (err) {
        console.warn("Supabase load fallback:", err);
        databaseMode = "offline";
        setStatus(false, "Local Mode");
        loadLocalEmployees();
      }
    }

    function loadLocalEmployees() {
      try {
        const cached = JSON.parse(localStorage.getItem("pgenro_admin_employees") || "null");
        employees = Array.isArray(cached) && cached.length ? cached : [...DEMO_EMPLOYEES];
      } catch {
        employees = [...DEMO_EMPLOYEES];
      }
      render();
    }

    function saveLocalEmployees() {
      try {
        localStorage.setItem("pgenro_admin_employees", JSON.stringify(employees));
      } catch (e) {
        console.warn("Local storage write warning:", e);
      }
    }

    /* ---------------- 7. RENDER & METRICS ---------------- */
    function getFilteredEmployees() {
      const search = (searchInput?.value || globalSearchInput?.value || "").trim().toLowerCase();
      const filterType = filterEmploymentType?.value || "";
      const filterDept = filterDepartment?.value || "";
      const filterStat = filterStatus?.value || "";

      return employees.filter((emp) => {
        const fullName =
          `${emp.first_name || ""} ${emp.middle_name || ""} ${emp.last_name || ""} ${emp.name_extension || ""}`.toLowerCase();

        const searchable =
          `${fullName} ${emp.employee_id || ""} ${emp.designation || ""} ${emp.department || ""} ${emp.item_code || ""} ${emp.email || ""}`.toLowerCase();

        return (
          (!search || searchable.includes(search)) &&
          (!filterType || emp.employment_type === filterType) &&
          (!filterDept || emp.department === filterDept) &&
          (!filterStat || emp.duty_status === filterStat)
        );
      });
    }

    function render() {
      if (!employeeTableBody) return;

      const filtered = getFilteredEmployees();

      // Pagination calculations
      const totalRecords = filtered.length;
      const totalPages = Math.ceil(totalRecords / pageSize) || 1;
      if (currentPage > totalPages) currentPage = totalPages;

      const startIndex = (currentPage - 1) * pageSize;
      const paginated = filtered.slice(startIndex, startIndex + pageSize);

      if (!paginated.length) {
        employeeTableBody.innerHTML = `
          <tr>
            <td colspan="9" class="empty-table-cell">
              ${employees.length ? "No personnel records match the current filters." : "No employee records found in the database."}
            </td>
          </tr>
        `;
      } else {
        employeeTableBody.innerHTML = paginated.map(rowHTML).join("");
      }

      // Update Pagination UI
      if (tablePaginationInfo) {
        const start = totalRecords ? startIndex + 1 : 0;
        const end = Math.min(startIndex + pageSize, totalRecords);
        tablePaginationInfo.textContent = `Showing ${start} to ${end} of ${totalRecords} personnel records`;
      }

      if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
      if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;

      renderPageNumbers(totalPages);

      // Update Overall Summary KPIs
      const total = employees.length;
      const active = employees.filter(e => e.duty_status === "Active").length;
      const leave = employees.filter(e => e.duty_status === "On Leave").length;
      const departments = [...new Set(employees.map(e => e.department).filter(Boolean))];
      const activePct = total ? Math.round((active / total) * 100) : 0;

      if (kpiPersonnel) kpiPersonnel.textContent = total.toLocaleString();
      if (kpiActive) kpiActive.textContent = active.toLocaleString();
      if (kpiActivePct) kpiActivePct.textContent = `${activePct}% of workforce`;
      if (kpiLeave) kpiLeave.textContent = leave.toLocaleString();
      if (kpiDepts) kpiDepts.textContent = departments.length.toLocaleString();

      if (recordCounter) {
        recordCounter.textContent = `Showing ${filtered.length} of ${total} Staff`;
      }

      // Update Workforce Composition Strip
      const perm = employees.filter(e => e.employment_type === "PERMANENT").length;
      const cas = employees.filter(e => e.employment_type === "CASUAL").length;
      const jo = employees.filter(e => e.employment_type === "JOB ORDER").length;
      const cos = employees.filter(e => e.employment_type === "CONTRACT OF SERVICE").length;

      if (countPermanent) countPermanent.textContent = perm.toLocaleString();
      if (countCasual) countCasual.textContent = cas.toLocaleString();
      if (countJO) countJO.textContent = jo.toLocaleString();
      if (countCOS) countCOS.textContent = cos.toLocaleString();

      // Populate Department Filter options
      if (filterDepartment && filterDepartment.options.length <= 1 && departments.length > 0) {
        const cur = filterDepartment.value || "";
        filterDepartment.innerHTML =
          `<option value="">All Divisions</option>` +
          departments.sort().map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
        if (departments.includes(cur)) filterDepartment.value = cur;
      }

      // Sync Checkboxes & Batch Bar
      syncSelectionUI();
      refreshIcons();
    }

    function rowHTML(emp) {
      const initials = `${(emp.first_name || "")[0] || ""}${(emp.last_name || "")[0] || ""}`.toUpperCase() || "--";
      const fullName = `${emp.last_name || ""}, ${emp.first_name || ""} ${emp.middle_name ? emp.middle_name[0] + "." : ""} ${emp.name_extension || ""}`.trim();
      const duty = emp.duty_status || "Active";
      const isSuccess = duty === "Active";
      const isUrgent = duty === "On Leave";
      const isSelected = selectedIds.has(String(emp.id));

      return `
        <tr data-emp-id="${escapeHtml(emp.id)}" class="${isSelected ? "selected-row" : ""}">
          <td>
            <input type="checkbox" class="row-checkbox" data-id="${escapeHtml(emp.id)}" ${isSelected ? "checked" : ""} aria-label="Select row"/>
          </td>
          <td><span class="id-badge">${escapeHtml(emp.employee_id || "—")}</span></td>
          <td>
            <div class="employee-cell">
              <div class="avatar-sm">${escapeHtml(initials)}</div>
              <div>
                <span class="employee-name">${escapeHtml(fullName)}</span>
                <span class="employee-sub">${escapeHtml(emp.gender || "—")} &bull; ${escapeHtml(emp.civil_status || "—")}</span>
              </div>
            </div>
          </td>
          <td>
            <strong>${escapeHtml(emp.designation || "—")}</strong>
            <span class="employee-sub">Item: ${escapeHtml(emp.item_code || "Plantilla N/A")}</span>
          </td>
          <td><span class="type-pill">${escapeHtml(emp.employment_type || "N/A")}</span></td>
          <td>${escapeHtml(emp.department || "—")}</td>
          <td>
            <strong style="color:var(--slate-800);">${escapeHtml(emp.mobile || "—")}</strong>
            <span class="employee-sub">${escapeHtml(emp.email || "No email on file")}</span>
          </td>
          <td>
            <span class="badge-status ${isSuccess ? "success" : isUrgent ? "urgent" : "info"}">
              <span class="dot"></span>
              ${escapeHtml(duty)}
            </span>
          </td>
          <td style="text-align:right;">
            <div class="actions">
              <button type="button" class="btn-action" data-action="view" data-id="${escapeHtml(emp.id)}" title="View 201 Dossier">
                <i data-lucide="eye"></i>
              </button>
              <button type="button" class="btn-action" data-action="edit" data-id="${escapeHtml(emp.id)}" title="Edit Profile">
                <i data-lucide="pencil"></i>
              </button>
              <button type="button" class="btn-action delete" data-action="delete" data-id="${escapeHtml(emp.id)}" title="Delete Record">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }

    function renderPageNumbers(totalPages) {
      if (!pageNumbers) return;
      let html = "";
      for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
          html += `<button type="button" class="page-btn ${i === currentPage ? "active" : ""}" data-page="${i}">${i}</button>`;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
          html += `<span class="page-ellipsis">...</span>`;
        }
      }
      pageNumbers.innerHTML = html;
    }

    /* ---------------- 8. CHECKBOX SELECTION & BATCH ACTIONS ---------------- */
    function syncSelectionUI() {
      const checkboxes = $$(".row-checkbox", employeeTableBody);
      const allChecked = checkboxes.length > 0 && checkboxes.every(cb => cb.checked);
      if (selectAllRows) selectAllRows.checked = allChecked;

      const count = selectedIds.size;
      if (batchActionsBar) {
        batchActionsBar.style.display = count > 0 ? "flex" : "none";
      }
      if (selectedCountBadge) {
        selectedCountBadge.textContent = `${count} Selected`;
      }
    }

    selectAllRows?.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      const paginated = getFilteredEmployees().slice((currentPage - 1) * pageSize, currentPage * pageSize);
      paginated.forEach(emp => {
        if (isChecked) selectedIds.add(String(emp.id));
        else selectedIds.delete(String(emp.id));
      });
      render();
    });

    employeeTableBody?.addEventListener("change", (e) => {
      const cb = e.target.closest(".row-checkbox");
      if (!cb) return;
      const id = cb.dataset.id;
      if (cb.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      syncSelectionUI();
    });

    batchClearBtn?.addEventListener("click", () => {
      selectedIds.clear();
      render();
    });

    batchExportBtn?.addEventListener("click", () => {
      const selectedEmployees = employees.filter(e => selectedIds.has(String(e.id)));
      if (!selectedEmployees.length) return;
      exportToCSV(selectedEmployees, `pgenro_selected_employees_${new Date().toISOString().slice(0, 10)}.csv`);
      showToast(`Exported ${selectedEmployees.length} selected employee records.`, "success");
    });

    batchDeleteBtn?.addEventListener("click", async () => {
      const count = selectedIds.size;
      if (!count) return;
      if (!confirm(`Are you sure you want to delete ${count} selected employee record(s)?`)) return;

      try {
        if (databaseMode === "supabase" && supabase) {
          const { error } = await supabase.from("employees").delete().in("id", Array.from(selectedIds));
          if (error) throw error;
          await loadEmployees();
        } else {
          employees = employees.filter(e => !selectedIds.has(String(e.id)));
          saveLocalEmployees();
          render();
        }
        selectedIds.clear();
        showToast(`Deleted ${count} personnel records.`, "success");
      } catch (err) {
        console.error("Batch delete error:", err);
        showToast(err?.message || "Failed to delete selected records.", "error");
      }
    });

    /* ---------------- 9. PAGINATION EVENTS ---------------- */
    prevPageBtn?.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage--;
        render();
      }
    });

    nextPageBtn?.addEventListener("click", () => {
      const totalPages = Math.ceil(getFilteredEmployees().length / pageSize) || 1;
      if (currentPage < totalPages) {
        currentPage++;
        render();
      }
    });

    pageNumbers?.addEventListener("click", (e) => {
      const btn = e.target.closest(".page-btn");
      if (!btn) return;
      currentPage = Number(btn.dataset.page);
      render();
    });

    // Row Actions Dispatcher
    employeeTableBody?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const id = btn.dataset.id;
      if (!id) return;

      if (btn.dataset.action === "view") openProfileModal(id);
      if (btn.dataset.action === "edit") openEmployeeModal(id);
      if (btn.dataset.action === "delete") deleteEmployee(id);
    });

    /* ---------------- 10. ADD & EDIT EMPLOYEE ---------------- */
    function openEmployeeModal(id = null) {
      editingId = id;
      employeeForm?.reset();

      if (id) {
        const emp = employees.find(item => String(item.id) === String(id));
        if (!emp) return;

        if (employeeModalTitle) employeeModalTitle.textContent = "Edit Employee Masterfile";
        if (empId) empId.value = emp.employee_id || "";
        if (empFirstName) empFirstName.value = emp.first_name || "";
        if (empMiddleName) empMiddleName.value = emp.middle_name || "";
        if (empLastName) empLastName.value = emp.last_name || "";
        if (empExtension) empExtension.value = emp.name_extension || "";
        if (empGender) empGender.value = emp.gender || "Male";
        if (empDob) empDob.value = emp.dob || "";
        if (empPob) empPob.value = emp.pob || "";
        if (empCivilStatus) empCivilStatus.value = emp.civil_status || "Single";
        if (empBloodType) empBloodType.value = emp.blood_type || "";
        if (empDesignation) empDesignation.value = emp.designation || "";
        if (empDepartment) empDepartment.value = emp.department || "";
        if (empStatusType) empStatusType.value = emp.employment_type || "PERMANENT";
        if (empItemCode) empItemCode.value = emp.item_code || "";
        if (empDateEmployed) empDateEmployed.value = emp.date_employed || "";
        if (empSalaryGrade) empSalaryGrade.value = emp.salary_grade || "";
        if (empDutyStatus) empDutyStatus.value = emp.duty_status || "Active";
        if (empMobile) empMobile.value = emp.mobile || "";
        if (empEmail) empEmail.value = emp.email || "";
        if (empAddress) empAddress.value = emp.address || "";
      } else {
        if (employeeModalTitle) employeeModalTitle.textContent = "Add New Employee";
        if (empId) empId.value = `EMP-2026-${String(employees.length + 1).padStart(3, "0")}`;
      }

      openModal("employeeFormModal");
    }

    async function saveEmployee(e) {
      e.preventDefault();

      const payload = {
        employee_id: empId?.value.trim() || "",
        first_name: empFirstName?.value.trim() || "",
        middle_name: empMiddleName?.value.trim() || "",
        last_name: empLastName?.value.trim() || "",
        name_extension: empExtension?.value.trim() || "",
        gender: empGender?.value || "Male",
        dob: empDob?.value || null,
        pob: empPob?.value.trim() || "",
        civil_status: empCivilStatus?.value || "Single",
        blood_type: empBloodType?.value.trim() || "",
        designation: empDesignation?.value.trim() || "",
        department: empDepartment?.value.trim() || "",
        employment_type: empStatusType?.value || "PERMANENT",
        item_code: empItemCode?.value.trim() || "",
        date_employed: empDateEmployed?.value || null,
        salary_grade: empSalaryGrade?.value.trim() || "",
        duty_status: empDutyStatus?.value || "Active",
        mobile: empMobile?.value.trim() || "",
        email: empEmail?.value.trim() || "",
        address: empAddress?.value.trim() || "",
        updated_at: new Date().toISOString()
      };

      if (!payload.employee_id || !payload.first_name || !payload.last_name || !payload.designation || !payload.department) {
        showToast("Please fill in required fields marked with *.", "warning");
        return;
      }

      if (saveEmployeeBtn) saveEmployeeBtn.disabled = true;

      try {
        if (databaseMode === "supabase" && supabase) {
          const res = editingId
            ? await supabase.from("employees").update(payload).eq("id", editingId)
            : await supabase.from("employees").insert([payload]);

          if (res.error) throw res.error;
          await loadEmployees();
        } else {
          if (editingId) {
            const idx = employees.findIndex(i => String(i.id) === String(editingId));
            if (idx !== -1) employees[idx] = { ...employees[idx], ...payload };
          } else {
            payload.id = `emp_${Date.now()}`;
            employees.unshift(payload);
          }
          saveLocalEmployees();
          render();
        }

        closeModal("employeeFormModal");
        showToast(editingId ? "Profile updated successfully." : "Employee added successfully.", "success");
      } catch (err) {
        console.error("Save error:", err);
        showToast(err?.message || "Failed to save employee profile.", "error");
      } finally {
        if (saveEmployeeBtn) saveEmployeeBtn.disabled = false;
      }
    }

    /* ---------------- 11. 201 DOSSIER MODAL ---------------- */
    function openProfileModal(id) {
      currentViewingId = id;
      const emp = employees.find(e => String(e.id) === String(id));
      if (!emp) return;

      const initials = `${(emp.first_name || "")[0] || ""}${(emp.last_name || "")[0] || ""}`.toUpperCase() || "--";
      const fullName = `${emp.first_name || ""} ${emp.middle_name || ""} ${emp.last_name || ""} ${emp.name_extension || ""}`.trim();
      const duty = emp.duty_status || "Active";
      const isSuccess = duty === "Active";

      if ($("#viewAvatar")) $("#viewAvatar").textContent = initials;
      if ($("#viewHeadingName")) $("#viewHeadingName").textContent = fullName || "Employee Profile";
      if ($("#viewPillStatus")) {
        $("#viewPillStatus").innerHTML = `<span class="dot"></span> ${escapeHtml(duty)}`;
        $("#viewPillStatus").className = `badge-status ${isSuccess ? "success" : "urgent"}`;
      }

      if ($("#v_id")) $("#v_id").textContent = emp.employee_id || "—";
      if ($("#v_name")) $("#v_name").textContent = fullName || "—";
      if ($("#v_dob")) $("#v_dob").textContent = formatLongDate(emp.dob);
      if ($("#v_pob")) $("#v_pob").textContent = emp.pob || "—";
      if ($("#v_gender")) $("#v_gender").textContent = emp.gender || "—";
      if ($("#v_civil")) $("#v_civil").textContent = emp.civil_status || "—";
      if ($("#v_blood")) $("#v_blood").textContent = emp.blood_type || "—";

      if ($("#v_desig")) $("#v_desig").textContent = emp.designation || "—";
      if ($("#v_emp_status")) $("#v_emp_status").textContent = emp.employment_type || "—";
      if ($("#v_dept")) $("#v_dept").textContent = emp.department || "—";
      if ($("#v_item")) $("#v_item").textContent = emp.item_code || "—";
      if ($("#v_date_employed")) $("#v_date_employed").textContent = formatLongDate(emp.date_employed);
      if ($("#v_salary_gradestep")) $("#v_salary_gradestep").textContent = emp.salary_grade || "—";

      if ($("#v_mobile")) $("#v_mobile").textContent = emp.mobile || "—";
      if ($("#v_email")) $("#v_email").textContent = emp.email || "—";
      if ($("#v_address")) $("#v_address").textContent = emp.address || "—";

      openModal("profileModal");
    }

    function formatLongDate(val) {
      if (!val) return "—";
      const d = new Date(val);
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    }

    /* ---------------- 12. DELETE RECORD ---------------- */
    async function deleteEmployee(id) {
      const emp = employees.find(e => String(e.id) === String(id));
      if (!emp) return;

      if (!confirm(`Are you sure you want to delete ${emp.first_name || ""} ${emp.last_name || ""}?`)) {
        return;
      }

      try {
        if (databaseMode === "supabase" && supabase) {
          const { error } = await supabase.from("employees").delete().eq("id", id);
          if (error) throw error;
          await loadEmployees();
        } else {
          employees = employees.filter(e => String(e.id) !== String(id));
          saveLocalEmployees();
          render();
        }
        showToast("Employee record removed.", "success");
      } catch (err) {
        console.error("Delete error:", err);
        showToast(err?.message || "Failed to delete record.", "error");
      }
    }

    /* ---------------- 13. EXPORT CSV ---------------- */
    function exportToCSV(list, filename) {
      const headers = [
        "Employee ID", "Last Name", "First Name", "Middle Name", "Extension",
        "Gender", "DOB", "Designation", "Department", "Employment Type",
        "Item No", "Duty Status", "Mobile", "Email"
      ];

      const rows = list.map(e => [
        e.employee_id, e.last_name, e.first_name, e.middle_name, e.name_extension,
        e.gender, e.dob, e.designation, e.department, e.employment_type,
        e.item_code, e.duty_status, e.mobile, e.email
      ]);

      const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
        .join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    function exportMasterlist() {
      if (!employees.length) {
        showToast("No employee records to export.", "warning");
        return;
      }
      exportToCSV(employees, `pgenro_employee_masterfile_${new Date().toISOString().slice(0, 10)}.csv`);
      showToast("Employee masterfile exported as CSV.", "success");
    }

    /* ---------------- 14. QUICK ACTION HANDLERS ---------------- */
    quickAddBtn?.addEventListener("click", () => openEmployeeModal());
    addEmployeeBtn?.addEventListener("click", () => openEmployeeModal());
    exportBtn?.addEventListener("click", exportMasterlist);
    quickExportBtn?.addEventListener("click", exportMasterlist);

    quickPrintBtn?.addEventListener("click", () => window.print());
    printDossierBtn?.addEventListener("click", () => window.print());

    refreshBtn?.addEventListener("click", async () => {
      await loadEmployees();
      showToast("Directory synchronized.", "success");
    });

    dossierEditBtn?.addEventListener("click", () => {
      if (!currentViewingId) return;
      closeModal("profileModal");
      openEmployeeModal(currentViewingId);
    });

    quickFilterPermanent?.addEventListener("click", () => {
      if (filterEmploymentType) filterEmploymentType.value = "PERMANENT";
      currentPage = 1;
      render();
    });

    quickFilterCasual?.addEventListener("click", () => {
      if (filterEmploymentType) filterEmploymentType.value = "CASUAL";
      currentPage = 1;
      render();
    });

    quickFilterLeave?.addEventListener("click", () => {
      if (filterStatus) filterStatus.value = "On Leave";
      currentPage = 1;
      render();
    });

    resetFiltersBtn?.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      if (globalSearchInput) globalSearchInput.value = "";
      if (filterEmploymentType) filterEmploymentType.value = "";
      if (filterDepartment) filterDepartment.value = "";
      if (filterStatus) filterStatus.value = "";
      currentPage = 1;
      render();
    });

    /* ---------------- 15. INPUT & KEYBOARD EVENTS ---------------- */
    employeeForm?.addEventListener("submit", saveEmployee);

    searchInput?.addEventListener("input", () => {
      currentPage = 1;
      render();
    });

    globalSearchInput?.addEventListener("input", (e) => {
      if (searchInput) searchInput.value = e.target.value;
      currentPage = 1;
      render();
    });

    filterEmploymentType?.addEventListener("change", () => {
      currentPage = 1;
      render();
    });

    filterDepartment?.addEventListener("change", () => {
      currentPage = 1;
      render();
    });

    filterStatus?.addEventListener("change", () => {
      currentPage = 1;
      render();
    });

    document.addEventListener("keydown", (e) => {
      const isInput = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        (globalSearchInput || searchInput)?.focus();
      }
      if (e.key === "/" && !isInput) {
        e.preventDefault();
        (globalSearchInput || searchInput)?.focus();
      }
      if (e.key === "Escape") {
        $$(".modal-backdrop.open").forEach(m => closeModal(m.id));
        closeProfileDropdown();
      }
    });

    /* ---------------- 16. TOAST MESSAGES ---------------- */
    function showToast(message, type = "success", timeout = 3000) {
      if (window.AdminUI?.toast) {
        window.AdminUI.toast(message, type, timeout);
        return;
      }

      let stack = $(".admin-ui-toast-stack") || $("#toastContainer");
      if (!stack) {
        stack = document.createElement("div");
        stack.className = "toast-container";
        document.body.appendChild(stack);
      }

      const toast = document.createElement("div");
      toast.className = `admin-ui-toast toast ${type}`;
      const icon = type === "error" ? "alert-circle" : (type === "warning" ? "alert-triangle" : "check-circle-2");
      toast.innerHTML = `<i data-lucide="${icon}"></i><span>${escapeHtml(message)}</span>`;
      stack.appendChild(toast);
      refreshIcons();

      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(8px)";
        setTimeout(() => toast.remove(), 200);
      }, timeout);
    }

    /* ---------------- 17. SHELL CONTROLS ---------------- */
    sidebarCollapseBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      const isCollapsed = !sidebar?.classList.contains("collapsed");
      sidebar?.classList.toggle("collapsed", isCollapsed);
      $(".main-wrapper")?.classList.toggle("sidebar-collapsed", isCollapsed);
      document.body.classList.toggle("sidebar-collapsed", isCollapsed);
      try {
        localStorage.setItem("pgenro_admin_sidebar", isCollapsed ? "collapsed" : "expanded");
      } catch {}
    });

    let sidebarBackdrop = $(".admin-sidebar-backdrop");
    if (!sidebarBackdrop) {
      sidebarBackdrop = document.createElement("div");
      sidebarBackdrop.className = "admin-sidebar-backdrop";
      sidebarBackdrop.setAttribute("aria-hidden", "true");
      document.body.appendChild(sidebarBackdrop);
    }

    const isMobileViewport = () => window.matchMedia("(max-width: 900px)").matches;
    const setMobileSidebar = (open) => {
      sidebar?.classList.toggle("mobile-open", Boolean(open));
      sidebarBackdrop?.classList.toggle("active", Boolean(open));
      sidebarBackdrop?.setAttribute("aria-hidden", String(!open));
      mobileMenuBtn?.setAttribute("aria-expanded", String(Boolean(open)));
    };

    mobileMenuBtn?.setAttribute("aria-expanded", "false");
    mobileMenuBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      setMobileSidebar(!sidebar?.classList.contains("mobile-open"));
    });

    sidebarBackdrop?.addEventListener("click", () => setMobileSidebar(false));
    sidebar?.querySelectorAll("a.nav-item").forEach(link => {
      link.addEventListener("click", () => {
        if (isMobileViewport()) setMobileSidebar(false);
      });
    });

    window.addEventListener("resize", () => {
      if (!isMobileViewport()) setMobileSidebar(false);
    });

    try {
      if (!isMobileViewport() && localStorage.getItem("pgenro_admin_sidebar") === "collapsed") {
        sidebar?.classList.add("collapsed");
        $(".main-wrapper")?.classList.add("sidebar-collapsed");
        document.body.classList.add("sidebar-collapsed");
      }
    } catch {}

    logoutBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await supabase?.auth?.signOut?.();
      } catch {}
      window.location.href = "../User/login.html";
    });

    /* ---------------- 18. INITIALIZE ---------------- */
    await loadEmployees();

    if (supabase) {
      try {
        supabase
          .channel("public:employees")
          .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, () => {
            loadEmployees();
          })
          .subscribe();
      } catch (e) {
        console.warn("Realtime channel notice:", e);
      }
    }

    refreshIcons();
  }
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
