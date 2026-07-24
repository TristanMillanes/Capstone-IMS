const initialRecords = [
  {
    slipNo: 'ICS-001',
    issueDate: '2026-07-10',
    custodian: 'A. Manalo',
    officeUnit: 'Budget Office',
    itemDesc: 'Laptop 14"',
    quantity: 1,
    status: 'Issued',
    notes: 'For field audit and reporting.'
  },
  {
    slipNo: 'ICS-002',
    issueDate: '2026-07-12',
    custodian: 'R. Santos',
    officeUnit: 'Planning Section',
    itemDesc: 'Projector',
    quantity: 1,
    status: 'Pending',
    notes: 'Awaiting return after training session.'
  },
  {
    slipNo: 'ICS-003',
    issueDate: '2026-07-15',
    custodian: 'M. Reyes',
    officeUnit: 'Admin Office',
    itemDesc: 'Printer Paper Box',
    quantity: 3,
    status: 'Returned',
    notes: 'Returned complete and inspected.'
  }
];

let records = [...initialRecords];

const form = document.getElementById('icsForm');
const tableBody = document.getElementById('slipTableBody');
const statTotalSlips = document.getElementById('statTotalSlips');
const statIssuedItems = document.getElementById('statIssuedItems');
const statPendingReturn = document.getElementById('statPendingReturn');
const statOverdue = document.getElementById('statOverdue');
const summaryEquipment = document.getElementById('summaryEquipment');
const summarySupplies = document.getElementById('summarySupplies');
const summaryField = document.getElementById('summaryField');
const toastContainer = document.getElementById('toastContainer');
const hamburgerMenu = document.getElementById('hamburgerMenu');
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function renderRecords() {
  if (!tableBody) return;

  tableBody.innerHTML = '';

  records.forEach((item) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.slipNo}</td>
      <td>${item.custodian}</td>
      <td>${item.itemDesc} <small>(${item.quantity})</small></td>
      <td><span class="status-pill ${item.status.toLowerCase()}">${item.status}</span></td>
    `;
    tableBody.appendChild(row);
  });

  const totalSlips = records.length;
  const issuedItems = records.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const pendingReturn = records.filter((item) => item.status === 'Pending').length;
  const overdue = records.filter((item) => item.status === 'Issued').length;

  statTotalSlips.textContent = totalSlips;
  statIssuedItems.textContent = issuedItems;
  statPendingReturn.textContent = pendingReturn;
  statOverdue.textContent = overdue;

  summaryEquipment.textContent = records.filter((item) => /laptop|projector|monitor|device/i.test(item.itemDesc)).length;
  summarySupplies.textContent = records.filter((item) => /paper|pen|folder|supply|binder/i.test(item.itemDesc)).length;
  summaryField.textContent = records.filter((item) => /field|portable|kit|tool/i.test(item.itemDesc)).length;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const newRecord = {
    slipNo: document.getElementById('slipNo').value.trim(),
    issueDate: document.getElementById('issueDate').value,
    custodian: document.getElementById('custodian').value.trim(),
    officeUnit: document.getElementById('officeUnit').value.trim(),
    itemDesc: document.getElementById('itemDesc').value.trim(),
    quantity: document.getElementById('quantity').value,
    status: document.getElementById('status').value,
    notes: document.getElementById('notes').value.trim()
  };

  records.unshift(newRecord);
  form.reset();
  document.getElementById('quantity').value = 1;
  document.getElementById('status').value = 'Issued';
  renderRecords();
  showToast(`Saved ${newRecord.slipNo}`);
});

function toggleSidebar() {
  sidebar.classList.toggle('open');
  overlay.classList.toggle('active');
  hamburgerMenu.classList.toggle('active');
}

hamburgerMenu.addEventListener('click', toggleSidebar);
overlay.addEventListener('click', toggleSidebar);

if (window.lucide) {
  lucide.createIcons();
}

renderRecords();
