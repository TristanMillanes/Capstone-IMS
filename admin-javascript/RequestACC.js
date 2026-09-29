// ==========================================================================
// PGENRO IMS - ACCOUNT ACCESS REQUESTS CONTROLLER (SUPABASE)
// Uses the shared Supabase compatibility adapter during the Supabase-to-Supabase migration.
// ==========================================================================

const firebase = window.firebase;
const auth = firebase.auth();
const db = firebase.database();
const supabase = window.pgenroSupabase;
const PGENRO_API = window.PGENRO_API;

const onAuthStateChanged = (authApi, callback) => authApi.onAuthStateChanged(callback);
const signOut = (authApi) => authApi.signOut();
const ref = (_db, path = "") => _db.ref(path);
const get = (reference) => reference.once("value");
const onValue = (reference, callback, errorCallback) => reference.on("value", callback, errorCallback);
const off = (reference) => reference.off();
const set = (reference, value) => reference.set(value);
const update = (reference, value) => reference.update(value);
const remove = (reference) => reference.remove();
const push = async (reference, value) => {
    const child = reference.push();
    if (value !== undefined) await child.set(value);
    return child;
};
const serverTimestamp = () => new Date().toISOString();

// --- GLOBAL STATE ---
let requestsData = [];
let selectedRequest = null;
let currentAdmin = null;
let requestsRef = null;

// --- DOM ELEMENTS ---
const requestTableBody = document.getElementById("requestTableBody");
const requestSearchInput = document.getElementById("requestSearchInput");
const divisionFilterSelect = document.getElementById("divisionFilterSelect");
const statusFilterSelect = document.getElementById("statusFilterSelect");
const selectAllCheckbox = document.getElementById("selectAllCheckbox");
const bulkApproveBtn = document.getElementById("bulkApproveBtn");
const bulkRejectBtn = document.getElementById("bulkRejectBtn");

// Modals
const reviewModal = document.getElementById("reviewModal");
const declineModal = document.getElementById("declineModal");
const systemConfirmModal = document.getElementById("systemConfirmModal");
const closeReviewModalBtn = document.getElementById("closeReviewModalBtn");
const closeDeclineModalBtn = document.getElementById("closeDeclineModalBtn");
const cancelDeclineModalBtn = document.getElementById("cancelDeclineModalBtn");

// Review Modal Fields
const reviewReqId = document.getElementById("reviewReqId");
const reviewDate = document.getElementById("reviewDate");
const reviewFullName = document.getElementById("reviewFullName");
const reviewEmail = document.getElementById("reviewEmail");
const reviewContact = document.getElementById("reviewContact");
const reviewGovId = document.getElementById("reviewGovId");
const reviewPosition = document.getElementById("reviewPosition");
const reviewDivision = document.getElementById("reviewDivision");
const reviewRole = document.getElementById("reviewRole");
const reviewEndorser = document.getElementById("reviewEndorser");
const reviewReason = document.getElementById("reviewReason");
const assignAccountTypeSelect = document.getElementById("assignAccountTypeSelect");
const assignRoleSelect = document.getElementById("assignRoleSelect");
const approveModalActionBtn = document.getElementById("approveModalActionBtn");
const declineModalActionBtn = document.getElementById("declineModalActionBtn");

// Decline Modal Fields
const declineReasonSelect = document.getElementById("declineReasonSelect");
const declineNotesInput = document.getElementById("declineNotesInput");
const confirmDeclineBtn = document.getElementById("confirmDeclineBtn");

// Custom Confirmation Dialog Elements
const confirmModalTitle = document.getElementById("confirmModalTitle");
const confirmModalDesc = document.getElementById("confirmModalDesc");
const confirmModalIconBox = document.getElementById("confirmModalIconBox");
const confirmModalCancelBtn = document.getElementById("confirmModalCancelBtn");
const confirmModalActionBtn = document.getElementById("confirmModalActionBtn");

// Topbar & Navigation Elements
const profileBtn = document.getElementById("profileBtn");
const profileDropdown = document.getElementById("profileDropdown");
const notificationsBtn = document.getElementById("notificationsBtn");
const notificationDropdown = document.getElementById("notificationDropdown");
const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const sidebar = document.getElementById("sidebar");
const sidebarCollapseBtn = document.getElementById("sidebarCollapseBtn");
const logoutBtn = document.getElementById("logoutBtn");
const globalSearchInput = document.getElementById("globalSearchInput");

// KPI Counters
const statPendingCount = document.getElementById("statPendingCount");
const statApprovedCount = document.getElementById("statApprovedCount");
const statRejectedCount = document.getElementById("statRejectedCount");
const statTotalCount = document.getElementById("statTotalCount");
const sidebarPendingAccBadge = document.getElementById("sidebarPendingAccBadge");
const notifBadgeCount = document.getElementById("notifBadgeCount");
const notifPing = document.getElementById("notifPing");
const notificationList = document.getElementById("notificationList");

// Database Status Indicator
const dbStatusDot = document.getElementById("dbStatusDot");
const dbStatusText = document.getElementById("dbStatusText");

// Toast
const toast = document.getElementById("toast");
const toastMessage = document.getElementById("toastMessage");

// ==========================================================================
// CUSTOM SYSTEM CONFIRMATION MODAL HELPER
// ==========================================================================
function showCustomConfirm({
    title = "Confirm Action",
    message = "Are you sure you want to proceed?",
    confirmText = "Confirm",
    cancelText = "Cancel",
    type = "danger", // 'danger' | 'primary' | 'warning'
    icon = "alert-triangle"
} = {}) {
    return new Promise((resolve) => {
        if (!systemConfirmModal) {
            resolve(confirm(message));
            return;
        }

        if (confirmModalTitle) confirmModalTitle.textContent = title;
        if (confirmModalDesc) confirmModalDesc.textContent = message;
        if (confirmModalCancelBtn) confirmModalCancelBtn.textContent = cancelText;

        if (confirmModalActionBtn) {
            confirmModalActionBtn.textContent = confirmText;
            confirmModalActionBtn.className = `btn btn-${type === 'danger' ? 'danger' : 'primary'}`;
        }

        if (confirmModalIconBox) {
            confirmModalIconBox.className = `confirm-icon-box ${type}`;
            confirmModalIconBox.innerHTML = `<i data-lucide="${icon}"></i>`;
        }

        renderIcons();
        systemConfirmModal.classList.add("open");

        const cleanup = (result) => {
            systemConfirmModal.classList.remove("open");
            confirmModalCancelBtn.onclick = null;
            confirmModalActionBtn.onclick = null;
            resolve(result);
        };

        if (confirmModalCancelBtn) confirmModalCancelBtn.onclick = () => cleanup(false);
        if (confirmModalActionBtn) confirmModalActionBtn.onclick = () => cleanup(true);

        systemConfirmModal.onclick = (e) => {
            if (e.target === systemConfirmModal) cleanup(false);
        };
    });
}

// ==========================================================================
// INITIALIZATION
// ==========================================================================
document.addEventListener("DOMContentLoaded", async () => {
    renderIcons();
    setupUIInteractions();
    setupEventListeners();
    monitorDatabaseConnection();

    try {
        if (!supabase || window.PGENRO_SUPABASE?.configured === false) {
            throw new Error("Supabase is not configured. Add the Publishable/Anon key in shared/supabase.js.");
        }

        const profile = await PGENRO_API.requireAdmin();
        currentAdmin = {
            uid: profile.user_id,
            email: profile.email || profile.authUser?.email || "",
            name: profile.full_name || profile.username || profile.authUser?.email?.split("@")[0] || "PGENRO Admin",
            role: profile.role || "Super Admin"
        };

        updateAdminProfileUI(currentAdmin);
        listenToRealtimeRequests();
    } catch (err) {
        console.warn("Admin authorization failed:", err);
        try { await supabase?.auth?.signOut(); } catch {}
        window.location.href = "../User/login.html";
    }
});

// ==========================================================================
// MONITOR SUPABASE REALTIME CONNECTION
// ==========================================================================
function monitorDatabaseConnection() {
    const connectedRef = ref(db, ".info/connected");
    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            console.log("🟢 Supabase Realtime: Connected Successfully");
            if (dbStatusDot) dbStatusDot.className = "status-dot online";
            if (dbStatusText) dbStatusText.textContent = "Live Synchronized";
        } else {
            if (dbStatusDot) dbStatusDot.className = "status-dot offline";
            if (dbStatusText) dbStatusText.textContent = "Connecting Supabase...";
        }
    });
}

// ==========================================================================
// REALTIME DATABASE LISTENER (access_requests)
// ==========================================================================
function listenToRealtimeRequests() {
    if (requestsRef) off(requestsRef);

    requestsRef = ref(db, "access_requests");

    onValue(requestsRef, (snapshot) => {
        requestsData = [];
        if (snapshot.exists()) {
            const data = snapshot.val();
            Object.keys(data).forEach((key) => {
                const item = data[key];
                if (item && typeof item === "object") {
                    requestsData.push({
                        ...item,
                        key: key, // Unique database key (e.g. -Nx...)
                        id: item.id || item.refCode || key // Display Ref Code
                    });
                }
            });
            // Sort: Pending first, then newest timestamp
            requestsData.sort((a, b) => {
                const isPendingA = (a.status || "").toLowerCase() === "pending" ? 1 : 0;
                const isPendingB = (b.status || "").toLowerCase() === "pending" ? 1 : 0;
                if (isPendingA !== isPendingB) return isPendingB - isPendingA;

                const timeA = a.timestamp || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
                const timeB = b.timestamp || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
                return timeB - timeA;
            });
        }
        filterAndRender();
        updateNotificationsUI();
    }, (error) => {
        console.error("🔴 Supabase Database Error:", error);
        if (error.code === "PERMISSION_DENIED" || error.message.includes("PERMISSION_DENIED")) {
            showToast("Database Permission Denied: Ensure current account is listed in /admins.");
            if (dbStatusText) dbStatusText.textContent = "Permission Denied";
            if (dbStatusDot) dbStatusDot.className = "status-dot offline";
        } else {
            showToast("Failed to connect to Supabase Realtime Database.");
        }
        filterAndRender();
    });
}

// ==========================================================================
// RENDER TABLE & DATA
// ==========================================================================
function renderTable(data = requestsData) {
    if (!requestTableBody) return;
    requestTableBody.innerHTML = "";

    if (data.length === 0) {
        requestTableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: #64748b;">
                    <i data-lucide="inbox" style="width: 36px; height: 36px; margin: 0 auto 8px auto; display: block; stroke-width: 1.5; color: #94a3b8;"></i>
                    <p style="font-weight: 700; color: #334155;">No account requests found</p>
                    <small style="color: #64748b;">New registration requests and approval history will appear here.</small>
                </td>
            </tr>
        `;
        renderIcons();
        updateKPICounters();
        return;
    }

    data.forEach((req) => {
        const initials = (req.fullName || req.name || "User")
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")
            .toUpperCase();

        const rawStatus = req.status || "Pending";
        const statusLower = rawStatus.toLowerCase();
        
        let formattedDate = req.date || "Recent";
        if (req.timestamp && typeof req.timestamp === "number") {
            formattedDate = new Date(req.timestamp).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            });
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><input type="checkbox" class="row-checkbox" data-key="${escapeHTML(req.key)}" /></td>
            <td>
                <strong class="font-mono" style="color: #0f172a; font-weight: 700;">${escapeHTML(req.id)}</strong><br>
                <small class="text-muted" style="font-size: 11px;">${escapeHTML(formattedDate)}</small>
            </td>
            <td>
                <div class="user-cell" style="display: flex; align-items: center; gap: 10px;">
                    <div class="avatar-circle ${getAvatarColor(req.role)}">${initials}</div>
                    <div>
                        <strong>${escapeHTML(req.fullName || req.name || 'N/A')}</strong>
                        <small style="display: block; color: #64748b; font-size: 11px;">${escapeHTML(req.email || '')}</small>
                    </div>
                </div>
            </td>
            <td><span class="division-tag">${escapeHTML(req.division || 'Unassigned')}</span></td>
            <td>
                <span class="role-badge-pill">
                    <i data-lucide="${req.role?.includes('Admin') ? 'shield-alert' : 'shield'}" style="width: 12px; height: 12px;"></i>
                    ${escapeHTML(req.role || 'System Staff')}
                </span>
            </td>
            <td>
                ${(req.endorser && req.endorser !== 'N/A') || req.isEndorsed 
                    ? `<span class="endorsement-badge"><i data-lucide="file-check-2"></i> Verified</span>`
                    : `<span class="text-muted" style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px;"><i data-lucide="clock" style="width: 12px; height: 12px;"></i> For Review</span>`
                }
            </td>
            <td>
                <span class="status-badge-dot ${statusLower}">
                    <span class="dot"></span> ${escapeHTML(rawStatus)}
                </span>
            </td>
            <td style="text-align: right;">
                <div class="action-buttons">
                    <button class="btn-icon-action review-btn" data-key="${escapeHTML(req.key)}" title="Review Details & Privileges">
                        <i data-lucide="eye"></i>
                    </button>
                    ${statusLower === 'pending' ? `
                        <button class="btn-icon-action approve approve-quick-btn" data-key="${escapeHTML(req.key)}" title="Approve Request">
                            <i data-lucide="user-check"></i>
                        </button>
                        <button class="btn-icon-action reject reject-quick-btn" data-key="${escapeHTML(req.key)}" title="Decline Request">
                            <i data-lucide="user-x"></i>
                        </button>
                    ` : `
                        <button class="btn-icon-action delete delete-req-btn" data-key="${escapeHTML(req.key)}" title="Delete Request from Database">
                            <i data-lucide="trash-2"></i>
                        </button>
                    `}
                </div>
            </td>
        `;
        requestTableBody.appendChild(tr);
    });

    renderIcons();
    attachRowActions();
    updateKPICounters();
}

// ==========================================================================
// FILTERS & SEARCH
// ==========================================================================
function filterAndRender() {
    const searchTerm = (requestSearchInput?.value || globalSearchInput?.value || "").toLowerCase().trim();
    const selectedDivision = divisionFilterSelect?.value || "ALL";
    const selectedStatus = (statusFilterSelect?.value || "ALL").toLowerCase();

    const filtered = requestsData.filter((req) => {
        const name = (req.fullName || req.name || "").toLowerCase();
        const email = (req.email || "").toLowerCase();
        const id = (req.id || req.refCode || "").toLowerCase();
        const position = (req.position || "").toLowerCase();
        const reqStatus = (req.status || "Pending").toLowerCase();

        const matchesSearch = name.includes(searchTerm) || email.includes(searchTerm) || id.includes(searchTerm) || position.includes(searchTerm);
        const matchesDivision = (selectedDivision === "ALL") || (req.division === selectedDivision);
        const matchesStatus = (selectedStatus === "all") || (reqStatus === selectedStatus);

        return matchesSearch && matchesDivision && matchesStatus;
    });

    renderTable(filtered);

    const rangeText = document.getElementById("tableRangeText");
    if (rangeText) {
        rangeText.textContent = `Showing ${filtered.length} of ${requestsData.length} access requests`;
    }
}

// ==========================================================================
// KPI & NOTIFICATIONS UI
// ==========================================================================
function updateKPICounters() {
    const pending = requestsData.filter((r) => (r.status || "").toLowerCase() === "pending").length;
    const approved = requestsData.filter((r) => (r.status || "").toLowerCase() === "approved").length;
    const rejected = requestsData.filter((r) => (r.status || "").toLowerCase() === "rejected").length;

    if (statPendingCount) statPendingCount.textContent = pending;
    if (statApprovedCount) statApprovedCount.textContent = approved;
    if (statRejectedCount) statRejectedCount.textContent = rejected;
    if (statTotalCount) statTotalCount.textContent = requestsData.length;

    if (sidebarPendingAccBadge) {
        sidebarPendingAccBadge.textContent = `${pending} New`;
        sidebarPendingAccBadge.style.display = pending > 0 ? "inline-block" : "none";
    }
}

function updateNotificationsUI() {
    const pendingRequests = requestsData.filter((r) => (r.status || "").toLowerCase() === "pending");
    
    if (notifBadgeCount) notifBadgeCount.textContent = `${pendingRequests.length} Requests`;
    if (notifPing) notifPing.style.display = pendingRequests.length > 0 ? "block" : "none";

    if (notificationList) {
        if (pendingRequests.length === 0) {
            notificationList.innerHTML = `<div class="notif-item" style="padding: 12px; color: #64748b; font-size: 12px;">No pending account requests.</div>`;
        } else {
            notificationList.innerHTML = pendingRequests.slice(0, 5).map(req => `
                <div class="notif-item" style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9; cursor: pointer;" data-key="${escapeHTML(req.key)}">
                    <strong style="display: block; font-size: 12px; color: #0f172a;">${escapeHTML(req.fullName || req.name || 'New User')}</strong>
                    <small style="color: #64748b; font-size: 11px;">Requested ${escapeHTML(req.role || 'Staff')} access for ${escapeHTML(req.division || 'Office')}</small>
                </div>
            `).join("");

            notificationList.querySelectorAll(".notif-item").forEach(item => {
                item.addEventListener("click", () => {
                    const key = item.getAttribute("data-key");
                    if (key) openReviewModal(key);
                    if (notificationDropdown) notificationDropdown.style.display = "none";
                });
            });
        }
    }
}

// ==========================================================================
// MODAL LOGIC (USER VS ADMIN SELECTION)
// ==========================================================================
function openReviewModal(requestKey) {
    selectedRequest = requestsData.find((r) => r.key === requestKey || r.id === requestKey);
    if (!selectedRequest) return;

    if (reviewReqId) reviewReqId.textContent = selectedRequest.id || selectedRequest.refCode || selectedRequest.key;
    if (reviewDate) reviewDate.textContent = selectedRequest.date || "Recent";
    if (reviewFullName) reviewFullName.textContent = selectedRequest.fullName || selectedRequest.name || "N/A";
    if (reviewEmail) reviewEmail.textContent = selectedRequest.email || "N/A";
    if (reviewContact) reviewContact.textContent = selectedRequest.contact || "N/A";
    if (reviewGovId) reviewGovId.textContent = "Supabase Auth";
    if (reviewPosition) reviewPosition.textContent = selectedRequest.position || "N/A";
    if (reviewDivision) reviewDivision.textContent = selectedRequest.division || "Unassigned";
    if (reviewRole) reviewRole.textContent = selectedRequest.role || "System Staff";
    if (reviewEndorser) reviewEndorser.textContent = selectedRequest.endorser || "None Provided";
    if (reviewReason) reviewReason.textContent = selectedRequest.reason || "None Provided";

    const requestedRole = selectedRequest.role || "System Staff";
    const normalizedRequestedRole = requestedRole === "User" ? "System Staff" : requestedRole;
    const isRequestedAdmin = normalizedRequestedRole.includes("Admin");

    if (assignAccountTypeSelect) {
        assignAccountTypeSelect.value = isRequestedAdmin ? "ADMIN" : "USER";
        updateRoleOptionsByAccountType(assignAccountTypeSelect.value);
    }

    if (assignRoleSelect) {
        assignRoleSelect.value = normalizedRequestedRole;
    }

    reviewModal?.classList.add("open");
    renderIcons();
}

function updateRoleOptionsByAccountType(accountType) {
    if (!assignRoleSelect) return;
    
    if (accountType === "ADMIN") {
        assignRoleSelect.innerHTML = `
            <option value="Super Admin">Super Admin (Full Database & User Control)</option>
            <option value="Admin">System Administrator (Administrative Module Access)</option>
        `;
    } else {
        assignRoleSelect.innerHTML = `
            <option value="System Staff">System Staff (Standard IMS Data Entry)</option>
            <option value="Division Head">Division Head (Document Signatory & Approver)</option>
            <option value="Viewer">Read-Only Viewer (View Office Records Only)</option>
        `;
    }
}

function openDeclineModal(requestKey) {
    selectedRequest = requestsData.find((r) => r.key === requestKey || r.id === requestKey);
    if (!selectedRequest) return;

    if (declineNotesInput) declineNotesInput.value = "";
    declineModal?.classList.add("open");
    renderIcons();
}

function closeAllModals() {
    reviewModal?.classList.remove("open");
    declineModal?.classList.remove("open");
    systemConfirmModal?.classList.remove("open");
}

// ==========================================================================
// DATABASE WRITE OPERATIONS
// ==========================================================================
async function grantAccountAccess(requestObj, confirmedRole, accountType = "USER") {
    const rawRoleToAssign = confirmedRole || requestObj.role || "System Staff";
    const roleToAssign = rawRoleToAssign === "User" ? "System Staff" : rawRoleToAssign;
    const targetKey = requestObj.key || requestObj.id;

    try {
        if (!PGENRO_API?.invokeAdmin) {
            throw new Error("Supabase administrator service is unavailable.");
        }

        await PGENRO_API.invokeAdmin("approve_request", {
            requestId: targetKey,
            userId: requestObj.uid || "",
            role: roleToAssign,
            accountType
        });

        showToast(`Access granted: ${requestObj.fullName || requestObj.name} approved as ${roleToAssign}`);
    } catch (err) {
        console.error("Supabase approval error:", err);
        showToast(`Failed to approve: ${err.message}`);
    }

    closeAllModals();
}

async function declineAccountAccess(requestObj, reason, remarks) {
    const targetKey = requestObj.key || requestObj.id;

    try {
        if (!PGENRO_API?.invokeAdmin) {
            throw new Error("Supabase administrator service is unavailable.");
        }

        await PGENRO_API.invokeAdmin("reject_request", {
            requestId: targetKey,
            userId: requestObj.uid || "",
            reason,
            remarks: remarks || ""
        });

        showToast(`Request for ${requestObj.fullName || requestObj.name} declined.`);
    } catch (err) {
        console.error("Supabase decline error:", err);
        showToast(`Failed to decline: ${err.message}`);
    }

    closeAllModals();
}

// Custom Deletion with System Confirm Dialog
async function deleteAccountRequest(requestKey) {
    const confirmed = await showCustomConfirm({
        title: "Delete Access Request",
        message: "Are you sure you want to permanently delete this request record from the database? This action cannot be undone.",
        confirmText: "Delete Record",
        cancelText: "Cancel",
        type: "danger",
        icon: "trash-2"
    });

    if (!confirmed) return;

    try {
        await remove(ref(db, `access_requests/${requestKey}`));
        showToast("Request record removed from database.");
    } catch (err) {
        console.error("Delete Error:", err);
        showToast(`Failed to delete record: ${err.message}`);
    }
}

// ==========================================================================
// ATTACH ROW ACTIONS & EVENT LISTENERS
// ==========================================================================
function attachRowActions() {
    document.querySelectorAll(".review-btn").forEach((btn) => {
        btn.addEventListener("click", () => openReviewModal(btn.getAttribute("data-key")));
    });

    document.querySelectorAll(".approve-quick-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const key = btn.getAttribute("data-key");
            const req = requestsData.find((r) => r.key === key || r.id === key);
            if (!req) return;

            const confirmed = await showCustomConfirm({
                title: "Grant Account Access",
                message: `Are you sure you want to approve access for ${req.fullName || req.name} as ${req.role || 'Staff'}?`,
                confirmText: "Grant Access",
                cancelText: "Cancel",
                type: "primary",
                icon: "user-check"
            });

            if (confirmed) {
                const isAdmin = (req.role || "").includes("Admin");
                grantAccountAccess(req, req.role, isAdmin ? "ADMIN" : "USER");
            }
        });
    });

    document.querySelectorAll(".reject-quick-btn").forEach((btn) => {
        btn.addEventListener("click", () => openDeclineModal(btn.getAttribute("data-key")));
    });

    document.querySelectorAll(".delete-req-btn").forEach((btn) => {
        btn.addEventListener("click", () => deleteAccountRequest(btn.getAttribute("data-key")));
    });

    document.querySelectorAll(".row-checkbox").forEach((cb) => {
        cb.addEventListener("change", updateBulkActionButtons);
    });
}

function updateBulkActionButtons() {
    const checkedCount = document.querySelectorAll(".row-checkbox:checked").length;
    if (bulkApproveBtn) bulkApproveBtn.disabled = checkedCount === 0;
    if (bulkRejectBtn) bulkRejectBtn.disabled = checkedCount === 0;
}

function setupEventListeners() {
    requestSearchInput?.addEventListener("input", filterAndRender);
    globalSearchInput?.addEventListener("input", filterAndRender);
    divisionFilterSelect?.addEventListener("change", filterAndRender);
    statusFilterSelect?.addEventListener("change", filterAndRender);

    assignAccountTypeSelect?.addEventListener("change", (e) => {
        updateRoleOptionsByAccountType(e.target.value);
    });

    selectAllCheckbox?.addEventListener("change", (e) => {
        document.querySelectorAll(".row-checkbox").forEach((cb) => {
            cb.checked = e.target.checked;
        });
        updateBulkActionButtons();
    });

    bulkApproveBtn?.addEventListener("click", async () => {
        const checked = Array.from(document.querySelectorAll(".row-checkbox:checked"));
        if (checked.length === 0) return;

        const confirmed = await showCustomConfirm({
            title: "Bulk Approve Requests",
            message: `Are you sure you want to approve all ${checked.length} selected access request(s)?`,
            confirmText: "Approve All",
            cancelText: "Cancel",
            type: "primary",
            icon: "check-circle-2"
        });

        if (confirmed) {
            for (const cb of checked) {
                const key = cb.getAttribute("data-key");
                const req = requestsData.find((r) => r.key === key || r.id === key);
                if (req) {
                    const isAdmin = (req.role || "").includes("Admin");
                    await grantAccountAccess(req, req.role, isAdmin ? "ADMIN" : "USER");
                }
            }
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            updateBulkActionButtons();
        }
    });

    bulkRejectBtn?.addEventListener("click", async () => {
        const checked = Array.from(document.querySelectorAll(".row-checkbox:checked"));
        if (checked.length === 0) return;

        const confirmed = await showCustomConfirm({
            title: "Bulk Decline Requests",
            message: `Are you sure you want to decline all ${checked.length} selected request(s)?`,
            confirmText: "Decline All",
            cancelText: "Cancel",
            type: "danger",
            icon: "user-x"
        });

        if (confirmed) {
            for (const cb of checked) {
                const key = cb.getAttribute("data-key");
                const req = requestsData.find((r) => r.key === key || r.id === key);
                if (req) await declineAccountAccess(req, "Declined via Bulk Review", "Bulk decline action by admin");
            }
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            updateBulkActionButtons();
        }
    });

    closeReviewModalBtn?.addEventListener("click", closeAllModals);
    closeDeclineModalBtn?.addEventListener("click", closeAllModals);
    cancelDeclineModalBtn?.addEventListener("click", closeAllModals);

    approveModalActionBtn?.addEventListener("click", () => {
        if (!selectedRequest) return;
        const accountType = assignAccountTypeSelect?.value || "USER";
        const role = assignRoleSelect?.value || selectedRequest.role;
        grantAccountAccess(selectedRequest, role, accountType);
    });

    declineModalActionBtn?.addEventListener("click", () => {
        reviewModal?.classList.remove("open");
        declineModal?.classList.add("open");
    });

    confirmDeclineBtn?.addEventListener("click", () => {
        if (!selectedRequest) return;
        const reason = declineReasonSelect?.value || "Unverified credentials";
        const notes = declineNotesInput?.value || "";
        declineAccountAccess(selectedRequest, reason, notes);
    });
}

function setupUIInteractions() {
    profileBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (profileDropdown) profileDropdown.style.display = profileDropdown.style.display === "block" ? "none" : "block";
        if (notificationDropdown) notificationDropdown.style.display = "none";
    });

    notificationsBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        if (notificationDropdown) notificationDropdown.style.display = notificationDropdown.style.display === "block" ? "none" : "block";
        if (profileDropdown) profileDropdown.style.display = "none";
    });

    document.addEventListener("click", () => {
        if (profileDropdown) profileDropdown.style.display = "none";
        if (notificationDropdown) notificationDropdown.style.display = "none";
    });

    mobileMenuBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        sidebar?.classList.toggle("mobile-open");
    });

    sidebarCollapseBtn?.addEventListener("click", () => {
        sidebar?.classList.toggle("collapsed");
    });

    logoutBtn?.addEventListener("click", async () => {
        const confirmed = await showCustomConfirm({
            title: "Sign Out",
            message: "Are you sure you want to log out of the admin panel?",
            confirmText: "Sign Out",
            cancelText: "Stay Logged In",
            type: "danger",
            icon: "log-out"
        });

        if (confirmed) {
            await signOut(auth);
            window.location.href = "../User/login.html";
        }
    });

    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            (requestSearchInput || globalSearchInput)?.focus();
        }
    });
}

function updateAdminProfileUI(admin) {
    const userNameEl = document.getElementById("currentUserName");
    const userRoleEl = document.getElementById("currentUserRole");
    const dropdownNameEl = document.getElementById("dropdownUserName");
    const dropdownEmailEl = document.getElementById("dropdownUserEmail");
    const dropdownRoleEl = document.getElementById("dropdownUserRole");

    if (userNameEl) userNameEl.textContent = admin.name;
    if (userRoleEl) userRoleEl.textContent = admin.role || "Super Admin";
    if (dropdownNameEl) dropdownNameEl.textContent = admin.name;
    if (dropdownEmailEl) dropdownEmailEl.textContent = admin.email;
    if (dropdownRoleEl) dropdownRoleEl.textContent = admin.role || "Super Admin";
}

// ==========================================================================
// UTILITY FUNCTIONS
// ==========================================================================
function renderIcons() {
    if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
        lucide.createIcons();
    }
}

function showToast(msg) {
    if (!toast || !toastMessage) return;
    toastMessage.textContent = msg;
    toast.classList.add("show");
    renderIcons();
    setTimeout(() => toast.classList.remove("show"), 3500);
}

function getAvatarColor(role) {
    if (role === "Super Admin" || role === "Admin") return "purple";
    if (role === "Division Head") return "blue";
    return "emerald";
}

function escapeHTML(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}