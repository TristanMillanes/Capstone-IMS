document.addEventListener("DOMContentLoaded", async () => {
  "use strict";

  if (window.lucide) lucide.createIcons();

  const $ = (id) => document.getElementById(id);
  const db = window.PGENRO_DB?.client || null;
  const TABLE = window.PGENRO_DB?.table || "visitors";

  const els = {
    hamburgerMenu: $("hamburgerMenu"),
    sidebar: $("sidebar"),
    overlay: $("overlay"),
    search: $("visitorSearch"),
    purpose: $("purposeFilter"),
    status: $("statusFilter"),
    body: $("visitorTableBody"),
    empty: $("emptyState"),
    total: $("summaryTotal"),
    today: $("summaryToday"),
    inside: $("summaryInside"),
    todayDate: $("todayDateStr"),
    clock: $("liveClock"),
    drawer: $("detailDrawer"),
    closeDrawer: $("closeDrawerBtn"),
    toggleCheckout: $("toggleCheckoutBtn"),
    printPass: $("printPassBtn"),
    prev: $("prevPageBtn"),
    next: $("nextPageBtn"),
    page: $("pageIndicator"),
    showing: $("showingCountText"),
    exportCsv: $("exportCsvBtn"),
    refresh: $("refreshBtn")
  };

  let visitors = [];
  let selectedVisitor = null;
  let activeDateFilter = "all";
  let currentPage = 1;
  const rowsPerPage = 10;
  let realtimeChannel = null;

  const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>'"]/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[c]));

  function toast(message, type = "info") {
    let el = document.getElementById("pgenroStaffToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "pgenroStaffToast";
      Object.assign(el.style, {
        position: "fixed", right: "20px", bottom: "20px", zIndex: "9999",
        maxWidth: "420px", padding: "12px 16px", borderRadius: "12px",
        color: "#fff", fontFamily: "Plus Jakarta Sans, sans-serif",
        fontSize: "13px", fontWeight: "700", boxShadow: "0 12px 36px rgba(0,0,0,.22)",
        opacity: "0", transform: "translateY(8px)", transition: ".2s ease"
      });
      document.body.appendChild(el);
    }
    el.style.background = type === "error" ? "#b91c1c" : "#047857";
    el.textContent = message;
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
    }, 2800);
  }

  function dateString(date = new Date()) {
    return date.toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric"
    });
  }

  function updateClock() {
    const now = new Date();
    if (els.clock) {
      els.clock.textContent = now.toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    }
    if (els.todayDate) {
      els.todayDate.textContent = now.toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric"
      });
    }
  }

  function normalizeVisitor(row) {
    const timeIn = row.time_in || row.created_at || null;
    const timeOut = row.time_out || null;
    const visitDate = row.visit_date
      ? new Date(`${row.visit_date}T00:00:00`)
      : (timeIn ? new Date(timeIn) : null);

    return {
      _id: row.id,
      fullName: row.full_name || "",
      contact: row.contact || "",
      address: row.address || "",
      personToVisit: row.person_to_visit || "",
      purposeCategory: row.purpose_category || "",
      otherPurposeSpecific: row.other_purpose_specific || "",
      date: visitDate && !Number.isNaN(visitDate.getTime()) ? dateString(visitDate) : "",
      dateISO: row.visit_date || "",
      time: timeIn ? new Date(timeIn).toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit"
      }) : "",
      timestamp: timeIn ? new Date(timeIn).getTime() : 0,
      status: row.status || (timeOut ? "completed" : "inside"),
      timeOut: timeOut ? new Date(timeOut).toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit"
      }) : null,
      timeOutISO: timeOut
    };
  }

  async function requireSignedInUser() {
    if (!db) {
      toast("Supabase is not configured. Add your URL and Publishable/Anon key in shared/supabase.js.", "error");
      return false;
    }

    try {
      const session = await window.PGENRO_DB?.getSession?.();
      if (!session?.user) {
        toast("Please sign in to access the visitor log.", "error");
        setTimeout(() => { window.location.href = "login.html"; }, 900);
        return false;
      }

      // Do not hard-code only "user" / "admin" here. Real deployments often
      // use roles such as Staff, Officer, Records Officer, or System Staff.
      // Approval/activation is the authoritative access check for the user portal.
      if (window.PGENRO_API?.requireApprovedUser) {
        await window.PGENRO_API.requireApprovedUser();
      }
      return true;
    } catch (error) {
      console.error("Auth check failed:", error);
      toast(error?.message || "Unable to verify your account.", "error");
      return false;
    }
  }

  async function loadVisitors({ silent = false } = {}) {
    if (!db) return;

    try {
      const { data, error } = await db
        .from(TABLE)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      visitors = (data || []).map(normalizeVisitor);
      render();

      if (!silent) toast("Visitor records synchronized.");
    } catch (error) {
      console.error("Visitor load failed:", error);
      visitors = [];
      render();
      toast(
        error?.code === "42501"
          ? "Supabase denied access. Check the user's role and RLS policies."
          : "Unable to load visitor records.",
        "error"
      );
    }
  }

  function startRealtime() {
    if (!db) return;

    if (realtimeChannel) {
      db.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    realtimeChannel = db
      .channel("pgenro-visitors-staff")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE },
        () => loadVisitors({ silent: true })
      )
      .subscribe(status => {
        if (status === "CHANNEL_ERROR") {
          console.warn("Visitor realtime channel error.");
        }
      });
  }

  function getInitials(name) {
    return (name || "Guest")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join("") || "??";
  }

  function purposeClass(purpose = "") {
    if (purpose.includes("Speaker")) return "tag-purple";
    if (purpose.includes("Water Quality")) return "tag-blue";
    if (purpose.includes("Technical")) return "tag-orange";
    if (purpose.includes("Information") || purpose.includes("I.E.C")) return "tag-green";
    return "tag-gray";
  }

  function filteredVisitors() {
    const search = (els.search?.value || "").trim().toLowerCase();
    const purpose = els.purpose?.value || "all";
    const status = els.status?.value || "all";
    const today = dateString();

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);

    return visitors
      .filter(v => {
        const haystack = [
          v.fullName, v.contact, v.address,
          v.personToVisit, v.purposeCategory, v.otherPurposeSpecific
        ].join(" ").toLowerCase();

        const searchMatch = !search || haystack.includes(search);
        const purposeMatch = purpose === "all" || v.purposeCategory === purpose;
        const statusMatch = status === "all" || v.status === status;

        let dateMatch = true;
        if (activeDateFilter === "today") {
          dateMatch = v.date === today;
        } else if (activeDateFilter === "week") {
          const d = v.timestamp ? new Date(v.timestamp) : new Date(v.date);
          dateMatch = !Number.isNaN(d.getTime()) && d >= weekAgo;
        }

        return searchMatch && purposeMatch && statusMatch && dateMatch;
      })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  function updateMetrics() {
    const today = dateString();
    if (els.total) els.total.textContent = visitors.length;
    if (els.today) els.today.textContent = visitors.filter(v => v.date === today).length;
    if (els.inside) els.inside.textContent =
      visitors.filter(v => v.status === "inside").length;
  }

  function renderTable(list) {
    if (!els.body) return;
    els.body.innerHTML = "";

    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / rowsPerPage));
    currentPage = Math.min(Math.max(currentPage, 1), pages);

    const start = (currentPage - 1) * rowsPerPage;
    const pageRows = list.slice(start, start + rowsPerPage);

    if (els.showing) {
      els.showing.textContent = total
        ? `Showing ${start + 1} - ${Math.min(start + rowsPerPage, total)} of ${total} visitors`
        : "No records found";
    }
    if (els.page) els.page.textContent = `${currentPage} / ${pages}`;
    if (els.prev) els.prev.disabled = currentPage <= 1;
    if (els.next) els.next.disabled = currentPage >= pages;

    if (!pageRows.length) {
      els.empty?.classList.remove("hidden");
      return;
    }
    els.empty?.classList.add("hidden");

    pageRows.forEach(v => {
      const inside = v.status === "inside";
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>
          <div class="visitor-profile-cell">
            <div class="table-avatar">${escapeHTML(getInitials(v.fullName))}</div>
            <div class="profile-meta">
              <strong>${escapeHTML(v.fullName || "Anonymous Guest")}</strong>
              <span>${escapeHTML(v.address || "Address unspecified")}</span>
            </div>
          </div>
        </td>
        <td><div style="font-weight:700;color:var(--dark)">${escapeHTML(v.contact || "No Contact")}</div></td>
        <td><span class="dept-pill">${escapeHTML(v.personToVisit || "General Personnel")}</span></td>
        <td><span class="tag-badge ${purposeClass(v.purposeCategory)}">${escapeHTML(v.purposeCategory || "General Inquiry")}</span></td>
        <td>
          <div style="font-weight:700;font-size:13px">${escapeHTML(v.time || "--:--")}</div>
          <small style="color:var(--muted);font-size:11px">${escapeHTML(v.date || "")}</small>
        </td>
        <td>
          <span class="status-pill ${inside ? "status-inside" : "status-completed"}">
            ${inside ? "In Building" : "Checked Out"}
          </span>
        </td>
        <td style="text-align:right">
          <button class="btn-view-row" title="Open details">
            <i data-lucide="chevron-right"></i>
          </button>
        </td>
      `;

      tr.addEventListener("click", () => openDrawer(v));
      els.body.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons();
  }

  function render() {
    updateMetrics();
    renderTable(filteredVisitors());
  }

  function openDrawer(v) {
    selectedVisitor = v;
    $("drawerName").textContent = v.fullName || "Guest Details";
    $("drawerFullname").textContent = v.fullName || "—";
    $("drawerAvatar").textContent = getInitials(v.fullName);
    $("drawerContact").textContent = v.contact || "—";
    $("drawerAddress").textContent = v.address || "—";
    $("drawerPerson").textContent = v.personToVisit || "—";
    $("drawerPurpose").textContent =
      [v.purposeCategory, v.otherPurposeSpecific].filter(Boolean).join(" — ") || "—";
    $("drawerTimeIn").textContent = v.time || "—";
    $("drawerDate").textContent = v.date || "—";
    $("drawerTimeOut").textContent = v.timeOut || "Still in Premises";

    const inside = v.status === "inside";
    const badge = $("drawerStatusBadge");
    badge.textContent = inside ? "Currently Inside" : "Signed Out";
    badge.className = `badge ${inside ? "status-inside" : "status-completed"}`;

    els.toggleCheckout.innerHTML = inside
      ? `<i data-lucide="log-out"></i> Mark Departure`
      : `<i data-lucide="rotate-ccw"></i> Re-open Visit`;

    els.toggleCheckout.className = inside ? "btn btn-success" : "btn btn-secondary";
    els.drawer?.classList.add("open");
    els.drawer?.setAttribute("aria-hidden", "false");
    els.overlay?.classList.add("active");

    if (window.lucide) lucide.createIcons();
  }

  function closeDrawer() {
    els.drawer?.classList.remove("open");
    els.drawer?.setAttribute("aria-hidden", "true");
    els.overlay?.classList.remove("active");
  }

  async function toggleCheckout() {
    if (!selectedVisitor || !db) return;

    const inside = selectedVisitor.status === "inside";
    const patch = {
      status: inside ? "completed" : "inside",
      time_out: inside ? new Date().toISOString() : null
    };

    els.toggleCheckout.disabled = true;

    try {
      const { error } = await db
        .from(TABLE)
        .update(patch)
        .eq("id", selectedVisitor._id);

      if (error) throw error;

      await loadVisitors({ silent: true });
      selectedVisitor = visitors.find(v => v._id === selectedVisitor._id) || null;

      if (selectedVisitor) openDrawer(selectedVisitor);
      toast(inside ? "Visitor departure recorded." : "Visitor visit re-opened.");
    } catch (error) {
      console.error("Checkout update failed:", error);
      toast(
        error?.code === "42501"
          ? "Your account cannot update this visitor record."
          : "Unable to update visitor status.",
        "error"
      );
    } finally {
      els.toggleCheckout.disabled = false;
    }
  }

  function printPass() {
    if (!selectedVisitor) return;
    const v = selectedVisitor;
    const w = window.open("", "_blank", "width=620,height=650");
    if (!w) return toast("Popup blocked. Allow popups to print the pass.", "error");

    w.document.write(`
      <html>
      <head>
        <title>Visitor Pass - ${escapeHTML(v.fullName)}</title>
        <style>
          body{font-family:Arial,sans-serif;padding:30px;text-align:center}
          .pass{border:2px dashed #047857;padding:25px;border-radius:14px}
          h2{color:#047857}
          .field{text-align:left;margin:12px 0;padding-bottom:7px;border-bottom:1px solid #eee}
          .field small{display:block;color:#64748b;text-transform:uppercase;font-weight:bold}
          .field strong{font-size:16px}
        </style>
      </head>
      <body>
        <div class="pass">
          <h2>PGENRO VISITOR PASS</h2>
          <p>Provincial Environment and Natural Resources Office</p>
          <div class="field"><small>Visitor Name</small><strong>${escapeHTML(v.fullName)}</strong></div>
          <div class="field"><small>Host / Department</small><strong>${escapeHTML(v.personToVisit)}</strong></div>
          <div class="field"><small>Purpose</small><strong>${escapeHTML(v.purposeCategory)}</strong></div>
          <div class="field"><small>Date / Time In</small><strong>${escapeHTML(v.date)} @ ${escapeHTML(v.time)}</strong></div>
        </div>
      </body>
      </html>
    `);
    w.document.close();
    w.focus();
    w.print();
  }

  function exportCsv() {
    const list = filteredVisitors();
    if (!list.length) return toast("No visitor records to export.", "error");

    const safe = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const headers = [
      "Full Name", "Contact", "Address", "Host / Department",
      "Purpose", "Specific Purpose", "Date",
      "Time In", "Time Out", "Status"
    ];

    const lines = list.map(v => [
      v.fullName, v.contact, v.address, v.personToVisit,
      v.purposeCategory, v.otherPurposeSpecific, v.date,
      v.time, v.timeOut, v.status
    ].map(safe).join(","));

    const blob = new Blob(
      [[headers.map(safe).join(","), ...lines].join("\n")],
      { type: "text/csv;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PGENRO_Visitors_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  updateClock();
  setInterval(updateClock, 1000);

  els.hamburgerMenu?.addEventListener("click", () => {
    els.sidebar?.classList.toggle("open");
    els.hamburgerMenu?.classList.toggle("active");
    els.overlay?.classList.toggle("active");
  });

  els.overlay?.addEventListener("click", () => {
    els.sidebar?.classList.remove("open");
    els.hamburgerMenu?.classList.remove("active");
    closeDrawer();
  });

  els.closeDrawer?.addEventListener("click", closeDrawer);
  els.toggleCheckout?.addEventListener("click", toggleCheckout);
  els.printPass?.addEventListener("click", printPass);
  els.exportCsv?.addEventListener("click", exportCsv);
  els.refresh?.addEventListener("click", () => loadVisitors());

  els.prev?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      render();
    }
  });

  els.next?.addEventListener("click", () => {
    currentPage++;
    render();
  });

  els.search?.addEventListener("input", () => {
    currentPage = 1;
    render();
  });

  [els.purpose, els.status].forEach(el => {
    el?.addEventListener("change", () => {
      currentPage = 1;
      render();
    });
  });

  document.querySelectorAll(".date-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".date-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      activeDateFilter = chip.dataset.range || "all";
      currentPage = 1;
      render();
    });
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeDrawer();
  });

  const allowed = await requireSignedInUser();
  if (!allowed) return;

  await loadVisitors({ silent: true });
  startRealtime();
});
