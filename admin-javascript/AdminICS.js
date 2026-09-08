document.addEventListener("DOMContentLoaded", () => {

  // ========================================================================
  // BASIC HELPERS
  // ========================================================================

  const $ = (id) => document.getElementById(id);

  const escapeHtml = (value) => {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  };

  const formatMoney = (value) => {
    return `₱${(Number(value) || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };

  const formatNumber = (value) => {
    return (Number(value) || 0).toLocaleString("en-PH", {
      maximumFractionDigits: 2
    });
  };

  const timestampToDate = (value) => {
    if (!value) return null;

    if (typeof value.toDate === "function") {
      return value.toDate();
    }

    if (value instanceof Date) {
      return value;
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatDate = (value) => {
    if (!value) return "---";

    const date = timestampToDate(value);

    if (!date) {
      return String(value);
    }

    return date.toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "2-digit"
    });
  };

  const formatDateInput = (value) => {
    if (!value) return "";

    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      return value;
    }

    const date = timestampToDate(value);

    if (!date) return "";

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");

    return `${y}-${m}-${d}`;
  };


  // ========================================================================
  // FIREBASE CONFIGURATION
  // ========================================================================

  const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_FIREBASE_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_FIREBASE_PROJECT_ID",
    storageBucket: "YOUR_FIREBASE_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
    appId: "YOUR_FIREBASE_APP_ID"
  };


  let db = null;
  let firebaseReady = false;

  let allRecords = [];
  let activeRecordId = null;
  let currentStatusFilter = "ALL";


  // ========================================================================
  // FIREBASE INITIALIZATION
  // ========================================================================

  try {

    if (typeof firebase === "undefined") {
      throw new Error("Firebase SDK is not loaded.");
    }

    if (firebase.apps.length === 0) {
      firebase.initializeApp(firebaseConfig);
    }

    db = firebase.firestore();

    firebaseReady = true;

    updateDatabaseStatus(
      true,
      "Firebase Connected"
    );

  } catch (error) {

    console.error(
      "Firebase initialization error:",
      error
    );

    firebaseReady = false;

    updateDatabaseStatus(
      false,
      "Database Disconnected"
    );
  }


  // ========================================================================
  // DATABASE STATUS UI
  // ========================================================================

  function updateDatabaseStatus(isOnline, message) {

    const statusIds = [
      "dbStatusDot",
      "topStatusDot"
    ];

    statusIds.forEach((id) => {

      const element = $(id);

      if (!element) return;

      element.className =
        isOnline
          ? "status-dot online"
          : "status-dot offline";
    });


    const dbText = $("dbStatusText");

    if (dbText) {
      dbText.textContent =
        message ||
        (isOnline
          ? "Connected"
          : "Disconnected");
    }


    const topText = $("topStatusText");

    if (topText) {
      topText.textContent =
        isOnline
          ? "Database Online"
          : "Database Offline";
    }
  }


  // ========================================================================
  // LUCIDE ICONS
  // ========================================================================

  function refreshIcons() {

    if (
      typeof window.lucide !== "undefined" &&
      typeof lucide.createIcons === "function"
    ) {
      lucide.createIcons();
    }
  }

  refreshIcons();


  // ========================================================================
  // SIDEBAR
  // ========================================================================

  const sidebarCollapseBtn =
    $("sidebarCollapseBtn");

  const sidebar =
    $("sidebar");

  if (sidebarCollapseBtn && sidebar) {

    sidebarCollapseBtn.addEventListener(
      "click",
      () => {

        sidebar.classList.toggle("collapsed");

        document.body.classList.toggle(
          "sidebar-collapsed"
        );
      }
    );
  }


  const mobileMenuBtn =
    $("mobileMenuBtn");

  if (mobileMenuBtn && sidebar) {

    mobileMenuBtn.addEventListener(
      "click",
      () => {

        sidebar.classList.toggle(
          "mobile-open"
        );
      }
    );
  }


  // ========================================================================
  // PROFILE MENU
  // ========================================================================

  const profileBtn =
    $("profileBtn");

  const profileMenu =
    $("profileMenu");

  if (profileBtn && profileMenu) {

    profileBtn.addEventListener(
      "click",
      (event) => {

        event.stopPropagation();

        profileMenu.classList.toggle(
          "open"
        );
      }
    );


    document.addEventListener(
      "click",
      () => {
        profileMenu.classList.remove(
          "open"
        );
      }
    );
  }


  // ========================================================================
  // LOGOUT
  // ========================================================================

  const logoutBtn =
    $("logoutBtn");

  if (logoutBtn) {

    logoutBtn.addEventListener(
      "click",
      () => {

        const confirmed =
          confirm(
            "Are you sure you want to sign out of PGENRO IMS?"
          );

        if (confirmed) {

          window.location.href =
            "../User/login.html";
        }
      }
    );
  }


  // ========================================================================
  // GLOBAL SEARCH SHORTCUT
  // ========================================================================

  document.addEventListener(
    "keydown",
    (event) => {

      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {

        event.preventDefault();

        const search =
          $("icsSearchInput");

        if (search) {
          search.focus();
        }
      }
    }
  );


  // ========================================================================
  // FORM ELEMENTS
  // ========================================================================

  const form =
    $("icsForm");

  const editorModal =
    $("editorModal");

  const viewModal =
    $("viewModal");


  // ========================================================================
  // OPEN EDITOR
  // ========================================================================

  function openEditor(record = null) {

    if (!editorModal) return;

    resetForm();

    if (record) {

      $("editorTitle").textContent =
        "Edit Inventory Custodian Slip";

      $("recordId").value =
        record.id || "";

      setFormValue(
        record
      );

    } else {

      $("editorTitle").textContent =
        "New Inventory Custodian Slip";

      $("recordId").value =
        "";
    }

    editorModal.classList.add(
      "open"
    );

    setTimeout(
      () => {

        $("controlNo")?.focus();

      },
      100
    );
  }


  // ========================================================================
  // CLOSE EDITOR
  // ========================================================================

  function closeEditor() {

    editorModal?.classList.remove(
      "open"
    );
  }


  $("addIcsBtn")?.addEventListener(
    "click",
    () => {
      openEditor();
    }
  );


  $("closeEditorBtn")?.addEventListener(
    "click",
    closeEditor
  );


  $("cancelEditorBtn")?.addEventListener(
    "click",
    closeEditor
  );


  // ========================================================================
  // RESET FORM
  // ========================================================================

  function resetForm() {

    if (!form) return;

    form.reset();

    $("recordId").value = "";

    $("unit").value =
      "unit";

    $("quantity").value =
      "1";

    $("unitCost").value =
      "0";

    $("fundCluster").value =
      "General Fund (01)";

    $("status").value =
      "Active";

    updateTotalPreview();
  }


  // ========================================================================
  // SET FORM DATA
  // ========================================================================

  function setFormValue(record) {

    const fields = [
      "controlNo",
      "icsNo",
      "entryNo",
      "accountCode",
      "article",
      "itemDescription",
      "serialNo",
      "itemNo",
      "unit",
      "quantity",
      "unitCost",
      "prNo",
      "fundCluster",
      "accountablePerson",
      "division",
      "status",
      "remarks"
    ];


    fields.forEach(
      (field) => {

        const element =
          $(field);

        if (!element) return;

        element.value =
          record[field] ??
          "";
      }
    );


    $("dateAcquired").value =
      formatDateInput(
        record.dateAcquired
      );


    $("prDate").value =
      formatDateInput(
        record.prDate
      );


    updateTotalPreview();
  }


  // ========================================================================
  // GET FORM DATA
  // ========================================================================

  function getFormData() {

    const quantity =
      Number(
        $("quantity")?.value || 0
      );

    const unitCost =
      Number(
        $("unitCost")?.value || 0
      );

    const totalValue =
      Number(
        (quantity * unitCost)
          .toFixed(2)
      );


    return {

      controlNo:
        $("controlNo").value.trim(),

      icsNo:
        $("icsNo").value.trim(),

      entryNo:
        $("entryNo").value.trim(),

      accountCode:
        $("accountCode").value.trim(),

      article:
        $("article").value.trim(),

      itemDescription:
        $("itemDescription").value.trim(),

      serialNo:
        $("serialNo").value.trim(),

      itemNo:
        $("itemNo").value.trim(),

      unit:
        $("unit").value.trim() ||
        "unit",

      quantity,

      unitCost,

      totalValue,

      dateAcquired:
        $("dateAcquired").value ||
        "",

      prNo:
        $("prNo").value.trim(),

      prDate:
        $("prDate").value ||
        "",

      fundCluster:
        $("fundCluster").value.trim(),

      accountablePerson:
        $("accountablePerson").value.trim(),

      division:
        $("division").value.trim(),

      status:
        $("status").value ||
        "Active",

      remarks:
        $("remarks").value.trim()
    };
  }


  // ========================================================================
  // TOTAL VALUE PREVIEW
  // ========================================================================

  function updateTotalPreview() {

    const quantity =
      Number(
        $("quantity")?.value || 0
      );

    const unitCost =
      Number(
        $("unitCost")?.value || 0
      );

    const total =
      quantity * unitCost;

    const preview =
      $("totalValuePreview");

    if (preview) {

      preview.textContent =
        formatMoney(total);
    }
  }


  $("quantity")?.addEventListener(
    "input",
    updateTotalPreview
  );


  $("unitCost")?.addEventListener(
    "input",
    updateTotalPreview
  );


  // ========================================================================
  // SAVE / UPDATE RECORD
  // ========================================================================

  if (form) {

    form.addEventListener(
      "submit",
      async (event) => {

        event.preventDefault();


        if (!firebaseReady || !db) {

          alert(
            "Firebase is not connected. Please check your Firebase configuration."
          );

          return;
        }


        const data =
          getFormData();


        if (
          !data.controlNo ||
          !data.icsNo ||
          !data.article ||
          !data.itemDescription ||
          !data.accountablePerson
        ) {

          alert(
            "Please complete all required fields."
          );

          return;
        }


        const recordId =
          $("recordId")?.value.trim();


        const saveButton =
          $("saveIcsBtn");

        const originalHtml =
          saveButton?.innerHTML;


        if (saveButton) {

          saveButton.disabled =
            true;

          saveButton.innerHTML =
            `
              <i data-lucide="loader-circle"></i>
              Saving...
            `;

          refreshIcons();
        }


        try {

          if (recordId) {

            await db
              .collection("ics_records")
              .doc(recordId)
              .set(
                {
                  ...data,

                  updatedAt:
                    firebase.firestore
                      .FieldValue
                      .serverTimestamp()
                },
                {
                  merge: true
                }
              );


            showToast(
              "ICS record updated successfully.",
              "success"
            );

          } else {

            await db
              .collection("ics_records")
              .add(
                {
                  ...data,

                  createdAt:
                    firebase.firestore
                      .FieldValue
                      .serverTimestamp(),

                  updatedAt:
                    firebase.firestore
                      .FieldValue
                      .serverTimestamp()
                }
              );


            showToast(
              "ICS record saved successfully.",
              "success"
            );
          }


          closeEditor();

        } catch (error) {

          console.error(
            "Save ICS error:",
            error
          );

          alert(
            "Unable to save the ICS record.\n\nCheck your Firebase configuration and Firestore security rules."
          );

        } finally {

          if (saveButton) {

            saveButton.disabled =
              false;

            saveButton.innerHTML =
              originalHtml;

            refreshIcons();
          }
        }
      }
    );
  }


  // ========================================================================
  // FIRESTORE REALTIME LISTENER
  // ========================================================================

  function attachFirestoreListener() {

    if (!firebaseReady || !db) {

      renderTable([]);

      return;
    }


    db.collection("ics_records")
      .onSnapshot(
        (snapshot) => {

          allRecords = [];


          snapshot.forEach(
            (doc) => {

              allRecords.push(
                {
                  id: doc.id,
                  ...doc.data()
                }
              );
            }
          );


          sortRecords();


          updateKpis();

          populateFilters();

          applyFilters();


          updateDatabaseStatus(
            true,
            "Firebase Connected"
          );

        },
        (error) => {

          console.error(
            "Firestore listener error:",
            error
          );

          updateDatabaseStatus(
            false,
            "Firestore Read Error"
          );

          renderTable([]);
        }
      );
  }


  // ========================================================================
  // SORT RECORDS
  // ========================================================================

  function sortRecords() {

    allRecords.sort(
      (a, b) => {

        const dateA =
          timestampToDate(
            a.updatedAt ||
            a.createdAt ||
            a.dateAcquired
          );

        const dateB =
          timestampToDate(
            b.updatedAt ||
            b.createdAt ||
            b.dateAcquired
          );


        return (
          (dateB?.getTime() || 0) -
          (dateA?.getTime() || 0)
        );
      }
    );
  }


  // ========================================================================
  // KPIs
  // ========================================================================

  function updateKpis() {

    const total =
      allRecords.length;


    const active =
      allRecords.filter(
        (record) =>
          (record.status || "Active") ===
          "Active"
      ).length;


    const archived =
      allRecords.filter(
        (record) =>
          (record.status || "Active") ===
          "Archived"
      ).length;


    const totalValue =
      allRecords.reduce(
        (sum, record) => {

          const value =
            record.totalValue != null
              ? Number(record.totalValue) || 0
              : (
                  (Number(record.quantity) || 0) *
                  (Number(record.unitCost) || 0)
                );

          return sum + value;
        },
        0
      );


    if ($("kpiTotal")) {
      $("kpiTotal").textContent =
        total.toLocaleString();
    }


    if ($("kpiActive")) {
      $("kpiActive").textContent =
        active.toLocaleString();
    }


    if ($("kpiArchived")) {
      $("kpiArchived").textContent =
        archived.toLocaleString();
    }


    if ($("kpiValue")) {
      $("kpiValue").textContent =
        formatMoney(totalValue);
    }
  }


  // ========================================================================
  // FILTER OPTIONS
  // ========================================================================

  function populateFilters() {

    const articles =
      [
        ...new Set(
          allRecords
            .map(
              record =>
                String(
                  record.article || ""
                ).trim()
            )
            .filter(Boolean)
        )
      ]
      .sort();


    const divisions =
      [
        ...new Set(
          allRecords
            .map(
              record =>
                String(
                  record.division || ""
                ).trim()
            )
            .filter(Boolean)
        )
      ]
      .sort();


    rebuildSelect(
      $("articleFilter"),
      "All Articles",
      articles
    );


    rebuildSelect(
      $("divisionFilter"),
      "All Divisions",
      divisions
    );
  }


  function rebuildSelect(
    select,
    label,
    values
  ) {

    if (!select) return;


    const currentValue =
      select.value;


    select.innerHTML =
      `<option value="ALL">${label}</option>`;


    values.forEach(
      (value) => {

        const option =
          document.createElement(
            "option"
          );

        option.value =
          value;

        option.textContent =
          value;

        select.appendChild(
          option
        );
      }
    );


    if (
      values.includes(
        currentValue
      )
    ) {

      select.value =
        currentValue;
    }
  }


  // ========================================================================
  // SEARCH + FILTER
  // ========================================================================

  const searchInput =
    $("icsSearchInput");

  const globalSearchInput =
    $("globalSearchInput");


  searchInput?.addEventListener(
    "input",
    applyFilters
  );


  globalSearchInput?.addEventListener(
    "input",
    () => {

      if (searchInput) {

        searchInput.value =
          globalSearchInput.value;

        applyFilters();
      }
    }
  );


  $("articleFilter")?.addEventListener(
    "change",
    applyFilters
  );


  $("divisionFilter")?.addEventListener(
    "change",
    applyFilters
  );


  function applyFilters() {

    const searchTerm =
      (
        searchInput?.value ||
        ""
      )
      .toLowerCase()
      .trim();


    const articleFilter =
      $("articleFilter")?.value ||
      "ALL";


    const divisionFilter =
      $("divisionFilter")?.value ||
      "ALL";


    const filtered =
      allRecords.filter(
        (record) => {

          const searchableText =
            [
              record.controlNo,
              record.icsNo,
              record.entryNo,
              record.accountCode,
              record.article,
              record.itemDescription,
              record.serialNo,
              record.itemNo,
              record.accountablePerson,
              record.division,
              record.prNo,
              record.remarks
            ]
            .join(" ")
            .toLowerCase();


          const matchesSearch =
            !searchTerm ||
            searchableText.includes(
              searchTerm
            );


          const matchesArticle =
            articleFilter === "ALL" ||
            String(
              record.article || ""
            ) === articleFilter;


          const matchesDivision =
            divisionFilter === "ALL" ||
            String(
              record.division || ""
            ) === divisionFilter;


          const matchesStatus =
            currentStatusFilter === "ALL" ||
            (record.status || "Active") ===
              currentStatusFilter;


          return (
            matchesSearch &&
            matchesArticle &&
            matchesDivision &&
            matchesStatus
          );
        }
      );


    renderTable(
      filtered
    );
  }


  // ========================================================================
  // STATUS TABS
  // ========================================================================

  document
    .querySelectorAll(
      ".view-tab"
    )
    .forEach(
      (button) => {

        button.addEventListener(
          "click",
          () => {

            document
              .querySelectorAll(
                ".view-tab"
              )
              .forEach(
                (btn) => {
                  btn.classList.remove(
                    "active"
                  );
                }
              );


            button.classList.add(
              "active"
            );


            currentStatusFilter =
              button.dataset.statusFilter ||
              "ALL";


            applyFilters();
          }
        );
      }
    );


  // ========================================================================
  // CLEAR FILTERS
  // ========================================================================

  $("clearFiltersBtn")?.addEventListener(
    "click",
    () => {

      if (searchInput) {
        searchInput.value = "";
      }

      if (globalSearchInput) {
        globalSearchInput.value = "";
      }

      if ($("articleFilter")) {
        $("articleFilter").value = "ALL";
      }

      if ($("divisionFilter")) {
        $("divisionFilter").value = "ALL";
      }


      currentStatusFilter =
        "ALL";


      document
        .querySelectorAll(
          ".view-tab"
        )
        .forEach(
          (button) => {

            button.classList.toggle(
              "active",
              button.dataset.statusFilter ===
                "ALL"
            );
          }
        );


      applyFilters();
    }
  );


  // ========================================================================
  // RENDER TABLE
  // ========================================================================

  function renderTable(
    records
  ) {

    const tbody =
      $("icsTableBody");

    if (!tbody) return;


    if (!records.length) {

      tbody.innerHTML =
        `
          <tr>
            <td colspan="9" class="empty-row">
              No ICS records match the current filters.
            </td>
          </tr>
        `;


      if ($("recordCounter")) {

        $("recordCounter").textContent =
          "Showing 0 records";
      }


      return;
    }


    tbody.innerHTML =
      records
        .map(
          (record) => {

            const status =
              record.status ||
              "Active";


            const totalValue =
              record.totalValue != null
                ? Number(record.totalValue) || 0
                : (
                    (Number(record.quantity) || 0) *
                    (Number(record.unitCost) || 0)
                  );


            return `
              <tr>

                <td>
                  <div class="record-primary font-mono">
                    ${escapeHtml(
                      record.controlNo ||
                      "---"
                    )}
                  </div>

                  <div class="record-secondary font-mono">
                    ${escapeHtml(
                      record.icsNo ||
                      "---"
                    )}
                  </div>
                </td>


                <td>

                  <div class="record-primary">
                    ${escapeHtml(
                      record.article ||
                      "Uncategorized"
                    )}
                  </div>

                  <div
                    class="record-secondary item-description"
                    title="${escapeHtml(
                      record.itemDescription ||
                      ""
                    )}"
                  >
                    ${escapeHtml(
                      record.itemDescription ||
                      "---"
                    )}
                  </div>

                </td>


                <td class="font-mono">
                  ${escapeHtml(
                    record.serialNo ||
                    "---"
                  )}
                </td>


                <td>
                  ${formatNumber(
                    record.quantity || 0
                  )}
                  ${escapeHtml(
                    record.unit ||
                    "unit"
                  )}
                </td>


                <td class="font-mono">
                  ${formatMoney(
                    totalValue
                  )}
                </td>


                <td>

                  <div class="record-primary">
                    ${escapeHtml(
                      record.accountablePerson ||
                      "---"
                    )}
                  </div>

                  <div class="record-secondary">
                    ${escapeHtml(
                      record.division ||
                      ""
                    )}
                  </div>

                </td>


                <td>
                  ${escapeHtml(
                    formatDate(
                      record.dateAcquired
                    )
                  )}
                </td>


                <td>

                  <span
                    class="status-badge ${
                      status === "Archived"
                        ? "archived"
                        : "active"
                    }"
                  >
                    ${escapeHtml(
                      status
                    )}
                  </span>

                </td>


                <td>

                  <div class="row-actions">

                    <button
                      class="row-btn"
                      type="button"
                      title="View"
                      data-action="view"
                      data-id="${escapeHtml(
                        record.id
                      )}"
                    >
                      <i data-lucide="eye"></i>
                    </button>


                    <button
                      class="row-btn edit"
                      type="button"
                      title="Edit"
                      data-action="edit"
                      data-id="${escapeHtml(
                        record.id
                      )}"
                    >
                      <i data-lucide="square-pen"></i>
                    </button>


                    <button
                      class="row-btn delete"
                      type="button"
                      title="Delete"
                      data-action="delete"
                      data-id="${escapeHtml(
                        record.id
                      )}"
                    >
                      <i data-lucide="trash-2"></i>
                    </button>

                  </div>

                </td>

              </tr>
            `;
          }
        )
        .join("");


    if ($("recordCounter")) {

      $("recordCounter").textContent =
        `Showing ${records.length.toLocaleString()} of ${allRecords.length.toLocaleString()} records`;
    }


    refreshIcons();


    tbody
      .querySelectorAll(
        "[data-action]"
      )
      .forEach(
        (button) => {

          button.addEventListener(
            "click",
            () => {

              handleRowAction(
                button.dataset.action,
                button.dataset.id
              );
            }
          );
        }
      );
  }


  // ========================================================================
  // ROW ACTIONS
  // ========================================================================

  function handleRowAction(
    action,
    id
  ) {

    const record =
      allRecords.find(
        item => item.id === id
      );


    if (!record) return;


    if (action === "view") {

      openView(
        record
      );

      return;
    }


    if (action === "edit") {

      openEditor(
        record
      );

      return;
    }


    if (action === "delete") {

      deleteRecord(
        record
      );
    }
  }


  // ========================================================================
  // VIEW RECORD MODAL
  // ========================================================================

  function openView(
    record
  ) {

    activeRecordId =
      record.id;


    if ($("viewTitle")) {
      $("viewTitle").textContent =
        record.controlNo ||
        "ICS Record Details";
    }


    if ($("viewArticle")) {
      $("viewArticle").textContent =
        record.article ||
        "---";
    }


    if ($("viewDescription")) {
      $("viewDescription").textContent =
        record.itemDescription ||
        "---";
    }


    if ($("viewControlNo")) {
      $("viewControlNo").textContent =
        record.controlNo ||
        "---";
    }


    if ($("viewIcsNo")) {
      $("viewIcsNo").textContent =
        record.icsNo ||
        "---";
    }


    if ($("viewAccountCode")) {
      $("viewAccountCode").textContent =
        record.accountCode ||
        "---";
    }


    if ($("viewEntryNo")) {
      $("viewEntryNo").textContent =
        record.entryNo ||
        "---";
    }


    if ($("viewSerialNo")) {
      $("viewSerialNo").textContent =
        record.serialNo ||
        "---";
    }


    if ($("viewItemNo")) {
      $("viewItemNo").textContent =
        record.itemNo ||
        "---";
    }


    if ($("viewQty")) {
      $("viewQty").textContent =
        formatNumber(
          record.quantity || 0
        );
    }


    if ($("viewUnit")) {
      $("viewUnit").textContent =
        record.unit ||
        "unit";
    }


    if ($("viewUnitCost")) {
      $("viewUnitCost").textContent =
        formatMoney(
          record.unitCost
        );
    }


    const totalValue =
      record.totalValue != null
        ? Number(record.totalValue) || 0
        : (
            (Number(record.quantity) || 0) *
            (Number(record.unitCost) || 0)
          );


    if ($("viewTotalValue")) {
      $("viewTotalValue").textContent =
        formatMoney(
          totalValue
        );
    }


    if ($("viewDateAcquired")) {
      $("viewDateAcquired").textContent =
        formatDate(
          record.dateAcquired
        );
    }


    if ($("viewPrNo")) {
      $("viewPrNo").textContent =
        record.prNo ||
        "---";
    }


    if ($("viewPrDate")) {
      $("viewPrDate").textContent =
        formatDate(
          record.prDate
        );
    }


    if ($("viewFundCluster")) {
      $("viewFundCluster").textContent =
        record.fundCluster ||
        "---";
    }


    if ($("viewAccountable")) {
      $("viewAccountable").textContent =
        record.accountablePerson ||
        "---";
    }


    if ($("viewDivision")) {
      $("viewDivision").textContent =
        record.division ||
        "---";
    }


    if ($("viewRemarks")) {
      $("viewRemarks").textContent =
        record.remarks ||
        "No remarks.";
    }


    const status =
      record.status ||
      "Active";


    const badge =
      $("viewStatus");


    if (badge) {

      badge.textContent =
        status;

      badge.className =
        `status-badge ${
          status === "Archived"
            ? "archived"
            : "active"
        }`;
    }


    viewModal?.classList.add(
      "open"
    );
  }


  // ========================================================================
  // CLOSE VIEW
  // ========================================================================

  function closeView() {

    viewModal?.classList.remove(
      "open"
    );

    activeRecordId =
      null;
  }


  $("closeViewBtn")?.addEventListener(
    "click",
    closeView
  );


  // ========================================================================
  // VIEW -> EDIT
  // ========================================================================

  $("editViewBtn")?.addEventListener(
    "click",
    () => {

      const record =
        allRecords.find(
          item =>
            item.id ===
            activeRecordId
        );


      if (!record) return;


      closeView();

      openEditor(
        record
      );
    }
  );


  // ========================================================================
  // VIEW -> DELETE
  // ========================================================================

  $("deleteViewBtn")?.addEventListener(
    "click",
    async () => {

      const record =
        allRecords.find(
          item =>
            item.id ===
            activeRecordId
        );


      if (!record) return;


      closeView();

      await deleteRecord(
        record
      );
    }
  );


  // ========================================================================
  // VIEW -> PRINT
  // ========================================================================

  $("printViewBtn")?.addEventListener(
    "click",
    () => {

      const record =
        allRecords.find(
          item =>
            item.id ===
            activeRecordId
        );


      if (record) {

        printRecord(
          record
        );
      }
    }
  );


  // ========================================================================
  // DELETE RECORD
  // ========================================================================

  async function deleteRecord(
    record
  ) {

    if (!firebaseReady || !db) {

      alert(
        "Firebase is not connected."
      );

      return;
    }


    const label =
      record.controlNo ||
      record.icsNo ||
      record.id;


    const confirmed =
      confirm(
        `Delete ICS record "${label}"?\n\nThis will permanently remove the record from Firestore.`
      );


    if (!confirmed) return;


    try {

      await db
        .collection("ics_records")
        .doc(record.id)
        .delete();


      showToast(
        "ICS record deleted successfully.",
        "success"
      );

    } catch (error) {

      console.error(
        "Delete error:",
        error
      );

      alert(
        "Delete failed.\n\nCheck your Firestore security rules."
      );
    }
  }


  // ========================================================================
  // CSV EXPORT
  // ========================================================================

  $("exportCsvBtn")?.addEventListener(
    "click",
    exportCsv
  );


  function exportCsv() {

    if (!allRecords.length) {

      alert(
        "There are no ICS records to export."
      );

      return;
    }


    const headers = [
      "Control No.",
      "ICS No.",
      "Entry No.",
      "Account Code",
      "Article",
      "Item Description",
      "Serial No.",
      "Item / Inventory No.",
      "Unit",
      "Quantity",
      "Unit Cost",
      "Total Value",
      "Date Acquired",
      "PR No.",
      "PR Date",
      "Fund Cluster",
      "Person Accountable",
      "Division / Unit",
      "Status",
      "Remarks"
    ];


    const rows =
      allRecords.map(
        record => {

          const totalValue =
            record.totalValue != null
              ? Number(record.totalValue) || 0
              : (
                  (Number(record.quantity) || 0) *
                  (Number(record.unitCost) || 0)
                );


          return [

            record.controlNo,

            record.icsNo,

            record.entryNo,

            record.accountCode,

            record.article,

            record.itemDescription,

            record.serialNo,

            record.itemNo,

            record.unit,

            record.quantity,

            record.unitCost,

            totalValue,

            record.dateAcquired,

            record.prNo,

            record.prDate,

            record.fundCluster,

            record.accountablePerson,

            record.division,

            record.status ||
              "Active",

            record.remarks
          ];
        }
      );


    const csvContent =
      [
        headers,
        ...rows
      ]
      .map(
        row =>
          row
            .map(
              value =>
                `"${String(
                  value ?? ""
                )
                .replaceAll(
                  '"',
                  '""'
                )}"`
            )
            .join(",")
      )
      .join("\n");


    const blob =
      new Blob(
        [csvContent],
        {
          type:
            "text/csv;charset=utf-8;"
        }
      );


    const url =
      URL.createObjectURL(
        blob
      );


    const link =
      document.createElement(
        "a"
      );


    link.href =
      url;

    link.download =
      `PGENRO_ICS_Records_${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;


    document.body.appendChild(
      link
    );

    link.click();

    link.remove();

    URL.revokeObjectURL(
      url
    );


    showToast(
      "CSV export generated.",
      "success"
    );
  }


  // ========================================================================
  // PRINT ICS RECORD
  // ========================================================================

  function printRecord(
    record
  ) {

    const quantity =
      Number(
        record.quantity || 0
      );


    const unitCost =
      Number(
        record.unitCost || 0
      );


    const totalValue =
      record.totalValue != null
        ? Number(record.totalValue) || 0
        : (
            quantity *
            unitCost
          );


    const printWindow =
      window.open(
        "",
        "_blank",
        "width=1200,height=900"
      );


    if (!printWindow) {

      alert(
        "Please allow pop-ups in your browser to print the ICS record."
      );

      return;
    }


    const printHtml =
`
<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<title>
Inventory Custodian Slip -
${escapeHtml(
  record.icsNo ||
  record.controlNo ||
  ""
)}
</title>


<style>

@page{
  size:A4 landscape;
  margin:12mm;
}


*{
  box-sizing:border-box;
}


body{
  margin:0;
  font-family:Arial,Helvetica,sans-serif;
  color:#111;
}


.sheet{
  border:1px solid #000;
  padding:16px;
}


.appendix{
  text-align:right;
  font-size:11px;
  font-weight:700;
}


.header{
  text-align:center;
}


.header h1{
  margin:3px 0;
  font-size:22px;
}


.agency{
  font-weight:700;
  font-size:13px;
}


.sub{
  font-size:10px;
}


.meta{
  display:grid;
  grid-template-columns:1fr 1fr;
  margin-top:14px;
  border-left:1px solid #000;
  border-top:1px solid #000;
}


.meta-item{
  padding:7px;
  border-right:1px solid #000;
  border-bottom:1px solid #000;
  font-size:10px;
}


table{
  width:100%;
  border-collapse:collapse;
  margin-top:14px;
}


th,
td{
  border:1px solid #000;
  padding:7px;
  font-size:10px;
  vertical-align:top;
}


th{
  background:#efefef;
  text-align:center;
}


.center{
  text-align:center;
}


.remarks{
  margin-top:10px;
  font-size:10px;
}


.accountable{
  margin-top:10px;
  font-size:11px;
}


.signatures{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:70px;
  margin-top:42px;
}


.signature-line{
  border-bottom:1px solid #000;
  height:28px;
}


.signature-name{
  margin-top:5px;
  text-align:center;
  font-weight:700;
  font-size:11px;
}


.signature-note{
  text-align:center;
  font-size:9px;
}


.small{
  font-size:9px;
}

</style>

</head>


<body>


<div class="sheet">


<div class="appendix">
Appendix 59
</div>


<div class="header">

<h1>
INVENTORY CUSTODIAN SLIP
</h1>


<div class="agency">
PROVINCIAL GOVERNMENT ENVIRONMENT &amp;
NATURAL RESOURCES OFFICE (PGENRO)
</div>


<div class="sub">
Republic of the Philippines
</div>

</div>


<div class="meta">

<div class="meta-item">
<strong>Control No.:</strong>
${escapeHtml(
  record.controlNo ||
  "---"
)}
</div>


<div class="meta-item">
<strong>ICS No.:</strong>
${escapeHtml(
  record.icsNo ||
  "---"
)}
</div>


<div class="meta-item">
<strong>Account Code:</strong>
${escapeHtml(
  record.accountCode ||
  "---"
)}
</div>


<div class="meta-item">
<strong>Entry No.:</strong>
${escapeHtml(
  record.entryNo ||
  "---"
)}
</div>


<div class="meta-item">
<strong>Fund Cluster:</strong>
${escapeHtml(
  record.fundCluster ||
  "General Fund (01)"
)}
</div>


<div class="meta-item">
<strong>Status:</strong>
${escapeHtml(
  record.status ||
  "Active"
)}
</div>

</div>


<table>

<thead>

<tr>

<th>Quantity</th>

<th>Unit</th>

<th>Unit Cost</th>

<th>Total Value</th>

<th>Article / Description / Serial Number</th>

<th>Item / Inventory No.</th>

<th>Date Acquired</th>

</tr>

</thead>


<tbody>

<tr>

<td class="center">
${escapeHtml(
  formatNumber(
    quantity
  )
)}
</td>


<td class="center">
${escapeHtml(
  record.unit ||
  "unit"
)}
</td>


<td>
${formatMoney(
  unitCost
)}
</td>


<td>
${formatMoney(
  totalValue
)}
</td>


<td>

<strong>
${escapeHtml(
  record.article ||
  "Article"
)}
</strong>

<br>

${escapeHtml(
  record.itemDescription ||
  "Description"
)}

<br>

<span class="small">
Serial No.:
${escapeHtml(
  record.serialNo ||
  "---"
)}
</span>

</td>


<td>
${escapeHtml(
  record.itemNo ||
  "---"
)}
</td>


<td>
${escapeHtml(
  formatDate(
    record.dateAcquired
  )
)}
</td>

</tr>

</tbody>

</table>


<div class="accountable">

<strong>
Person Accountable:
</strong>

${escapeHtml(
  record.accountablePerson ||
  "---"
)}


&nbsp;&nbsp;&nbsp;


<strong>
Division / Unit:
</strong>

${escapeHtml(
  record.division ||
  "---"
)}

</div>


<div class="remarks">

<strong>
Remarks:
</strong>

${escapeHtml(
  record.remarks ||
  "None"
)}

</div>


<div class="signatures">


<div>

<div>
Received from:
</div>

<div class="signature-line"></div>

<div class="signature-name">
PGENRO PROPERTY CUSTODIAN
</div>

<div class="signature-note">
Supply &amp; Property Management Unit
</div>

</div>


<div>

<div>
Received by:
</div>

<div class="signature-line"></div>

<div class="signature-name">
${escapeHtml(
  record.accountablePerson ||
  "ACCOUNTABLE OFFICER"
)}
</div>

<div class="signature-note">
Signature over Printed Name
</div>

</div>


</div>


</div>


<script>

window.onload = function(){

  window.print();

};

<\/script>


</body>

</html>
`;


    printWindow.document.open();

    printWindow.document.write(
      printHtml
    );

    printWindow.document.close();
  }


  // ========================================================================
  // TOAST
  // ========================================================================

  function showToast(
    message,
    type = "info"
  ) {

    let container =
      document.getElementById(
        "icsToastContainer"
      );


    if (!container) {

      container =
        document.createElement(
          "div"
        );

      container.id =
        "icsToastContainer";


      container.style.position =
        "fixed";

      container.style.right =
        "22px";

      container.style.bottom =
        "22px";

      container.style.zIndex =
        "99999";

      container.style.display =
        "flex";

      container.style.flexDirection =
        "column";

      container.style.gap =
        "8px";


      document.body.appendChild(
        container
      );
    }


    const toast =
      document.createElement(
        "div"
      );


    toast.textContent =
      message;


    toast.style.padding =
      "12px 16px";

    toast.style.borderRadius =
      "10px";

    toast.style.background =
      type === "success"
        ? "#047857"
        : "#334155";

    toast.style.color =
      "#ffffff";

    toast.style.fontSize =
      "12px";

    toast.style.fontWeight =
      "700";

    toast.style.boxShadow =
      "0 10px 30px rgba(15,23,42,.20)";


    container.appendChild(
      toast
    );


    setTimeout(
      () => {

        toast.style.opacity =
          "0";

        toast.style.transform =
          "translateY(8px)";

        toast.style.transition =
          "all .25s ease";


        setTimeout(
          () => {
            toast.remove();
          },
          250
        );

      },
      2600
    );
  }


  // ========================================================================
  // MODAL BACKDROP CLOSE
  // ========================================================================

  [editorModal, viewModal]
    .filter(Boolean)
    .forEach(
      (modal) => {

        modal.addEventListener(
          "click",
          (event) => {

            if (
              event.target ===
              modal
            ) {

              modal.classList.remove(
                "open"
              );
            }
          }
        );
      }
    );


  // ========================================================================
  // ESCAPE TO CLOSE MODALS
  // ========================================================================

  document.addEventListener(
    "keydown",
    (event) => {

      if (event.key !== "Escape") {
        return;
      }


      editorModal?.classList.remove(
        "open"
      );

      viewModal?.classList.remove(
        "open"
      );
    }
  );


  // ========================================================================
  // INITIAL LOAD
  // ========================================================================

  updateTotalPreview();

  attachFirestoreListener();

});