document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();

    const form = document.getElementById("requestForm");
    const messageBox = document.getElementById("messageBox");
    const clearBtn = document.getElementById("clearBtn");

    const fullName = document.getElementById("fullName");
    const email = document.getElementById("email");
    const contact = document.getElementById("contact");
    const position = document.getElementById("position");
    const section = document.getElementById("section");
    const role = document.getElementById("role");
    const reason = document.getElementById("reason");
    const agreeTerms = document.getElementById("agreeTerms");
    const termsError = document.getElementById("termsError");
    const charCount = document.getElementById("charCount");

    const fields = [
        fullName,
        email,
        position,
        section,
        role,
        reason
    ];

    function showMessage(type, text) {
        messageBox.className = `message-box ${type}`;
        messageBox.textContent = text;
    }

    function clearMessage() {
        messageBox.className = "message-box";
        messageBox.textContent = "";
    }

    function setError(input, message) {
        const group = input.closest(".input-group");
        const errorText = group.querySelector(".error-text");

        group.classList.remove("valid");
        group.classList.add("invalid");
        errorText.textContent = message;
    }

    function setSuccess(input) {
        const group = input.closest(".input-group");
        const errorText = group.querySelector(".error-text");

        group.classList.remove("invalid");
        group.classList.add("valid");
        errorText.textContent = "";
    }

    function clearValidation(input) {
        const group = input.closest(".input-group");
        const errorText = group.querySelector(".error-text");

        group.classList.remove("invalid", "valid");
        errorText.textContent = "";
    }

    function isEmailValid(value) {
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailPattern.test(value);
    }

    function validateField(input) {
        const value = input.value.trim();

        if (input.hasAttribute("required") && value === "") {
            setError(input, "This field is required.");
            return false;
        }

        if (input.type === "email" && value !== "" && !isEmailValid(value)) {
            setError(input, "Please enter a valid email address.");
            return false;
        }

        if (input.id === "reason" && value.length < 10) {
            setError(input, "Please provide a more specific reason.");
            return false;
        }

        setSuccess(input);
        return true;
    }

    function validateTerms() {
        if (!agreeTerms.checked) {
            termsError.textContent = "You must confirm the information before submitting.";
            return false;
        }

        termsError.textContent = "";
        return true;
    }

    function updateCharacterCount() {
        const length = reason.value.length;
        charCount.textContent = length;

        if (length >= 180) {
            charCount.style.color = "#ef4444";
        } else {
            charCount.style.color = "#64748b";
        }
    }

    contact.addEventListener("input", () => {
        let value = contact.value.replace(/\D/g, "");

        if (value.length > 11) {
            value = value.slice(0, 11);
        }

        if (value.length > 7) {
            contact.value = `${value.slice(0, 4)} ${value.slice(4, 7)} ${value.slice(7)}`;
        } else if (value.length > 4) {
            contact.value = `${value.slice(0, 4)} ${value.slice(4)}`;
        } else {
            contact.value = value;
        }
    });

    reason.addEventListener("input", updateCharacterCount);

    fields.forEach((field) => {
        field.addEventListener("input", () => {
            validateField(field);
            clearMessage();
        });

        field.addEventListener("change", () => {
            validateField(field);
            clearMessage();
        });
    });

    agreeTerms.addEventListener("change", () => {
        validateTerms();
        clearMessage();
    });

    form.addEventListener("submit", (event) => {
        event.preventDefault();

        let isFormValid = true;

        fields.forEach((field) => {
            const valid = validateField(field);

            if (!valid) {
                isFormValid = false;
            }
        });

        if (!validateTerms()) {
            isFormValid = false;
        }

        if (!isFormValid) {
            showMessage("error", "Please complete all required fields before submitting.");
            return;
        }

        const requestData = {
            fullName: fullName.value.trim(),
            email: email.value.trim(),
            contact: contact.value.trim(),
            position: position.value.trim(),
            section: section.value,
            role: role.value,
            reason: reason.value.trim()
        };

        console.log("Access Request Submitted:", requestData);

        showMessage(
            "success",
            "Your access request has been submitted successfully. Please wait for administrator approval."
        );

        form.reset();
        charCount.textContent = "0";
        charCount.style.color = "#64748b";
        termsError.textContent = "";

        fields.forEach(clearValidation);
    });

    clearBtn.addEventListener("click", () => {
        form.reset();
        clearMessage();
        termsError.textContent = "";
        charCount.textContent = "0";
        charCount.style.color = "#64748b";

        fields.forEach(clearValidation);
    });
});