(() => {
  "use strict";

  const CONFIG = Object.freeze({
    url: "https://zssrxubajhqryrwijyzm.supabase.co",
    publishableKey: "sb_publishable_5RWFfJ5oN6ike6SSyafajw_yF9DYApP",
    inventoryTable: "inventory",
    movementsTable: "inventory_movements"
  });

  const client = typeof window.supabase?.createClient === "function"
    ? window.supabase.createClient(CONFIG.url, CONFIG.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      })
    : null;

  window.pgenroSupabase = client;

  window.PGENRO_SUPABASE = Object.freeze({
    ...CONFIG,
    sdkReady: Boolean(client),
    configured: Boolean(client)
  });

  document.addEventListener("DOMContentLoaded", init, {
    once: true
  });

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
      refreshBtn: $("#refreshRecordsBtn"),
      lastUpdated: $("#lastUpdated"),
      openEncodingBtn: $("#openEncodingBtn"),
      formModal: $("#formModal"),
      formModalClose: $("#formModalClose"),
      inventoryForm: $("#inventoryForm"),
      formTitle: $("#formTitle"),
      submitBtn: $("#submitBtn"),
      clearFormBtn: $("#clearFormBtn"),
      editIndex: $("#editIndex"),
      itemId: $("#itemId"),
      itemName: $("#itemName"),
      itemCategory: $("#itemCategory"),
      itemUnit: $("#itemUnit"),
      itemDesc: $("#itemDesc"),
      itemQty: $("#itemQty"),
      itemUsed: $("#itemUsed"),
      itemBalance: $("#itemBalance"),
      itemThreshold: $("#itemThreshold"),
      itemRemarks: $("#itemRemarks"),
      generateReportBtn: $("#generateReportBtn"),
      reportModal: $("#reportModal"),
      reportModalClose: $("#reportModalClose"),
      cancelReportBtn: $("#cancelReportBtn"),
      reportTableBody: $("#reportTableBody"),
      reportSelectAll: $("#reportSelectAll"),
      confirmPrintBtn: $("#confirmPrintBtn"),
      selectionCount: $("#selectionCount"),
      scrollToTopBtn: $("#scrollToTopBtn"),
      toastContainer: $("#toastContainer")
    };

    const state = {
      records: [],
      filter: "All",
      currentProfile: null,
      activeModal: null,
      lastFocusedElement: null,
      realtimeChannels: [],
      loading: false,
      saving: false
    };

    const mobileQuery = window.matchMedia(
      "(max-width: 1024px)"
    );

    const isDatabaseConfigured = Boolean(client);

    const text = (input) =>
      String(input ?? "").trim();

    const lower = (input) =>
      text(input).toLowerCase();

    const number = (input, fallback = 0) => {
      const parsed = Number(input);

      return Number.isFinite(parsed)
        ? parsed
        : fallback;
    };

    const wholeNumber = (input, fallback = 0) =>
      Math.max(
        0,
        Math.trunc(number(input, fallback))
      );

    const first = (...items) =>
      items.find(
        (item) =>
          item !== undefined &&
          item !== null &&
          text(item) !== ""
      ) ?? "";

    const refreshIcons = () => {
      window.lucide?.createIcons?.();
    };

    function escapeHtml(input) {
      return text(input)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function showToast(message, type = "success") {
      if (!ui.toastContainer) {
        return;
      }

      const iconNames = {
        success: "circle-check",
        warning: "triangle-alert",
        error: "circle-alert"
      };

      const toast = document.createElement("div");

      toast.className = `toast ${type}`;

      toast.innerHTML = `
        <i data-lucide="${
          iconNames[type] || iconNames.success
        }"></i>
        <span></span>
      `;

      toast.querySelector("span").textContent =
        message;

      ui.toastContainer.appendChild(toast);

      refreshIcons();

      window.setTimeout(() => {
        toast.remove();
      }, 3200);
    }

    function setDatabaseStatus(type, message) {
      const indicator = $("#dbStatusIndicator");
      const statusText = $("#dbStatusText");

      if (indicator) {
        indicator.className =
          `status-indicator ${type}`;
      }

      if (statusText) {
        statusText.textContent = message;
      }
    }

    function determineStatus(
      balance,
      threshold
    ) {
      if (balance <= 0) {
        return "Out-of-Stock";
      }

      if (balance <= threshold) {
        return "Low-Stock";
      }

      return "In-Stock";
    }

    function statusClass(status) {
      return lower(status).replaceAll(" ", "-");
    }

    function movementTotals(movements = []) {
      const totals = new Map();

      movements.forEach((movement) => {
        const key = text(movement.item_id);

        if (!key) {
          return;
        }

        const quantity = wholeNumber(
          movement.quantity
        );

        const type = lower(
          movement.movement_type
        );

        const current = totals.get(key) || 0;

        if (
          type === "out" ||
          type === "issued" ||
          type === "release"
        ) {
          totals.set(
            key,
            current + quantity
          );
        } else if (
          type === "return" ||
          type === "returned"
        ) {
          totals.set(
            key,
            Math.max(0, current - quantity)
          );
        }
      });

      return totals;
    }

    function mapDatabaseRecord(
      row = {},
      usedByItem = new Map()
    ) {
      const storedBalance = wholeNumber(
        first(
          row.quantity,
          row.balance,
          row.current_quantity
        )
      );

      const movementUsed = usedByItem.get(
        text(row.id)
      );

      const used = wholeNumber(
        first(
          row.total_used,
          row.used_quantity,
          movementUsed,
          0
        )
      );

      const total = wholeNumber(
        first(
          row.total_quantity,
          row.initial_quantity,
          storedBalance + used
        )
      );

      const balance = Math.min(
        total,
        storedBalance
      );

      const threshold = wholeNumber(
        first(
          row.threshold,
          row.low_stock_threshold,
          5
        ),
        5
      );

      return {
        databaseId: row.id,

        itemId: text(
          first(
            row.control_no,
            row.item_id,
            row.item_code
          )
        ),

        name: text(
          first(
            row.item_name,
            row.name
          )
        ),

        category:
          text(row.category) ||
          "Office Supplies",

        unit: text(row.unit),

        description: text(
          first(
            row.description,
            row.item_description
          )
        ),

        total,
        used,
        balance,
        threshold,

        remarks: text(row.remarks),

        status: determineStatus(
          balance,
          threshold
        ),

        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at)
      };
    }

    function mapLocalRecord(record = {}) {
      const total = wholeNumber(
        first(
          record.total,
          record.qty,
          record.quantity
        )
      );

      const used = Math.min(
        total,
        wholeNumber(
          first(
            record.used,
            record.totalUsed
          )
        )
      );

      const balance = Math.max(
        0,
        wholeNumber(
          first(
            record.balance,
            total - used
          )
        )
      );

      const threshold = wholeNumber(
        first(record.threshold, 5),
        5
      );

      return {
        databaseId:
          record.databaseId ||
          record._dbId ||
          null,

        itemId: text(
          first(
            record.itemId,
            record.controlNo,
            record.control_no
          )
        ),

        name: text(
          first(
            record.name,
            record.itemName,
            record.item_name
          )
        ),

        category:
          text(record.category) ||
          "Office Supplies",

        unit: text(record.unit),

        description: text(
          first(
            record.description,
            record.desc
          )
        ),

        total,
        used,
        balance,
        threshold,

        remarks: text(record.remarks),

        status: determineStatus(
          balance,
          threshold
        ),

        createdAt: text(record.createdAt),
        updatedAt: text(record.updatedAt)
      };
    }

    function saveLocalRecords() {
      if (isDatabaseConfigured) {
        return;
      }

      localStorage.setItem(
        "inventoryRecords",
        JSON.stringify(state.records)
      );
    }

    function loadLocalRecords() {
      try {
        const stored = JSON.parse(
          localStorage.getItem(
            "inventoryRecords"
          ) || "[]"
        );

        state.records = Array.isArray(stored)
          ? stored.map(mapLocalRecord)
          : [];
      } catch {
        state.records = [];
      }

      render();
    }

    function calculateBalance({
      notify = true
    } = {}) {
      const total = wholeNumber(
        ui.itemQty?.value
      );

      let used = wholeNumber(
        ui.itemUsed?.value
      );

      if (used > total) {
        used = total;

        if (ui.itemUsed) {
          ui.itemUsed.value = String(used);
        }

        if (notify) {
          showToast(
            "Total used cannot exceed the total quantity.",
            "warning"
          );
        }
      }

      if (ui.itemBalance) {
        ui.itemBalance.value = String(
          total - used
        );
      }
    }

    function generateControlNumber() {
      const year = new Date().getFullYear();

      const pattern = new RegExp(
        `^ITEM-${year}-(\\d+)$`,
        "i"
      );

      const highest = state.records.reduce(
        (maximum, record) => {
          const match = text(
            record.itemId
          ).match(pattern);

          return match
            ? Math.max(
                maximum,
                Number(match[1])
              )
            : maximum;
        },
        0
      );

      return `ITEM-${year}-${String(
        highest + 1
      ).padStart(4, "0")}`;
    }

    function resetForm({
      preserveMode = false
    } = {}) {
      ui.inventoryForm?.reset();

      if (ui.editIndex) {
        ui.editIndex.value = "";
      }

      if (ui.itemId) {
        ui.itemId.value =
          generateControlNumber();
      }

      if (ui.itemCategory) {
        ui.itemCategory.value =
          "Office Supplies";
      }

      if (ui.itemQty) {
        ui.itemQty.value = "0";
      }

      if (ui.itemUsed) {
        ui.itemUsed.value = "0";
      }

      if (ui.itemBalance) {
        ui.itemBalance.value = "0";
      }

      if (ui.itemThreshold) {
        ui.itemThreshold.value = "5";
      }

      if (!preserveMode) {
        if (ui.formTitle) {
          ui.formTitle.textContent =
            "Encode Inventory Item";
        }

        const submitText =
          ui.submitBtn?.querySelector("span");

        if (submitText) {
          submitText.textContent =
            "Save Record";
        }
      }
    }

    function syncOverlay() {
      const sidebarOpen =
        mobileQuery.matches &&
        ui.sidebar?.classList.contains("open");

      const modalOpen = Boolean(
        state.activeModal?.classList.contains(
          "open"
        )
      );

      const active = Boolean(
        sidebarOpen || modalOpen
      );

      ui.overlay?.classList.toggle(
        "active",
        active
      );

      ui.overlay?.setAttribute(
        "aria-hidden",
        String(!active)
      );

      ui.body.classList.toggle(
        "sidebar-open",
        Boolean(sidebarOpen)
      );

      ui.body.classList.toggle(
        "modal-open",
        modalOpen
      );
    }

    function openModal(
      modal,
      focusTarget
    ) {
      if (!modal) {
        return;
      }

      closeProfile();

      state.lastFocusedElement =
        document.activeElement;

      state.activeModal = modal;

      modal.classList.add("open");

      modal.setAttribute(
        "aria-hidden",
        "false"
      );

      syncOverlay();
      refreshIcons();

      requestAnimationFrame(() => {
        focusTarget?.focus();
      });
    }

    function closeModal(
      modal = state.activeModal
    ) {
      if (!modal) {
        return;
      }

      modal.classList.remove("open");

      modal.setAttribute(
        "aria-hidden",
        "true"
      );

      if (state.activeModal === modal) {
        state.activeModal = null;
      }

      syncOverlay();

      state.lastFocusedElement?.focus?.();
    }

    function openCreateForm() {
      resetForm();

      openModal(
        ui.formModal,
        ui.itemName
      );
    }

    function openEditForm(index) {
      const record = state.records[index];

      if (!record) {
        return;
      }

      resetForm({
        preserveMode: true
      });

      ui.editIndex.value = String(index);
      ui.itemId.value = record.itemId;
      ui.itemName.value = record.name;

      ui.itemCategory.value =
        record.category ||
        "Office Supplies";

      ui.itemUnit.value = record.unit;

      ui.itemDesc.value =
        record.description;

      ui.itemQty.value =
        String(record.total);

      ui.itemUsed.value =
        String(record.used);

      ui.itemBalance.value =
        String(record.balance);

      ui.itemThreshold.value =
        String(record.threshold);

      ui.itemRemarks.value =
        record.remarks;

      ui.formTitle.textContent =
        "Edit Inventory Item";

      const submitText =
        ui.submitBtn?.querySelector("span");

      if (submitText) {
        submitText.textContent =
          "Update Record";
      }

      openModal(
        ui.formModal,
        ui.itemName
      );
    }

    function getFilteredRecords() {
      const search = lower(
        ui.searchInput?.value
      );

      return state.records.filter(
        (record) => {
          const matchesFilter =
            state.filter === "All" ||
            record.status === state.filter;

          const searchable = [
            record.itemId,
            record.name,
            record.category,
            record.unit,
            record.description,
            record.remarks,
            record.status
          ]
            .map(lower)
            .join(" ");

          return (
            matchesFilter &&
            (
              !search ||
              searchable.includes(search)
            )
          );
        }
      );
    }

    function createTextCell(
      value,
      className = ""
    ) {
      const cell =
        document.createElement("td");

      if (className) {
        cell.className = className;
      }

      cell.textContent =
        text(value) || "—";

      return cell;
    }

    function renderRecords() {
      if (!ui.recordsTable) {
        return;
      }

      const filtered =
        getFilteredRecords();

      if (!filtered.length) {
        ui.recordsTable.innerHTML = `
          <tr>
            <td class="empty" colspan="7">
              No matching inventory records found.
            </td>
          </tr>
        `;

        return;
      }

      const fragment =
        document.createDocumentFragment();

      filtered.forEach((record) => {
        const index =
          state.records.indexOf(record);

        const row =
          document.createElement("tr");

        const idCell =
          document.createElement("td");

        const id =
          document.createElement("strong");

        id.textContent =
          record.itemId ||
          "No item ID";

        idCell.appendChild(id);

        const detailsCell =
          document.createElement("td");

        const name =
          document.createElement("strong");

        name.textContent =
          record.name ||
          "Unnamed item";

        const description =
          document.createElement("small");

        description.textContent = [
          record.unit
            ? `Unit: ${record.unit}`
            : "",
          record.description,
          record.remarks
        ]
          .filter(Boolean)
          .join(" • ") ||
          "No additional details";

        detailsCell.append(
          name,
          description
        );

        const categoryCell =
          createTextCell(record.category);

        const totalCell =
          createTextCell(
            record.total.toLocaleString()
          );

        const usedCell =
          createTextCell(
            record.used.toLocaleString()
          );

        const stockCell =
          document.createElement("td");

        stockCell.className =
          "stock-cell";

        const stockSummary =
          document.createElement("div");

        stockSummary.className =
          "stock-summary";

        const balance =
          document.createElement("span");

        balance.className =
          "stock-balance";

        balance.textContent =
          record.balance.toLocaleString();

        const badge =
          document.createElement("span");

        badge.className =
          `badge ${statusClass(record.status)}`;

        badge.textContent =
          record.status.replaceAll(
            "-",
            " "
          );

        stockSummary.append(
          balance,
          badge
        );

        const bar =
          document.createElement("div");

        bar.className = "stock-bar";

        bar.title =
          record.total > 0
            ? `${Math.round(
                (
                  record.balance /
                  record.total
                ) * 100
              )}% remaining`
            : "No available stock";

        const fill =
          document.createElement("div");

        fill.className =
          `stock-bar-fill ${statusClass(
            record.status
          )}`;

        fill.style.width = `${
          record.total > 0
            ? Math.min(
                100,
                (
                  record.balance /
                  record.total
                ) * 100
              )
            : 0
        }%`;

        bar.appendChild(fill);

        stockCell.append(
          stockSummary,
          bar
        );

        const actionCell =
          document.createElement("td");

        actionCell.className =
          "action-column";

        const actionGroup =
          document.createElement("div");

        actionGroup.className =
          "action-group";

        const editButton =
          document.createElement("button");

        editButton.type = "button";
        editButton.className =
          "action-btn edit";
        editButton.dataset.action = "edit";
        editButton.dataset.index =
          String(index);
        editButton.title =
          "Edit inventory item";

        editButton.setAttribute(
          "aria-label",
          `Edit ${
            record.name ||
            "inventory item"
          }`
        );

        editButton.innerHTML =
          '<i data-lucide="pencil"></i>';

        const deleteButton =
          document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className =
          "action-btn delete";
        deleteButton.dataset.action =
          "delete";
        deleteButton.dataset.index =
          String(index);
        deleteButton.title =
          "Delete inventory item";

        deleteButton.setAttribute(
          "aria-label",
          `Delete ${
            record.name ||
            "inventory item"
          }`
        );

        deleteButton.innerHTML =
          '<i data-lucide="trash-2"></i>';

        actionGroup.append(
          editButton,
          deleteButton
        );

        actionCell.appendChild(
          actionGroup
        );

        row.append(
          idCell,
          detailsCell,
          categoryCell,
          totalCell,
          usedCell,
          stockCell,
          actionCell
        );

        fragment.appendChild(row);
      });

      ui.recordsTable.replaceChildren(
        fragment
      );

      refreshIcons();
    }

    function updateSummary() {
      const counts = {
        all: state.records.length,
        inStock: 0,
        lowStock: 0,
        outOfStock: 0,
        balance: 0
      };

      state.records.forEach((record) => {
        record.status = determineStatus(
          record.balance,
          record.threshold
        );

        counts.balance += record.balance;

        if (
          record.status === "In-Stock"
        ) {
          counts.inStock += 1;
        }

        if (
          record.status === "Low-Stock"
        ) {
          counts.lowStock += 1;
        }

        if (
          record.status ===
          "Out-of-Stock"
        ) {
          counts.outOfStock += 1;
        }
      });

      const values = {
        statTotalItems: counts.all,
        statTotalQty: counts.balance,
        statLowStock: counts.lowStock,
        statOutOfStock:
          counts.outOfStock,
        countAll: counts.all,
        countInStock: counts.inStock,
        countLowStock:
          counts.lowStock,
        countOutOfStock:
          counts.outOfStock
      };

      Object.entries(values).forEach(
        ([id, value]) => {
          const node =
            document.getElementById(id);

          if (node) {
            node.textContent =
              Number(value).toLocaleString();
          }
        }
      );
    }

    function render() {
      updateSummary();
      renderRecords();
    }

    async function loadInventory({
      announce = false
    } = {}) {
      if (state.loading) {
        return;
      }

      state.loading = true;

      ui.refreshBtn?.classList.add(
        "loading"
      );

      ui.refreshBtn?.setAttribute(
        "disabled",
        ""
      );

      if (!client) {
        loadLocalRecords();

        setDatabaseStatus(
          "standby",
          "Local inventory ready"
        );

        if (ui.lastUpdated) {
          ui.lastUpdated.textContent =
            "Database SDK unavailable";
        }

        state.loading = false;

        ui.refreshBtn?.classList.remove(
          "loading"
        );

        ui.refreshBtn?.removeAttribute(
          "disabled"
        );

        return;
      }

      setDatabaseStatus(
        "standby",
        "Loading inventory…"
      );

      try {
        const {
          data: items,
          error: itemError
        } = await client
          .from(CONFIG.inventoryTable)
          .select("*")
          .order("created_at", {
            ascending: false
          });

        if (itemError) {
          throw itemError;
        }

        let movements = [];

        const {
          data: movementRows,
          error: movementError
        } = await client
          .from(CONFIG.movementsTable)
          .select(
            "item_id,movement_type,quantity,created_at"
          );

        if (movementError) {
          console.warn(
            "Inventory movements were unavailable:",
            movementError
          );
        } else {
          movements = movementRows || [];
        }

        const usedByItem =
          movementTotals(movements);

        state.records = (items || []).map(
          (row) =>
            mapDatabaseRecord(
              row,
              usedByItem
            )
        );

        render();

        setDatabaseStatus(
          "online",
          "Inventory connected"
        );

        if (ui.lastUpdated) {
          const time =
            new Intl.DateTimeFormat(
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
            "Inventory records refreshed."
          );
        }
      } catch (error) {
        console.error(
          "Unable to load inventory:",
          error
        );

        loadLocalRecords();

        setDatabaseStatus(
          "offline",
          "Unable to load inventory"
        );

        if (ui.lastUpdated) {
          ui.lastUpdated.textContent =
            "Showing available local records";
        }

        if (announce) {
          showToast(
            "Could not refresh inventory records.",
            "error"
          );
        }
      } finally {
        state.loading = false;

        ui.refreshBtn?.classList.remove(
          "loading"
        );

        ui.refreshBtn?.removeAttribute(
          "disabled"
        );
      }
    }

    async function saveMovement(
      recordId,
      movementType,
      quantity,
      balanceAfter,
      referenceNo,
      remarks
    ) {
      if (!client || quantity <= 0) {
        return true;
      }

      const { error } = await client
        .from(CONFIG.movementsTable)
        .insert({
          item_id: recordId,
          movement_type: movementType,
          quantity,
          balance_after: balanceAfter,
          reference_no: referenceNo,
          remarks,

          recorded_by: first(
            state.currentProfile?.email,
            state.currentProfile?.full_name,
            state.currentProfile?.username,
            "PGENRO User"
          )
        });

      if (error) {
        console.warn(
          "Inventory movement could not be recorded:",
          error
        );

        return false;
      }

      return true;
    }

    async function saveRecord(event) {
      event.preventDefault();

      if (
        state.saving ||
        !ui.inventoryForm?.reportValidity()
      ) {
        return;
      }

      calculateBalance({
        notify: false
      });

      const editIndex =
        ui.editIndex.value === ""
          ? null
          : Number(ui.editIndex.value);

      const existing =
        editIndex === null
          ? null
          : state.records[editIndex];

      const total = wholeNumber(
        ui.itemQty.value
      );

      const used = wholeNumber(
        ui.itemUsed.value
      );

      const balance = total - used;

      const threshold = wholeNumber(
        ui.itemThreshold.value,
        5
      );

      const record = {
        databaseId:
          existing?.databaseId || null,

        itemId:
          text(ui.itemId.value) ||
          generateControlNumber(),

        name: text(
          ui.itemName.value
        ).toUpperCase(),

        category:
          text(ui.itemCategory.value) ||
          "Office Supplies",

        unit: text(
          ui.itemUnit.value
        ).toUpperCase(),

        description: text(
          ui.itemDesc.value
        ),

        total,
        used,
        balance,
        threshold,

        remarks: text(
          ui.itemRemarks.value
        ),

        status: determineStatus(
          balance,
          threshold
        )
      };

      state.saving = true;

      ui.submitBtn?.setAttribute(
        "disabled",
        ""
      );

      try {
        if (client) {
          const payload = {
            control_no: record.itemId,
            item_name: record.name,
            category: record.category,
            unit: record.unit,
            quantity: record.balance,
            threshold: record.threshold,
            description:
              record.description,
            remarks: record.remarks,
            updated_at:
              new Date().toISOString()
          };

          let savedItem;

          if (existing?.databaseId) {
            const {
              data,
              error
            } = await client
              .from(
                CONFIG.inventoryTable
              )
              .update(payload)
              .eq(
                "id",
                existing.databaseId
              )
              .select()
              .single();

            if (error) {
              throw error;
            }

            savedItem = data;

            const usedDifference =
              record.used -
              existing.used;

            if (usedDifference > 0) {
              await saveMovement(
                savedItem.id,
                "OUT",
                usedDifference,
                record.balance,
                record.itemId,
                "Additional quantity used from the inventory screen."
              );
            } else if (
              usedDifference < 0
            ) {
              await saveMovement(
                savedItem.id,
                "RETURN",
                Math.abs(
                  usedDifference
                ),
                record.balance,
                record.itemId,
                "Used quantity corrected or returned from the inventory screen."
              );
            }
          } else {
            const {
              data,
              error
            } = await client
              .from(
                CONFIG.inventoryTable
              )
              .insert(payload)
              .select()
              .single();

            if (error) {
              throw error;
            }

            savedItem = data;

            if (record.used > 0) {
              await saveMovement(
                savedItem.id,
                "OUT",
                record.used,
                record.balance,
                record.itemId,
                "Initial used quantity entered from the inventory screen."
              );
            }
          }

          await loadInventory();

          showToast(
            existing
              ? "Inventory item updated."
              : "Inventory item saved."
          );
        } else {
          if (editIndex === null) {
            state.records.unshift(record);
          } else {
            state.records[editIndex] =
              record;
          }

          saveLocalRecords();
          render();

          showToast(
            existing
              ? "Local inventory item updated."
              : "Local inventory item saved."
          );
        }

        closeModal(ui.formModal);
        resetForm();
      } catch (error) {
        console.error(
          "Inventory save failed:",
          error
        );

        showToast(
          error.message ||
            "Unable to save the inventory item.",
          "error"
        );
      } finally {
        state.saving = false;

        ui.submitBtn?.removeAttribute(
          "disabled"
        );
      }
    }

    async function deleteRecord(index) {
      const record = state.records[index];

      if (!record) {
        return;
      }

      if (
        client &&
        record.databaseId &&
        !isAdminRole(
          state.currentProfile?.role
        )
      ) {
        showToast(
          "Only an administrator can permanently delete inventory records.",
          "warning"
        );

        return;
      }

      const confirmed = window.confirm(
        `Delete "${
          record.name || record.itemId
        }"? This action cannot be undone.`
      );

      if (!confirmed) {
        return;
      }

      try {
        if (
          client &&
          record.databaseId
        ) {
          const { error } = await client
            .from(
              CONFIG.inventoryTable
            )
            .delete()
            .eq(
              "id",
              record.databaseId
            );

          if (error) {
            throw error;
          }

          await loadInventory();
        } else {
          state.records.splice(
            index,
            1
          );

          saveLocalRecords();
          render();
        }

        showToast(
          "Inventory item deleted.",
          "warning"
        );
      } catch (error) {
        console.error(
          "Inventory delete failed:",
          error
        );

        showToast(
          error.message ||
            "Unable to delete the inventory item.",
          "error"
        );
      }
    }

    function openReportSelection() {
      const records =
        getFilteredRecords();

      if (!records.length) {
        showToast(
          "There are no matching records to include in a report.",
          "warning"
        );

        return;
      }

      const fragment =
        document.createDocumentFragment();

      records.forEach((record) => {
        const index =
          state.records.indexOf(record);

        const row =
          document.createElement("tr");

        const checkCell =
          document.createElement("td");

        checkCell.className =
          "report-item-cell";

        const checkbox =
          document.createElement("input");

        checkbox.type = "checkbox";

        checkbox.className =
          "report-item-checkbox";

        checkbox.value = String(index);

        checkbox.setAttribute(
          "aria-label",
          `Include ${
            record.name ||
            record.itemId
          } in report`
        );

        checkCell.appendChild(checkbox);

        const idCell =
          document.createElement("td");

        const id =
          document.createElement("strong");

        id.textContent =
          record.itemId || "—";

        idCell.appendChild(id);

        const nameCell =
          createTextCell(record.name);

        const balanceCell =
          document.createElement("td");

        const badge =
          document.createElement("span");

        badge.className =
          `badge ${statusClass(
            record.status
          )}`;

        badge.textContent = `${
          record.balance
        } • ${record.status.replaceAll(
          "-",
          " "
        )}`;

        balanceCell.appendChild(badge);

        row.append(
          checkCell,
          idCell,
          nameCell,
          balanceCell
        );

        fragment.appendChild(row);
      });

      ui.reportTableBody.replaceChildren(
        fragment
      );

      ui.reportSelectAll.checked = false;

      updateSelectionCount();

      openModal(
        ui.reportModal,
        ui.reportSelectAll
      );
    }

    function updateSelectionCount() {
      const selected = $$(
        ".report-item-checkbox:checked",
        ui.reportTableBody
      ).length;

      const all = $$(
        ".report-item-checkbox",
        ui.reportTableBody
      ).length;

      if (ui.selectionCount) {
        ui.selectionCount.textContent =
          `${selected} selected`;
      }

      if (ui.reportSelectAll) {
        ui.reportSelectAll.checked =
          all > 0 &&
          selected === all;

        ui.reportSelectAll.indeterminate =
          selected > 0 &&
          selected < all;
      }
    }

    function createPrintReport() {
      const selectedRecords = $$(
        ".report-item-checkbox:checked",
        ui.reportTableBody
      )
        .map(
          (checkbox) =>
            state.records[
              Number(checkbox.value)
            ]
        )
        .filter(Boolean);

      if (!selectedRecords.length) {
        showToast(
          "Select at least one inventory item.",
          "warning"
        );

        return;
      }

      const printWindow = window.open(
        "",
        "_blank"
      );

      if (!printWindow) {
        showToast(
          "Allow pop-ups to generate the inventory report.",
          "error"
        );

        return;
      }

      printWindow.opener = null;

      const rows = selectedRecords
        .map(
          (record) => `
            <tr>
              <td>${
                escapeHtml(record.itemId) ||
                "—"
              }</td>
              <td>
                <strong>
                  ${
                    escapeHtml(record.name) ||
                    "—"
                  }
                </strong>
              </td>
              <td>${
                escapeHtml(
                  record.category
                ) || "—"
              }</td>
              <td>${
                escapeHtml(record.unit) ||
                "—"
              }</td>
              <td>${
                escapeHtml(
                  record.description
                ) || "—"
              }</td>
              <td class="number">
                ${record.total}
              </td>
              <td class="number">
                ${record.used}
              </td>
              <td class="number ${
                record.balance <= 0
                  ? "danger"
                  : ""
              }">
                ${record.balance}
              </td>
              <td>${
                escapeHtml(
                  record.remarks
                ) || "—"
              }</td>
            </tr>
          `
        )
        .join("");

      const generated =
        new Intl.DateTimeFormat(
          "en-PH",
          {
            dateStyle: "long",
            timeStyle: "short"
          }
        ).format(new Date());

      printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>PGENRO Inventory Report</title>

          <style>
            @page {
              size: landscape;
              margin: 1.2cm;
            }

            * {
              box-sizing: border-box;
            }

            body {
              margin: 0;
              color: #17231c;
              font-family: Arial, sans-serif;
            }

            header {
              position: relative;
              min-height: 84px;
              display: flex;
              align-items: center;
              justify-content: center;
              text-align: center;
            }

            header img {
              position: absolute;
              width: 70px;
              height: 70px;
              object-fit: contain;
            }

            header img:first-child {
              left: 12px;
            }

            header img:last-child {
              right: 12px;
            }

            header p {
              margin: 2px 0;
              font-size: 11px;
            }

            header h1 {
              margin: 4px 0;
              color: #145233;
              font-size: 16px;
            }

            .title {
              margin: 22px 0 16px;
              text-align: center;
            }

            .title h2 {
              margin: 0;
              font-size: 17px;
              text-transform: uppercase;
            }

            .title p {
              margin: 5px 0 0;
              color: #5d685f;
              font-size: 10px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 9px;
            }

            th,
            td {
              padding: 7px;
              border: 1px solid #aeb8b1;
              text-align: left;
              vertical-align: top;
            }

            th {
              color: #103d28;
              background: #eaf5ee;
              font-size: 8px;
              text-transform: uppercase;
            }

            .number {
              text-align: center;
            }

            .danger {
              color: #b42318;
              font-weight: bold;
            }

            .signatures {
              margin-top: 42px;
              display: flex;
              justify-content: space-between;
            }

            .signature {
              width: 240px;
              text-align: center;
              font-size: 10px;
            }

            .signature-line {
              margin-top: 38px;
              padding-top: 5px;
              border-top: 1px solid #222;
              font-weight: bold;
              text-transform: uppercase;
            }

            footer {
              margin-top: 22px;
              color: #68736b;
              font-size: 9px;
              text-align: right;
            }

            @media print {
              body {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
              }
            }
          </style>
        </head>

        <body>
          <header>
            <img
              src="../logo/Quezonlogo.png"
              alt=""
            >

            <div>
              <p>
                Republic of the Philippines
              </p>
              <p>Province of Quezon</p>

              <h1>
                Provincial Government Environment
                and Natural Resources Office
              </h1>

              <p>Lucena City, Quezon</p>
            </div>

            <img
              src="../logo/enro.png"
              alt=""
            >
          </header>

          <div class="title">
            <h2>
              Office Supplies and Inventory Report
            </h2>

            <p>
              ${selectedRecords.length}
              inventory item${
                selectedRecords.length === 1
                  ? ""
                  : "s"
              } included
            </p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Item ID</th>
                <th>Item Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th>Description</th>
                <th>Total</th>
                <th>Used</th>
                <th>Balance</th>
                <th>Remarks</th>
              </tr>
            </thead>

            <tbody>
              ${rows}
            </tbody>
          </table>

          <div class="signatures">
            <div class="signature">
              <span>Prepared by:</span>

              <div class="signature-line">
                Administrative Assistant
              </div>

              <span>
                Office Supply Officer
              </span>
            </div>

            <div class="signature">
              <span>
                Noted and approved by:
              </span>

              <div class="signature-line">
                Provincial Head, PGENRO
              </div>

              <span>Department Head</span>
            </div>
          </div>

          <footer>
            Generated:
            ${escapeHtml(generated)}
          </footer>

          <script>
            window.addEventListener(
              "load",
              function () {
                setTimeout(
                  function () {
                    window.print();
                  },
                  250
                );
              }
            );
          <\/script>
        </body>
        </html>
      `);

      printWindow.document.close();

      closeModal(ui.reportModal);
    }

    function subscribeToChanges() {
      if (
        !client ||
        state.realtimeChannels.length
      ) {
        return;
      }

      const inventoryChannel = client
        .channel(
          `user-inventory-${
            window.crypto?.randomUUID?.() ||
            Date.now()
          }`
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              CONFIG.inventoryTable
          },
          () => {
            loadInventory();
          }
        )
        .subscribe();

      const movementsChannel = client
        .channel(
          `user-inventory-movements-${
            window.crypto?.randomUUID?.() ||
            Date.now()
          }`
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              CONFIG.movementsTable
          },
          () => {
            loadInventory();
          }
        )
        .subscribe();

      state.realtimeChannels.push(
        inventoryChannel,
        movementsChannel
      );
    }

    const adminRoles = new Set([
      "admin",
      "administrator",
      "super admin",
      "superadmin",
      "system administrator"
    ]);

    function isAdminRole(role) {
      return adminRoles.has(
        lower(role).replace(
          /\s+/g,
          " "
        )
      );
    }

    function populateProfile(
      profile = {}
    ) {
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

      $$(".profile-text strong").forEach(
        (node) => {
          node.textContent = name;
        }
      );

      $$(".profile-text small").forEach(
        (node) => {
          node.textContent = role;
        }
      );

      $$(
        ".profile-dropdown-header h3"
      ).forEach((node) => {
        node.textContent = name;
      });

      $$(
        ".profile-dropdown-header p"
      ).forEach((node) => {
        node.textContent = email;
      });
    }

    async function loadProfileAndGuard() {
      if (
        !client ||
        !ui.body.dataset.requiresAuth
      ) {
        return;
      }

      try {
        const { data, error } =
          await client.auth.getSession();

        if (error) {
          throw error;
        }

        if (!data.session) {
          window.location.replace(
            "login.html"
          );

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

          state.currentProfile = {
            email: user.email,
            role: "user"
          };

          populateProfile(
            state.currentProfile
          );

          return;
        }

        const currentRole = lower(profile?.role).replace(/\s+/g, " ").trim();
        if (["admin", "administrator", "super admin", "superadmin", "system administrator"].includes(currentRole)) {
          window.location.replace("../admin/admin.html");
          return;
        }

        state.currentProfile = {
          ...(profile || {}),
          email:
            profile?.email ||
            user.email
        };

        populateProfile(
          state.currentProfile
        );

        localStorage.setItem(
          "pgenro_current_user",
          JSON.stringify({
            id: user.id,

            fullName: first(
              profile?.full_name,
              profile?.username
            ),

            email:
              state.currentProfile.email,

            role: first(
              profile?.position,
              profile?.role,
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
        for (
          const key of
          Object.keys(localStorage)
        ) {
          if (
            key.startsWith("sb-") ||
            key.startsWith("pgenro_")
          ) {
            localStorage.removeItem(key);
          }
        }

        sessionStorage.clear();
      } catch {
        // Continue to the login page.
      }

      window.location.assign(
        "login.html"
      );
    }

    function closeProfile() {
      ui.profileMenu?.classList.remove(
        "open"
      );

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
        open &&
        mobileQuery.matches
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

    ui.itemQty?.addEventListener(
      "input",
      calculateBalance
    );

    ui.itemUsed?.addEventListener(
      "input",
      calculateBalance
    );

    ui.inventoryForm?.addEventListener(
      "submit",
      saveRecord
    );

    ui.clearFormBtn?.addEventListener(
      "click",
      () => {
        resetForm({
          preserveMode:
            ui.editIndex.value !== ""
        });
      }
    );

    ui.openEncodingBtn?.addEventListener(
      "click",
      openCreateForm
    );

    ui.formModalClose?.addEventListener(
      "click",
      () => {
        closeModal(ui.formModal);
      }
    );

    ui.reportModalClose?.addEventListener(
      "click",
      () => {
        closeModal(ui.reportModal);
      }
    );

    ui.cancelReportBtn?.addEventListener(
      "click",
      () => {
        closeModal(ui.reportModal);
      }
    );

    ui.generateReportBtn?.addEventListener(
      "click",
      openReportSelection
    );

    ui.confirmPrintBtn?.addEventListener(
      "click",
      createPrintReport
    );

    ui.refreshBtn?.addEventListener(
      "click",
      () => {
        loadInventory({
          announce: true
        });
      }
    );

    ui.searchInput?.addEventListener(
      "input",
      renderRecords
    );

    ui.recordsTable?.addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest(
            "[data-action][data-index]"
          );

        if (!button) {
          return;
        }

        const index = Number(
          button.dataset.index
        );

        if (
          button.dataset.action ===
          "edit"
        ) {
          openEditForm(index);
        }

        if (
          button.dataset.action ===
          "delete"
        ) {
          deleteRecord(index);
        }
      }
    );

    $$(".tab-btn").forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          state.filter =
            button.dataset.filter ||
            "All";

          $$(".tab-btn").forEach(
            (tab) => {
              const active =
                tab === button;

              tab.classList.toggle(
                "active",
                active
              );

              tab.setAttribute(
                "aria-selected",
                String(active)
              );
            }
          );

          renderRecords();
        }
      );
    });

    ui.reportSelectAll?.addEventListener(
      "change",
      () => {
        $$(
          ".report-item-checkbox",
          ui.reportTableBody
        ).forEach((checkbox) => {
          checkbox.checked =
            ui.reportSelectAll.checked;
        });

        updateSelectionCount();
      }
    );

    ui.reportTableBody?.addEventListener(
      "change",
      (event) => {
        if (
          event.target.matches(
            ".report-item-checkbox"
          )
        ) {
          updateSelectionCount();
        }
      }
    );

    ui.hamburger?.addEventListener(
      "click",
      () => {
        closeProfile();

        setSidebarOpen(
          !ui.sidebar?.classList.contains(
            "open"
          )
        );
      }
    );

    ui.overlay?.addEventListener(
      "click",
      () => {
        if (state.activeModal) {
          closeModal(
            state.activeModal
          );
        } else {
          setSidebarOpen(false);
        }
      }
    );

    ui.profileBtn?.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();

        const open =
          !ui.profileMenu.classList.contains(
            "open"
          );

        closeProfile();

        if (open) {
          ui.profileMenu.classList.add(
            "open"
          );

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

    $$(".modules-list a").forEach(
      (link) => {
        link.addEventListener(
          "click",
          () => {
            closeProfile();

            if (mobileQuery.matches) {
              setSidebarOpen(false);
            }
          }
        );
      }
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          if (state.activeModal) {
            closeModal(
              state.activeModal
            );
          } else if (
            ui.sidebar?.classList.contains(
              "open"
            )
          ) {
            setSidebarOpen(false);
          } else {
            closeProfile();
          }
        }

        if (
          event.key === "Tab" &&
          state.activeModal?.classList.contains(
            "open"
          )
        ) {
          const focusable = $$(
            "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
            state.activeModal
          ).filter(
            (node) =>
              node.offsetParent !== null
          );

          if (!focusable.length) {
            return;
          }

          const firstNode =
            focusable[0];

          const lastNode =
            focusable[
              focusable.length - 1
            ];

          if (
            event.shiftKey &&
            document.activeElement ===
              firstNode
          ) {
            event.preventDefault();
            lastNode.focus();
          } else if (
            !event.shiftKey &&
            document.activeElement ===
              lastNode
          ) {
            event.preventDefault();
            firstNode.focus();
          }
        }
      }
    );

    const revealElements =
      $$(".reveal");

    if (
      "IntersectionObserver" in window
    ) {
      const observer =
        new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (
                !entry.isIntersecting
              ) {
                return;
              }

              entry.target.classList.add(
                "show"
              );

              observer.unobserve(
                entry.target
              );
            });
          },
          {
            threshold: 0.05
          }
        );

      revealElements.forEach(
        (element) => {
          observer.observe(element);
        }
      );
    } else {
      revealElements.forEach(
        (element) => {
          element.classList.add(
            "show"
          );
        }
      );
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

    resetForm();
    refreshIcons();
    loadProfileAndGuard();

    loadInventory().then(() => {
      subscribeToChanges();
    });

    window.addEventListener(
      "pagehide",
      () => {
        state.realtimeChannels.forEach(
          (channel) => {
            try {
              client?.removeChannel(
                channel
              );
            } catch {
              // Ignore connection cleanup errors.
            }
          }
        );
      },
      {
        once: true
      }
    );
  }
})();