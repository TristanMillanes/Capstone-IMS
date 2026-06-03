// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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

// Initialize Firebase (compat). Expose the Realtime Database instance as `window.firebaseDB`.
// Make sure the page includes the Firebase SDK scripts (firebase-app-compat.js and firebase-database-compat.js)
if (typeof firebase !== 'undefined') {
  try {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    window.firebaseDB = firebase.database();
    console.log('Firebase Realtime Database initialized');
  } catch (e) {
    console.warn('Firebase initialization error:', e);
  }
} else {
  console.warn('Firebase SDK not loaded. Include firebase-app-compat.js and firebase-database-compat.js on the page.');
}
