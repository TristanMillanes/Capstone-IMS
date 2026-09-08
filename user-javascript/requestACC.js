// =========================================================================
// PGENRO IMS - REQUEST ACCOUNT PORTAL SCRIPT
// Features: Firebase Submission, Live Dossier Review, Natural Step Flow
// =========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import {
    getDatabase,
    ref,
    set,
    push
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// =========================================================================
// FIREBASE CONFIGURATION
// =========================================================================
const firebaseConfig = {
    apiKey: "AIzaSyAwiRrYub7tl1EXwehKbsCjfwQiyGKxiyE",
    authDomain: "ims-capstone-bc65f.firebaseapp.com",
    databaseURL: "https://ims-capstone-bc65f-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ims-capstone-bc65f",
    storageBucket: "ims-capstone-bc65f.firebasestorage.app",
    messagingSenderId: "972207120140",
    appId: "1:972207120140:web:6a94e2e1e9e8511e933329",
    measurementId: "G-W4TPE7CHC8"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// =========================================================================
// CONSTANTS & STATE
// =========================================================================
const DRAFT_KEY = "pgenro_applicant_draft_v2";

const DRAFT_FIELDS = [
    "fullName",
    "email",
    "contact",
    "govId",
    "position",
    "division",
    "role",
    "endorser",
    "reason",
    "endorsementCheck",
    "agree"
];

let currentPage = 1;
let isSubmitting = false;

// =========================================================================
// DOM & ICON HELPERS
// =========================================================================
const getField = (id) => document.getElementById(id);
const icon = (name) => `<i data-lucide="${name}"></i>`;

function renderIcons() {
    if (window.lucide?.createIcons) {
        window.lucide.createIcons();
    }
}

// Keep the visual role cards and hidden native select perfectly in sync
function syncRoleChoices(value = getField("role")?.value ?? "") {
    document.querySelectorAll(".role-choice").forEach((choice) => {
        const selected = choice.dataset.role === value;
        choice.setAttribute("aria-pressed", selected ? "true" : "false");
    });
}

// =========================================================================
// TOAST NOTIFICATIONS
// =========================================================================
function showToast(message, type = "error") {
    const container = getField("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        ${icon(type === "success" ? "check-circle" : "alert-circle")}
        <span>${message}</span>
    `;

    container.appendChild(toast);
    renderIcons();

    requestAnimationFrame(() => toast.classList.add("show"));

    window.setTimeout(() => {
        toast.classList.remove("show");
        window.setTimeout(() => toast.remove(), 300);
    }, 4200);
}

// =========================================================================
// LIVE STATUS MESSAGING
// =========================================================================
function setSaveStatus(message, saving = false) {
    const status = getField("saveStatus");
    const controlStatus = getField("controlStatus");

    if (status) {
        status.innerHTML = `
            ${icon(saving ? "loader-2" : "cloud")}
            <span>${message}</span>
        `;
        if (saving) status.querySelector("svg")?.classList.add("spin");
    }

    if (controlStatus) {
        controlStatus.innerHTML = `
            ${icon(saving ? "loader-2" : "check-circle-2")}
            <span>${message}</span>
        `;
        if (saving) controlStatus.querySelector("svg")?.classList.add("spin");
    }

    renderIcons();
}

// =========================================================================
// STEP 3: DOSSIER LIVE PREVIEW GENERATOR
// =========================================================================
function updateLiveSummary() {
    const name = getField("fullName")?.value.trim() || "--";
    const govId = getField("govId")?.value.trim() || "--";
    const division = getField("division")?.value || "--";
    const position = getField("position")?.value || "--";
    const role = getField("role")?.value || "Unassigned";

    if (getField("sumName")) getField("sumName").textContent = name;
    if (getField("sumId")) getField("sumId").textContent = govId;
    if (getField("sumDivision")) getField("sumDivision").textContent = division;
    if (getField("sumPosition")) getField("sumPosition").textContent = position;

    const badge = getField("summaryRoleBadge");
    if (badge) {
        badge.textContent = `Clearance Tier: ${role}`;
        badge.style.color = role === "Admin" ? "#d97706" : "#0a4d37";
        badge.style.background = role === "Admin" ? "#fef3c7" : "#d1fae5";
    }
}

// =========================================================================
// DRAFT MANAGEMENT
// =========================================================================
function serializeDraft() {
    const draft = { currentPage };
    DRAFT_FIELDS.forEach((id) => {
        const el = getField(id);
        if (!el) return;
        draft[id] = el.type === "checkbox" ? el.checked : el.value;
    });
    return draft;
}

function saveDraft() {
    if (!window.form || isSubmitting) return;

    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeDraft()));

        const hasContent = DRAFT_FIELDS.some((id) => {
            const el = getField(id);
            if (!el) return false;
            return el.type === "checkbox" ? el.checked : el.value.trim() !== "";
        });

        setSaveStatus(hasContent ? "Draft autosaved to device." : "Draft autosave active.");
    } catch (err) {
        console.warn("Autosave unavailable:", err);
    }
}

function scheduleDraftSave() {
    window.clearTimeout(scheduleDraftSave.timer);
    setSaveStatus("Saving changes…", true);
    scheduleDraftSave.timer = window.setTimeout(saveDraft, 350);
}

function hasDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return false;
        const draft = JSON.parse(raw);
        return DRAFT_FIELDS.some((id) => {
            if (!(id in draft)) return false;
            return typeof draft[id] === "boolean" ? draft[id] : String(draft[id]).trim() !== "";
        });
    } catch {
        return false;
    }
}

function restoreDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const draft = JSON.parse(raw);

        DRAFT_FIELDS.forEach((id) => {
            const el = getField(id);
            if (!el || !(id in draft)) return;
            if (el.type === "checkbox") {
                el.checked = Boolean(draft[id]);
            } else {
                el.value = draft[id] ?? "";
            }
        });

        syncRoleChoices();
        currentPage = Math.min(Math.max(Number(draft.currentPage) || 1, 1), 3);

        updatePasswordStrength();
        updateCharCounter();
        clearValidationVisuals();
        window.updateUI();

        const banner = getField("draftBanner");
        if (banner) banner.style.display = "none";

        setSaveStatus("Draft recovered. Please re-enter passwords for security.");
        showToast("Application draft restored.", "success");
    } catch (err) {
        console.warn("Failed to restore draft:", err);
        showToast("Unable to restore draft session.", "error");
    }
}

function discardDraft() {
    localStorage.removeItem(DRAFT_KEY);
    const banner = getField("draftBanner");
    if (banner) banner.style.display = "none";
    setSaveStatus("Draft session discarded.");
    showToast("Cached application draft cleared.", "success");
}

// =========================================================================
// DATE & INTERACTION HELPERS
// =========================================================================
function initDate() {
    const el = getField("currentDate");
    if (!el) return;
    const now = new Date();
    el.textContent = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric"
    }).format(now);
}

// Organic 4-segment Password Strength Gauge
function updatePasswordStrength() {
    const val = getField("password")?.value ?? "";
    const seg1 = getField("pwSeg1");
    const seg2 = getField("pwSeg2");
    const seg3 = getField("pwSeg3");
    const seg4 = getField("pwSeg4");
    const text = getField("passwordStrengthText");

    if (!seg1 || !text) return;

    let score = 0;
    if (val.length >= 6) score++;
    if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val) && val.length >= 8) score++;

    const segments = [seg1, seg2, seg3, seg4];
    segments.forEach((seg, i) => {
        if (i < score) {
            if (score === 1) seg.style.background = "#f87171"; // Red
            else if (score === 2) seg.style.background = "#fbbf24"; // Amber
            else if (score === 3) seg.style.background = "#34d399"; // Green
            else seg.style.background = "#059669"; // Deep Emerald
        } else {
            seg.style.background = "#e2ece6";
        }
    });

    const labels = [
        "Use 6+ letters with mixed digits & symbols.",
        "Seedling (Weak) — Add numbers & uppercase letters.",
        "Sapling (Fair) — Include special symbols.",
        "Hardwood (Strong) — Excellent credential entropy.",
        "Deep Root Canopy (Very Strong) — Optimal security."
    ];
    text.textContent = labels[score];
}

function updateCharCounter() {
    const reason = getField("reason");
    const counter = getField("charCount");
    if (!reason || !counter) return;

    const len = reason.value.length;
    counter.textContent = `${len} / 250`;
    counter.style.color = len >= 230 ? "#d97706" : "#7e968c";
}

// =========================================================================
// VALIDATION LOGIC
// =========================================================================
function setFieldError(input, message) {
    if (!input) return;
    input.classList.add("invalid-field");

    const err = getField(`${input.id}Error`);
    if (err) err.textContent = message;
}

function clearFieldError(input) {
    if (!input) return;
    input.classList.remove("invalid-field");

    const err = getField(`${input.id}Error`);
    if (err) err.textContent = "";
}

function validateField(input) {
    if (!input) return true;

    // Confirm Password
    if (input.id === "confirmPassword") {
        if (input.value.length === 0) {
            setFieldError(input, "Please confirm your password.");
            return false;
        }
        if (input.value !== getField("password")?.value) {
            setFieldError(input, "Passwords do not match.");
            return false;
        }
    }

    // Checkboxes
    if (input.type === "checkbox") {
        if (!input.checked) {
            setFieldError(
                input,
                input.id === "agree"
                    ? "You must accept environmental data privacy protocols."
                    : "Endorsement memo confirmation is mandatory."
            );
            return false;
        }
        clearFieldError(input);
        return true;
    }

    // Native HTML5 Rules
    if (!input.checkValidity()) {
        if (input.id === "role") {
            setFieldError(input, "Please select an access clearance role.");
        } else if (input.validity.valueMissing) {
            setFieldError(input, "This field is required.");
        } else if (input.id === "email") {
            setFieldError(input, "Enter a valid official email address.");
        } else if (input.id === "contact") {
            setFieldError(input, "Enter an 11-digit Philippine mobile number starting with 09.");
        } else if (input.id === "password") {
            setFieldError(input, "Password must be at least 6 characters.");
        } else {
            setFieldError(input, "Please review this entry.");
        }
        return false;
    }

    clearFieldError(input);
    return true;
}

function validatePage(pageNum) {
    const page = getField(`page${pageNum}`);
    if (!page) return true;

    let valid = true;
    const invalids = [];

    page.querySelectorAll("input[required], select[required], textarea[required]").forEach((el) => {
        if (!validateField(el)) {
            valid = false;
            invalids.push(el);
        }
    });

    if (pageNum === 1) {
        const pw = getField("password");
        const cpw = getField("confirmPassword");
        if (pw && cpw && pw.value !== cpw.value) {
            setFieldError(cpw, "Passwords do not match.");
            valid = false;
            invalids.push(cpw);
        }
    }

    if (!valid && invalids[0]) {
        invalids[0].focus({ preventScroll: true });
    }

    return valid;
}

function clearValidationVisuals() {
    window.form?.querySelectorAll(".invalid-field").forEach((el) => el.classList.remove("invalid-field"));
    window.form?.querySelectorAll(".error-msg").forEach((err) => (err.textContent = ""));
}

// =========================================================================
// INITIALIZATION
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
    initDate();
    renderIcons();

    const form = getField("accessForm");
    if (!form) return;
    window.form = form;

    const pages = document.querySelectorAll(".form-page");
    const steps = document.querySelectorAll(".step");
    const roleChoices = document.querySelectorAll(".role-choice");
    const nextBtn = getField("nextBtn");
    const backBtn = getField("backBtn");
    const submitBtn = getField("submitBtn");
    const progressBar = getField("stepperProgress");
    const progressLabel = getField("progressLabel");
    const progressHint = getField("progressHint");
    const modal = getField("privacyModal");

    const totalPages = pages.length;

    const stepHints = [
        "Personal Identification & Security",
        "Division Assignment & Clearance Tier",
        "Operational Intent & Verification"
    ];

    // Core UI Transition Routine
    window.updateUI = function () {
        pages.forEach((page, idx) => {
            const active = idx + 1 === currentPage;
            page.style.display = active ? "flex" : "none";
            page.classList.toggle("active", active);
        });

        steps.forEach((step, idx) => {
            const num = idx + 1;
            const active = num === currentPage;
            const completed = num < currentPage;

            step.classList.toggle("active", active);
            step.classList.toggle("completed", completed);
            step.setAttribute("aria-current", active ? "step" : "false");
            step.disabled = num > currentPage;
        });

        const progressPercent = totalPages > 1 ? ((currentPage - 1) / (totalPages - 1)) * 100 : 0;
        if (progressBar) progressBar.style.width = `${progressPercent}%`;
        if (progressLabel) progressLabel.textContent = `Step ${currentPage} of ${totalPages}`;
        if (progressHint) progressHint.textContent = stepHints[currentPage - 1];

        if (backBtn) backBtn.style.visibility = currentPage === 1 ? "hidden" : "visible";
        if (nextBtn) nextBtn.style.display = currentPage === totalPages ? "none" : "inline-flex";
        if (submitBtn) submitBtn.style.display = currentPage === totalPages ? "inline-flex" : "none";

        if (currentPage === 3) updateLiveSummary();

        renderIcons();
    };

    // Form Field Listeners
    form.querySelectorAll("input[required], select[required], textarea[required]").forEach((input) => {
        input.addEventListener("input", () => {
            if (input.classList.contains("invalid-field")) validateField(input);
            if (input.id === "password") updatePasswordStrength();
            if (input.id === "confirmPassword" && input.value) validateField(input);
            if (input.id === "reason") updateCharCounter();
            scheduleDraftSave();
        });

        input.addEventListener("change", () => {
            if (input.classList.contains("invalid-field")) validateField(input);
            scheduleDraftSave();
        });
    });

    // Role Tier Cards Selection
    roleChoices.forEach((card) => {
        card.addEventListener("click", () => {
            const roleInput = getField("role");
            if (!roleInput) return;

            roleInput.value = card.dataset.role;
            syncRoleChoices(roleInput.value);
            clearFieldError(roleInput);
            scheduleDraftSave();
        });
    });

    // Stepper Button Clicks
    steps.forEach((step) => {
        step.addEventListener("click", () => {
            const target = Number(step.dataset.step);
            if (target < currentPage) {
                currentPage = target;
                window.updateUI();
            }
        });
    });

    // Next / Previous Navigation
    nextBtn?.addEventListener("click", () => {
        if (!validatePage(currentPage)) {
            showToast("Please complete the required environmental fields.", "error");
            return;
        }
        if (currentPage < totalPages) {
            currentPage++;
            scheduleDraftSave();
            window.updateUI();
            getField(`page${currentPage}`)?.scrollTo({ top: 0, behavior: "smooth" });
        }
    });

    backBtn?.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            scheduleDraftSave();
            window.updateUI();
            getField(`page${currentPage}`)?.scrollTo({ top: 0, behavior: "smooth" });
        }
    });

    // Password Eye Toggles
    const setupPasswordToggle = (btnId, inputId) => {
        getField(btnId)?.addEventListener("click", () => {
            const input = getField(inputId);
            const btn = getField(btnId);
            if (!input || !btn) return;

            const isPw = input.type === "password";
            input.type = isPw ? "text" : "password";
            btn.innerHTML = icon(isPw ? "eye-off" : "eye");
            btn.setAttribute("aria-label", isPw ? "Hide password" : "Show password");
            renderIcons();
        });
    };
    setupPasswordToggle("togglePasswordBtn", "password");
    setupPasswordToggle("toggleConfirmPasswordBtn", "confirmPassword");

    // Modal Events
    getField("openPrivacyBtn")?.addEventListener("click", () => modal?.showModal());
    getField("closePrivacyBtn")?.addEventListener("click", () => modal?.close());
    getField("acceptPrivacyBtn")?.addEventListener("click", () => {
        const agree = getField("agree");
        if (agree) {
            agree.checked = true;
            agree.dispatchEvent(new Event("change", { bubbles: true }));
        }
        modal?.close();
        showToast("Environmental data privacy obligations accepted.", "success");
    });

    // Draft Actions
    getField("restoreDraftBtn")?.addEventListener("click", restoreDraft);
    getField("discardDraftBtn")?.addEventListener("click", discardDraft);

    // =====================================================================
    // FORM SUBMISSION TO FIREBASE
    // =====================================================================
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        // Validate all 3 pages
        for (let i = 1; i <= totalPages; i++) {
            if (!validatePage(i)) {
                currentPage = i;
                window.updateUI();
                showToast(`Please complete required entries in Section 0${i}.`, "error");
                return;
            }
        }

        if (isSubmitting) return;
        isSubmitting = true;

        const originalBtnHtml = submitBtn.innerHTML;
        submitBtn.disabled = true;
        if (backBtn) backBtn.disabled = true;

        submitBtn.innerHTML = `
            ${icon("loader-2")}
            <span>Transmitting Clearance…</span>
        `;
        submitBtn.querySelector("svg")?.classList.add("spin");
        setSaveStatus("Routing application to PGENRO Admin…", true);

        // Generate Audit Request Code
        const refCode = `REQ-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const now = new Date();
        const formattedDate = now.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });

        // Construct Database Payload
        const payload = {
            id: refCode,
            fullName: getField("fullName")?.value.trim(),
            email: getField("email")?.value.trim().toLowerCase(),
            contact: getField("contact")?.value.trim(),
            govId: getField("govId")?.value.trim(),
            password: getField("password")?.value,
            position: getField("position")?.value,
            division: getField("division")?.value,
            role: getField("role")?.value,
            endorser: getField("endorser")?.value.trim() || "N/A",
            reason: getField("reason")?.value.trim() || "N/A",
            status: "Pending",
            timestamp: Date.now(),
            date: formattedDate
        };

        try {
            const reqRef = push(ref(db, "access_requests"));
            await set(reqRef, payload);

            // Clean up session
            localStorage.removeItem(DRAFT_KEY);
            form.reset();
            syncRoleChoices();
            clearValidationVisuals();
            updatePasswordStrength();
            updateCharCounter();
            currentPage = 1;
            window.updateUI();

            setSaveStatus("Request officially logged.");
            showToast(`Clearance packet ${refCode} submitted for approval.`, "success");

            if (getField("controlStatus")) {
                getField("controlStatus").innerHTML = `
                    <i data-lucide="check-circle-2"></i> Transmitted &bull; Reference ${refCode}
                `;
            }
        } catch (err) {
            console.error("Firebase transmission error:", err);
            showToast(`Submission failed: ${err.message || "Network error."}`, "error");
            setSaveStatus("Submission failed. Your draft is still saved.");
        } finally {
            isSubmitting = false;
            submitBtn.disabled = false;
            if (backBtn) backBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;
            renderIcons();
        }
    });

    // Check on startup for previous draft
    if (hasDraft()) {
        const banner = getField("draftBanner");
        if (banner) banner.style.display = "flex";
        setSaveStatus("Previous draft found.");
    }

    updatePasswordStrength();
    updateCharCounter();
    window.updateUI();
});