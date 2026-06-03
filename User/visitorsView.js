document.addEventListener("DOMContentLoaded", () => {
  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const mainContent = document.querySelector(".main-content");
  
  if (window.lucide) {
    lucide.createIcons();
  }

  // HAMBURGER MENU & SIDEBAR
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

  // VISITOR MANAGEMENT
  const storageKey = "pgenro_visitors";
  const searchInput = document.getElementById("visitorSearch");
  const filterSelect = document.getElementById("visitorFilter");
  const visitorTableBody = document.getElementById("visitorTableBody");
  const summaryTotal = document.getElementById("summaryTotal");
  const summaryToday = document.getElementById("summaryToday");
  const summaryFilter = document.getElementById("summaryFilter");
  const emptyState = document.getElementById("emptyState");
  const detailSection = document.getElementById("detailPanel");
  const detailTitle = document.getElementById("detailTitle");
  const detailName = document.getElementById("detailName");
  const detailContact = document.getElementById("detailContact");
  const detailAddress = document.getElementById("detailAddress");
  const detailPerson = document.getElementById("detailPerson");
  const detailPurpose = document.getElementById("detailPurpose");
  const detailWhen = document.getElementById("detailWhen");

  let visitors = [];
  let selectedVisitor = null;

  const defaultVisitors = [
    {
      fullName: "Maria Santos",
      contact: "09171234567",
      address: "Brgy. San Roque, Rizal",
      personToVisit: "Office of the Manager",
      purposeCategory: "Request for Speaker",
      otherPurposeSpecific: "",
      date: "June 6, 2026",
      time: "08:45 AM",
      timestamp: "2026-06-06T08:45:00"
    },
    {
      fullName: "Jose dela Cruz",
      contact: "09281234567",
      address: "City Hall Annex",
      personToVisit: "Records Section",
      purposeCategory: "I.E.C - Request for Information",
      otherPurposeSpecific: "",
      date: "June 6, 2026",
      time: "09:20 AM",
      timestamp: "2026-06-06T09:20:00"
    },
    {
      fullName: "Anne Reyes",
      contact: "09191234567",
      address: "Provincial Social Welfare Center",
      personToVisit: "Permit Officer",
      purposeCategory: "Environmental Concerns - Water Quality",
      otherPurposeSpecific: "",
      date: "June 5, 2026",
      time: "04:10 PM",
      timestamp: "2026-06-05T16:10:00"
    },
    {
      fullName: "Rico Valdez",
      contact: "09181234567",
      address: "Sitio Maligaya",
      personToVisit: "Planning Section",
      purposeCategory: "Technical Assistance - WACS",
      otherPurposeSpecific: "",
      date: "June 4, 2026",
      time: "11:05 AM",
      timestamp: "2026-06-04T11:05:00"
    }
  ];

  function formatPurposeText(purpose) {
    if (!purpose) return "Unknown";
    return purpose.length > 40 ? purpose.slice(0, 38) + "…" : purpose;
  }

  function getVisitorBadge(purpose) {
    const lower = purpose.toLowerCase();
    if (lower.includes("request")) return "warning";
    if (lower.includes("concerns") || lower.includes("technical")) return "success";
    if (lower.includes("other")) return "danger";
    return "warning";
  }

  function loadFromLocalStorage() {
    const stored = localStorage.getItem(storageKey);
    try {
      visitors = stored ? JSON.parse(stored) : [];
    } catch (error) {
      visitors = [];
      console.warn("Could not load visitor records from localStorage:", error);
    }

    if (!Array.isArray(visitors) || visitors.length === 0) {
      visitors = defaultVisitors;
    }

    visitors.sort((a, b) => {
      const aTime = new Date(a.timestamp || `${a.date} ${a.time}`);
      const bTime = new Date(b.timestamp || `${b.date} ${b.time}`);
      return bTime - aTime;
    });
  }

  function loadVisitors() {
    // If Firebase Realtime Database is initialized, listen to `visitors` node
    if (window.firebaseDB) {
      const ref = window.firebaseDB.ref('visitors');
      try { ref.off(); } catch (e) {}

      ref.on('value', (snapshot) => {
        const data = snapshot.val() || {};
        visitors = Object.keys(data).map(key => ({ ...data[key], _id: key }));

        visitors.sort((a, b) => {
          const aTime = new Date(a.timestamp || `${a.date} ${a.time}`);
          const bTime = new Date(b.timestamp || `${b.date} ${b.time}`);
          return bTime - aTime;
        });

        render();
      }, (err) => {
        console.error('Firebase read error:', err);
        // fallback to localStorage
        loadFromLocalStorage();
        render();
      });

      return;
    }

    // fallback when Firebase isn't available
    loadFromLocalStorage();
  }

  function filterVisitors() {
    const search = searchInput.value.trim().toLowerCase();
    const filter = filterSelect.value;

    return visitors.filter(visitor => {
      const text = [visitor.fullName, visitor.contact, visitor.address, visitor.personToVisit, visitor.purposeCategory, visitor.otherPurposeSpecific].join(" ").toLowerCase();
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

    list.forEach((visitor, index) => {
      const row = document.createElement("tr");
      row.className = "visitor-row";
      row.innerHTML = `
        <td>${visitor.fullName}</td>
        <td>${visitor.time} • ${visitor.date}</td>
        <td><span class="tag-pill ${getVisitorBadge(visitor.purposeCategory)}">${formatPurposeText(visitor.purposeCategory)}</span></td>
        <td>${visitor.personToVisit}</td>
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
    detailTitle.textContent = `Visitor details for ${visitor.fullName}`;
    detailName.textContent = visitor.fullName;
    detailContact.textContent = visitor.contact;
    detailAddress.textContent = visitor.address;
    detailPerson.textContent = visitor.personToVisit;
    detailPurpose.textContent = `${visitor.purposeCategory}${visitor.otherPurposeSpecific ? ` — ${visitor.otherPurposeSpecific}` : ""}`;
    detailWhen.textContent = `${visitor.date} at ${visitor.time}`;
  }

  function render() {
    const filtered = filterVisitors();
    updateSummary(filtered);
    renderVisitorList(filtered);
  }

  searchInput.addEventListener("input", render);
  filterSelect.addEventListener("change", render);

  loadVisitors();
  render();
});
