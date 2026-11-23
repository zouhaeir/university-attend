/**
 * Phase 6 — Attendance History & Audit-Traced Editing Controller
 * Allows teachers to query historical attendance, navigate dates, filter/search,
 * and edit statuses while recording updatedAt and updatedBy metadata.
 */
import { requireAuth } from "./auth.js";
import {
  getAttendanceHistoryForTeacher,
  updateExistingAttendanceStatus,
  ATTENDANCE_STATUS
} from "./db.js";
import {
  initSidebarToggle,
  getLocalDateString,
  shiftLocalDate,
  formatTimestamp,
  escapeHtml,
  renderStatusBadge,
  showToast,
  onDomReady
} from "./utils.js";

let currentSession = null;
let loadedRecords = [];

function updateFilteredStats(records) {
  let present = 0;
  let absent = 0;
  let excused = 0;

  records.forEach((rec) => {
    if (rec.status === ATTENDANCE_STATUS.PRESENT) present += 1;
    else if (rec.status === ATTENDANCE_STATUS.ABSENT) absent += 1;
    else if (rec.status === ATTENDANCE_STATUS.EXCUSED) excused += 1;
  });

  document.getElementById("hist-stat-total").textContent = String(records.length);
  document.getElementById("hist-stat-present").textContent = String(present);
  document.getElementById("hist-stat-absent").textContent = String(absent);
  document.getElementById("hist-stat-excused").textContent = String(excused);
  document.getElementById("history-daily-summary").textContent = `${records.length} record(s)`;
}

function applyClientFiltersAndRender() {
  const statusFilter = document.getElementById("history-status-filter")?.value || "all";
  const searchTerm = (document.getElementById("history-search-input")?.value || "").trim().toLowerCase();

  const filtered = loadedRecords.filter((rec) => {
    if (statusFilter !== "all" && rec.status !== statusFilter) return false;
    if (searchTerm) {
      const idMatch = String(rec.studentId || "").toLowerCase().includes(searchTerm);
      const nameMatch = String(rec.studentName || "").toLowerCase().includes(searchTerm);
      if (!idMatch && !nameMatch) return false;
    }
    return true;
  });

  updateFilteredStats(filtered);

  const tbody = document.getElementById("history-records-tbody");
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">No attendance records match the selected filters.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((rec) => {
      const modifier = rec.updatedByName || rec.updatedByEmail || rec.updatedBy || "—";
      const modifiedAt = formatTimestamp(rec.updatedAt);

      return `
        <tr data-doc-id="${escapeHtml(rec.docId)}">
          <td><strong>${escapeHtml(rec.date)}</strong></td>
          <td>${escapeHtml(rec.studentId)}</td>
          <td>${escapeHtml(rec.studentName)}</td>
          <td>${renderStatusBadge(rec.status)}</td>
          <td>
            <div class="text-xs">${escapeHtml(modifiedAt)}</div>
            <div class="text-xs text-muted">by ${escapeHtml(modifier)}</div>
          </td>
          <td>
            <select
              class="form-select form-input-sm history-status-select"
              data-doc-id="${escapeHtml(rec.docId)}"
              aria-label="Edit status for ${escapeHtml(rec.studentName)} on ${escapeHtml(rec.date)}"
            >
              <option value="present" ${rec.status === "present" ? "selected" : ""}>Present</option>
              <option value="absent" ${rec.status === "absent" ? "selected" : ""}>Absent</option>
              <option value="excused" ${rec.status === "excused" ? "selected" : ""}>Excused</option>
            </select>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function fetchHistoryRecords() {
  if (!currentSession) return;
  const dateVal = document.getElementById("history-date-filter")?.value || "";
  const tbody = document.getElementById("history-records-tbody");
  tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading records...</td></tr>`;

  try {
    loadedRecords = await getAttendanceHistoryForTeacher(currentSession.user.uid, dateVal);
    applyClientFiltersAndRender();
  } catch (error) {
    console.error("Failed to fetch attendance history:", error);
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Failed to load history records.</td></tr>`;
    showToast("Error retrieving attendance history.", "error");
  }
}

async function handleStatusEdit(docId, newStatus) {
  const targetRecord = loadedRecords.find((r) => r.docId === docId);
  if (!targetRecord || !currentSession) return;
  if (targetRecord.status === newStatus) return;

  const previousStatus = targetRecord.status;
  targetRecord.status = newStatus;
  targetRecord.updatedAt = new Date();
  targetRecord.updatedBy = currentSession.user.uid;
  targetRecord.updatedByName = currentSession.profile.name || "";
  targetRecord.updatedByEmail = currentSession.profile.email || currentSession.user.email || "";

  applyClientFiltersAndRender();

  try {
    await updateExistingAttendanceStatus(docId, newStatus, {
      uid: currentSession.user.uid,
      name: currentSession.profile.name || "",
      email: currentSession.profile.email || currentSession.user.email || ""
    });
    showToast(`Updated ${targetRecord.studentName} (${targetRecord.date}) to ${newStatus}.`, "success");
  } catch (error) {
    console.error("Failed to update attendance record:", error);
    targetRecord.status = previousStatus;
    applyClientFiltersAndRender();
    showToast("Failed to save attendance modification.", "error");
  }
}

onDomReady(async () => {
  initSidebarToggle();

  const dateFilter = document.getElementById("history-date-filter");
  if (dateFilter) {
    dateFilter.value = getLocalDateString();
  }

  currentSession = await requireAuth("teacher");
  if (!currentSession) return;

  await fetchHistoryRecords();

  dateFilter?.addEventListener("change", fetchHistoryRecords);

  document.getElementById("clear-date-btn")?.addEventListener("click", () => {
    if (dateFilter) dateFilter.value = "";
    fetchHistoryRecords();
  });

  document.getElementById("today-day-btn")?.addEventListener("click", () => {
    if (dateFilter) dateFilter.value = getLocalDateString();
    fetchHistoryRecords();
  });

  document.getElementById("prev-day-btn")?.addEventListener("click", () => {
    const baseDate = dateFilter?.value || getLocalDateString();
    if (dateFilter) dateFilter.value = shiftLocalDate(baseDate, -1);
    fetchHistoryRecords();
  });

  document.getElementById("next-day-btn")?.addEventListener("click", () => {
    const baseDate = dateFilter?.value || getLocalDateString();
    if (dateFilter) dateFilter.value = shiftLocalDate(baseDate, 1);
    fetchHistoryRecords();
  });

  document.getElementById("history-status-filter")?.addEventListener("change", applyClientFiltersAndRender);
  document.getElementById("history-search-input")?.addEventListener("input", applyClientFiltersAndRender);

  document.getElementById("history-records-tbody")?.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLSelectElement) || !target.classList.contains("history-status-select")) return;
    handleStatusEdit(target.dataset.docId, target.value);
  });
});
