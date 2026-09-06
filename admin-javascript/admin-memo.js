/**
 * =========================================================================
 * PGENRO IMS - OFFICE MEMORANDUM ADMINISTRATION CONTROLLER
 * =========================================================================
 * Collection target: "office_memos"
 * Schema:
 * {
 *    memoNo: string,            // Control No. (e.g., "MEMO-2026-001")
 *    date: string,              // YYYY-MM-DD
 *    addressedTo: string,       // Target recipient / Division
 *    subject: string,           // Directive Subject Matter
 *    title: string,             // Synchronized alias for subject
 *    issuedBy: string,          // Signatory / Division
 *    remarks: string,           // Action notes / remarks
 *    isPinned: boolean,         // Pinned directive status
 *    pdfUrl: string,            // Base64 Data URI or remote Cloud Storage URL
 *    pdfFileName: string,       // Scanned document filename
 *    createdAt: timestamp       // Creation timestamp
 * }
 * =========================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  // =========================================================================
  // 1. FIREBASE CONFIGURATION & INITIALIZATION
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
  let firebaseInitialized = false;

  try {
    if (typeof firebase !== "undefined") {
      if (firebase.apps.length === 0) {
        firebase.initializeApp(firebaseConfig);
      }
      db = firebase.firestore();
      firebaseInitialized = true;
      updateDbStatusUI(true, "Firebase Connected (office_memos)");
    }
  } catch (err) {
    console.warn("Operating with local storage fallback mode:", err);
    updateDbStatusUI(false, "Local Storage Mode");
  }

  function updateDbStatusUI(isOnline, msg) {
    const dot = document.getElementById("dbStatusDot");
    const text = document.getElementById("dbStatusText");
    if (dot) dot.className = isOnline ? "status-dot online" : "status-dot offline";
    if (text) text.textContent = msg;
  }

  // =========================================================================
  // 2. STATE MANAGEMENT & DOM ELEMENTS
  // =========================================================================
  let rawMemos = [];
  let filteredMemos = [];
  let deleteTargetId = null;
  let currentPage = 1;
  const rowsPerPage = 8;

  // Table & Filters
  const memoTableBody = document.getElementById("memoAdminTableBody");
  const tableFilterInput = document.getElementById("tableFilterInput");
  const globalSearchInput = document.getElementById("globalSearchInput");
  const pinnedFilterSelect = document.getElementById("pinnedFilterSelect");
  const attachmentFilterSelect = document.getElementById("attachmentFilterSelect");
  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  const paginationInfo = document.getElementById("memoPaginationInfo");
  const paginationBtns = document.getElementById("tablePaginationBtns");
  const printRegistryBtn = document.getElementById("printRegistryBtn");

  // Memo Form Modal
  const memoFormModal = document.getElementById("memoFormModal");
  const memoForm = document.getElementById("memoForm");
  const openCreateModalBtn = document.getElementById("openCreateModalBtn");
  const closeFormModalBtn = document.getElementById("closeFormModalBtn");
  const cancelFormModalBtn = document.getElementById("cancelFormModalBtn");
  const modalFormTitle = document.getElementById("modalFormTitle");

  // Form Inputs
  const memoDocId = document.getElementById("memoDocId");
  const formControlNo = document.getElementById("formControlNo");
  const formDate = document.getElementById("formDate");
  const formAddressedTo = document.getElementById("formAddressedTo");
  const formSubject = document.getElementById("formSubject");
  const formIssuedBy = document.getElementById("formIssuedBy");
  const formRemarks = document.getElementById("formRemarks");
  const formIsPinned = document.getElementById("formIsPinned");
  const formPdfFile = document.getElementById("formPdfFile");
  const formExistingPdfBase64 = document.getElementById("formExistingPdfBase64");
  const attachedFileInfo = document.getElementById("attachedFileInfo");
  const attachedFileName = document.getElementById("attachedFileName");
  const removeAttachmentBtn = document.getElementById("removeAttachmentBtn");

  // PDF Viewer Modal
  const viewPdfModal = document.getElementById("viewPdfModal");
  const adminPdfFrame = document.getElementById("adminPdfFrame");
  const adminNoPdfState = document.getElementById("adminNoPdfState");
  const viewPdfTitle = document.getElementById("viewPdfTitle");
  const viewPdfSubtitle = document.getElementById("viewPdfSubtitle");
  const downloadPdfBtn = document.getElementById("downloadPdfBtn");
  const closeViewPdfBtn = document.getElementById("closeViewPdfBtn");
  const dismissViewPdfBtn = document.getElementById("dismissViewPdfBtn");

  // Delete Confirmation Modal
  const deleteConfirmModal = document.getElementById("deleteConfirmModal");
  const deleteMemoNoLabel = document.getElementById("deleteMemoNoLabel");
  const closeDeleteModalBtn = document.getElementById("closeDeleteModalBtn");
  const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
  const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

  // KPI Counters
  const kpiTotalMemos = document.getElementById("kpiTotalMemos");
  const kpiPinnedMemos = document.getElementById("kpiPinnedMemos");
  const kpiThisMonthMemos = document.getElementById("kpiThisMonthMemos");
  const kpiWithAttachments = document.getElementById("kpiWithAttachments");

  // Topbar Profile & Mobile Drawer
  const profileBtn = document.getElementById("profileBtn");
  const profileMenu = document.getElementById("profileMenu");
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const sidebar = document.getElementById("sidebar");
  const exportCsvBtn = document.getElementById("exportCsvBtn");

  if (profileBtn && profileMenu) {
    profileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("open");
    });
  }

  if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      sidebar.classList.toggle("mobile-open");
    });
  }

  document.addEventListener("click", () => {
    if (profileMenu) profileMenu.classList.remove("open");
  });

  if (printRegistryBtn) {
    printRegistryBtn.addEventListener("click", () => window.print());
  }

  // =========================================================================
  // 3. TOAST NOTIFICATIONS
  // =========================================================================
  function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}"></i>
      <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 200);
    }, 3200);
  }

  // =========================================================================
  // 4. DATA SYNCHRONIZATION
  // =========================================================================
  function listenToMemos() {
    if (firebaseInitialized && db) {
      db.collection("office_memos")
        .orderBy("createdAt", "desc")
        .onSnapshot(
          (snapshot) => {
            rawMemos = [];
            snapshot.forEach((doc) => {
              rawMemos.push({ id: doc.id, ...doc.data() });
            });
            applyFiltersAndRender();
            calculateKpis();
          },
          (err) => {
            console.error("Firestore error, switching to localStorage:", err);
            loadLocalMemos();
          }
        );
    } else {
      loadLocalMemos();
    }
  }

  function loadLocalMemos() {
    const local = localStorage.getItem("pgenro_office_memos");
    if (local) {
      rawMemos = JSON.parse(local);
    } else {
      // Seed default baseline memos if empty
      rawMemos = [
        {
          id: "local-1",
          memoNo: "MEMO-2026-001",
          date: new Date().toISOString().slice(0, 10),
          addressedTo: "All Division Chiefs & Unit Heads",
          subject: "Strict Enforcement of Watershed Protection Protocol within Provincial Reserves",
          title: "Strict Enforcement of Watershed Protection Protocol within Provincial Reserves",
          issuedBy: "Office of the Provincial ENR Officer",
          remarks: "For Strict Compliance",
          isPinned: true,
          pdfUrl: "",
          pdfFileName: ""
        }
      ];
      saveLocalMemos();
    }
    applyFiltersAndRender();
    calculateKpis();
  }

  function saveLocalMemos() {
    localStorage.setItem("pgenro_office_memos", JSON.stringify(rawMemos));
  }

  // =========================================================================
  // 5. KPI METRICS
  // =========================================================================
  function calculateKpis() {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let pinnedCount = 0;
    let thisMonthCount = 0;
    let attachmentCount = 0;

    rawMemos.forEach((memo) => {
      if (memo.isPinned) pinnedCount++;
      if (memo.pdfUrl && memo.pdfUrl.trim() !== "") attachmentCount++;

      if (memo.date) {
        const d = new Date(memo.date);
        if (!isNaN(d.getTime()) && d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
          thisMonthCount++;
        }
      }
    });

    if (kpiTotalMemos) kpiTotalMemos.textContent = rawMemos.length.toLocaleString();
    if (kpiPinnedMemos) kpiPinnedMemos.textContent = pinnedCount.toLocaleString();
    if (kpiThisMonthMemos) kpiThisMonthMemos.textContent = thisMonthCount.toLocaleString();
    if (kpiWithAttachments) kpiWithAttachments.textContent = attachmentCount.toLocaleString();
  }

  // =========================================================================
  // 6. FILTERING, SEARCH & PAGINATION
  // =========================================================================
  function applyFiltersAndRender() {
    const term = (tableFilterInput?.value || globalSearchInput?.value || "").toLowerCase().trim();
    const pinnedFilter = pinnedFilterSelect?.value || "all";
    const attachmentFilter = attachmentFilterSelect?.value || "all";

    filteredMemos = rawMemos.filter((memo) => {
      const controlNo = (memo.memoNo || "").toLowerCase();
      const subject = (memo.subject || memo.title || "").toLowerCase();
      const addressedTo = (memo.addressedTo || "").toLowerCase();
      const remarks = (memo.remarks || "").toLowerCase();

      const matchesSearch = !term || controlNo.includes(term) || subject.includes(term) || addressedTo.includes(term) || remarks.includes(term);

      let matchesPinned = true;
      if (pinnedFilter === "pinned") matchesPinned = memo.isPinned === true;
      if (pinnedFilter === "unpinned") matchesPinned = !memo.isPinned;

      let matchesAttachment = true;
      const hasAttachment = Boolean(memo.pdfUrl && memo.pdfUrl.trim() !== "");
      if (attachmentFilter === "with_pdf") matchesAttachment = hasAttachment;
      if (attachmentFilter === "no_pdf") matchesAttachment = !hasAttachment;

      return matchesSearch && matchesPinned && matchesAttachment;
    });

    // Pinned records float to top
    filteredMemos.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));

    currentPage = 1;
    renderTable();
  }

  function renderTable() {
    if (!memoTableBody) return;

    if (filteredMemos.length === 0) {
      memoTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-table-cell">No matching office memorandum records found.</td>
        </tr>
      `;
      if (paginationInfo) paginationInfo.textContent = "Showing 0 to 0 of 0 directives";
      if (paginationBtns) paginationBtns.innerHTML = `<button class="page-btn" disabled>1</button>`;
      return;
    }

    const totalPages = Math.ceil(filteredMemos.length / rowsPerPage);
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const currentMemos = filteredMemos.slice(startIndex, startIndex + rowsPerPage);

    memoTableBody.innerHTML = currentMemos.map((memo) => {
      const hasPdf = Boolean(memo.pdfUrl && memo.pdfUrl.trim() !== "");
      return `
        <tr>
          <td><input type="checkbox" class="row-checkbox" value="${memo.id}" /></td>
          <td>
            <strong style="color: var(--slate-900);">${escapeHtml(memo.memoNo || "UNTITLED")}</strong>
            ${memo.isPinned ? `<span class="badge-pinned"><i data-lucide="pin" style="width:10px;height:10px;"></i> PINNED</span>` : ""}
          </td>
          <td class="text-muted font-mono">${memo.date || "N/A"}</td>
          <td>
            <div class="memo-recipient-cell">${escapeHtml(memo.addressedTo || "—")}</div>
          </td>
          <td>
            <div class="memo-title-cell">${escapeHtml(memo.subject || memo.title || "No subject specified")}</div>
          </td>
          <td>
            <span class="table-tag">${escapeHtml(memo.remarks || "General Directive")}</span>
          </td>
          <td>
            ${
              hasPdf
                ? `<button type="button" class="badge-status success preview-pdf-btn" data-id="${memo.id}" style="cursor: pointer; border: none;">
                    <i data-lucide="file-check" style="width:12px;height:12px;"></i> View PDF
                  </button>`
                : `<span class="badge-status" style="background: var(--slate-100); color: var(--slate-500);"><span class="dot" style="background: var(--slate-400);"></span> None</span>`
            }
          </td>
          <td style="text-align: right;">
            <div class="action-btn-group">
              <button type="button" class="btn-action pin-toggle-btn ${memo.isPinned ? "active" : ""}" data-id="${memo.id}" title="${memo.isPinned ? "Unpin directive" : "Pin to top"}">
                <i data-lucide="pin"></i>
              </button>
              <button type="button" class="btn-action edit-memo-btn" data-id="${memo.id}" title="Edit memorandum">
                <i data-lucide="edit-3"></i>
              </button>
              <button type="button" class="btn-action delete delete-memo-btn" data-id="${memo.id}" data-no="${escapeHtml(memo.memoNo || "")}" title="Delete record">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    if (paginationInfo) {
      const endItem = Math.min(startIndex + rowsPerPage, filteredMemos.length);
      paginationInfo.textContent = `Showing ${startIndex + 1} to ${endItem} of ${filteredMemos.length} directives`;
    }

    renderPaginationControls(totalPages);
    attachRowActions();
    if (window.lucide) lucide.createIcons();
  }

  function renderPaginationControls(totalPages) {
    if (!paginationBtns) return;
    let html = `<button class="page-btn" ${currentPage === 1 ? "disabled" : ""} data-page="${currentPage - 1}">&laquo;</button>`;

    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="page-btn ${i === currentPage ? "active" : ""}" data-page="${i}">${i}</button>`;
    }

    html += `<button class="page-btn" ${currentPage === totalPages ? "disabled" : ""} data-page="${currentPage + 1}">&raquo;</button>`;
    paginationBtns.innerHTML = html;

    paginationBtns.querySelectorAll(".page-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = parseInt(btn.getAttribute("data-page"), 10);
        if (!isNaN(p) && p >= 1 && p <= totalPages) {
          currentPage = p;
          renderTable();
        }
      });
    });
  }

  // =========================================================================
  // 7. ROW ACTIONS
  // =========================================================================
  function attachRowActions() {
    // Preview PDF
    document.querySelectorAll(".preview-pdf-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const memo = rawMemos.find((m) => m.id === id);
        if (memo) openPdfViewer(memo);
      });
    });

    // Pin/Unpin
    document.querySelectorAll(".pin-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const memo = rawMemos.find((m) => m.id === id);
        if (!memo) return;

        const newPinnedState = !memo.isPinned;
        if (firebaseInitialized && db) {
          await db.collection("office_memos").doc(id).update({ isPinned: newPinnedState });
        } else {
          memo.isPinned = newPinnedState;
          saveLocalMemos();
          applyFiltersAndRender();
          calculateKpis();
        }
        showToast(`Directive ${memo.memoNo || ""} ${newPinnedState ? "pinned to top" : "unpinned"}.`);
      });
    });

    // Edit
    document.querySelectorAll(".edit-memo-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const memo = rawMemos.find((m) => m.id === id);
        if (memo) openEditModal(memo);
      });
    });

    // Delete
    document.querySelectorAll(".delete-memo-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        deleteTargetId = btn.getAttribute("data-id");
        const memoNo = btn.getAttribute("data-no") || "this record";
        if (deleteMemoNoLabel) deleteMemoNoLabel.textContent = memoNo;
        if (deleteConfirmModal) deleteConfirmModal.classList.add("open");
      });
    });
  }

  // =========================================================================
  // 8. FORM & MODAL CONTROLS
  // =========================================================================
  function resetForm() {
    memoForm.reset();
    memoDocId.value = "";
    formExistingPdfBase64.value = "";
    attachedFileInfo.classList.remove("show");
    attachedFileName.textContent = "";
    modalFormTitle.textContent = "Issue Office Memorandum";
    formDate.value = new Date().toISOString().slice(0, 10);
  }

  if (openCreateModalBtn) {
    openCreateModalBtn.addEventListener("click", () => {
      resetForm();
      memoFormModal.classList.add("open");
    });
  }

  if (closeFormModalBtn) closeFormModalBtn.addEventListener("click", () => memoFormModal.classList.remove("open"));
  if (cancelFormModalBtn) cancelFormModalBtn.addEventListener("click", () => memoFormModal.classList.remove("open"));

  function openEditModal(memo) {
    resetForm();
    modalFormTitle.textContent = "Update Office Memorandum";
    memoDocId.value = memo.id;
    formControlNo.value = memo.memoNo || "";
    formDate.value = memo.date || "";
    formAddressedTo.value = memo.addressedTo || "";
    formSubject.value = memo.subject || memo.title || "";
    formIssuedBy.value = memo.issuedBy || "";
    formRemarks.value = memo.remarks || "";
    formIsPinned.checked = Boolean(memo.isPinned);

    if (memo.pdfUrl) {
      formExistingPdfBase64.value = memo.pdfUrl;
      attachedFileName.textContent = memo.pdfFileName || "Attached_Document.pdf";
      attachedFileInfo.classList.add("show");
    }

    memoFormModal.classList.add("open");
  }

  // PDF File Input
  if (formPdfFile) {
    formPdfFile.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.type !== "application/pdf") {
        alert("Please select an official PDF document.");
        formPdfFile.value = "";
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        alert("The PDF file exceeds the 10MB limit.");
        formPdfFile.value = "";
        return;
      }

      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        formExistingPdfBase64.value = loadEvt.target.result;
        attachedFileName.textContent = file.name;
        attachedFileInfo.classList.add("show");
      };
      reader.readAsDataURL(file);
    });
  }

  if (removeAttachmentBtn) {
    removeAttachmentBtn.addEventListener("click", () => {
      formPdfFile.value = "";
      formExistingPdfBase64.value = "";
      attachedFileInfo.classList.remove("show");
      attachedFileName.textContent = "";
    });
  }

  // Submit Handler
  if (memoForm) {
    memoForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const docId = memoDocId.value.trim();
      const payload = {
        memoNo: formControlNo.value.trim(),
        date: formDate.value,
        addressedTo: formAddressedTo.value.trim(),
        subject: formSubject.value.trim(),
        title: formSubject.value.trim(),
        issuedBy: formIssuedBy.value.trim() || "PGENRO Management",
        remarks: formRemarks.value.trim() || "For Strict Compliance",
        isPinned: formIsPinned.checked,
        pdfUrl: formExistingPdfBase64.value || "",
        pdfFileName: attachedFileName.textContent || "",
        updatedAt: new Date()
      };

      try {
        if (firebaseInitialized && db) {
          if (docId) {
            await db.collection("office_memos").doc(docId).update(payload);
            showToast("Memorandum updated successfully.");
          } else {
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection("office_memos").add(payload);
            showToast("Memorandum issued successfully.");
          }
        } else {
          // Local storage fallback
          if (docId) {
            const idx = rawMemos.findIndex((m) => m.id === docId);
            if (idx !== -1) rawMemos[idx] = { ...rawMemos[idx], ...payload };
            showToast("Memorandum updated in local records.");
          } else {
            rawMemos.unshift({
              id: "local-" + Date.now(),
              ...payload,
              createdAt: new Date()
            });
            showToast("Memorandum recorded locally.");
          }
          saveLocalMemos();
          applyFiltersAndRender();
          calculateKpis();
        }

        memoFormModal.classList.remove("open");
      } catch (error) {
        console.error("Save error:", error);
        alert("Failed to save directive: " + error.message);
      }
    });
  }

  // =========================================================================
  // 9. DELETE MODAL HANDLER
  // =========================================================================
  if (closeDeleteModalBtn) closeDeleteModalBtn.addEventListener("click", () => deleteConfirmModal.classList.remove("open"));
  if (cancelDeleteBtn) cancelDeleteBtn.addEventListener("click", () => deleteConfirmModal.classList.remove("open"));

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener("click", async () => {
      if (!deleteTargetId) return;

      try {
        if (firebaseInitialized && db) {
          await db.collection("office_memos").doc(deleteTargetId).delete();
        } else {
          rawMemos = rawMemos.filter((m) => m.id !== deleteTargetId);
          saveLocalMemos();
          applyFiltersAndRender();
          calculateKpis();
        }
        showToast("Memorandum deleted permanently.");
      } catch (err) {
        console.error("Delete error:", err);
        showToast("Error deleting directive.", "error");
      } finally {
        deleteTargetId = null;
        deleteConfirmModal.classList.remove("open");
      }
    });
  }

  // =========================================================================
  // 10. PDF PREVIEW MODAL
  // =========================================================================
  function openPdfViewer(memo) {
    if (viewPdfTitle) viewPdfTitle.textContent = memo.memoNo ? `Directive ${memo.memoNo}` : "Directive Viewer";
    if (viewPdfSubtitle) viewPdfSubtitle.textContent = memo.subject || memo.title || "Office Directive";

    if (memo.pdfUrl && memo.pdfUrl.trim() !== "") {
      adminPdfFrame.src = memo.pdfUrl;
      adminPdfFrame.style.display = "block";
      adminNoPdfState.classList.add("hidden");
      downloadPdfBtn.href = memo.pdfUrl;
      downloadPdfBtn.style.display = "inline-flex";
    } else {
      adminPdfFrame.src = "";
      adminPdfFrame.style.display = "none";
      adminNoPdfState.classList.remove("hidden");
      downloadPdfBtn.style.display = "none";
    }

    viewPdfModal.classList.add("open");
  }

  if (closeViewPdfBtn) closeViewPdfBtn.addEventListener("click", () => viewPdfModal.classList.remove("open"));
  if (dismissViewPdfBtn) dismissViewPdfBtn.addEventListener("click", () => viewPdfModal.classList.remove("open"));

  // =========================================================================
  // 11. SEARCH, SHORTCUTS & SELECT ALL
  // =========================================================================
  if (tableFilterInput) tableFilterInput.addEventListener("input", applyFiltersAndRender);
  if (globalSearchInput) globalSearchInput.addEventListener("input", applyFiltersAndRender);
  if (pinnedFilterSelect) pinnedFilterSelect.addEventListener("change", applyFiltersAndRender);
  if (attachmentFilterSelect) attachmentFilterSelect.addEventListener("change", applyFiltersAndRender);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (tableFilterInput) tableFilterInput.focus();
    }
  });

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", (e) => {
      document.querySelectorAll(".row-checkbox").forEach((cb) => (cb.checked = e.target.checked));
    });
  }

  // =========================================================================
  // 12. EXPORT CSV
  // =========================================================================
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      if (rawMemos.length === 0) {
        alert("No memorandum records available to export.");
        return;
      }

      const headers = ["Control No", "Date", "Addressed To", "Subject", "Signatory", "Remarks", "Is Pinned", "Has PDF"];
      const rows = [headers.join(",")];

      rawMemos.forEach((m) => {
        const row = [
          `"${m.memoNo || ""}"`,
          `"${m.date || ""}"`,
          `"${(m.addressedTo || "").replace(/"/g, '""')}"`,
          `"${(m.subject || m.title || "").replace(/"/g, '""')}"`,
          `"${(m.issuedBy || "").replace(/"/g, '""')}"`,
          `"${(m.remarks || "").replace(/"/g, '""')}"`,
          `"${m.isPinned ? "Yes" : "No"}"`,
          `"${m.pdfUrl ? "Yes" : "No"}"`
        ];
        rows.push(row.join(","));
      });

      const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `PGENRO_Office_Memorandums_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast("CSV Registry export generated.");
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Initial Sync
  listenToMemos();
});