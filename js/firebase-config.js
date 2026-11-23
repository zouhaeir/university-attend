/**
 * Centralized Firebase Configuration & SDK Initialization
 * Single source of truth for Firebase App, Auth, and Firestore instances.
 * Never duplicate initializeApp() in other modules.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// Replace placeholder values with your Firebase Web App configuration
const firebaseConfig = {
  apiKey: "AIzaSyBBqbvHWs1UxkrInclRaJGXNuxfHneusYw",
  authDomain: "university-attendance-279da.firebaseapp.com",
  projectId: "university-attendance-279da",
  storageBucket: "university-attendance-279da.firebasestorage.app",
  messagingSenderId: "690954611530",
  appId: "1:690954611530:web:caca11d35fd0ba50c8afb3",
  measurementId: "G-82Q5MRN88T"
};

/**
 * Checks whether real Firebase credentials have been configured.
 * @returns {boolean}
 */
export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.startsWith("YOUR_") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.startsWith("YOUR_")
  );
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Prompt account selection so shared university devices don't auto-login the wrong user
googleProvider.setCustomParameters({
  prompt: "select_account"
});

export { app, auth, db, googleProvider };
