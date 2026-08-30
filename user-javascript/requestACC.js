// ==========================================================================
// PGENRO IMS - REQUEST ACCOUNT SCRIPT WITH PASSWORD VALIDATION
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getDatabase, ref, set, push } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

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
const db = getDatabase(app);

// Lucide Icon Helper
const renderIconsSafely = () => {
    if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
        lucide.createIcons();
    }
};
renderIconsSafely();

document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // 1. CANVAS ANIMATION (Leaves & Windmills)
    // ==========================================
    const canvas = document.getElementById('leafCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        let leaves = [];
        let windmills = [];
        const leafCount = window.innerWidth < 768 ? 14 : 26; 
        let mouse = { x: -1000, y: -1000, radius: 140 };
        
        window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
        window.addEventListener('mouseout', () => { mouse.x = -1000; mouse.y = -1000; });

        class Windmill {
            constructor(xPercent, yPercent, scale) {
                this.xPercent = xPercent;
                this.yPercent = yPercent;
                this.scale = scale;
                this.angle = Math.random() * Math.PI;
                this.baseSpeed = 0.0035; 
                this.currentSpeed = this.baseSpeed;
                this.x = 0;
                this.y = 0;
            }
            resize(width, height) {
                this.x = width * this.xPercent;
                this.y = height * this.yPercent;
            }
            update() {
                let dx = mouse.x - this.x;
                let dy = mouse.y - (this.y - 150 * this.scale); 
                let distance = Math.hypot(dx, dy);
                if (distance < mouse.radius * 2) {
                    let speedUp = 0.03 * (1 - distance / (mouse.radius * 2));
                    this.currentSpeed = this.baseSpeed + speedUp;
                } else {
                    this.currentSpeed += (this.baseSpeed - this.currentSpeed) * 0.02;
                }
                this.angle += this.currentSpeed;
            }
            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.scale(this.scale, this.scale);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.beginPath();
                ctx.moveTo(-16, 0); ctx.lineTo(16, 0); ctx.lineTo(10, -6); ctx.lineTo(-10, -6);
                ctx.closePath(); ctx.fill();

                const towerGrad = ctx.createLinearGradient(-10, 0, 10, 0);
                towerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.02)');
                towerGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
                towerGrad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
                ctx.fillStyle = towerGrad;
                ctx.beginPath();
                ctx.moveTo(-8, -6); ctx.lineTo(8, -6); ctx.lineTo(3.5, -150); ctx.lineTo(-3.5, -150);
                ctx.closePath(); ctx.fill();

                ctx.translate(0, -150);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.beginPath();
                ctx.moveTo(-5, -6); ctx.lineTo(14, -6); ctx.lineTo(11, 4); ctx.lineTo(-5, 4);
                ctx.closePath(); ctx.fill();

                ctx.save();
                ctx.rotate(this.angle);
                for (let i = 0; i < 3; i++) {
                    ctx.rotate((Math.PI * 2) / 3);
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                    ctx.beginPath();
                    ctx.moveTo(0, 0); ctx.lineTo(-4, -35); ctx.lineTo(-1.5, -110); ctx.lineTo(0, -110);
                    ctx.closePath(); ctx.fill();
                }
                ctx.restore();

                ctx.beginPath();
                ctx.arc(0, 0, 5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.fill();
                ctx.restore();
            }
        }

        class Leaf {
            constructor() { this.reset(true); }
            reset(initial = false) {
                this.x = Math.random() * window.innerWidth;
                this.y = initial ? Math.random() * window.innerHeight : -40; 
                this.size = Math.random() * 7 + 5;
                this.speedY = Math.random() * 0.9 + 0.3;
                this.speedX = Math.random() * 1.4 - 0.7;
                this.angle = Math.random() * 360;
                this.spin = Math.random() * 1.4 - 0.7;
                this.sway = Math.random() * Math.PI * 2;
                this.swaySpeed = Math.random() * 0.02 + 0.01; 
                const colors = ['rgba(16, 185, 129, 0.75)', 'rgba(52, 211, 153, 0.55)', 'rgba(20, 184, 166, 0.65)'];
                this.color = colors[Math.floor(Math.random() * colors.length)];
            }
            update() {
                this.y += this.speedY;
                this.x += Math.sin(this.sway) * 1.0 + this.speedX;
                this.sway += this.swaySpeed;
                this.angle += this.spin;
                let dx = mouse.x - this.x;
                let dy = mouse.y - this.y;
                let distance = Math.hypot(dx, dy);
                if (distance < mouse.radius) {
                    const force = (mouse.radius - distance) / mouse.radius; 
                    this.x -= (dx / distance) * force * 3;
                    this.y -= (dy / distance) * force * 3;
                }
                if (this.y > window.innerHeight + this.size) this.reset();
                if (this.x > window.innerWidth + 40) this.x = -40;
                if (this.x < -40) this.x = window.innerWidth + 40;
            }
            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate((this.angle * Math.PI) / 180);
                ctx.fillStyle = this.color;
                ctx.shadowBlur = 8;
                ctx.shadowColor = this.color;
                ctx.beginPath();
                ctx.moveTo(0, -this.size); 
                ctx.quadraticCurveTo(this.size * 0.8, 0, 0, this.size); 
                ctx.quadraticCurveTo(-this.size * 0.8, 0, 0, -this.size); 
                ctx.fill();
                ctx.restore();
            }
        }

        windmills.push(new Windmill(0.12, 0.90, 1.0)); 
        windmills.push(new Windmill(0.85, 0.82, 0.65)); 
        for (let i = 0; i < leafCount; i++) leaves.push(new Leaf());

        function resizeCanvas() {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
            ctx.scale(dpr, dpr);
            windmills.forEach(w => w.resize(window.innerWidth, window.innerHeight));
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        function animate() {
            ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
            windmills.forEach(w => { w.update(); w.draw(); });
            leaves.forEach(l => { l.update(); l.draw(); });
            requestAnimationFrame(animate);
        }
        animate();
    }

    // Dynamic Calendar
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const curDateEl = document.getElementById('currentDate');
    if (curDateEl) curDateEl.textContent = new Date().toLocaleDateString('en-US', dateOptions);

    // ==========================================
    // 2. PASSWORD TOGGLE LOGIC (SHOW / HIDE)
    // ==========================================
    const passwordInput = document.getElementById("password");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const togglePasswordBtn = document.getElementById("togglePasswordBtn");
    const toggleConfirmPasswordBtn = document.getElementById("toggleConfirmPasswordBtn");

    togglePasswordBtn?.addEventListener("click", () => {
        const isPass = passwordInput.type === "password";
        passwordInput.type = isPass ? "text" : "password";
        togglePasswordBtn.innerHTML = isPass ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
        renderIconsSafely();
    });

    toggleConfirmPasswordBtn?.addEventListener("click", () => {
        const isPass = confirmPasswordInput.type === "password";
        confirmPasswordInput.type = isPass ? "text" : "password";
        toggleConfirmPasswordBtn.innerHTML = isPass ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
        renderIconsSafely();
    });

    // ==========================================
    // 3. STEPPER & FORM VALIDATION
    // ==========================================
    const pages = document.querySelectorAll('.form-page');
    const steps = document.querySelectorAll('.step');
    const nextBtn = document.getElementById('nextBtn');
    const backBtn = document.getElementById('backBtn');
    const submitBtn = document.getElementById('submitBtn');
    const progressBar = document.getElementById('stepperProgress');
    const form = document.getElementById('accessForm');
    const allInputs = form ? form.querySelectorAll('input[required], select[required], textarea[required]') : [];
    
    let currentPage = 1;
    const totalPages = pages.length;

    // Toast Alert
    function showToast(message, type = 'error') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = type === 'error' ? 'alert-circle' : 'check-circle-2';
        toast.innerHTML = `<i data-lucide="${icon}"></i><span>${message}</span>`;
        container.appendChild(toast);
        renderIconsSafely();

        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400); 
        }, 4000);
    }

    // Single Field Validation Function
    function validateField(input) {
        if (!input) return true;
        const errorSpan = document.getElementById(`${input.id}Error`);
        
        // Custom Password Match Validation
        if (input.id === "confirmPassword" && passwordInput) {
            if (input.value !== passwordInput.value) {
                input.classList.add('invalid-field');
                if (errorSpan) errorSpan.textContent = "Passwords do not match.";
                return false;
            }
        }

        if (!input.checkValidity()) {
            input.classList.add('invalid-field');
            if (errorSpan) {
                if (input.validity.valueMissing) errorSpan.textContent = "This field is required.";
                else if (input.id === 'email') errorSpan.textContent = "Please enter an official government email.";
                else if (input.id === 'contact') errorSpan.textContent = "Requires 11-digit mobile (e.g. 09XXXXXXXXX).";
                else if (input.id === 'password' || input.id === 'confirmPassword') errorSpan.textContent = "Password must be at least 6 characters.";
                else errorSpan.textContent = "Invalid entry format.";
            }
            return false;
        } else {
            input.classList.remove('invalid-field');
            if (errorSpan) errorSpan.textContent = "";
            return true;
        }
    }

    allInputs.forEach(input => {
        input.addEventListener('input', () => { if (input.classList.contains('invalid-field')) validateField(input); });
        input.addEventListener('change', () => { if (input.classList.contains('invalid-field')) validateField(input); });
    });

    function updateUI() {
        pages.forEach((page, index) => {
            page.style.display = (index + 1 === currentPage) ? 'flex' : 'none';
            page.classList.toggle('active', index + 1 === currentPage);
        });

        steps.forEach((step, index) => {
            step.classList.toggle('active', index + 1 <= currentPage);
        });

        if (progressBar) progressBar.style.width = `${((currentPage - 1) / (totalPages - 1)) * 100}%`;
        if (backBtn) backBtn.style.visibility = (currentPage === 1) ? 'hidden' : 'visible';
        
        if (currentPage === totalPages) {
            if (nextBtn) nextBtn.style.display = 'none';
            if (submitBtn) submitBtn.style.display = 'flex';
        } else {
            if (nextBtn) nextBtn.style.display = 'flex';
            if (submitBtn) submitBtn.style.display = 'none';
        }
        renderIconsSafely();
    }

    function validatePage(pageNum) {
        let isValid = true;
        const pageEl = document.getElementById(`page${pageNum}`);
        if (!pageEl) return true;

        pageEl.querySelectorAll('input[required], select[required], textarea[required]').forEach(input => {
            if (!validateField(input)) isValid = false;
        });

        // Check password matching on page 1
        if (pageNum === 1 && passwordInput && confirmPasswordInput) {
            if (passwordInput.value !== confirmPasswordInput.value) {
                confirmPasswordInput.classList.add('invalid-field');
                const errSpan = document.getElementById('confirmPasswordError');
                if (errSpan) errSpan.textContent = "Passwords do not match.";
                isValid = false;
            }
        }

        return isValid;
    }

    function validateCurrentPage() {
        const isValid = validatePage(currentPage);
        if (!isValid) showToast("Please fill up all required fields correctly.", "error");
        return isValid;
    }

    // Validate entire form across all steps
    function validateAllPages() {
        let allValid = true;
        for (let i = 1; i <= totalPages; i++) {
            if (!validatePage(i)) {
                allValid = false;
                currentPage = i; // Move to the first page that has missing fields
                updateUI();
                break;
            }
        }
        if (!allValid) showToast("Please complete all required fields on this step first.", "error");
        return allValid;
    }

    nextBtn?.addEventListener('click', () => {
        if (validateCurrentPage() && currentPage < totalPages) {
            currentPage++;
            updateUI();
        }
    });

    backBtn?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            updateUI();
        }
    });

    // ==========================================
    // PREVENT ACCIDENTAL ENTER KEY SUBMISSION
    // ==========================================
    form?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault(); // Stop instant submission
            if (currentPage < totalPages) {
                if (validateCurrentPage()) {
                    currentPage++;
                    updateUI();
                }
            } else {
                // On last step, trigger the submit button
                submitBtn?.click();
            }
        }
    });

    // Privacy Dialog
    const modal = document.getElementById('privacyModal');
    document.getElementById('openPrivacyBtn')?.addEventListener('click', () => modal?.showModal());
    document.getElementById('closePrivacyBtn')?.addEventListener('click', () => modal?.close());
    document.getElementById('acceptPrivacyBtn')?.addEventListener('click', () => {
        const agree = document.getElementById('agree');
        if (agree) agree.checked = true;
        modal?.close();
    });

    // Textarea Counter
    const reasonText = document.getElementById('reason');
    if (reasonText) {
        reasonText.addEventListener('input', () => {
            const length = reasonText.value.length;
            const counter = document.getElementById('charCount');
            if (counter) {
                counter.textContent = `${length} / 250`;
                counter.style.color = length >= 250 ? 'var(--clr-error)' : 'var(--clr-text-dim)';
            }
        });
    }

    // =========================================================================
    // 4. REALTIME DATABASE SUBMISSION (VALIDATES ALL STEPS)
    // =========================================================================
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Ensure all steps are completely and accurately filled
        if (!validateAllPages()) return;

        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Submitting to Admin...`;
        submitBtn.disabled = true; 
        if (backBtn) backBtn.disabled = true;
        renderIconsSafely();

        // Get all inputs
        const fullName = document.getElementById('fullName')?.value.trim();
        const email = document.getElementById('email')?.value.trim().toLowerCase();
        const contact = document.getElementById('contact')?.value.trim();
        const govId = document.getElementById('govId')?.value.trim();
        const password = document.getElementById('password')?.value;
        const position = document.getElementById('position')?.value;
        const division = document.getElementById('division')?.value;
        const role = document.getElementById('role')?.value;
        const endorser = document.getElementById('endorser')?.value.trim();
        const reason = document.getElementById('reason')?.value.trim();

        // Double check no empty fields bypass
        if (!fullName || !email || !contact || !govId || !password || !position || !division || !role) {
            showToast("Please fill up all required fields before submitting.", "error");
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
            if (backBtn) backBtn.disabled = false;
            return;
        }

        // Auto-generate Ref Code & Date
        const refCode = "REQ-" + new Date().getFullYear() + "-" + Math.floor(100 + Math.random() * 900);
        const now = new Date();
        const formattedDate = now.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

        // Build Payload
        const requestPayload = {
            id: refCode,
            fullName: fullName,
            email: email,
            contact: contact,
            govId: govId,
            password: password,
            position: position,
            division: division,
            role: role,
            endorser: endorser || "N/A",
            reason: reason || "N/A",
            status: "Pending", // Default Review State
            timestamp: Date.now(),
            date: formattedDate
        };

        try {
            // Write to Firebase Realtime Database
            const newRequestRef = push(ref(db, "access_requests"));
            await set(newRequestRef, requestPayload);

            showToast("Access Request successfully submitted to Admin!", "success");
            localStorage.removeItem('pgenro_applicant_draft');
            
            setTimeout(() => {
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false; 
                if (backBtn) backBtn.disabled = false;
                form.reset(); 
                currentPage = 1;
                if(document.getElementById('charCount')) document.getElementById('charCount').textContent = '0 / 250';
                allInputs.forEach(i => { 
                    i.classList.remove('invalid-field'); 
                    const err = document.getElementById(`${i.id}Error`);
                    if(err) err.textContent = ""; 
                });
                updateUI();
            }, 2500);

        } catch (error) {
            console.error("❌ Firebase Write Error:", error);
            showToast("Submission failed: " + error.message, "error");
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false; 
            if (backBtn) backBtn.disabled = false;
        }
    });

    updateUI();
});