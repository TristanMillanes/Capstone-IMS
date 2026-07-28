document.addEventListener("DOMContentLoaded", () => {
  // Initialize Lucide Icons
  if (window.lucide) {
    lucide.createIcons();
  }

  // DOM Elements
  const hamburgerMenu = document.getElementById("hamburgerMenu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");
  const mainContent = document.getElementById("mainContent");

  const profileMenu = document.getElementById("profileMenu");
  const profileBtn = document.getElementById("profileBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const scrollToTopBtn = document.getElementById("scrollToTopBtn");

  const settingsAlert = document.getElementById("settingsAlert");

  // 1. HAMBURGER MENU & FLOATING SIDEBAR TOGGLE
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

    const sidebarAnchors = sidebar.querySelectorAll("a");
    sidebarAnchors.forEach((link) => {
      link.addEventListener("click", closeMenu);
    });
  }

  // 2. PROFILE MENU DROPDOWN
  if (profileBtn && profileMenu) {
    profileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("open");
    });
  }

  document.addEventListener("click", () => {
    profileMenu?.classList.remove("open");
  });

  // 3. LOGOUT HANDLER
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to end your PGENRO IMS session?")) {
        window.location.href = "login.html";
      }
    });
  }

  // 4. FLOATING ALERT HELPER
  function showAlert(message, type = "success") {
    if (!settingsAlert) return;
    settingsAlert.innerHTML = `
      <div class="alert-toast ${type}">
        <i data-lucide="${type === 'success' ? 'check-circle' : 'alert-triangle'}"></i>
        <span>${message}</span>
      </div>
    `;
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
      settingsAlert.innerHTML = "";
    }, 4000);
  }

  // 5. TAB SWITCHING LOGIC (Profile, Security, Preferences)
  const navItems = document.querySelectorAll(".settings-nav-item");
  const panels = {
    profile: document.getElementById("profile"),
    security: document.getElementById("security"),
    preferences: document.getElementById("preferences")
  };

  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const selectedTab = btn.getAttribute("data-tab");

      // Update Active Navigation Item
      navItems.forEach((item) => item.classList.remove("active"));
      btn.classList.add("active");

      // Hide all panels & show selected
      Object.keys(panels).forEach((key) => {
        if (panels[key]) {
          panels[key].style.display = key === selectedTab ? "block" : "none";
        }
      });
    });
  });

  // 6. FORM SUBMISSIONS
  const profileForm = document.getElement