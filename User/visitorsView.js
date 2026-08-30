document.addEventListener("DOMContentLoaded", () => {
  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const mainContent = document.querySelector(".main-content");
  
  if (window.lucide) lucide.createIcons();

  if (hamburgerMenu && sidebar && overlay) {
    hamburgerMenu.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      hamburgerMenu.classList.toggle("active");
      overlay.classList.toggle("active");
      mainContent.classList.toggle("blur");
    });

    overlay.addEventListener("click", () => {
      sidebar.classList.remove("open");
      hamburgerMenu.classList.remove("active");
      overlay.classList.remove("active");
      mainContent.classList.remove("blur");
    });
  }

  const storageKey = "pgenro_visitors";
  const searchInput = document.getElementById("visitorSearch");
  const filterSelect = document.getElementById("visitorFilter");
  const visitorTableBody = document.getElementById("visitorTableBody");
  const summaryTotal = document.getElementById("summaryTotal");
  const summaryToday = document.getElementById("summaryToday");
  const summaryFilter = document.getElementById("summaryFilter");
  const emptyState = document.getElementById("emptyState");
  const detailSection = document.getElementById("detailPanel");

  // Database State: Empty Base
  let visitors = [];
  let selectedVisitor = null;

  function loadVisitors() {
    // If Firebase Realtime Database is initialized
    if (window.firebaseDB) {
      const ref = window.firebaseDB.ref('visitors');
      ref.on('value', (snapshot) => {
        const data = snapshot.val() || {};
        visitors = Object.keys(data).map(key => ({ ...data[key], _id: key }));
        render();
      }, (err) => {
        console.error('Firebase read error:', err);
        visitors = JSON.parse(localStorage.getItem(storageKey)) || [];
        render();
      });
      return;
    }

    // Default LocalStorage fallback
    visitors = JSON.parse(localStorage.getItem(storageKey)) || [];
    render();
  }

  function filterVisitors() {
    const search = searchInput.value.trim().toLowerCase();
    const filter = filterSelect.value;

    return visitors.filter(visitor => {
      const text = [visitor.fullName, visitor.contact, visitor.address, visitor.personToVisit, visitor.purposeCategory].join(" ").toLowerCase();
      const searchMatches = !search || text.includes(search);
      const filterMatches = filter === "all" || visitor.purposeCategory === filter;
      return searchMatches && filterMatches;
    });
  }

  function updateSummary(list) {
    const now = new Date();
    const todayString = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const todayCount = list.filter(item => item.date === todayString).length;

    summaryTotal.textContent = visitors.length.toString();
    summaryToday.textContent = todayCount.toString();
    summaryFilter.textContent = filterSelect.value === "all" ? "All" : "Filtered";
  }

  function renderVisitorList(list) {
    visitorTableBody.innerHTML = "";

    if (!list.length) {
      emptyState.classList.remove("hidden");
      detailSection.classList.add("hidden");
      return;
    }

    emptyState.classList.add("hidden");

    list.forEach((visitor) => {
      const row = document.createElement("tr");
      row.className = "visitor-row";
      row.innerHTML = `
        <td>${visitor.fullName || "-"}</td>
        <td>${visitor.time || ""} • ${visitor.date || ""}</td>
        <td><span class="tag-pill warning">${visitor.purposeCategory || "General Visit"}</span></td>
        <td>${visitor.personToVisit || "-"}</td>
      `;

      row.addEventListener("click", () => selectVisitor(visitor));
      visitorTableBody.appendChild(row);
    });

    if (!selectedVisitor && list.length > 0) {
      selectVisitor(list[0]);
    }
  }

  function selectVisitor(visitor) {
    selectedVisitor = visitor;
    detailSection.classList.remove("hidden");
    document.getElementById("detailTitle").textContent = `Visitor Details: ${visitor.fullName || ""}`;
    document.getElementById("detailName").textContent = visitor.fullName || "—";
    document.getElementById("detailContact").textContent = visitor.contact || "—";
    document.getElementById("detailAddress").textContent = visitor.address || "—";
    document.getElementById("detailPerson").textContent = visitor.personToVisit || "—";
    document.getElementById("detailPurpose").textContent = visitor.purposeCategory || "—";
    document.getElementById("detailWhen").textContent = `${visitor.date || ""} at ${visitor.time || ""}`;
  }

  function render() {
    const filtered = filterVisitors();
    updateSummary(filtered);
    renderVisitorList(filtered);
  }

  searchInput.addEventListener("input", render);
  filterSelect.addEventListener("change", render);

  loadVisitors();
});