/* PGENRO IMS — one-time First Admin setup.
   The private setup key is sent only to the protected Edge Function and is
   never stored in the browser or exposed in the page source. */
(() => {
  "use strict";

  if (window.__PGENRO_FIRST_ADMIN_SETUP_INITIALIZED__) return;
  window.__PGENRO_FIRST_ADMIN_SETUP_INITIALIZED__ = true;

  const FALLBACK_CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP"
  });

  const $ = id => document.getElementById(id);
  const el = {
    form: $("firstAdminForm"),
    employeeNumber: $("employeeNumber"),
    email: $("email"),
    setupKey: $("setupKey"),
    password: $("password"),
    confirmPassword: $("confirmPassword"),
    submit: $("submitBtn"),
    status: $("setupStatus"),
    error: $("setupError"),
    success: $("setupSuccess"),
    successMessage: $("successMessage"),
    successEmployeeNumber: $("successEmployeeNumber")
  };

  const state = {
    client: null,
    checking: false,
    submitting: false,
    available: false,
    initialized: false,
    configured: false
  };

  function setStatus(message, kind = "info") {
    if (!el.status) return;
    el.status.textContent = message;
    el.status.dataset.kind = kind;
    el.status.hidden = false;
  }

  function setError(message = "") {
    if (!el.error) return;
    el.error.textContent = message;
    el.error.hidden = !message;
  }

  function setFormEnabled(enabled) {
    if (!el.form) return;
    const disabled = !enabled || state.checking || state.submitting;
    el.form.querySelectorAll("input, button").forEach(control => {
      control.disabled = disabled;
    });
    if (el.submit) {
      el.submit.textContent = state.submitting ? "Creating Admin account…" : "Create First Admin Account";
    }
    el.form.setAttribute("aria-busy", String(state.submitting));
  }

  function getClient() {
    if (state.client) return state.client;
    if (window.pgenroSupabase?.functions?.invoke) {
      state.client = window.pgenroSupabase;
      return state.client;
    }

    const sdk = window.supabase;
    if (typeof sdk?.createClient !== "function") return null;

    const shared = window.PGENRO_SUPABASE || {};
    const url = shared.url || shared.supabaseUrl || FALLBACK_CONFIG.url;
    const key = shared.publishableKey || shared.anonKey || shared.key || FALLBACK_CONFIG.publishableKey;

    try {
      state.client = sdk.createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      });
      window.pgenroSupabase = state.client;
      window.PGENRO_SUPABASE = Object.freeze({
        ...shared,
        url,
        publishableKey: key,
        sdkReady: true,
        configured: true
      });
      return state.client;
    } catch (error) {
      console.error("First Admin setup could not initialize Supabase:", error);
      return null;
    }
  }

  async function readFunctionError(error) {
    let payload = null;
    const response = error?.context;
    if (response && typeof response.clone === "function") {
      try { payload = await response.clone().json(); } catch { /* Use SDK message. */ }
    }
    return {
      status: Number(response?.status || error?.status || payload?.status || 0),
      message: String(payload?.error || payload?.message || error?.message || "The setup service could not complete the request."),
      payload
    };
  }

  async function invoke(method, body) {
    const client = getClient();
    if (!client?.functions?.invoke) {
      throw new Error("Supabase is not connected. Check the shared Supabase configuration and reload this page.");
    }

    const options = { method };
    if (method !== "GET") options.body = body;

    const { data, error } = await client.functions.invoke("bootstrap-first-admin", options);
    if (error) {
      const detail = await readFunctionError(error);
      const failure = new Error(detail.message);
      failure.status = detail.status;
      failure.payload = detail.payload;
      throw failure;
    }
    if (!data || typeof data !== "object") {
      throw new Error("The First Admin setup service returned an invalid response.");
    }
    if (data.success !== true) {
      const failure = new Error(data.error || "The First Admin setup request was not accepted.");
      failure.status = Number(data.status || 0);
      failure.payload = data;
      throw failure;
    }
    return data;
  }

  async function checkStatus() {
    if (state.checking || state.submitting) return;
    state.checking = true;
    state.available = false;
    setFormEnabled(false);
    setError("");
    setStatus("Checking the Supabase setup service…", "info");

    try {
      const result = await invoke("GET");
      state.configured = result.configured === true;
      state.initialized = result.already_initialized === true;
      state.available = result.available === true && state.configured && !state.initialized;

      if (state.initialized) {
        setStatus("This system already has an active Admin. First Admin setup is closed. Continue to the sign-in page.", "warning");
      } else if (!state.configured) {
        setStatus("Supabase is reachable, but the private First Admin setup key is missing. The system maintainer must add PGENRO_FIRST_ADMIN_SETUP_KEY in Supabase Edge Function Secrets.", "warning");
      } else if (state.available) {
        setStatus("Connected. First Admin setup is available. Verify the Employee Number and directory email before continuing.", "success");
      } else {
        setStatus("The First Admin setup is currently unavailable. Contact the system maintainer.", "warning");
      }
    } catch (error) {
      console.error("First Admin setup status check failed:", error);
      setStatus("Cannot reach the First Admin setup service. Check that the bootstrap-first-admin Edge Function is deployed and that the Supabase project configuration is correct.", "error");
      setError(error.message || "Unable to check First Admin setup status.");
    } finally {
      state.checking = false;
      setFormEnabled(state.available);
    }
  }

  function validateForm() {
    const employeeNumber = el.employeeNumber?.value.trim() || "";
    const email = el.email?.value.trim().toLowerCase() || "";
    const setupKey = el.setupKey?.value || "";
    const password = el.password?.value || "";
    const confirmation = el.confirmPassword?.value || "";

    if (!employeeNumber) throw new Error("Enter the Employee Number.");
    if (employeeNumber.length > 80) throw new Error("Employee Number must not exceed 80 characters.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new Error("Enter the valid email address recorded in the Employee Directory.");
    }
    if (setupKey.trim().length < 32 || setupKey.length > 200) {
      throw new Error("The private setup key must contain at least 32 characters.");
    }
    if (password.length < 8 || password.length > 128) {
      throw new Error("Your password must contain 8 to 128 characters.");
    }
    if (password !== confirmation) throw new Error("The password and confirmation do not match.");

    return {
      employeeNumber,
      email,
      setupKey: setupKey.trim(),
      password
    };
  }

  async function submit(event) {
    event.preventDefault();
    if (state.submitting || state.checking) return;
    setError("");

    if (!state.available) {
      setError("First Admin setup is not available. Refresh the setup status before submitting.");
      return;
    }

    let values;
    try {
      if (!el.form.reportValidity()) return;
      values = validateForm();
    } catch (error) {
      setError(error.message);
      return;
    }

    state.submitting = true;
    setFormEnabled(false);
    setStatus("Creating the first administrator securely…", "info");

    try {
      const result = await invoke("POST", {
        employee_number: values.employeeNumber,
        email: values.email,
        setup_key: values.setupKey,
        password: values.password
      });

      state.available = false;
      state.initialized = true;
      el.form.hidden = true;
      el.success.hidden = false;
      if (el.successEmployeeNumber) {
        el.successEmployeeNumber.textContent = result.employee_number || values.employeeNumber;
      }
      if (el.successMessage) {
        el.successMessage.textContent =
          "The first Admin account has been created, linked to the Employee Directory, and activated. Remove PGENRO_FIRST_ADMIN_SETUP_KEY from Supabase Edge Function Secrets now, then sign in using your Employee Number and password.";
      }
      el.form.reset();
      setStatus("First Admin account created successfully.", "success");
    } catch (error) {
      console.error("First Admin setup submission failed:", error);
      const payload = error.payload || {};
      if (error.status === 409 || payload.already_initialized === true) {
        state.available = false;
        state.initialized = true;
        setStatus("This system already has an active Admin. First Admin setup is closed.", "warning");
      } else {
        setStatus("The First Admin account could not be created.", "error");
      }
      setError(error.message || "The setup request failed. Check the Supabase Edge Function logs and try again.");
    } finally {
      state.submitting = false;
      setFormEnabled(state.available);
    }
  }

  function init() {
    if (!document.body.classList.contains("pgenro-request") || !el.form) return;

    if (!el.employeeNumber || !el.email || !el.setupKey || !el.password || !el.confirmPassword || !el.submit) {
      setStatus("The First Admin form is incomplete. Reload the page or contact the system maintainer.", "error");
      console.error("First Admin setup form is missing required element IDs.");
      return;
    }

    el.form.addEventListener("submit", submit);
    el.form.querySelectorAll("input").forEach(input => {
      input.addEventListener("input", () => {
        setError("");
        if (input === el.confirmPassword || input === el.password) {
          el.confirmPassword.setCustomValidity("");
        }
      });
    });
    el.confirmPassword.addEventListener("input", () => {
      el.confirmPassword.setCustomValidity(
        el.password.value === el.confirmPassword.value ? "" : "Passwords do not match."
      );
    });
    el.password.addEventListener("input", () => {
      el.confirmPassword.setCustomValidity(
        el.password.value === el.confirmPassword.value ? "" : "Passwords do not match."
      );
    });

    setFormEnabled(false);
    void checkStatus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.PGENRO_FirstAdminSetup = Object.freeze({
    refreshStatus: checkStatus
  });
})();
