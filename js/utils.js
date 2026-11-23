/**
 * Shared Utility Functions
 * Handles local timezone date formatting, deterministic IDs, XSS sanitization,
 * mobile sidebar behavior, status badges, and toast notifications.
 */

/**
 * Formats a Date object as YYYY-MM-DD in the user's LOCAL timezone.
 * Avoids UTC midnight rollover bugs caused by Date.prototype.toISOString().
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Shifts a YYYY-MM-DD local date string by N days.
 * @param {string} dateStr
 * @param {number} offsetDays
 * @returns {string}
 */
export function shiftLocalDate(dateStr, offsetDays) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day + offsetDays);
  return getLocalDateString(d);
}

/**
 * Formats a YYYY-MM-DD date string into a readable local date label.
 * @param {string} dateStr
 * @returns {string}
 */
export function formatDisplayDate(dateStr) {
  if (!dateStr) return "—";
  const [year, month, day] = dateStr.split("-").map(Number);
  const localDate = new Date(year, month - 1, day);
  return localDate.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

/**
 * Formats a Firestore Timestamp, ISO string, or Date into a concise local timestamp.
 * @param {any} ts
 * @returns {string}
 */
export function formatTimestamp(ts) {
  if (!ts) return "—";
  const dateObj = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  if (Number.isNaN(dateObj.getTime())) return "—";
  return dateObj.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * Builds the deterministic Firestore document ID for daily student attendance.
 * Format: {YYYY-MM-DD}_{studentId}
 * @param {string} dateStr
 * @param {string} studentId
 * @returns {string}
 */
export function makeAttendanceDocId(dateStr, studentId) {
  return `${String(dateStr).trim()}_${String(studentId).trim()}`;
}

/**
 * Escapes HTML special characters to prevent XSS when rendering Firestore strings.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Returns a semantic HTML badge string for an attendance status.
 * @param {string|null|undefined} status
 * @returns {string}
 */
export function renderStatusBadge(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "present") {
    return `<span class="badge badge-success">Present</span>`;
  }
  if (normalized === "absent") {
    return `<span class="badge badge-danger">Absent</span>`;
  }
  if (normalized === "excused") {
    return `<span class="badge badge-warning">Excused</span>`;
  }
  return `<span class="badge badge-neutral">Unmarked</span>`;
}

/**
 * Displays a non-blocking toast notification.
 * @param {string} message
 * @param {"default"|"success"|"error"} [type="default"]
 * @param {number} [durationMs=3200]
 */
export function showToast(message, type = "default", durationMs = 3200) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type !== "default" ? `toast-${type}` : ""}`.trim();
  toast.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, durationMs);
}

/**
 * Initializes mobile drawer sidebar toggle and backdrop click handling.
 */
export function initSidebarToggle() {
  const sidebar = document.getElementById("app-sidebar");
  const toggleBtn = document.getElementById("sidebar-toggle");
  const backdrop = document.getElementById("sidebar-backdrop");

  if (!sidebar || !toggleBtn || !backdrop) return;

  const closeSidebar = () => {
    sidebar.classList.remove("open");
    backdrop.classList.remove("open");
  };

  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    backdrop.classList.toggle("open");
  });

  backdrop.addEventListener("click", closeSidebar);
}
