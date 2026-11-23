/**
 * Phase 3 — Authentication & Multi-Role Session Guard Module
 * Supports:
 *  - Email & Password Sign-Up & Sign-In
 *  - Google Sign-In Popup
 *  - Role routing: Admin -> admin.html, Teacher -> teacher.html, Other users -> student.html
 */
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
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
 * Resolves whether a signed-in Firebase user is an active Admin/Teacher or should enter student.html.
 */
async function routeAuthenticatedUser(user) {
  let staffProfile = null;
  try {
    staffProfile = await resolveAndBindStaffProfile(user.uid, user.email);
  } catch (lookupErr) {
    console.warn("Staff profile lookup skipped; routing to student portal:", lookupErr);
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

  redirectByRole("student");
}

function formatAuthError(error) {
  switch (error?.code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists. Switch to the Sign In tab instead.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/weak-password":
      return "Password must be at least 6 characters long.";
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Invalid email or password.";
    case "auth/popup-closed-by-user":
      return "Sign-in popup was closed before completing authentication.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in popup. Allow popups or use Email Sign In / Sign Up.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Authentication. Add it under Authentication > Settings > Authorized domains.";
    case "auth/operation-not-allowed":
      return "Email/Password sign-in is not enabled yet in Firebase Console > Authentication > Sign-in method.";
    default:
      return error?.message || "Authentication failed.";
  }
}

/**
 * Initiates Google Sign-In popup and routes user based on role.
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
    await routeAuthenticatedUser(credential.user);
  } catch (error) {
    console.error("Google Sign-In error:", error);
    showAuthAlert(formatAuthError(error));
  } finally {
    if (signInBtn) signInBtn.disabled = false;
    if (signInLabel) signInLabel.textContent = "Continue with Google";
  }
}

/**
 * Signs in an existing user with email and password.
 */
export async function loginWithEmail(email, password) {
  if (!isFirebaseConfigured()) {
    showAuthAlert("Firebase is not configured yet. Update js/firebase-config.js with your project keys.");
    return;
  }

  const btn = document.getElementById("email-signin-btn");
  const label = document.getElementById("email-signin-label");
  hideAuthAlert();

  if (btn) btn.disabled = true;
  if (label) label.textContent = "Signing in...";

  try {
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    await routeAuthenticatedUser(credential.user);
  } catch (error) {
    console.error("Email sign-in error:", error);
    showAuthAlert(formatAuthError(error));
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = "Sign In with Email";
  }
}

/**
 * Registers a new user with full name, email, and password, then routes to student.html
 * (or staff dashboard if pre-registered by an admin).
 */
export async function signUpWithEmail(fullName, email, password) {
  if (!isFirebaseConfigured()) {
    showAuthAlert("Firebase is not configured yet. Update js/firebase-config.js with your project keys.");
    return;
  }

  const btn = document.getElementById("email-signup-btn");
  const label = document.getElementById("email-signup-label");
  hideAuthAlert();

  if (btn) btn.disabled = true;
  if (label) label.textContent = "Creating account...";

  try {
    const cleanName = String(fullName || "").trim();
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (cleanName) {
      await updateProfile(credential.user, { displayName: cleanName });
    }
    await routeAuthenticatedUser(credential.user);
  } catch (error) {
    console.error("Email sign-up error:", error);
    showAuthAlert(formatAuthError(error));
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = "Create Account with Email";
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

function setAuthTab(mode) {
  const signInTab = document.getElementById("tab-signin");
  const signUpTab = document.getElementById("tab-signup");
  const signInForm = document.getElementById("email-signin-form");
  const signUpForm = document.getElementById("email-signup-form");
  hideAuthAlert();

  const isSignUp = mode === "signup";
  signInTab?.classList.toggle("active", !isSignUp);
  signUpTab?.classList.toggle("active", isSignUp);
  signInTab?.setAttribute("aria-selected", String(!isSignUp));
  signUpTab?.setAttribute("aria-selected", String(isSignUp));

  signInForm?.classList.toggle("hidden", isSignUp);
  signUpForm?.classList.toggle("hidden", !isSignUp);
}

document.addEventListener("DOMContentLoaded", () => {
  const signInBtn = document.getElementById("google-signin-btn");
  const signInForm = document.getElementById("email-signin-form");
  const signUpForm = document.getElementById("email-signup-form");
  const tabSignIn = document.getElementById("tab-signin");
  const tabSignUp = document.getElementById("tab-signup");

  tabSignIn?.addEventListener("click", () => setAuthTab("signin"));
  tabSignUp?.addEventListener("click", () => setAuthTab("signup"));

  signInForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("signin-email")?.value || "";
    const password = document.getElementById("signin-password")?.value || "";
    await loginWithEmail(email, password);
  });

  signUpForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fullName = document.getElementById("signup-name")?.value || "";
    const email = document.getElementById("signup-email")?.value || "";
    const password = document.getElementById("signup-password")?.value || "";
    const confirmPassword = document.getElementById("signup-confirm-password")?.value || "";

    if (password !== confirmPassword) {
      showAuthAlert("Passwords do not match. Please re-enter both password fields.");
      return;
    }

    await signUpWithEmail(fullName, email, password);
  });

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
