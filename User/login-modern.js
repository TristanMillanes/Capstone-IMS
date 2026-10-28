/* PGENRO login controller. Supabase connection and existing routes are retained. */
(() => {
  "use strict";

  if (['service','service-request'].includes(new URLSearchParams(window.location.search).get('next'))) {
    window.location.replace('service-request-form.html');
    return;
  }

  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP"
  });
  const POLICY = Object.freeze({ maxAttempts: 5, cooldownMs: 30000, cacheDurationMs: 8 * 60 * 60 * 1000 });
  const ADMIN_ROLES = new Set(['admin']);
  const normalize = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const isAdminRole = role => ADMIN_ROLES.has(normalize(role));
  const isApproved = profile => profile?.is_active === true && ["active", "approved"].includes(normalize(profile.status));
  const wantsIcs = () => new URLSearchParams(window.location.search).get('next') === 'ics';
  const routeFor = role => wantsIcs()
    ? (isAdminRole(role) ? '../admin/ics-admin.html?form=new' : 'ics.html?form=new')
    : (isAdminRole(role) ? '../admin/admin.html' : '../User/homepage.html');
  const storage = {
    get(key, session = false) { try { return (session ? sessionStorage : localStorage).getItem(key); } catch { return null; } },
    set(key, value, session = false) { try { (session ? sessionStorage : localStorage).setItem(key, String(value)); } catch {} },
    remove(key, session = false) { try { (session ? sessionStorage : localStorage).removeItem(key); } catch {} }
  };

  // Abort slow requests instead of leaving the sign-in button stuck indefinitely.
  // Small audit/heartbeat requests may complete while the workspace opens.
  async function requestWithTimeout(input, options = {}) {
    const controller = new AbortController();
    const signal = options.signal || (input instanceof Request ? input.signal : null);
    const relayAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) relayAbort();
    else signal?.addEventListener("abort", relayAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), 20000);
    const url = input instanceof Request ? input.url : String(input);
    const backgroundWrite = /\/rest\/v1\/(audit_logs|rpc\/touch_last_login)(?:\?|$)/.test(url) && /post/i.test(options.method || "");
    try {
      return await fetch(input, { ...options, signal: controller.signal, keepalive: options.keepalive ?? backgroundWrite });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", relayAbort);
    }
  }

  const sdkReady = typeof window.supabase?.createClient === "function";
  let client = window.pgenroSupabase || null;
  if (!client && sdkReady) {
    try {
      client = window.supabase.createClient(CONFIG.url, CONFIG.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
        global: { fetch: requestWithTimeout }
      });
    } catch (error) {
      console.warn("PGENRO sign-in could not initialize:", error?.message);
    }
  }
  window.pgenroSupabase = client;
  window.PGENRO_SUPABASE = Object.freeze({ ...CONFIG, sdkReady, configured: Boolean(client) });

  async function readProfile(user) {
    const { data, error } = await client.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return data ? { ...data, authUser: user } : null;
  }
  async function getCurrentProfile() {
    if (!client) return null;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data?.session?.user ? readProfile(data.session.user) : null;
  }
  async function requireApprovedUser() {
    const profile = await getCurrentProfile();
    if (!profile) throw new Error("No active PGENRO account session was found.");
    if (!isApproved(profile)) throw new Error("Account access is " + (profile.status || "inactive") + ".");
    return profile;
  }
  async function signOut({ ask = true } = {}) {
    if (ask && !window.confirm("Are you sure you want to end your current session?")) return false;
    try { await client?.auth.signOut(); } catch {}
    clearCachedProfile();
    window.location.assign("login.html");
    return true;
  }
  window.PGENRO_API = Object.freeze({ client, getCurrentProfile, requireApprovedUser, signOut, isAdminRole });
  window.PGENRO_DB = Object.freeze({
    client, table: "visitors", configured: Boolean(client),
    async getSession() {
      if (!client) return null;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data?.session || null;
    },
    async getCurrentRole() {
      const profile = await getCurrentProfile();
      return profile ? (isAdminRole(profile.role) ? "admin" : "user") : null;
    }
  });

  function clearCachedProfile() {
    storage.remove("pgenro_current_user");
    storage.remove("pgenro_session_active", true);
    storage.remove("pgenro_session_token", true);
  }
  function cacheProfile(profile, user, email = user.email || "") {
    const cached = {
      uid: user.id, id: user.id,
      fullName: profile.full_name || profile.username || user.user_metadata?.full_name || email.split("@")[0],
      username: profile.username || email.split("@")[0], email: profile.email || email,
      contact: profile.contact || "", position: profile.position || "", division: profile.division || "",
      role: profile.role || "User", accountType: profile.account_type || "Standard User",
      status: profile.status || "Active", lastLogin: new Date().toISOString(),
      sessionInitialized: Date.now(), sessionExpires: Date.now() + POLICY.cacheDurationMs
    };
    storage.set("pgenro_current_user", JSON.stringify(cached));
    storage.set("pgenro_session_active", "true", true);
    storage.set("pgenro_session_token", user.id, true);
    document.dispatchEvent(new CustomEvent("pgenro:profile-updated", { detail: cached }));
    return cached;
  }
  function maskEmail(email) {
    if (!email?.includes("@")) return "***";
    const [name, domain] = email.split("@");
    return `${name[0]}${"*".repeat(Math.max(1, name.length - 2))}${name.length > 2 ? name.at(-1) : ""}@${domain}`;
  }
  async function recordAuditLog(action, email, status, details = "") {
    if (!client) return;
    try {
      await client.from("audit_logs").insert({
        id: crypto.randomUUID(),
        data: { action, emailMasked: maskEmail(email), status, details, timestamp: new Date().toISOString(), userAgent: navigator.userAgent.slice(0, 120) }
      });
    } catch { /* An unavailable audit table must not freeze account access. */ }
  }
  async function recordSuccessfulAccess(email, role) {
    await Promise.allSettled([
      client.rpc("touch_last_login"),
      recordAuditLog("LOGIN_SUCCESS", email, "Success", `Role: ${role}`)
    ]);
  }

  function initAmbientScene() {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = navigator.connection;
    const form = document.getElementById("loginForm");
    let pageHidden = false;
    const update = () => {
      const editing = form?.contains(document.activeElement);
      document.body.dataset.motion = reducedMotion.matches || connection?.saveData || document.hidden || pageHidden || editing ? "paused" : "running";
    };
    reducedMotion.addEventListener?.("change", update);
    connection?.addEventListener?.("change", update);
    document.addEventListener("visibilitychange", update);
    document.addEventListener("focusin", event => {
      if (event.target?.closest?.(".auth-wrapper")) document.body.dataset.entry = "complete";
      update();
    });
    document.addEventListener("focusout", () => queueMicrotask(update));
    window.addEventListener("pagehide", () => { pageHidden = true; update(); });
    window.addEventListener("pageshow", () => { pageHidden = false; update(); });
    update();
  }
  function initSealFallbacks() {
    document.querySelectorAll("[data-seal]").forEach(image => {
      const onError = () => {
        if (image.dataset.fallbackSrc && !image.dataset.fallbackTried) {
          image.dataset.fallbackTried = "true";
          image.src = image.dataset.fallbackSrc;
          return;
        }
        image.parentElement.classList.add("fallback-mode");
        image.parentElement.setAttribute("role", "img");
        image.parentElement.setAttribute("aria-label", image.alt);
      };
      image.addEventListener("error", onError);
      if (image.complete && !image.naturalWidth) onError();
    });
  }

  function initLogin() {
    if (!document.body.classList.contains("pgenro-login")) return;
    initAmbientScene();
    initSealFallbacks();
    const el = Object.fromEntries([
      "loginCard", "loginForm", "email", "password", "rememberMe", "togglePassword", "clearEmailBtn",
      "messageBox", "messageContent", "dismissAlert", "capsLockWarning", "loadingOverlay", "loadingStatusHeading",
      "loadingStatusText", "loginBtn", "btnLabel", "emailFieldBox", "passwordFieldBox", "emailError", "passwordError",
      "networkStatusBar", "lockoutNotice", "lockoutSeconds"
    ].map(id => [id, document.getElementById(id)]));
    if (!el.loginForm || !el.email || !el.password) return;
    const accessLinks = document.querySelectorAll("[data-access-link]");
    const controls = [el.email, el.password, el.rememberMe, el.togglePassword, el.clearEmailBtn, el.loginBtn];
    let submitting = false;
    let operation = 0;
    let failedAttempts = Number(storage.get("pgenro_failed_attempts", true)) || 0;
    let lockoutUntil = Number(storage.get("pgenro_lockout_until", true)) || 0;
    let lockoutTimer = null;
    let redirected = false;
    const locked = () => lockoutUntil > Date.now();

    const syncControls = () => {
      controls.forEach(control => { if (control) control.disabled = submitting || locked(); });
      accessLinks.forEach(link => { link.inert = submitting; });
    };
    const hideMessage = () => { el.messageBox.hidden = true; el.messageContent.replaceChildren(); };
    const showMessage = (type, title, text) => {
      const heading = document.createElement("strong");
      const detail = document.createElement("span");
      heading.textContent = title;
      detail.textContent = text;
      el.messageContent.replaceChildren(heading, detail);
      el.messageBox.className = `message-box ${type}`;
      el.messageBox.hidden = false;
    };
    const setFieldError = (name, text = "") => {
      el[`${name}FieldBox`].classList.toggle("invalid", Boolean(text));
      el[name].setAttribute("aria-invalid", String(Boolean(text)));
      el[`${name}Error`].textContent = text;
      el[`${name}Error`].hidden = !text;
    };
    const clearErrors = () => { hideMessage(); setFieldError("email"); setFieldError("password"); };
    const setBusy = value => {
      submitting = value;
      el.loginForm.setAttribute("aria-busy", String(value));
      el.loginCard.classList.toggle("is-busy", value);
      el.loginBtn.classList.toggle("is-loading", value);
      el.btnLabel.textContent = value ? "Signing in…" : "Sign in";
      el.loadingOverlay.hidden = !value;
      if (value) {
        el.loadingStatusHeading.textContent = "Signing in.";
        el.loadingStatusText.textContent = "Checking your account…";
      }
      syncControls();
    };
    const updateCooldown = () => {
      const remaining = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      el.lockoutNotice.hidden = !remaining;
      el.lockoutSeconds.textContent = String(remaining);
      if (!remaining) {
        clearInterval(lockoutTimer);
        lockoutTimer = null;
        lockoutUntil = 0;
        storage.remove("pgenro_lockout_until", true);
      }
      syncControls();
    };
    const startCooldown = () => {
      clearInterval(lockoutTimer);
      updateCooldown();
      if (locked()) lockoutTimer = setInterval(updateCooldown, 1000);
    };
    const recordFailedAttempt = () => {
      failedAttempts += 1;
      if (failedAttempts >= POLICY.maxAttempts) {
        failedAttempts = 0;
        lockoutUntil = Date.now() + POLICY.cooldownMs;
        storage.set("pgenro_lockout_until", lockoutUntil, true);
        startCooldown();
      }
      storage.set("pgenro_failed_attempts", failedAttempts, true);
    };
    const updateNetwork = () => { el.networkStatusBar.hidden = navigator.onLine; };
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    window.addEventListener("pageshow", () => { updateNetwork(); startCooldown(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) updateCooldown(); });
    updateNetwork();
    startCooldown();

    const savedEmail = storage.get("pgenro_saved_email");
    if (savedEmail) { el.email.value = savedEmail; el.rememberMe.checked = true; }
    el.clearEmailBtn.hidden = !el.email.value;
    el.email.addEventListener("input", () => { el.clearEmailBtn.hidden = !el.email.value; setFieldError("email"); hideMessage(); });
    el.password.addEventListener("input", () => { setFieldError("password"); hideMessage(); });
    el.rememberMe.addEventListener("change", () => { if (!el.rememberMe.checked) storage.remove("pgenro_saved_email"); });
    el.clearEmailBtn.addEventListener("click", () => {
      el.email.value = ""; el.clearEmailBtn.hidden = true; setFieldError("email"); hideMessage(); el.email.focus();
    });
    el.togglePassword.addEventListener("click", () => {
      const visible = el.password.type === "password";
      el.password.type = visible ? "text" : "password";
      el.togglePassword.setAttribute("aria-label", visible ? "Hide password" : "Show password");
      el.togglePassword.setAttribute("aria-pressed", String(visible));
      el.togglePassword.querySelector("use").setAttribute("href", visible ? "#icon-eye-off" : "#icon-eye");
    });
    const checkCaps = event => { if (event.getModifierState) el.capsLockWarning.hidden = !event.getModifierState("CapsLock"); };
    el.password.addEventListener("keydown", checkCaps);
    el.password.addEventListener("keyup", checkCaps);
    el.password.addEventListener("blur", () => { el.capsLockWarning.hidden = true; });
    el.dismissAlert.addEventListener("click", hideMessage);

    const selectIcs = () => {
      document.getElementById('loginHeading').textContent = 'Sign in for your ICS form';
      document.getElementById('icsSignInNotice').hidden = false;
    };
    if (wantsIcs()) selectIcs();


    // Only a still-current restore attempt may redirect. A submitted login takes priority.
    async function resumeSession() {
      if (!client) return;
      const version = operation;
      try {
        const { data, error } = await client.auth.getSession();
        if (error || !data?.session?.user || version !== operation) return;
        const user = data.session.user;
        const profile = await readProfile(user);
        if (version !== operation || submitting) return;
        if (!isApproved(profile)) {
          clearCachedProfile();
          return;
        }
        const cached = cacheProfile(profile, user);
        redirected = true;
        window.location.replace(routeFor(cached.role));
      } catch { /* Connection problems leave the form available for another attempt. */ }
    }
    void resumeSession();

    el.loginForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (submitting || redirected) return;
      operation += 1;
      clearErrors();
      if (locked()) { startCooldown(); return; }
      if (!navigator.onLine) { showMessage("error", "You're offline", "Check your internet connection and try again."); return; }
      const email = el.email.value.trim().toLowerCase();
      const password = el.password.value;
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!email) setFieldError("email", "Enter your email address.");
      else if (!validEmail || el.email.validity.typeMismatch) setFieldError("email", "Enter a valid email address.");
      if (!password) setFieldError("password", "Enter your password.");
      if (!email || !validEmail || el.email.validity.typeMismatch || !password) {
        document.querySelector(".input-box.invalid input")?.focus();
        return;
      }
      if (!client) {
        showMessage("error", "Sign-in service unavailable", "Reload the page and check your connection, then try again.");
        return;
      }
      if (el.rememberMe.checked) storage.set("pgenro_saved_email", email);
      else storage.remove("pgenro_saved_email");
      let signedIn = false;
      setBusy(true);
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          const code = normalize(error.code);
          const badCredentials = code === "invalid_credentials" || /invalid login credentials|invalid credentials/i.test(error.message || "");
          if (badCredentials) {
            recordFailedAttempt();
            setFieldError("password", "Check your email address and password.");
            showMessage("error", "Unable to sign in", "The email or password you entered is incorrect.");
          } else if (code === "email_not_confirmed") {
            showMessage("warning", "Email verification needed", "Verify your email or contact the administrator for help.");
          } else if (error.status === 429 || /rate_limit|too_many_requests/.test(code)) {
            showMessage("warning", "Please wait", "Too many sign-in requests. Wait a moment and try again.");
          } else {
            showMessage("error", "Sign-in unavailable", "Check your connection and try again.");
          }
          void recordAuditLog("LOGIN_FAILED_AUTH", email, "Failed", error.message || code);
          return;
        }
        const user = data?.user;
        if (!user) throw new Error("No authenticated user was returned.");
        signedIn = true;
        el.loadingStatusText.textContent = "Checking account approval…";
        const profile = await readProfile(user);
        if (!profile) {
          await client.auth.signOut();
          signedIn = false;
          clearCachedProfile();
          showMessage("error", "Account profile missing", "Contact the administrator to link your account profile.");
          return;
        }
        if (!isApproved(profile)) {
          const status = normalize(profile.status);
          const details = {
            pending: ["warning", "Approval pending", "Your account is waiting for administrator approval."],
            rejected: ["error", "Request declined", "Contact the administrator about your account request."],
            suspended: ["error", "Account suspended", "Contact the administrator to restore access."]
          }[status] || ["error", "Account inactive", "Contact the administrator to restore access."];
          const action = ["pending", "rejected", "suspended"].includes(status) ? status.toUpperCase() : "INACTIVE";
          void recordAuditLog(`LOGIN_BLOCKED_${action}`, email, "Blocked", `Status: ${profile.status || "Inactive"}`);
          await client.auth.signOut();
          signedIn = false;
          clearCachedProfile();
          showMessage(...details);
          return;
        }
        failedAttempts = 0;
        lockoutUntil = 0;
        storage.remove("pgenro_failed_attempts", true);
        storage.remove("pgenro_lockout_until", true);
        const cached = cacheProfile(profile, user, email);
        void recordSuccessfulAccess(email, cached.role);
        el.btnLabel.textContent = "Signed in";
        el.loadingStatusHeading.textContent = "Signed in.";
        el.loadingStatusText.textContent = "Opening your workspace…";
        redirected = true;
        window.location.assign(routeFor(cached.role));
      } catch (error) {
        if (signedIn) { try { await client.auth.signOut(); } catch {} }
        clearCachedProfile();
        void recordAuditLog("LOGIN_SYSTEM_ERROR", email, "Error", error?.message || "Unavailable");
        showMessage("error", "Unable to sign in", "Sign-in is unavailable right now. Check your connection and try again.");
      } finally {
        if (!redirected) {
          setBusy(false);
          if (el.password.getAttribute("aria-invalid") === "true" && !locked()) el.password.focus();
        }
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initLogin, { once: true });
  else initLogin();
})();

/* Page-owned layout helpers; do not change record permissions or data writes. */
(() => {
  'use strict';
  function init() {
    if (document.body.dataset.unifiedLayoutReady) return;
    document.body.dataset.unifiedLayoutReady = 'true';
    // A wide registry scrolls within its own region, including dynamically mounted tables.
    function containTables() {
      document.querySelectorAll('main table,.modal-body table,.modal-content table').forEach(table => {
        if (table.closest('.table-responsive,.table-wrapper,.table-container,.table-scroll,.responsive-table,.ui-table-scroll,.ws-table-scroll,.audit-table-scroll,.monitor-table-scroll')) return;
        const region = document.createElement('div'); region.className = 'ui-table-scroll';
        table.before(region); region.append(table);
      });
    }
    containTables();
    let tableFrame;
    const insertedTables = new MutationObserver(records => {
      if (!records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.tagName === 'TABLE' || node.querySelector?.('table'))))) return;
      cancelAnimationFrame(tableFrame); tableFrame = requestAnimationFrame(containTables);
    });
    insertedTables.observe(document.body, {childList:true,subtree:true});
    document.querySelector('.admin-sidebar-close')?.addEventListener('click',()=>document.getElementById('sidebarBackdrop')?.click());
    // Account Settings and the module pages use one saved user appearance.
    let appearanceObserver;
    if (document.body.classList.contains('pgenro-user')) {
      const html=document.documentElement, button=document.getElementById('userAppearanceBtn');
      const icon=dark=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dark?'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>':'<path d="M20.9 12.5A9 9 0 1 1 11.5 3a6.3 6.3 0 0 0 9.4 9.5Z"/>'}</svg>`;
      function applyAppearance(theme) {
        theme=theme==='dark'?'dark':'light';
        if(html.dataset.theme!==theme)html.dataset.theme=theme;
        const dark=theme==='dark';
        if(button&&button.dataset.appearance!==theme) {
          button.dataset.appearance=theme;button.innerHTML=icon(dark);button.setAttribute('aria-pressed',String(dark));
          button.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');button.title=button.getAttribute('aria-label');
        }
        document.querySelector('meta[name="color-scheme"]')?.setAttribute('content',theme);
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#0d2119':'#f4f7f5');
      }
      let saved={};try{saved=JSON.parse(localStorage.getItem('pgenro_preferences')||'{}')||{};}catch{}
      let localTheme;try{localTheme=localStorage.getItem('pgenro_user_theme');}catch{}
      applyAppearance(localTheme||html.dataset.pgenroTheme||saved.theme||html.dataset.theme);
      appearanceObserver=new MutationObserver(()=>{let selected;try{selected=localStorage.getItem('pgenro_user_theme');}catch{}applyAppearance(selected||html.dataset.pgenroTheme||html.dataset.theme);});
      appearanceObserver.observe(html,{attributes:true,attributeFilter:['data-pgenro-theme']});
      button?.addEventListener('click',()=>{
        const theme=html.dataset.theme==='dark'?'light':'dark';
        try{const prefs=JSON.parse(localStorage.getItem('pgenro_preferences')||'{}')||{};localStorage.setItem('pgenro_preferences',JSON.stringify({...prefs,theme}));localStorage.setItem('pgenro_user_theme',theme);}catch{}
        const preferenceRadio=document.querySelector(`input[name="theme"][value="${theme}"]`);if(preferenceRadio)preferenceRadio.checked=true;
        html.dataset.pgenroTheme=theme;applyAppearance(theme);
      });
      window.addEventListener('storage',event=>{if(event.key==='pgenro_user_theme')applyAppearance(event.newValue);else if(event.key==='pgenro_preferences'){try{html.dataset.pgenroTheme=JSON.parse(event.newValue||'{}').theme||'light';}catch{}}});
    }
    // The existing user page controls continue to open and close its module menu.
    const sidebar = document.querySelector('.pgenro-user .sidebar');
    if (sidebar) {
      const media = matchMedia('(max-width: 900px)'), menu = document.getElementById('hamburgerMenu');
      let previouslyOpen = false;
      sidebar.querySelectorAll('.modules-list a').forEach(link=>link.title=link.textContent.trim());
      function desktopNavigation() {
        let collapsed=false;try{collapsed=localStorage.getItem('pgenro_user_sidebar')==='collapsed';}catch{}
        collapsed=!media.matches&&collapsed;
        sidebar.classList.toggle('collapsed',collapsed);document.body.classList.toggle('user-sidebar-collapsed',collapsed);
        if(!media.matches&&menu){menu.setAttribute('aria-expanded',String(!collapsed));menu.setAttribute('aria-label',collapsed?'Expand module menu':'Collapse module menu');menu.title=menu.getAttribute('aria-label');}
      }
      menu?.addEventListener('click',event=>{
        if(media.matches)return;
        event.preventDefault();event.stopImmediatePropagation();
        try{localStorage.setItem('pgenro_user_sidebar',sidebar.classList.contains('collapsed')?'expanded':'collapsed');}catch{}
        desktopNavigation();
      },true);
      function sync() {
        const open = media.matches && sidebar.classList.contains('open');
        sidebar.inert = media.matches && !open;
        sidebar.setAttribute('aria-hidden', String(media.matches && !open));
        if (open && !previouslyOpen) sidebar.querySelector('.user-sidebar-close,a[href]')?.focus({preventScroll:true});
        if (!open && previouslyOpen) menu?.focus({preventScroll:true});
        previouslyOpen = open;
      }
      const state = new MutationObserver(sync); state.observe(sidebar,{attributes:true,attributeFilter:['class']});
      media.addEventListener('change',()=>{desktopNavigation();sync();});desktopNavigation();sync();
      let navigationFrame;
      window.addEventListener('resize',()=>{cancelAnimationFrame(navigationFrame);navigationFrame=requestAnimationFrame(desktopNavigation);});
      window.addEventListener('pagehide',()=>cancelAnimationFrame(navigationFrame));
      document.querySelector('.user-sidebar-close')?.addEventListener('click',()=>{ if(sidebar.classList.contains('open')) menu?.click(); });
      document.addEventListener('keydown',event=>{
        if(!media.matches||!sidebar.classList.contains('open')) return;
        if(event.key==='Escape') {menu?.click();return;}
        if(event.key!=='Tab')return;
        const items=[...sidebar.querySelectorAll('a[href],button:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length && !el.closest('[inert]'));
        if(!items.length)return;
        const first=items[0],last=items.at(-1);
        if(!sidebar.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();}
        else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      });
    }
    window.addEventListener('pagehide',event=>{if(event.persisted)return;insertedTables.disconnect();appearanceObserver?.disconnect();cancelAnimationFrame(tableFrame);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

