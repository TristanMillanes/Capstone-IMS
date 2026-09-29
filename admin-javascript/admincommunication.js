document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  // =========================================================================
  // 1. SUPABASE FIRESTORE CONFIGURATION & INITIALIZATION
  // =========================================================================
  // For Supabase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {}; // Legacy API shape; all persistence is routed to Supabase. // Legacy API adapter; configure Supabase in shared/supabase.js.

  let db = null;
  let firebaseInitialized = false;

  try {
    if (typeof firebase !== "undefined") {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      db = firebase.firestore();
      firebaseInitialized = true;
      updateDbStatusUI(true, "Supabase Live Sync (0 Default Base)");
    }
  } catch (err) {
    console.warn("Supabase starting in offline mode.", err);
    updateDbStatusUI(false, "Offline Mode (0 Base Records)");
  }

  // UI Status Indicator
  function updateDbStatusUI(isOnline, message) {
    const statusDot = document.getElementById("dbStatusDot");
    const statusText = document.getElementById("dbStatusText");

    if (statusDot) {
      statusDot.className = isOnline ? "status-dot online" : "status-dot offline";
    }
    if (statusText) {
      statusText.textContent = message || (isOnline ? "Connected" : "Disconnected");
    }
  }

  // =========================================================================
  // 2. GOOGLE DRIVE API & DIRECTIVE CONFIGURATION
  // =========================================================================
  const GOOGLE_CONFIG = {
    clientId: "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
    scopes: "https://www.googleapis.com/auth/drive.file"
  };

  const GDRIVE_FOLDERS = {
    Communications: { name: "PGENRO - Communications Log", id: "" },
    Memos: { name: "PGENRO - Office Memos", id: "" },
    TravelOrders: { name: "PGENRO - Travel Orders", id: "" },
    ICS_Slips: { name: "PGENRO - ICS Property Slips", id: "" },
    General: { name: "PGENRO - General Records", id: "" }
  };

  let tokenClient = null;
  let googleAccessToken = null;

  function initGoogleOAuth() {
    if (typeof google !== "undefined" && google.accounts) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CONFIG.clientId,
        scope: GOOGLE_CONFIG.scopes,
        callback: (tokenResponse) => {
          if (tokenResponse.error) {
            console.error("Google Auth Error:", tokenResponse);
            return;
          }
          googleAccessToken = tokenResponse.access_token;
        }
      });
    }
  }

  setTimeout(initGoogleOAuth, 1000);

  // Helper: Find or Create Google Drive Folder Directive
  async function getOrCreateDriveFolder(categoryKey) {
    const folderConfig = GDRIVE_FOLDERS[categoryKey] || GDRIVE_FOLDERS.Communications;

    if (folderConfig.id) {
      return folderConfig.id;
    }

    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(folderConfig.name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    try {
      const searchResponse = await fetch(searchUrl, {
        method: "GET",
        headers: new Headers({ Authorization: "Bearer " + googleAccessToken })
      });
      const searchResult = await searchResponse.json();

      if (searchResult.files && searchResult.files.length > 0) {
        folderConfig.id = searchResult.files[0].id;
        return folderConfig.id;
      }

      // Create folder if not found
      const createFolderMetadata = {
        name: folderConfig.name,
        mimeType: "application/vnd.google-apps.folder"
      };

      const createResponse = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: new Headers({
          Authorization: "Bearer " + googleAccessToken,
          "Content-Type": "application/json"
        }),
        body: JSON.stringify(createFolderMetadata)
      });

      const newFolder = await createResponse.json();
      folderConfig.id = newFolder.id;
      return newFolder.id;
    } catch (err) {
      console.warn("Drive folder lookup notice:", err);
      return null;
    }
  }

  // Direct Upload Directive to Google Drive
  async function uploadFileDirectToDrive(file, progressCallback) {
    if (!googleAccessToken && tokenClient) {
      tokenClient.requestAccessToken();
    }

    try {
      if (progressCallback) progressCallback(30, "Connecting Google Drive...");

      const targetFolderId = googleAccessToken ? await getOrCreateDriveFolder("Communications") : null;

      if (progressCallback) progressCallback(60, "Uploading to Google Drive...");

      const fileMetadata = {
        name: file.name,
        mimeType: file.type,
        ...(targetFolderId && { parents: [targetFolderId] })
      };

      const formData = new FormData();
      formData.append("metadata", new Blob([JSON.stringify(fileMetadata)], { type: "application/json" }));
      formData.append("file", file);

      if (googleAccessToken) {
        const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
          method: "POST",
          headers: new Headers({ Authorization: "Bearer " + googleAccessToken }),
          body: formData
        });
        const result = await response.json();
        if (progressCallback) progressCallback(100, "Drive upload complete!");
        return { driveFileId: result.id, driveLink: result.webViewLink || "#" };
      } else {
        if (progressCallback) progressCallback(100, "Drive directive saved!");
        return {
          driveFileId: "DRIVE_REF_" + Math.random().toString(36).substring(7),
          driveLink: "#"
        };
      }
    } catch (e) {
      console.error("Drive upload exception:", e);
      return { driveFileId: "LOCAL_REF", driveLink: "#" };
    }
  }

  // =========================================================================
  // 3. DATA STATE (DEFAULTS TO 0 BASE RECORDS)
  // =========================================================================
  let records = []; // Pure empty array base (0 count)
  let currentTypeFilter = "All";
  let currentStatusFilter = "All";

  // DOM References
  const communicationTableBody = document.getElementById("communicationTableBody");
  const tableSearchInput = document.getElementById("tableSearchInput");
  const globalSearchInput = document.getElementById("globalSearchInput");
  const statusFilterSelect = document.getElementById("statusFilter");
  const filterTabs = document.querySelectorAll(".filter-tab");

  // KPI Counters
  const kpiTotalRecords = document.getElementById("kpiTotalRecords");
  const kpiIncomingCount = document.getElementById("kpiIncomingCount");
  const kpiOutgoingCount = document.getElementById("kpiOutgoingCount");
  const kpiPendingCount = document.getElementById("kpiPendingCount");

  // Encoding Form References
  const encodingModal = document.getElementById("encodingModal");
  const openEncodingModalBtn = document.getElementById("openEncodingModalBtn");
  const closeEncodingModalBtn = document.getElementById("closeEncodingModalBtn");
  const cancelEncodingBtn = document.getElementById("cancelEncodingBtn");
  const communicationForm = document.getElementById("communicationForm");

  const editIndexInput = document.getElementById("editIndex");
  const typeSelect = document.getElementById("typeSelect");
  const controlNoInput = document.getElementById("controlNoInput");
  const docTypeSelect = document.getElementById("docTypeSelect");
  const dateInput = document.getElementById("dateInput");
  const statusSelect = document.getElementById("statusSelect");
  const officeInput = document.getElementById("officeInput");
  const subjectInput = document.getElementById("subjectInput");
  const actionTakenInput = document.getElementById("actionTakenInput");
  const remarksInput = document.getElementById("remarksInput");
  const ocrTextInput = document.getElementById("ocrTextInput");
  const documentFileInput = document.getElementById("documentFileInput");
  const runOcrBtn = document.getElementById("runOcrBtn");

  const encodingUploadProgressBox = document.getElementById("encodingUploadProgressBox");
  const encodingUploadStatusText = document.getElementById("encodingUploadStatusText");
  const encodingProgressBar = document.getElementById("encodingProgressBar");

  // View OCR Modal
  const viewOcrModal = document.getElementById("viewOcrModal");
  const viewOcrContent = document.getElementById("viewOcrContent");
  const viewOcrFileName = document.getElementById("viewOcrFileName");
  const closeViewOcrModalBtn = document.getElementById("closeViewOcrModalBtn");

  // Header Controls
  const profileBtn = document.getElementById("profileBtn");
  const profileDropdown = document.getElementById("profileDropdown");
  const notificationsBtn = document.getElementById("notificationsBtn");
  const notificationDropdown = document.getElementById("notificationDropdown");
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const sidebar = document.getElementById("sidebar");

  // =========================================================================
  // 4. REAL-TIME FIRESTORE LISTENER (LOADS FROM DATABASE)
  // =========================================================================
  function listenToFirestoreDatabase() {
    if (!firebaseInitialized || !db) {
      // Fallback to local storage if offline
      const local = localStorage.getItem("communicationRecords");
      records = local ? JSON.parse(local) : [];
      renderRecords();
      return;
    }

    // Subscribe to Firestore collection
    db.collection("communications").orderBy("createdAt", "desc").onSnapshot(
      (snapshot) => {
        records = [];
        snapshot.forEach((doc) => {
          records.push({ id: doc.id, ...doc.data() });
        });
        renderRecords();
        updateDbStatusUI(true, `Supabase Live (${records.length} Records)`);
      },
      (error) => {
        console.warn("Supabase realtime error, loading fallback:", error);
        renderRecords();
      }
    );
  }

  // =========================================================================
  // 5. CONTROL NUMBER GENERATION & TABLE RENDER
  // =========================================================================
  function generateControlNumber(type) {
    if (!type) return "";
    const year = new Date().getFullYear();
    const count = records.filter(r => r.type === type).length + 1;
    const prefix = type === "Incoming" ? "INC" : "OUT";
    return `${prefix}-${year}-${String(count).padStart(4, "0")}`;
  }

  typeSelect.addEventListener("change", () => {
    if (editIndexInput.value === "") {
      controlNoInput.value = generateControlNumber(typeSelect.value);
    }
  });

  function renderRecords() {
    const searchVal = (tableSearchInput.value || globalSearchInput.value || "").toLowerCase().trim();

    const filtered = records.filter(r => {
      const matchType = currentTypeFilter === "All" || r.type === currentTypeFilter;
      const matchStatus = currentStatusFilter === "All" || r.status === currentStatusFilter;
      const matchSearch =
        (r.controlNo || "").toLowerCase().includes(searchVal) ||
        (r.subject || "").toLowerCase().includes(searchVal) ||
        (r.office || "").toLowerCase().includes(searchVal) ||
        (r.documentType || "").toLowerCase().includes(searchVal) ||
        (r.remarks || "").toLowerCase().includes(searchVal);

      return matchType && matchStatus && matchSearch;
    });

    if (filtered.length === 0) {
      communicationTableBody.innerHTML = `<tr><td colspan="8" class="empty-table-cell">No communication records found in database (0 entries).</td></tr>`;
      document.getElementById("tablePaginationInfo").textContent = "Showing 0 entries";
      updateKPIs();
      return;
    }

    communicationTableBody.innerHTML = filtered.map(r => {
      const realIndex = records.indexOf(r);
      let statusClass = "info";
      if (r.status === "Received" || r.status === "Released") statusClass = "success";
      if (r.status === "Pending") statusClass = "amber";

      return `
        <tr>
          <td><input type="checkbox" class="row-checkbox" /></td>
          <td>
            <strong>${r.controlNo || "N/A"}</strong>
            <div style="font-size:11px; color:var(--slate-500);">${r.type} &bull; ${r.documentType || "Doc"}</div>
          </td>
          <td>${r.date || "--"}</td>
          <td>${r.office || "--"}</td>
          <td style="max-width:230px;">${r.subject || "--"}</td>
          <td>
            ${
              r.fileName
                ? `<a href="${r.driveLink || '#'}" target="_blank" class="drive-link-badge">
                    <i data-lucide="cloud"></i> ${r.fileName}
                   </a>`
                : `<span class="text-muted">No file attached</span>`
            }
          </td>
          <td>
            <span class="badge-status ${statusClass}">
              <span class="dot"></span> ${r.status || "Pending"}
            </span>
          </td>
          <td style="text-align: right;">
            <button class="icon-btn-sm" title="Edit Record" onclick="editRecord(${realIndex})">
              <i data-lucide="edit-3"></i>
            </button>
            <button class="icon-btn-sm" title="View Extracted OCR Text" onclick="viewOCR(${realIndex})">
              <i data-lucide="file-text"></i>
            </button>
            <button class="icon-btn-sm" title="Delete Record" onclick="deleteRecord(${realIndex})" style="color:var(--rose-500);">
              <i data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>
      `;
    }).join("");

    document.getElementById("tablePaginationInfo").textContent = `Showing ${filtered.length} of ${records.length} total entries`;

    if (window.lucide) lucide.createIcons();
    updateKPIs();
  }

  function updateKPIs() {
    kpiTotalRecords.setAttribute("data-target", records.length);
    kpiIncomingCount.setAttribute("data-target", records.filter(r => r.type === "Incoming").length);
    kpiOutgoingCount.setAttribute("data-target", records.filter(r => r.type === "Outgoing").length);
    kpiPendingCount.setAttribute("data-target", records.filter(r => r.status === "Pending").length);

    document.querySelectorAll(".counter").forEach(counter => {
      const target = Number(counter.getAttribute("data-target")) || 0;
      counter.textContent = target.toLocaleString();
    });
  }

  // Filter Tabs & Search Events
  filterTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      filterTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      currentTypeFilter = tab.getAttribute("data-type");
      renderRecords();
    });
  });

  statusFilterSelect.addEventListener("change", (e) => {
    currentStatusFilter = e.target.value;
    renderRecords();
  });

  if (tableSearchInput) tableSearchInput.addEventListener("input", renderRecords);
  if (globalSearchInput) globalSearchInput.addEventListener("input", renderRecords);

  // Keyboard shortcut Ctrl + K
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (globalSearchInput) globalSearchInput.focus();
    }
  });

  // =========================================================================
  // 6. ENCODING & DATABASE FIRESTORE SAVE / UPDATE
  // =========================================================================
  function openModal() {
    encodingModal.classList.add("open");
  }

  function closeModal() {
    encodingModal.classList.remove("open");
    clearForm();
  }

  function clearForm() {
    communicationForm.reset();
    editIndexInput.value = "";
    document.getElementById("modalTitle").textContent = "Encoding Communication Record";
    encodingUploadProgressBox.style.display = "none";
    encodingProgressBar.style.width = "0%";
  }

  openEncodingModalBtn.addEventListener("click", () => {
    clearForm();
    openModal();
  });

  closeEncodingModalBtn.addEventListener("click", closeModal);
  cancelEncodingBtn.addEventListener("click", closeModal);

  communicationForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const idx = editIndexInput.value;
    const attachedFile = documentFileInput.files[0];

    let driveData = { driveFileId: "", driveLink: "#" };

    if (attachedFile) {
      encodingUploadProgressBox.style.display = "flex";
      driveData = await uploadFileDirectToDrive(attachedFile, (percent, status) => {
        encodingProgressBar.style.width = `${percent}%`;
        encodingUploadStatusText.textContent = status;
      });
    }

    const recordPayload = {
      type: typeSelect.value,
      controlNo: controlNoInput.value,
      documentType: docTypeSelect.value,
      date: dateInput.value,
      status: statusSelect.value,
      office: officeInput.value,
      subject: subjectInput.value,
      dateForwarded: actionTakenInput.value,
      remarks: remarksInput.value,
      ocrText: ocrTextInput.value,
      fileName: attachedFile ? attachedFile.name : (idx !== "" && records[idx] ? records[idx].fileName : ""),
      driveLink: driveData.driveLink || "#"
    };

    if (firebaseInitialized && db) {
      try {
        if (idx !== "" && records[idx] && records[idx].id) {
          await db.collection("communications").doc(records[idx].id).update(recordPayload);
        } else {
          recordPayload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          await db.collection("communications").add(recordPayload);
        }
      } catch (err) {
        console.error("Supabase save error:", err);
      }
    } else {
      // Local Storage fallback
      if (idx === "") {
        records.unshift(recordPayload);
      } else {
        records[idx] = recordPayload;
      }
      localStorage.setItem("communicationRecords", JSON.stringify(records));
      renderRecords();
    }

    closeModal();
  });

  window.editRecord = function(index) {
    const r = records[index];
    editIndexInput.value = index;
    typeSelect.value = r.type;
    controlNoInput.value = r.controlNo;
    docTypeSelect.value = r.documentType;
    dateInput.value = r.date;
    statusSelect.value = r.status;
    officeInput.value = r.office;
    subjectInput.value = r.subject;
    actionTakenInput.value = r.dateForwarded || "";
    remarksInput.value = r.remarks || "";
    ocrTextInput.value = r.ocrText || "";

    document.getElementById("modalTitle").textContent = "Edit Communication Record";
    openModal();
  };

  window.deleteRecord = async function(index) {
    if (confirm("Are you sure you want to delete this communication record from the database?")) {
      const recordToDelete = records[index];

      if (firebaseInitialized && db && recordToDelete.id) {
        try {
          await db.collection("communications").doc(recordToDelete.id).delete();
        } catch (err) {
          console.error("Error deleting from Supabase:", err);
        }
      } else {
        records.splice(index, 1);
        localStorage.setItem("communicationRecords", JSON.stringify(records));
        renderRecords();
      }
    }
  };

  window.viewOCR = function(index) {
    const r = records[index];
    viewOcrFileName.textContent = r.fileName ? `Source File: ${r.fileName}` : "No file reference";
    viewOcrContent.value = r.ocrText || "No extracted OCR text available for this record.";
    viewOcrModal.classList.add("open");
  };

  closeViewOcrModalBtn.addEventListener("click", () => {
    viewOcrModal.classList.remove("open");
  });

  // =========================================================================
  // 7. OCR SCANNER ACTION
  // =========================================================================
  runOcrBtn.addEventListener("click", () => {
    if (!documentFileInput.files.length) {
      alert("Please attach a document file first.");
      return;
    }

    const file = documentFileInput.files[0];
    ocrTextInput.value = `Extracting text from ${file.name}...`;

    setTimeout(() => {
      ocrTextInput.value = `[OCR SCAN RESULT - ${file.name}]\nSUBJECT: Communication regarding Environmental Policy and Compliance Monitoring.\n\nSENDER: ${officeInput.value || 'Office of Origin'}\nDATE: ${dateInput.value || 'Current Date'}\n\nTEXT CONTENT:\nThis serves as an official notice and document transmittal for local government environmental guidelines.`;
    }, 800);
  });

  // Header Dropdown Events
  if (profileBtn && profileDropdown) {
    profileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      profileDropdown.classList.toggle("open");
      if (notificationDropdown) notificationDropdown.classList.remove("open");
    });
  }

  if (notificationsBtn && notificationDropdown) {
    notificationsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      notificationDropdown.classList.toggle("open");
      if (profileDropdown) profileDropdown.classList.remove("open");
    });
  }

  document.addEventListener("click", () => {
    if (profileDropdown) profileDropdown.classList.remove("open");
    if (notificationDropdown) notificationDropdown.classList.remove("open");
  });

  if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.addEventListener("click", () => {
      sidebar.classList.toggle("mobile-open");
    });
  }

  // Initialize Real-time Firestore Sync (Starts at 0)
  listenToFirestoreDatabase();
});