(() => {
  "use strict";
  // Existing Supabase project and insert payload are preserved.
  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP",
    table: "visitors"
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
  function init() {
    const $ = (id) => document.getElementById(id);
    const form = $("visitorForm");
    if (!form || form.dataset.initialized === "true") return;
    form.dataset.initialized = "true";
    let db = null;
    let sdkFailed = false;
    function ensureDatabase() {
      if (db) return true;
      if (typeof window.supabase?.createClient !== "function") return false;
      try {
        db = window.supabase.createClient(CONFIG.url, CONFIG.publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        sdkFailed = !db;
      } catch {
        sdkFailed = true;
      }
      return Boolean(db);
    }
    ensureDatabase();
    const ui = {
      form,
      fields: [...form.querySelectorAll("input, select")],
      fieldset: $("visitorFields"),
      fullName: $("fullName"),
      contact: $("contact"),
      address: $("address"),
      person: $("personToVisit"),
      purpose: $("purposeCategory"),
      otherGroup: $("otherPurposeGroup"),
      other: $("otherPurposeSpecific"),
      progress: $("registrationProgress"),
      progressBar: $("progressBar"),
      progressCount: $("progressCount"),
      submit: $("submitBtn"),
      status: $("dbConnectionStatus"),
      alert: $("formAlert"),
      alertMessage: $("formAlertMessage"),
      modal: $("successModal"),
      modalBackdrop: $("modalFallbackBackdrop"),
      pageShell: $("pageShell"),
      modalName: $("visitorNameDisplay"),
      modalClose: $("closeModalBtn"),
      clock: $("officeTime"),
      date: $("todayDate")
    };
    const state = { submitting: false, saveFailed: false, saveSucceeded: false, alertKind: null, modalFallback: false };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let syncMotion = () => {};
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const allowedPurposes = new Set([...ui.purpose.options].map((option) => option.value).filter(Boolean));
    function normalizePhone(value) {
      // Accept local numbers and pasted +63 / 63 numbers, storing the same 09 format.
      const digits = String(value ?? "").replace(/\D/g, "");
      if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
      if (/^9\d{9}$/.test(digits)) return `0${digits}`;
      return digits;
    }
    function activeFields() {
      return ui.fields.filter((input) => input.required && !input.disabled);
    }
    function fieldError(input) {
      const value = input.id === "contact" ? normalizePhone(input.value) : clean(input.value);
      if (input.disabled) return "";
      if (!value) {
        const messages = {
          fullName: "Please enter your full name.",
          contact: "Please enter your mobile number.",
          address: "Please enter your address, agency, or office.",
          personToVisit: "Please enter the person or department to visit.",
          purposeCategory: "Please select a service.",
          otherPurposeSpecific: "Please specify the purpose of your visit."
        };
        return input.required ? messages[input.id] || "Please complete this field." : "";
      }
      if (input.id === "contact" && !/^09\d{9}$/.test(value)) return "Use an 11-digit number starting with 09.";
      if (input.id === "fullName" && value.length < 2) return "Please enter your complete name.";
      if (input.id === "address" && value.length < 3) return "Please enter a complete address, agency, or office.";
      if (input.id === "personToVisit" && value.length < 2) return "Please enter the name or department.";
      if (input.id === "otherPurposeSpecific" && value.length < 2) return "Please add a little more detail.";
      if (input.id === "purposeCategory" && !allowedPurposes.has(value)) return "Please select a listed service.";
      if (input.maxLength > 0 && value.length > input.maxLength) return `Use no more than ${input.maxLength} characters.`;
      return "";
    }
    function setFieldState(input, mode = "", message = "") {
      const group = input.closest(".input-group");
      group?.classList.toggle("error", mode === "error");
      group?.classList.toggle("success", mode === "success");
      input.setAttribute("aria-invalid", mode === "error" ? "true" : "false");
      const error = $(`${input.id}Error`);
      if (error) error.textContent = message;
    }
    function validate(input) {
      const message = fieldError(input);
      setFieldState(input, message ? "error" : clean(input.value) ? "success" : "", message);
      return !message;
    }
    function updateProgress() {
      const required = activeFields();
      const completed = required.filter((input) => !fieldError(input)).length;
      const percentage = required.length ? Math.round((completed / required.length) * 100) : 0;
      ui.progressBar.style.width = `${percentage}%`;
      ui.progressCount.textContent = `${completed} of ${required.length} complete`;
      ui.progress.setAttribute("aria-valuenow", String(percentage));
      ui.progress.setAttribute("aria-valuetext", `${completed} of ${required.length} fields complete`);
    }
    function syncOtherPurpose() {
      const needsOther = /\bothers?\b/i.test(ui.purpose.value);
      ui.otherGroup.hidden = !needsOther;
      ui.other.disabled = !needsOther;
      ui.other.required = needsOther;
      if (!needsOther) {
        ui.other.value = "";
        setFieldState(ui.other);
      }
      updateProgress();
    }
    function setStatus(mode, label) {
      ui.status.classList.remove("is-ready", "is-offline", "is-error", "is-saving", "is-connecting");
      ui.status.classList.add(`is-${mode}`);
      ui.status.querySelector(".connection-label").textContent = label;
    }
    function syncConnectionStatus() {
      if (state.submitting) setStatus("saving", "Saving your visit…");
      else if (!navigator.onLine) setStatus("offline", "You’re offline");
      else if (!db) setStatus(sdkFailed ? "offline" : "connecting", sdkFailed ? "Registration unavailable" : "Connecting registration…");
      else if (state.saveFailed) setStatus("error", "Entry not saved");
      else if (state.saveSucceeded) setStatus("ready", "Visit recorded");
      else setStatus("ready", "Ready to register");
    }
    function showError(message, kind = "service") {
      state.alertKind = kind;
      ui.alertMessage.textContent = message;
      ui.alert.hidden = false;
    }
    function clearError() {
      state.alertKind = null;
      ui.alert.hidden = true;
      ui.alertMessage.textContent = "";
    }
    function setSubmitting(value) {
      state.submitting = value;
      ui.fieldset.disabled = value;
      ui.submit.disabled = value;
      ui.submit.classList.toggle("is-loading", value);
      ui.submit.setAttribute("aria-busy", String(value));
      ui.form.setAttribute("aria-busy", String(value));
      ui.submit.querySelector(".submit-btn-label").textContent = value ? "Saving your visit…" : "Register visit";
      syncConnectionStatus();
      syncMotion();
    }
    function focusInvalid() {
      const invalid = activeFields().find((input) => fieldError(input));
      invalid?.focus({ preventScroll: true });
      invalid?.closest(".input-group")?.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "center" });
    }
    function openSuccess(name) {
      ui.modalName.textContent = clean(name).split(/\s+/)[0] || "Visitor";
      document.body.classList.add("modal-open");
      state.modalFallback = false;
      try {
        if (typeof ui.modal.showModal !== "function") throw new Error("Native dialog unavailable");
        ui.modal.showModal();
      } catch {
        state.modalFallback = true;
        ui.modal.setAttribute("open", "");
        ui.modal.classList.add("is-fallback");
        ui.modalBackdrop.hidden = false;
        ui.pageShell.inert = true;
      }
      ui.modalClose.focus({ preventScroll: true });
    }
    function closeSuccess() {
      if (!ui.modal.hasAttribute("open")) return;
      if (state.modalFallback) {
        ui.modal.removeAttribute("open");
        finishModalClose();
      } else ui.modal.close();
    }
    function finishModalClose() {
      document.body.classList.remove("modal-open");
      ui.modalBackdrop.hidden = true;
      ui.modal.classList.remove("is-fallback");
      ui.pageShell.inert = false;
      state.modalFallback = false;
      ui.fullName.focus({ preventScroll: true });
    }
    function refreshFieldFeedback() {
      updateProgress();
      if (state.alertKind === "validation" && activeFields().every((input) => !fieldError(input))) clearError();
    }
    async function submitVisitor(event) {
      event.preventDefault();
      if (state.submitting || ui.modal.hasAttribute("open")) return;
      clearError();
      // Reconcile fields restored by browser autofill or back/forward navigation.
      syncOtherPurpose();
      ui.contact.value = normalizePhone(ui.contact.value);
      let valid = true;
      for (const input of activeFields()) {
        if (!validate(input)) valid = false;
      }
      updateProgress();
      if (!valid) {
        showError("Please complete the highlighted fields.", "validation");
        focusInvalid();
        return;
      }
      if (!navigator.onLine) {
        syncConnectionStatus();
        showError("Reconnect to the internet, then register your visit again.");
        return;
      }
      if (!ensureDatabase()) {
        syncConnectionStatus();
        showError(sdkFailed
          ? "Registration is unavailable. Reload the page or ask the front desk for assistance."
          : "Registration is still connecting. Please try again shortly.", "sdk");
        return;
      }
      const visitorData = {
        full_name: clean(ui.fullName.value),
        contact: normalizePhone(ui.contact.value),
        address: clean(ui.address.value),
        person_to_visit: clean(ui.person.value),
        purpose_category: clean(ui.purpose.value),
        other_purpose_specific: ui.other.disabled ? "" : clean(ui.other.value)
      };
      state.saveFailed = false;
      state.saveSucceeded = false;
      setSubmitting(true);
      try {
        // INSERT only: the public kiosk does not need SELECT access to visitor records.
        const { error } = await db.from(CONFIG.table).insert([visitorData]);
        if (error) throw error;
        state.saveSucceeded = true;
      } catch (error) {
        state.saveFailed = true;
        const message = error?.code === "42501"
          ? "Registration is unavailable. Please ask the front desk for assistance."
          : error?.code === "23502"
            ? "Your entry could not be saved. Please ask the front desk for assistance."
            : /fetch|network|connection/i.test(String(error?.message || ""))
              ? "The service could not be reached. Check your connection and try again."
              : "Your entry could not be saved. Please try again or ask the front desk for assistance.";
        showError(message);
      } finally {
        setSubmitting(false);
      }
      // Confirmation rendering is separate from the completed database insert.
      if (state.saveSucceeded) {
        form.reset();
        ui.fields.forEach((input) => setFieldState(input));
        syncOtherPurpose();
        openSuccess(visitorData.full_name);
      }
    }
    ui.fields.forEach((input) => {
      input.addEventListener("input", () => {
        if (input.id === "contact") input.value = input.value.replace(/[^\d+()\s-]/g, "");
        if (input === ui.purpose) syncOtherPurpose();
        state.saveSucceeded = false;
        if (input.closest(".input-group")?.classList.contains("error")) validate(input);
        else setFieldState(input, clean(input.value) && !fieldError(input) ? "success" : "");
        refreshFieldFeedback();
        syncConnectionStatus();
      });
      input.addEventListener("change", () => {
        if (input === ui.purpose) syncOtherPurpose();
        validate(input);
        refreshFieldFeedback();
      });
      input.addEventListener("blur", () => {
        if (input === ui.contact && clean(input.value)) input.value = normalizePhone(input.value);
        if (clean(input.value) || input.required) validate(input);
        refreshFieldFeedback();
      });
    });
    form.addEventListener("submit", submitVisitor);
    form.addEventListener("reset", () => {
      // reset fires before the browser updates input values.
      queueMicrotask(() => {
        ui.fields.forEach((input) => setFieldState(input));
        syncOtherPurpose();
        updateProgress();
        clearError();
      });
    });
    $("dismissAlert").addEventListener("click", clearError);
    window.addEventListener("online", syncConnectionStatus);
    window.addEventListener("offline", syncConnectionStatus);
    ui.modalClose.addEventListener("click", closeSuccess);
    ui.modalBackdrop.addEventListener("click", closeSuccess);
    ui.modal.addEventListener("cancel", (event) => { event.preventDefault(); closeSuccess(); });
    ui.modal.addEventListener("close", finishModalClose);
    ui.modal.addEventListener("keydown", (event) => {
      if (!state.modalFallback) return;
      if (event.key === "Escape") { event.preventDefault(); closeSuccess(); }
      else if (event.key === "Tab") { event.preventDefault(); ui.modalClose.focus(); }
    });
    const sdkScript = $("supabaseSdk");
    sdkScript?.addEventListener("load", () => {
      if (ensureDatabase() && state.alertKind === "sdk") clearError();
      syncConnectionStatus();
    });
    sdkScript?.addEventListener("error", () => { sdkFailed = true; syncConnectionStatus(); });
    window.addEventListener("pageshow", () => {
      syncOtherPurpose();
      refreshFieldFeedback();
      ensureDatabase();
      syncConnectionStatus();
    });
    ui.modal.addEventListener("click", (event) => {
      if (event.target !== ui.modal) return;
      const rect = ui.modal.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeSuccess();
    });
    function initClock() {
      const options = { timeZone: "Asia/Manila" };
      const dateFormat = new Intl.DateTimeFormat("en-PH", { ...options, weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const timeFormat = new Intl.DateTimeFormat("en-PH", { ...options, hour: "2-digit", minute: "2-digit", hour12: true });
      let lastTime = "";
      let lastDate = "";
      let clockTimer;
      function tick() {
        const now = new Date();
        const parts = timeFormat.formatToParts(now);
        const part = (type) => parts.find((item) => item.type === type)?.value || "";
        const currentTime = `${part("hour")}:${part("minute")}`;
        const period = part("dayPeriod");
        if (`${currentTime} ${period}` !== lastTime) {
          ui.clock.replaceChildren(document.createTextNode(`${currentTime} `));
          const ampm = document.createElement("span");
          ampm.textContent = period;
          ui.clock.appendChild(ampm);
          ui.clock.dateTime = now.toISOString();
          lastTime = `${currentTime} ${period}`;
        }
        const currentDate = dateFormat.format(now);
        if (currentDate !== lastDate) { ui.date.textContent = currentDate; lastDate = currentDate; }
      }
      function scheduleClock() {
        clearTimeout(clockTimer);
        if (document.hidden) return;
        tick();
        // The displayed clock has minute precision; update at the next minute.
        clockTimer = setTimeout(scheduleClock, 60000 - Date.now() % 60000 + 50);
      }
      scheduleClock();
      document.addEventListener("visibilitychange", scheduleClock);
      window.addEventListener("pageshow", scheduleClock);
      window.addEventListener("pagehide", () => clearTimeout(clockTimer));
    }
    function initAmbient() {
      // Decorative loops stay separate from form controls, with no pointer tracking.
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      syncMotion = () => {
        const editing = ui.form.contains(document.activeElement);
        const paused = document.hidden || reducedMotion.matches || connection?.saveData || editing || state.submitting || ui.modal.hasAttribute("open");
        document.body.dataset.motion = paused ? "paused" : "running";
        document.documentElement.dataset.pageHidden = String(document.hidden);
      };
      document.addEventListener("focusin", (event) => {
        if (ui.form.contains(event.target)) document.body.dataset.entry = "complete";
        syncMotion();
      });
      document.addEventListener("focusout", () => queueMicrotask(syncMotion));
      document.addEventListener("visibilitychange", syncMotion);
      window.addEventListener("pageshow", syncMotion);
      ui.modal.addEventListener("close", syncMotion);
      reducedMotion.addEventListener("change", syncMotion);
      connection?.addEventListener?.("change", syncMotion);
      syncMotion();
    }
    const logo = $("officeLogo");
    function showLogoFallback() { logo.hidden = true; logo.parentElement.classList.add("has-fallback"); }
    logo.addEventListener("error", showLogoFallback);
    logo.addEventListener("load", () => { logo.hidden = false; logo.parentElement.classList.remove("has-fallback"); });
    if (logo.complete && !logo.naturalWidth) showLogoFallback();
    syncOtherPurpose();
    setSubmitting(false);
    syncConnectionStatus();
    initClock();
    initAmbient();
    // Attach load/error listeners before starting the SDK request, keeping the UI responsive.
    if (!db && sdkScript?.dataset.src) sdkScript.src = sdkScript.dataset.src;
  }
})();
