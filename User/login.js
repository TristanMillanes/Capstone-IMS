document.addEventListener("DOMContentLoaded", () => {
    // Helper to safely invoke Lucide icons
    const renderIconsSafely = () => {
        if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
            lucide.createIcons();
        }
    };

    // Initialize Lucide Icons
    renderIconsSafely();

    // Safe LocalStorage Helper to prevent sandboxed security crashes (e.g. in private windows)
    const safeStorage = {
        getItem: (key) => {
            try {
                return localStorage.getItem(key);
            } catch (e) {
                return null;
            }
        },
        setItem: (key, value) => {
            try {
                localStorage.setItem(key, value);
            } catch (e) {}
        },
        removeItem: (key) => {
            try {
                localStorage.removeItem(key);
            } catch (e) {}
        }
    };

    // ==========================================
    // 1. Interactive Fluid DoF Canvas Engine
    // ==========================================
    const leavesContainer = document.getElementById("leavesCanvasContainer");
    
    if (leavesContainer) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        leavesContainer.appendChild(canvas);

        let width = window.innerWidth;
        let height = window.innerHeight;

        // Trace pointer coordinates for dynamic physical deflection updates
        let mouseX = -1000;
        let mouseY = -1000;
        let isPointerActive = false;

        const setPointerCoords = (x, y) => {
            mouseX = x;
            mouseY = y;
            isPointerActive = true;
        };

        const clearPointerCoords = () => {
            mouseX = -1000;
            mouseY = -1000;
            isPointerActive = false;
        };

        // Mouse Listeners
        window.addEventListener("mousemove", (event) => {
            setPointerCoords(event.clientX, event.clientY);
        });

        window.addEventListener("mouseleave", () => {
            clearPointerCoords();
        });

        // Touch Listeners for Mobile and Tablet Interactivity
        window.addEventListener("touchstart", (event) => {
            if (event.touches.length > 0) {
                setPointerCoords(event.touches[0].clientX, event.touches[0].clientY);
            }
        }, { passive: true });

        window.addEventListener("touchmove", (event) => {
            if (event.touches.length > 0) {
                setPointerCoords(event.touches[0].clientX, event.touches[0].clientY);
            }
        }, { passive: true });

        window.addEventListener("touchend", () => {
            clearPointerCoords();
        });

        // Optimized forest translucent spectrum
        const leafColors = [
            "rgba(16, 185, 129, 0.16)",  /* Emerald Midground */
            "rgba(5, 150, 105, 0.14)",   /* Forest Core */
            "rgba(52, 211, 153, 0.12)",  /* Pale Meadow */
            "rgba(110, 231, 183, 0.08)",  /* Ambient Translucent */
            "rgba(4, 120, 87, 0.15)"     /* Deep Pine */
        ];

        const calculateLeafDensity = () => {
            const area = width * height;
            return Math.min(45, Math.max(18, Math.floor(area / 48000)));
        };

        const leaves = [];

        class FoliageParticle {
            constructor() {
                this.reset();
                this.y = Math.random() * height;
            }

            reset() {
                this.x = Math.random() * width;
                this.y = -40;
                
                // Displacement offsets (for interactive repulsion effects)
                this.dispX = 0;
                this.dispY = 0;

                // Focal depth distribution (0: Foreground, 1: Middleground, 2: Background)
                this.depthPlane = Math.floor(Math.random() * 3);
                
                if (this.depthPlane === 0) { // Foreground (Larger, swift, soft opacity)
                    this.size = Math.random() * 8 + 18;
                    this.speedY = Math.random() * 0.5 + 0.7;
                    this.alpha = Math.random() * 0.12 + 0.12;
                } else if (this.depthPlane === 1) { // Middleground (Standard baseline)
                    this.size = Math.random() * 6 + 11;
                    this.speedY = Math.random() * 0.4 + 0.4;
                    this.alpha = Math.random() * 0.15 + 0.12;
                } else { // Background (Small, slow, deep opacity)
                    this.size = Math.random() * 4 + 6;
                    this.speedY = Math.random() * 0.2 + 0.2;
                    this.alpha = Math.random() * 0.08 + 0.06;
                }

                this.speedX = Math.random() * 0.25 - 0.08;
                this.oscillationIndex = Math.random() * 40;
                this.oscillationStep = Math.random() * 0.008 + 0.003;
                this.angle = Math.random() * Math.PI * 2;
                this.rotationSpeed = Math.random() * 0.008 - 0.004;
                
                const colorBase = leafColors[Math.floor(Math.random() * leafColors.length)];
                this.color = colorBase.replace(/[\d\.]+\)$/g, `${this.alpha})`);
            }

            update() {
                // Determine distance to cursor
                const dx = this.x - mouseX;
                const dy = this.y - mouseY;
                const distance = Math.hypot(dx, dy);
                const repelThreshold = 160;

                if (isPointerActive && distance < repelThreshold) {
                    // Force coefficient based on distance proximity
                    const force = (repelThreshold - distance) / repelThreshold;
                    const repelAngle = Math.atan2(dy, dx);
                    
                    // Standard repulsion logic
                    const pushForceX = Math.cos(repelAngle) * force * 2.0;
                    const pushForceY = Math.sin(repelAngle) * force * 2.0;

                    // Dynamic vortex drag (leaves swirl around the cursor dynamically)
                    const swirlX = -Math.sin(repelAngle) * force * 0.8;
                    const swirlY = Math.cos(repelAngle) * force * 0.8;

                    this.dispX += pushForceX + swirlX;
                    this.dispY += pushForceY + swirlY;
                }

                // Apply gradual decay of the deflection offset back to baseline gravity
                this.dispX *= 0.90;
                this.dispY *= 0.90;

                this.y += this.speedY + this.dispY;
                this.angle += this.rotationSpeed;
                this.oscillationIndex += this.oscillationStep;
                this.x += this.speedX + Math.sin(this.oscillationIndex) * 0.25 + this.dispX;

                // Reset positions smoothly when leaving boundaries
                if (this.y > height + 40 || this.x < -40 || this.x > width + 40) {
                    this.reset();
                }
            }

            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate(this.angle);
                ctx.fillStyle = this.color;

                ctx.beginPath();
                // Dual-arc organic leaf structure
                ctx.moveTo(0, -this.size / 2);
                ctx.quadraticCurveTo(this.size / 2.1, -this.size / 10, 0, this.size / 2);
                ctx.quadraticCurveTo(-this.size / 2.1, -this.size / 10, 0, -this.size / 2);
                ctx.fill();

                ctx.strokeStyle = `rgba(255, 255, 255, ${this.alpha * 0.45})`;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(0, -this.size / 2);
                ctx.lineTo(0, this.size / 2);
                ctx.stroke();

                ctx.restore();
            }
        }

        const maxDensity = calculateLeafDensity();
        for (let i = 0; i < maxDensity; i++) {
            leaves.push(new FoliageParticle());
        }

        const updateBounds = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            
            const dpr = window.devicePixelRatio || 1;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            ctx.scale(dpr, dpr);

            // Re-evaluate target density dynamically during resize events
            const targetDensity = calculateLeafDensity();
            if (leaves.length < targetDensity) {
                const diff = targetDensity - leaves.length;
                for (let i = 0; i < diff; i++) {
                    leaves.push(new FoliageParticle());
                }
            } else if (leaves.length > targetDensity) {
                leaves.length = targetDensity;
            }
        };

        let resizeTimer;
        window.addEventListener("resize", () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(updateBounds, 150);
        });
        
        updateBounds();

        const renderLoop = () => {
            ctx.clearRect(0, 0, width, height);
            for (let i = 0; i < leaves.length; i++) {
                leaves[i].update();
                leaves[i].draw();
            }
            requestAnimationFrame(renderLoop);
        };

        renderLoop();
    }

    // ==========================================
    // 2. Real-time GMT+8 (PST) System Clock
    // ==========================================
    const clockTime = document.getElementById("clockTime");
    
    const updatePSTTime = () => {
        if (!clockTime) return;
        const now = new Date();
        
        // Convert local time to Philippines Standard Time (UTC+8)
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        const pstOffset = 8; 
        const pstDate = new Date(utc + 3600000 * pstOffset);

        clockTime.textContent = pstDate.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        });
    };

    updatePSTTime();
    setInterval(updatePSTTime, 1000);

    // ==========================================
    // 3. Dynamic Human Keystroke Typist Loop
    // ==========================================
    const typingText = document.getElementById("typingText");
    const phrases = [
        "INFORMATION MANAGEMENT SYSTEM",
        "SECURE GATEWAY ACCESS NODE",
        "REAL-TIME LOGISTICS OVERVIEW"
    ];

    let currentPhraseIdx = 0;
    let currentCharIdx = 0;
    let deletingState = false;

    const performTypingCycle = () => {
        if (!typingText) return;
        const fullString = phrases[currentPhraseIdx];

        if (deletingState) {
            typingText.textContent = fullString.substring(0, currentCharIdx - 1);
            currentCharIdx--;
        } else {
            typingText.textContent = fullString.substring(0, currentCharIdx + 1);
            currentCharIdx++;
        }

        let animationDelay = deletingState ? 35 : (Math.random() * 40 + 55);

        if (!deletingState && currentCharIdx === fullString.length) {
            animationDelay = 2500; // Pause at the end of the text
            deletingState = true;
        }

        if (deletingState && currentCharIdx === 0) {
            deletingState = false;
            currentPhraseIdx = (currentPhraseIdx + 1) % phrases.length;
            animationDelay = 450; // Dynamic transition delay
        }

        setTimeout(performTypingCycle, animationDelay);
    };

    if (typingText) {
        performTypingCycle();
    }

    // ==========================================
    // 4. Form Validation & Interactive Logic
    // ==========================================
    const loginForm = document.getElementById("loginForm");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const rememberMe = document.getElementById("rememberMe");
    const togglePassword = document.getElementById("togglePassword");
    const messageBox = document.getElementById("messageBox");

    const emailError = document.getElementById("emailError");
    const passwordError = document.getElementById("passwordError");
    const emailErrorContainer = document.getElementById("emailErrorContainer");
    const passwordErrorContainer = document.getElementById("passwordErrorContainer");

    const strengthContainer = document.getElementById("strengthContainer");
    const strengthBarFill = document.getElementById("strengthBarFill");
    const strengthText = document.getElementById("strengthText");

    const loginCard = document.getElementById("loginCard");
    const loadingOverlay = document.getElementById("loadingOverlay");
    const loadingStatusHeading = document.getElementById("loadingStatusHeading");
    const loadingStatusText = document.getElementById("loadingStatusText");

    // Tracking touched states prevents premature error validation display on typing
    let emailTouched = false;
    let passwordTouched = false;

    // Dynamic keyboard helper: Caps Lock Indicator
    let capsLockIndicator = document.getElementById("capsLockIndicator");
    if (!capsLockIndicator && passwordInput) {
        capsLockIndicator = document.createElement("div");
        capsLockIndicator.id = "capsLockIndicator";
        capsLockIndicator.className = "caps-lock-indicator";
        capsLockIndicator.innerHTML = '<i data-lucide="alert-triangle" class="caps-lock-icon" aria-hidden="true"></i> Warning: Caps Lock is Enabled';
        
        // Append cleanly to parent input-group instead of splitting horizontal flex-wrapper
        const parentGroup = passwordInput.closest(".input-group");
        if (parentGroup) {
            parentGroup.appendChild(capsLockIndicator);
        }
    }

    const toggleErrorCollapse = (container, show) => {
        if (!container) return;
        if (show) {
            container.classList.add("active");
            container.style.gridTemplateRows = "1fr";
        } else {
            container.classList.remove("active");
            container.style.gridTemplateRows = "0fr";
        }
    };

    const setInputFeedback = (inputNode, isInvalid, message = "") => {
        const parentGroup = inputNode.closest(".input-group");
        if (!parentGroup) return;

        parentGroup.classList.remove("valid", "invalid");
        
        if (isInvalid) {
            parentGroup.classList.add("invalid");
        } else if (inputNode.value.trim() !== "") {
            parentGroup.classList.add("valid");
        }

        if (inputNode === emailInput) {
            if (emailError) emailError.textContent = message;
            toggleErrorCollapse(emailErrorContainer, isInvalid);
        }
        if (inputNode === passwordInput) {
            if (passwordError) passwordError.textContent = message;
            toggleErrorCollapse(passwordErrorContainer, isInvalid);
        }
    };

    const runEmailValidation = (forceShowError = false) => {
        if (!emailInput) return false;
        const value = emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!value) {
            if (forceShowError || emailTouched) {
                setInputFeedback(emailInput, true, "Corporate email address is required.");
            }
            return false;
        }
        if (!emailRegex.test(value)) {
            if (forceShowError || emailTouched) {
                setInputFeedback(emailInput, true, "Please match secure format: username@domain.com");
            }
            return false;
        }

        setInputFeedback(emailInput, false);
        return true;
    };

    const runPasswordValidation = (forceShowError = false) => {
        if (!passwordInput) return false;
        const value = passwordInput.value.trim();

        if (!value) {
            if (forceShowError || passwordTouched) {
                setInputFeedback(passwordInput, true, "Security password is required.");
                if (strengthContainer) {
                    strengthContainer.classList.remove("active");
                    strengthContainer.style.gridTemplateRows = "0fr";
                }
            }
            return false;
        }
        if (value.length < 6) {
            if (forceShowError || passwordTouched) {
                setInputFeedback(passwordInput, true, "Password parameter must contain at least 6 characters.");
            }
            return false;
        }

        setInputFeedback(passwordInput, false);
        return true;
    };

    const evaluatePasswordStrength = (passwordString) => {
        if (!strengthContainer) return 0;
        
        if (!passwordString) {
            strengthContainer.classList.remove("active");
            strengthContainer.style.gridTemplateRows = "0fr";
            return 0;
        }

        strengthContainer.classList.add("active");
        strengthContainer.style.gridTemplateRows = "1fr";
        let rating = 0;

        if (passwordString.length >= 6) rating++;
        if (passwordString.length >= 10) rating++;
        if (/[A-Z]/.test(passwordString)) rating++;
        if (/[0-9]/.test(passwordString)) rating++;
        if (/[^A-Za-z0-9]/.test(passwordString)) rating++;

        let fillColor = "var(--danger, #ef4444)";
        let textStatus = "Weak Strength";
        let completionPercent = "30%";

        switch (rating) {
            case 0:
            case 1:
            case 2:
                fillColor = "var(--danger, #ef4444)";
                textStatus = "Weak Strength";
                completionPercent = "30%";
                break;
            case 3:
                fillColor = "var(--warning, #f59e0b)";
                textStatus = "Fair Strength";
                completionPercent = "60%";
                break;
            case 4:
                fillColor = "var(--primary, #3b82f6)";
                textStatus = "Good Strength";
                completionPercent = "80%";
                break;
            case 5:
                fillColor = "var(--success, #10b981)";
                textStatus = "Robust Security";
                completionPercent = "100%";
                break;
        }

        if (strengthBarFill) {
            strengthBarFill.style.width = completionPercent;
            strengthBarFill.style.backgroundColor = fillColor;
        }
        if (strengthText) {
            strengthText.textContent = textStatus;
            strengthText.style.color = fillColor;
        }

        return rating;
    };

    const displayBannerAlert = (statusType, contentText) => {
        if (!messageBox) return;
        messageBox.className = `message-box ${statusType}`;
        messageBox.textContent = contentText;
    };

    const clearBannerAlert = () => {
        if (!messageBox) return;
        messageBox.className = "message-box";
        messageBox.textContent = "";
    };

    // Card vibration interaction if checks fail
    const triggerCardVibration = () => {
        if (!loginCard) return;
        loginCard.classList.remove("shake-trigger");
        // Force Reflow
        void loginCard.offsetWidth;
        loginCard.classList.add("shake-trigger");
        
        setTimeout(() => {
            loginCard.classList.remove("shake-trigger");
        }, 500);
    };

    // Password Visibility Switcher
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener("click", () => {
            const currentlyHidden = passwordInput.type === "password";
            passwordInput.type = currentlyHidden ? "text" : "password";

            togglePassword.innerHTML = currentlyHidden
                ? '<i data-lucide="eye-off" aria-hidden="true"></i>'
                : '<i data-lucide="eye" aria-hidden="true"></i>';

            renderIconsSafely();
        });
    }

    // Dynamic Field Observers
    if (emailInput) {
        emailInput.addEventListener("input", () => {
            // Only update active errors dynamically if field is already validated as touched/invalid
            if (emailInput.closest(".input-group").classList.contains("invalid") || emailTouched) {
                runEmailValidation();
            }
            clearBannerAlert();
        });

        emailInput.addEventListener("blur", () => {
            emailTouched = true;
            runEmailValidation(true);
        });
    }

    if (passwordInput) {
        passwordInput.addEventListener("input", (event) => {
            const val = event.target.value;
            evaluatePasswordStrength(val);
            if (passwordInput.closest(".input-group").classList.contains("invalid") || passwordTouched) {
                runPasswordValidation();
            }
            clearBannerAlert();
        });

        passwordInput.addEventListener("blur", () => {
            passwordTouched = true;
            runPasswordValidation(true);
        });

        // Track key state adjustments dynamically to discover active Caps Lock states
        const checkCapsLock = (event) => {
            if (capsLockIndicator && event.getModifierState) {
                if (event.getModifierState("CapsLock")) {
                    capsLockIndicator.style.display = "flex";
                } else {
                    capsLockIndicator.style.display = "none";
                }
            }
        };

        passwordInput.addEventListener("keydown", checkCapsLock);
        passwordInput.addEventListener("keyup", checkCapsLock);
        passwordInput.addEventListener("focus", checkCapsLock);
    }

    // Remember Me retention logic using modular safeStorage wrapper
    const handleCredentialRetention = () => {
        if (rememberMe && rememberMe.checked && emailInput) {
            safeStorage.setItem("pgenro_retained_email", emailInput.value.trim());
        } else {
            safeStorage.removeItem("pgenro_retained_email");
        }
    };

    const processRetainedEmail = () => {
        const retained = safeStorage.getItem("pgenro_retained_email");
        if (retained && emailInput) {
            emailInput.value = retained;
            if (rememberMe) rememberMe.checked = true;
            setInputFeedback(emailInput, false);
        }
    };

    // Form Submission Sequence
    if (loginForm) {
        loginForm.addEventListener("submit", (submitEvent) => {
            submitEvent.preventDefault();

            // Mark form components as touched to validate fields cleanly
            emailTouched = true;
            passwordTouched = true;

            const isEmailSecure = runEmailValidation(true);
            const isPasswordSecure = runPasswordValidation(true);

            if (!isEmailSecure || !isPasswordSecure) {
                triggerCardVibration();
                displayBannerAlert("error", "Verify credentials and correct validation messages.");
                return;
            }

            handleCredentialRetention();

            // Lock form layout while processing loading states
            if (loginCard) loginCard.classList.add("processing");
            if (loadingOverlay) {
                loadingOverlay.classList.add("active");
                loadingOverlay.setAttribute("aria-hidden", "false");
            }
            
            if (loadingStatusHeading) loadingStatusHeading.textContent = "Verifying Credentials";
            if (loadingStatusText) loadingStatusText.textContent = "Connecting with access validation server...";

            // Handshake progression stages
            setTimeout(() => {
                if (loadingStatusHeading) loadingStatusHeading.textContent = "Securing Session Keys";
                if (loadingStatusText) loadingStatusText.textContent = "Configuring temporary portal encryption keys...";
            }, 1100);

            setTimeout(() => {
                // Restore structural interactive control
                if (loginCard) loginCard.classList.remove("processing");
                if (loadingOverlay) {
                    loadingOverlay.classList.remove("active");
                    loadingOverlay.setAttribute("aria-hidden", "true");
                }

                displayBannerAlert("success", "Handshake confirmed. Re-routing safely to administration portal dashboard...");
                
                // Secure Routing Transition Point
                // setTimeout(() => { window.location.href = "dashboard.html"; }, 1000);
            }, 2400);
        });
    }

    processRetainedEmail();
});