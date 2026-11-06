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
  function maskEmployeeNumber(value) {
    const number = String(value || "").trim();
    if (!number) return "***";
    if (number.length <= 2) return "*".repeat(number.length);
    return `${number[0]}${"*".repeat(Math.min(6, number.length - 2))}${number.at(-1)}`;
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
      "loginCard", "loginForm", "employeeNumber", "password", "rememberMe", "togglePassword", "clearEmployeeNumberBtn",
      "messageBox", "messageContent", "dismissAlert", "capsLockWarning", "loadingOverlay", "loadingStatusHeading",
      "loadingStatusText", "loginBtn", "btnLabel", "employeeNumberFieldBox", "passwordFieldBox", "employeeNumberError", "passwordError",
      "networkStatusBar", "lockoutNotice", "lockoutSeconds"
    ].map(id => [id, document.getElementById(id)]));
    if (!el.loginForm || !el.employeeNumber || !el.password) return;
    const accessLinks = document.querySelectorAll("[data-access-link]");
    const controls = [el.employeeNumber, el.password, el.rememberMe, el.togglePassword, el.clearEmployeeNumberBtn, el.loginBtn];
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
    const clearErrors = () => { hideMessage(); setFieldError("employeeNumber"); setFieldError("password"); };
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

    // Remember only the employee number on this device; never retain the password.
    storage.remove("pgenro_saved_email");
    const savedEmployeeNumber = storage.get("pgenro_saved_employee_number");
    if (savedEmployeeNumber) { el.employeeNumber.value = savedEmployeeNumber; el.rememberMe.checked = true; }
    el.clearEmployeeNumberBtn.hidden = !el.employeeNumber.value;
    el.employeeNumber.addEventListener("input", () => {
      el.clearEmployeeNumberBtn.hidden = !el.employeeNumber.value;
      setFieldError("employeeNumber"); hideMessage();
    });
    el.password.addEventListener("input", () => { setFieldError("password"); hideMessage(); });
    el.rememberMe.addEventListener("change", () => {
      if (!el.rememberMe.checked) storage.remove("pgenro_saved_employee_number");
    });
    el.clearEmployeeNumberBtn.addEventListener("click", () => {
      el.employeeNumber.value = ""; el.clearEmployeeNumberBtn.hidden = true;
      setFieldError("employeeNumber"); hideMessage(); el.employeeNumber.focus();
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

      let employeeNumber = '';
      try { employeeNumber = window.PGENRO_EMPLOYEE_ID.normalize(el.employeeNumber.value); }
      catch (error) { setFieldError('employeeNumber', error.message); el.employeeNumber.focus(); return; }
      el.employeeNumber.value = employeeNumber;
      const password = el.password.value;
      if (!employeeNumber) setFieldError("employeeNumber", "Enter your employee number.");
      else if (employeeNumber.length > 80) setFieldError("employeeNumber", "Employee number must not exceed 80 characters.");
      if (!password) setFieldError("password", "Enter your password.");
      if (!employeeNumber || employeeNumber.length > 80 || !password) {
        document.querySelector(".input-box.invalid input")?.focus();
        return;
      }
      if (!client || typeof client.functions?.invoke !== "function") {
        showMessage("error", "Sign-in service unavailable", "Employee-number sign-in is not configured. Contact the system administrator.");
        return;
      }
      if (el.rememberMe.checked) storage.set("pgenro_saved_employee_number", employeeNumber);
      else storage.remove("pgenro_saved_employee_number");

      let signedIn = false;
      let authEmail = "";
      setBusy(true);
      try {
        // The Edge Function securely resolves the employee number to its Auth account.
        // The account email is never requested from or displayed in the browser form.
        const { data: loginData, error: loginError } = await client.functions.invoke("employee-login", {
          body: { employee_number: employeeNumber, password }
        });
        if (loginError) {
          let failure = null;
          try {
            const response = loginError.context;
            if (response && typeof response.clone === "function") failure = await response.clone().json();
          } catch { /* Use the generic sign-in error below. */ }
          const status = Number(loginError.context?.status || loginError.status || failure?.status || 0);
          const code = normalize(failure?.code || "");
          if (status === 401 || code === "invalid_credentials") {
            recordFailedAttempt();
            setFieldError("employeeNumber", "Check your employee number and password.");
            showMessage("error", "Unable to sign in", "The employee number or password you entered is incorrect.");
          } else if (code === "email_not_confirmed") {
            showMessage("warning", "Account confirmation needed", "Your account still needs confirmation. Contact the system administrator for assistance.");
          } else if (status === 429) {
            showMessage("warning", "Please wait", "Too many sign-in attempts. Wait a moment and try again.");
          } else if (status === 503 || code === "employee_login_not_configured") {
            showMessage("error", "Sign-in service unavailable", "Employee-number sign-in has not been installed in Supabase yet. Contact the system administrator.");
          } else {
            showMessage("error", "Sign-in unavailable", "Check your connection and try again.");
          }
          void recordAuditLog("LOGIN_FAILED_AUTH", "", "Failed", `Employee number: ${maskEmployeeNumber(employeeNumber)}`);
          return;
        }
        if (!loginData?.access_token || !loginData?.refresh_token) {
          throw new Error("Employee sign-in did not return a valid session.");
        }
        const { data: sessionData, error: sessionError } = await client.auth.setSession({
          access_token: loginData.access_token,
          refresh_token: loginData.refresh_token
        });
        if (sessionError) throw sessionError;
        const user = sessionData?.user || sessionData?.session?.user;
        if (!user) throw new Error("No authenticated user was returned.");
        authEmail = user.email || "";
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
          void recordAuditLog(`LOGIN_BLOCKED_${action}`, authEmail, "Blocked", `Employee number: ${maskEmployeeNumber(employeeNumber)}; Status: ${profile.status || "Inactive"}`);
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
        const cached = cacheProfile(profile, user, authEmail);
        void recordSuccessfulAccess(authEmail, cached.role);
        el.btnLabel.textContent = "Signed in";
        el.loadingStatusHeading.textContent = "Signed in.";
        el.loadingStatusText.textContent = "Opening your workspace…";
        redirected = true;
        window.location.assign(routeFor(cached.role));
      } catch (error) {
        if (signedIn) { try { await client.auth.signOut(); } catch {} }
        clearCachedProfile();
        void recordAuditLog("LOGIN_SYSTEM_ERROR", authEmail, "Error", `Employee number: ${maskEmployeeNumber(employeeNumber)}; ${error?.message || "Unavailable"}`);
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

