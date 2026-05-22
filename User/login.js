document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();

    const typingText = document.getElementById("typingText");
    const loginForm = document.getElementById("loginForm");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const rememberMe = document.getElementById("rememberMe");
    const togglePassword = document.getElementById("togglePassword");
    const loginBtn = document.getElementById("loginBtn");
    const loginText = document.getElementById("loginText");
    const messageBox = document.getElementById("messageBox");

    const emailError = document.getElementById("emailError");
    const passwordError = document.getElementById("passwordError");

    const typingWords = [
        "Information",
        "Management System",
        "PG-ENRO",
        "Quezon Province"
    ];

    let wordIndex = 0;
    let charIndex = 0;
    let isDeleting = false;

    function typeEffect() {
        const currentWord = typingWords[wordIndex];

        if (isDeleting) {
            typingText.textContent = currentWord.substring(0, charIndex - 1);
            charIndex--;
        } else {
            typingText.textContent = currentWord.substring(0, charIndex + 1);
            charIndex++;
        }

        let speed = isDeleting ? 55 : 110;

        if (!isDeleting && charIndex === currentWord.length) {
            speed = 1300;
            isDeleting = true;
        }

        if (isDeleting && charIndex === 0) {
            isDeleting = false;
            wordIndex = (wordIndex + 1) % typingWords.length;
            speed = 350;
        }

        setTimeout(typeEffect, speed);
    }

    typeEffect();

    function showMessage(type, text) {
        messageBox.className = `message-box ${type}`;
        messageBox.textContent = text;
    }

    function clearMessage() {
        messageBox.className = "message-box";
        messageBox.textContent = "";
    }

    function setInputState(input, type, message = "") {
        const group = input.closest(".input-group");

        group.classList.remove("valid", "invalid");

        if (type === "error") {
            group.classList.add("invalid");
        }

        if (type === "success") {
            group.classList.add("valid");
        }

        if (input === emailInput) {
            emailError.textContent = message;
        }

        if (input === passwordInput) {
            passwordError.textContent = message;
        }
    }

    function validateEmail() {
        const emailValue = emailInput.value.trim();
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (emailValue === "") {
            setInputState(emailInput, "error", "Email address is required.");
            return false;
        }

        if (!emailPattern.test(emailValue)) {
            setInputState(emailInput, "error", "Please enter a valid email address.");
            return false;
        }

        setInputState(emailInput, "success");
        return true;
    }

    function validatePassword() {
        const passwordValue = passwordInput.value.trim();

        if (passwordValue === "") {
            setInputState(passwordInput, "error", "Password is required.");
            return false;
        }

        if (passwordValue.length < 6) {
            setInputState(passwordInput, "error", "Password must be at least 6 characters.");
            return false;
        }

        setInputState(passwordInput, "success");
        return true;
    }

    function loadRememberedEmail() {
        const savedEmail = localStorage.getItem("pgenro_saved_email");

        if (savedEmail) {
            emailInput.value = savedEmail;
            rememberMe.checked = true;
            validateEmail();
        }
    }

    function saveRememberedEmail() {
        if (rememberMe.checked) {
            localStorage.setItem("pgenro_saved_email", emailInput.value.trim());
        } else {
            localStorage.removeItem("pgenro_saved_email");
        }
    }

    togglePassword.addEventListener("click", () => {
        const isHidden = passwordInput.type === "password";

        passwordInput.type = isHidden ? "text" : "password";
        togglePassword.innerHTML = isHidden
            ? '<i data-lucide="eye-off"></i>'
            : '<i data-lucide="eye"></i>';

        lucide.createIcons();
    });

    emailInput.addEventListener("input", () => {
        validateEmail();
        clearMessage();
    });

    passwordInput.addEventListener("input", () => {
        validatePassword();
        clearMessage();
    });

    rememberMe.addEventListener("change", saveRememberedEmail);

    loginForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const isEmailValid = validateEmail();
        const isPasswordValid = validatePassword();

        if (!isEmailValid || !isPasswordValid) {
            showMessage("error", "Please check your email and password before signing in.");
            return;
        }

        saveRememberedEmail();

        loginBtn.disabled = true;
        loginText.textContent = "Signing in...";
        loginBtn.querySelector("i").setAttribute("data-lucide", "loader-circle");
        lucide.createIcons();

        setTimeout(() => {
            showMessage("success", "Login successful. Redirecting to dashboard...");

            loginBtn.disabled = false;
            loginText.textContent = "Sign In";
            loginBtn.querySelector("i").setAttribute("data-lucide", "arrow-right");
            lucide.createIcons();

            /*
                Front-end demo only.
                Kapag may dashboard ka na, tanggalin ang comment sa baba:

                window.location.href = "dashboard.html";
            */
        }, 1200);
    });

    loadRememberedEmail();
});