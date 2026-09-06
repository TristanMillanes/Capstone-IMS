/**
 * =========================================================================
 * PGENRO IMS - INVENTORY CUSTODIAN SLIP (ICS) VIEWER CONTROLLER
 * =========================================================================
 * Strictly view-only mode:
 * - Reads real records from Firestore collection "ics_records" (with fallback)
 * - Live keyword searching and Category/Article filtering
 * - Detailed property inspection modal
 * - Official COA Appendix 59 Slip generation and printing
 * =========================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  // =========================================================================
  // 1. FIREBASE CONFIGURATION (VIEWER SYNC)
  // =========================================================================
  const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_FIREBASE_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_FIREBASE_PROJECT_ID",
    storageBucket: "YOUR_FIREBASE_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
    appId: "YOUR_FIREBASE_APP_ID"
  };

  let db = null;
  let firebaseOnline = false;

  try {
    if (typeof firebase !== "undefined") {
      if (firebase.apps.length === 0) {
        firebase.initializeApp(firebaseConfig);
      }
      db = firebase.firestore();
      firebaseOnline = true;
      updateDbStatus(true, "Firebase Sync Active");
    }
  } catch (err) {
    console.warn("Using offline fallback mode for ICS Viewer:", err);
    updateDbStatus(false, "Local Database Mode");
  }

  function updateDbStatus(online, msg) {
    const dot = document.getElementById("dbStatusDot");
    const text = document.getElementById("dbStatusText");
    if (dot) dot.className = online ? "status-dot online" : "status-dot offline";
    if (text) text.textContent = msg;
  }

  // =========================================================================
  // 2. STATE REPOSITORY
  // =========================================================================
  let icsRecords = [];
  let currentModalRecord = null;

  // DOM Elements
  const slipTableBody = document.getElementById("slipTableBody");
  const tableSearchInput = document.getElementById("tableSearchInput");
  const filterArticleSelect = document.getElementById("filterArticleSelect");
  const recordsCounterText = document.getElementById("recordsCounterText");

  // KPI Elements
  const statTotalSlips = document.getElementById("statTotalSlips");
  const statIssuedItems = document.getElementById("statIssuedItems");
  const statTotalValue = document.getElementById("statTotalValue");
  const statLatestControl = document.getElementById("statLatestControl");

  // Inspection Modal Elements
  const viewDetailsModal = document.getElementById("viewDetailsModal");
  const closeDetailsModalBtn = document.getElementById("closeDetailsModalBtn");
  const modalCloseBtn = document.getElementById("modalCloseBtn");
  const modalPrintSlipBtn = document.getElementById("modalPrintSlipBtn");

  const modalControlNoTitle = document.getElementById("modalControlNoTitle");
  const modalArticleBadge = document.getElementById("modalArticleBadge");
  const modalAccountCode = document.getElementById("modalAccountCode");
  const modalDescription = document.getElementById("modalDescription");
  const modalSerialNo = document.getElementById("modalSerialNo");
  const modalIcsNo = document.getElementById("modalIcsNo");
  const modalEntryNo = document.getElementById("modalEntryNo");
  const modalQty = document.getElementById("modalQty");
  const modalUnit = document.getElementById("modalUnit");
  const modalUnitVal = document.getElementById("modalUnitVal");
  const modalTotalVal = document.getElementById("modalTotalVal");
  const modalDateAcquired = document.getElementById("modalDateAcquired");
  const modalPrNo = document.getElementById("modalPrNo");
  const modalPrDate = document.getElementById("modalPrDate");
  const modalAccountable = document.getElementById("modalAccountable");
  const modalRemarks = document.getElementById("modalRemarks");

  // Print Sheet Modal Elements
  const printSheetModal = document.getElementById("printSheetModal");
  const closePrintSheetBtn = document.getElementById("closePrintSheetBtn");
  const dismissPrintBtn = document.getElementById("dismissPrintBtn");
  const printRegistryBtn = document.getElementById("printRegistryBtn");

  const printIcsNo = document.getElementById("printIcsNo");
  const printControlNo = document.getElementById("printControlNo");
  const printQty = document.getElementById("printQty");
  const printUnit = document.getElementById("printUnit");
  const printUnitVal = document.getElementById("printUnitVal");
  const printTotalVal = document.getElementById("printTotalVal");
  const printArticle = document.getElementById("printArticle");
  const printDesc = document.getElementById("printDesc");
  const printSerial = document.getElementById("printSerial");
  const printItemNo = document.getElementById("printItemNo");
  const printDateIssued = document.getElementById("printDateIssued");
  const printAccountablePerson = document.getElementById("printAccountablePerson");
  const printDateReceived = document.getElementById("printDateReceived");

  // Sidebar Controls
  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const mainContent = document.getElementById("mainContent");

  if (hamburgerMenu && sidebar && overlay && mainContent) {
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
  }

  if (printRegistryBtn) {
    printRegistryBtn.addEventListener("click", () => window.print());
  }

  // =========================================================================
  // 3. DATA LOADING (REALTIME OR LOCAL REPOSITORY)
  // =========================================================================
  function loadData() {
    if (firebaseOnline && db) {
      db.collection("ics_records")
        .orderBy("controlNumber", "desc")
        .onSnapshot(
          (snapshot) => {
            icsRecords = [];
            snapshot.forEach((doc) => {
              icsRecords.push({ id: doc.id, ...doc.data() });
            });
            populateArticleDropdown();
            renderTable();
            updateKpis();
          },
          (err) => {
            console.error("Firestore read error, using local fallback:", err);
            loadLocalRecords();
          }
        );
    } else {
      loadLocalRecords();
    }
  }

  function loadLocalRecords() {
    const local = localStorage.getItem("pgenro_ics_records") || localStorage.getItem("icsRecords");
    if (local) {
      icsRecords = JSON.parse(local);
    } else {
      // Seed data accurately reflecting the desktop application screen capture
      icsRecords = [
        {
          id: "410",
          controlNumber: "410",
          accountCode: "1-04-05-020",
          article: "IT Equipment",
          description: "LAPTOP RAM 8GB DDR5 MEMORY,STORAGE 512 GB,DISPLAY SIZE 14' FULL HD IPS,ACER ASPHIRE LITE 14",
          serialNumber: "NXD9ZSP00152200IC76LO1",
          entryNumber: "001",
          icsNo: "ICS-2026-0410",
          quantity: 1,
          unit: "unit",
          unitValue: 34500.00,
          totalValue: 34500.00,
          dateAcquired: "2026-01-15",
          prNo: "PR-2026-092",
          prDate: "2026-01-08",
          accountable: "Management Information Unit / PGENRO Admin",
          remarks: "In service / Brand new issued"
        },
        {
          id: "409",
          controlNumber: "409",
          accountCode: "1-04-04-010",
          article: "Bamboo Propagules",
          description: "SEEDLING KAWAYAN TINIK 2FT",
          serialNumber: "N/A",
          entryNumber: "002",
          icsNo: "ICS-2026-0409",
          quantity: 150,
          unit: "pcs",
          unitValue: 85.00,
          totalValue: 12750.00,
          dateAcquired: "2026-02-01",
          prNo: "PR-2026-104",
          prDate: "2026-01-20",
          accountable: "Forestry & Watershed Division Nursery",
          remarks: "Planted along riverbank reserve"
        },
        {
          id: "408",
          controlNumber: "408",
          accountCode: "1-04-04-010",
          article: "Mangrove Propagules",
          description: "SEEDLING AVECENNIA 1FT",
          serialNumber: "N/A",
          entryNumber: "003",
          icsNo: "ICS-2026-0408",
          quantity: 200,
          unit: "pcs",
          unitValue: 60.00,
          totalValue: 12000.00,
          dateAcquired: "2026-02-04",
          prNo: "PR-2026-112",
          prDate: "2026-01-22",
          accountable: "Coastal Resource Section / Calatagan Reserve",
          remarks: "Mangrove Rehabilitation Project"
        },
        {
          id: "407",
          controlNumber: "407",
          accountCode: "1-04-04-010",
          article: "Fruit Bearing Trees",
          description: "SEEDLING GUYABANO 2FT",
          serialNumber: "N/A",
          entryNumber: "004",
          icsNo: "ICS-2026-0407",
          quantity: 100,
          unit: "pcs",
          unitValue: 75.00,
          totalValue: 7500.00,
          dateAcquired: "2026-02-10",
          prNo: "PR-2026-115",
          prDate: "2026-01-25",
          accountable: "Community Agroforestry Unit",
          remarks: "Distributed to local farmers"
        },
        {
          id: "406",
          controlNumber: "406",
          accountCode: "1-04-04-010",
          article: "Fruit Bearing Trees",
          description: "SEEDLING RAMBUTAN 2FT",
          serialNumber: "N/A",
          entryNumber: "005",
          icsNo: "ICS-2026-0406",
          quantity: 100,
          unit: "pcs",
          unitValue: 90.00,
          totalValue: 9000.00,
          dateAcquired: "2026-02-12",
          prNo: "PR-2026-118",
          prDate: "2026-01-28",
          accountable: "Central Nursery Custodian",
          remarks: "Acclimatized stock"
        },
        {
          id: "405",
          controlNumber: "405",
          accountCode: "1-04-04-010",
          article: "Indigenous Trees",
          description: "SEEDLING PATALSIK PULA 2FT",
          serialNumber: "N/A",
          entryNumber: "006",
          icsNo: "ICS-2026-0405",
          quantity: 80,
          unit: "pcs",
          unitValue: 120.00,
          totalValue: 9600.00,
          dateAcquired: "2026-02-15",
          prNo: "PR-2026-120",
          prDate: "2026-02-01",
          accountable: "Reforestation Project Officer",
          remarks: "Watershed enrichment"
        },
        {
          id: "404",
          controlNumber: "404",
          accountCode: "1-04-04-010",
          article: "Ornamental & Native",
          description: "SEEDLING YLANG YLANG 2FT",
          serialNumber: "N/A",
          entryNumber: "007",
          icsNo: "ICS-2026-0404",
          quantity: 50,
          unit: "pcs",
          unitValue: 110.00,
          totalValue: 5500.00,
          dateAcquired: "2026-02-18",
          prNo: "PR-2026-124",
          prDate: "2026-02-05",
          accountable: "Urban Greening Lead",
          remarks: "Capitol perimeter landscaping"
        },
        {
          id: "403",
          controlNumber: "403",
          accountCode: "1-04-04-010",
          article: "Indigenous Trees",
          description: "SEEDLING BANABA 2FT",
          serialNumber: "N/A",
          entryNumber: "008",
          icsNo: "ICS-2026-0403",
          quantity: 120,
          unit: "pcs",
          unitValue: 80.00,
          totalValue: 9600.00,
          dateAcquired: "2026-02-20",
          prNo: "PR-2026-128",
          prDate: "2026-02-08",
          accountable: "Protected Area Unit Custodian",
          remarks: "Watershed reserve"
        }
      ];
    }
    populateArticleDropdown();
    renderTable();
    updateKpis();
  }

  // =========================================================================
  // 4. ARTICLE DROPDOWN GENERATOR
  // =========================================================================
  function populateArticleDropdown() {
    if (!filterArticleSelect) return;
    const currentVal = filterArticleSelect.value;
    const articles = Array.from(new Set(icsRecords.map((r) => r.article).filter(Boolean)));

    filterArticleSelect.innerHTML = `<option value="ALL">All Articles / Categories</option>`;
    articles.sort().forEach((art) => {
      const opt = document.createElement("option");
      opt.value = art;
      opt.textContent = art;
      filterArticleSelect.appendChild(opt);
    });

    if (articles.includes(currentVal)) {
      filterArticleSelect.value = currentVal;
    }
  }

  // =========================================================================
  // 5. TABLE RENDERING (VIEW-ONLY)
  // =========================================================================
  function renderTable() {
    if (!slipTableBody) return;

    const term = (tableSearchInput?.value || "").toLowerCase().trim();
    const articleFilter = filterArticleSelect?.value || "ALL";

    const filtered = icsRecords.filter((item) => {
      const matchSearch =
        !term ||
        (item.controlNumber || "").toLowerCase().includes(term) ||
        (item.accountCode || "").toLowerCase().includes(term) ||
        (item.article || "").toLowerCase().includes(term) ||
        (item.description || "").toLowerCase().includes(term) ||
        (item.serialNumber || "").toLowerCase().includes(term) ||
        (item.icsNo || "").toLowerCase().includes(term) ||
        (item.accountable || "").toLowerCase().includes(term);

      const matchArticle = articleFilter === "ALL" || item.article === articleFilter;
      return matchSearch && matchArticle;
    });

    if (recordsCounterText) {
      recordsCounterText.textContent = `Showing ${filtered.length} of ${icsRecords.length} custodian records`;
    }

    if (filtered.length === 0) {
      slipTableBody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-table-cell">No matching inventory custodian records found.</td>
        </tr>
      `;
      return;
    }

    slipTableBody.innerHTML = filtered.map((item) => {
      const formattedTotal = Number(item.totalValue || 0).toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

      return `
        <tr data-id="${item.id || item.controlNumber}">
          <td><strong class="font-mono" style="color: var(--primary-dark);">${escapeHtml(item.controlNumber || "—")}</strong></td>
          <td class="font-mono text-muted">${escapeHtml(item.accountCode || "—")}</td>
          <td><span style="font-weight: 700; color: var(--slate-700);">${escapeHtml(item.article || "—")}</span></td>
          <td>
            <div style="font-weight: 600; color: var(--slate-900);">${escapeHtml(item.description || "—")}</div>
            ${item.icsNo ? `<small class="font-mono" style="color: var(--primary);">Ref: ${escapeHtml(item.icsNo)}</small>` : ""}
          </td>
          <td class="font-mono" style="font-size: 11px;">${escapeHtml(item.serialNumber || "N/A")}</td>
          <td style="text-align: center; font-weight: 700;">${item.quantity || 0} <small>${escapeHtml(item.unit || "unit")}</small></td>
          <td style="text-align: right; font-weight: 700; color: var(--primary-dark);">₱${formattedTotal}</td>
          <td>
            <div style="font-weight: 600; color: var(--slate-800);">${escapeHtml(item.accountable || "—")}</div>
          </td>
          <td style="text-align: center;">
            <button type="button" class="btn-icon-view view-detail-btn" data-id="${item.id || item.controlNumber}" title="View Complete Specification">
              <i data-lucide="eye"></i>
            </button>
          </td>
        </tr>
      `;
    }).join("");

    // Clicking anywhere on a table row opens details
    slipTableBody.querySelectorAll("tr").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.getAttribute("data-id");
        if (id) openDetailModal(id);
      });
    });

    if (window.lucide) lucide.createIcons();
  }

  // =========================================================================
  // 6. DETAIL INSPECTION MODAL
  // =========================================================================
  function openDetailModal(id) {
    const item = icsRecords.find((r) => String(r.id) === String(id) || String(r.controlNumber) === String(id));
    if (!item) return;

    currentModalRecord = item;

    modalControlNoTitle.textContent = `Control No. ${item.controlNumber || "---"}`;
    modalArticleBadge.textContent = item.article || "Article";
    modalAccountCode.textContent = `Acct Code: ${item.accountCode || "N/A"}`;
    modalDescription.textContent = item.description || "No description provided.";
    modalSerialNo.textContent = item.serialNumber || "N/A";
    modalIcsNo.textContent = item.icsNo || "N/A";
    modalEntryNo.textContent = item.entryNumber || "N/A";

    modalQty.textContent = item.quantity || 0;
    modalUnit.textContent = item.unit || "unit";
    modalUnitVal.textContent = "₱" + Number(item.unitValue || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });
    modalTotalVal.textContent = "₱" + Number(item.totalValue || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });

    modalDateAcquired.textContent = item.dateAcquired || "N/A";
    modalPrNo.textContent = item.prNo || "N/A";
    modalPrDate.textContent = item.prDate || "N/A";

    modalAccountable.textContent = item.accountable || "Unassigned";
    modalRemarks.textContent = item.remarks || "No historical remarks noted.";

    viewDetailsModal.classList.add("open");
    if (window.lucide) lucide.createIcons();
  }

  function closeDetailModal() {
    viewDetailsModal.classList.remove("open");
  }

  if (closeDetailsModalBtn) closeDetailsModalBtn.addEventListener("click", closeDetailModal);
  if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeDetailModal);

  // =========================================================================
  // 7. PRINT OFFICIAL COA APPENDIX 59 SLIP
  // =========================================================================
  function openPrintSheet(item) {
    if (!item) return;

    printIcsNo.textContent = item.icsNo || "ICS-2026-N/A";
    printControlNo.textContent = item.controlNumber || "---";
    printQty.textContent = item.quantity || 1;
    printUnit.textContent = item.unit || "unit";
    printUnitVal.textContent = "₱" + Number(item.unitValue || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });
    printTotalVal.textContent = "₱" + Number(item.totalValue || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 });
    printArticle.textContent = item.article || "Article";
    printDesc.textContent = item.description || "Item specifications";
    printSerial.textContent = "SN: " + (item.serialNumber || "N/A");
    printItemNo.textContent = item.accountCode || item.controlNumber;
    printDateIssued.textContent = item.dateAcquired || new Date().toISOString().slice(0, 10);
    printAccountablePerson.textContent = (item.accountable || "END-USER CUSTODIAN").toUpperCase();
    printDateReceived.textContent = item.dateAcquired || new Date().toISOString().slice(0, 10);

    printSheetModal.classList.add("open");
  }

  if (modalPrintSlipBtn) {
    modalPrintSlipBtn.addEventListener("click", () => {
      closeDetailModal();
      openPrintSheet(currentModalRecord);
    });
  }

  if (closePrintSheetBtn) closePrintSheetBtn.addEventListener("click", () => printSheetModal.classList.remove("open"));
  if (dismissPrintBtn) dismissPrintBtn.addEventListener("click", () => printSheetModal.classList.remove("open"));

  // =========================================================================
  // 8. SEARCH & FILTER EVENTS
  // =========================================================================
  if (tableSearchInput) tableSearchInput.addEventListener("input", renderTable);
  if (filterArticleSelect) filterArticleSelect.addEventListener("change", renderTable);

  // =========================================================================
  // 9. KPI SUMMARY CALCULATIONS
  // =========================================================================
  function updateKpis() {
    const totalSlips = icsRecords.length;
    const totalQty = icsRecords.reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
    const totalVal = icsRecords.reduce((sum, r) => sum + (parseFloat(r.totalValue) || 0), 0);

    if (statTotalSlips) statTotalSlips.textContent = totalSlips.toLocaleString();
    if (statIssuedItems) statIssuedItems.textContent = totalQty.toLocaleString();
    if (statTotalValue) {
      statTotalValue.textContent = "₱" + totalVal.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    if (statLatestControl) {
      if (icsRecords.length > 0) {
        const nums = icsRecords.map((r) => parseInt(r.controlNumber, 10)).filter((n) => !isNaN(n));
        statLatestControl.textContent = nums.length > 0 ? String(Math.max(...nums)) : "---";
      } else {
        statLatestControl.textContent = "---";
      }
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initial Load
  loadData();
});