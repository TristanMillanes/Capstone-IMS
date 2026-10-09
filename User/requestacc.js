/* ==========================================================================
   SELF-CONTAINED SUPABASE BOOTSTRAP
   Database client, access checks, profile sync, and logout for this page.
   ========================================================================== */
(() => {
  "use strict";
  if (window.pgenroSupabase) return;
  const config = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP"
  });
  const sdkReady = typeof window.supabase?.createClient === "function";
  async function requestWithTimeout(input, options = {}) {
    const controller = new AbortController();
    const signal = options.signal || (input instanceof Request ? input.signal : null);
    const relay = () => controller.abort(signal?.reason);
    if (signal?.aborted) relay();
    else signal?.addEventListener("abort", relay, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 20000);
    try { return await fetch(input, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", relay); }
  }
  const client = sdkReady
    ? window.supabase.createClient(config.url, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        },
        global: { fetch: requestWithTimeout }
      })
    : null;
  window.PGENRO_SUPABASE = Object.freeze({
    ...config,
    sdkReady,
    configured: Boolean(client)
  });
  window.pgenroSupabase = client;
  const adminRoles = new Set([
    "admin",
    "administrator",
    "super admin",
    "superadmin",
    "system administrator"
  ]);
  const normalizeRole = (role) => String(role || "").trim().toLowerCase().replace(/\s+/g, " ");
  async function getCurrentProfile() {
    if (!client) return null;
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionData?.session?.user;
    if (!user) return null;
    const { data: profile, error } = await client
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    return profile ? { ...profile, authUser: user } : null;
  }
  async function requireApprovedUser() {
    const profile = await getCurrentProfile();
    if (!profile) throw new Error("No active PGENRO account session was found.");
    const status = String(profile.status || "").trim().toLowerCase();
    if (profile.is_active !== true || !["active", "approved"].includes(status)) {
      throw new Error("Account access is " + (profile.status || "inactive") + ".");
    }
    return profile;
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
  async function signOut({ ask = true } = {}) {
    if (ask && !(await showLogoutDialog())) return false;
    try {
      await client?.auth.signOut();
    } catch (error) {
      console.warn("Remote sign-out was unavailable:", error);
    }
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("sb-") || key.startsWith("pgenro_")) localStorage.removeItem(key);
      }
      sessionStorage.clear();
    } catch {}
    window.location.assign("login.html");
    return true;
  }
  window.PGENRO_API = Object.freeze({
    client,
    getCurrentProfile,
    requireApprovedUser,
    signOut,
    isAdminRole: (role) => adminRoles.has(normalizeRole(role))
  });
  window.PGENRO_DB = Object.freeze({
    client,
    table: "visitors",
    configured: Boolean(client),
    async getSession() {
      if (!client) return null;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session || null;
    },
    async getCurrentRole() {
      const profile = await getCurrentProfile();
      if (!profile) return null;
      return adminRoles.has(normalizeRole(profile.role)) ? "admin" : "user";
    }
  });
  const cacheProfile = (profile) => {
    if (!profile) return;
    const cached = {
      uid: profile.user_id,
      id: profile.user_id,
      fullName: profile.full_name || profile.username || "",
      username: profile.username || "",
      email: profile.email || profile.authUser?.email || "",
      contact: profile.contact || "",
      position: profile.position || "",
      division: profile.division || "",
      role: profile.role || "System Staff",
      accountType: profile.account_type || "Standard User",
      status: profile.status || "Active"
    };
    try {
      localStorage.setItem("pgenro_current_user", JSON.stringify(cached));
      sessionStorage.setItem("pgenro_session_active", "true");
      sessionStorage.setItem("pgenro_session_token", String(profile.user_id));
    } catch {}
    document.dispatchEvent(new CustomEvent("pgenro:profile-updated", { detail: cached }));
  };
  async function guardPage() {
    if (!document.body?.dataset.requiresAuth) return;
    if (!client) return;
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        window.location.replace("login.html");
        return;
      }
      cacheProfile(await requireApprovedUser());
    } catch (error) {
      console.error("Unable to verify this PGENRO session:", error);
    }
  }
  document.addEventListener("click", (event) => {
    const logout = event.target instanceof Element
      ? event.target.closest("#logoutBtn,[data-pgenro-logout]")
      : null;
    if (!logout) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    signOut();
  }, true);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", guardPage, { once: true });
  } else {
    queueMicrotask(guardPage);
  }
})();
// =========================================================================
// PGENRO IMS - REQUEST ACCOUNT PORTAL SCRIPT
// Features: Supabase Auth Submission, Live Dossier Review, Natural Step Flow
// =========================================================================
// =========================================================================
// SUPABASE AUTH + REQUEST SUBMISSION
// Supabase is initialized by this file's self-contained bootstrap.
// =========================================================================
const supabase = window.pgenroSupabase;
// =========================================================================
// CONSTANTS & STATE
// =========================================================================
const DRAFT_KEY = "pgenro_applicant_draft_v2";
const DRAFT_FIELDS = [
    "fullName",
    "email",
    "contact",
    "position",
    "division",
    "role",
    "endorser",
    "reason",
    "endorsementCheck",
    "agree"
];
let currentPage = 1;
let renderedPage = 1;
let isSubmitting = false;
// =========================================================================
// DOM & ICON HELPERS
// =========================================================================
const getField = (id) => document.getElementById(id);
const icon = (name) => `<i data-lucide="${name}"></i>`;
const iconPaths = {
    leaf: '<path d="M20 3C11 3 4 7 4 14a6 6 0 0 0 6 6c7 0 10-8 10-17Zm-17 18L15 9"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    'user-check': '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 12-4.9m2 .9 3 3 5-6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7l.5 3-2 2a16 16 0 0 0 6.7 6.7l2-2 3 .5a2 2 0 0 1 1.7 2Z"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="m3 3 18 18M10.6 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.5 6.5A19 19 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/>',
    'shield-check': '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    briefcase: '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V4h8v3M3 12c6 4 12 4 18 0m-9 0v4"/>',
    building: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    'check-circle-2': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    'file-check': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6m-12 6 3 3 5-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
    'arrow-right': '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    'arrow-left': '<path d="M19 12H5m6-6-6 6 6 6"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2"/>',
    'pen-tool': '<path d="m16 3 5 5-12 12H4v-5ZM13 6l5 5"/>',
    x: '<path d="m6 6 12 12M6 18 18 6"/>',
    cloud: '<path d="M18 18a4 4 0 0 0 0-8h-1a6 6 0 0 0-11-2 5 5 0 0 0-1 10Z"/>',
    'archive-restore': '<rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v14h14V7M9 12l3-3 3 3m-3-3v8"/>',
    'rotate-ccw': '<path d="M3 11a9 9 0 1 1 2.7 7M3 4v7h7"/>',
    'trash-2': '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    'loader-2': '<path d="M21 12a9 9 0 1 1-9-9"/>'
};
iconPaths['check-circle'] = iconPaths['check-circle-2'];
iconPaths['badge-check'] = iconPaths['check-circle-2'];
function renderIcons() {
    document.querySelectorAll("i[data-lucide]").forEach(node => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.setAttribute("class", `request-icon ${node.className || ""}`.trim());
        svg.innerHTML = iconPaths[node.dataset.lucide] || iconPaths.info;
        node.replaceWith(svg);
    });
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
    toast.innerHTML = icon(type === "success" ? "check-circle" : "alert-circle");
    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);
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
    if (saving) [status, controlStatus].forEach(el => el?.querySelector("svg")?.classList.add("spin"));
    [status, controlStatus].forEach((el) => {
        if (!el) return;
        el.classList.remove("status-pulse");
        void el.offsetWidth;
        el.classList.add("status-pulse");
    });
}
// =========================================================================
// STEP 3: DOSSIER LIVE PREVIEW GENERATOR
// =========================================================================
function updateLiveSummary() {
    const name = getField("fullName")?.value.trim() || "--";
    const officialEmail = getField("email")?.value.trim() || "--";
    const division = getField("division")?.value || "--";
    const position = getField("position")?.value || "--";
    const role = getField("role")?.value || "Unassigned";
    if (getField("sumName")) getField("sumName").textContent = name;
    if (getField("sumId")) getField("sumId").textContent = officialEmail;
    if (getField("sumDivision")) getField("sumDivision").textContent = division;
    if (getField("sumPosition")) getField("sumPosition").textContent = position;
    const badge = getField("summaryRoleBadge");
    if (badge) {
        badge.textContent = `Requested: ${role}`;
        badge.style.color = role === "Admin" ? "#8c4b12" : "#0a4d37";
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
        setSaveStatus(hasContent ? "Draft saved on this device · Passwords excluded" : "Passwords are not saved in drafts.");
    } catch (err) {
        console.warn("Autosave unavailable:", err);
        setSaveStatus("Draft saving is unavailable in this browser.");
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
        currentPage = 1; // Passwords are excluded from drafts and must be entered again.
        updatePasswordStrength();
        updateCharCounter();
        clearValidationVisuals();
        DRAFT_FIELDS.forEach((id) => updateFieldCompletion(getField(id)));
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
    try { localStorage.removeItem(DRAFT_KEY); } catch { showToast("Draft storage is unavailable in this browser."); return; }
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
    const labels = ["At least 6 characters", "Weak · Add numbers or capitals", "Fair · Add a symbol", "Strong password", "Very strong password"];
    text.textContent = labels[score];
}
function updateCharCounter() {
    const reason = getField("reason");
    const counter = getField("charCount");
    if (!reason || !counter) return;
    const len = reason.value.length;
    counter.textContent = `${len} / 250`;
    counter.style.color = len >= 230 ? "#8c4b12" : "#607265";
}
// =========================================================================
// VALIDATION LOGIC
// =========================================================================
function setFieldError(input, message) {
    if (!input) return;
    input.classList.add("invalid-field");
    input.setAttribute("aria-invalid", "true");
    const err = getField(`${input.id}Error`);
    if (err) err.textContent = message;
}
function clearFieldError(input) {
    if (!input) return;
    input.classList.remove("invalid-field");
    input.removeAttribute("aria-invalid");
    const err = getField(`${input.id}Error`);
    if (err) err.textContent = "";
}
function validateField(input) {
    if (!input) return true;
    if (["fullName", "endorser", "reason"].includes(input.id) && !input.value.trim()) {
        setFieldError(input, "This field is required."); return false;
    }
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
                    ? "Please accept the privacy and account-use notice."
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
            setFieldError(input, "Please choose a requested system.");
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
        if (pageNum === currentPage) focusInvalidField(pageNum);
    }
    return valid;
}
function clearValidationVisuals() {
    window.form?.querySelectorAll(".invalid-field").forEach((el) => { el.classList.remove("invalid-field"); el.removeAttribute("aria-invalid"); });
    window.form?.querySelectorAll(".error-msg").forEach((err) => (err.textContent = ""));
}
// =========================================================================
// PREMIUM UI / MOTION HELPERS
// =========================================================================
function initLoadingScreen() {
    document.body.classList.remove("is-loading");
    document.body.classList.add("app-ready");
    getField("appLoader")?.remove();
}
function focusInvalidField(pageNum) {
    const invalid = getField(`page${pageNum}`)?.querySelector(".invalid-field");
    const target = invalid?.id === "role" ? document.querySelector(".role-choice") : invalid;
    requestAnimationFrame(() => {
        target?.focus({ preventScroll: true });
        const rect = target?.getBoundingClientRect();
        if (rect && (rect.top < 20 || rect.bottom > innerHeight - 40)) target.scrollIntoView({ block: "center", behavior: "auto" });
    });
}
function focusPageHeading() {
    const heading = getField(`page${currentPage}`)?.querySelector("h3");
    requestAnimationFrame(() => {
        heading?.focus({ preventScroll: true });
        const rect = heading?.getBoundingClientRect();
        if (rect && (rect.top < 20 || rect.bottom > innerHeight - 60)) heading.scrollIntoView({ block: "start", behavior: "auto" });
    });
}
function initRequestMotion() {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = navigator.connection;
    let pageHidden = false;
    const update = () => { document.body.dataset.motion = reduced.matches || connection?.saveData || document.hidden || pageHidden || getField("accessForm")?.contains(document.activeElement) ? "paused" : "running"; };
    reduced.addEventListener?.("change", update);
    connection?.addEventListener?.("change", update);
    document.addEventListener("visibilitychange", update);
    document.addEventListener("focusin", event => {
        if (event.target?.closest?.(".app-shell")) document.body.dataset.entry = "complete";
        update();
    });
    document.addEventListener("focusout", () => queueMicrotask(update));
    window.addEventListener("pagehide", () => { pageHidden = true; update(); });
    window.addEventListener("pageshow", () => { pageHidden = false; update(); });
    document.querySelectorAll("[data-seal]").forEach(image => {
        const fallback = () => image.parentElement.classList.add("logo-fallback");
        image.addEventListener("error", fallback);
        if (image.complete && !image.naturalWidth) fallback();
    });
    update();
}
function animateActivePage(direction = "forward") {
    const page = getField(`page${currentPage}`);
    if (!page) return;
    page.classList.remove("page-enter-forward", "page-enter-back");
    void page.offsetWidth;
    page.classList.add(direction === "back" ? "page-enter-back" : "page-enter-forward");
    window.setTimeout(() => {
        page.classList.remove("page-enter-forward", "page-enter-back");
    }, 520);
}
function pulseCurrentStep() {
    const currentStep = document.querySelector(`.step[data-step="${currentPage}"]`);
    if (!currentStep) return;
    currentStep.classList.remove("step-pulse");
    void currentStep.offsetWidth;
    currentStep.classList.add("step-pulse");
    window.setTimeout(() => currentStep.classList.remove("step-pulse"), 450);
}
function updateFieldCompletion(input) {
    if (!input) return;
    const container = input.closest(".input-container");
    if (!container) return;
    let complete = false;
    if (input.type === "checkbox") {
        complete = input.checked;
    } else if (input.id === "role") {
        complete = Boolean(input.value);
    } else {
        complete = String(input.value ?? "").trim().length > 0 && input.checkValidity();
    }
    container.classList.toggle("field-complete", complete && !input.classList.contains("invalid-field"));
}
function shakeInvalidFields(pageNum = currentPage) {
    const page = getField(`page${pageNum}`);
    if (!page) return;
    page.querySelectorAll(".invalid-field").forEach((field) => {
        const container = field.closest(".input-container, .compliance-wrapper");
        if (!container) return;
        container.classList.remove("shake");
        void container.offsetWidth;
        container.classList.add("shake");
        window.setTimeout(() => container.classList.remove("shake"), 360);
    });
}
function initRipples() {
    const selector = [
        ".btn-solid",
        ".btn-outline",
        ".btn-inline",
        ".role-choice",
        ".sign-in-link",
        ".password-toggle",
        ".modal-close-btn"
    ].join(",");
    document.querySelectorAll(selector).forEach((el) => {
        el.addEventListener("pointerdown", (event) => {
            if (el.disabled) return;
            const rect = el.getBoundingClientRect();
            const ripple = document.createElement("span");
            ripple.className = "ui-ripple";
            ripple.style.left = `${event.clientX - rect.left}px`;
            ripple.style.top = `${event.clientY - rect.top}px`;
            el.appendChild(ripple);
            window.setTimeout(() => ripple.remove(), 620);
        });
    });
}
function setProcessingOverlay(state = "loading", refCode = "") {
    const overlay = getField("formProcessingOverlay");
    const title = getField("processingTitle");
    const message = getField("processingMessage");
    const iconWrap = getField("processingIcon");
    if (!overlay) return;
    if (state === "hide") {
        overlay.classList.remove("is-visible", "is-success");
        overlay.setAttribute("aria-hidden", "true");
        return;
    }
    overlay.classList.add("is-visible");
    overlay.classList.toggle("is-success", state === "success");
    overlay.setAttribute("aria-hidden", "false");
    if (state === "success") {
        if (title) title.textContent = "Request submitted";
        if (message) {
            message.textContent = refCode
                ? `Reference ${refCode} was sent for administrator review.`
                : "Your request was sent for administrator review.";
        }
        if (iconWrap) iconWrap.innerHTML = icon("check");
    } else {
        if (title) title.textContent = "Submitting your request";
        if (message) message.textContent = "Sending your details for administrator review…";
        if (iconWrap) iconWrap.innerHTML = icon("loader-2");
    }
    renderIcons();
    if (state === "loading") iconWrap?.querySelector("svg")?.classList.add("spin");
}
function refreshDossierAnimation() {
    const dossier = getField("dossierPreview");
    if (!dossier) return;
    dossier.classList.remove("summary-refresh");
    void dossier.offsetWidth;
    dossier.classList.add("summary-refresh");
    window.setTimeout(() => dossier.classList.remove("summary-refresh"), 460);
}
// =========================================================================
// INITIALIZATION
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
    initDate();
    renderIcons();
    initLoadingScreen();
    initRequestMotion();
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
        "Your details",
        "Your assignment",
        "Review & submit"
    ];
    // Core UI Transition Routine
    window.updateUI = function () {
        const transitionDirection = currentPage < renderedPage ? "back" : "forward";
        pages.forEach((page, idx) => {
            const active = idx + 1 === currentPage;
            page.style.display = active ? "flex" : "none";
            page.classList.toggle("active", active);
            page.setAttribute("aria-hidden", active ? "false" : "true");
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
        document.querySelector(".progress-track")?.setAttribute("aria-valuenow", String(currentPage));
        if (progressLabel) progressLabel.textContent = `Step ${currentPage} of ${totalPages}`;
        if (progressHint) progressHint.textContent = stepHints[currentPage - 1];
        if (backBtn) backBtn.style.visibility = currentPage === 1 ? "hidden" : "visible";
        if (nextBtn) nextBtn.style.display = currentPage === totalPages ? "none" : "inline-flex";
        if (submitBtn) submitBtn.style.display = currentPage === totalPages ? "inline-flex" : "none";
        if (currentPage === 3) {
            updateLiveSummary();
            refreshDossierAnimation();
        }
        animateActivePage(transitionDirection);
        pulseCurrentStep();
        renderedPage = currentPage;
        renderIcons();
    };
    // Form Field Listeners
    form.querySelectorAll("input[required], select[required], textarea[required]").forEach((input) => {
        input.addEventListener("input", () => {
            if (input.classList.contains("invalid-field")) validateField(input);
            if (input.id === "password") updatePasswordStrength();
            if (input.id === "confirmPassword" && input.value) validateField(input);
            if (input.id === "reason") updateCharCounter();
            updateFieldCompletion(input);
            scheduleDraftSave();
        });
        input.addEventListener("change", () => {
            if (input.classList.contains("invalid-field")) validateField(input);
            updateFieldCompletion(input);
            scheduleDraftSave();
        });
        input.addEventListener("blur", () => {
            updateFieldCompletion(input);
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
            updateFieldCompletion(roleInput);
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
            shakeInvalidFields(currentPage);
            showToast("Please complete the highlighted fields.", "error");
            return;
        }
        if (currentPage < totalPages) {
            currentPage++;
            scheduleDraftSave();
            window.updateUI();
            focusPageHeading();
            getField(`page${currentPage}`)?.scrollTo({ top: 0, behavior: "smooth" });
        }
    });
    backBtn?.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            scheduleDraftSave();
            window.updateUI();
            focusPageHeading();
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
            btn.setAttribute("aria-pressed", String(isPw));
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
        showToast("Privacy and account-use notice accepted.", "success");
    });
    // Draft Actions
    getField("restoreDraftBtn")?.addEventListener("click", restoreDraft);
    getField("discardDraftBtn")?.addEventListener("click", discardDraft);
    // =====================================================================
    // FORM SUBMISSION TO SUPABASE AUTH
    // =====================================================================
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (isSubmitting) return;
        // Validate all 3 pages
        for (let i = 1; i <= totalPages; i++) {
            if (!validatePage(i)) {
                currentPage = i;
                window.updateUI();
                focusInvalidField(i);
                showToast(`Please complete required entries in Section 0${i}.`, "error");
                return;
            }
        }
        const submitError = getField("requestError");
        if (!navigator.onLine) {
            if (submitError) { submitError.hidden = false; submitError.textContent = "You’re offline. Check your connection and try again."; }
            return;
        }
        if (submitError) submitError.hidden = true;
        clearTimeout(scheduleDraftSave.timer);
        saveDraft();
        isSubmitting = true;
        form.inert = true;
        document.querySelector(".stepper").inert = true;
        const originalBtnHtml = submitBtn.innerHTML;
        submitBtn.disabled = true;
        if (backBtn) backBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        setProcessingOverlay("loading");
        submitBtn.innerHTML = `
            ${icon("loader-2")}
            <span>Submitting…</span>
        `;
        submitBtn.querySelector("svg")?.classList.add("spin");
        setSaveStatus("Sending your request…", true);
        submitBtn.querySelector("svg")?.classList.add("spin");
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
        // Personnel metadata is sent to Supabase Auth.
        // The SQL trigger creates the Pending profile + access request.
        // Password is handled ONLY by Supabase Auth and is never stored in public tables.
        const email = getField("email")?.value.trim().toLowerCase();
        const password = getField("password")?.value;
        const metadata = {
            request_id: refCode,
            full_name: getField("fullName")?.value.trim(),
            username: email?.split("@")[0] || "",
            contact: getField("contact")?.value.trim(),
            position: getField("position")?.value,
            division: getField("division")?.value,
            requested_role: "System Staff",
            requested_system: getField("role")?.value,
            endorser: getField("endorser")?.value.trim() || "N/A",
            reason: getField("reason")?.value.trim() || "N/A",
            submitted_at: now.toISOString(),
            submitted_display: formattedDate
        };
        try {
            if (!supabase || !window.PGENRO_SUPABASE?.configured) {
                throw new Error("The sign-up service is unavailable. Reload the page and try again.");
            }
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: { data: metadata }
            });
            if (error) throw error;
            if (!data?.user) throw new Error("The request could not be completed. Please try again.");
            if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
                throw new Error("An account request already exists for this email. Please use the Sign In page or contact the administrator.");
            }
            // A request account must never keep an active application session
            // before an administrator grants access.
            if (data.session) {
                try { await supabase.auth.signOut(); } catch (error) { console.warn("Pending account session could not be cleared:", error); }
            }
            // Clean up session
            try { localStorage.removeItem(DRAFT_KEY); } catch {}
            form.reset();
            syncRoleChoices();
            clearValidationVisuals();
            updatePasswordStrength();
            updateCharCounter();
            currentPage = 1;
            window.updateUI();
            setSaveStatus("Request officially logged.");
            setProcessingOverlay("hide");
            form.hidden = true;
            document.querySelector(".progress-area").hidden = true;
            document.querySelector(".save-status-row").hidden = true;
            getField("draftBanner").style.display = "none";
            getField("successRef").textContent = refCode;
            getField("requestSuccess").hidden = false;
            getField("successTitle").focus({ preventScroll: true });
            getField("requestSuccess").scrollIntoView({ block: "nearest", behavior: "auto" });
            if (getField("controlStatus")) {
                getField("controlStatus").innerHTML = `
                    <i data-lucide="check-circle-2"></i> Transmitted &bull; Reference ${refCode}
                `;
            }
        } catch (err) {
            console.error("Supabase account request error:", err);
            setProcessingOverlay("hide");
            if (submitError) { submitError.hidden = false; submitError.textContent = `Unable to submit: ${err.message || "Check your connection and try again."}`; }
            setSaveStatus("Unable to submit. Your details are still here.");
        } finally {
            isSubmitting = false;
            form.inert = false;
            document.querySelector(".stepper").inert = false;
            submitBtn.disabled = false;
            if (backBtn) backBtn.disabled = false;
            if (nextBtn) nextBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;
            renderIcons();
        }
    });
    // Check on startup for previous draft
    if (hasDraft()) {
        const banner = getField("draftBanner");
        if (banner) {
            banner.style.display = "flex";
            banner.classList.add("banner-enter");
        }
        setSaveStatus("Previous draft found.");
    }
    updatePasswordStrength();
    updateCharCounter();
    window.updateUI();
});
