lucide.createIcons();

document.addEventListener('DOMContentLoaded', () => {

    // ==========================================
    // REFINED CANVAS ANIMATION (Windmills & Leaves)
    // ==========================================
    const canvas = document.getElementById('leafCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        let leaves = [];
        let windmills = [];
        const leafCount = window.innerWidth < 768 ? 15 : 30; 
        
        let mouse = { x: -1000, y: -1000, radius: 150 };
        
        window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
        window.addEventListener('mouseout', () => { mouse.x = -1000; mouse.y = -1000; });

        class Windmill {
            constructor(xPercent, yPercent, scale) {
                this.xPercent = xPercent;
                this.yPercent = yPercent;
                this.scale = scale;
                this.angle = Math.random() * Math.PI;
                this.baseSpeed = 0.003; 
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
                let distance = Math.sqrt(dx * dx + dy * dy);
                
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

                // Base
                ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.beginPath();
                ctx.moveTo(-16, 0); ctx.lineTo(16, 0); ctx.lineTo(10, -6); ctx.lineTo(-10, -6);
                ctx.closePath(); ctx.fill();

                // Tower
                const towerGrad = ctx.createLinearGradient(-10, 0, 10, 0);
                towerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.02)');
                towerGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
                towerGrad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
                
                ctx.fillStyle = towerGrad;
                ctx.beginPath();
                ctx.moveTo(-8, -6); ctx.lineTo(8, -6); ctx.lineTo(3.5, -150); ctx.lineTo(-3.5, -150);
                ctx.closePath(); ctx.fill();

                ctx.translate(0, -150);

                // Nacelle
                ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.beginPath();
                ctx.moveTo(-5, -6); ctx.lineTo(14, -6); ctx.lineTo(11, 4); ctx.lineTo(-5, 4);
                ctx.closePath(); ctx.fill();

                // Blades
                ctx.save();
                ctx.rotate(this.angle);
                
                for (let i = 0; i < 3; i++) {
                    ctx.rotate((Math.PI * 2) / 3);
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                    ctx.beginPath();
                    ctx.moveTo(0, 0); ctx.lineTo(-4, -35); ctx.lineTo(-1.5, -110); ctx.lineTo(0, -110);
                    ctx.closePath(); ctx.fill();

                    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
                    ctx.beginPath();
                    ctx.moveTo(0, 0); ctx.lineTo(0, -110); ctx.lineTo(1.5, -110); ctx.lineTo(3, -35);
                    ctx.closePath(); ctx.fill();
                    
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                    ctx.lineWidth = 0.5;
                    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -105); ctx.stroke();
                }
                ctx.restore();

                // Hub
                ctx.beginPath();
                ctx.arc(0, 0, 6, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.fill();

                ctx.restore();
            }
        }

        class Leaf {
            constructor() { this.reset(true); }

            reset(initial = false) {
                this.x = Math.random() * window.innerWidth;
                this.y = initial ? Math.random() * window.innerHeight : -50; 
                this.size = Math.random() * 8 + 6;
                this.speedY = Math.random() * 1 + 0.3;
                this.speedX = Math.random() * 1.5 - 0.75;
                this.angle = Math.random() * 360;
                this.spin = Math.random() * 1.5 - 0.75;
                this.sway = Math.random() * Math.PI * 2;
                this.swaySpeed = Math.random() * 0.02 + 0.01; 
                
                // Glowing Eco Colors
                const colors = [
                    'rgba(16, 185, 129, 0.8)',  
                    'rgba(52, 211, 153, 0.6)', 
                    'rgba(20, 184, 166, 0.7)'  
                ];
                this.color = colors[Math.floor(Math.random() * colors.length)];
            }

            update() {
                this.y += this.speedY;
                this.x += Math.sin(this.sway) * 1.0 + this.speedX;
                this.sway += this.swaySpeed;
                this.angle += this.spin;

                let dx = mouse.x - this.x;
                let dy = mouse.y - this.y;
                let distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < mouse.radius) {
                    const force = (mouse.radius - distance) / mouse.radius; 
                    this.x -= (dx / distance) * force * 4;
                    this.y -= (dy / distance) * force * 4;
                }

                if (this.y > window.innerHeight + this.size) this.reset();
                if (this.x > window.innerWidth + 50) this.x = -50;
                if (this.x < -50) this.x = window.innerWidth + 50;
            }

            draw() {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.rotate((this.angle * Math.PI) / 180);
                
                ctx.fillStyle = this.color;
                ctx.shadowBlur = 10;
                ctx.shadowColor = this.color;
                
                ctx.beginPath();
                ctx.moveTo(0, -this.size); 
                ctx.quadraticCurveTo(this.size * 0.8, 0, 0, this.size); 
                ctx.quadraticCurveTo(-this.size * 0.8, 0, 0, -this.size); 
                ctx.fill();
                ctx.restore();
            }
        }

        windmills.push(new Windmill(0.12, 0.90, 1.1)); 
        windmills.push(new Windmill(0.85, 0.82, 0.65)); 

        for (let i = 0; i < leafCount; i++) { leaves.push(new Leaf()); }

        function resizeCanvas() {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
            ctx.scale(dpr, dpr);
            windmills.forEach(w => w.resize(window.innerWidth, window.innerHeight));
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        function animateCanvas() {
            ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
            windmills.forEach(w => { w.update(); w.draw(); });
            leaves.forEach(l => { l.update(); l.draw(); });
            requestAnimationFrame(animateCanvas);
        }
        animateCanvas();
    }

    // Dynamic Calendar Display
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', dateOptions);

    // ==========================================
    // FORMS & DRAFT PRESERVATION SYSTEM
    // ==========================================
    const pages = document.querySelectorAll('.form-page');
    const steps = document.querySelectorAll('.step');
    const nextBtn = document.getElementById('nextBtn');
    const backBtn = document.getElementById('backBtn');
    const submitBtn = document.getElementById('submitBtn');
    const progressBar = document.getElementById('stepperProgress');
    const form = document.getElementById('accessForm');
    const allInputs = form.querySelectorAll('input[required], select[required], textarea[required]');
    const draftBanner = document.getElementById('draftBanner');
    
    let currentPage = 1;
    const totalPages = pages.length;

    // Toast Alert Setup
    function showToast(message, type = 'error') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icon = type === 'error' ? 'alert-circle' : 'check-circle';
        toast.innerHTML = `<i data-lucide="${icon}"></i><span>${message}</span>`;
        container.appendChild(toast);
        lucide.createIcons(); 

        requestAnimationFrame(() => setTimeout(() => toast.classList.add('show'), 10));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400); 
        }, 4000);
    }

    // Draft Logic
    function saveFormDraft() {
        const draftData = {};
        allInputs.forEach(input => {
            draftData[input.id] = input.type === 'checkbox' ? input.checked : input.value;
        });
        localStorage.setItem('pgenro_draft', JSON.stringify(draftData));
    }

    function checkFormDraft() {
        const saved = localStorage.getItem('pgenro_draft');
        if (saved) {
            const data = JSON.parse(saved);
            if (Object.values(data).some(val => val !== "" && val !== false)) {
                draftBanner.style.display = 'flex';
                draftBanner.setAttribute('aria-hidden', 'false');
            }
        }
    }

    document.getElementById('restoreDraftBtn').addEventListener('click', () => {
        const saved = localStorage.getItem('pgenro_draft');
        if (saved) {
            const data = JSON.parse(saved);
            allInputs.forEach(input => {
                if (data[input.id] !== undefined) {
                    if (input.type === 'checkbox') {
                        input.checked = data[input.id];
                        input.dispatchEvent(new Event('change'));
                    } else {
                        input.value = data[input.id];
                    }
                }
            });
            showToast("Draft progress recovered.", "success");
        }
        dismissDraftBanner();
    });

    document.getElementById('discardDraftBtn').addEventListener('click', () => {
        localStorage.removeItem('pgenro_draft');
        form.reset();
        showToast("Draft progress cleared.", "success");
        dismissDraftBanner();
    });

    function dismissDraftBanner() {
        draftBanner.style.display = 'none';
        draftBanner.setAttribute('aria-hidden', 'true');
    }

    allInputs.forEach(input => {
        input.addEventListener('change', saveFormDraft);
        input.addEventListener('input', saveFormDraft);
    });
    checkFormDraft();

    // Validation
    function validateField(input) {
        const errorSpan = document.getElementById(`${input.id}Error`);
        if (!input.checkValidity()) {
            input.classList.add('invalid-field');
            if (errorSpan) {
                if (input.validity.valueMissing) errorSpan.textContent = "This field is required.";
                else if (input.id === 'email') errorSpan.textContent = "Enter a valid government email.";
                else if (input.id === 'contact') errorSpan.textContent = "Requires 11-digit mobile (e.g. 09XXXXXXXXX).";
                else errorSpan.textContent = "Invalid format.";
            }
            return false;
        } else {
            input.classList.remove('invalid-field');
            if (errorSpan) errorSpan.textContent = "";
            return true;
        }
    }

    allInputs.forEach(input => {
        const handler = () => { if (input.classList.contains('invalid-field')) validateField(input); };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
    });

    // UI Updates
    function updateUI() {
        pages.forEach((page, index) => {
            if (index + 1 === currentPage) {
                page.style.display = 'flex';
                page.classList.add('active');
            } else {
                page.style.display = 'none';
                page.classList.remove('active');
            }
        });

        steps.forEach((step, index) => {
            step.classList.toggle('active', index + 1 <= currentPage);
        });

        progressBar.style.width = `${((currentPage - 1) / (totalPages - 1)) * 100}%`;
        backBtn.style.visibility = currentPage === 1 ? 'hidden' : 'visible';
        
        if (currentPage === totalPages) {
            nextBtn.style.display = 'none';
            submitBtn.style.display = 'flex';
        } else {
            nextBtn.style.display = 'flex';
            submitBtn.style.display = 'none';
        }
    }

    function validateCurrentPage() {
        let isValid = true;
        document.getElementById(`page${currentPage}`).querySelectorAll('input[required], select[required], textarea[required]').forEach(input => {
            if (!validateField(input)) isValid = false;
        });
        if (!isValid) showToast("Please review the highlighted items.", "error");
        return isValid;
    }

    nextBtn.addEventListener('click', () => {
        if (validateCurrentPage() && currentPage < totalPages) {
            currentPage++;
            updateUI();
        }
    });

    backBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            updateUI();
        }
    });

    form.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.id !== 'openPrivacyBtn') {
            e.preventDefault();
            currentPage < totalPages ? nextBtn.click() : form.dispatchEvent(new Event('submit'));
        }
    });

    // Privacy Modal
    const modal = document.getElementById('privacyModal');
    document.getElementById('openPrivacyBtn').addEventListener('click', () => modal.showModal());
    document.getElementById('closePrivacyBtn').addEventListener('click', () => modal.close());
    document.getElementById('acceptPrivacyBtn').addEventListener('click', () => {
        const agree = document.getElementById('agree');
        agree.checked = true;
        agree.dispatchEvent(new Event('change'));
        modal.close();
    });

    // Character Counter
    const reasonText = document.getElementById('reason');
    if (reasonText) {
        reasonText.addEventListener('input', () => {
            const length = reasonText.value.length;
            const counter = document.getElementById('charCount');
            counter.textContent = `${length} / 250`;
            counter.style.color = length >= 250 ? 'var(--clr-error)' : 'rgba(255,255,255,0.6)';
        });
    }

    // Submission
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        if (validateCurrentPage()) {
            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Processing...`;
            submitBtn.disabled = true; backBtn.disabled = true;
            lucide.createIcons();

            setTimeout(() => {
                showToast("Request submitted successfully.", "success");
                
                // Form cleanup & reset
                localStorage.removeItem('pgenro_draft');
                setTimeout(() => {
                    submitBtn.innerHTML = originalText;
                    submitBtn.disabled = false; backBtn.disabled = false;
                    form.reset(); currentPage = 1;
                    if(document.getElementById('charCount')) document.getElementById('charCount').textContent = '0 / 250';
                    allInputs.forEach(i => { i.classList.remove('invalid-field'); document.getElementById(`${i.id}Error`).textContent = ""; });
                    updateUI(); lucide.createIcons();
                }, 3000);
            }, 2000); 
        }
    });
});