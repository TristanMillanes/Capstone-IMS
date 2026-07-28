document.addEventListener("DOMContentLoaded", () => {
  // Global Chart Reference Pool for strict memory control
  const activeCharts = {
    commCompare: null,
    visitorMini: null
  };

  // Initialize Lucide Icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // DOM Elements Selection
  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const mainContent = document.getElementById("mainContent");

  const profileMenu = document.getElementById("profileMenu");
  const profileBtn = document.getElementById("profileBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const scrollToTopBtn = document.getElementById("scrollToTopBtn");

  // HAMBURGER AND SIDEBAR TRIGGER INTERACTION
  if (hamburgerMenu && sidebar && overlay && mainContent) {
    const toggleMenu = () => {
      sidebar.classList.toggle("open");
      hamburgerMenu.classList.toggle("active");
      overlay.classList.toggle("active");
      mainContent.classList.toggle("blur");
    };

    const closeMenu = () => {
      sidebar.classList.remove("open");
      hamburgerMenu.classList.remove("active");
      overlay.classList.remove("active");
      mainContent.classList.remove("blur");
    };

    hamburgerMenu.addEventListener("click", toggleMenu);
    overlay.addEventListener("click", closeMenu);
    
    // Close sidebar on anchor selection inside the panel
    const sidebarAnchors = sidebar.querySelectorAll("a");
    sidebarAnchors.forEach((link) => {
      link.addEventListener("click", closeMenu);
    });
  }

  // Profile control toggles
  if (profileBtn && profileMenu) {
    profileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("open");
    });
  }

  document.addEventListener("click", () => {
    profileMenu?.classList.remove("open");
  });

  // Confirm logout handler
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to end your current session?")) {
        window.location.href = "login.html";
      }
    });
  }

  // Smooth Anchoring
  const smoothLinks = document.querySelectorAll('a[href^="#"]');
  smoothLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const targetId = link.getAttribute("href");
      if (!targetId || targetId === "#") return;
      
      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        e.preventDefault();
        targetElement.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }
    });
  });

  // Floating Scroll back up Action
  window.addEventListener("scroll", () => {
    if (scrollToTopBtn) {
      if (window.scrollY > 300) {
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

  // Count animations for Visitor Log Numbers Panel
  const counters = document.querySelectorAll(".counter");
  let countersFired = false;

  function runCounters() {
    if (countersFired) return;
    counters.forEach((counter) => {
      const maxVal = Number(counter.getAttribute("data-target")) || 0;
      let currentVal = 0;
      const stepValue = Math.max(1, Math.ceil(maxVal / 60));

      function countStep() {
        currentVal += stepValue;
        if (currentVal >= maxVal) {
          counter.textContent = maxVal.toLocaleString();
        } else {
          counter.textContent = currentVal.toLocaleString();
          requestAnimationFrame(countStep);
        }
      }
      countStep();
    });
    countersFired = true;
  }

  // Scroll reveal trigger
  const revealElements = document.querySelectorAll(".reveal");
  function runScrollReveal() {
    const triggerHeight = window.innerHeight - 50;
    revealElements.forEach((el) => {
      const topOffset = el.getBoundingClientRect().top;
      if (topOffset < triggerHeight) {
        el.classList.add("show");
      }
    });

    // Trigger counters once visitor stats panel comes into view
    const statsGrid = document.querySelector(".visitor-numbers-grid");
    if (statsGrid) {
      const gridOffset = statsGrid.getBoundingClientRect().top;
      if (gridOffset < window.innerHeight) {
        runCounters();
      }
    }
  }

  window.addEventListener("scroll", runScrollReveal);
  runScrollReveal(); // Run on startup

  // Active navigation highlighter on scroll
  const navAnchors = document.querySelectorAll(".nav-links a");
  const docSections = document.querySelectorAll("section, footer");

  function highlightActiveNavigation() {
    let activeId = "";
    docSections.forEach((sec) => {
      const offsetTop = sec.offsetTop - 150;
      if (window.scrollY >= offsetTop) {
        activeId = sec.getAttribute("id") || "";
      }
    });

    navAnchors.forEach((anchor) => {
      anchor.classList.toggle("active", anchor.getAttribute("href") === `#${activeId}`);
    });
  }
  window.addEventListener("scroll", highlightActiveNavigation);
  highlightActiveNavigation();

  // Setup Specific System Charts (Communications Flow & Visitor Volume Logs)
  function renderSystemCharts() {
    if (!window.Chart) return;

    // Clean active chart objects before starting
    Object.keys(activeCharts).forEach((key) => {
      if (activeCharts[key]) {
        activeCharts[key].destroy();
      }
    });

    const gridColor = "rgba(15, 107, 61, 0.04)";
    const textColor = "#5e7264";
    const brandColorPrimary = "#0f6b3d";
    const brandColorSecondary = "#46b86b";

    // Select Canvas Contexts
    const canvasCommCompare = document.getElementById("commCompareChart");
    const canvasVisitorMini = document.getElementById("visitorMiniBarChart");

    // CHART 1: Document Flow Trends Line Chart
    if (canvasCommCompare) {
      const ctx = canvasCommCompare.getContext("2d");
      
      const gradientIncoming = ctx.createLinearGradient(0, 0, 0, 260);
      gradientIncoming.addColorStop(0, "rgba(15, 107, 61, 0.12)");
      gradientIncoming.addColorStop(1, "rgba(15, 107, 61, 0.0)");

      const gradientOutgoing = ctx.createLinearGradient(0, 0, 0, 260);
      gradientOutgoing.addColorStop(0, "rgba(70, 184, 107, 0.08)");
      gradientOutgoing.addColorStop(1, "rgba(70, 184, 107, 0.0)");

      activeCharts.commCompare = new Chart(canvasCommCompare, {
        type: "line",
        data: {
          labels: ["May", "Jun", "Jul", "Aug", "Sep", "Oct"],
          datasets: [
            {
              label: "Incoming Documents",
              data: [54, 78, 62, 89, 95, 128],
              borderColor: brandColorPrimary,
              backgroundColor: gradientIncoming,
              fill: true,
              tension: 0.35,
              borderWidth: 3,
              pointBackgroundColor: brandColorPrimary,
              pointHoverRadius: 6
            },
            {
              label: "Outgoing Releases",
              data: [38, 52, 45, 68, 74, 91],
              borderColor: brandColorSecondary,
              backgroundColor: gradientOutgoing,
              fill: true,
              tension: 0.35,
              borderWidth: 2,
              pointBackgroundColor: brandColorSecondary,
              pointHoverRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "top",
              labels: {
                color: textColor,
                usePointStyle: true,
                boxWidth: 8,
                font: { weight: "600", family: "Plus Jakarta Sans", size: 11 }
              }
            },
            tooltip: {
              backgroundColor: "#09170f",
              padding: 12,
              titleColor: "#ffffff",
              bodyColor: "#ffffff"
            }
          },
          scales: {
            x: {
              ticks: { color: textColor, font: { family: "Plus Jakarta Sans", size: 10 } },
              grid: { display: false }
            },
            y: {
              beginAtZero: true,
              ticks: { color: textColor, font: { family: "Plus Jakarta Sans", size: 10 } },
              grid: { color: gridColor }
            }
          }
        }
      });
    }

    // CHART 2: Weekly Visitor Distribution Mini Bar Chart
    if (canvasVisitorMini) {
      activeCharts.visitorMini = new Chart(canvasVisitorMini, {
        type: "bar",
        data: {
          labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
          datasets: [{
            data: [28, 42, 35, 52, 48, 11],
            backgroundColor: brandColorSecondary,
            hoverBackgroundColor: brandColorPrimary,
            borderRadius: 6,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#09170f",
              padding: 10
            }
          },
          scales: {
            x: {
              ticks: { color: textColor, font: { weight: "700", family: "Plus Jakarta Sans", size: 9 } },
              grid: { display: false }
            },
            y: {
              beginAtZero: true,
              display: false,
              grid: { display: false }
            }
          }
        }
      });
    }
  }

  // Start Charts Engine
  renderSystemCharts();
});