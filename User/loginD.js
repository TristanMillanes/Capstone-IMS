// firebase-auth.js
// Firebase Authentication only
// User account and Admin account are both from Firebase Authentication

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    sendEmailVerification,
    sendPasswordResetEmail,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";


// ===============================
// FIREBASE CONFIGURATION
// ===============================

const firebaseConfig = {
    apiKey: "AIzaSyAwiRrYub7tl1EXwehKbsCjfwQiyGKxiyE",
    authDomain: "ims-capstone-bc65f.firebaseapp.com",
    projectId: "ims-capstone-bc65f",
    storageBucket: "ims-capstone-bc65f.firebasestorage.app",
    messagingSenderId: "972207120140",
    appId: "1:972207120140:web:6a94e2e1e9e8511e933329",
    measurementId: "G-W4TPE7CHC8"
};


// ===============================
// INITIALIZE FIREBASE AUTH
// ===============================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);


// ===============================
// DASHBOARD DIRECTORIES
// ===============================

const USER_DASHBOARD = "/User/Homepage.html";
const ADMIN_DASHBOARD = "/admin/admin.html";
const VISITOR_LOG = "/VisitorsLog/visitorsLogin.html";


// ===============================
// ACCOUNTS FROM FIREBASE AUTHENTICATION
// ===============================
// Firebase Console > Authentication > Users > click account > copy User UID

const adminUIDs = [
    "AzmcZqsID3gSUknToqULfoyOcy92" 
];

const visitorsUIDs = [
    "RLx9coBxScOJ7CLq1CeDQbz6vvD2"
];

// ===============================
// MESSAGE FUNCTION
// ===============================

function showMessage(message, type = "success") {
    const messageBox = document.getElementById("messageBox");

    if (messageBox) {
        messageBox.textContent = message;
        messageBox.className = `message-box ${type}`;
        messageBox.style.display = "block";
    } else {
        alert(message);
    }
}


// ===============================
// ERROR MESSAGE HANDLER
// ===============================

function getAuthErrorMessage(errorCode) {
    switch (errorCode) {
        case "auth/invalid-email":
            return "Invalid email address.";

        case "auth/user-not-found":
            return "No account found with this email.";

        case "auth/wrong-password":
            return "Incorrect password.";

        case "auth/invalid-credential":
            return "Invalid email or password.";

        case "auth/email-already-in-use":
            return "This email is already registered.";

        case "auth/weak-password":
            return "Password must be at least 6 characters.";

        case "auth/too-many-requests":
            return "Too many attempts. Please try again later.";

        default:
            return "Authentication failed. Please try again.";
    }
}


// ===============================
// LOGIN AUTHENTICATION
// ===============================
// One login form for both user and admin.
// The dashboard depends on the Firebase Authentication account UID.

const loginForm = document.getElementById("loginForm");

if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const emailInput = document.getElementById("email");
        const passwordInput = document.getElementById("password");
        const rememberMe = document.getElementById("rememberMe");
        const loginBtn = document.getElementById("loginBtn");
        const loginText = document.getElementById("loginText");

        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();

        if (email === "" || password === "") {
            showMessage("Please enter your email and password.", "error");
            return;
        }

        try {
            if (loginBtn) loginBtn.disabled = true;
            if (loginText) loginText.textContent = "Signing in...";

            if (rememberMe && rememberMe.checked) {
                await setPersistence(auth, browserLocalPersistence);
            } else {
                await setPersistence(auth, browserSessionPersistence);
            }

            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // ---- FIX APPLIED HERE ----
            if (adminUIDs.includes(user.uid)) {
                showMessage("Admin login successful. Redirecting...", "success");

                setTimeout(() => {
                    window.location.href = ADMIN_DASHBOARD;
                }, 1200);

            } else if (visitorsUIDs.includes(user.uid)) {
                showMessage("Visitor login successful. Redirecting...", "success");

                setTimeout(() => {
                    window.location.href = VISITOR_LOG;
                }, 1200);

            } else {
                showMessage("User login successful. Redirecting...", "success");

                setTimeout(() => {
                    window.location.href = USER_DASHBOARD;
                }, 1200);
            }
            // --------------------------

        } catch (error) {
            showMessage(getAuthErrorMessage(error.code), "error");

        } finally {
            if (loginBtn) loginBtn.disabled = false;
            if (loginText) loginText.textContent = "Sign In";
        }
    });
}


// ===============================
// REQUEST ACCOUNT AUTHENTICATION
// ===============================
// This creates a normal user account only.
// Admin account should be manually created in Firebase Authentication.

const requestAccountForm = document.getElementById("requestAccountForm");

if (requestAccountForm) {
    requestAccountForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const fullNameInput = document.getElementById("fullName");
        const emailInput = document.getElementById("email");
        const passwordInput = document.getElementById("password");
        const confirmPasswordInput = document.getElementById("confirmPassword");
        const requestBtn = document.getElementById("requestBtn");
        const requestText = document.getElementById("requestText");

        const fullName = fullNameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();

        if (fullName === "" || email === "" || password === "" || confirmPassword === "") {
            showMessage("Please complete all required fields.", "error");
            return;
        }

        if (password.length < 6) {
            showMessage("Password must be at least 6 characters.", "error");
            return;
        }

        if (password !== confirmPassword) {
            showMessage("Passwords do not match.", "error");
            return;
        }

        try {
            if (requestBtn) requestBtn.disabled = true;
            if (requestText) requestText.textContent = "Creating account...";

            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            await updateProfile(user, {
                displayName: fullName
            });

            await sendEmailVerification(user);

            showMessage(
                "Account created successfully. Please verify your email before logging in.",
                "success"
            );

            requestAccountForm.reset();

            await signOut(auth);

            setTimeout(() => {
                window.location.href = "/User/login.html";
            }, 1800);

        } catch (error) {
            showMessage(getAuthErrorMessage(error.code), "error");

        } finally {
            if (requestBtn) requestBtn.disabled = false;
            if (requestText) requestText.textContent = "Request Account";
        }
    });
}


// ===============================
// FORGOT PASSWORD
// ===============================

const forgotLink = document.querySelector(".forgot-link");

if (forgotLink) {
    forgotLink.addEventListener("click", async (event) => {
        event.preventDefault();

        const emailInput = document.getElementById("email");
        const email = emailInput.value.trim();

        if (email === "") {
            showMessage("Enter your email first to reset your password.", "error");
            return;
        }

        try {
            await sendPasswordResetEmail(auth, email);
            showMessage("Password reset link sent to your email.", "success");

        } catch (error) {
            showMessage(getAuthErrorMessage(error.code), "error");
        }
    });
}