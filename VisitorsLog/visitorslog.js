/* Fixed emerald surroundings and light forms. No stored or system appearance settings. */
(() => {
  'use strict';
  let leaving=false;
  let exitAnimation=null;
  const canAnimate = () => !matchMedia('(prefers-reduced-motion: reduce)').matches && !navigator.connection?.saveData;
  function restorePage() {
    leaving=false;
    exitAnimation?.cancel();
    exitAnimation=null;
    document.body.dataset.routeMotion='ready';
  }
  async function navigate(destination) {
    if(leaving)return;
    leaving=true;
    const viewport=document.querySelector('.portal-viewport');
    if(canAnimate()&&viewport?.animate){
      document.body.dataset.routeMotion='leaving';
      exitAnimation=viewport.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-8px)'}],{duration:170,easing:'ease-in',fill:'forwards'});
      try{await exitAnimation.finished;}catch{}
    }
    window.location.assign(destination);
    // Restore the old document if a navigation is cancelled or fails to leave it.
    setTimeout(()=>{if(!document.hidden)restorePage();},1800);
  }
  function init() {
    const protectedPasswords=[...document.querySelectorAll('input[data-empty-on-open]')];
    function clearPassword(field) {
      field.value='';field.defaultValue='';field.type='password';field.readOnly=true;
      field.setAttribute('aria-invalid','false');field.classList.remove('invalid-field');
      field.closest('.input-box')?.classList.remove('invalid');
      const error=document.getElementById(field.id+'Error');if(error)error.textContent='';
      const button=document.querySelector(`button[aria-controls="${field.id}"]`);
      if(button){
        button.setAttribute('aria-pressed','false');button.setAttribute('aria-label','Show password');
        const use=button.querySelector('use');
        if(use)use.setAttribute('href','#icon-eye');
        else {const svg=button.querySelector('svg');if(svg)svg.innerHTML='<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';}
      }
      field.dispatchEvent(new CustomEvent('portal:password-cleared',{bubbles:true}));
    }
    protectedPasswords.forEach(field=>{
      clearPassword(field);
      const unlock=()=>{
        if(field.readOnly){field.value='';field.defaultValue='';field.readOnly=false;}
      };
      field.addEventListener('focus',unlock);
      field.addEventListener('pointerdown',unlock);
      field.addEventListener('keydown',unlock);
      field.addEventListener('input',()=>{if(field.readOnly&&field.value)clearPassword(field);});
    });
    const forms=new Set(protectedPasswords.map(field=>field.form).filter(Boolean));
    forms.forEach(form=>form.addEventListener('reset',()=>queueMicrotask(()=>protectedPasswords.filter(field=>field.form===form).forEach(clearPassword))));
    window.addEventListener('pagehide',()=>protectedPasswords.forEach(clearPassword));
    window.addEventListener('pageshow',event=>{
      restorePage();
      protectedPasswords.filter(field=>event.persisted||field.readOnly).forEach(clearPassword);
      if(event.persisted&&canAnimate())document.querySelector('.portal-viewport')?.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:280,easing:'ease-out'});
    });
    document.addEventListener('click',event=>{
      const link=event.target instanceof Element?event.target.closest('a[href]'):null;
      if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.download||link.target&&link.target!=='_self')return;
      const url=new URL(link.href,location.href);
      if(!['http:','https:','file:'].includes(url.protocol)||url.origin!==location.origin||url.pathname===location.pathname&&url.search===location.search)return;
      if(!canAnimate()||document.querySelector('form[aria-busy="true"]'))return;
      event.preventDefault();void navigate(url.href);
    });
    document.querySelectorAll('[data-brand-seal]').forEach(image => {
      const loaded = () => { image.hidden = !image.naturalWidth; };
      image.addEventListener('load', loaded);
      image.addEventListener('error', () => { image.hidden = true; });
      if (image.complete) loaded();
    });
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const connection = navigator.connection;
    const syncMotion = () => {
      document.body.dataset.sceneMotion = document.hidden || reduced.matches || connection?.saveData ? 'paused' : 'running';
    };
    reduced.addEventListener?.('change',syncMotion);
    connection?.addEventListener?.('change',syncMotion);
    document.addEventListener('visibilitychange',syncMotion);
    window.addEventListener('pageshow',syncMotion);
    syncMotion();
  }
  const normalizePhone = value => {
    const digits = String(value || '').replace(/\D/g, '');
    if (/^639\d{9}$/.test(digits)) return '0' + digits.slice(2);
    if (/^9\d{9}$/.test(digits)) return '0' + digits;
    return digits;
  };
  async function timedFetch(input, options = {}) {
    const controller = new AbortController();
    const upstream = options.signal || (input instanceof Request ? input.signal : null);
    const abort = () => controller.abort(upstream?.reason);
    if (upstream?.aborted) abort();
    else upstream?.addEventListener('abort', abort, {once:true});
    const timer = setTimeout(() => controller.abort(new DOMException('Request timed out','TimeoutError')), 20000);
    try { return await fetch(input, {...options, signal:controller.signal}); }
    finally { clearTimeout(timer); upstream?.removeEventListener('abort', abort); }
  }
  const uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  };
  window.PortalUI = Object.freeze({normalizePhone, timedFetch, uuid, navigate});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();

/* Visual feedback follows the existing async state; it never submits a form. */
(() => {
  'use strict';
  if(window.PGENRO_ButtonFeedback)return;
  window.PGENRO_ButtonFeedback=true;
  function init(){
    const submitFor={loginForm:'loginBtn',accessForm:'submitBtn',publicServiceRequestForm:'submitServiceRequestBtn',visitorForm:'submitBtn'};
    Object.entries(submitFor).forEach(([formId,buttonId])=>{
      const form=document.getElementById(formId),button=document.getElementById(buttonId);if(!form||!button)return;
      const status=document.createElement('p');status.className='sr-only ui-async-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');form.after(status);
      const labels={loginForm:'Signing in. Please wait.',accessForm:'Sending your account request. Please wait.',publicServiceRequestForm:'Sending your service request. Please wait.',visitorForm:'Saving your visit. Please wait.'};
      const sync=()=>{const busy=form.getAttribute('aria-busy')==='true';button.setAttribute('aria-busy',String(busy));button.classList.toggle('ui-button-busy',busy);status.textContent=busy?labels[formId]:'';};
      sync();new MutationObserver(sync).observe(form,{attributes:true,attributeFilter:['aria-busy']});
    });
    if(document.body.dataset.recordAccess==='view-only'){
      document.querySelectorAll('#refreshDashboardBtn,#refreshRecordsBtn,#refreshBtn,#travelRefresh').forEach(button=>{
        let previous='';
        const sync=()=>{const busy=button.disabled||button.classList.contains('is-loading'),key=String(busy);if(key===previous)return;previous=key;button.setAttribute('aria-busy',key);button.classList.toggle('ui-button-busy',busy);};
        sync();new MutationObserver(sync).observe(button,{attributes:true,attributeFilter:['disabled','class']});
      });
    }
    const eligible='.primary-sign-btn,.submit-btn,.btn-solid,.primary-action,.secondary-action,.btn-outline,.refresh-btn,.secondary-btn';
    document.addEventListener('pointerdown',event=>{
      const button=event.target.closest('button');if(!button||!button.matches(eligible)||button.disabled||event.button!==0||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      const r=button.getBoundingClientRect(),wave=document.createElement('span');wave.className='ui-tap-wave';wave.setAttribute('aria-hidden','true');
      wave.style.setProperty('--tap-x',event.clientX-r.left+'px');wave.style.setProperty('--tap-y',event.clientY-r.top+'px');wave.style.setProperty('--tap-size',Math.max(r.width,r.height)*2+'px');
      button.append(wave);wave.addEventListener('animationend',()=>wave.remove(),{once:true});setTimeout(()=>wave.remove(),700);
    },true);
    document.body.dataset.buttonFeedbackReady='true';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

(() => {
  "use strict";
  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP"
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
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { fetch: window.PortalUI.timedFetch }
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
    const signature = setupSignature($, () => state.submitting || ui.fieldset.disabled, updateProgress);
    let signedSubmission = null;
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
      const total = required.length + 1;
      const completed = required.filter((input) => !fieldError(input)).length + Number(signature.hasInk());
      const percentage = Math.round((completed / total) * 100);
      ui.progressBar.style.width = `${percentage}%`;
      ui.progressCount.textContent = `${completed} of ${total} complete`;
      ui.progress.setAttribute("aria-valuenow", String(percentage));
      ui.progress.setAttribute("aria-valuetext", `${completed} of ${total} fields complete`);
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
      const signaturePng = signature.image();
      if (!signaturePng) {
        signature.showError("Please sign in the box before registering your visit.");
        return;
      }
      if (!signaturePng.startsWith("data:image/png;base64,") || signaturePng.length > 131072) {
        signature.showError("The signature could not be saved. Clear it and sign again.");
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
      const payload = JSON.stringify([visitorData, signaturePng]);
      if (signedSubmission?.payload !== payload) {
        const random = crypto.getRandomValues(new Uint8Array(16));
        const id = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
        signedSubmission = { id, payload };
      }
      state.saveFailed = false;
      state.saveSucceeded = false;
      setSubmitting(true);
      try {
        const { error } = await db.rpc("pgenro_register_signed_visit", {
          p_visit: visitorData,
          p_signature: signaturePng,
          p_submission_id: signedSubmission.id
        });
        if (error) throw error;
        state.saveSucceeded = true;
      } catch (error) {
        state.saveFailed = true;
        const message = /Abort|Timeout/.test(error?.name || "")
          ? "The connection timed out. Ask the front desk to check whether your visit was recorded before trying again."
          : ["42501", "PGRST202", "42883"].includes(error?.code)
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
      signedSubmission = null;
      signature.clear();
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

  function setupSignature($, locked, onChange) {
    const canvas = $("visitorSignature");
    const clearButton = $("clearVisitorSignature");
    const status = $("signatureStatus");
    const ink = canvas.getContext("2d");
    let pointerId = null;
    let bounds = null;
    let lastPoint = null;
    let frame = null;
    const points = [];
    let hasInk = false;

    function showStatus(message) {
      canvas.removeAttribute("aria-invalid");
      status.textContent = message;
    }

    function showError(message) {
      canvas.setAttribute("aria-invalid", "true");
      status.textContent = message;
      canvas.focus({ preventScroll: true });
      canvas.scrollIntoView({ block: "center" });
    }

    function finishStroke() {
      flushInk();
      const id = pointerId;
      pointerId = null;
      bounds = null;
      lastPoint = null;
      delete document.body.dataset.signing;
      if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }

    function clear() {
      finishStroke();
      ink?.clearRect(0, 0, canvas.width, canvas.height);
      hasInk = false;
      clearButton.disabled = true;
      showStatus("Signature box is empty.");
      onChange();
    }

    function point(event) {
      return {
        x: (event.pageX - bounds.left) * bounds.scaleX,
        y: (event.pageY - bounds.top) * bounds.scaleY
      };
    }

    function drawInk() {
      frame = null;
      if (!points.length) return;
      ink.beginPath();
      ink.moveTo(lastPoint.x, lastPoint.y);
      for (const next of points) ink.lineTo(next.x, next.y);
      lastPoint = points[points.length - 1];
      points.length = 0;
      ink.stroke();
      if (!hasInk) {
        hasInk = true;
        clearButton.disabled = false;
        showStatus("Signature added.");
        onChange();
      }
    }

    function flushInk() {
      if (frame !== null) cancelAnimationFrame(frame);
      drawInk();
    }

    function queuePoint(event) {
      const next = point(event);
      const previous = points.length ? points[points.length - 1] : lastPoint;
      if (next.x !== previous.x || next.y !== previous.y) points.push(next);
    }

    if (ink) {
      ink.strokeStyle = "#19382e";
      ink.lineWidth = 4;
      ink.lineCap = "round";
      ink.lineJoin = "round";

      // Read layout once per stroke. Subsequent samples only update the canvas.
      canvas.addEventListener("pointerdown", (event) => {
        if (locked() || pointerId !== null || !event.isPrimary || event.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        const width = rect.width - (canvas.offsetWidth - canvas.clientWidth);
        const height = rect.height - (canvas.offsetHeight - canvas.clientHeight);
        if (width <= 0 || height <= 0) return;
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        bounds = {
          left: rect.left + window.scrollX + canvas.clientLeft,
          top: rect.top + window.scrollY + canvas.clientTop,
          scaleX: canvas.width / width,
          scaleY: canvas.height / height
        };
        pointerId = event.pointerId;
        lastPoint = point(event);
        document.body.dataset.signing = "true";
      });
      canvas.addEventListener("pointermove", (event) => {
        if (locked() || event.pointerId !== pointerId) return;
        for (const sample of event.getCoalescedEvents?.() ?? []) queuePoint(sample);
        queuePoint(event);
        if (points.length && frame === null) frame = requestAnimationFrame(drawInk);
      });
      canvas.addEventListener("pointerup", (event) => {
        if (event.pointerId !== pointerId) return;
        if (!locked()) queuePoint(event);
        finishStroke();
      });
      for (const eventName of ["pointercancel", "lostpointercapture"]) {
        canvas.addEventListener(eventName, (event) => {
          if (event.pointerId === pointerId) finishStroke();
        });
      }
      window.addEventListener("resize", () => {
        if (pointerId !== null) finishStroke();
      });
      clearButton.addEventListener("click", clear);
    }
    return {
      clear,
      showError,
      hasInk: () => hasInk,
      image() {
        flushInk();
        return hasInk ? canvas.toDataURL("image/png") : null;
      }
    };
  }
})();

/* Presentation enhancements only. Existing validation and submissions own the forms. */
(() => {
  'use strict';
  function init(){
    if(document.body.dataset.portalDesign!=='v4')return;
    const visitor=document.getElementById('visitorForm');
    if(visitor){
      const update=()=>document.querySelectorAll('[data-visit-preview]').forEach(output=>{
        const input=document.getElementById(output.dataset.visitPreview);if(!input)return;
        const value=input.value.trim();let text=value||(input.tagName==='SELECT'?'Not selected yet':'Not provided yet');
        if(value&&input.tagName==='SELECT')text=input.selectedOptions[0]?.textContent.trim()||value;
        if(input.id==='purposeCategory'&&value==='Other Service not listed')text=document.getElementById('otherPurposeSpecific')?.value.trim()||text;
        output.textContent=text;
      });
      visitor.addEventListener('input',update);visitor.addEventListener('change',update);visitor.addEventListener('blur',()=>queueMicrotask(update),true);visitor.addEventListener('reset',()=>queueMicrotask(update));update();
    }
    // Restore a single decorative arrow after the existing controller resets a label.
    for(const id of ['submitBtn','submitServiceRequestBtn']){
      const button=document.getElementById(id);if(!button||button.closest('#visitorForm'))continue;
      const form=button.form;if(!form)continue;
      const sync=()=>{
        if(form.getAttribute('aria-busy')==='true'||button.querySelector('svg,i'))return;
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','v4-action-arrow');svg.innerHTML='<path d="M5 12h14m-6-6 6 6-6 6"/>';button.append(svg);
      };
      new MutationObserver(sync).observe(form,{attributes:true,attributeFilter:['aria-busy']});sync();
    }
    document.querySelectorAll('input:not([type="password"]):not([type="checkbox"]),textarea').forEach(field=>{
      const sync=()=>field.classList.toggle('v4-has-entry',Boolean(field.value.trim()));
      field.addEventListener('input',sync);field.form?.addEventListener('reset',()=>queueMicrotask(sync));sync();
    });
    document.body.dataset.portalSurfaceReady='true';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
