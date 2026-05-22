document.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();

  const menuBtn = document.getElementById("menuBtn");
  const navLinks = document.getElementById("navLinks");

  if (menuBtn && navLinks) {
    menuBtn.addEventListener("click", () => {
      navLinks.classList.toggle("open");
    });
  }

  const profileMenu = document.getElementById("profileMenu");
  const profileBtn = document.getElementById("profileBtn");
  const profileDropdown = document.getElementById("profileDropdown");
  const logoutBtn = document.getElementById("logoutBtn");

  if (profileBtn && profileMenu) {
    profileBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      profileMenu.classList.toggle("open");
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
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      const confirmLogout = confirm("Are you sure you want to logout?");

      if (confirmLogout) {
        window.location.href = "login.html";
      }
    });
  }

  const typingText = document.getElementById("typingText");

  if (typingText) {
    const words = [
      "Information Management System",
      "Digital Repository",
      "Document Classification",
      "Records Monitoring"
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
        setTimeout(typeEffect, 1300);
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

  const counters = document.querySelectorAll(".counter");
  let counterStarted = false;

  function startCounters() {
    if (counterStarted) return;

    counters.forEach((counter) => {
      const target = Number(counter.getAttribute("data-target"));
      let count = 0;
      const speed = Math.ceil(target / 80);

      function updateCounter() {
        count += speed;

        if (count >= target) {
          counter.textContent = target;
        } else {
          counter.textContent = count;
          requestAnimationFrame(updateCounter);
        }
      }

      updateCounter();
    });

    counterStarted = true;
  }

  const revealElements = document.querySelectorAll(".reveal");

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

  const moduleSearch = document.getElementById("moduleSearch");
  const moduleCards = document.querySelectorAll(".module-card");

  if (moduleSearch) {
    moduleSearch.addEventListener("input", () => {
      const searchValue = moduleSearch.value.toLowerCase();

      moduleCards.forEach((card) => {
        const moduleName = card.getAttribute("data-name").toLowerCase();
        const moduleText = card.textContent.toLowerCase();

        if (moduleName.includes(searchValue) || moduleText.includes(searchValue)) {
          card.style.display = "block";
        } else {
          card.style.display = "none";
        }
      });
    });
  }

  const navItems = document.querySelectorAll(".nav-links a");
  const sections = document.querySelectorAll("section");

  window.addEventListener("scroll", () => {
    let currentSection = "";

    sections.forEach((section) => {
      const sectionTop = section.offsetTop - 120;

      if (window.scrollY >= sectionTop) {
        currentSection = section.getAttribute("id");
      }
    });

    navItems.forEach((item) => {
      item.classList.remove("active");

      if (item.getAttribute("href") === `#${currentSection}`) {
        item.classList.add("active");
      }
    });
  });

  function createCharts() {
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
              data: [12, 18, 14, 22, 19, 28],
              borderColor: "#0f6b3d",
              backgroundColor: "rgba(15, 107, 61, 0.12)",
              fill: true,
              tension: 0.4,
              pointRadius: 0
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              display: false
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
              tension: 0.4
            },
            {
              label: "Outgoing",
              data: [35, 42, 51, 55, 69, 74],
              borderColor: "#43ad67",
              backgroundColor: "rgba(67, 173, 103, 0.12)",
              fill: true,
              tension: 0.4
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              labels: {
                usePointStyle: true
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true
            }
          }
        }
      });
    }

    if (categoryChart) {
      new Chart(categoryChart, {
        type: "doughnut",
        data: {
          labels: ["Incoming", "Outgoing", "Memo", "Travel", "Inventory"],
          datasets: [
            {
              data: [32, 24, 18, 14, 12],
              backgroundColor: [
                "#0f6b3d",
                "#43ad67",
                "#7ddc95",
                "#b5efc3",
                "#d9eadf"
              ],
              borderWidth: 0
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: "bottom"
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
              borderRadius: 14
            }
          ]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              display: false
            }
          },
          scales: {
            y: {
              beginAtZero: true
            }
          }
        }
      });
    }
  }

  createCharts();
});