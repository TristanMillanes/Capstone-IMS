/* Page-owned UI helpers: render new placeholders without rebuilding existing SVGs. */
const PGENRO_PageUI = (() => {
  function icons() {
    if (!window.lucide?.createIcons) return;
    const pending = document.querySelectorAll('i[data-lucide]');
    if (!pending.length) return;
    pending.forEach(el => el.setAttribute('data-pgenro-pending', el.getAttribute('data-lucide')));
    window.lucide.createIcons({nameAttr: 'data-pgenro-pending'});
    document.querySelectorAll('svg[data-pgenro-pending]').forEach(el => el.removeAttribute('data-pgenro-pending'));
  }

  const pages = new Map();
  let printing = false;
  function search(render) {
    let timer;
    return () => { clearTimeout(timer); timer = setTimeout(render, 100); };
  }
  function paginate(rows, tbody, render) {
    if (printing) return rows;
    let state = pages.get(tbody);
    if (!state) {
      const nav = document.createElement('nav');
      nav.className = 'registry-pagination';
      nav.setAttribute('aria-label', 'Registry pagination');
      nav.innerHTML = '<span class="registry-range" role="status" aria-live="polite"></span><div class="registry-page-controls"><button type="button" data-page="first" aria-label="First page">«</button><button type="button" data-page="previous">Previous</button><span class="registry-page-label"></span><button type="button" data-page="next">Next</button><button type="button" data-page="last" aria-label="Last page">»</button></div>';
      const table = tbody.closest('table');
      const region = table.closest('.table-wrapper, .table-responsive, .table-wrap, .table-container, .table-scroll, .table-frame') || table;
      region.after(nav);
      state = {page: 1, totalPages: 1, key: null, nav, render};
      pages.set(tbody, state);
      nav.addEventListener('click', event => {
        const button = event.target.closest('button[data-page]');
        if (!button || button.disabled) return;
        const action = button.dataset.page;
        state.page = action === 'first' ? 1 : action === 'last' ? state.totalPages : state.page + (action === 'next' ? 1 : -1);
        state.render();
      });
    }
    // Filter changes start at page one; realtime updates clamp the current page.
    const key = [...document.querySelectorAll('main input, main select, main .tab-btn.active')]
      .map(el => `${el.id}:${el.value || el.dataset.filter || ''}`).join('\u001f');
    if (state.key !== key) state.page = 1;
    state.key = key;
    state.render = render;
    state.totalPages = Math.max(1, Math.ceil(rows.length / 25));
    state.page = Math.max(1, Math.min(state.page, state.totalPages));
    const start = (state.page - 1) * 25;
    state.nav.hidden = rows.length === 0;
    const range = `${rows.length ? start + 1 : 0}–${Math.min(start + 25, rows.length)} of ${rows.length.toLocaleString()} records`;
    const label = `Page ${state.page} of ${state.totalPages}`;
    const rangeEl = state.nav.querySelector('.registry-range');
    const labelEl = state.nav.querySelector('.registry-page-label');
    if (rangeEl.textContent !== range) rangeEl.textContent = range;
    if (labelEl.textContent !== label) labelEl.textContent = label;
    state.nav.querySelectorAll('button').forEach(button => {
      button.disabled = ['first', 'previous'].includes(button.dataset.page) ? state.page === 1 : state.page === state.totalPages;
    });
    return rows.slice(start, start + 25);
  }
  // Registry printing and export retain the complete filtered dataset.
  window.addEventListener('beforeprint', () => { printing = true; pages.forEach(state => state.render()); });
  window.addEventListener('afterprint', () => { printing = false; pages.forEach(state => state.render()); });
  return {icons, paginate, search};
})();

(() => {
  "use strict";

  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP",
    memoTable: "office_memos",
    profileTable: "profiles"
  });

  const client = window.pgenroSupabase || (typeof window.supabase?.createClient === "function"
    ? window.supabase.createClient(CONFIG.url, CONFIG.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      })
    : null);

  window.pgenroSupabase = client;
  window.PGENRO_SUPABASE = Object.freeze({
    ...CONFIG,
    sdkReady: Boolean(client),
    configured: Boolean(client)
  });

  document.addEventListener("DOMContentLoaded", init, { once: true });

  function init() {
    const $ = (selector, parent = document) => parent.querySelector(selector);
    const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

    const ui = {
      body: document.body,
      overlay: $("#overlay"),
      sidebar: $("#sidebar"),
      hamburger: $("#hamburgerMenu"),

      profileMenu: $("#profileMenu"),
      profileBtn: $("#profileBtn"),
      profileDropdown: $("#profileDropdown"),
      logoutBtn: $("#logoutBtn"),

      dbStatusIndicator: $("#dbStatusIndicator"),
      dbStatusText: $("#dbStatusText"),

      kpiTotal: $("#kpiTotal"),
      kpiPinned: $("#kpiPinned"),

      recordsTable: $("#memoTableBody"),
      searchInput: $("#searchInput"),
      resultCount: $("#resultCount"),
      refreshBtn: $("#refreshRecordsBtn"),
      printBtn: $("#printRegistryBtn"),

      viewerModal: $("#viewMemoModal"),
      viewerPanel: $(".viewer-panel"),
      viewerTitle: $("#viewModalHeaderTitle"),
      pdfFrame: $("#pdfFrame"),
      noPdfMessage: $("#noPdfMessage"),
      closeViewerBtn: $("#closeViewModalBtn"),
      cancelViewerBtn: $("#cancelViewModalBtn"),

      toastContainer: $("#toastContainer")
    };

    const state = {
      records: [],
      currentProfile: null,
      realtimeChannel: null,
      loading: false,
      viewerOpen: false,
      lastFocusedElement: null
    };

    const mobileQuery = window.matchMedia("(max-width: 1024px)");

    const text = (value) => String(value ?? "").trim();
    const lower = (value) => text(value).toLowerCase();
    const first = (...values) =>
      values.find((value) => value !== undefined && value !== null && text(value) !== "") ?? "";

    const refreshIcons = () => PGENRO_PageUI.icons();

    function escapeHtml(value) {
      return text(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function showToast(message, type = "success") {
      if (!ui.toastContainer) return;

      const icons = {
        success: "circle-check",
        warning: "triangle-alert",
        error: "circle-alert"
      };

      const toast = document.createElement("div");
      toast.className = `toast ${type}`;
      toast.innerHTML = `<i data-lucide="${icons[type] || icons.success}"></i><span></span>`;
      toast.querySelector("span").textContent = message;

      ui.toastContainer.appendChild(toast);
      refreshIcons();

      window.setTimeout(() => toast.remove(), 3200);
    }

    function setDatabaseStatus(type, message) {
      if (ui.dbStatusIndicator) {
        ui.dbStatusIndicator.className = `status-indicator ${type}`;
      }

      if (ui.dbStatusText) {
        ui.dbStatusText.textContent = message;
      }
    }

    function mapMemo(row = {}) {
      const data = row.data && typeof row.data === "object" ? row.data : {};

      return {
        databaseId: row.id,
        id: text(first(
          data.controlNo,
          data.control_no,
          data.memoNo,
          data.memo_no,
          data.id,
          row.control_no,
          row.memo_no,
          row.id
        )),
        date: text(first(
          data.date,
          data.memoDate,
          data.memo_date,
          row.memo_date,
          row.date,
          row.created_at
        )),
        target: text(first(
          data.target,
          data.addressedTo,
          data.addressed_to,
          data.recipient,
          row.addressed_to,
          row.target
        )),
        subject: text(first(
          data.subject,
          data.subjectMatter,
          data.subject_matter,
          row.subject,
          row.subject_matter
        )),
        remarks: text(first(
          data.remarks,
          data.receivedBy,
          data.received_by,
          row.remarks,
          row.received_by
        )),
        pinned: Boolean(first(
          data.pinned,
          data.isPinned,
          data.is_pinned,
          row.pinned,
          row.is_pinned,
          false
        )),
        fileName: text(first(data.pdfFileName,data.fileName,data.file_name,row.file_name)),
        fileUrl: text(first(
          data.fileUrl,
          data.fileURL,
          data.file_url,
          data.pdfUrl,
          data.pdf_url,
          data.attachmentUrl,
          data.attachment_url,
          row.file_url,
          row.pdf_url,
          row.attachment_url
        )),
        createdAt: text(first(
          data.createdAt,
          data.created_at,
          row.created_at
        )),
        updatedAt: text(first(
          data.updatedAt,
          data.updated_at,
          row.updated_at
        ))
      };
    }

    function formatDate(value) {
      const raw = text(value);
      if (!raw) return "-";

      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return raw;

      return new Intl.DateTimeFormat("en-PH", {
        year: "numeric",
        month: "short",
        day: "2-digit"
      }).format(date);
    }

    function populateProfile(profile = {}) {
      const name = text(first(
        profile.full_name,
        profile.fullName,
        profile.username,
        profile.name,
        "PGENRO User"
      ));

      const role = text(first(
        profile.position,
        profile.role,
        profile.account_type,
        profile.accountType,
        "Authorized account"
      ));

      const email = text(first(
        profile.email,
        profile.authUser?.email,
        "Office account"
      ));

      $$(".profile-text strong").forEach((node) => {
        node.textContent = name;
      });

      $$(".profile-text small").forEach((node) => {
        node.textContent = role;
      });

      $$(".profile-dropdown-header h3").forEach((node) => {
        node.textContent = name;
      });

      $$(".profile-dropdown-header p").forEach((node) => {
        node.textContent = email;
      });
    }

    function cacheProfile(user, profile = {}) {
      const cached = {
        id: user.id,
        uid: user.id,
        fullName: first(profile.full_name, profile.username, user.email),
        username: profile.username || "",
        email: first(profile.email, user.email),
        contact: profile.contact || "",
        position: profile.position || "",
        division: profile.division || "",
        role: first(profile.role, "user"),
        accountType: first(profile.account_type, "Standard User"),
        status: first(profile.status, "Active")
      };

      try {
        localStorage.setItem("pgenro_current_user", JSON.stringify(cached));
        sessionStorage.setItem("pgenro_session_active", "true");
        sessionStorage.setItem("pgenro_session_token", String(user.id));
      } catch {
        // Storage is optional. The current authenticated session is authoritative.
      }

      populateProfile(cached);
    }

    async function verifySession() {
      if (!client || !ui.body.dataset.requiresAuth) return true;

      try {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;

        const user = data?.session?.user;

        if (!user) {
          redirectToLogin();
          return false;
        }

        const { data: profile, error: profileError } = await client
          .from(CONFIG.profileTable)
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (profileError) {
          console.warn("Profile details were unavailable:", profileError);
          state.currentProfile = {
            email: user.email,
            role: "user"
          };
          populateProfile(state.currentProfile);
          return true;
        }

        const currentRole = lower(profile?.role).replace(/\s+/g, " ").trim();
        if (["admin", "administrator", "super admin", "superadmin", "system administrator"].includes(currentRole)) {
          window.location.replace("../admin/admin.html");
          return false;
        }

        const status = lower(profile?.status);
        const hasExplicitActiveFlag = typeof profile?.is_active === "boolean";

        if (
          profile &&
          (
            (hasExplicitActiveFlag && profile.is_active === false) ||
            (status && !["active", "approved"].includes(status))
          )
        ) {
          await logout({ ask: false });
          return false;
        }

        state.currentProfile = {
          ...(profile || {}),
          email: first(profile?.email, user.email),
          authUser: user
        };

        cacheProfile(user, state.currentProfile);
        return true;
      } catch (error) {
        console.error("Unable to verify the current session:", error);
        setDatabaseStatus("offline", "Session verification failed");
        return false;
      }
    }

    function redirectToLogin() {
      const target = ui.body.dataset.loginUrl || "login.html";
      window.location.replace(target);
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

    async function logout({ ask = true } = {}) {
      if (ask && !(await showLogoutDialog())) {
        return;
      }

      try {
        await client?.auth.signOut();
      } catch (error) {
        console.warn("Remote sign-out was unavailable:", error);
      }

      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("sb-") || key.startsWith("pgenro_")) {
            localStorage.removeItem(key);
          }
        }

        sessionStorage.clear();
      } catch {
        // Continue to the login page even if browser storage is unavailable.
      }

      redirectToLogin();
    }

    function closeProfile() {
      ui.profileMenu?.classList.remove("open");
      ui.profileBtn?.setAttribute("aria-expanded", "false");
      ui.profileDropdown?.setAttribute("aria-hidden", "true");
    }

    function toggleProfile() {
      if (!ui.profileMenu || !ui.profileBtn || !ui.profileDropdown) return;

      const shouldOpen = !ui.profileMenu.classList.contains("open");
      closeProfile();

      if (shouldOpen) {
        ui.profileMenu.classList.add("open");
        ui.profileBtn.setAttribute("aria-expanded", "true");
        ui.profileDropdown.setAttribute("aria-hidden", "false");
      }
    }

    function syncOverlay() {
      const sidebarOpen =
        mobileQuery.matches &&
        Boolean(ui.sidebar?.classList.contains("open"));

      const active = sidebarOpen || state.viewerOpen;

      ui.overlay?.classList.toggle("active", active);
      ui.overlay?.setAttribute("aria-hidden", String(!active));

      ui.body.classList.toggle("sidebar-open", sidebarOpen);
      ui.body.classList.toggle("modal-open", state.viewerOpen);
    }

    function setSidebarOpen(open) {
      const shouldOpen = Boolean(open && mobileQuery.matches);

      ui.sidebar?.classList.toggle("open", shouldOpen);
      ui.hamburger?.classList.toggle("active", shouldOpen);
      ui.hamburger?.setAttribute("aria-expanded", String(shouldOpen));
      ui.hamburger?.setAttribute(
        "aria-label",
        shouldOpen ? "Close module menu" : "Open module menu"
      );

      syncOverlay();
    }

    function getFilteredRecords() {
      const query = lower(ui.searchInput?.value);

      if (!query) return [...state.records];

      return state.records.filter((record) => {
        const haystack = [
          record.id,
          record.date,
          record.target,
          record.subject,
          record.remarks
        ]
          .map(lower)
          .join(" ");

        return haystack.includes(query);
      });
    }

    function updateStats() {
      if (ui.kpiTotal) {
        ui.kpiTotal.textContent = String(state.records.length);
      }

      if (ui.kpiPinned) {
        ui.kpiPinned.textContent = String(
          state.records.filter((record) => record.pinned).length
        );
      }
    }

    function renderTable() {
      if (!ui.recordsTable) return;

      const records = getFilteredRecords();
      const pageRows = PGENRO_PageUI.paginate(records, ui.recordsTable, renderTable);

      if (ui.resultCount) {
        ui.resultCount.textContent =
          `${records.length} ${records.length === 1 ? "record" : "records"}`;
      }

      if (!records.length) {
        ui.recordsTable.innerHTML = `
          <tr>
            <td class="empty" colspan="6">
              No memorandum records matched your search.
            </td>
          </tr>
        `;
        return;
      }

      ui.recordsTable.innerHTML = pageRows
        .map((record) => {
          const index = state.records.indexOf(record);

          return `
            <tr class="${record.pinned ? "is-pinned" : ""}">
              <td>
                <span class="memo-code-badge">
                  ${escapeHtml(record.id || "-")}
                </span>
              </td>

              <td>${escapeHtml(formatDate(record.date))}</td>

              <td>
                <span class="memo-recipient" title="${escapeHtml(record.target || "-")}">
                  ${escapeHtml(record.target || "-")}
                </span>
              </td>

              <td class="memo-subject-cell">
                <span title="${escapeHtml(record.subject || "-")}">
                  ${escapeHtml(record.subject || "-")}
                </span>
              </td>

              <td class="memo-remarks">
                <span title="${escapeHtml(record.remarks || "-")}">
                  ${escapeHtml(record.remarks || "-")}
                </span>
              </td>

              <td class="action-column">
                <button class="action-btn"
                        type="button"
                        data-view-index="${index}"
                        aria-label="View attachment for ${escapeHtml(record.id || "memo")}"
                        title="View attachment">
                  <i data-lucide="eye"></i>
                </button>
              </td>
            </tr>
          `;
        })
        .join("");

      refreshIcons();
    }

    function render() {
      updateStats();
      renderTable();
    }

    async function loadMemos({ notify = false } = {}) {
      if (state.loading) return;

      if (!client) {
        setDatabaseStatus("offline", "Supabase client unavailable");
        state.records = loadLocalRecords();
        render();
        return;
      }

      state.loading = true;
      setDatabaseStatus("standby", "Loading office memos…");

      if (ui.refreshBtn) {
        ui.refreshBtn.disabled = true;
      }

      try {
        const { data, error } = await client
          .from(CONFIG.memoTable)
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;

        state.records = (data || []).map(mapMemo);

        setDatabaseStatus("online", "Office memo database connected");
        render();

        if (notify) {
          showToast("Office memorandum records refreshed.");
        }
      } catch (error) {
        console.error("Unable to load office memorandums:", error);

        setDatabaseStatus("offline", "Unable to load office memos");

        const localRecords = loadLocalRecords();

        if (localRecords.length) {
          state.records = localRecords;
          render();
          showToast(
            "Database unavailable. Showing locally cached memorandum data.",
            "warning"
          );
        } else {
          state.records = [];
          render();
          showToast(
            "Unable to load memorandum records from the database.",
            "error"
          );
        }
      } finally {
        state.loading = false;

        if (ui.refreshBtn) {
          ui.refreshBtn.disabled = false;
        }
      }
    }

    function loadLocalRecords() {
      try {
        const raw =
          JSON.parse(localStorage.getItem("officeMemos") || "[]");

        return Array.isArray(raw)
          ? raw.map((record) => mapMemo({ data: record, id: record.id }))
          : [];
      } catch {
        return [];
      }
    }

    function subscribeToRealtime() {
      if (!client || state.realtimeChannel) return;

      state.realtimeChannel = client
        .channel("user-office-memos-live")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: CONFIG.memoTable
          },
          () => {
            loadMemos();
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setDatabaseStatus("online", "Office memo database connected");
          }
        });
    }

    const documentViewer={version:0,renderVersion:0,abort:null,task:null,pdf:null,render:null,chain:Promise.resolve(),url:'',page:1};
    const docToolbar=$('#memoDocumentToolbar'),docCanvas=$('#memoUserPdfCanvas'),docImage=$('#memoUserDocumentImage'),docText=$('#memoUserDocumentText'),docLabel=$('#memoUserPageLabel'),docDownload=$('#memoUserDownload');
    let pdfLibrary=null;
    function cleanDocumentViewer(){
      documentViewer.version++;documentViewer.renderVersion++;documentViewer.abort?.abort();documentViewer.render?.cancel();
      if(documentViewer.task)Promise.resolve(documentViewer.task.destroy()).catch(()=>{});
      if(documentViewer.url)URL.revokeObjectURL(documentViewer.url);
      documentViewer.abort=null;documentViewer.task=null;documentViewer.pdf=null;documentViewer.url='';documentViewer.page=1;
      docToolbar.hidden=true;ui.pdfFrame.hidden=true;ui.pdfFrame.setAttribute('aria-busy','false');docCanvas.hidden=true;docCanvas.width=docCanvas.height=0;
      docImage.hidden=true;docImage.removeAttribute('src');docText.hidden=true;docText.textContent='';docDownload.removeAttribute('href');
    }
    function documentMessage(title,message){
      ui.noPdfMessage.classList.remove('hidden');ui.noPdfMessage.querySelector('h3').textContent=title;ui.noPdfMessage.querySelector('p').textContent=message;
    }
    function renderDocumentPage(){
      if(!documentViewer.pdf)return;
      const version=documentViewer.version,renderVersion=++documentViewer.renderVersion,pdf=documentViewer.pdf,number=documentViewer.page;
      documentViewer.render?.cancel();
      documentViewer.chain=documentViewer.chain.catch(()=>{}).then(async()=>{
        if(version!==documentViewer.version||renderVersion!==documentViewer.renderVersion)return;
        const page=await pdf.getPage(number);if(version!==documentViewer.version||renderVersion!==documentViewer.renderVersion)return;
        const base=page.getViewport({scale:1}),available=Math.max(80,ui.pdfFrame.clientWidth-32),viewport=page.getViewport({scale:Math.min(2,available/base.width)});
        const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(12000000/(viewport.width*viewport.height)));
        docCanvas.width=Math.ceil(viewport.width*ratio);docCanvas.height=Math.ceil(viewport.height*ratio);
        docCanvas.style.width=viewport.width+'px';docCanvas.style.height=viewport.height+'px';docCanvas.hidden=false;
        docLabel.textContent=`Page ${number} of ${pdf.numPages}`;$('#memoUserPrevPage').disabled=number<=1;$('#memoUserNextPage').disabled=number>=pdf.numPages;
        ui.pdfFrame.setAttribute('aria-busy','true');const render=page.render({canvasContext:docCanvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});documentViewer.render=render;
        await render.promise;page.cleanup();if(version===documentViewer.version)ui.pdfFrame.setAttribute('aria-busy','false');
      }).catch(error=>{if(version===documentViewer.version&&error.name!=='RenderingCancelledException')documentMessage('Page preview unavailable','Download the document to view it.');});
    }
    function viewerTimeout(promise,ms,message){let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(message)),ms))]).finally(()=>clearTimeout(timer));}
    async function readViewerDocument(record){
      cleanDocumentViewer();const version=documentViewer.version,controller=new AbortController();documentViewer.abort=controller;
      documentMessage(record.fileUrl?'Loading document…':'No Document Attached',record.fileUrl?'Preparing the attachment preview.':'This memorandum does not have a digital attachment.');
      if(!record.fileUrl)return;
      const timer=setTimeout(()=>controller.abort(),25000);
      try{
        const url=await window.PGENRO_API.getDocumentUrl(record.fileUrl);const response=await fetch(url,{signal:controller.signal});
        if(!response.ok)throw Error('The attachment could not be retrieved.');
        if(Number(response.headers.get('Content-Length'))>50*1024*1024)throw Error('The attachment exceeds the 50 MB preview limit.');
        const blob=await response.blob();if(blob.size>50*1024*1024)throw Error('The attachment exceeds the 50 MB preview limit.');
        if(version!==documentViewer.version)return;
        const bytes=new Uint8Array(await blob.arrayBuffer());if(version!==documentViewer.version)return;
        documentViewer.url=URL.createObjectURL(blob);docDownload.href=documentViewer.url;docDownload.download=record.fileName||record.id||'document';docToolbar.hidden=false;
        const mime=blob.type.split(';')[0];
        const pdf=new TextDecoder('ascii').decode(bytes.subarray(0,1024)).includes('%PDF-')||mime==='application/pdf';
        $('#memoUserPrevPage').hidden=$('#memoUserNextPage').hidden=docLabel.hidden=!pdf;
        if(pdf){
          if(!pdfLibrary)pdfLibrary=import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then(lib=>{lib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';return lib;}).catch(e=>{pdfLibrary=null;throw e;});
          const lib=await viewerTimeout(pdfLibrary,15000,'The PDF reader could not load. Use Download document.');if(version!==documentViewer.version)return;
          const task=lib.getDocument({data:bytes,isEvalSupported:false});documentViewer.task=task;
          documentViewer.pdf=await viewerTimeout(task.promise,20000,'This PDF could not open. Use Download document.');if(version!==documentViewer.version)return;
          ui.noPdfMessage.classList.add('hidden');ui.pdfFrame.hidden=false;renderDocumentPage();
        }else if(/^image\/(?:png|jpeg|webp|bmp)$/.test(mime)){
          docImage.src=documentViewer.url;docImage.hidden=false;ui.pdfFrame.hidden=false;ui.noPdfMessage.classList.add('hidden');
        }else if(/^text\//.test(mime)){
          const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';docText.textContent=new TextDecoder(encoding).decode(bytes);docText.hidden=false;ui.pdfFrame.hidden=false;ui.noPdfMessage.classList.add('hidden');
        }else documentMessage('Document ready to download','Use Download document to open this attachment in its application.');
      }catch(error){if(version===documentViewer.version)documentMessage('Preview unavailable',error.name==='AbortError'?'The attachment took too long to load. Close and reopen the viewer.':error.message);}
      finally{clearTimeout(timer);if(documentViewer.abort===controller)documentViewer.abort=null;}
    }
    $('#memoUserPrevPage').onclick=()=>{if(documentViewer.pdf&&documentViewer.page>1){documentViewer.page--;renderDocumentPage();}};
    $('#memoUserNextPage').onclick=()=>{if(documentViewer.pdf&&documentViewer.page<documentViewer.pdf.numPages){documentViewer.page++;renderDocumentPage();}};
    let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(state.viewerOpen)renderDocumentPage();},120);});
    window.addEventListener('pagehide',cleanDocumentViewer);

    function openViewer(index) {
      const record = state.records[index];
      if (!record || !ui.viewerModal) return;

      closeProfile();
      setSidebarOpen(false);

      state.lastFocusedElement = document.activeElement;
      state.viewerOpen = true;

      if (ui.viewerTitle) {
        ui.viewerTitle.textContent =
          `${record.id || "Memorandum"} — Document Viewer`;
      }

      ui.viewerModal.classList.add("open");
      ui.viewerModal.setAttribute("aria-hidden", "false");
      readViewerDocument(record);

      syncOverlay();
      refreshIcons();

      requestAnimationFrame(() => {
        ui.closeViewerBtn?.focus();
      });
    }

    function closeViewer() {
      if (!state.viewerOpen || !ui.viewerModal) return;

      state.viewerOpen = false;

      ui.viewerModal.classList.remove("open");
      ui.viewerModal.setAttribute("aria-hidden", "true");

      cleanDocumentViewer();

      ui.noPdfMessage?.classList.add("hidden");

      syncOverlay();
      state.lastFocusedElement?.focus?.();
    }

    function bindEvents() {
      ui.hamburger?.addEventListener("click", (event) => {
        event.preventDefault();
        closeProfile();
        setSidebarOpen(!ui.sidebar?.classList.contains("open"));
      });

      ui.overlay?.addEventListener("click", () => {
        if (state.viewerOpen) {
          closeViewer();
          return;
        }

        if (ui.sidebar?.classList.contains("open")) {
          setSidebarOpen(false);
        }
      });

      $$(".modules-list a").forEach((link) => {
        link.addEventListener("click", () => {
          closeProfile();

          if (mobileQuery.matches) {
            setSidebarOpen(false);
          }
        });
      });

      ui.profileBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleProfile();
      });

      ui.profileMenu?.addEventListener("click", (event) => {
        event.stopPropagation();
      });

      document.addEventListener("click", (event) => {
        if (
          ui.profileMenu?.classList.contains("open") &&
          !ui.profileMenu.contains(event.target)
        ) {
          closeProfile();
        }
      });

      ui.logoutBtn?.addEventListener("click", (event) => {
        event.preventDefault();
        logout();
      });

      ui.searchInput?.addEventListener("input", PGENRO_PageUI.search(renderTable));

      ui.refreshBtn?.addEventListener("click", () => {
        loadMemos({ notify: true });
      });

      ui.printBtn?.addEventListener("click", () => {
        window.print();
      });

      ui.recordsTable?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-view-index]");
        if (!button) return;

        const index = Number(button.dataset.viewIndex);

        if (Number.isInteger(index)) {
          openViewer(index);
        }
      });

      ui.closeViewerBtn?.addEventListener("click", closeViewer);
      ui.cancelViewerBtn?.addEventListener("click", closeViewer);

      ui.viewerModal?.addEventListener("click", (event) => {
        if (event.target === ui.viewerModal) {
          closeViewer();
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        if (state.viewerOpen) {
          closeViewer();
          return;
        }

        if (ui.profileMenu?.classList.contains("open")) {
          closeProfile();
          ui.profileBtn?.focus();
          return;
        }

        if (ui.sidebar?.classList.contains("open")) {
          setSidebarOpen(false);
          ui.hamburger?.focus();
        }
      });

      const onBreakpointChange = () => {
        closeProfile();
        setSidebarOpen(false);
      };

      if (typeof mobileQuery.addEventListener === "function") {
        mobileQuery.addEventListener("change", onBreakpointChange);
      } else {
        mobileQuery.addListener(onBreakpointChange);
      }

      window.addEventListener("beforeunload", () => {
        if (state.realtimeChannel && client) {
          client.removeChannel(state.realtimeChannel);
        }
      }, { once: true });
    }

    async function start() {
      refreshIcons();
      bindEvents();

      try {
        const cached =
          JSON.parse(localStorage.getItem("pgenro_current_user") || "{}");
        populateProfile(cached);
      } catch {
        populateProfile();
      }

      const allowed = await verifySession();

      if (!allowed && ui.body.dataset.requiresAuth) {
        return;
      }

      await loadMemos();
      subscribeToRealtime();
    }

    start();
  }
})();

/* ===== PGENRO DEPTH MOTION · page-owned, short animations only ===== */
(() => {
  'use strict';
  function initDepthWorkspace() {
    const body = document.body;
    if (!body?.classList.contains('depth-workspace') || body.dataset.depthReady) return;
    body.dataset.depthReady = 'true';
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    document.querySelectorAll('main .kpi-card, main .stat-card, main .metric-card, main .module-control-card')
      .forEach(card => card.classList.add('depth-tilt'));
    let observer;
    function configure() {
      observer?.disconnect();
      body.classList.toggle('depth-motion-paused', document.hidden || reduce.matches);
      if (reduce.matches) {
        document.querySelectorAll('.depth-entered').forEach(el => el.classList.remove('depth-entered'));
        return;
      }
      if (!('IntersectionObserver' in window)) return;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          if (body.dataset.pageTransition === 'entering') { observer.unobserve(el); return; }
          el.classList.add('depth-entered');
          el.addEventListener('animationend', event => {
            if (event.target === el) el.classList.remove('depth-entered');
          }, {once: true});
          observer.unobserve(el);
        });
      }, {threshold: .04});
      document.querySelectorAll('.main-content > section, .main-content > .card, .main-content > .panel, .content-shell > section, .settings-panel.active')
        .forEach((el, index) => {
          if (el.dataset.depthSeen) return;
          el.dataset.depthSeen = 'true';
          el.style.setProperty('--depth-delay', `${Math.min(index, 3) * 40}ms`);
          observer.observe(el);
        });
    }
    configure();
    reduce.addEventListener?.('change', configure);
    document.addEventListener('visibilitychange', () => body.classList.toggle('depth-motion-paused', document.hidden || reduce.matches));
    window.addEventListener('pagehide', () => observer?.disconnect());
    window.addEventListener('pageshow', event => { if (event.persisted) configure(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDepthWorkspace, {once: true});
  else initDepthWorkspace();
})();
/* ===== END PGENRO DEPTH MOTION ===== */

/* ===== PGENRO SLIDE NAVIGATION AND LOGOUT · module-owned presentation ===== */
(() => {
  'use strict';
  function initWorkspaceNavigation() {
    const body = document.body;
    if (!body?.classList.contains('depth-workspace') || body.dataset.navigationReady) return;
    body.dataset.navigationReady = 'true';
    const surface = document.querySelector('main');
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => media.matches || body.classList.contains('pgenro-reduced-motion');
    let navigationPending = false, navigationTimer = 0, entranceTimer = 0;

    function resetTransition() {
      clearTimeout(entranceTimer);
      clearTimeout(navigationTimer);
      navigationPending = false;
      surface?.classList.remove('workspace-slide-enter', 'workspace-slide-leave');
      body.classList.remove('workspace-transitioning');
      body.dataset.pageTransition = 'idle';
    }
    function enter() {
      resetTransition();
      if (!surface || reduced()) return;
      body.classList.add('workspace-transitioning');
      body.dataset.pageTransition = 'entering';
      surface.classList.add('workspace-slide-enter');
      entranceTimer = setTimeout(resetTransition, 280);
    }
    // One short compositor animation, with no continuous rendering loop.
    enter();
    window.addEventListener('pageshow', event => { if (event.persisted) enter(); });
    media.addEventListener?.('change', () => { if (!navigationPending) resetTransition(); });

    window.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self') || link.getAttribute('aria-disabled') === 'true') return;
      const destination = new URL(link.href, location.href);
      if (destination.origin !== location.origin || !/\/(?:admin|User|SettingIMS)\/[^/]+\.html$/i.test(destination.pathname)) return;
      if (destination.pathname === location.pathname && destination.search === location.search) return;
      event.preventDefault();
      if (navigationPending || document.querySelector('dialog[open]')) return;
      navigationPending = true;
      clearTimeout(entranceTimer);
      const go = () => location.assign(destination.href);
      if (reduced() || !surface) { go(); return; }
      surface.classList.remove('workspace-slide-enter');
      surface.classList.add('workspace-slide-leave');
      body.classList.add('workspace-transitioning');
      body.dataset.pageTransition = 'leaving';
      navigationTimer = setTimeout(go, 140);
    });

    let dialog = null, resolveConfirmation = null, confirmationPromise = null, busy = false, returnFocus = null;
    function setBusy(value) {
      busy = value;
      dialog.classList.toggle('is-busy', value);
      dialog.setAttribute('aria-busy', String(value));
      dialog.querySelector('[data-workspace-logout-cancel]').disabled = value;
      dialog.querySelector('[data-workspace-logout-confirm]').disabled = value;
      dialog.querySelector('[data-workspace-logout-confirm] span').textContent = value ? 'Logging out…' : 'Yes, log out';
    }
    function dismiss() {
      if (busy) return;
      const done = resolveConfirmation;
      resolveConfirmation = null; confirmationPromise = null;
      dialog.close();
      body.classList.remove('workspace-logout-open');
      done?.(false);
      if (returnFocus?.isConnected && returnFocus.getClientRects().length && !returnFocus.closest('[inert]')) returnFocus.focus({preventScroll: true});
      else document.querySelector('#profileBtn, [data-pgenro-logout]')?.focus({preventScroll: true});
    }
    function confirmLogout() {
      if (busy) return;
      dialog.querySelector('.workspace-logout-error').textContent = '';
      setBusy(true);
      if (resolveConfirmation) {
        const done = resolveConfirmation; resolveConfirmation = null; done(true);
      } else {
        // Retry uses the existing session gateway; never opens a second prompt.
        window.PGENRO_API?.signOut?.({confirm: false, ask: false});
      }
    }
    function createDialog() {
      if (dialog) return;
      dialog = document.createElement('dialog');
      dialog.id = 'workspaceLogoutDialog';
      dialog.className = 'workspace-logout-dialog';
      dialog.setAttribute('aria-labelledby', 'workspaceLogoutTitle');
      dialog.setAttribute('aria-describedby', 'workspaceLogoutDescription');
      dialog.innerHTML = `
        <div class="workspace-logout-content">
          <div class="workspace-logout-heading"><span class="workspace-logout-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg></span><span class="workspace-logout-brand">PGENRO IMS<span>Secure workspace</span></span></div>
          <h2 id="workspaceLogoutTitle">Log out of your workspace?</h2>
          <p id="workspaceLogoutDescription">You’ll need to sign in again to access your records and office modules.</p>
          <p class="workspace-logout-error" role="alert"></p>
          <div class="workspace-logout-actions"><button type="button" class="workspace-logout-cancel" data-workspace-logout-cancel autofocus>Cancel</button><button type="button" class="workspace-logout-confirm" data-workspace-logout-confirm><span>Yes, log out</span></button></div>
        </div>`;
      body.appendChild(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
      dialog.addEventListener('click', event => {
        event.stopPropagation();
        if (event.target.closest('[data-workspace-logout-cancel]')) dismiss();
        else if (event.target.closest('[data-workspace-logout-confirm]')) confirmLogout();
        else if (event.target === dialog) {
          const rect = dialog.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
        }
      });
    }
    // The auth gateway asks this page-owned UI for confirmation before signing out.
    window.PGENRO_ConfirmLogout = () => {
      if (confirmationPromise) return confirmationPromise;
      createDialog();
      returnFocus = document.activeElement;
      dialog.querySelector('.workspace-logout-error').textContent = '';
      setBusy(false);
      confirmationPromise = new Promise(resolve => { resolveConfirmation = resolve; });
      if (!dialog.open) dialog.showModal();
      body.classList.add('workspace-logout-open');
      dialog.querySelector('[data-workspace-logout-cancel]').focus({preventScroll: true});
      return confirmationPromise;
    };
    window.addEventListener('pgenro:logout-error', () => {
      if (!dialog?.open) return;
      confirmationPromise = null; resolveConfirmation = null;
      setBusy(false);
      dialog.querySelector('.workspace-logout-error').textContent = 'Could not log out. Check your connection and try again.';
      dialog.querySelector('[data-workspace-logout-confirm]').focus({preventScroll: true});
    });
    window.addEventListener('keydown', event => {
      if (!dialog?.open) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); dismiss();
      } else if (event.key === 'Tab') {
        const buttons = [...dialog.querySelectorAll('button:not(:disabled)')];
        if (!buttons.length) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
      }
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initWorkspaceNavigation, {once: true});
  else initWorkspaceNavigation();
})();
/* ===== END PGENRO SLIDE NAVIGATION AND LOGOUT ===== */
