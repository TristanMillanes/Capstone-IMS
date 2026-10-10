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
    table: "communications"
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
    const $ = (selector, parent = document) =>
      parent.querySelector(selector);

    const $$ = (selector, parent = document) =>
      [...parent.querySelectorAll(selector)];

    const ui = {
      body: document.body,
      overlay: $("#overlay"),
      sidebar: $("#sidebar"),
      hamburger: $("#hamburgerMenu"),
      profileMenu: $("#profileMenu"),
      profileBtn: $("#profileBtn"),
      profileDropdown: $("#profileDropdown"),
      logoutBtn: $("#logoutBtn"),
      recordsTable: $("#recordsTable"),
      searchInput: $("#searchInput"),
      statusFilter: $("#statusFilter"),
      recordTotalLabel: $("#recordTotalLabel"),
      refreshBtn: $("#refreshRecordsBtn"),
      lastUpdated: $("#lastUpdated"),
      viewModal: $("#viewModal"),
      viewModalClose: $("#viewModalClose"),
      modalDoneBtn: $("#modalDoneBtn"),
      copyControlBtn: $("#copyControlBtn"),
      scrollToTopBtn: $("#scrollToTopBtn"),
      toastContainer: $("#toastContainer")
    };

    const state = {
      records: [],
      typeFilter: "All",
      realtimeChannel: null,
      selectedRecord: null,
      lastFocusedElement: null,
      loading: false
    };

    const mobileQuery = window.matchMedia("(max-width: 1024px)");

    const refreshIcons = () => {
      PGENRO_PageUI.icons();
    };

    const value = (input) => String(input ?? "").trim();

    const lower = (input) => value(input).toLowerCase();

    const first = (...items) => {
      return items.find((item) =>
        item !== undefined &&
        item !== null &&
        value(item) !== ""
      ) ?? "";
    };

    const safeUrl = (url) => {
      const candidate = value(url);

      if (!candidate) {
        return "";
      }

      if(/^data:(?:application\/(?:pdf|vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))|image\/(?:png|jpeg|webp|bmp|tiff)|text\/(?:plain|csv))(?:;[^,]*)?,/i.test(candidate))return candidate;
      try {
        const parsed = new URL(candidate, window.location.href);

        return ["http:", "https:"].includes(parsed.protocol)
          ? parsed.href
          : "";
      } catch {
        return "";
      }
    };

    function showToast(message) {
      if (!ui.toastContainer) {
        return;
      }

      const toast = document.createElement("div");

      toast.className = "toast";
      toast.textContent = message;

      ui.toastContainer.appendChild(toast);

      window.setTimeout(() => {
        toast.remove();
      }, 2800);
    }

    function setDatabaseStatus(type, message) {
      const indicator = $("#dbStatusIndicator");
      const text = $("#dbStatusText");

      if (indicator) {
        indicator.className = `status-indicator ${type}`;
      }

      if (text) {
        text.textContent = message;
      }
    }

    function normalizeType(input) {
      const normalized = lower(input);

      if (normalized.includes("incoming") || normalized === "in") {
        return "Incoming";
      }

      if (normalized.includes("outgoing") || normalized === "out") {
        return "Outgoing";
      }

      return value(input) || "Unspecified";
    }

    function normalizeStatus(input) {
      const normalized = lower(input);

      const knownStatuses = {
        pending: "Pending",
        received: "Received",
        forwarded: "Forwarded",
        released: "Released",
        archived: "Archived"
      };

      return knownStatuses[normalized] || value(input) || "Pending";
    }

    function mapRecord(row = {}) {
      const data =
        row.data &&
        typeof row.data === "object" &&
        !Array.isArray(row.data)
          ? row.data
          : {};

      const source = {
        ...row,
        ...data
      };

      const type = normalizeType(
        first(
          source.type,
          source.communicationType,
          source.communication_type,
          source.direction,
          source.recordType,
          source.record_type
        )
      );

      const incomingOffice = first(
        source.senderOffice,
        source.sender_office,
        source.fromOffice,
        source.from_office,
        source.sender
      );

      const outgoingOffice = first(
        source.recipientOffice,
        source.recipient_office,
        source.toOffice,
        source.to_office,
        source.recipient
      );

      return {
        id: value(
          first(
            source.id,
            window.crypto?.randomUUID?.(),
            Date.now()
          )
        ),

        controlNo: value(
          first(
            source.controlNo,
            source.control_no,
            source.controlNumber,
            source.control_number,
            source.trackingNo,
            source.tracking_no
          )
        ),

        referenceNo: value(
          first(
            source.referenceNo,
            source.reference_no,
            source.documentNo,
            source.document_no
          )
        ),

        date: value(
          first(
            source.date,
            source.documentDate,
            source.document_date,
            source.dateReceived,
            source.date_received,
            source.dateReleased,
            source.date_released,
            source.createdAt,
            source.created_at
          )
        ),

        type,

        documentType: value(
          first(
            source.documentType,
            source.document_type,
            source.category,
            source.documentCategory,
            source.document_category
          )
        ),

        office: value(
          first(
            source.office,
            source.officeName,
            source.office_name,
            type === "Incoming"
              ? incomingOffice
              : outgoingOffice,
            incomingOffice,
            outgoingOffice
          )
        ),

        subject: value(
          first(
            source.subject,
            source.particulars,
            source.subjectParticulars,
            source.subject_particulars,
            source.title,
            source.description
          )
        ),

        action: value(
          first(
            source.actionTaken,
            source.action_taken,
            source.action,
            source.routingAction,
            source.routing_action
          )
        ),

        dateForwarded: value(
          first(
            source.dateForwarded,
            source.date_forwarded,
            source.forwardedAt,
            source.forwarded_at,
            source.actionDate,
            source.action_date
          )
        ),

        status: normalizeStatus(
          first(
            source.status,
            source.recordStatus,
            source.record_status
          )
        ),

        receivedBy: value(
          first(
            source.receivedBy,
            source.received_by,
            source.releasedBy,
            source.released_by,
            source.processedBy,
            source.processed_by,
            source.encoder
          )
        ),

        remarks: value(
          first(
            source.remarks,
            source.notes,
            source.comment,
            source.comments
          )
        ),

        ocrText: value(
          first(
            source.ocrText,
            source.ocr_text,
            source.extractedText,
            source.extracted_text,
            source.content
          )
        ),

        attachmentName: value(
          first(
            source.attachmentName,
            source.attachment_name,
            source.fileName,
            source.file_name,
            source.documentName,
            source.document_name
          )
        ),

        attachmentUrl: safeUrl(
          first(
            source.attachmentUrl,
            source.attachment_url,
            source.fileUrl,
            source.file_url,
            source.driveLink,
            source.drive_link,
            source.documentUrl,
            source.document_url
          )
        ),

        createdAt: value(
          first(
            source.createdAt,
            source.created_at
          )
        ),

        updatedAt: value(
          first(
            source.updatedAt,
            source.updated_at
          )
        )
      };
    }

    function formatDate(input, includeTime = false) {
      const raw = value(input);

      if (!raw) {
        return "—";
      }

      const date = new Date(raw);

      if (Number.isNaN(date.getTime())) {
        return raw;
      }

      const options = {
        year: "numeric",
        month: "short",
        day: "2-digit",
        ...(includeTime
          ? {
              hour: "numeric",
              minute: "2-digit"
            }
          : {})
      };

      return new Intl.DateTimeFormat("en-PH", options).format(date);
    }

    function statusClass(status) {
      return (
        lower(status).replace(/[^a-z0-9_-]/g, "") ||
        "pending"
      );
    }

    function setText(selector, input, fallback = "—") {
      const node = $(selector);

      if (node) {
        node.textContent = value(input) || fallback;
      }
    }

    function syncOverlay() {
      const sidebarOpen =
        mobileQuery.matches &&
        ui.sidebar?.classList.contains("open");

      const modalOpen =
        ui.viewModal?.classList.contains("open");

      const isActive = Boolean(sidebarOpen || modalOpen);

      ui.overlay?.classList.toggle("active", isActive);
      ui.overlay?.setAttribute(
        "aria-hidden",
        String(!isActive)
      );

      ui.body.classList.toggle(
        "sidebar-open",
        Boolean(sidebarOpen)
      );

      ui.body.classList.toggle(
        "modal-open",
        Boolean(modalOpen)
      );
    }

    function closeProfile() {
      ui.profileMenu?.classList.remove("open");

      ui.profileBtn?.setAttribute(
        "aria-expanded",
        "false"
      );

      ui.profileDropdown?.setAttribute(
        "aria-hidden",
        "true"
      );
    }

    function setSidebarOpen(open) {
      const shouldOpen = Boolean(
        open && mobileQuery.matches
      );

      ui.sidebar?.classList.toggle(
        "open",
        shouldOpen
      );

      ui.hamburger?.classList.toggle(
        "active",
        shouldOpen
      );

      ui.hamburger?.setAttribute(
        "aria-expanded",
        String(shouldOpen)
      );

      ui.hamburger?.setAttribute(
        "aria-label",
        shouldOpen
          ? "Close module menu"
          : "Open module menu"
      );

      syncOverlay();
    }

    let communicationFileVersion=0,communicationBlobUrl="";
    async function openModal(record) {
      if (!record || !ui.viewModal) {
        return;
      }

      const fileVersion=++communicationFileVersion;
      if(communicationBlobUrl){URL.revokeObjectURL(communicationBlobUrl);communicationBlobUrl="";}
      state.selectedRecord = record;
      state.lastFocusedElement = document.activeElement;

      setText("#viewControlNo", record.controlNo);
      setText("#viewType", record.type);
      setText("#viewDocType", record.documentType);
      setText("#viewDate", formatDate(record.date));
      setText("#viewReferenceNo", record.referenceNo);
      setText("#viewReceivedBy", record.receivedBy);
      setText("#viewOffice", record.office);
      setText("#viewSubject", record.subject);
      setText("#viewAction", record.action);
      setText(
        "#viewDateForwarded",
        formatDate(record.dateForwarded)
      );
      setText("#viewRemarks", record.remarks);

      setText(
        "#viewOcrText",
        record.ocrText,
        "No extracted text is available for this record."
      );

      setText(
        "#viewAttachmentName",
        record.attachmentName,
        record.attachmentUrl
          ? "Linked document"
          : "No attachment"
      );

      setText(
        "#viewAttachmentHint",
        record.attachmentUrl
          ? "Open the document in a new tab."
          : "No file is linked to this record."
      );

      const statusNode = $("#viewStatus");

      if (statusNode) {
        statusNode.textContent = record.status;
        statusNode.className =
          `badge-status ${statusClass(record.status)}`;
      }

      const attachmentCard = $(".attachment-card");
      const attachmentLink = $("#viewAttachmentLink");

      attachmentCard?.classList.toggle(
        "no-file",
        !record.attachmentUrl
      );

      if (attachmentLink) {
        attachmentLink.removeAttribute('href');attachmentLink.setAttribute('aria-disabled','true');
        if(record.attachmentUrl){
          window.PGENRO_API.getDocumentUrl(record.attachmentUrl).then(async url=>{
            if(url.startsWith('data:')){const blob=await (await fetch(url)).blob();url=URL.createObjectURL(blob);if(fileVersion!==communicationFileVersion){URL.revokeObjectURL(url);return;}communicationBlobUrl=url;}
            if(fileVersion!==communicationFileVersion)return;
            attachmentLink.href=url;attachmentLink.removeAttribute('aria-disabled');attachmentLink.download=record.attachmentName||'document';
          }).catch(error=>{if(fileVersion===communicationFileVersion)setText('#viewAttachmentHint',error.message);});
        }
      }

      ui.viewModal.classList.add("open");

      ui.viewModal.setAttribute(
        "aria-hidden",
        "false"
      );

      syncOverlay();
      refreshIcons();

      requestAnimationFrame(() => {
        ui.viewModalClose?.focus();
      });
    }

    function closeModal() {
      communicationFileVersion++;if(communicationBlobUrl){URL.revokeObjectURL(communicationBlobUrl);communicationBlobUrl="";}
      if (!ui.viewModal?.classList.contains("open")) {
        return;
      }

      ui.viewModal.classList.remove("open");

      ui.viewModal.setAttribute(
        "aria-hidden",
        "true"
      );

      state.selectedRecord = null;

      syncOverlay();

      state.lastFocusedElement?.focus?.();
    }

    function filteredRecords() {
      const search = lower(ui.searchInput?.value);

      const selectedStatus =
        ui.statusFilter?.value || "All";

      return state.records.filter((record) => {
        const matchesType =
          state.typeFilter === "All" ||
          record.type === state.typeFilter;

        const matchesStatus =
          selectedStatus === "All" ||
          lower(record.status) === lower(selectedStatus);

        const searchableText = [
          record.controlNo,
          record.referenceNo,
          record.type,
          record.documentType,
          record.office,
          record.subject,
          record.action,
          record.status,
          record.remarks,
          record.ocrText
        ]
          .map(lower)
          .join(" ");

        const matchesSearch =
          !search ||
          searchableText.includes(search);

        return (
          matchesType &&
          matchesStatus &&
          matchesSearch
        );
      });
    }

    function renderRecords() {
      if (!ui.recordsTable) {
        return;
      }

      const filtered = filteredRecords();
      const pageRows = PGENRO_PageUI.paginate(filtered, ui.recordsTable, renderRecords);

      if (ui.recordTotalLabel) {
        ui.recordTotalLabel.textContent =
          `${filtered.length} ${
            filtered.length === 1
              ? "record"
              : "records"
          }`;
      }

      if (!filtered.length) {
        ui.recordsTable.innerHTML = `
          <tr>
            <td class="empty" colspan="7">
              No matching communication records found.
            </td>
          </tr>
        `;

        return;
      }

      const fragment = document.createDocumentFragment();

      pageRows.forEach((record) => {
        const row = document.createElement("tr");
        const index = state.records.indexOf(record);

        const controlCell =
          document.createElement("td");

        const controlStrong =
          document.createElement("strong");

        controlStrong.textContent =
          record.controlNo || "No control number";

        const typeSmall =
          document.createElement("small");

        typeSmall.textContent = [
          record.type,
          record.documentType
        ]
          .filter(Boolean)
          .join(" • ");

        controlCell.append(
          controlStrong,
          document.createElement("br"),
          typeSmall
        );

        const dateCell =
          document.createElement("td");

        dateCell.textContent =
          formatDate(record.date);

        const officeCell =
          document.createElement("td");

        officeCell.textContent =
          record.office || "—";

        const subjectCell =
          document.createElement("td");

        subjectCell.textContent =
          record.subject || "—";

        const actionCell =
          document.createElement("td");

        actionCell.textContent =
          record.action ||
          (
            record.dateForwarded
              ? `Forwarded ${formatDate(record.dateForwarded)}`
              : "—"
          );

        const statusCell =
          document.createElement("td");

        const statusBadge =
          document.createElement("span");

        statusBadge.className =
          `badge-status ${statusClass(record.status)}`;

        statusBadge.textContent = record.status;

        statusCell.appendChild(statusBadge);

        const buttonCell =
          document.createElement("td");

        buttonCell.className = "action-column";

        const button =
          document.createElement("button");

        button.className =
          "btn-icon-action view-record-btn";

        button.type = "button";
        button.dataset.recordIndex = String(index);
        button.title = "View complete details";

        button.setAttribute(
          "aria-label",
          `View details for ${
            record.controlNo ||
            "communication record"
          }`
        );

        button.innerHTML =
          '<i data-lucide="eye"></i>';

        buttonCell.appendChild(button);

        row.append(
          controlCell,
          dateCell,
          officeCell,
          subjectCell,
          actionCell,
          statusCell,
          buttonCell
        );

        fragment.appendChild(row);
      });

      ui.recordsTable.replaceChildren(fragment);

      refreshIcons();
    }

    function updateSummary() {
      const total = state.records.length;

      const incoming = state.records.filter(
        (record) => record.type === "Incoming"
      ).length;

      const outgoing = state.records.filter(
        (record) => record.type === "Outgoing"
      ).length;

      const pending = state.records.filter(
        (record) => record.status === "Pending"
      ).length;

      setText("#totalRecords", total, "0");
      setText("#incomingCount", incoming, "0");
      setText("#outgoingCount", outgoing, "0");
      setText("#pendingCount", pending, "0");
    }

    function loadLocalFallback() {
      try {
        const stored = JSON.parse(
          localStorage.getItem(
            "communicationRecords"
          ) || "[]"
        );

        state.records = Array.isArray(stored)
          ? stored.map(mapRecord)
          : [];
      } catch {
        state.records = [];
      }

      renderRecords();
      updateSummary();
    }

    async function loadCommunicationRecords({
      announce = false
    } = {}) {
      if (state.loading) {
        return;
      }

      state.loading = true;

      ui.refreshBtn?.classList.add("loading");
      ui.refreshBtn?.setAttribute("disabled", "");

      if (!client) {
        loadLocalFallback();

        setDatabaseStatus(
          "standby",
          "Local records ready"
        );

        if (ui.lastUpdated) {
          ui.lastUpdated.textContent =
            "Database SDK unavailable";
        }

        state.loading = false;

        ui.refreshBtn?.classList.remove("loading");
        ui.refreshBtn?.removeAttribute("disabled");

        return;
      }

      setDatabaseStatus(
        "standby",
        "Loading office records…"
      );

      try {
        const { data, error } = await client
          .from(CONFIG.table)
          .select("*")
          .order("created_at", {
            ascending: false
          });

        if (error) {
          throw error;
        }

        state.records = (data || []).map(mapRecord);

        renderRecords();
        updateSummary();

        setDatabaseStatus(
          "online",
          "Office records connected"
        );

        if (ui.lastUpdated) {
          const time = new Intl.DateTimeFormat(
            "en-PH",
            {
              hour: "numeric",
              minute: "2-digit"
            }
          ).format(new Date());

          ui.lastUpdated.textContent =
            `Updated ${time}`;
        }

        if (announce) {
          showToast(
            "Communication records refreshed."
          );
        }
      } catch (error) {
        console.error(
          "Unable to load communication records:",
          error
        );

        loadLocalFallback();

        setDatabaseStatus(
          "offline",
          "Unable to load office records"
        );

        if (ui.lastUpdated) {
          ui.lastUpdated.textContent =
            "Showing available local records";
        }

        if (announce) {
          showToast(
            "Could not refresh database records."
          );
        }
      } finally {
        state.loading = false;

        ui.refreshBtn?.classList.remove("loading");
        ui.refreshBtn?.removeAttribute("disabled");
      }
    }

    function subscribeToChanges() {
      if (!client || state.realtimeChannel) {
        return;
      }

      state.realtimeChannel = client
        .channel("user-communications-live")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: CONFIG.table
          },
          () => {
            loadCommunicationRecords();
          }
        )
        .subscribe();
    }

    async function loadProfileAndGuard() {
      if (!client || !ui.body.dataset.requiresAuth) {
        return;
      }

      try {
        const { data, error } =
          await client.auth.getSession();

        if (error) {
          throw error;
        }

        if (!data.session) {
          window.location.replace("login.html");
          return;
        }

        const user = data.session.user;

        const {
          data: profile,
          error: profileError
        } = await client
          .from("profiles")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (profileError) {
          console.warn(
            "Profile details were unavailable:",
            profileError
          );

          populateProfile({
            email: user.email
          });

          return;
        }

        const currentRole = lower(profile?.role).replace(/\s+/g, " ").trim();
        if (["admin", "administrator", "super admin", "superadmin", "system administrator"].includes(currentRole)) {
          window.location.replace("../admin/admin.html");
          return;
        }

        const merged = {
          ...(profile || {}),
          email: profile?.email || user.email
        };

        populateProfile(merged);

        localStorage.setItem(
          "pgenro_current_user",
          JSON.stringify({
            id: user.id,
            fullName: first(
              merged.full_name,
              merged.username
            ),
            email: merged.email,
            role: first(
              merged.position,
              merged.role,
              "Authorized account"
            )
          })
        );
      } catch (error) {
        console.error(
          "Unable to verify the current session:",
          error
        );
      }
    }

    function populateProfile(profile = {}) {
      const name = first(
        profile.fullName,
        profile.full_name,
        profile.username,
        profile.name,
        "PGENRO User"
      );

      const role = first(
        profile.position,
        profile.role,
        profile.accountType,
        "Authorized account"
      );

      const email = first(
        profile.email,
        profile.authUser?.email,
        "Office account"
      );

      $$(".profile-text strong").forEach((node) => {
        node.textContent = name;
      });

      $$(".profile-text small").forEach((node) => {
        node.textContent = role;
      });

      $$(".profile-dropdown-header h3").forEach(
        (node) => {
          node.textContent = name;
        }
      );

      $$(".profile-dropdown-header p").forEach(
        (node) => {
          node.textContent = email;
        }
      );
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

    async function logout() {
      if (!(await showLogoutDialog())) {
        return;
      }

      try {
        await client?.auth.signOut();
      } catch (error) {
        console.warn(
          "Remote sign-out was unavailable:",
          error
        );
      }

      try {
        for (const key of Object.keys(localStorage)) {
          if (
            key.startsWith("sb-") ||
            key.startsWith("pgenro_")
          ) {
            localStorage.removeItem(key);
          }
        }

        sessionStorage.clear();
      } catch {
        // Continue redirecting even if browser storage
        // cannot be cleared.
      }

      window.location.assign("login.html");
    }

    ui.hamburger?.addEventListener("click", () => {
      closeProfile();

      setSidebarOpen(
        !ui.sidebar?.classList.contains("open")
      );
    });

    ui.overlay?.addEventListener("click", () => {
      if (ui.viewModal?.classList.contains("open")) {
        closeModal();
      } else {
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

    ui.profileBtn?.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();

        const open =
          !ui.profileMenu.classList.contains("open");

        closeProfile();

        if (open) {
          ui.profileMenu.classList.add("open");

          ui.profileBtn.setAttribute(
            "aria-expanded",
            "true"
          );

          ui.profileDropdown.setAttribute(
            "aria-hidden",
            "false"
          );
        }
      }
    );

    ui.profileMenu?.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();
      }
    );

    document.addEventListener(
      "click",
      closeProfile
    );

    ui.logoutBtn?.addEventListener(
      "click",
      logout
    );

    ui.recordsTable?.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest(
          ".view-record-btn"
        );

        if (!button) {
          return;
        }

        const index = Number(
          button.dataset.recordIndex
        );

        openModal(state.records[index]);
      }
    );

    $$(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => {
        state.typeFilter =
          button.dataset.filter || "All";

        $$(".tab-btn").forEach((tab) => {
          const active = tab === button;

          tab.classList.toggle(
            "active",
            active
          );

          tab.setAttribute(
            "aria-selected",
            String(active)
          );
        });

        renderRecords();
      });
    });

    ui.searchInput?.addEventListener(
      "input",
      PGENRO_PageUI.search(renderRecords)
    );

    ui.statusFilter?.addEventListener(
      "change",
      renderRecords
    );

    ui.refreshBtn?.addEventListener(
      "click",
      () => {
        loadCommunicationRecords({
          announce: true
        });
      }
    );

    ui.viewModalClose?.addEventListener(
      "click",
      closeModal
    );

    ui.modalDoneBtn?.addEventListener(
      "click",
      closeModal
    );

    ui.copyControlBtn?.addEventListener(
      "click",
      async () => {
        const controlNo =
          state.selectedRecord?.controlNo;

        if (!controlNo) {
          showToast(
            "This record has no control number."
          );

          return;
        }

        try {
          await navigator.clipboard.writeText(
            controlNo
          );

          showToast(
            "Control number copied."
          );
        } catch {
          showToast(
            "Unable to copy the control number."
          );
        }
      }
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          if (
            ui.viewModal?.classList.contains(
              "open"
            )
          ) {
            closeModal();
          } else if (
            ui.sidebar?.classList.contains("open")
          ) {
            setSidebarOpen(false);
          } else {
            closeProfile();
          }
        }

        if (
          event.key === "Tab" &&
          ui.viewModal?.classList.contains("open")
        ) {
          const focusable = $$(
            "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])",
            ui.viewModal
          );

          if (!focusable.length) {
            return;
          }

          const firstNode = focusable[0];
          const lastNode =
            focusable[focusable.length - 1];

          if (
            event.shiftKey &&
            document.activeElement === firstNode
          ) {
            event.preventDefault();
            lastNode.focus();
          } else if (
            !event.shiftKey &&
            document.activeElement === lastNode
          ) {
            event.preventDefault();
            firstNode.focus();
          }
        }
      }
    );

    const revealElements = $$(".reveal");

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) {
              return;
            }

            entry.target.classList.add("show");
            observer.unobserve(entry.target);
          });
        },
        {
          threshold: 0.05
        }
      );

      revealElements.forEach((element) => {
        observer.observe(element);
      });
    } else {
      revealElements.forEach((element) => {
        element.classList.add("show");
      });
    }

    const updateScrollButton = () => {
      ui.scrollToTopBtn?.classList.toggle(
        "visible",
        window.scrollY > 320
      );
    };

    window.addEventListener(
      "scroll",
      updateScrollButton,
      {
        passive: true
      }
    );

    ui.scrollToTopBtn?.addEventListener(
      "click",
      () => {
        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      }
    );

    updateScrollButton();

    const breakpointChanged = () => {
      closeProfile();
      setSidebarOpen(false);
    };

    if (
      typeof mobileQuery.addEventListener ===
      "function"
    ) {
      mobileQuery.addEventListener(
        "change",
        breakpointChanged
      );
    } else {
      mobileQuery.addListener(
        breakpointChanged
      );
    }

    try {
      const storedProfile = JSON.parse(
        localStorage.getItem(
          "pgenro_current_user"
        ) || "{}"
      );

      populateProfile(storedProfile);
    } catch {
      populateProfile();
    }

    refreshIcons();
    loadProfileAndGuard();

    loadCommunicationRecords().then(() => {
      subscribeToChanges();
    });

    window.addEventListener(
      "beforeunload",
      () => {
        if (
          state.realtimeChannel &&
          client
        ) {
          client.removeChannel(
            state.realtimeChannel
          );
        }
      },
      {
        once: true
      }
    );
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
