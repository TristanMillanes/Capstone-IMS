// ==========================================================================
// PGENRO IMS — SECURE LOGIN CONTROLLER
// Provincial Government of Quezon
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getDatabase, ref, get, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// FIREBASE CONFIGURATION
const firebaseConfig = {
    apiKey: "AIzaSyAwiRrYub7tl1EXwehKbsCjfwQiyGKxiyE",
    authDomain: "ims-capstone-bc65f.firebaseapp.com",
    databaseURL: "https://ims-capstone-bc65f-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ims-capstone-bc65f",
    storageBucket: "ims-capstone-bc65f.firebasestorage.app",
    messagingSenderId: "972207120140",
    appId: "1:972207120140:web:6a94e2e1e9e8511e933329",
    measurementId: "G-W4TPE7CHC8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const loginForm = document.getElementById("loginForm");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const rememberMe = document.getElementById("rememberMe");
    const togglePassword = document.getElementById("togglePassword");
    const messageBox = document.getElementById("messageBox");
    const card = document.getElementById("interactiveCard");
    const capsLockWarning = document.getElementById("capsLockWarning");
    const loadingOverlay = document.getElementById("loadingOverlay");
    const loadingStatusHeading = document.getElementById("loadingStatusHeading");
    const loadingStatusText = document.getElementById("loadingStatusText");
    const loginButton = document.getElementById("loginBtn");
    const phTimeDisplay = document.getElementById("phTimeDisplay");
    const emailFieldBox = document.getElementById("emailFieldBox");
    const passwordFieldBox = document.getElementById("passwordFieldBox");

    // Safe Lucide renderer
    const renderIcons = () => {
        if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
            lucide.createIcons();
        }
    };
    renderIcons();

    // Philippine Standard Time Clock
    if (phTimeDisplay) {
        const updatePST = () => {
            const now = new Date();
            const formatted = new Intl.DateTimeFormat("en-US", {
                timeZone: "Asia/Manila",
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true
            }).format(now);
            phTimeDisplay.textContent = `PST • ${formatted}`;
        };
        updatePST();
        setInterval(updatePST, 1000);
    }

    // Local Storage Helper
    const storage = {
        get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
        set(key, val) { try { localStorage.setItem(key, val); } catch (e) {} },
        remove(key) { try { localStorage.removeItem(key); } catch (e) {} }
    };

    // Load saved email
    const savedEmail = storage.get("pgenro_saved_email");
    if (savedEmail && emailInput) {
        emailInput.value = savedEmail;
        if (rememberMe) rememberMe.checked = true;
    }

    // Caps Lock Detection
    if (passwordInput && capsLockWarning) {
        const checkCaps = (e) => {
            if (e.getModifierState) {
                const caps = e.getModifierState("CapsLock");
                capsLockWarning.setAttribute("aria-hidden", String(!caps));
            }
        };
        passwordInput.addEventListener("keydown", checkCaps);
        passwordInput.addEventListener("keyup", checkCaps);
        passwordInput.addEventListener("blur", () => capsLockWarning.setAttribute("aria-hidden", "true"));
    }

    // Password Visibility Toggle
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener("click", () => {
            const isPassword = passwordInput.type === "password";
            passwordInput.type = isPassword ? "text" : "password";
            togglePassword.innerHTML = `<i data-lucide="${isPassword ? "eye-off" : "eye"}"></i>`;
            renderIcons();
        });
    }

    // Banner Alert
    const displayBanner = (status, title, text) => {
        if (!messageBox) return;
        messageBox.className = `message-box show ${status}`;
        messageBox.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
        renderIcons();
    };

    const clearBanner = () => {
        if (!messageBox) return;
        messageBox.className = "message-box";
        messageBox.innerHTML = "";
    };

    const triggerVibrate = () => {
        if (!card) return;
        card.classList.remove("shake-trigger");
        void card.offsetWidth;
        card.classList.add("shake-trigger");
        setTimeout(() => card.classList.remove("shake-trigger"), 450);
    };

    const showLoading = (heading, text) => {
        if (!loadingOverlay) return;
        loadingOverlay.classList.add("active");
        loadingOverlay.setAttribute("aria-hidden", "false");
        if (loadingStatusHeading) loadingStatusHeading.textContent = heading;
        if (loadingStatusText) loadingStatusText.textContent = text;
        if (loginButton) loginButton.disabled = true;
    };

    const hideLoading = () => {
        if (!loadingOverlay) return;
        loadingOverlay.classList.remove("active");
        loadingOverlay.setAttribute("aria-hidden", "true");
        if (loginButton) loginButton.disabled = false;
    };

    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    // Clear alert when user interacts
    emailInput?.addEventListener("input", clearBanner);
    passwordInput?.addEventListener("input", clearBanner);
    emailInput?.addEventListener("focus", () => emailFieldBox?.classList.remove("invalid"));
    passwordInput?.addEventListener("focus", () => passwordFieldBox?.classList.remove("invalid"));

    // Form Submit Handler
    loginForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearBanner();

        const email = emailInput?.value.trim().toLowerCase() || "";
        const password = passwordInput?.value || "";

        // Empty validation
        if (!email || !password) {
            if (!email) emailFieldBox?.classList.add("invalid");
            if (!password) passwordFieldBox?.classList.add("invalid");
            triggerVibrate();
            displayBanner("error", "Missing Information", "Please enter both your official email and password.");
            return;
        }

        // Email format validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            emailFieldBox?.classList.add("invalid");
            triggerVibrate();
            displayBanner("error", "Invalid Email", "Please enter a valid email address (e.g., name@quezon.gov.ph).");
            return;
        }

        // Remember Me
        if (rememberMe?.checked) {
            storage.set("pgenro_saved_email", email);
        } else {
            storage.remove("pgenro_saved_email");
        }

        try {
            showLoading("Verifying Clearance", "Connecting to PGENRO secure directory...");
            await delay(250);

            // 1. Check Super Admin Auth
            if (email.endsWith("@pgenro.admin") || email.includes("admin")) {
                try {
                    await signInWithEmailAndPassword(auth, email, password);
                    if (loadingStatusHeading) loadingStatusHeading.textContent = "Clearance Granted";
                    if (loadingStatusText) loadingStatusText.textContent = "Administrator verified. Opening Control Center...";
                    await delay(350);
                    window.location.href = "../admin/admin.html";
                    return;
                } catch (adminErr) {
                    console.warn("Falling back to access_requests verification.");
                }
            }

            // 2. Query Personnel DB
            const reqQuery = query(ref(db, "access_requests"), orderByChild("email"), equalTo(email));
            const reqSnap = await get(reqQuery);

            let userData = null;
            if (reqSnap.exists()) {
                const data = reqSnap.val();
                const keys = Object.keys(data);
                if (keys.length > 0) userData = data[keys[0]];
            }

            if (!userData) {
                hideLoading();
                triggerVibrate();
                emailFieldBox?.classList.add("invalid");
                displayBanner("error", "Record Not Found", `No account record was found for "${email}". Please submit an Access Request.`);
                return;
            }

            if (userData.status === "Pending") {
                hideLoading();
                triggerVibrate();
                displayBanner("warning", "Account Pending Approval", `The account (${userData.id || "REQ"}) is currently under Administrator review.`);
                return;
            }

            if (userData.status === "Rejected") {
                hideLoading();
                triggerVibrate();
                const reason = userData.declineRemarks || "Verification requirements were not met.";
                displayBanner("error", "Access Request Declined", `Your access request was declined. Reason: "${reason}"`);
                return;
            }

            if (userData.status === "Approved") {
                if (userData.password && userData.password !== password) {
                    hideLoading();
                    triggerVibrate();
                    passwordFieldBox?.classList.add("invalid");
                    displayBanner("error", "Authentication Failed", "The password you entered is incorrect. Please try again.");
                    passwordInput?.focus();
                    return;
                }

                if (loadingStatusHeading) loadingStatusHeading.textContent = "Access Granted";
                if (loadingStatusText) loadingStatusText.textContent = `Welcome back, ${userData.fullName || "Personnel"}! Redirecting...`;

                storage.set("pgenro_current_user", JSON.stringify(userData));
                await delay(400);
                window.location.href = "../User/homepage.html";
                return;
            }

            hideLoading();
            triggerVibrate();
            displayBanner("warning", "Unverified Status", "Your clearance status is unverified. Please coordinate with IT.");

        } catch (error) {
            hideLoading();
            triggerVibrate();
            console.error("Login Error:", error);
            displayBanner("error", "System Notice", error.message || "Failed to authenticate with the server. Please try again.");
        }
    });
});

// ============================================================================
// INTERACTIVE ENVIRONMENTAL BACKGROUND + CARD MICRO-INTERACTIONS
// Firebase/Auth/Realtime Database logic above remains unchanged.
// ============================================================================
// ============================================================================
// INTERACTIVE ENVIRONMENTAL BACKGROUND ONLY
// The login panel/card is intentionally static. Form controls remain functional.
// Firebase/Auth/Realtime Database logic above is unchanged.
// ============================================================================
const initEnvironmentalBackground = () => {
    const root = document.documentElement;
    const particleField = document.querySelector(".light-particles");
    const fallingLeaves = document.getElementById("fallingLeaves");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Natural falling leaves: varied shape, size, depth, wind drift and rotation.
    if (fallingLeaves && !reduceMotion && !fallingLeaves.children.length) {
        const fragment = document.createDocumentFragment();
        const leafCount = window.innerWidth < 640 ? 9 : window.innerWidth < 1100 ? 16 : 24;
        const leafTypes = ["leaf-round", "leaf-pointed", "leaf-long", "leaf-soft"];

        for (let i = 0; i < leafCount; i++) {
            const leaf = document.createElement("span");
            const type = leafTypes[Math.floor(Math.random() * leafTypes.length)];
            const depth = Math.random();
            const size = 9 + depth * 17;

            leaf.className = `falling-leaf ${type}`;
            leaf.style.left = `${-5 + Math.random() * 110}%`;
            leaf.style.setProperty("--leaf-size", `${size.toFixed(1)}px`);
            leaf.style.setProperty("--leaf-opacity", `${0.20 + depth * 0.48}`);
            leaf.style.setProperty("--leaf-rotate", `${Math.random() * 360}deg`);
            leaf.style.setProperty("--leaf-drift", `${-150 + Math.random() * 300}px`);
            leaf.style.animationDuration = `${13 + Math.random() * 15}s`;
            leaf.style.animationDelay = `${Math.random() * -28}s`;
            leaf.style.filter = `blur(${depth < .25 ? 1 : depth > .78 ? .1 : .35}px)`;
            fragment.appendChild(leaf);
        }
        fallingLeaves.appendChild(fragment);
    }

    // Tiny floating pollen/dust for a humid forest atmosphere.
    if (particleField && !reduceMotion && !particleField.children.length) {
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 26; i++) {
            const particle = document.createElement("span");
            const size = 1.5 + Math.random() * 3.5;
            particle.className = "light-particle";
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.top = `${18 + Math.random() * 72}%`;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.animationDuration = `${8 + Math.random() * 12}s`;
            particle.style.animationDelay = `${Math.random() * -16}s`;
            particle.style.setProperty("--drift-x", `${-55 + Math.random() * 110}px`);
            fragment.appendChild(particle);
        }
        particleField.appendChild(fragment);
    }

    if (reduceMotion) return;

    // Pointer movement affects ONLY the environmental background.
    let raf = null;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const animateBackground = () => {
        raf = null;
        currentX += (targetX - currentX) * 0.06;
        currentY += (targetY - currentY) * 0.06;

        root.style.setProperty("--bg-move-x", `${currentX * 22}px`);
        root.style.setProperty("--bg-move-y", `${currentY * 17}px`);
        root.style.setProperty("--cursor-x", `${50 + currentX * 50}%`);
        root.style.setProperty("--cursor-y", `${50 + currentY * 50}%`);

        if (Math.abs(targetX - currentX) > .001 || Math.abs(targetY - currentY) > .001) {
            raf = requestAnimationFrame(animateBackground);
        }
    };

    window.addEventListener("pointermove", (event) => {
        targetX = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1));
        targetY = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1));
        if (!raf) raf = requestAnimationFrame(animateBackground);
    }, { passive: true });

    window.addEventListener("blur", () => {
        targetX = 0;
        targetY = 0;
        if (!raf) raf = requestAnimationFrame(animateBackground);
    });
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initEnvironmentalBackground, { once: true });
} else {
    initEnvironmentalBackground();
}
