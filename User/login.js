document.addEventListener("DOMContentLoaded", () => {
    // Utility to execute Lucide Icons rendering safely
    const renderIconsSafely = () => {
        if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
            lucide.createIcons();
        }
    };

    renderIconsSafely();

    // Isolated Storage Helper Wrapper
    const safeStorage = {
        getItem: (key) => {
            try { return localStorage.getItem(key); } catch (e) { return null; }
        },
        setItem: (key, value) => {
            try { localStorage.setItem(key, value); } catch (e) {}
        },
        removeItem: (key) => {
            try { localStorage.removeItem(key); } catch (e) {}
        }
    };

    // ==========================================
    // 1. Dynamic Interactive Spotlight Positioning
    // ==========================================
    const card = document.getElementById("interactiveCard");
    const sunburstGlow = document.getElementById("sunburstGlow");

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let currentX = mouseX;
    let currentY = mouseY;

    const updateCoordinates = (clientX, clientY) => {
        mouseX = clientX;
        mouseY = clientY;
    };

    window.addEventListener("mousemove", (e) => {
        updateCoordinates(e.clientX, e.clientY);
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
        if (e.touches.length > 0) {
            updateCoordinates(e.touches[0].clientX, e.touches[0].clientY);
        }
    }, { passive: true });

    if (card && sunburstGlow) {
        card.addEventListener("mouseenter", () => card.classList.add("active-hover"));
        card.addEventListener("mouseleave", () => card.classList.remove("active-hover"));

        const interpolateGlowPosition = () => {
            currentX += (mouseX - currentX) * 0.12;
            currentY += (mouseY - currentY) * 0.12;

            sunburstGlow.style.left = `${currentX}px`;
            sunburstGlow.style.top = `${currentY}px`;

            requestAnimationFrame(interpolateGlowPosition);
        };

        interpolateGlowPosition();
    }

    // ====================================================================
    // 2. Ecology Vector Mesh Engine (Interactive Background Canvas)
    // ====================================================================
    const forestContainer = document.getElementById("forestCanvasContainer");
    
    if (forestContainer) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        forestContainer.appendChild(canvas);

        let width = window.innerWidth;
        let height = window.innerHeight;
        const nodes = [];
        const maxNodes = 65;

        const resizeCanvas = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            ctx.scale(dpr, dpr);
        };

        class EcologicalNode {
            constructor() {
                this.reset();
            }

            reset() {
                this.x = Math.random() * width;
                this.y = Math.random() * height;
                this.vx = (Math.random() - 0.5) * 0.45;
                this.vy = (Math.random() - 0.5) * 0.45;
                this.baseRadius = Math.random() * 2 + 1.5;
                this.radius = this.baseRadius;
                this.life = Math.random() * 0.5 + 0.5;
            }

            update() {
                this.x += this.vx;
                this.y += this.vy;

                // Bounce off boundaries slightly
                if (this.x < 0 || this.x > width) this.vx *= -1;
                if (this.y < 0 || this.y > height) this.vy *= -1;

                // Mouse interaction physics
                const dx = this.x - mouseX;
                const dy = this.y - mouseY;
                const distance = Math.hypot(dx, dy);
                const maxRange = 180;

                if (distance < maxRange) {
                    const force = (maxRange - distance) / maxRange;
                    this.radius = this.baseRadius + (force * 2.5);
                    this.x += (dx / distance) * force * 1.5;
                    this.y += (dy / distance) * force * 1.5;
                } else {
                    this.radius += (this.baseRadius - this.radius) * 0.1;
                }
            }

            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(16, 185, 129, 0.22)";
                ctx.fill();
            }
        }

        window.addEventListener("resize", resizeCanvas, { passive: true });
        resizeCanvas();

        for (let i = 0; i < maxNodes; i++) {
            nodes.push(new EcologicalNode());
        }

        const renderBackgroundLoop = () => {
            ctx.clearRect(0, 0, width, height);
            
            // Loop through nodes to update positions
            nodes.forEach(node => {
                node.update();
                node.draw();
            });

            // Connect neighboring proximity vectors
            ctx.lineWidth = 0.9;
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const dist = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
                    if (dist < 110) {
                        const alphaMultiplier = (110 - dist) / 110;
                        ctx.strokeStyle = `rgba(5, 150, 105, ${0.08 * alphaMultiplier})`;
                        ctx.beginPath();
                        ctx.moveTo(nodes[i].x, nodes[i].y);
                        ctx.lineTo(nodes[j].x, nodes[j].y);
                        ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(renderBackgroundLoop);
        };

        requestAnimationFrame(renderBackgroundLoop);
    }

    // ==========================================
    // 3. Typist Subtitle Sequence
    // ==========================================
    const typingText = document.getElementById("typingText");
    const phrases = [
        "SECURE GATEWAY TERMINAL",
        "PGENRO WORKSPACE INSTANCE",
        "CENTRAL ENVIRONMENTAL TELEMETRY"
    ];

    let currentPhraseIdx = 0;
    let currentCharIdx = 0;
    let isDeleting = false;

    const runTypingLoop = () => {
        if (!typingText) return;
        const currentString = phrases[currentPhraseIdx];

        if (isDeleting) {
            typingText.textContent = currentString.substring(0, currentCharIdx - 1);
            currentCharIdx--;
        } else {
            typingText.textContent = currentString.substring(0, currentCharIdx + 1);
            currentCharIdx++;
        }

        let speed = isDeleting ? 20 : (Math.random() * 25 + 30);

        if (!isDeleting && currentCharIdx === currentString.length) {
            speed = 2400; // Delay before clearing phrase
            isDeleting = true;
        }

        if (isDeleting && currentCharIdx === 0) {
            isDeleting = false;
            currentPhraseIdx = (currentPhraseIdx + 1) % phrases.length;
            speed = 300; 
        }

        setTimeout(runTypingLoop, speed);
    };

    if (typingText) {
        runTypingLoop();
    }

    // ==========================================
    // 4. Input Verification Panel
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
    const criteriaList = document.getElementById("criteriaList");

    const loadingOverlay = document.getElementById("loadingOverlay");
    const loadingStatusHeading = document.getElementById("loadingStatusHeading");
    const loadingStatusText = document.getElementById("loadingStatusText");

    let isEmailTouched = false;
    let isPasswordTouched = false;

    const setCollapseState = (container, visible) => {
        if (!container) return;
        if (visible) {
            container.classList.add("active");
        } else {
            container.classList.remove("active");
        }
    };

    const updateVisualFeedback = (inputNode, isInvalid, message = "") => {
        const parent = inputNode.closest(".input-group");
        if (!parent) return;

        parent.classList.remove("valid", "invalid");

        if (isInvalid) {
            parent.classList.add("invalid");
        } else if (inputNode.value.trim() !== "") {
            parent.classList.add("valid");
        }

        if (inputNode === emailInput) {
            if (emailError) emailError.textContent = message;
            setCollapseState(emailErrorContainer, isInvalid);
        }
        if (inputNode === passwordInput) {
            if (passwordError) passwordError.textContent = message;
            setCollapseState(passwordErrorContainer, isInvalid);
        }
    };

    const validateEmailFormat = (forceShow = false) => {
        if (!emailInput) return false;
        const val = emailInput.value.trim();
        const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!val) {
            if (forceShow || isEmailTouched) {
                updateVisualFeedback(emailInput, true, "PGENRO IMS Account.");
            }
            return false;
        }
        if (!pattern.test(val)) {
            if (forceShow || isEmailTouched) {
                updateVisualFeedback(emailInput, true, "Enter correct address configuration (e.g. user@domain.gov.ph).");
            }
            return false;
        }

        updateVisualFeedback(emailInput, false);
        return true;
    };

    const validatePasswordFormat = (forceShow = false) => {
        if (!passwordInput) return false;
        const val = passwordInput.value.trim();

        if (!val) {
            if (forceShow || isPasswordTouched) {
                updateVisualFeedback(passwordInput, true, "Access credentials security key required.");
                if (strengthContainer) strengthContainer.classList.remove("active");
            }
            return false;
        }
        if (val.length < 6) {
            if (forceShow || isPasswordTouched) {
                updateVisualFeedback(passwordInput, true, "System access keys require at least 6 characters.");
            }
            return false;
        }

        updateVisualFeedback(passwordInput, false);
        return true;
    };

    const updateCriteriaFeedback = (passwordString) => {
        if (!criteriaList) return;

        const validations = {
            length: passwordString.length >= 6,
            upper: /[A-Z]/.test(passwordString),
            number: /[0-9]/.test(passwordString),
            special: /[^A-Za-z0-9]/.test(passwordString)
        };

        let passedCount = 0;

        Object.keys(validations).forEach(criterion => {
            const el = criteriaList.querySelector(`[data-criterion="${criterion}"]`);
            if (el) {
                if (validations[criterion]) {
                    el.classList.add("met");
                    el.querySelector("i").setAttribute("data-lucide", "check-circle-2");
                    passedCount++;
                } else {
                    el.classList.remove("met");
                    el.querySelector("i").setAttribute("data-lucide", "circle-dot");
                }
            }
        });

        renderIconsSafely();
        return passedCount;
    };

    const analyzePasswordEntropy = (passwordString) => {
        if (!strengthContainer) return 0;

        if (!passwordString) {
            strengthContainer.classList.remove("active");
            return 0;
        }

        strengthContainer.classList.add("active");
        const metCount = updateCriteriaFeedback(passwordString);

        let color = "var(--danger)";
        let text = "Vulnerable Strength";
        let width = "25%";

        if (metCount === 3) {
            color = "var(--warning)";
            text = "Standard Protected Strength";
            width = "60%";
        } else if (metCount === 4) {
            color = "var(--success)";
            text = "High Complexity Key Matrix";
            width = "100%";
        }

        if (strengthBarFill) {
            strengthBarFill.style.width = width;
            strengthBarFill.style.backgroundColor = color;
        }
        if (strengthText) {
            strengthText.textContent = text;
            strengthText.style.color = color;
        }

        return metCount;
    };

    const displayBannerAlert = (status, text) => {
        if (!messageBox) return;
        messageBox.className = `message-box ${status}`;
        messageBox.textContent = text;
    };

    const clearBannerAlert = () => {
        if (!messageBox) return;
        messageBox.className = "message-box";
        messageBox.textContent = "";
    };

    const executeCardVibrate = () => {
        if (!card) return;
        card.classList.remove("shake-trigger");
        void card.offsetWidth; 
        card.classList.add("shake-trigger");
        setTimeout(() => card.classList.remove("shake-trigger"), 450);
    };

    if (togglePassword && passwordInput) {
        togglePassword.addEventListener("click", () => {
            const activeHidden = passwordInput.type === "password";
            passwordInput.type = activeHidden ? "text" : "password";

            togglePassword.innerHTML = activeHidden
                ? '<i data-lucide="eye-off" aria-hidden="true"></i>'
                : '<i data-lucide="eye" aria-hidden="true"></i>';

            renderIconsSafely();
        });
    }

    if (emailInput) {
        emailInput.addEventListener("input", () => {
            if (emailInput.closest(".input-group").classList.contains("invalid") || isEmailTouched) {
                validateEmailFormat();
            }
            clearBannerAlert();
        });

        emailInput.addEventListener("blur", () => {
            isEmailTouched = true;
            validateEmailFormat(true);
        });
    }

    if (passwordInput) {
        passwordInput.addEventListener("input", (e) => {
            analyzePasswordEntropy(e.target.value);
            if (passwordInput.closest(".input-group").classList.contains("invalid") || isPasswordTouched) {
                validatePasswordFormat();
            }
            clearBannerAlert();
        });

        passwordInput.addEventListener("blur", () => {
            isPasswordTouched = true;
            validatePasswordFormat(true);
        });
    }

    const saveRetainedCredentials = () => {
        if (rememberMe && rememberMe.checked && emailInput) {
            safeStorage.setItem("pgenro_retained_email", emailInput.value.trim());
        } else {
            safeStorage.removeItem("pgenro_retained_email");
        }
    };

    const prefillRetainedCredentials = () => {
        const value = safeStorage.getItem("pgenro_retained_email");
        if (value && emailInput) {
            emailInput.value = value;
            if (rememberMe) rememberMe.checked = true;
            updateVisualFeedback(emailInput, false);
        }
    };

    if (loginForm) {
        loginForm.addEventListener("submit", (e) => {
            e.preventDefault();

            isEmailTouched = true;
            isPasswordTouched = true;

            const isEmailValid = validateEmailFormat(true);
            const isPasswordValid = validatePasswordFormat(true);

            if (!isEmailValid || !isPasswordValid) {
                executeCardVibrate();
                displayBannerAlert("error", "Verify credentials and resolve invalid warning panels before entering gateway.");
                return;
            }

            saveRetainedCredentials();

            const c1 = document.getElementById("telemetryCheck1");
            const c2 = document.getElementById("telemetryCheck2");
            const c3 = document.getElementById("telemetryCheck3");

            // Reset Telemetry steps
            [c1, c2, c3].forEach(el => {
                if (el) el.className = "telemetry-item";
            });

            if (loadingOverlay) {
                loadingOverlay.classList.add("active");
                loadingOverlay.setAttribute("aria-hidden", "false");
            }
            
            if (loadingStatusHeading) loadingStatusHeading.textContent = "Negotiating Cryptographic Handshake";
            if (loadingStatusText) loadingStatusText.textContent = "Establishing security tunneling with PGENRO node keys...";

            // Telemetry item progressive step simulation
            setTimeout(() => {
                if (c1) c1.classList.add("active");
            }, 200);

            setTimeout(() => {
                if (c1) { c1.classList.remove("active"); c1.classList.add("done"); }
                if (c2) c2.classList.add("active");
                if (loadingStatusHeading) loadingStatusHeading.textContent = "Verifying Identity Signature";
                if (loadingStatusText) loadingStatusText.textContent = "Validating administrative system profile authorization credentials...";
            }, 900);

            setTimeout(() => {
                if (c2) { c2.classList.remove("active"); c2.classList.add("done"); }
                if (c3) c3.classList.add("active");
                if (loadingStatusHeading) loadingStatusHeading.textContent = "Routing Environment Module Session";
                if (loadingStatusText) loadingStatusText.textContent = "Connecting transaction logging workspace portals...";
            }, 1600);

            setTimeout(() => {
                if (c3) { c3.classList.remove("active"); c3.classList.add("done"); }
                if (loadingOverlay) {
                    loadingOverlay.classList.remove("active");
                    loadingOverlay.setAttribute("aria-hidden", "true");
                }

                displayBannerAlert("success", "Access gateway cleared. Re-routing interface profile workspace...");
                
                // Redirect hook transition point
                // setTimeout(() => { window.location.href = "dashboard.html"; }, 1000);
            }, 2400);
        });
    }

    prefillRetainedCredentials();
});