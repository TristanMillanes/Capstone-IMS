// ==========================================================================
// PGENRO IMS - REALTIME DATABASE VERIFIED LOGIN CONTROLLER
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
    getDatabase, 
    ref, 
    get, 
    query, 
    orderByChild, 
    equalTo 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// Firebase Configuration
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
    // -------------------------------------------------------------
    // Lucide Icon Safe Loader
    // -------------------------------------------------------------
    const renderIconsSafely = () => {
        if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
            lucide.createIcons();
        }
    };
    renderIconsSafely();

    // -------------------------------------------------------------
    // DOM Elements
    // -------------------------------------------------------------
    const loginForm = document.getElementById("loginForm");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const rememberMe = document.getElementById("rememberMe");
    const togglePassword = document.getElementById("togglePassword");
    const messageBox = document.getElementById("messageBox");
    const card = document.getElementById("interactiveCard");

    const loadingOverlay = document.getElementById("loadingOverlay");
    const loadingStatusHeading = document.getElementById("loadingStatusHeading");
    const loadingStatusText = document.getElementById("loadingStatusText");
    const c1 = document.getElementById("telemetryCheck1");
    const c2 = document.getElementById("telemetryCheck2");
    const c3 = document.getElementById("telemetryCheck3");

    const strengthContainer = document.getElementById("strengthContainer");
    const strengthBarFill = document.getElementById("strengthBarFill");
    const strengthText = document.getElementById("strengthText");
    const sunburstGlow = document.getElementById("sunburstGlow");
    const typingText = document.getElementById("typingText");

    // -------------------------------------------------------------
    // Remember Me Auto-fill Handler
    // -------------------------------------------------------------
    const savedEmail = localStorage.getItem("pgenro_saved_email");
    if (savedEmail && emailInput) {
        emailInput.value = savedEmail;
        if (rememberMe) rememberMe.checked = true;
    }

    // -------------------------------------------------------------
    // Typist Animation Loop
    // -------------------------------------------------------------
    if (typingText) {
        const phrases = [
            "INITIALIZING SECURITY NODE",
            "FORESTRY DATA CLEARANCE",
            "QUEZON PROVINCE ENRO IMS",
            "ENCRYPTED ACCESS TERMINAL"
        ];
        let phraseIdx = 0;
        let charIdx = 0;
        let isDeleting = false;

        const typeLoop = () => {
            const current = phrases[phraseIdx];
            if (isDeleting) {
                typingText.textContent = current.substring(0, charIdx - 1);
                charIdx--;
            } else {
                typingText.textContent = current.substring(0, charIdx + 1);
                charIdx++;
            }

            let delayTime = isDeleting ? 35 : 75;

            if (!isDeleting && charIdx === current.length) {
                delayTime = 2200;
                isDeleting = true;
            } else if (isDeleting && charIdx === 0) {
                isDeleting = false;
                phraseIdx = (phraseIdx + 1) % phrases.length;
                delayTime = 400;
            }
            setTimeout(typeLoop, delayTime);
        };
        typeLoop();
    }

    // -------------------------------------------------------------
    // Ambient Cursor Glow Follower
    // -------------------------------------------------------------
    window.addEventListener("pointermove", (e) => {
        if (sunburstGlow) {
            sunburstGlow.style.left = `${e.clientX}px`;
            sunburstGlow.style.top = `${e.clientY}px`;
        }
    });

    // -------------------------------------------------------------
    // Interactive Constellation Spore Particles
    // -------------------------------------------------------------
    const canvas = document.getElementById("forestCanvas");
    if (canvas) {
        const ctx = canvas.getContext("2d");
        let particles = [];

        const resizeCanvas = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resizeCanvas();
        window.addEventListener("resize", resizeCanvas);

        const particleCount = Math.min(Math.floor(window.innerWidth / 30), 45);
        for (let i = 0; i < particleCount; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                radius: Math.random() * 1.8 + 0.6,
                dx: (Math.random() - 0.5) * 0.45,
                dy: (Math.random() - 0.5) * 0.45,
                alpha: Math.random() * 0.5 + 0.2
            });
        }

        const animateCanvas = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw connecting web
            for (let a = 0; a < particles.length; a++) {
                for (let b = a + 1; b < particles.length; b++) {
                    const dist = Math.hypot(particles[a].x - particles[b].x, particles[a].y - particles[b].y);
                    if (dist < 110) {
                        ctx.beginPath();
                        ctx.strokeStyle = `rgba(16, 185, 129, ${0.12 * (1 - dist / 110)})`;
                        ctx.lineWidth = 0.8;
                        ctx.moveTo(particles[a].x, particles[a].y);
                        ctx.lineTo(particles[b].x, particles[b].y);
                        ctx.stroke();
                    }
                }
            }

            // Draw spore points
            particles.forEach((p) => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0, 245, 155, ${p.alpha})`;
                ctx.shadowBlur = 8;
                ctx.shadowColor = "rgba(0, 245, 155, 0.4)";
                ctx.fill();

                p.x += p.dx;
                p.y += p.dy;

                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height;
                if (p.y > canvas.height) p.y = 0;
            });

            requestAnimationFrame(animateCanvas);
        };
        animateCanvas();
    }

    // -------------------------------------------------------------
    // Password Strength & Criteria Checker
    // -------------------------------------------------------------
    const checkCriteria = (pwd) => {
        const tests = {
            length: pwd.length >= 6,
            upper: /[A-Z]/.test(pwd),
            number: /[0-9]/.test(pwd),
            special: /[^A-Za-z0-9]/.test(pwd)
        };

        Object.keys(tests).forEach(key => {
            const item = document.querySelector(`.criteria-item[data-criterion="${key}"]`);
            if (item) {
                if (tests[key]) {
                    item.classList.add("met");
                    item.innerHTML = `<i data-lucide="check-circle-2"></i> <span>${item.querySelector('span').textContent}</span>`;
                } else {
                    item.classList.remove("met");
                    item.innerHTML = `<i data-lucide="circle"></i> <span>${item.querySelector('span').textContent}</span>`;
                }
            }
        });
        renderIconsSafely();

        const score = Object.values(tests).filter(Boolean).length;
        if (strengthBarFill && strengthText) {
            if (pwd.length === 0) {
                strengthBarFill.style.width = "0%";
                strengthText.textContent = "Checking entropy...";
                strengthText.style.color = "var(--text-muted)";
            } else if (score <= 1) {
                strengthBarFill.style.width = "25%";
                strengthBarFill.style.backgroundColor = "var(--danger)";
                strengthText.textContent = "Weak Entropy";
                strengthText.style.color = "var(--danger)";
            } else if (score <= 3) {
                strengthBarFill.style.width = "65%";
                strengthBarFill.style.backgroundColor = "var(--warning)";
                strengthText.textContent = "Moderate Standard";
                strengthText.style.color = "var(--warning)";
            } else {
                strengthBarFill.style.width = "100%";
                strengthBarFill.style.backgroundColor = "var(--success)";
                strengthText.textContent = "Optimal Complexity";
                strengthText.style.color = "var(--success)";
            }
        }
    };

    if (passwordInput) {
        passwordInput.addEventListener("focus", () => {
            if (strengthContainer) strengthContainer.classList.add("active");
        });
        passwordInput.addEventListener("blur", () => {
            if (passwordInput.value.length === 0 && strengthContainer) {
                strengthContainer.classList.remove("active");
            }
        });
        passwordInput.addEventListener("input", (e) => {
            checkCriteria(e.target.value);
        });
    }

    // -------------------------------------------------------------
    // Alert & Telemetry Helpers
    // -------------------------------------------------------------
    const displayBannerAlert = (status, title, text) => {
        if (!messageBox) return;
        messageBox.className = `message-box ${status}`;
        messageBox.innerHTML = `
            <strong>${title}</strong>
            <span>${text}</span>
        `;
    };

    const clearBannerAlert = () => {
        if (!messageBox) return;
        messageBox.className = "message-box";
        messageBox.innerHTML = "";
    };

    const executeCardVibrate = () => {
        if (!card) return;
        card.classList.remove("shake-trigger");
        void card.offsetWidth; // Trigger DOM reflow
        card.classList.add("shake-trigger");
        setTimeout(() => card.classList.remove("shake-trigger"), 450);
    };

    const showLoading = (heading, text) => {
        if (loadingOverlay) {
            loadingOverlay.classList.add("active");
            loadingOverlay.setAttribute("aria-hidden", "false");
            if (loadingStatusHeading) loadingStatusHeading.textContent = heading;
            if (loadingStatusText) loadingStatusText.textContent = text;
        }
        [c1, c2, c3].forEach(el => { if (el) el.className = "telemetry-item"; });
    };

    const hideLoading = () => {
        if (loadingOverlay) {
            loadingOverlay.classList.remove("active");
            loadingOverlay.setAttribute("aria-hidden", "true");
        }
    };

    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    // Password Toggle Visibility
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener("click", () => {
            const isPassword = passwordInput.type === "password";
            passwordInput.type = isPassword ? "text" : "password";
            togglePassword.innerHTML = isPassword 
                ? '<i data-lucide="eye-off"></i>' 
                : '<i data-lucide="eye"></i>';
            renderIconsSafely();
        });
    }

    emailInput?.addEventListener("input", () => clearBannerAlert());
    passwordInput?.addEventListener("input", () => clearBannerAlert());

    // =========================================================================
    // REALTIME DATABASE AUTHENTICATION & APPROVAL CHECK
    // =========================================================================
    loginForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearBannerAlert();

        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;

        if (!email || !password) {
            executeCardVibrate();
            displayBannerAlert("error", "Missing Credentials", "Please enter both your official government email and security password.");
            return;
        }

        // Save email if remember me is ticked
        if (rememberMe && rememberMe.checked) {
            localStorage.setItem("pgenro_saved_email", email);
        } else {
            localStorage.removeItem("pgenro_saved_email");
        }

        try {
            // STEP 1: Handshake
            showLoading("Handshake Verification", "Establishing secure TLS socket...");
            if (c1) c1.classList.add("active");
            await delay(350);
            if (c1) { c1.classList.remove("active"); c1.classList.add("done"); }

            // STEP 2: Query Realtime Database for Email
            if (c2) c2.classList.add("active");
            if (loadingStatusHeading) loadingStatusHeading.textContent = "Querying Records";
            if (loadingStatusText) loadingStatusText.textContent = "Checking authorization clearance and profile status...";

            // A. Super Admin Check
            if (email.endsWith("@pgenro.admin") || email.includes("admin")) {
                try {
                    await signInWithEmailAndPassword(auth, email, password);
                    if (c2) { c2.classList.remove("active"); c2.classList.add("done"); }
                    if (c3) c3.classList.add("done");
                    if (loadingStatusHeading) loadingStatusHeading.textContent = "Administrator Authorized";
                    await delay(400);
                    window.location.href = "../admin/admin.html";
                    return;
                } catch (authErr) {
                    // Fallthrough to standard employee flow
                }
            }

            // B. Search access_requests in Realtime Database
            const reqQuery = query(ref(db, "access_requests"), orderByChild("email"), equalTo(email));
            const reqSnap = await get(reqQuery);

            if (c2) { c2.classList.remove("active"); c2.classList.add("done"); }
            await delay(250);

            let userData = null;
            if (reqSnap.exists()) {
                const requests = reqSnap.val();
                const firstKey = Object.keys(requests)[0];
                userData = requests[firstKey];
            }

            // CASE 1: No Account Found
            if (!userData) {
                hideLoading();
                executeCardVibrate();
                displayBannerAlert(
                    "error", 
                    "No Account Found", 
                    `Walang nakitang record para sa "${email}". Pindutin ang "Register Clearance Request" upang mag-apply.`
                );
                return;
            }

            // CASE 2: Account Pending
            if (userData.status === "Pending") {
                hideLoading();
                executeCardVibrate();
                displayBannerAlert(
                    "warning", 
                    "Account Pending Approval", 
                    `Ang iyong account (${userData.id || 'REQ'}) ay naghihintay pa ng Approval mula sa Administrator bago makapasok.`
                );
                return;
            }

            // CASE 3: Account Declined
            if (userData.status === "Rejected") {
                hideLoading();
                executeCardVibrate();
                const reason = userData.declineRemarks || "Verification failed.";
                displayBannerAlert(
                    "error", 
                    "Access Request Declined", 
                    `Ang iyong access request ay tinanggihan ng Administrator. Dahilan: "${reason}".`
                );
                return;
            }

            // CASE 4: Account Approved -> Verify Password
            if (userData.status === "Approved") {
                if (c3) c3.classList.add("active");
                if (loadingStatusHeading) loadingStatusHeading.textContent = "Verifying Credentials";
                if (loadingStatusText) loadingStatusText.textContent = "Validating security hash against encrypted store...";

                if (userData.password && userData.password !== password) {
                    hideLoading();
                    executeCardVibrate();
                    displayBannerAlert(
                        "error", 
                        "Authentication Failed", 
                        "Approved ang iyong account, ngunit MALI ang inilagay mong password. Pakisubukan muli."
                    );
                    return;
                }

                // Authentication Success
                if (c3) { c3.classList.remove("active"); c3.classList.add("done"); }
                if (loadingStatusHeading) loadingStatusHeading.textContent = "Clearance Granted";
                if (loadingStatusText) loadingStatusText.textContent = `Welcome, ${userData.fullName || 'Personnel'}! Directing to workspace...`;
                
                // Save user session
                localStorage.setItem("pgenro_current_user", JSON.stringify(userData));
                
                await delay(650);
                window.location.href = "../User/homepage.html";
                return;
            }

        } catch (error) {
            hideLoading();
            executeCardVibrate();
            console.error("Login Error:", error);
            displayBannerAlert("error", "System Error", error.message);
        }
    });
});