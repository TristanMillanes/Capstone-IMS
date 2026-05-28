document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  const menuBtn = document.getElementById("menuBtn");
  const navLinks = document.getElementById("navLinks");
  const profileMenu = document.getElementById("profileMenu");
  const profileBtn = document.getElementById("profileBtn");
  const profileDropdown = document.getElementById("profileDropdown");
  const logoutBtn = document.getElementById("logoutBtn");

  // MOBILE NAVIGATION
  if (menuBtn && navLinks) {
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      navLinks.classList.toggle("open");
    });
  }

  // PROFILE DROPDOWN
  if (profileBtn && profileMenu) {
    profileBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      profileMenu.classList.toggle("open");

      if (navLinks) {
        navLinks.classList.remove("open");
      }
    });
  }

  if (profileDropdown) {
    profileDropdown.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }

  document.addEventListener("click", () => {
    if (profileMenu) {
      profileMenu.classList.remove("open");
    }

    if (navLinks) {
      navLinks.classList.remove("open");
    }
  });

  // LOGOUT BUTTON
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      const confirmLogout = confirm("Are you sure you want to logout?");

      if (confirmLogout) {
        window.location.href = "login.html";
      }
    });
  }

  // SMOOTH SCROLLING
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

      if (navLinks) {
        navLinks.classList.remove("open");
      }

      if (profileMenu) {
        profileMenu.classList.remove("open");
      }
    });
  });

  // TYPING TEXT EFFECT
  const typingText = document.getElementById("typingText");

  if (typingText) {
    const words = [
      "Information Management System",
      "Pronvicial Government",
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

        setTimeout(typeEffect, 1200);
        return;
      }

      if (isDeleting && charIndex === 0) {
        isDeleting = false;
        wordIndex = (wordIndex + 1) % words.length;
      }

      setTimeout(typeEffect, isDeleting ? 45 : 85);
    }

    typeEffect();
  }

  // REVEAL ANIMATION AND COUNTERS
  const revealElements = document.querySelectorAll(".reveal");
  const counters = document.querySelectorAll(".counter");
  let counterStarted = false;

  function startCounters() {
    if (counterStarted) return;

    counters.forEach((counter) => {
      const target = Number(counter.getAttribute("data-target")) || 0;
      let count = 0;
      const speed = Math.max(1, Math.ceil(target / 90));

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
      const revealPoint = 100;

      if (elementTop < windowHeight - revealPoint) {
        element.classList.add("show");
      }
    });

    startCounters();
  }

  window.addEventListener("scroll", revealOnScroll);
  revealOnScroll();

  // MODULE SEARCH
  const moduleSearch = document.getElementById("moduleSearch");
  const moduleCards = document.querySelectorAll(".module-card");

  if (moduleSearch) {
    moduleSearch.addEventListener("input", () => {
      const searchValue = moduleSearch.value.toLowerCase().trim();

      moduleCards.forEach((card) => {
        const moduleName = (card.getAttribute("data-name") || "").toLowerCase();
        const moduleText = card.textContent.toLowerCase();

        const isMatch =
          moduleName.includes(searchValue) ||
          moduleText.includes(searchValue);

        card.style.display = isMatch ? "block" : "none";
      });
    });
  }

  // ACTIVE NAVIGATION LINK
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
      item.classList.toggle(
        "active",
        item.getAttribute("href") === `#${currentSection}`
      );
    });

    sidebarItems.forEach((item) => {
      item.classList.toggle(
        "active",
        item.getAttribute("href") === `#${currentSection}`
      );
    });
  }

  window.addEventListener("scroll", updateActiveLinks);
  updateActiveLinks();

  // CHARTS
  function createCharts() {
    if (!window.Chart) return;

    const chartTextColor = "#64766a";
    const chartGridColor = "rgba(15, 107, 61, 0.09)";

    const miniChart = document.getElementById("miniChart");
    const monthlyChart = document.getElementById("monthlyChart");
    const categoryChart = document.getElementById("categoryChart");
    const statusChart = document.getElementById("statusChart");

    if (miniChart) {
      new Chart(miniChart, {
        type: "line",
        data: {
          labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
          datasets: [
            {
              label: "Documents",
              data: [12, 18, 14, 22, 19, 28],
              borderColor: "#7ddc95",
              backgroundColor: "rgba(125, 220, 149, 0.18)",
              fill: true,
              tension: 0.42,
              pointRadius: 0,
              borderWidth: 3
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              backgroundColor: "#10291b",
              padding: 12,
              cornerRadius: 12
            }
          },
          scales: {
            x: {
              display: false
            },
            y: {
              display: false
            }
          }
        }
      });
    }

    if (monthlyChart) {
      new Chart(monthlyChart, {
        type: "line",
        data: {
          labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
          datasets: [
            {
              label: "Incoming",
              data: [45, 58, 62, 70, 83, 91],
              borderColor: "#0f6b3d",
              backgroundColor: "rgba(15, 107, 61, 0.12)",
              fill: true,
              tension: 0.4,
              borderWidth: 3
            },
            {
              label: "Outgoing",
              data: [35, 42, 51, 55, 69, 74],
              borderColor: "#43ad67",
              backgroundColor: "rgba(67, 173, 103, 0.12)",
              fill: true,
              tension: 0.4,
              borderWidth: 3
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
                font: {
                  weight: "700"
                }
              }
            },
            tooltip: {
              backgroundColor: "#10291b",
              padding: 12,
              cornerRadius: 12
            }
          },
          scales: {
            x: {
              ticks: {
                color: chartTextColor
              },
              grid: {
                display: false
              }
            },
            y: {
              beginAtZero: true,
              ticks: {
                color: chartTextColor
              },
              grid: {
                color: chartGridColor
              }
            }
          }
        }
      });
    }

    if (categoryChart) {
      new Chart(categoryChart, {
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
                "#d9eadf"
              ],
              borderWidth: 0,
              hoverOffset: 8
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "65%",
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                color: chartTextColor,
                usePointStyle: true,
                font: {
                  weight: "700"
                }
              }
            },
            tooltip: {
              backgroundColor: "#10291b",
              padding: 12,
              cornerRadius: 12
            }
          }
        }
      });
    }

    if (statusChart) {
      new Chart(statusChart, {
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
              borderRadius: 14,
              borderSkipped: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              backgroundColor: "#10291b",
              padding: 12,
              cornerRadius: 12
            }
          },
          scales: {
            x: {
              ticks: {
                color: chartTextColor,
                font: {
                  weight: "700"
                }
              },
              grid: {
                display: false
              }
            },
            y: {
              beginAtZero: true,
              ticks: {
                color: chartTextColor
              },
              grid: {
                color: chartGridColor
              }
            }
          }
        }
      });
    }
  }

  createCharts();
});