// =========================================================
// PGENRO IMS — VISITORS LOG UI + SUPABASE CONTROLLER
// =========================================================

const supabaseDB = window.PGENRO_DB?.client || null;
const VISITORS_TABLE = window.PGENRO_DB?.table || "visitors";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("visitorForm");
  if (!form) return;

  const inputs = Array.from(form.querySelectorAll("input, select, textarea"));
  const progressBar = document.getElementById("progressBar");
  const progressPercent = document.getElementById("progressPercent");
  const progressText = document.getElementById("progressText");
  const progressCount = document.getElementById("progressCount");
  const submitBtn = document.getElementById("submitBtn");
  const formContainer = document.getElementById("visitorCard");
  const modal = document.getElementById("successModal");
  const modalContent = modal?.querySelector(".modal-content");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const toastStack = document.getElementById("toastStack");

  const purposeCategory = document.getElementById("purposeCategory");
  const otherPurposeGroup = document.getElementById("otherPurposeGroup");
  const otherPurposeSpecific = document.getElementById("otherPurposeSpecific");

  let isSubmitting = false;
  let activeSkyClass = "day";
  let modalReturnFocus = null;

  // ---------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------
  function isGroupVisible(group) {
    if (!group) return false;
    if (group === otherPurposeGroup) return group.classList.contains("is-open");
    return true;
  }

  function fieldIsValid(input) {
    const group = input.closest(".input-group");
    if (!group || !isGroupVisible(group)) return true;

    const value = input.value.trim();
    if (!value) return false;
    if (input.id === "contact") return /^09\d{9}$/.test(value);
    if (input.id === "fullName") return value.length >= 2;
    return true;
  }

  function setFieldState(input, state, message = "") {
    const group = input.closest(".input-group");
    if (!group) return;

    group.classList.remove("error", "success");
    if (state) group.classList.add(state);

    const messageEl = group.querySelector(".error-msg");
    if (messageEl) messageEl.textContent = message;

    input.setAttribute("aria-invalid", state === "error" ? "true" : "false");
  }

  function validateField(input, { silent = false } = {}) {
    const group = input.closest(".input-group");
    if (!group || !isGroupVisible(group)) return true;

    const value = input.value.trim();
    const label = group.querySelector("label")?.textContent.replaceAll("'", "") || "Field";

    if (!value) {
      if (!silent) {
        setFieldState(
          input,
          "error",
          input.id === "purposeCategory" ? "Please select a purpose category." : `${label} is required.`
        );
      }
      return false;
    }

    if (input.id === "contact" && !/^09\d{9}$/.test(value)) {
      if (!silent) setFieldState(input, "error", "Enter an 11-digit mobile number starting with 09.");
      return false;
    }

    if (input.id === "fullName" && value.length < 2) {
      if (!silent) setFieldState(input, "error", "Please enter your complete name.");
      return false;
    }

    if (!silent) setFieldState(input, "success");
    return true;
  }

  function getActiveRequiredInputs() {
    return inputs.filter(input => {
      const group = input.closest(".input-group");
      return input.required && group && isGroupVisible(group);
    });
  }

  function updateProgress() {
    const requiredInputs = getActiveRequiredInputs();
    const completed = requiredInputs.filter(fieldIsValid).length;
    const total = requiredInputs.length || 1;
    const percent = Math.round((completed / total) * 100);

    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressCount) progressCount.textContent = `${completed} / ${requiredInputs.length} fields`;

    if (progressText) {
      if (percent === 0) progressText.textContent = "Start your visitor entry";
      else if (percent < 50) progressText.textContent = "Good start — keep going";
      else if (percent < 100) progressText.textContent = "Almost ready to submit";
      else progressText.textContent = "All required fields are ready";
    }

    formContainer?.classList.toggle("form-complete", percent === 100);
  }

  function showToast(message, type = "error") {
    if (!toastStack) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.innerHTML = `
      <span class="toast-dot"></span>
      <div class="toast-copy">
        <strong>${type === "error" ? "Unable to continue" : "Notice"}</strong>
        <span></span>
      </div>
      <button class="toast-close" type="button" aria-label="Dismiss notification">×</button>
    `;
    toast.querySelector(".toast-copy span").textContent = message;
    toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));
    toastStack.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));
    window.setTimeout(() => dismissToast(toast), 5200);
  }

  function dismissToast(toast) {
    if (!toast || toast.dataset.closing === "true") return;
    toast.dataset.closing = "true";
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 260);
  }

  function setSubmitting(state) {
    isSubmitting = state;
    if (!submitBtn) return;

    submitBtn.disabled = state;
    submitBtn.classList.toggle("is-loading", state);
    submitBtn.setAttribute("aria-busy", state ? "true" : "false");

    const label = submitBtn.querySelector(".submit-btn-label");
    if (label) label.textContent = state ? "Saving Entry..." : "Submit Entry Log";
  }

  function focusFirstInvalid() {
    const firstInvalid = getActiveRequiredInputs().find(input => !fieldIsValid(input));
    if (!firstInvalid) return;
    firstInvalid.focus({ preventScroll: true });
    firstInvalid.closest(".input-group")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------------------------------------------------------
  // DYNAMIC OTHER PURPOSE FIELD
  // ---------------------------------------------------------
  function syncOtherPurpose() {
    if (!purposeCategory || !otherPurposeGroup || !otherPurposeSpecific) return;

    const isOther = purposeCategory.value.toLowerCase().includes("other");
    otherPurposeGroup.classList.toggle("is-open", isOther);
    otherPurposeGroup.setAttribute("aria-hidden", isOther ? "false" : "true");
    otherPurposeSpecific.required = isOther;
    otherPurposeSpecific.tabIndex = isOther ? 0 : -1;

    if (!isOther) {
      otherPurposeSpecific.value = "";
      setFieldState(otherPurposeSpecific, "");
    }

    updateProgress();
  }

  purposeCategory?.addEventListener("change", syncOtherPurpose);

  // ---------------------------------------------------------
  // FORM FIELD INTERACTIONS
  // ---------------------------------------------------------
  inputs.forEach(input => {
    input.addEventListener("input", () => {
      if (input.id === "contact") {
        input.value = input.value.replace(/\D/g, "").slice(0, 11);
      }

      const group = input.closest(".input-group");
      if (group?.classList.contains("error")) validateField(input);
      else if (fieldIsValid(input)) setFieldState(input, "success");
      else if (!input.value.trim()) setFieldState(input, "");

      updateProgress();
    });

    input.addEventListener("change", () => {
      validateField(input);
      updateProgress();
    });

    input.addEventListener("blur", () => {
      if (input.value.trim() || input.required) validateField(input);
    });
  });

  // ---------------------------------------------------------
  // CLOCK + ADAPTIVE SKY
  // ---------------------------------------------------------
  function initClock() {
    const todayDateEl = document.getElementById("todayDate");
    const timeHour = document.getElementById("timeHour");
    const timeMinute = document.getElementById("timeMinute");
    const timeSecond = document.getElementById("timeSecond");
    const timeAmpm = document.getElementById("timeAmpm");
    const secHand = document.getElementById("secHand");
    const minHand = document.getElementById("minHand");
    const hourHand = document.getElementById("hourHand");
    const sky = document.getElementById("sky-background");
    const celestial = document.getElementById("celestialBody");

    function updateClockAndSky() {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const seconds = now.getSeconds();
      const displayHours = hours % 12 || 12;
      const ampm = hours >= 12 ? "PM" : "AM";

      if (todayDateEl) {
        todayDateEl.textContent = now.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        }).toUpperCase();
      }

      if (timeHour) timeHour.textContent = String(displayHours).padStart(2, "0");
      if (timeMinute) timeMinute.textContent = String(minutes).padStart(2, "0");
      if (timeSecond) timeSecond.textContent = String(seconds).padStart(2, "0");
      if (timeAmpm) timeAmpm.textContent = ampm;

      if (secHand) secHand.style.transform = `rotate(${seconds * 6}deg)`;
      if (minHand) minHand.style.transform = `rotate(${minutes * 6 + seconds * 0.1}deg)`;
      if (hourHand) hourHand.style.transform = `rotate(${(hours % 12) * 30 + minutes * 0.5}deg)`;

      const timeDecimal = hours + minutes / 60 + seconds / 3600;
      let currentClass = "night";
      if (timeDecimal >= 5 && timeDecimal < 9) currentClass = "morning";
      else if (timeDecimal >= 9 && timeDecimal < 16) currentClass = "day";
      else if (timeDecimal >= 16 && timeDecimal < 18.5) currentClass = "sunset";

      if (sky && !sky.classList.contains(currentClass)) {
        sky.classList.remove("morning", "day", "sunset", "night");
        sky.classList.add(currentClass);
        updateLeavesTheme(currentClass);
      } else {
        activeSkyClass = currentClass;
      }

      if (celestial) {
        let progress;
        if (timeDecimal >= 6 && timeDecimal <= 18) {
          progress = (timeDecimal - 6) / 12;
        } else {
          const nightTime = timeDecimal > 18 ? timeDecimal - 18 : timeDecimal + 6;
          progress = nightTime / 12;
        }

        progress = Math.max(0, Math.min(1, progress));
        const x = 7 + progress * 86;
        const y = 77 - Math.sin(progress * Math.PI) * 62;
        celestial.style.left = `${x}%`;
        celestial.style.top = `${y}%`;
      }
    }

    updateClockAndSky();
    window.setInterval(updateClockAndSky, 1000);
  }

  // ---------------------------------------------------------
  // NATURAL FALLING LEAVES
  // ---------------------------------------------------------
  function createLeaves() {
    const container = document.getElementById("leaves-container");
    if (!container) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      container.replaceChildren();
      return;
    }

    const isMobile = window.innerWidth <= 700;
    const leafCount = isMobile ? 10 : 24;
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < leafCount; i++) {
      const leaf = document.createElement("span");
      leaf.className = `leaf leaf-type-${(i % 3) + 1}`;
      leaf.dataset.skyTheme = activeSkyClass;

      const fallDuration = 12 + Math.random() * 10;
      const size = 10 + Math.random() * 13;
      const drift = (Math.random() > 0.5 ? 1 : -1) * (60 + Math.random() * 170);

      leaf.style.left = `${Math.random() * 104 - 2}vw`;
      leaf.style.setProperty("--leaf-size", `${size}px`);
      leaf.style.setProperty("--fall-duration", `${fallDuration}s`);
      leaf.style.setProperty("--fall-delay", `${-(Math.random() * fallDuration)}s`);
      leaf.style.setProperty("--flutter-duration", `${1.9 + Math.random() * 2.2}s`);
      leaf.style.setProperty("--leaf-drift", `${drift}px`);
      leaf.style.setProperty("--leaf-opacity", `${0.28 + Math.random() * 0.42}`);
      leaf.style.setProperty("--leaf-scale", `${0.72 + Math.random() * 0.52}`);

      fragment.appendChild(leaf);
    }

    container.replaceChildren(fragment);
  }

  function updateLeavesTheme(theme) {
    activeSkyClass = theme;
    document.querySelectorAll(".leaf").forEach(leaf => {
      leaf.dataset.skyTheme = theme;
    });
  }

  let resizeTimer;
  let lastMobileState = window.innerWidth <= 700;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const mobileState = window.innerWidth <= 700;
      if (mobileState !== lastMobileState) {
        lastMobileState = mobileState;
        createLeaves();
      }
    }, 180);
  });

  // ---------------------------------------------------------
  // SUBTLE INTERACTIVE CARD LIGHT
  // ---------------------------------------------------------
  if (formContainer && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    formContainer.addEventListener("pointermove", event => {
      const rect = formContainer.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      formContainer.style.setProperty("--pointer-x", `${x}%`);
      formContainer.style.setProperty("--pointer-y", `${y}%`);
    });
  }

  // ---------------------------------------------------------
  // SUCCESS MODAL
  // ---------------------------------------------------------
  function openModal() {
    if (!modal) return;
    modalReturnFocus = document.activeElement;
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    window.setTimeout(() => modalContent?.focus(), 60);
  }

  function closeModal() {
    if (!modal || !modal.classList.contains("show")) return;
    modal.classList.add("modal-leaving");
    window.setTimeout(() => {
      modal.classList.remove("show", "modal-leaving");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("modal-open");
      modalReturnFocus?.focus?.();
    }, 240);
  }

  closeModalBtn?.addEventListener("click", closeModal);
  modal?.addEventListener("click", event => {
    if (event.target === modal) closeModal();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModal();
  });

  // ---------------------------------------------------------
  // SUPABASE SUBMISSION
  // ---------------------------------------------------------
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (isSubmitting) return;

    let valid = true;
    getActiveRequiredInputs().forEach(input => {
      if (!validateField(input)) valid = false;
    });

    updateProgress();

    if (!valid) {
      formContainer?.classList.remove("shake-effect");
      void formContainer?.offsetWidth;
      formContainer?.classList.add("shake-effect");
      focusFirstInvalid();
      showToast("Please complete the highlighted fields before submitting.", "error");
      return;
    }

    const visitorData = {
      full_name: document.getElementById("fullName")?.value.trim() || "",
      contact: document.getElementById("contact")?.value.trim() || "",
      address: document.getElementById("address")?.value.trim() || "",
      person_to_visit: document.getElementById("personToVisit")?.value.trim() || "",
      purpose_category: purposeCategory?.value || "",
      other_purpose_specific: otherPurposeSpecific?.value.trim() || ""
    };

    if (!supabaseDB) {
      console.error("Supabase client not found. Confirm ../shared/supabase.js loads before visitorslog.js.");
      showToast("The database connection is not configured. Please contact the administrator.", "error");
      return;
    }

    setSubmitting(true);

    try {
      const { error } = await supabaseDB.from(VISITORS_TABLE).insert(visitorData);
      if (error) throw error;

      const visitorNameDisplay = document.getElementById("visitorNameDisplay");
      if (visitorNameDisplay) visitorNameDisplay.textContent = visitorData.full_name.split(/\s+/)[0] || "Visitor";

      form.reset();
      inputs.forEach(input => setFieldState(input, ""));
      syncOtherPurpose();
      updateProgress();
      openModal();
    } catch (error) {
      console.error("Unable to save visitor entry to Supabase:", error);
      const message =
        error?.code === "23502" ? "Database setup error: a required database default is missing. Run PGENRO_VISITORS_SETUP.sql." :
        error?.code === "42501" ? "Permission denied by Supabase. Run the provided RLS setup SQL." :
        "Your entry could not be saved. Check the connection and try again.";
      showToast(message, "error");
    } finally {
      setSubmitting(false);
    }
  });

  // ---------------------------------------------------------
  // INITIAL BOOT
  // ---------------------------------------------------------
  syncOtherPurpose();
  initClock();
  createLeaves();
  updateProgress();
});
