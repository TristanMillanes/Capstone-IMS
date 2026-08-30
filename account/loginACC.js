import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

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

const loginForm = document.getElementById("loginForm");

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    // 1. Authenticate with Firebase Auth
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    // 2. Check kung ADMIN ang nag-login
    const adminSnap = await get(ref(db, `admins/${uid}`));
    if (adminSnap.exists() && adminSnap.val() === true) {
      window.location.href = "admin.html"; // Papasukin sa Admin Console
      return;
    }

    // 3. Kung Personnel/User: I-CHECK KUNG APPROVED NA NG ADMIN
    const userSnap = await get(ref(db, `users/${uid}`));
    
    if (!userSnap.exists()) {
      await signOut(auth);
      alert("Access Denied: No personnel profile found. Please submit an account access request first.");
      return;
    }

    const userData = userSnap.val();

    // 🚫 HARANG: Kung Pending pa o Declined
    if (userData.status !== "Approved") {
      await signOut(auth); // Sign out agad para walang session
      
      if (userData.status === "Pending") {
        alert("⏳ ACCESS PENDING: Your account request is still under review by the Division Head and System Administrator.");
      } else if (userData.status === "Rejected") {
        alert("❌ ACCESS DECLINED: Your request was declined. Reason: " + (userData.declineRemarks || "Verification failed."));
      } else {
        alert("⛔ Access Denied: Your account is currently inactive.");
      }
      return;
    }

    // ✅ APPROVED: Papasukin sa IMS User Portal
    alert(`Welcome back, ${userData.fullName}!`);
    window.location.href = "../User/employee.html";

  } catch (error) {
    console.error("Login Error:", error);
    alert("Login Failed: " + error.message);
  }
});