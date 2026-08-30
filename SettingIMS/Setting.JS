/* ==========================================================================
   FIREBASE CONFIGURATION & BACKEND INITIALIZATION
   ========================================================================== */
// Replace with your Firebase Project Configuration keys
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "pgenro-ims.firebaseapp.com",
  projectId: "pgenro-ims",
  storageBucket: "pgenro-ims.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};

let app, auth, db, storage;
let isFirebaseInitialized = false;
let currentUserUID = null;

try {
  if (typeof firebase !== "undefined") {
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    storage = firebase.storage();
    isFirebaseInitialized = true;
  }
} catch (err) {
  console.log("Firebase initialized in Local/Offline Sync Mode.");
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();

  // Settings Tab Switching
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");

      tabBtns.forEach((b) => b.classList.remove("active"));
      tabPanels.forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");
      const activePanel = document.getElementById(targetTab);
      if (activePanel) activePanel.classList.add("active");
    });
  });

  // Check Auth State on Page Load
  if (isFirebaseInitialized && auth) {
    auth.onAuthStateChanged((user) => {
      if (user) {
        currentUserUID = user.uid;
        document.getElementById("authBtnText").textContent = "Sign Out";
        loadFirebaseUserProfile(user.uid);
      } else {
        currentUserUID = null;
        document.getElementById("authBtnText").textContent = "Sign In / Register";
        loadLocalStorageUserData();
      }
    });
  } else {
    loadLocalStorageUserData();
  }

  // Avatar Image Upload & Firebase Storage / LocalStorage Handler
  const changeAvatarBtn = document.getElementById("changeAvatarBtn");
  const avatarFileInput = document.getElementById("avatarFileInput");
  const avatarPreview = document.getElementById("avatarPreview");

  if (changeAvatarBtn && avatarFileInput && avatarPreview) {
    changeAvatarBtn.addEventListener("click", () => avatarFileInput.click());

    avatarFileInput.addEventListener("change", async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        if (!file.type.startsWith("image/")) {
          showToast("Please select a valid image file.", "error");
          return;
        }

        const reader = new FileReader();
        reader.onload = async function (event) {
          const imageBase64 = event.target.result;
          avatarPreview.src = imageBase64;

          if (isFirebaseInitialized && currentUserUID) {
            try {
              // Upload to Firebase Storage or Firestore document
              await db.collection("users").doc(currentUserUID).set({
                photoURL: imageBase64
              }, { merge: true });
              showToast("Avatar saved to Firebase Storage!");
            } catch (err) {
              console.error(err);
              localStorage.setItem("pgenro_user_avatar", imageBase64);
              showToast("Avatar saved locally.");
            }
          } else {
            localStorage.setItem("pgenro_user_avatar", imageBase64);
            showToast("Avatar saved locally.");
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Personal Info Form Submission
  const personalInfoForm = document.getElementById("personalInfoForm");
  if (personalInfoForm) {
    personalInfoForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const fullName = document.getElementById("fullNameInput").value;
      const employeeId = document.getElementById("employeeIdInput").value;
      const designation = document.getElementById("designationInput").value;
      const email = document.getElementById("emailInput").value;
      const phone = document.getElementById("phoneInput").value;
      const division = document.getElementById("divisionSelect").value;

      document.getElementById("profileNameDisplay").textContent = fullName;
      document.getElementById("profileRoleDisplay").textContent = designation;

      const userData = {
        fullName,
        employeeId,
        designation,
        email,
        phone,
        division,
        updatedAt: new Date().toISOString()
      };

      if (isFirebaseInitialized && currentUserUID) {
        try {
          await db.collection("users").doc(currentUserUID).set(userData, { merge: true });
          showToast("Profile updated in Firebase Firestore!");
        } catch (err) {
          console.error(err);
          saveToLocalStorage(userData);
          showToast("Profile saved to local storage.");
        }
      } else {
        saveToLocalStorage(userData);
        showToast("Profile saved to local storage.");
      }
    });
  }

  // Security Form Submission (Password & 2FA Update)
  const securityForm = document.getElementById("securityForm");
  if (securityForm) {
    securityForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const newPass = document.getElementById("newPasswordInput").value;
      const confirmPass = document.getElementById("confirmPasswordInput").value;
      const isTwoFactor = document.getElementById("twoFactorToggle").checked;

      if (newPass.length < 6) {
        showToast("New password must be at least 6 characters.", "error");
        return;
      }

      if (newPass !== confirmPass) {
        showToast("Passwords do not match! Please check.", "error");
        return;
      }

      if (isFirebaseInitialized && auth.currentUser) {
        try {
          await auth.currentUser.updatePassword(newPass);
          await db.collection("users").doc(currentUserUID).set({ twoFactorEnabled: isTwoFactor }, { merge: true });
          securityForm.reset();
          showToast("Password updated in Firebase Auth!");
        } catch (err) {
          showToast(err.message, "error");
        }
      } else {
        securityForm.reset();
        localStorage.setItem("pgenro_2fa", isTwoFactor);
        showToast("Security settings updated locally.");
      }
    });
  }

  // Live Theme Mode Switcher
  const themeLightRadio = document.getElementById("themeLightRadio");
  const themeDarkRadio = document.getElementById("themeDarkRadio");
  const lightThemeCard = document.getElementById("lightThemeCard");
  const darkThemeCard = document.getElementById("darkThemeCard");

  if (themeLightRadio && themeDarkRadio) {
    themeLightRadio.addEventListener("change", () => {
      setTheme("light");
      lightThemeCard.classList.add("active");
      darkThemeCard.classList.remove("active");
    });

    themeDarkRadio.addEventListener("change", () => {
      setTheme("dark");
      darkThemeCard.classList.add("active");
      lightThemeCard.classList.remove("active");
    });
  }

  // System Preferences Form
  const preferencesForm = document.getElementById("preferencesForm");
  if (preferencesForm) {
    preferencesForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const autoParse = document.getElementById("autoParseToggle").checked;
      const emailNotif = document.getElementById("emailNotifToggle").checked;

      if (isFirebaseInitialized && currentUserUID) {
        try {
          await db.collection("users").doc(currentUserUID).set({
            autoParse,
            emailNotif
          }, { merge: true });
          showToast("Preferences synced to Firebase!");
        } catch (err) {
          localStorage.setItem("pgenro_autoparse", autoParse);
          localStorage.setItem("pgenro_emailnotif", emailNotif);
          showToast("Preferences saved locally.");
        }
      } else {
        localStorage.setItem("pgenro_autoparse", autoParse);
        localStorage.setItem("pgenro_emailnotif", emailNotif);
        showToast("Preferences saved locally.");
      }
    });
  }

  // Auth Modal Controls & Register Switcher
  initAuthModalLogic();
});

// Load User Data from Firebase Firestore
async function loadFirebaseUserProfile(uid) {
  try {
    const doc = await db.collection("users").doc(uid).get();
    if (doc.exists) {
      const data = doc.data();
      if (data.fullName) {
        document.getElementById("fullNameInput").value = data.fullName;
        document.getElementById("profileNameDisplay").textContent = data.fullName;
      }
      if (data.employeeId) document.getElementById("employeeIdInput").value = data.employeeId;
      if (data.designation) {
        document.getElementById("designationInput").value = data.designation;
        document.getElementById("profileRoleDisplay").textContent = data.designation;
      }
      if (data.email) document.getElementById("emailInput").value = data.email;
      if (data.phone) document.getElementById("phoneInput").value = data.phone;
      if (data.division) document.getElementById("divisionSelect").value = data.division;
      if (data.photoURL) document.getElementById("avatarPreview").src = data.photoURL;
      if (data.twoFactorEnabled !== undefined) document.getElementById("twoFactorToggle").checked = data.twoFactorEnabled;
      if (data.autoParse !== undefined) document.getElementById("autoParseToggle").checked = data.autoParse;
      if (data.emailNotif !== undefined) document.getElementById("emailNotifToggle").checked = data.emailNotif;
    }
  } catch (err) {
    console.error("Firestore sync error:", err);
  }
}

// Save LocalStorage Backup
function saveToLocalStorage(data) {
  localStorage.setItem("pgenro_user_fullname", data.fullName);
  localStorage.setItem("pgenro_user_employee_id", data.employeeId);
  localStorage.setItem("pgenro_user_designation", data.designation);
  localStorage.setItem("pgenro_user_email", data.email);
  localStorage.setItem("pgenro_user_phone", data.phone);
  localStorage.setItem("pgenro_user_division", data.division);
}

// Restore Saved User Data from Local Storage
function loadLocalStorageUserData() {
  const savedTheme = localStorage.getItem("pgenro_theme_mode");
  if (savedTheme) setTheme(savedTheme);

  const savedAvatar = localStorage.getItem("pgenro_user_avatar");
  if (savedAvatar) document.getElementById("avatarPreview").src = savedAvatar;

  const savedName = localStorage.getItem("pgenro_user_fullname");
  if (savedName) {
    document.getElementById("fullNameInput").value = savedName;
    document.getElementById("profileNameDisplay").textContent = savedName;
  }

  const savedDesignation = localStorage.getItem("pgenro_user_designation");
  if (savedDesignation) {
    document.getElementById("designationInput").value = savedDesignation;
    document.getElementById("profileRoleDisplay").textContent = savedDesignation;
  }

  const savedEmail = localStorage.getItem("pgenro_user_email");
  if (savedEmail) document.getElementById("emailInput").value = savedEmail;

  const savedPhone = localStorage.getItem("pgenro_user_phone");
  if (savedPhone) document.getElementById("phoneInput").value = savedPhone;

  const savedDivision = localStorage.getItem("pgenro_user_division");
  if (savedDivision) document.getElementById("divisionSelect").value = savedDivision;
}

// Dynamic Theme Switcher
function setTheme(mode) {
  document.documentElement.setAttribute("data-theme", mode);
  localStorage.setItem("pgenro_theme_mode", mode);
}

// FIREBASE SIGN IN / REGISTRATION MODAL LOGIC
function initAuthModalLogic() {
  const openAuthModalBtn = document.getElementById("openAuthModalBtn");
  const closeAuthModalBtn = document.getElementById("closeAuthModalBtn");
  const cancelAuthModalBtn = document.getElementById("cancelAuthModalBtn");
  const authModal = document.getElementById("authModal");

  const toggleLoginBtn = document.getElementById("toggleLoginBtn");
  const toggleRegisterBtn = document.getElementById("toggleRegisterBtn");
  const regNameGroup = document.getElementById("regNameGroup");
  const authSubmitBtn = document.getElementById("authSubmitBtn");
  const firebaseAuthForm = document.getElementById("firebaseAuthForm");

  let isRegisterMode = false;

  if (openAuthModalBtn) {
    openAuthModalBtn.addEventListener("click", () => {
      if (auth && auth.currentUser) {
        auth.signOut().then(() => {
          showToast("Signed out from Firebase.");
        });
      } else {
        if (authModal) authModal.classList.add("open");
      }
    });
  }

  if (closeAuthModalBtn) closeAuthModalBtn.addEventListener("click", () => authModal.classList.remove("open"));
  if (cancelAuthModalBtn) cancelAuthModalBtn.addEventListener("click", () => authModal.classList.remove("open"));

  toggleLoginBtn.addEventListener("click", () => {
    isRegisterMode = false;
    toggleLoginBtn.classList.add("active");
    toggleRegisterBtn.classList.remove("active");
    regNameGroup.style.display = "none";
    authSubmitBtn.innerHTML = `<i data-lucide="log-in"></i> Sign In to IMS`;
    if (window.lucide) lucide.createIcons();
  });

  toggleRegisterBtn.addEventListener("click", () => {
    isRegisterMode = true;
    toggleRegisterBtn.classList.add("active");
    toggleLoginBtn.classList.remove("active");
    regNameGroup.style.display = "block";
    authSubmitBtn.innerHTML = `<i data-lucide="user-plus"></i> Register New Account`;
    if (window.lucide) lucide.createIcons();
  });

  firebaseAuthForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("authEmail").value;
    const password = document.getElementById("authPassword").value;
    const fullName = document.getElementById("regFullName").value;

    if (!isFirebaseInitialized || !auth) {
      showToast("Firebase SDK not connected. Paste your API keys in Account.js.", "error");
      return;
    }

    try {
      if (isRegisterMode) {
        // Firebase Auth Create User
        const userCred = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCred.user;

        // Save default Firestore profile document
        await db.collection("users").doc(user.uid).set({
          fullName: fullName || "PGENRO Officer",
          email: email,
          designation: "Provincial Environment Officer",
          employeeId: "PGENRO-2026-REG",
          division: "Executive Office",
          createdAt: new Date().toISOString()
        });

        showToast("Account registered successfully in Firebase!");
      } else {
        // Firebase Auth Sign In
        await auth.signInWithEmailAndPassword(email, password);
        showToast("Signed in successfully!");
      }

      authModal.classList.remove("open");
      firebaseAuthForm.reset();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

// Custom Toast Notification System
function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  if (type === "error") {
    toast.style.borderLeftColor = "var(--accent-red)";
  }

  toast.innerHTML = `
    <i data-lucide="${type === 'error' ? 'alert-circle' : 'check-circle-2'}" style="color:${type === 'error' ? 'var(--accent-red)' : 'var(--primary)'}"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}