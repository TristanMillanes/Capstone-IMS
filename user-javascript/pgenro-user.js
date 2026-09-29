/* PGENRO IMS — shared user-portal enhancements. */
(function () {
  "use strict";


  const safeStorage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    remove(key) { try { localStorage.removeItem(key); } catch {} }
  };

  function readCachedProfile() {
    try {
      return JSON.parse(safeStorage.get("pgenro_current_user") || "null") || null;
    } catch { return null; }
  }

  function populateExistingProfile(profile) {
    if (!profile) return;
    document.querySelectorAll(".profile-dropdown-header h3").forEach((el) => {
      if (profile.fullName || profile.full_name) el.textContent = profile.fullName || profile.full_name;
    });
    document.querySelectorAll(".profile-text h4").forEach((el) => {
      if (profile.position || profile.role) el.textContent = profile.position || profile.role;
    });
  }

  function normalizeHeaderStructure() {
    const header = document.querySelector(".navbar");
    if (!header || header.querySelector(":scope > .nav-left-container")) return;
    const logo = Array.from(header.children).find((el) => el.classList?.contains("logo-area"));
    const hamburger = Array.from(header.children).find((el) => el.id === "hamburgerMenu");
    if (!logo || !hamburger) return;

    const left = document.createElement("div");
    left.className = "nav-left-container";
    header.insertBefore(left, logo);
    left.appendChild(hamburger);
    left.appendChild(logo);
  }

  function injectCompactProfile() {
    if (document.getElementById("profileMenu") || document.querySelector(".pgenro-profile-menu")) return;
    const header = document.querySelector(".navbar");
    if (!header) return;

    let right = header.querySelector(".right-nav,.nav-right-container,.nav-right-actions");
    if (!right) {
      right = document.createElement("div");
      right.className = "right-nav";
      header.appendChild(right);
    }

    const wrap = document.createElement("div");
    wrap.className = "pgenro-profile-menu profile-menu";
    wrap.innerHTML = `
      <button class="pgenro-profile-trigger" type="button" aria-label="Open profile menu" aria-expanded="false">
        <span class="profile-avatar"><i data-lucide="user"></i></span>
      </button>
      <div class="pgenro-profile-dropdown" role="menu">
        <div class="profile-dropdown-header">
          <div>
            <h3>PGENRO User</h3>
            <p>Authorized account</p>
          </div>
        </div>
        <a href="homepage.html" role="menuitem"><i data-lucide="layout-dashboard"></i><span>Dashboard</span></a>
        <a href="../SettingIMS/Settings.html?from=user" role="menuitem"><i data-lucide="settings"></i><span>Account Settings</span></a>
        <button class="logout-btn" data-pgenro-logout type="button" role="menuitem"><i data-lucide="log-out"></i><span>Logout</span></button>
      </div>`;
    right.appendChild(wrap);

    // workspace.js owns profile controls; shared/supabase.js owns sign-out.
  }

  document.addEventListener("DOMContentLoaded", () => {
    normalizeHeaderStructure();
    injectCompactProfile();

    // Add one settings entry to existing user profile menus and module sidebars.
    document.querySelectorAll('.profile-dropdown,.pgenro-profile-dropdown').forEach(menu => {
      if (!menu.querySelector('a[href*="SettingIMS/Settings.html"]')) {
        const link = document.createElement('a');
        link.href = '../SettingIMS/Settings.html?from=user';
        link.setAttribute('role','menuitem');
        link.innerHTML = '<i data-lucide="settings"></i><span>Account Settings</span>';
        const logout = menu.querySelector('.logout-btn,[data-pgenro-logout]');
        if (logout) menu.insertBefore(link, logout); else menu.appendChild(link);
      }
    });
    document.querySelectorAll('.modules-list').forEach(list => {
      if (!list.querySelector('a[href*="SettingIMS/Settings.html"]')) {
        const li=document.createElement('li');
        li.innerHTML='<a href="../SettingIMS/Settings.html?from=user"><i data-lucide="settings"></i><span>Account Settings</span></a>';
        list.appendChild(li);
      }
    });

    populateExistingProfile(readCachedProfile());
    if (window.lucide?.createIcons) window.lucide.createIcons();
    // shared/supabase.js owns all data loading and realtime subscriptions.
  });
})();
