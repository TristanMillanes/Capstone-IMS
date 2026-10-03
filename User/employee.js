(() => {
  "use strict";

  const CONFIG = Object.freeze({
    supabaseUrl: "https://zssrxubajhqryrwijyzm.supabase.co",
    supabaseKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP",
    employeeTable: "employees",
    profileTable: "profiles",
    loginUrl: "login.html"
  });

  const state = {
    employees: [],
    filtered: [],
    selectedEmployee: null,
    realtimeChannel: null,
    lastFocusedElement: null,
    isLoading: false
  };

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const byId = (id) => document.getElementById(id);
  const valueOf = (value, fallback = "") => value == null ? fallback : String(value).trim();
  const displayValue = (value) => valueOf(value) || "—";
  const lower = (value) => valueOf(value).toLocaleLowerCase();
  const firstValue = (...values) => values.find((value) => valueOf(value)) ?? "";

  const dom = {};
  let db = null;

  document.addEventListener("DOMContentLoaded", init, { once: true });

  async function init() {
    cacheDom();
    createIcons();
    initRevealAnimations();
    initSidebar();
    initProfileMenu();
    initFilters();
    initModal();
    initScrollToTop();
    initPrintCleanup();

    db = createDatabaseClient();
    await loadCachedProfile();

    if (db) {
      const hasSession = await verifySession();
      if (!hasSession) return;
    }

    await loadEmployees({ notify: false });
    subscribeToEmployeeChanges();
  }

  function cacheDom() {
    Object.assign(dom, {
      body: document.body,
      sidebar: byId("sidebar"),
      hamburger: byId("hamburgerMenu"),
      overlay: byId("overlay"),
      profileMenu: byId("profileMenu"),
      profileButton: byId("profileBtn"),
      profileDropdown: byId("profileDropdown"),
      logoutButton: byId("logoutBtn"),
      statusIndicator: byId("dbStatusIndicator"),
      statusText: byId("dbStatusText"),
      lastUpdated: byId("lastUpdated"),
      searchInput: byId("searchInput"),
      employmentFilter: byId("filterEmploymentType"),
      departmentFilter: byId("filterDepartment"),
      statusFilter: byId("filterStatus"),
      tableBody: byId("employeeTable"),
      recordCounter: byId("recordCounter"),
      refreshButton: byId("refreshRecordsBtn"),
      exportButton: byId("exportBtn"),
      modal: byId("profileModal"),
      modalPanel: $(".modal-panel", byId("profileModal")),
      modalClose: byId("profileModalClose"),
      modalDone: byId("profileDoneBtn"),
      printButton: byId("printProfileBtn"),
      scrollTopButton: byId("scrollToTopBtn"),
      toastContainer: byId("toastContainer")
    });
  }

  function createDatabaseClient() {
    if (window.pgenroSupabase) return window.pgenroSupabase;
    if (typeof window.supabase?.createClient !== "function") {
      setConnectionStatus("offline", "Offline records mode");
      return null;
    }

    try {
      return window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      });
    } catch (error) {
      console.error("Unable to initialize Supabase:", error);
      setConnectionStatus("offline", "Database unavailable");
      return null;
    }
  }

  async function verifySession() {
    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;

      const user = data?.session?.user;
      if (!user) {
        window.location.replace(CONFIG.loginUrl);
        return false;
      }

      await loadRemoteProfile(user);
      return true;
    } catch (error) {
      console.error("Session verification failed:", error);
      setConnectionStatus("offline", "Session check unavailable");
      return true;
    }
  }

  async function loadRemoteProfile(user) {
    try {
      const { data, error } = await db
        .from(CONFIG.profileTable)
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      const profile = {
        ...(data || {}),
        email: firstValue(data?.email, user.email),
        fullName: firstValue(data?.full_name, data?.username, user.user_metadata?.full_name, user.email)
      };

      const currentRole = String(profile.role || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (["admin", "administrator", "super admin", "superadmin", "system administrator"].includes(currentRole)) {
        window.location.replace("../admin/admin.html");
        return;
      }

      saveProfile(profile);
      populateProfile(profile);
    } catch (error) {
      console.warn("Profile details could not be loaded:", error);
      populateProfile({
        fullName: firstValue(user.user_metadata?.full_name, user.email, "PGENRO User"),
        email: user.email
      });
    }
  }

  async function loadCachedProfile() {
    try {
      const cached = JSON.parse(localStorage.getItem("pgenro_current_user") || "null");
      if (cached && typeof cached === "object") populateProfile(cached);
    } catch (error) {
      console.warn("Cached profile is invalid:", error);
    }
  }

  function saveProfile(profile) {
    try {
      localStorage.setItem("pgenro_current_user", JSON.stringify({
        uid: profile.user_id || profile.id || "",
        fullName: firstValue(profile.fullName, profile.full_name, profile.username),
        username: profile.username || "",
        email: profile.email || "",
        position: profile.position || "",
        division: profile.division || "",
        role: profile.role || "System Staff",
        accountType: profile.account_type || "Standard User",
        status: profile.status || "Active"
      }));
    } catch (error) {
      console.warn("Profile could not be cached:", error);
    }
  }

  function populateProfile(profile = {}) {
    const name = firstValue(profile.fullName, profile.full_name, profile.username, profile.name, "PGENRO User");
    const role = firstValue(profile.position, profile.role, profile.accountType, profile.account_type, "Authorized account");
    const email = firstValue(profile.email, "Office account");

    $$(".profile-text strong").forEach((node) => { node.textContent = name; });
    $$(".profile-text small").forEach((node) => { node.textContent = role; });
    $$(".profile-dropdown-header h3").forEach((node) => { node.textContent = name; });
    $$(".profile-dropdown-header p").forEach((node) => { node.textContent = email; });
  }

  async function loadEmployees({ notify = false } = {}) {
    if (state.isLoading) return;
    state.isLoading = true;
    setRefreshLoading(true);
    showTableMessage("Loading employee records…");
    setConnectionStatus("standby", "Loading personnel records…");

    try {
      let records;

      if (db) {
        let response = await db
          .from(CONFIG.employeeTable)
          .select("*")
          .order("last_name", { ascending: true });

        if (response.error) {
          response = await db.from(CONFIG.employeeTable).select("*");
        }
        if (response.error) throw response.error;
        records = response.data || [];
        cacheEmployees(records);
        setConnectionStatus("online", "Personnel records connected");
      } else {
        records = readCachedEmployees();
        setConnectionStatus("offline", records.length ? "Showing saved records" : "Offline records mode");
      }

      state.employees = records.map(normalizeEmployee).sort(compareEmployees);
      updateFilterOptions();
      updateMetrics();
      applyFilters();
      updateTimestamp();
      if (notify) showToast("Employee records refreshed.");
    } catch (error) {
      console.error("Unable to load employee records:", error);
      const cached = readCachedEmployees();
      state.employees = cached.map(normalizeEmployee).sort(compareEmployees);
      updateFilterOptions();
      updateMetrics();
      applyFilters();
      setConnectionStatus("offline", "Database connection unavailable");
      showToast(
        cached.length ? "Showing the latest saved employee records." : "Employee records could not be loaded.",
        "error"
      );
    } finally {
      state.isLoading = false;
      setRefreshLoading(false);
    }
  }

  function normalizeEmployee(row = {}) {
    let embedded = {};
    if (row.data && typeof row.data === "object") embedded = row.data;
    if (typeof row.data === "string") {
      try { embedded = JSON.parse(row.data); } catch { embedded = {}; }
    }

    const source = { ...embedded, ...row };
    const employee = {
      id: firstValue(source.id, source.employee_id, source.employeeId),
      employeeId: firstValue(source.employee_id, source.employeeId, source.employee_no, source.employeeNo),
      firstName: firstValue(source.first_name, source.firstName),
      middleName: firstValue(source.middle_name, source.middleName),
      lastName: firstValue(source.last_name, source.lastName),
      nameExtension: firstValue(source.name_extension, source.nameExtension, source.suffix),
      gender: firstValue(source.gender, source.sex),
      dob: firstValue(source.dob, source.date_of_birth, source.dateOfBirth),
      birthPlace: firstValue(source.pob, source.place_of_birth, source.birthPlace),
      civilStatus: firstValue(source.civil_status, source.civilStatus),
      bloodType: firstValue(source.blood_type, source.bloodType),
      designation: firstValue(source.designation, source.position, source.job_title),
      department: firstValue(source.department, source.division, source.office_unit),
      employmentType: firstValue(source.employment_type, source.employmentType, source.employment_status),
      itemCode: firstValue(source.item_code, source.itemCode, source.item_no),
      dateEmployed: firstValue(source.date_employed, source.dateEmployed, source.hire_date),
      dateAssumption: firstValue(source.date_assumption, source.dateAssumption),
      salaryGrade: firstValue(source.salary_grade, source.salaryGrade),
      stepNo: firstValue(source.step_no, source.stepNo, source.step),
      nosaDate: firstValue(source.nosa_date, source.nosaDate),
      eligibility: firstValue(source.eligibility, source.civil_service_eligibility),
      educationLevel: firstValue(source.education_level, source.educationLevel),
      course: firstValue(source.course, source.degree, source.program),
      lastSchool: firstValue(source.last_school_attended, source.last_school, source.lastSchoolAttended),
      yearGraduated: firstValue(source.year_graduated, source.yearGraduated),
      dutyStatus: normalizeDutyStatus(firstValue(source.duty_status, source.dutyStatus, source.status, "Active")),
      mobile: firstValue(source.mobile, source.mobile_number, source.contact_number, source.phone),
      mobile2: firstValue(source.mobile_2, source.mobile2),
      landline: firstValue(source.landline, source.telephone),
      email: firstValue(source.email, source.official_email),
      address: buildAddress(source),
      createdAt: firstValue(source.created_at, source.createdAt),
      updatedAt: firstValue(source.updated_at, source.updatedAt)
    };

    employee.fullName = buildFullName(employee);
    employee.initials = getInitials(employee);
    return employee;
  }

  function buildFullName(employee) {
    return [employee.firstName, employee.middleName, employee.lastName, employee.nameExtension]
      .map(valueOf)
      .filter(Boolean)
      .join(" ") || "Unnamed Employee";
  }

  function buildAddress(source) {
    const complete = firstValue(source.address, source.complete_address, source.residential_address);
    if (complete) return complete;
    return [source.purok, source.barangay, source.municipality, source.province]
      .map(valueOf)
      .filter(Boolean)
      .join(", ");
  }

  function normalizeDutyStatus(status) {
    const normalized = lower(status).replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    if (["on leave", "leave", "vacation", "sick leave"].includes(normalized)) return "On Leave";
    if (["inactive", "separated", "retired", "resigned", "terminated"].includes(normalized)) return "Inactive";
    return normalized ? normalized.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Active";
  }

  function compareEmployees(a, b) {
    return a.lastName.localeCompare(b.lastName, undefined, { sensitivity: "base" })
      || a.firstName.localeCompare(b.firstName, undefined, { sensitivity: "base" });
  }

  function cacheEmployees(rows) {
    try {
      localStorage.setItem("employees", JSON.stringify(rows));
    } catch (error) {
      console.warn("Employee records could not be cached:", error);
    }
  }

  function readCachedEmployees() {
    try {
      const rows = JSON.parse(localStorage.getItem("employees") || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function initFilters() {
    dom.searchInput?.addEventListener("input", applyFilters);
    dom.employmentFilter?.addEventListener("change", applyFilters);
    dom.departmentFilter?.addEventListener("change", applyFilters);
    dom.statusFilter?.addEventListener("change", applyFilters);
    dom.refreshButton?.addEventListener("click", () => loadEmployees({ notify: true }));
    dom.exportButton?.addEventListener("click", exportEmployees);
  }

  function updateFilterOptions() {
    replaceSelectOptions(
      dom.employmentFilter,
      "All employment types",
      state.employees.map((employee) => employee.employmentType)
    );
    replaceSelectOptions(
      dom.departmentFilter,
      "All departments",
      state.employees.map((employee) => employee.department)
    );
  }

  function replaceSelectOptions(select, defaultLabel, values) {
    if (!select) return;
    const selected = select.value;
    const unique = [...new Set(values.map(valueOf).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    select.replaceChildren(new Option(defaultLabel, ""));
    unique.forEach((value) => select.add(new Option(value, value)));
    if (unique.includes(selected)) select.value = selected;
  }

  function applyFilters() {
    const keyword = lower(dom.searchInput?.value);
    const employmentType = valueOf(dom.employmentFilter?.value);
    const department = valueOf(dom.departmentFilter?.value);
    const dutyStatus = valueOf(dom.statusFilter?.value);

    state.filtered = state.employees.filter((employee) => {
      const searchable = [
        employee.employeeId,
        employee.fullName,
        employee.designation,
        employee.employmentType,
        employee.department,
        employee.email,
        employee.mobile,
        employee.dutyStatus
      ].map(lower).join(" ");

      return (!keyword || searchable.includes(keyword))
        && (!employmentType || employee.employmentType === employmentType)
        && (!department || employee.department === department)
        && (!dutyStatus || employee.dutyStatus === dutyStatus);
    });

    renderEmployees();
  }

  function renderEmployees() {
    if (!dom.tableBody) return;
    dom.tableBody.replaceChildren();

    const total = state.employees.length;
    const visible = state.filtered.length;
    dom.recordCounter.textContent = total === visible
      ? `${total} ${pluralize(total, "record")}`
      : `${visible} of ${total} records`;

    if (!visible) {
      showTableMessage(total ? "No employees match the selected filters." : "No employee records found.");
      return;
    }

    const fragment = document.createDocumentFragment();
    state.filtered.forEach((employee) => fragment.appendChild(createEmployeeRow(employee)));
    dom.tableBody.appendChild(fragment);
    createIcons();
  }

  function createEmployeeRow(employee) {
    const row = document.createElement("tr");
    row.dataset.employeeId = employee.id;

    appendCell(row, employee.employeeId || "—", "strong");

    const nameCell = document.createElement("td");
    const employeeCell = createElement("div", "employee-cell");
    employeeCell.appendChild(createElement("div", "employee-avatar", employee.initials));
    const name = createElement("div", "employee-name");
    name.appendChild(createElement("strong", "", employee.fullName));
    name.appendChild(createElement("span", "", employee.email || "Personnel record"));
    employeeCell.appendChild(name);
    nameCell.appendChild(employeeCell);
    row.appendChild(nameCell);

    appendCell(row, employee.designation || "—");

    const employmentCell = document.createElement("td");
    employmentCell.appendChild(createElement("span", "employment-badge", employee.employmentType || "Not specified"));
    row.appendChild(employmentCell);

    appendCell(row, employee.department || "—");

    const contact = document.createElement("td");
    const contactWrap = createElement("div", "contact-cell");
    if (employee.email) {
      const email = document.createElement("a");
      email.href = `mailto:${employee.email}`;
      email.textContent = employee.email;
      email.addEventListener("click", (event) => event.stopPropagation());
      contactWrap.appendChild(email);
    } else {
      contactWrap.appendChild(createElement("span", "", "No email recorded"));
    }
    contactWrap.appendChild(createElement("span", "", employee.mobile || "No mobile recorded"));
    contact.appendChild(contactWrap);
    row.appendChild(contact);

    const statusCell = document.createElement("td");
    statusCell.appendChild(createElement("span", `status-badge ${statusClass(employee.dutyStatus)}`, employee.dutyStatus));
    row.appendChild(statusCell);

    const actionCell = createElement("td", "action-column");
    const button = createElement("button", "view-button");
    button.type = "button";
    button.title = `View ${employee.fullName}`;
    button.setAttribute("aria-label", `View profile for ${employee.fullName}`);
    button.dataset.employeeId = employee.id;
    button.appendChild(createIcon("eye"));
    button.addEventListener("click", () => openProfile(employee));
    actionCell.appendChild(button);
    row.appendChild(actionCell);

    row.addEventListener("dblclick", () => openProfile(employee));
    return row;
  }

  function appendCell(row, text, childTag = "") {
    const cell = document.createElement("td");
    if (childTag) cell.appendChild(createElement(childTag, "", text));
    else cell.textContent = text;
    row.appendChild(cell);
  }

  function createElement(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== "") element.textContent = text;
    return element;
  }

  function createIcon(name) {
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", name);
    return icon;
  }

  function showTableMessage(message) {
    if (!dom.tableBody) return;
    const row = document.createElement("tr");
    const cell = createElement("td", "empty", message);
    cell.colSpan = 8;
    row.appendChild(cell);
    dom.tableBody.replaceChildren(row);
    if (dom.recordCounter && state.isLoading) dom.recordCounter.textContent = "Loading…";
  }

  function updateMetrics() {
    const total = state.employees.length;
    const active = state.employees.filter((employee) => employee.dutyStatus === "Active").length;
    const onLeave = state.employees.filter((employee) => employee.dutyStatus === "On Leave").length;
    const departments = new Set(state.employees.map((employee) => lower(employee.department)).filter(Boolean));
    const percentage = total ? Math.round((active / total) * 100) : 0;

    setText("metricTotal", total);
    setText("metricActive", active);
    setText("metricActivePct", `${percentage}% of workforce`);
    setText("metricLeave", onLeave);
    setText("metricDepts", departments.size);
  }

  function initModal() {
    dom.modalClose?.addEventListener("click", closeProfile);
    dom.modalDone?.addEventListener("click", closeProfile);
    dom.printButton?.addEventListener("click", printProfile);
    dom.modal?.addEventListener("mousedown", (event) => {
      if (event.target === dom.modal) closeProfile();
    });

    document.addEventListener("keydown", (event) => {
      if (!dom.modal?.classList.contains("open")) return;
      if (event.key === "Escape") closeProfile();
      if (event.key === "Tab") trapModalFocus(event);
    });
  }

  function openProfile(employee) {
    state.selectedEmployee = employee;
    state.lastFocusedElement = document.activeElement;

    setText("viewAvatar", employee.initials);
    setText("viewHeadingName", employee.fullName);
    setText("viewHeadingDesignation", employee.designation || "Designation not recorded");

    const statusPill = byId("viewPillStatus");
    if (statusPill) {
      statusPill.textContent = employee.dutyStatus;
      statusPill.className = `status-badge ${statusClass(employee.dutyStatus)}`;
    }

    const fields = {
      v_id: employee.employeeId,
      v_dob: formatDate(employee.dob),
      v_pob: employee.birthPlace,
      v_gender: employee.gender,
      v_civil: employee.civilStatus,
      v_blood: employee.bloodType,
      v_desig: employee.designation,
      v_emp_status: employee.employmentType,
      v_dept: employee.department,
      v_item: employee.itemCode,
      v_date_employed: formatDate(employee.dateEmployed),
      v_date_assumption: formatDate(employee.dateAssumption),
      v_salary_gradestep: [formatSalaryGrade(employee.salaryGrade), employee.stepNo ? `Step ${employee.stepNo}` : ""].filter(Boolean).join(" / "),
      v_nosa_date: formatDate(employee.nosaDate),
      v_eligibility: employee.eligibility,
      v_education_level: employee.educationLevel,
      v_course: employee.course,
      v_last_school: employee.lastSchool,
      v_year_graduated: employee.yearGraduated,
      v_mobile: employee.mobile,
      v_mobile2: employee.mobile2,
      v_landline: employee.landline,
      v_email: employee.email,
      v_address: employee.address,
      v_created: formatDateTime(employee.createdAt),
      v_updated: formatDateTime(employee.updatedAt)
    };

    Object.entries(fields).forEach(([id, value]) => setText(id, displayValue(value)));

    dom.modal?.classList.add("open");
    dom.modal?.setAttribute("aria-hidden", "false");
    dom.body.classList.add("modal-open");
    dom.modalClose?.focus();
    createIcons();
  }

  function closeProfile() {
    if (!dom.modal?.classList.contains("open")) return;
    dom.modal.classList.remove("open");
    dom.modal.setAttribute("aria-hidden", "true");
    dom.body.classList.remove("modal-open", "employee-print-mode");
    state.selectedEmployee = null;
    if (state.lastFocusedElement instanceof HTMLElement) state.lastFocusedElement.focus();
  }

  function trapModalFocus(event) {
    const focusable = $$(
      "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      dom.modalPanel
    ).filter((element) => element.offsetParent !== null);

    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function printProfile() {
    if (!state.selectedEmployee) return;
    dom.body.classList.add("employee-print-mode");
    window.print();
    window.setTimeout(() => dom.body.classList.remove("employee-print-mode"), 1200);
  }

  function initPrintCleanup() {
    window.addEventListener("afterprint", () => dom.body.classList.remove("employee-print-mode"));
  }

  function exportEmployees() {
    if (!state.filtered.length) {
      showToast("No matching employee records to export.", "error");
      return;
    }

    const headers = [
      "Employee ID", "Full Name", "Designation", "Employment Type", "Department",
      "Duty Status", "Item Code", "Date Employed", "Date Assumption", "Salary Grade", "Step",
      "Eligibility", "Education Level", "Course", "Last School Attended", "Year Graduated",
      "Mobile", "Secondary Mobile", "Landline", "Email", "Gender", "Civil Status", "Blood Type", "Date of Birth", "Address"
    ];
    const rows = state.filtered.map((employee) => [
      employee.employeeId,
      employee.fullName,
      employee.designation,
      employee.employmentType,
      employee.department,
      employee.dutyStatus,
      employee.itemCode,
      employee.dateEmployed,
      employee.dateAssumption,
      employee.salaryGrade,
      employee.stepNo,
      employee.eligibility,
      employee.educationLevel,
      employee.course,
      employee.lastSchool,
      employee.yearGraduated,
      employee.mobile,
      employee.mobile2,
      employee.landline,
      employee.email,
      employee.gender,
      employee.civilStatus,
      employee.bloodType,
      employee.dob,
      employee.address
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pgenro-employee-directory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(`${state.filtered.length} ${pluralize(state.filtered.length, "record")} exported.`);
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function subscribeToEmployeeChanges() {
    if (!db || state.realtimeChannel) return;
    try {
      state.realtimeChannel = db
        .channel("user-employee-directory-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: CONFIG.employeeTable },
          () => loadEmployees({ notify: false })
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") setConnectionStatus("online", "Personnel records connected");
          if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
            setConnectionStatus("standby", "Live updates reconnecting…");
          }
        });
    } catch (error) {
      console.warn("Realtime employee updates are unavailable:", error);
    }

    window.addEventListener("beforeunload", () => {
      if (state.realtimeChannel) db.removeChannel(state.realtimeChannel);
    }, { once: true });
  }

  function initSidebar() {
    const mobileQuery = window.matchMedia("(max-width: 1024px)");

    const closeProfileMenu = () => {
      dom.profileMenu?.classList.remove("open");
      dom.profileButton?.setAttribute("aria-expanded", "false");
      dom.profileDropdown?.setAttribute("aria-hidden", "true");
    };

    const setSidebarOpen = (open) => {
      const shouldOpen = Boolean(open && mobileQuery.matches);
      dom.sidebar?.classList.toggle("open", shouldOpen);
      dom.hamburger?.classList.toggle("active", shouldOpen);
      dom.hamburger?.setAttribute("aria-expanded", String(shouldOpen));
      dom.hamburger?.setAttribute("aria-label", shouldOpen ? "Close module menu" : "Open module menu");
      dom.overlay?.classList.toggle("active", shouldOpen);
      dom.overlay?.setAttribute("aria-hidden", String(!shouldOpen));
      dom.body.classList.toggle("sidebar-open", shouldOpen);
    };

    dom.hamburger?.addEventListener("click", () => {
      closeProfileMenu();
      setSidebarOpen(!dom.sidebar?.classList.contains("open"));
    });
    dom.overlay?.addEventListener("click", () => setSidebarOpen(false));
    $$(".modules-list a", dom.sidebar).forEach((link) => {
      link.addEventListener("click", () => setSidebarOpen(false));
    });

    const resetNavigation = () => {
      closeProfileMenu();
      setSidebarOpen(false);
    };
    if (typeof mobileQuery.addEventListener === "function") mobileQuery.addEventListener("change", resetNavigation);
    else mobileQuery.addListener(resetNavigation);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || dom.modal?.classList.contains("open")) return;
      if (dom.sidebar?.classList.contains("open")) {
        setSidebarOpen(false);
        dom.hamburger?.focus();
      }
    });
  }

  function initProfileMenu() {
    const close = () => {
      dom.profileMenu?.classList.remove("open");
      dom.profileButton?.setAttribute("aria-expanded", "false");
      dom.profileDropdown?.setAttribute("aria-hidden", "true");
    };

    dom.profileButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = !dom.profileMenu?.classList.contains("open");
      close();
      if (willOpen) {
        dom.profileMenu?.classList.add("open");
        dom.profileButton.setAttribute("aria-expanded", "true");
        dom.profileDropdown?.setAttribute("aria-hidden", "false");
      }
    });

    dom.profileMenu?.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dom.profileMenu?.classList.contains("open")) {
        close();
        dom.profileButton?.focus();
      }
    });
    dom.logoutButton?.addEventListener("click", signOut);
  }


  function showLogoutDialog() {
    return new Promise((resolve) => {
      let overlay = document.getElementById("pgenroLogoutDialog");

      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "pgenroLogoutDialog";
        overlay.className = "pgenro-logout-dialog";
        overlay.setAttribute("aria-hidden", "true");
        overlay.innerHTML = `
          <div class="pgenro-logout-dialog__panel" role="alertdialog" aria-modal="true" aria-labelledby="pgenroLogoutTitle" aria-describedby="pgenroLogoutMessage">
            <div class="pgenro-logout-dialog__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 17l5-5-5-5"></path>
                <path d="M15 12H3"></path>
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
              </svg>
            </div>
            <div class="pgenro-logout-dialog__content">
              <span class="pgenro-logout-dialog__eyebrow">Session</span>
              <h2 id="pgenroLogoutTitle">Log out of PGENRO IMS?</h2>
              <p id="pgenroLogoutMessage">You’ll need to sign in again to access your workspace.</p>
            </div>
            <div class="pgenro-logout-dialog__actions">
              <button class="pgenro-logout-dialog__button pgenro-logout-dialog__button--cancel" type="button" data-logout-cancel>Cancel</button>
              <button class="pgenro-logout-dialog__button pgenro-logout-dialog__button--confirm" type="button" data-logout-confirm>
                <span>Yes, log out</span>
              </button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
      }

      const panel = overlay.querySelector(".pgenro-logout-dialog__panel");
      const cancelButton = overlay.querySelector("[data-logout-cancel]");
      const confirmButton = overlay.querySelector("[data-logout-confirm]");
      const previousFocus = document.activeElement;
      let settled = false;

      const finish = (confirmed) => {
        if (settled) return;
        settled = true;

        overlay.classList.remove("is-open");
        overlay.setAttribute("aria-hidden", "true");
        document.body.classList.remove("pgenro-logout-dialog-open");
        document.removeEventListener("keydown", onKeyDown);
        overlay.removeEventListener("click", onBackdropClick);
        cancelButton?.removeEventListener("click", onCancel);
        confirmButton?.removeEventListener("click", onConfirm);

        window.setTimeout(() => {
          if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
            previousFocus.focus({ preventScroll: true });
          }
        }, 120);

        resolve(confirmed);
      };

      const onCancel = () => finish(false);
      const onConfirm = () => finish(true);
      const onBackdropClick = (event) => {
        if (event.target === overlay) finish(false);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
          return;
        }

        if (event.key !== "Tab" || !panel) return;
        const focusable = [...panel.querySelectorAll("button:not([disabled])")];
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      cancelButton?.addEventListener("click", onCancel);
      confirmButton?.addEventListener("click", onConfirm);
      overlay.addEventListener("click", onBackdropClick);
      document.addEventListener("keydown", onKeyDown);

      overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("pgenro-logout-dialog-open");
      requestAnimationFrame(() => {
        overlay.classList.add("is-open");
        cancelButton?.focus({ preventScroll: true });
      });
    });
  }

  async function signOut(event) {
    event?.preventDefault();
    if (!(await showLogoutDialog())) return;

    try {
      if (db) await db.auth.signOut();
    } catch (error) {
      console.warn("Remote logout failed:", error);
    }

    try {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith("sb-") || key.startsWith("pgenro_")) localStorage.removeItem(key);
      });
      sessionStorage.clear();
    } catch (error) {
      console.warn("Local session cleanup failed:", error);
    }
    window.location.assign(CONFIG.loginUrl);
  }

  function initScrollToTop() {
    const update = () => dom.scrollTopButton?.classList.toggle("visible", window.scrollY > 360);
    window.addEventListener("scroll", update, { passive: true });
    dom.scrollTopButton?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    update();
  }

  function initRevealAnimations() {
    const sections = $$(".reveal");
    if (!sections.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sections.forEach((section) => section.classList.add("show"));
      return;
    }
    sections.forEach((section, index) => {
      window.setTimeout(() => section.classList.add("show"), 80 + (index * 85));
    });
  }

  function updateTimestamp() {
    if (!dom.lastUpdated) return;
    dom.lastUpdated.textContent = `Updated ${new Intl.DateTimeFormat("en-PH", {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date())}`;
  }

  function setConnectionStatus(status, message) {
    if (dom.statusIndicator) dom.statusIndicator.className = `status-indicator ${status}`;
    if (dom.statusText) dom.statusText.textContent = message;
  }

  function setRefreshLoading(loading) {
    if (!dom.refreshButton) return;
    dom.refreshButton.disabled = loading;
    dom.refreshButton.classList.toggle("loading", loading);
    const label = $("span", dom.refreshButton);
    if (label) label.textContent = loading ? "Refreshing" : "Refresh";
  }

  function showToast(message, type = "success") {
    if (!dom.toastContainer) return;
    const toast = createElement("div", `toast${type === "error" ? " error" : ""}`);
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.appendChild(createIcon(type === "error" ? "circle-alert" : "circle-check"));
    toast.appendChild(createElement("span", "", message));
    dom.toastContainer.appendChild(toast);
    createIcons();
    window.setTimeout(() => toast.remove(), 3600);
  }

  function statusClass(status) {
    const normalized = lower(status);
    if (normalized === "on leave") return "on-leave";
    if (normalized === "inactive") return "inactive";
    if (normalized === "active") return "active";
    return "";
  }

  function getInitials(employee) {
    const first = valueOf(employee.firstName).charAt(0);
    const last = valueOf(employee.lastName).charAt(0);
    return (first + last).toUpperCase() || "EE";
  }

  function formatSalaryGrade(value) {
    const grade = valueOf(value);
    if (!grade) return "";
    return /^sg\b/i.test(grade) ? grade : `SG ${grade}`;
  }

  function formatDate(value) {
    if (!valueOf(value)) return "";
    const date = new Date(`${valueOf(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return valueOf(value);
    return new Intl.DateTimeFormat("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(date);
  }

  function formatDateTime(value) {
    if (!valueOf(value)) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return valueOf(value);
    return new Intl.DateTimeFormat("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function pluralize(count, noun) {
    return `${noun}${count === 1 ? "" : "s"}`;
  }

  function setText(id, value) {
    const node = byId(id);
    if (node) node.textContent = String(value ?? "");
  }

  function createIcons() {
    window.lucide?.createIcons?.();
  }
})();
