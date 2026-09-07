// ==========================================================================
// PGENRO IMS — 60 FPS ENVIRONMENTAL ENGINE & SECURE CONTROLLER
// Provincial Government of Quezon | Enterprise Edition
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
    push,
    set,
    query,
    orderByChild,
    equalTo,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// ==========================================================================
// 1. FIREBASE INITIALIZATION & SECURITY POLICY
// ==========================================================================
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

// Security Policy Constants
const SECURITY_CONFIG = {
    MAX_FAILED_ATTEMPTS: 5,
    LOCKOUT_DURATION_MS: 30000, // 30 seconds
    SESSION_DURATION_MS: 8 * 60 * 60 * 1000 // 8 hours
};

// Safe storage wrapper
const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, val) { try { localStorage.setItem(key, val); } catch {} },
    remove(key) { try { localStorage.removeItem(key); } catch {} },
    getSession(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
    setSession(key, val) { try { sessionStorage.setItem(key, val); } catch {} },
    removeSession(key) { try { sessionStorage.removeItem(key); } catch {} }
};

// Mask email for RA 10173 compliance
const maskEmail = (email) => {
    if (!email || !email.includes("@")) return "***";
    const [user, domain] = email.split("@");
    if (user.length <= 2) return `${user[0]}*@${domain}`;
    return `${user[0]}${"*".repeat(user.length - 2)}${user[user.length - 1]}@${domain}`;
};

// Asynchronous non-blocking security audit logger
const recordAuditLog = async (action, email, status, details = "") => {
    try {
        const logRef = ref(db, "audit_logs/login_events");
        const newEntry = push(logRef);
        await set(newEntry, {
            action,
            emailMasked: maskEmail(email),
            status,
            details,
            timestamp: serverTimestamp(),
            userAgent: navigator.userAgent.substring(0, 120)
        });
    } catch {
        // Silent catch: audit failure never blocks personnel login
    }
};

// Sanitizer: Never store plaintext passwords in browser storage
const sanitizeUserData = (rawUser) => {
    if (!rawUser) return null;
    const clean = { ...rawUser };
    delete clean.password;
    delete clean.confirmPassword;
    delete clean.pin;
    clean.sessionInitialized = Date.now();
    clean.sessionExpires = Date.now() + SECURITY_CONFIG.SESSION_DURATION_MS;
    return clean;
};

// ==========================================================================
// 2. ULTRA-SMOOTH HARDWARE-ACCELERATED CANVAS CANOPY & GRAPHIC LINES ENGINE
// ==========================================================================
class EnvironmentalCanopyEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext("2d");

        this.width = 0;
        this.height = 0;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);

        // Parallax & Coordinates
        this.targetMouseX = 0.5;
        this.targetMouseY = 0.5;
        this.mouseX = 0.5;
        this.mouseY = 0.5;
        this.cursorPixelX = window.innerWidth / 2;
        this.cursorPixelY = window.innerHeight / 2;
        this.windSpeedX = 0;
        this.lastPointerX = 0;

        // Dynamic Shockwave Ripples
        this.ripples = [];

        // Particle Pools
        this.leaves = [];
        this.spores = [];
        this.graphicLines = [];

        // Performance & Delta Time Tracking
        this.time = 0;
        this.lastFrameTime = performance.now();
        this.animationFrameId = null;
        this.isTabActive = true;

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener("resize", () => this.resize(), { passive: true });

        // Mouse Parallax & Wind Impulse
        window.addEventListener("pointermove", (e) => {
            this.targetMouseX = e.clientX / (this.width || 1);
            this.targetMouseY = e.clientY / (this.height || 1);
            this.cursorPixelX = e.clientX;
            this.cursorPixelY = e.clientY;

            const deltaX = e.clientX - this.lastPointerX;
            this.windSpeedX += deltaX * 0.015;
            this.lastPointerX = e.clientX;
        }, { passive: true });

        // Interactive Click / Tap Ripple
        window.addEventListener("pointerdown", (e) => {
            this.addRipple(e.clientX, e.clientY, 26);
        }, { passive: true });

        // Mobile Gyroscope Parallax
        if (window.DeviceOrientationEvent) {
            window.addEventListener("deviceorientation", (e) => {
                if (e.gamma !== null && e.beta !== null) {
                    this.targetMouseX = 0.5 + Math.max(-0.4, Math.min(0.4, e.gamma / 45));
                    this.targetMouseY = 0.5 + Math.max(-0.4, Math.min(0.4, (e.beta - 40) / 60));
                }
            }, { passive: true });
        }

        // Battery Conservation: Pause rendering when tab is hidden
        document.addEventListener("visibilitychange", () => {
            this.isTabActive = !document.hidden;
            if (this.isTabActive) {
                this.lastFrameTime = performance.now();
                this.render(performance.now());
            }
        });

        this.initEntities();
        this.initGraphicLines();
        this.render(performance.now());
    }

    addRipple(x, y, strength = 28) {
        if (this.ripples.length >= 4) this.ripples.shift();
        this.ripples.push({
            x,
            y,
            radius: 0,
            maxRadius: Math.max(this.width, this.height) * 0.48,
            speed: 480,
            strength,
            life: 1.0
        });
    }

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);

        this.canvas.width = Math.floor(this.width * this.dpr);
        this.canvas.height = Math.floor(this.height * this.dpr);
        this.canvas.style.width = this.width + "px";
        this.canvas.style.height = this.height + "px";

        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    initEntities() {
        const isMobile = this.width < 640;
        const leafCount = isMobile ? 12 : 24;
        const sporeCount = isMobile ? 18 : 34;

        this.leaves = [];
        const leafPalettes = [
            { top: "#86efac", mid: "#22c55e", bot: "#156b39" },
            { top: "#a3e635", mid: "#65a30d", bot: "#166534" },
            { top: "#4ade80", mid: "#16a34a", bot: "#052e16" }
        ];

        for (let i = 0; i < leafCount; i++) {
            this.leaves.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height * 1.2 - this.height * 0.2,
                size: 11 + Math.random() * 14,
                speedY: 0.8 + Math.random() * 1.4,
                speedX: -0.4 + Math.random() * 0.8,
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: -0.02 + Math.random() * 0.04,
                flip: Math.random() * Math.PI,
                flipSpeed: 0.02 + Math.random() * 0.03,
                swayOffset: Math.random() * Math.PI * 2,
                palette: leafPalettes[i % leafPalettes.length],
                depth: 0.3 + Math.random() * 0.7
            });
        }

        this.spores = [];
        for (let i = 0; i < sporeCount; i++) {
            this.spores.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                radius: 1.2 + Math.random() * 2.4,
                speedY: -(0.3 + Math.random() * 0.7),
                speedX: -0.2 + Math.random() * 0.4,
                alpha: 0.25 + Math.random() * 0.55,
                pulseOffset: Math.random() * Math.PI * 2
            });
        }
    }

    initGraphicLines() {
        this.graphicLines = [
            // 0. High Altitude Auxiliary Contour
            {
                baseRatio: 0.28,
                amp: 46,
                f1: 0.0016,
                f2: 0.0034,
                speed: 0.45,
                phase: 0.3,
                colorMid: "rgba(52, 211, 153, 0.5)",
                lineWidth: 1.5,
                dash: [5, 7],
                pulses: [
                    { u: 0.20, speed: 0.08, size: 3.2, color: "#86efac" }
                ],
                tag: "CANOPY-NORTH"
            },
            // 1. Primary Flow Ribbon (Upper crest)
            {
                baseRatio: 0.40,
                amp: 68,
                f1: 0.0012,
                f2: 0.0026,
                speed: 0.65,
                phase: 1.6,
                colorMid: "rgba(74, 222, 128, 0.85)",
                lineWidth: 2.2,
                dash: [],
                pulses: [
                    { u: 0.45, speed: 0.12, size: 4.2, color: "#ffffff" }
                ],
                tag: "WATERSHED-ALPHA"
            },
            // 2. Main High-Energy Vector Ridge (Center glowing spine)
            {
                baseRatio: 0.52,
                amp: 88,
                f1: 0.0010,
                f2: 0.0022,
                speed: 0.55,
                phase: 3.1,
                colorMid: "rgba(134, 239, 172, 0.95)",
                lineWidth: 2.6,
                dash: [],
                pulses: [
                    { u: 0.15, speed: 0.14, size: 4.5, color: "#ffffff" },
                    { u: 0.68, speed: 0.11, size: 3.8, color: "#bbf7d0" }
                ],
                tag: "ELEVATION 240M"
            },
            // 3. Paired Mid-Contour
            {
                baseRatio: 0.65,
                amp: 74,
                f1: 0.0014,
                f2: 0.0030,
                speed: 0.75,
                phase: 4.5,
                colorMid: "rgba(52, 211, 153, 0.65)",
                lineWidth: 1.8,
                dash: [6, 6],
                pulses: [
                    { u: 0.35, speed: 0.09, size: 3.4, color: "#a7f3d0" }
                ],
                tag: "ISOHYET-04"
            },
            // 4. Low Valley Streamline
            {
                baseRatio: 0.78,
                amp: 62,
                f1: 0.0018,
                f2: 0.0038,
                speed: 0.50,
                phase: 5.7,
                colorMid: "rgba(34, 197, 94, 0.50)",
                lineWidth: 1.6,
                dash: [],
                pulses: [
                    { u: 0.58, speed: 0.08, size: 3.0, color: "#86efac" }
                ],
                tag: "FOREST-BASIN"
            }
        ];
    }

    computeCurveY(line, x, t, w, h) {
        const base_y = h * line.baseRatio;
        const w1 = Math.sin(x * line.f1 + t * line.speed + line.phase) * line.amp;
        const w2 = Math.cos(x * line.f2 - t * line.speed * 0.6 + line.phase * 0.5) * (line.amp * 0.45);
        let y = base_y + w1 + w2;

        // Dynamic Parallax Offset
        const parallaxDepth = 0.5 + line.baseRatio * 0.5;
        y += (this.mouseY - 0.5) * 45 * parallaxDepth;

        // Interactive Cursor Elastic Repulsion
        const dx = x - this.cursorPixelX;
        const dy = y - this.cursorPixelY;
        const dist = Math.hypot(dx, dy);
        if (dist < 220 && dist > 0) {
            const influence = Math.pow(1 - dist / 220, 2);
            const pushDir = dy >= 0 ? 1 : -1;
            y += pushDir * influence * 36;
        }

        // Concentric Ripple Waves
        for (let r = 0; r < this.ripples.length; r++) {
            const rip = this.ripples[r];
            const rdist = Math.hypot(x - rip.x, y - rip.y);
            const diff = Math.abs(rdist - rip.radius);
            if (diff < 80) {
                y += Math.sin(diff * (Math.PI / 80)) * 22 * rip.life;
            }
        }

        return y;
    }

    render(now = performance.now()) {
        if (!this.isTabActive) return;

        const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
        this.lastFrameTime = now;
        this.time += dt;

        this.mouseX += (this.targetMouseX - this.mouseX) * 0.06;
        this.mouseY += (this.targetMouseY - this.mouseY) * 0.06;
        this.windSpeedX *= 0.94;

        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const rip = this.ripples[i];
            rip.radius += rip.speed * dt;
            rip.life = Math.max(0, 1 - rip.radius / rip.maxRadius);
            if (rip.life <= 0) this.ripples.splice(i, 1);
        }

        const offsetX = (this.mouseX - 0.5) * 40;
        const offsetY = (this.mouseY - 0.5) * 30;

        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        // 1. Forest Deep Background Gradient
        const bgGrad = ctx.createLinearGradient(0, 0, w, h);
        bgGrad.addColorStop(0, "#010c05");
        bgGrad.addColorStop(0.38, "#041b0e");
        bgGrad.addColorStop(0.72, "#072614");
        bgGrad.addColorStop(1, "#020f06");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // 2. Volumetric Sunbeams
        ctx.save();
        ctx.globalCompositeOperation = "screen";

        const beamGrad1 = ctx.createLinearGradient(w * 0.2 + offsetX * 0.4, 0, w * 0.45 + offsetX * 0.4, h);
        beamGrad1.addColorStop(0, "rgba(203, 235, 172, 0.09)");
        beamGrad1.addColorStop(0.5, "rgba(134, 239, 172, 0.03)");
        beamGrad1.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = beamGrad1;
        ctx.beginPath();
        ctx.moveTo(w * 0.12 + offsetX * 0.4, -20);
        ctx.lineTo(w * 0.28 + offsetX * 0.4, -20);
        ctx.lineTo(w * 0.65 + offsetX * 0.4, h + 20);
        ctx.lineTo(w * 0.38 + offsetX * 0.4, h + 20);
        ctx.closePath();
        ctx.fill();

        const beamGrad2 = ctx.createLinearGradient(w * 0.58 + offsetX * 0.2, 0, w * 0.82 + offsetX * 0.2, h);
        beamGrad2.addColorStop(0, "rgba(203, 235, 172, 0.06)");
        beamGrad2.addColorStop(0.5, "rgba(134, 239, 172, 0.02)");
        beamGrad2.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = beamGrad2;
        ctx.beginPath();
        ctx.moveTo(w * 0.52 + offsetX * 0.2, -20);
        ctx.lineTo(w * 0.68 + offsetX * 0.2, -20);
        ctx.lineTo(w * 0.96 + offsetX * 0.2, h + 20);
        ctx.lineTo(w * 0.74 + offsetX * 0.2, h + 20);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // 3. HARDWARE-ACCELERATED GRAPHIC CONTOUR STREAMLINES & RIBBONS
        this.renderGraphicContourLines(ctx, w, h, dt);

        // 4. Ambient Forest Spotlight
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const spotGrad = ctx.createRadialGradient(
            this.cursorPixelX, this.cursorPixelY, 0,
            this.cursorPixelX, this.cursorPixelY, Math.max(w * 0.28, 280)
        );
        spotGrad.addColorStop(0, "rgba(134, 239, 172, 0.08)");
        spotGrad.addColorStop(0.4, "rgba(34, 197, 94, 0.025)");
        spotGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = spotGrad;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        // 5. Luminous Forest Spores
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const sporeScale = dt * 60;
        for (let i = 0; i < this.spores.length; i++) {
            const p = this.spores[i];
            p.y += p.speedY * sporeScale;
            p.x += p.speedX * sporeScale;

            if (p.y < -10) p.y = h + 10;
            if (p.x < -10) p.x = w + 10;
            if (p.x > w + 10) p.x = -10;

            const currentAlpha = p.alpha * (0.6 + 0.4 * Math.sin(this.time * 2 + p.pulseOffset));
            ctx.fillStyle = `rgba(187, 247, 208, ${currentAlpha.toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // 6. Physics-Driven 3D Tumbling Leaves
        const leafScale = dt * 60;
        for (let i = 0; i < this.leaves.length; i++) {
            const leaf = this.leaves[i];

            leaf.swayOffset += 0.025 * leafScale;
            const naturalSway = Math.sin(leaf.swayOffset) * 1.2;

            leaf.y += leaf.speedY * leaf.depth * leafScale;
            leaf.x += (leaf.speedX + naturalSway + this.windSpeedX * 0.8) * leaf.depth * leafScale;
            leaf.rotation += leaf.rotationSpeed * leafScale;
            leaf.flip += leaf.flipSpeed * leafScale;

            const dx = leaf.x - this.cursorPixelX;
            const dy = leaf.y - this.cursorPixelY;
            const dist = Math.hypot(dx, dy);
            if (dist < 130 && dist > 0) {
                const force = (1 - dist / 130) * 3.5 * leafScale;
                leaf.x += (dx / dist) * force;
                leaf.y += (dy / dist) * force;
            }

            if (leaf.y > h + 30) {
                leaf.y = -30;
                leaf.x = Math.random() * w;
            }
            if (leaf.x < -40) leaf.x = w + 40;
            if (leaf.x > w + 40) leaf.x = -40;

            const scaleX = Math.cos(leaf.flip);
            const scaleY = 0.8 + 0.2 * Math.sin(leaf.swayOffset);

            ctx.save();
            ctx.translate(leaf.x, leaf.y);
            ctx.rotate(leaf.rotation);
            ctx.scale(scaleX, scaleY);

            const leafGrad = ctx.createLinearGradient(0, -leaf.size, 0, leaf.size);
            leafGrad.addColorStop(0, leaf.palette.top);
            leafGrad.addColorStop(0.5, leaf.palette.mid);
            leafGrad.addColorStop(1, leaf.palette.bot);

            ctx.fillStyle = leafGrad;
            ctx.globalAlpha = 0.75 * leaf.depth;

            ctx.beginPath();
            ctx.moveTo(0, -leaf.size);
            ctx.bezierCurveTo(leaf.size * 0.75, -leaf.size * 0.4, leaf.size * 0.75, leaf.size * 0.5, 0, leaf.size);
            ctx.bezierCurveTo(-leaf.size * 0.75, leaf.size * 0.5, -leaf.size * 0.75, -leaf.size * 0.4, 0, -leaf.size);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = "rgba(220, 252, 231, 0.45)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, -leaf.size * 0.85);
            ctx.lineTo(0, leaf.size * 0.85);
            ctx.stroke();

            ctx.restore();
        }

        // 7. Subtle Vignette
        ctx.save();
        const vigGrad = ctx.createRadialGradient(w / 2, h / 2, w * 0.35, w / 2, h / 2, w * 0.72);
        vigGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
        vigGrad.addColorStop(1, "rgba(0, 5, 2, 0.65)");
        ctx.fillStyle = vigGrad;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        this.animationFrameId = requestAnimationFrame((t) => this.render(t));
    }

    renderGraphicContourLines(ctx, w, h, dt) {
        const step = Math.max(20, Math.floor(w / 65));
        const numPts = Math.ceil(w / step) + 2;

        const computedLines = [];
        for (let l = 0; l < this.graphicLines.length; l++) {
            const line = this.graphicLines[l];
            const points = [];
            for (let i = 0; i < numPts; i++) {
                const x = i * step;
                const y = this.computeCurveY(line, x, this.time, w, h);
                points.push({ x, y });
            }
            computedLines.push(points);
        }

        // A. Ribbon Fill between Line 1 and Line 2
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const ribbonGrad = ctx.createLinearGradient(0, 0, w, 0);
        ribbonGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
        ribbonGrad.addColorStop(0.3, "rgba(34, 197, 94, 0.06)");
        ribbonGrad.addColorStop(0.7, "rgba(134, 239, 172, 0.10)");
        ribbonGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

        ctx.beginPath();
        ctx.moveTo(computedLines[1][0].x, computedLines[1][0].y);
        for (let i = 0; i < computedLines[1].length - 1; i++) {
            const xc = (computedLines[1][i].x + computedLines[1][i + 1].x) * 0.5;
            const yc = (computedLines[1][i].y + computedLines[1][i + 1].y) * 0.5;
            ctx.quadraticCurveTo(computedLines[1][i].x, computedLines[1][i].y, xc, yc);
        }
        ctx.lineTo(computedLines[1][computedLines[1].length - 1].x, computedLines[1][computedLines[1].length - 1].y);

        ctx.lineTo(computedLines[2][computedLines[2].length - 1].x, computedLines[2][computedLines[2].length - 1].y);
        for (let i = computedLines[2].length - 1; i > 0; i--) {
            const xc = (computedLines[2][i].x + computedLines[2][i - 1].x) * 0.5;
            const yc = (computedLines[2][i].y + computedLines[2][i - 1].y) * 0.5;
            ctx.quadraticCurveTo(computedLines[2][i].x, computedLines[2][i].y, xc, yc);
        }
        ctx.lineTo(computedLines[2][0].x, computedLines[2][0].y);
        ctx.closePath();
        ctx.fillStyle = ribbonGrad;
        ctx.fill();
        ctx.restore();

        // B. Render Contour Splines
        for (let l = 0; l < this.graphicLines.length; l++) {
            const line = this.graphicLines[l];
            const points = computedLines[l];

            ctx.save();
            ctx.lineWidth = line.lineWidth;
            ctx.setLineDash(line.dash);

            const strokeGrad = ctx.createLinearGradient(0, 0, w, 0);
            strokeGrad.addColorStop(0, "rgba(16, 185, 129, 0.0)");
            strokeGrad.addColorStop(0.2, line.colorMid);
            strokeGrad.addColorStop(0.8, line.colorMid);
            strokeGrad.addColorStop(1, "rgba(16, 185, 129, 0.0)");
            ctx.strokeStyle = strokeGrad;

            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 0; i < points.length - 1; i++) {
                const xc = (points[i].x + points[i + 1].x) * 0.5;
                const yc = (points[i].y + points[i + 1].y) * 0.5;
                ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
            }
            ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
            ctx.stroke();
            ctx.restore();

            // C. Luminous Data Pulses
            if (line.pulses && line.pulses.length > 0) {
                ctx.save();
                ctx.globalCompositeOperation = "screen";

                for (let p = 0; p < line.pulses.length; p++) {
                    const pulse = line.pulses[p];
                    pulse.u = (pulse.u + pulse.speed * dt) % 1.0;

                    const px = pulse.u * w;
                    const py = this.computeCurveY(line, px, this.time, w, h);

                    ctx.beginPath();
                    ctx.moveTo(px, py);
                    for (let s = 1; s <= 6; s++) {
                        const tx = px - s * 8;
                        if (tx >= 0) {
                            ctx.lineTo(tx, this.computeCurveY(line, tx, this.time, w, h));
                        }
                    }
                    ctx.strokeStyle = "rgba(134, 239, 172, 0.5)";
                    ctx.lineWidth = line.lineWidth * 1.6;
                    ctx.stroke();

                    const glowGrad = ctx.createRadialGradient(px, py, 0, px, py, pulse.size * 3);
                    glowGrad.addColorStop(0, "#ffffff");
                    glowGrad.addColorStop(0.4, pulse.color || "#86efac");
                    glowGrad.addColorStop(1, "rgba(34, 197, 94, 0)");

                    ctx.fillStyle = glowGrad;
                    ctx.beginPath();
                    ctx.arc(px, py, pulse.size * 3, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = "#ffffff";
                    ctx.beginPath();
                    ctx.arc(px, py, pulse.size * 0.8, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            // D. Geodetic Crosshair
            if (l === 2 || l === 0) {
                ctx.save();
                const markerX = ((l * 380 + this.time * 25) % (w * 0.8)) + w * 0.1;
                const markerY = this.computeCurveY(line, markerX, this.time, w, h);

                ctx.strokeStyle = "rgba(187, 247, 208, 0.4)";
                ctx.lineWidth = 1;

                ctx.beginPath();
                ctx.moveTo(markerX - 4, markerY);
                ctx.lineTo(markerX + 4, markerY);
                ctx.moveTo(markerX, markerY - 4);
                ctx.lineTo(markerX + 4, markerY);
                ctx.stroke();

                ctx.font = "8px 'Plus Jakarta Sans', sans-serif";
                ctx.fillStyle = "rgba(187, 247, 208, 0.4)";
                ctx.fillText(line.tag || "PGENRO-GIS", markerX + 7, markerY + 3);

                ctx.restore();
            }
        }
    }
}

// ==========================================================================
// 3. MAIN CONTROLLER & FORM LOGIC
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    // Start Canvas Canopy Engine
    window.canopyEngine = new EnvironmentalCanopyEngine("canopyCanvas");

    // DOM Elements
    const loginForm = document.getElementById("loginForm");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const rememberMe = document.getElementById("rememberMe");
    const togglePassword = document.getElementById("togglePassword");
    const clearEmailBtn = document.getElementById("clearEmailBtn");
    const domainSuggestions = document.getElementById("domainSuggestions");
    const messageBox = document.getElementById("messageBox");
    const messageContent = document.getElementById("messageContent");
    const dismissAlert = document.getElementById("dismissAlert");
    const card = document.getElementById("interactiveCard");
    const capsLockWarning = document.getElementById("capsLockWarning");
    const loadingOverlay = document.getElementById("loadingOverlay");
    const loadingStatusHeading = document.getElementById("loadingStatusHeading");
    const loadingStatusText = document.getElementById("loadingStatusText");
    const loginButton = document.getElementById("loginBtn");
    const phTimeDisplay = document.getElementById("phTimeDisplay");
    const emailFieldBox = document.getElementById("emailFieldBox");
    const passwordFieldBox = document.getElementById("passwordFieldBox");
    const networkStatusBar = document.getElementById("networkStatusBar");
    const lockoutNotice = document.getElementById("lockoutNotice");
    const lockoutSeconds = document.getElementById("lockoutSeconds");

    let lockoutTimerInterval = null;

    // Render Lucide Icons
    const renderIcons = () => {
        if (typeof lucide !== "undefined" && typeof lucide.createIcons === "function") {
            lucide.createIcons();
        }
    };
    renderIcons();

    // Live PST Clock
    if (phTimeDisplay) {
        const updatePST = () => {
            const formatted = new Intl.DateTimeFormat("en-US", {
                timeZone: "Asia/Manila",
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true
            }).format(new Date());
            phTimeDisplay.textContent = `PST • ${formatted}`;
        };
        updatePST();
        setInterval(updatePST, 1000);
    }

    // Network Status Watcher
    const updateNetworkStatus = () => {
        if (!navigator.onLine) {
            networkStatusBar?.classList.add("active");
            displayBanner("error", "Offline Mode", "Your workstation has lost internet connectivity.");
        } else {
            networkStatusBar?.classList.remove("active");
        }
    };
    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);
    updateNetworkStatus();

    // Brute-force Lockout Checker
    const checkLockoutState = () => {
        const lockoutUntil = parseInt(storage.getSession("pgenro_lockout_until") || "0", 10);
        const now = Date.now();

        if (lockoutUntil > now) {
            const remaining = Math.ceil((lockoutUntil - now) / 1000);
            startLockoutCountdown(remaining);
            return true;
        }
        return false;
    };

    const recordFailedAttempt = () => {
        let attempts = parseInt(storage.getSession("pgenro_failed_attempts") || "0", 10) + 1;
        storage.setSession("pgenro_failed_attempts", attempts.toString());

        if (attempts >= SECURITY_CONFIG.MAX_FAILED_ATTEMPTS) {
            const lockoutUntil = Date.now() + SECURITY_CONFIG.LOCKOUT_DURATION_MS;
            storage.setSession("pgenro_lockout_until", lockoutUntil.toString());
            storage.setSession("pgenro_failed_attempts", "0");
            startLockoutCountdown(Math.ceil(SECURITY_CONFIG.LOCKOUT_DURATION_MS / 1000));
        }
    };

    const resetFailedAttempts = () => {
        storage.removeSession("pgenro_failed_attempts");
        storage.removeSession("pgenro_lockout_until");
    };

    const startLockoutCountdown = (seconds) => {
        if (lockoutTimerInterval) clearInterval(lockoutTimerInterval);

        if (loginButton) loginButton.disabled = true;
        if (emailInput) emailInput.disabled = true;
        if (passwordInput) passwordInput.disabled = true;
        if (lockoutNotice) lockoutNotice.classList.add("active");
        if (lockoutSeconds) lockoutSeconds.textContent = seconds;

        let timeLeft = seconds;
        lockoutTimerInterval = setInterval(() => {
            timeLeft -= 1;
            if (lockoutSeconds) lockoutSeconds.textContent = timeLeft;

            if (timeLeft <= 0) {
                clearInterval(lockoutTimerInterval);
                lockoutNotice?.classList.remove("active");
                if (loginButton) loginButton.disabled = false;
                if (emailInput) emailInput.disabled = false;
                if (passwordInput) passwordInput.disabled = false;
                storage.removeSession("pgenro_lockout_until");
            }
        }, 1000);
    };

    checkLockoutState();

    // Load saved email
    const savedEmail = storage.get("pgenro_saved_email");
    if (savedEmail && emailInput) {
        emailInput.value = savedEmail;
        if (rememberMe) rememberMe.checked = true;
        if (clearEmailBtn) clearEmailBtn.style.display = "grid";
    }

    // Email Input: Clear button and domain suggestions
    emailInput?.addEventListener("input", (e) => {
        const val = e.target.value.trim();
        if (clearEmailBtn) clearEmailBtn.style.display = val.length > 0 ? "grid" : "none";

        if (domainSuggestions) {
            if (val.length > 2 && !val.includes("@")) {
                domainSuggestions.classList.add("show");
            } else {
                domainSuggestions.classList.remove("show");
            }
        }
    });

    clearEmailBtn?.addEventListener("click", () => {
        if (emailInput) {
            emailInput.value = "";
            emailInput.focus();
            clearEmailBtn.style.display = "none";
            domainSuggestions?.classList.remove("show");
        }
    });

    // Domain chips
    domainSuggestions?.querySelectorAll(".domain-pill").forEach(pill => {
        pill.addEventListener("click", () => {
            const domain = pill.getAttribute("data-domain");
            if (emailInput && domain) {
                emailInput.value = `${emailInput.value.replace(/@.*/, "").trim()}${domain}`;
                domainSuggestions.classList.remove("show");
                passwordInput?.focus();
            }
        });
    });

    // Caps Lock Detection
    if (passwordInput && capsLockWarning) {
        const checkCaps = (e) => {
            if (e.getModifierState) {
                const isCaps = e.getModifierState("CapsLock");
                capsLockWarning.setAttribute("aria-hidden", String(!isCaps));
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
            togglePassword.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
            togglePassword.setAttribute("aria-pressed", String(isPassword));
            togglePassword.innerHTML = `<i data-lucide="${isPassword ? "eye-off" : "eye"}"></i>`;
            renderIcons();
        });
    }

    // Alert Banner
    const displayBanner = (status, title, text) => {
        if (!messageBox || !messageContent) return;
        messageBox.className = `message-box show ${status}`;
        messageContent.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
        renderIcons();
    };

    const clearBanner = () => {
        if (!messageBox || !messageContent) return;
        messageBox.className = "message-box";
        messageContent.innerHTML = "";
    };

    dismissAlert?.addEventListener("click", clearBanner);

    const triggerVibrate = () => {
        if (!card) return;
        card.classList.remove("shake-trigger");
        void card.offsetWidth;
        card.classList.add("shake-trigger");
        window.canopyEngine?.addRipple(window.innerWidth / 2, window.innerHeight / 2, 36);
        setTimeout(() => card.classList.remove("shake-trigger"), 400);
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

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Clear alert when user interacts
    emailInput?.addEventListener("input", clearBanner);
    passwordInput?.addEventListener("input", clearBanner);
    emailInput?.addEventListener("focus", () => emailFieldBox?.classList.remove("invalid"));
    passwordInput?.addEventListener("focus", () => passwordFieldBox?.classList.remove("invalid"));

    // Material Ripple Click Effect
    document.querySelectorAll(".primary-sign-btn, .request-access-btn, .seal-container").forEach(el => {
        el.addEventListener("click", function (e) {
            const rect = this.getBoundingClientRect();
            const ripple = document.createElement("span");
            ripple.className = "ripple-wave";
            ripple.style.left = `${e.clientX - rect.left}px`;
            ripple.style.top = `${e.clientY - rect.top}px`;
            this.appendChild(ripple);
            setTimeout(() => ripple.remove(), 550);
        });
    });

    // ----------------------------------------------------------------------
    // Form Submission & Verification Pipeline
    // ----------------------------------------------------------------------
    loginForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        clearBanner();

        if (checkLockoutState()) {
            triggerVibrate();
            displayBanner("warning", "Lockout Active", "Please wait for the security countdown to finish.");
            return;
        }

        if (!navigator.onLine) {
            triggerVibrate();
            displayBanner("error", "Network Offline", "Cannot authenticate credentials without active connection.");
            return;
        }

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

        // Format validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            emailFieldBox?.classList.add("invalid");
            triggerVibrate();
            displayBanner("error", "Invalid Email Format", "Please supply a valid government email (e.g., name@quezon.gov.ph).");
            return;
        }

        if (rememberMe?.checked) {
            storage.set("pgenro_saved_email", email);
        } else {
            storage.remove("pgenro_saved_email");
        }

        try {
            showLoading("Verifying Clearance", "Connecting to PGENRO secure directory...");
            await delay(180);

            // Step A: Admin Authentication
            const isAuthorizedAdminDomain = email.endsWith("@pgenro.admin") || email.endsWith("@admin.quezon.gov.ph");

            if (isAuthorizedAdminDomain) {
                try {
                    const userCredential = await signInWithEmailAndPassword(auth, email, password);
                    if (loadingStatusHeading) loadingStatusHeading.textContent = "Clearance Granted";
                    if (loadingStatusText) loadingStatusText.textContent = "Administrator verified. Opening Control Center...";

                    resetFailedAttempts();
                    await recordAuditLog("ADMIN_LOGIN_SUCCESS", email, "Success", "Firebase Auth Authorized");

                    storage.setSession("pgenro_session_token", userCredential.user.uid);
                    await delay(300);
                    window.location.href = "../admin/admin.html";
                    return;
                } catch (adminErr) {
                    console.warn("Primary admin auth rejected, checking database...", adminErr.code);
                }
            }

            // Step B: Personnel Registry Verification
            if (loadingStatusText) loadingStatusText.textContent = "Querying personnel registry...";

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
                recordFailedAttempt();
                triggerVibrate();
                emailFieldBox?.classList.add("invalid");
                await recordAuditLog("LOGIN_FAILED_NOT_FOUND", email, "Failed", "No registry entry");
                displayBanner("error", "Record Not Found", `No personnel record was found for "${email}". Please submit an Access Request.`);
                return;
            }

            if (userData.status === "Pending") {
                hideLoading();
                triggerVibrate();
                await recordAuditLog("LOGIN_BLOCKED_PENDING", email, "Blocked", "Status is Pending");
                displayBanner("warning", "Account Pending Clearance", `Your request (${userData.id || "ID-REQ"}) is undergoing Administrator review.`);
                return;
            }

            if (userData.status === "Rejected") {
                hideLoading();
                triggerVibrate();
                const reason = userData.declineRemarks || "Verification requirements were not met.";
                await recordAuditLog("LOGIN_BLOCKED_REJECTED", email, "Blocked", `Reason: ${reason}`);
                displayBanner("error", "Access Request Declined", `Your clearance was declined: "${reason}"`);
                return;
            }

            if (userData.status === "Approved") {
                if (userData.password && userData.password !== password) {
                    hideLoading();
                    recordFailedAttempt();
                    triggerVibrate();
                    passwordFieldBox?.classList.add("invalid");
                    await recordAuditLog("LOGIN_FAILED_PASSWORD", email, "Failed", "Incorrect password");
                    displayBanner("error", "Authentication Failed", "The password you entered is incorrect. Please verify credentials.");
                    passwordInput?.focus();
                    return;
                }

                // Authentication confirmed
                resetFailedAttempts();
                if (loadingStatusHeading) loadingStatusHeading.textContent = "Clearance Granted";
                if (loadingStatusText) loadingStatusText.textContent = `Welcome back, ${userData.fullName || "Personnel"}! Redirecting...`;

                // Scrub plaintext password before saving
                const cleanProfile = sanitizeUserData(userData);
                storage.set("pgenro_current_user", JSON.stringify(cleanProfile));
                storage.setSession("pgenro_session_active", "true");

                await recordAuditLog("PERSONNEL_LOGIN_SUCCESS", email, "Success", `Role: ${userData.role || "Staff"}`);
                await delay(350);

                if (userData.role === "admin" || userData.role === "superadmin") {
                    window.location.href = "../admin/admin.html";
                } else {
                    window.location.href = "../User/homepage.html";
                }
                return;
            }

            hideLoading();
            triggerVibrate();
            displayBanner("warning", "Unverified Clearance", "Your clearance status could not be verified. Please coordinate with IT.");

        } catch (error) {
            hideLoading();
            triggerVibrate();
            console.error("Login Error:", error);
            await recordAuditLog("LOGIN_SYSTEM_ERROR", email, "Error", error.message);
            displayBanner("error", "System Notice", error.message || "Failed to authenticate with the server. Please try again.");
        }
    });
});