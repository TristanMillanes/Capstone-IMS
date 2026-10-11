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

    const mobileQuery = window.matchMedia("(max-width: 900px)");

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
        if (['admin'].includes(currentRole)) {
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
      docToolbar.hidden=true;$('#memoUserZoom').value='fit';ui.pdfFrame.hidden=true;ui.pdfFrame.setAttribute('aria-busy','false');docCanvas.hidden=true;docCanvas.width=docCanvas.height=0;
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
        const base=page.getViewport({scale:1}),style=getComputedStyle(ui.pdfFrame),available=Math.max(80,ui.pdfFrame.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight));const zoom=$('#memoUserZoom').value;const viewport=page.getViewport({scale:zoom==='fit'?available/base.width:Number(zoom)});
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
          if(!pdfLibrary)pdfLibrary=import('../vendor/pdfjs/pdf.min.mjs').then(lib=>{lib.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdfjs/pdf.worker.min.mjs',location.href).href;return lib;}).catch(e=>{pdfLibrary=null;throw e;});
          const lib=await viewerTimeout(pdfLibrary,15000,'The PDF reader could not load. Use Download document.');if(version!==documentViewer.version)return;
          const task=lib.getDocument({data:bytes,isEvalSupported:false,cMapUrl:new URL('../vendor/pdfjs/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('../vendor/pdfjs/standard_fonts/',location.href).href});documentViewer.task=task;
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
    $('#memoUserZoom').addEventListener('change',renderDocumentPage);
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

/* PGENRO module notifications, 10 October 2026. */
/* Module-owned notifications: copies live inside each workspace page script. */
(() => {
  'use strict';
  if (window.PGENRO_Notifications) return;
  const modules = {
    communications:['Communications','admincommunication.html','communication.html'],
    travel_orders:['Travel Orders','travelOR-admin.html','travelOR.html'],
    office_memos:['Office Memos','officememo-admin.html','officememo.html'],
    employees:['Employees','employee-admin.html','employee.html'],
    inventory:['Inventory','invetoryadmin.html','inventory.html'],
    visitors:['Visitors','visitors-admin.html','visitorsView.html'],
    service_requests:['Service Requests','serviceAdmin.html','service.html'],
    ics_records:['Property Slips','ics-admin.html','ics.html'],
    user_accounts:['User Management','Usermanagement.html',null],
    account_requests:['Account Requests','requestacc.html',null]
  };
  const empty=()=>({total:0,counts:{},items:[],workspace:'user'});
  let feed=empty(),status='loading',db,userId='',generation=0,loading=false,again=false,disposed=false;
  let wrapper,button,panel,list,count,markAll,badge,channel,timer,debounce,authSubscription;
  const element=(tag,className,text)=>{const el=document.createElement(tag);el.className=className||'';if(text!==undefined)el.textContent=text;return el;};
  function destination(module){
    const info=modules[module],admin=feed.workspace==='admin',file=info?.[admin?1:2];
    return file?new URL(`../${admin?'admin':'User'}/${file}`,location.href).href:null;
  }
  function render(){
    if(!button)return;
    const total=Number(feed.total)||0;
    badge.textContent=total>99?'99+':String(total);badge.hidden=!total;
    count.textContent=`${total} unread`;markAll.disabled=!total||status!=='ready';
    button.setAttribute('aria-label',`Notifications${total?`, ${total} unread`:''}`);
    list.replaceChildren();
    if(status==='loading')list.append(element('p','module-notification-empty','Loading notifications…'));
    else if(status==='unavailable')list.append(element('p','module-notification-empty','Notifications are unavailable. Try again.'));
    else if(!total)list.append(element('p','module-notification-empty','No new notifications'));
    for(const item of feed.items||[]){
      const href=destination(item.module);if(!href)continue;
      const link=element('a','module-notification-item');link.href=href;link.dataset.notificationId=item.id;
      const dot=element('span','module-notification-dot');dot.setAttribute('aria-hidden','true');
      const copy=element('span','module-notification-copy');copy.append(element('strong','',modules[item.module][0]));
      copy.append(element('span','module-notification-title',item.title||'New record added'));
      const date=new Date(item.createdAt);copy.append(element('small','',Number.isNaN(date.getTime())?'New record':date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})));
      link.append(dot,copy);link.addEventListener('click',async event=>{
        event.preventDefault();link.setAttribute('aria-busy','true');
        try{await markRead({p_ids:[item.id]});}catch{/* The destination remains usable if marking read fails. */}
        location.assign(href);
      });list.append(link);
    }
    if(total>(feed.items||[]).length&&status==='ready')list.append(element('p','module-notification-more',`Showing the latest ${(feed.items||[]).length} new records`));
    document.querySelectorAll('aside a[href], .sidebar a[href]').forEach(link=>{
      const path=new URL(link.getAttribute('href'),location.href).pathname;
      const module=Object.keys(modules).find(key=>destination(key)&&new URL(destination(key)).pathname===path);
      let chip=link.querySelector('.module-new-badge');
      if(!module){chip?.remove();return;}
      const value=Number(feed.counts?.[module])||0;
      if(!chip){chip=element('span','module-new-badge');link.append(chip);}
      chip.dataset.module=module;chip.hidden=!value;chip.textContent=value>99?'99+':String(value);
      chip.setAttribute('aria-label',`${value} new ${modules[module][0]} records`);
    });
    document.body.dataset.notificationsState=status;
  }
  function close(){if(!panel)return;panel.hidden=true;button.setAttribute('aria-expanded','false');}
  function position(){
    const rect=button.getBoundingClientRect(),width=Math.min(390,innerWidth-24);
    panel.style.width=`${width}px`;panel.style.right=`${Math.min(Math.max(12,innerWidth-rect.right),innerWidth-width-12)}px`;
    panel.style.top=`${Math.min(Math.max(12,rect.bottom+10),innerHeight-160)}px`;
  }
  async function refresh(){
    if(disposed||!db||!userId)return;
    if(loading){again=true;return;}
    loading=true;const token=generation;
    try{
      const result=await db.rpc('pgenro_get_module_notifications',{p_limit:30});
      if(token!==generation||disposed)return;
      if(result.error)throw result.error;
      const data=result.data;
      if(!data||!Array.isArray(data.items)||typeof data.counts!=='object')throw new Error('Invalid notification response');
      feed=data;status='ready';render();
    }catch{if(token===generation&&!disposed){feed=empty();status='unavailable';render();}}
    finally{loading=false;if(again){again=false;scheduleRefresh();}}
  }
  function scheduleRefresh(){clearTimeout(debounce);debounce=setTimeout(refresh,250);}
  async function markRead(args={}){
    const result=await db.rpc('pgenro_mark_notifications_read',args);if(result.error)throw result.error;
    await refresh();
  }
  async function attachSession(user){
    if(disposed)return;
    if(!user?.id){generation++;userId='';feed=empty();status='unavailable';close();render();if(channel)db.removeChannel(channel);channel=null;return;}
    if(userId===user.id){scheduleRefresh();return;}
    generation++;userId=user.id;feed=empty();status='loading';render();
    if(channel)db.removeChannel(channel);
    channel=db.channel(`pgenro-module-notifications-${user.id}`)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'pgenro_module_notifications'},scheduleRefresh)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'pgenro_notification_reads',filter:`user_id=eq.${user.id}`},scheduleRefresh)
      .subscribe(state=>{if(state==='SUBSCRIBED')scheduleRefresh();});
    await refresh();
  }
  function init(){
    const header=document.querySelector('.topbar-right,.depth-topbar-actions,.settings-topbar');if(!header)return;
    document.getElementById('notificationsBtn')?.closest('.notification-wrapper')?.remove();
    wrapper=element('div','module-notifications');button=element('button','module-notification-button');button.type='button';button.id='moduleNotificationButton';
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','moduleNotificationPanel');
    button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>';
    badge=element('span','module-notification-badge');badge.hidden=true;button.append(badge);wrapper.append(button);
    if(header.classList.contains('settings-topbar'))header.insertBefore(wrapper,header.lastElementChild);else header.prepend(wrapper);
    panel=element('section','module-notification-panel');panel.id='moduleNotificationPanel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','moduleNotificationTitle');
    const top=element('div','module-notification-heading'),heading=element('div');const title=element('h3','','Notifications');title.id='moduleNotificationTitle';
    count=element('small','','0 unread');count.setAttribute('aria-live','polite');heading.append(title,count);
    const closeBtn=element('button','module-notification-close','×');closeBtn.type='button';closeBtn.setAttribute('aria-label','Close notifications');closeBtn.onclick=()=>{close();button.focus();};top.append(heading,closeBtn);
    const tools=element('div','module-notification-tools'),retry=element('button','','Refresh');retry.type='button';retry.onclick=refresh;
    markAll=element('button','','Mark all read');markAll.type='button';markAll.onclick=async()=>{markAll.disabled=true;try{await markRead();}catch{count.textContent='Could not mark read. Try again.';}finally{markAll.disabled=!feed.total;}};
    tools.append(retry,markAll);list=element('div','module-notification-list');panel.append(top,tools,list);document.body.append(panel);
    button.addEventListener('click',()=>{const open=panel.hidden;close();if(open){panel.hidden=false;position();button.setAttribute('aria-expanded','true');closeBtn.focus();refresh();}});
    document.addEventListener('click',event=>{if(!wrapper.contains(event.target)&&!panel.contains(event.target))close();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();button.focus();}});
    window.addEventListener('resize',()=>{if(!panel.hidden)position();});
    window.addEventListener('focus',scheduleRefresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleRefresh();});
    window.addEventListener('pageshow',event=>{if(event.persisted)scheduleRefresh();});
    render();db=window.pgenroSupabase||window.PGENRO_DB?.client;
    if(!db){status='unavailable';render();return;}
    db.auth.getUser().then(result=>attachSession(result.data?.user)).catch(()=>attachSession(null));
    const subscription=db.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>attachSession(session?.user),0);});authSubscription=subscription.data?.subscription;
    timer=setInterval(()=>{if(!document.hidden)refresh();},30000);
    window.addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;generation++;clearInterval(timer);clearTimeout(debounce);authSubscription?.unsubscribe();if(channel)db.removeChannel(channel);});
  }
  window.PGENRO_Notifications={refresh,scheduleRefresh};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
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

