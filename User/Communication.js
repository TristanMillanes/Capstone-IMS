const form = document.getElementById("communicationForm");
const typeInput = document.getElementById("type");
const controlNoInput = document.getElementById("controlNo");

let records = JSON.parse(localStorage.getItem("communicationRecords")) || [];
let currentFilter = "All";
let uploadedFileName = "";
let ocrPages = [];

function generateControlNumber(type) {
  const year = new Date().getFullYear();
  const count = records.filter(record => record.type === type).length + 1;
  const prefix = type === "Incoming" ? "INC" : "OUT";
  return `${prefix}-${year}-${String(count).padStart(4, "0")}`;
}

typeInput.addEventListener("change", () => {
  controlNoInput.value = typeInput.value ? generateControlNumber(typeInput.value) : "";
});

form.addEventListener("submit", function(e) {
  e.preventDefault();

  const editIndex = document.getElementById("editIndex").value;

  const pageTexts = Array.from(document.querySelectorAll(".page-text")).map((textarea, index) => ({
    page_number: index + 1,
    text: textarea.value
  }));

  const record = {
    type: document.getElementById("type").value,
    controlNo: document.getElementById("controlNo").value,
    documentType: document.getElementById("documentType").value,
    subject: document.getElementById("subject").value,
    office: document.getElementById("office").value,
    date: document.getElementById("date").value,
    status: document.getElementById("status").value,
    remarks: document.getElementById("remarks").value,
    fileName: uploadedFileName,
    ocrText: document.getElementById("ocrText").value,
    pages: pageTexts.length ? pageTexts : ocrPages
  };

  if (editIndex === "") {
    records.push(record);
    alert("Communication record saved successfully.");
  } else {
    records[editIndex] = record;
    alert("Communication record updated successfully.");
  }

  localStorage.setItem("communicationRecords", JSON.stringify(records));

  form.reset();
  uploadedFileName = "";
  ocrPages = [];
  document.getElementById("pageViewer").innerHTML = "";
  document.getElementById("editIndex").value = "";
  document.getElementById("formTitle").textContent = "Add Communication";
  document.getElementById("submitBtn").textContent = "Save Record";

  displayRecords();
  updateDashboard();
});

function cleanOCRText(text) {
  return text
    .replace(/--- PAGE \d+ ---/g, "")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getSubjectFromOCR(text) {
  const cleanText = cleanOCRText(text);

  if (!cleanText) return "";

  const keywords = [
    "subject:",
    "subject matter:",
    "re:",
    "regarding:",
    "particulars:"
  ];

  const lowerText = cleanText.toLowerCase();

  for (const keyword of keywords) {
    const index = lowerText.indexOf(keyword);

    if (index !== -1) {
      let extracted = cleanText.substring(index + keyword.length).trim();
      extracted = extracted.split(".")[0].trim();
      return extracted.substring(0, 180);
    }
  }

  return cleanText.substring(0, 180);
}

async function extractOCR() {
  const fileInput = document.getElementById("documentFile");
  const ocrText = document.getElementById("ocrText");
  const pageViewer = document.getElementById("pageViewer");
  const subjectInput = document.getElementById("subject");

  if (!fileInput.files.length) {
    alert("Please upload a PDF or image first.");
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  uploadedFileName = fileInput.files[0].name;
  ocrText.value = "Reading document, please wait...";
  subjectInput.value = "";
  pageViewer.innerHTML = "";

  try {
    const response = await fetch("http://127.0.0.1:5000/ocr", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const errorResult = await response.json();
      alert(errorResult.error || "OCR failed.");
      ocrText.value = "";
      return;
    }

    const result = await response.json();

    console.log("OCR RESULT:", result);

    uploadedFileName = result.filename || uploadedFileName;
    ocrPages = result.pages || [];

    const extractedText = result.text || "";

    ocrText.value = extractedText;

    const autoSubject = getSubjectFromOCR(extractedText);

    if (autoSubject) {
      subjectInput.value = autoSubject;
    } else {
      subjectInput.value = "No subject detected";
    }

    if (ocrPages.length > 0) {
      ocrPages.forEach(page => {
        pageViewer.innerHTML += `
          <div class="page-card">
            <h4>Page ${page.page_number}</h4>
            ${
              page.preview_url
                ? `<img src="${page.preview_url}" class="page-preview">`
                : `<p>No preview available.</p>`
            }
            <textarea class="page-text">${page.text || ""}</textarea>
          </div>
        `;
      });
    }

  } catch (error) {
    console.error(error);
    alert("Cannot connect to OCR server. Make sure python app.py is running.");
    ocrText.value = "";
    subjectInput.value = "";
    pageViewer.innerHTML = "";
  }
}

function displayRecords() {
  const table = document.getElementById("recordsTable");
  const search = document.getElementById("searchInput").value.toLowerCase();
  const statusFilter = document.getElementById("statusFilter").value;

  table.innerHTML = "";

  const filteredRecords = records.filter(record => {
    const matchesType = currentFilter === "All" || record.type === currentFilter;
    const matchesStatus = statusFilter === "All" || record.status === statusFilter;

    const matchesSearch =
      (record.controlNo || "").toLowerCase().includes(search) ||
      (record.subject || "").toLowerCase().includes(search) ||
      (record.office || "").toLowerCase().includes(search) ||
      (record.documentType || "").toLowerCase().includes(search) ||
      (record.fileName || "").toLowerCase().includes(search);

    return matchesType && matchesStatus && matchesSearch;
  });

  if (filteredRecords.length === 0) {
    table.innerHTML = `
      <tr>
        <td colspan="9" class="empty">No communication records found.</td>
      </tr>
    `;
    return;
  }

  filteredRecords.forEach(record => {
    const originalIndex = records.indexOf(record);

    table.innerHTML += `
      <tr>
        <td><strong>${record.controlNo}</strong></td>
        <td>${record.type}</td>
        <td>${record.documentType}</td>
        <td>${record.subject}</td>
        <td>${record.office}</td>
        <td>${record.date}</td>
        <td><span class="badge ${record.status}">${record.status}</span></td>
        <td>${record.fileName || "No file"}</td>
        <td>
          <button class="action-btn edit" onclick="editRecord(${originalIndex})">Edit</button>
          <button class="action-btn view" onclick="viewOCR(${originalIndex})">View OCR</button>
          <button class="action-btn delete" onclick="deleteRecord(${originalIndex})">Delete</button>
        </td>
      </tr>
    `;
  });
}

function editRecord(index) {
  const record = records[index];

  document.getElementById("editIndex").value = index;
  document.getElementById("type").value = record.type;
  document.getElementById("controlNo").value = record.controlNo;
  document.getElementById("documentType").value = record.documentType;
  document.getElementById("subject").value = record.subject;
  document.getElementById("office").value = record.office;
  document.getElementById("date").value = record.date;
  document.getElementById("status").value = record.status;
  document.getElementById("remarks").value = record.remarks;
  document.getElementById("ocrText").value = record.ocrText || "";

  uploadedFileName = record.fileName || "";
  ocrPages = record.pages || [];

  const pageViewer = document.getElementById("pageViewer");
  pageViewer.innerHTML = "";

  if (ocrPages.length > 0) {
    ocrPages.forEach(page => {
      pageViewer.innerHTML += `
        <div class="page-card">
          <h4>Page ${page.page_number}</h4>
          <textarea class="page-text">${page.text || ""}</textarea>
        </div>
      `;
    });
  }

  document.getElementById("formTitle").textContent = "Edit Communication";
  document.getElementById("submitBtn").textContent = "Update Record";
}

function viewOCR(index) {
  const record = records[index];

  if (!record.ocrText && (!record.pages || record.pages.length === 0)) {
    alert("No OCR text available for this record.");
    return;
  }

  let text = `File: ${record.fileName || "No file"}\n\n`;

  if (record.pages && record.pages.length > 0) {
    record.pages.forEach(page => {
      text += `--- Page ${page.page_number} ---\n${page.text}\n\n`;
    });
  } else {
    text += record.ocrText;
  }

  alert(text);
}

function deleteRecord(index) {
  if (confirm("Are you sure you want to delete this record?")) {
    records.splice(index, 1);
    localStorage.setItem("communicationRecords", JSON.stringify(records));
    displayRecords();
    updateDashboard();
  }
}

function setFilter(type, button) {
  currentFilter = type;

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.remove("active");
  });

  button.classList.add("active");
  displayRecords();
}

function updateDashboard() {
  document.getElementById("totalRecords").textContent = records.length;

  document.getElementById("incomingCount").textContent =
    records.filter(record => record.type === "Incoming").length;

  document.getElementById("outgoingCount").textContent =
    records.filter(record => record.type === "Outgoing").length;

  document.getElementById("pendingCount").textContent =
    records.filter(record => record.status === "Pending").length;
}

displayRecords();
updateDashboard();