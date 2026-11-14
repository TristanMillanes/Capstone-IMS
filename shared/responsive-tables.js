(() => {
  "use strict";

  const registrySelector = ".unified-records-table, .records-card .table-wrapper > table";
  const columnControls = "button, input, select, a[href]";

  function prepareRegistry(table) {
    const head = table.tHead;
    const headerRow = head?.rows[0];
    if (!headerRow || head.rows.length !== 1) return;
    const headers = Array.from(headerRow.cells);
    if (!headers.length || headers.some(cell => cell.colSpan !== 1 || cell.rowSpan !== 1)) return;

    const names = headers.map(cell => (cell.querySelector("button") || cell).textContent.replace(/\s+/g, " ").trim());
    const hasControls = headers.some(cell => cell.querySelector(columnControls));
    const actionColumn = headers.findIndex((cell, index) =>
      cell.classList.contains("action-column") || /^(?:Actions?|Manage|Inspect event|Files & details)$/i.test(names[index])
    );
    table.classList.add("responsive-registry");
    if (table.parentElement?.classList.contains("table-responsive") &&
        !table.parentElement.hasAttribute("tabindex")) {
      table.parentElement.tabIndex = 0;
    }
    table.setAttribute("role", "table");
    head.setAttribute("role", "rowgroup");
    headerRow.setAttribute("role", "row");
    head.classList.toggle("responsive-registry-controls", hasControls);

    headers.forEach((cell, index) => {
      cell.setAttribute("role", "columnheader");
      if (names[index]) cell.scope = "col";
      const control = cell.querySelector(columnControls);
      cell.classList.toggle("responsive-registry-control", Boolean(control));
      if (control) {
        const checkbox = cell.querySelector('input[type="checkbox"]');
        if (checkbox && !checkbox.labels?.length) {
          const label = document.createElement("label");
          label.className = "responsive-select-all";
          label.textContent = checkbox.getAttribute("aria-label") || "Select all visible records";
          if (checkbox.id) {
            label.htmlFor = checkbox.id;
            cell.append(label);
          } else {
            checkbox.before(label);
            label.prepend(checkbox);
          }
        }
      }
    });

    for (const body of table.tBodies) {
      body.setAttribute("role", "rowgroup");
      for (const row of body.rows) {
        row.setAttribute("role", "row");
        let column = 0;
        for (const cell of row.cells) {
          cell.setAttribute("role", cell.tagName === "TH" ? "rowheader" : "cell");
          if (cell.colSpan === 1) {
            const name = names[column];
            cell.classList.toggle("responsive-card-actions", column === actionColumn);
            if (name) cell.dataset.responsiveLabel = name;
            else delete cell.dataset.responsiveLabel;

            const checkbox = !name && cell.querySelector('input[type="checkbox"]');
            if (checkbox) {
              cell.classList.add("responsive-row-choice");
              if (!checkbox.getAttribute("aria-label") && !checkbox.labels?.length) {
                const reference = row.cells[column + 1]?.textContent.trim();
                checkbox.setAttribute("aria-label", reference ? "Select record " + reference : "Select record");
              }
            }
          }
          column += cell.colSpan;
        }
      }
    }
  }

  function init() {
    const main = document.querySelector("#adminMainContent, #mainContent");
    if (!main) return;
    const tables = main.querySelectorAll(registrySelector);
    for (const table of tables) {
      prepareRegistry(table);
      const observer = new MutationObserver(() => prepareRegistry(table));
      observer.observe(table, {childList: true, subtree: true});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, {once: true});
  } else {
    init();
  }
})();
