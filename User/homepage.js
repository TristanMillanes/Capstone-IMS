document.addEventListener("DOMContentLoaded", () => {
  // Global Chart Storage Reference for Destruction/Re-instantiation
  const activeCharts = {
    mini: null,
    monthly: null,
    category: null,
    status: null
  };

  // Initialize Lucide Icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // DOM Elements Retrieval
  const menuBtn = document.getElementById("menuBtn");
  const navLinks = document.getElementById("navLinks");
  const profileMenu = document.getElementById("profileMenu");
  const profileBtn = document.getElementById("profileBtn");
  const profileDropdown = document.getElementById("profileDropdown");
  const logoutBtn = document.getElementById("logoutBtn");
  const sidebarToggle = document.getElementById("sidebarToggle");
  const appSidebar = document.getElementById("appSidebar");
  const mainContent = document.getElementById("mainContent");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const scrollToTopBtn = document.getElementById("scrollToTopBtn");

  // THEME ENGINE INTEGRATION
  const savedTheme = localStorage.getItem("pgenro-theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const currentTheme = document.documentElement.getAttribute("data-theme");
      const nextTheme = currentTheme === "dark" ? "light" : "dark";
      
      document.documentElement.setAttribute("data-theme", nextTheme);
      localStorage.setItem("pgenro-theme", nextTheme);
      updateThemeIcon(nextTheme);

      // Re-instantiate Active Charts to inherit themed styles and colors
      renderCharts();
    });
  }

  function updateThemeIcon(theme) {
    const darkIcon = document.querySelector(".theme-icon-dark");
    const lightIcon = document.querySelector(".theme-icon-light");
    if (darkIcon && lightIcon) {
      if (theme === "dark") {
        darkIcon.style.display = "none";
        lightIcon.style.display = "block";
      } else {
        darkIcon.style.display = "block";
        lightIcon.style.display = "none";
      }
    }
  }

  // LAYOUT & MENU TOGGLE CONTROLS (DESKTOP & MOBILE DRAWERS)
  function toggleMobileSidebar() {
    if (appSidebar && sidebarOverlay) {
      const isOpen = appSidebar.classList.toggle("open");
      sidebarOverlay.classList.toggle("active", isOpen);
    }
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (window.innerWidth <= 1100) {
        toggleMobileSidebar();
      } else {
        if (appSidebar && mainContent) {
          appSidebar.classList.toggle("collapsed");
          mainContent.classList.toggle("expanded");
        }
      }
    });
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", () => {
      if (appSidebar) appSidebar.classList.remove("open");
      sidebarOverlay.classList.remove("active");
    });
  }

  if (menuBtn && navLinks) {
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      navLinks.classList.toggle("open");
    });
  }

  if (profileBtn && profileMenu) {
    profileBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      profileMenu.classList.toggle("open");
      if (navLinks) navLinks.classList.remove("open");
    });
  }

  if (profileDropdown) {
    profileDropdown.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }

  document.addEventListener("click", () => {
    if (profileMenu) profileMenu.classList.remove("open");
    if (navLinks) navLinks.classList.remove("open");
    if (appSidebar && window.innerWidth <= 1100) {
      appSidebar.classList.remove("open");
      if (sidebarOverlay) sidebarOverlay.classList.remove("active");
    }
  });

  // LOGOUT MECHANICS
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      const confirmLogout = confirm("Are you sure you want to logout?");
      if (confirmLogout) {
        window.location.href = "login.html";
      }
    });
  }

  // ANCHOR LINK ANIMATION BINDINGS
  const smoothLinks = document.querySelectorAll('a[href^="#"]');
  smoothLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || href === "#") return;

      const target = document.querySelector(href);
      if (!target) return;

      event.preventDefault();
      target.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

      if (navLinks) navLinks.classList.remove("open");
      if (profileMenu) profileMenu.classList.remove("open");
    });
  });

  // FLOATING BACK TO TOP INTERACTIVE TRIGGER
  window.addEventListener("scroll", () => {
    if (scrollToTopBtn) {
      if (window.scrollY > 400) {
        scrollToTopBtn.classList.add("visible");
      } else {
        scrollToTopBtn.classList.remove("visible");
      }
    }
  });

  if (scrollToTopBtn) {
    scrollToTopBtn.addEventListener("click", () => {
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    });
  }

  // TYPING ANCHORED ARRAY
  const typingText = document.getElementById("typingText");
  if (typingText) {
    const words = [
      "Information Management System",
      "Provincial Government",
      "Environment and Natural Resources Office",
      "Quezon Province"
    ];

    let wordIndex = 0;
    let charIndex = 0;
    let isDeleting = false;

    function typeEffect() {
      const currentWord = words[wordIndex];

      if (isDeleting) {
        typingText.textContent = currentWord.substring(0, charIndex--);
      } else {
        typingText.textContent = currentWord.substring(0, charIndex++);
      }

      if (!isDeleting && charIndex === currentWord.length + 1) {
        isDeleting = true;
        setTimeout(typeEffect, 1500);
        return;
      }

      if (isDeleting && charIndex === 0) {
        isDeleting = false;
        wordIndex = (wordIndex + 1) % words.length;
      }

      setTimeout(typeEffect, isDeleting ? 40 : 80);
    }
    typeEffect();
  }

  // SCROLL-REVEAL ELEMENT LOGIC WITH PROGRESS COUNTERS
  const revealElements = document.querySelectorAll(".reveal");
  const counters = document.querySelectorAll(".counter");
  let counterStarted = false;

  function startCounters() {
    if (counterStarted) return;
    counters.forEach((counter) => {
      const target = Number(counter.getAttribute("data-target")) || 0;
      let count = 0;
      const speed = Math.max(1, Math.ceil(target / 80));

      function updateCounter() {
        count += speed;
        if (count >= target) {
          counter.textContent = target.toLocaleString();
        } else {
          counter.textContent = count.toLocaleString();
          requestAnimationFrame(updateCounter);
        }
      }
      updateCounter();
    });
    counterStarted = true;
  }

  function revealOnScroll() {
    revealElements.forEach((element) => {
      const windowHeight = window.innerHeight;
      const elementTop = element.getBoundingClientRect().top;
      const revealPoint = 80;

      if (elementTop < windowHeight - revealPoint) {
        element.classList.add("show");
      }
    });
    startCounters();
  }

  window.addEventListener("scroll", revealOnScroll);
  revealOnScroll();

  // MODULE SEARCH & KEYBOARD TRIGGERS
  const moduleSearch = document.getElementById("moduleSearch");
  const searchClearBtn = document.getElementById("searchClearBtn");
  const moduleCards = document.querySelectorAll(".module-card");
  const noResultsContainer = document.getElementById("noResultsContainer");

  if (moduleSearch) {
    moduleSearch.addEventListener("input", () => {
      const searchValue = moduleSearch.value.toLowerCase().trim();
      let matchCount = 0;

      if (searchClearBtn) {
        searchClearBtn.style.display = searchValue.length > 0 ? "flex" : "none";
      }

      moduleCards.forEach((card) => {
        const moduleName = (card.getAttribute("data-name") || "").toLowerCase();
        const moduleText = card.textContent.toLowerCase();

        const isMatch = moduleName.includes(searchValue) || moduleText.includes(searchValue);
        card.style.display = isMatch ? "flex" : "none";

        if (isMatch) matchCount++;
      });

      if (noResultsContainer) {
        noResultsContainer.style.display = (matchCount === 0 && searchValue.length > 0) ? "block" : "none";
      }
    });

    // Keyboard shortcut hooks (Ctrl+K or "/" to focus)
    window.addEventListener("keydown", (event) => {
      if ((event.ctrlKey && event.key === "k") || event.key === "/") {
        if (document.activeElement !== moduleSearch) {
          event.preventDefault();
          moduleSearch.focus();
        }
      }
    });
  }

  if (searchClearBtn && moduleSearch) {
    searchClearBtn.addEventListener("click", () => {
      moduleSearch.value = "";
      searchClearBtn.style.display = "none";
      moduleCards.forEach(card => card.style.display = "flex");
      if (noResultsContainer) noResultsContainer.style.display = "none";
      moduleSearch.focus();
    });
  }

  // ACTIVE LINKS SCROLL HIGH-LIGHTER
  const navItems = document.querySelectorAll(".nav-links a");
  const sidebarItems = document.querySelectorAll(".modules-list a");
  const sections = document.querySelectorAll("section, footer");

  function updateActiveLinks() {
    let currentSection = "";
    sections.forEach((section) => {
      const sectionTop = section.offsetTop - 140;
      if (window.scrollY >= sectionTop) {
        currentSection = section.getAttribute("id") || "";
      }
    });

    navItems.forEach((item) => {
      item.classList.toggle("active", item.getAttribute("href") === `#${currentSection}`);
    });

    sidebarItems.forEach((item) => {
      item.classList.toggle("active", item.getAttribute("href") === `#${currentSection}`);
    });
  }

  window.addEventListener("scroll", updateActiveLinks);
  updateActiveLinks();

  // CHARTS ENGINE (DYNAMIC THEME RE-GENERATION)
  function renderCharts() {
    if (!window.Chart) return;

    // Destroy existing chart structures to clean references
    Object.keys(activeCharts).forEach((key) => {
      if (activeCharts[key]) {
        activeCharts[key].destroy();
      }
    });

    // Resolve Theme-Specific Context Color Sets
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const chartTextColor = isDark ? "#8da495" : "#64766a";
    const chartGridColor = isDark ? "rgba(125, 220, 149, 0.05)" : "rgba(15, 107, 61, 0.05)";
    const canvasBorderColor = isDark ? "#101814" : "#ffffff";

    const miniChartCanvas = document.getElementById("miniChart");
    const monthlyChartCanvas = document.getElementById("monthlyChart");
    const categoryChartCanvas = document.getElementById("categoryChart");
    const statusChartCanvas = document.getElementById("statusChart");

    if (miniChartCanvas) {
      activeCharts.mini = new Chart(miniChartCanvas, {
        type: "line",
        data: {
          labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
          datasets: [
            {
              label: "Documents",
              data: [12, 18, 14, 22, 19, 28],
              borderColor: "#7ddc95",
              backgroundColor: "rgba(125, 220, 149, 0.12)",
              fill: true,
              tension: 0.42,
              pointRadius: 0,
              borderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false }
          },
          scales: {
            x: { display: false },
            y: { display: false }
          }
        }
      });
    }

    if (monthlyChartCanvas) {
      const ctx = monthlyChartCanvas.getContext("2d");
      
      const gradientIncoming = ctx.createLinearGradient(0, 0, 0, 400);
      gradientIncoming.addColorStop(0, isDark ? "rgba(67, 173, 103, 0.25)" : "rgba(15, 107, 61, 0.25)");
      gradientIncoming.addColorStop(1, "rgba(15, 107, 61, 0.0)");

      const gradientOutgoing = ctx.createLinearGradient(0, 0, 0, 400);
      gradientOutgoing.addColorStop(0, isDark ? "rgba(125, 220, 149, 0.2)" : "rgba(67, 173, 103, 0.2)");
      gradientOutgoing.addColorStop(1, "rgba(67, 173, 103, 0.0)");

      activeCharts.monthly = new Chart(monthlyChartCanvas, {
        type: "line",
        data: {
          labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
          datasets: [
            {
              label: "Incoming",
              data: [45, 58, 62, 70, 83, 91],
              borderColor: isDark ? "#43ad67" : "#0f6b3d",
              backgroundColor: gradientIncoming,
              fill: true,
              tension: 0.35,
              borderWidth: 3,
              pointBackgroundColor: isDark ? "#43ad67" : "#0f6b3d"
            },
            {
              label: "Outgoing",
              data: [35, 42, 51, 55, 69, 74],
              borderColor: isDark ? "#7ddc95" : "#43ad67",
              backgroundColor: gradientOutgoing,
              fill: true,
              tension: 0.35,
              borderWidth: 3,
              pointBackgroundColor: isDark ? "#7ddc95" : "#43ad67"
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: {
                usePointStyle: true,
                color: chartTextColor,
                font: { weight: "600", family: "Plus Jakarta Sans" }
              }
            },
            tooltip: {
              backgroundColor: isDark ? "#122a1c" : "#10291b",
              padding: 12,
              cornerRadius: 8
            }
          },
          scales: {
            x: {
              ticks: { color: chartTextColor },
              grid: { display: false }
            },
            y: {
              beginAtZero: true,
              ticks: { color: chartTextColor },
              grid: { color: chartGridColor }
            }
          }
        }
      });
    }

    if (categoryChartCanvas) {
      activeCharts.category = new Chart(categoryChartCanvas, {
        type: "doughnut",
        data: {
          labels: ["Communication", "Memo", "Travel", "Inventory", "Visitor Log"],
          datasets: [
            {
              data: [32, 18, 14, 20, 16],
              backgroundColor: [
                "#0f6b3d",
                "#43ad67",
                "#7ddc95",
                "#b5efc3",
                isDark ? "#122a1c" : "#e3f3e9"
              ],
              borderWidth: 3,
              borderColor: canvasBorderColor,
              hoverOffset: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "70%",
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                color: chartTextColor,
                usePointStyle: true,
                font: { weight: "600", family: "Plus Jakarta Sans" }
              }
            },
            tooltip: {
              backgroundColor: isDark ? "#122a1c" : "#10291b",
              padding: 12,
              cornerRadius: 8
            }
          }
        }
      });
    }

    if (statusChartCanvas) {
      activeCharts.status = new Chart(statusChartCanvas, {
        type: "bar",
        data: {
          labels: ["Completed", "Pending", "Processing", "Archived"],
          datasets: [
            {
              label: "Records",
              data: [421, 76, 48, 312],
              backgroundColor: [
                "#0f6b3d",
                "#43ad67",
                "#7ddc95",
                "#b5efc3"
              ],
              borderRadius: 8,
              borderSkipped: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: isDark ? "#122a1c" : "#10291b",
              padding: 12,
              cornerRadius: 8
            }
          },
          scales: {
            x: {
              ticks: {
                color: chartTextColor,
                font: { weight: "600" }
              },
              grid: { display: false }
            },
            y: {
              beginAtZero: true,
              ticks: { color: chartTextColor },
              grid: { color: chartGridColor }
            }
          }
        }
      });
    }
  }

  // Initial render on document mount
  renderCharts();
});