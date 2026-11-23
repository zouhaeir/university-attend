/**
 * Phase 3 — Authentication & Multi-Role Session Guard Module
 * Routes:
 *  - Active Admin   -> admin.html
 *  - Active Teacher -> teacher.html
 *  - Any other authenticated Google user -> student.html (self-service registration & attendance view)
 */
import {
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { auth, googleProvider, isFirebaseConfigured } from "./firebase-config.js";
import { resolveAndBindStaffProfile, getStudentProfileByAuth } from "./db.js";
import { showToast } from "./utils.js";

function showAuthAlert(message) {
  const alertEl = document.getElementById("auth-alert");
  if (!alertEl) return;
  alertEl.textContent = message;
  alertEl.classList.remove("hidden");
}

function hideAuthAlert() {
  const alertEl = document.getElementById("auth-alert");
  if (!alertEl) return;
  alertEl.textContent = "";
  alertEl.classList.add("hidden");
}

function redirectByRole(role) {
  if (role === "admin") {
    window.location.replace("./admin.html");
  } else if (role === "teacher") {
    window.location.replace("./teacher.html");
  } else {
    window.location.replace("./student.html");
  }
}

/**
 * Initiates Google Sign-In popup and routes user based on staff vs. student role.
 */
export async function loginWithGoogle() {
  if (!isFirebaseConfigured()) {
    showAuthAlert("Firebase is not configured yet. Update js/firebase-config.js with your project keys.");
    return;
  }

  const signInBtn = document.getElementById("google-signin-btn");
  const signInLabel = document.getElementById("google-signin-label");
  hideAuthAlert();

  if (signInBtn) signInBtn.disabled = true;
  if (signInLabel) signInLabel.textContent = "Signing in...";

  try {
    const credential = await signInWithPopup(auth, googleProvider);
    const user = credential.user;

    // 1. Check if the Google account belongs to a registered Admin or Teacher
    let staffProfile = null;
    try {
      staffProfile = await resolveAndBindStaffProfile(user.uid, user.email);
    } catch (lookupErr) {
      console.warn("Staff profile check returned error; falling back to student portal:", lookupErr);
    }

    if (staffProfile) {
      if (staffProfile.active !== true) {
        await signOut(auth);
        showAuthAlert(
          "Access Denied: Your institutional staff account has been deactivated. Contact your administrator."
        );
        return;
      }
      redirectByRole(staffProfile.role);
      return;
    }

    // 2. Otherwise allow any authenticated Google user into the Student Portal to register/view profile
    redirectByRole("student");
  } catch (error) {
    console.error("Google Sign-In error:", error);
    if (error.code === "auth/popup-closed-by-user") {
      showAuthAlert("Sign-in popup was closed before completing authentication.");
    } else if (error.code === "auth/popup-blocked") {
      showAuthAlert("Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.");
    } else {
      showAuthAlert(`Authentication failed: ${error.message}`);
    }
  } finally {
    if (signInBtn) signInBtn.disabled = false;
    if (signInLabel) signInLabel.textContent = "Continue with Google";
  }
}

/**
 * Route guard for protected pages (teacher.html, attendance.html, history.html, admin.html, student.html).
 * @param {"teacher"|"admin"|"student"|"any"} [requiredRole="any"]
 * @returns {Promise<{ user: object, profile: object }|null>}
 */
export function requireAuth(requiredRole = "any") {
  return new Promise((resolve) => {
    if (!isFirebaseConfigured()) {
      showToast("Configure js/firebase-config.js to connect Firebase Auth.", "error", 5000);
      resolve(null);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();

      if (!user) {
        window.location.replace("./index.html");
        resolve(null);
        return;
      }

      try {
        let staffProfile = null;
        try {
          staffProfile = await resolveAndBindStaffProfile(user.uid, user.email);
        } catch (err) {
          console.warn("Staff lookup skipped:", err);
        }

        // Handle Staff accounts (admin / teacher)
        if (staffProfile) {
          if (staffProfile.active !== true) {
            await signOut(auth);
            window.location.replace("./index.html");
            resolve(null);
            return;
          }

          if (requiredRole !== "any" && staffProfile.role !== requiredRole) {
            redirectByRole(staffProfile.role);
            resolve(null);
            return;
          }

          const sidebarName = document.getElementById("sidebar-user-name") || document.getElementById("sidebar-admin-name");
          const sidebarDept = document.getElementById("sidebar-user-dept");
          if (sidebarName) sidebarName.textContent = staffProfile.name || user.displayName || user.email;
          if (sidebarDept && staffProfile.department) sidebarDept.textContent = staffProfile.department;

          resolve({ user, profile: staffProfile });
          return;
        }

        // Handle Student accounts (any authenticated Google user not in `teachers`)
        if (requiredRole !== "any" && requiredRole !== "student") {
          redirectByRole("student");
          resolve(null);
          return;
        }

        const studentProfile = await getStudentProfileByAuth(user.uid, user.email);
        if (studentProfile && studentProfile.active === false) {
          await signOut(auth);
          window.location.replace("./index.html");
          resolve(null);
          return;
        }

        resolve({
          user,
          profile: studentProfile || {
            role: "student",
            uid: user.uid,
            email: user.email,
            fullName: user.displayName || "",
            isNewRegistration: true
          }
        });
      } catch (err) {
        console.error("Session verification error:", err);
        await signOut(auth);
        window.location.replace("./index.html");
        resolve(null);
      }
    });
  });
}

/**
 * Signs out the authenticated user and redirects to index.html.
 */
export async function logoutUser() {
  try {
    if (isFirebaseConfigured()) {
      await signOut(auth);
    }
  } finally {
    window.location.replace("./index.html");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const signInBtn = document.getElementById("google-signin-btn");
  if (signInBtn) {
    signInBtn.addEventListener("click", loginWithGoogle);

    if (isFirebaseConfigured()) {
      const unsub = onAuthStateChanged(auth, async (user) => {
        unsub();
        if (!user) return;
        try {
          const staffProfile = await resolveAndBindStaffProfile(user.uid, user.email);
          if (staffProfile) {
            if (staffProfile.active === true) redirectByRole(staffProfile.role);
            return;
          }
          redirectByRole("student");
        } catch (err) {
          console.warn("Auto-session check skipped:", err);
        }
      });
    }
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logoutUser);
  }
});
