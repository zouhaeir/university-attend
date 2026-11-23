/**
 * Phase 5 — Daily Student Attendance Checklist Controller
 * Loads assigned students, enforces single-status selection per student,
 * auto-saves changes to Firestore, and updates live daily statistics.
 */
import { requireAuth } from "./auth.js";
import {
  getStudentsByTeacher,
  getAttendanceByTeacherAndDate,
  saveAttendanceRecord,
  ATTENDANCE_STATUS
} from "./db.js";
import {
  initSidebarToggle,
  getLocalDateString,
  formatDisplayDate,
  escapeHtml,
  showToast,
  onDomReady
} from "./utils.js";

let currentSession = null;
let assignedStudents = [];
let attendanceByStudentId = new Map();

function setSaveIndicator(state, text) {
  const indicator = document.getElementById("save-status-indicator");
  if (!indicator) return;
  indicator.className = "badge";
  if (state === "saving") indicator.classList.add("badge-info");
  else if (state === "saved") indicator.classList.add("badge-success");
  else if (state === "error") indicator.classList.add("badge-danger");
  else indicator.classList.add("badge-neutral");
  indicator.textContent = text;
}

function updateSummaryCounts() {
  let present = 0;
  let absent = 0;
  let excused = 0;

  assignedStudents.forEach((student) => {
    const rec = attendanceByStudentId.get(String(student.studentId));
    if (!rec) return;
    if (rec.status === ATTENDANCE_STATUS.PRESENT) present += 1;
    else if (rec.status === ATTENDANCE_STATUS.ABSENT) absent += 1;
    else if (rec.status === ATTENDANCE_STATUS.EXCUSED) excused += 1;
  });

  const unmarked = Math.max(0, assignedStudents.length - (present + absent + excused));

  document.getElementById("count-present").textContent = String(present);
  document.getElementById("count-absent").textContent = String(absent);
  document.getElementById("count-excused").textContent = String(excused);
  document.getElementById("count-unmarked").textContent = String(unmarked);
}

function renderChecklistTable(searchTerm = "") {
  const tbody = document.getElementById("attendance-checklist-tbody");
  const term = searchTerm.trim().toLowerCase();

  const filtered = assignedStudents.filter((s) => {
    if (!term) return true;
    return (
      String(s.studentId).toLowerCase().includes(term) ||
      String(s.fullName).toLowerCase().includes(term)
    );
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          ${assignedStudents.length === 0 ? "No students assigned to your account." : "No students match your filter."}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((student) => {
      const sid = String(student.studentId);
      const record = attendanceByStudentId.get(sid);
      const status = record ? record.status : "";
      const rowClass = status ? `row-${status}` : "";

      return `
        <tr data-student-id="${escapeHtml(sid)}" class="${rowClass}">
          <td><strong>${escapeHtml(sid)}</strong></td>
          <td>${escapeHtml(student.fullName)}</td>
          <td class="text-center">
            <input
              type="checkbox"
              aria-label="Mark ${escapeHtml(student.fullName)} Present"
              data-student-id="${escapeHtml(sid)}"
              data-status="present"
              ${status === ATTENDANCE_STATUS.PRESENT ? "checked" : ""}
            />
          </td>
          <td class="text-center">
            <input
              type="checkbox"
              aria-label="Mark ${escapeHtml(student.fullName)} Absent"
              data-student-id="${escapeHtml(sid)}"
              data-status="absent"
              ${status === ATTENDANCE_STATUS.ABSENT ? "checked" : ""}
            />
          </td>
          <td class="text-center">
            <input
              type="checkbox"
              aria-label="Mark ${escapeHtml(student.fullName)} Excused"
              data-student-id="${escapeHtml(sid)}"
              data-status="excused"
              ${status === ATTENDANCE_STATUS.EXCUSED ? "checked" : ""}
            />
          </td>
        </tr>
      `;
    })
    .join("");
}

async function loadAttendanceForDate(dateStr) {
  if (!currentSession || !dateStr) return;

  const subtitle = document.getElementById("checklist-date-subtitle");
  if (subtitle) {
    subtitle.textContent = `Recording attendance for ${formatDisplayDate(dateStr)} (${dateStr})`;
  }

  setSaveIndicator("saving", "Loading...");
  try {
    attendanceByStudentId = await getAttendanceByTeacherAndDate(currentSession.user.uid, dateStr);
    updateSummaryCounts();
    const searchVal = document.getElementById("attendance-search-input")?.value || "";
    renderChecklistTable(searchVal);
    setSaveIndicator("neutral", "Ready");
  } catch (error) {
    console.error("Error loading date attendance:", error);
    setSaveIndicator("error", "Load Error");
    showToast("Failed to load attendance for the selected date.", "error");
  }
}

async function handleStatusSelection(studentId, selectedStatus) {
  const datePicker = document.getElementById("attendance-date-picker");
  const dateStr = datePicker?.value || getLocalDateString();
  const student = assignedStudents.find((s) => String(s.studentId) === String(studentId));
  if (!student || !currentSession) return;

  const previousRecord = attendanceByStudentId.get(String(studentId)) || null;

  // Optimistic UI update
  attendanceByStudentId.set(String(studentId), {
    ...(previousRecord || {}),
    studentId: String(student.studentId),
    studentName: student.fullName,
    date: dateStr,
    status: selectedStatus
  });

  const searchVal = document.getElementById("attendance-search-input")?.value || "";
  renderChecklistTable(searchVal);
  updateSummaryCounts();
  setSaveIndicator("saving", "Saving...");

  try {
    const saved = await saveAttendanceRecord({
      studentId: student.studentId,
      studentName: student.fullName,
      teacherUid: currentSession.user.uid,
      teacherEmployeeId: currentSession.profile.employeeId || "",
      teacherName: currentSession.profile.name || "",
      department: student.department || currentSession.profile.department || "",
      date: dateStr,
      status: selectedStatus,
      updatedBy: currentSession.user.uid,
      updatedByName: currentSession.profile.name || "",
      updatedByEmail: currentSession.profile.email || currentSession.user.email || ""
    });

    attendanceByStudentId.set(String(studentId), saved);
    setSaveIndicator("saved", "Saved");
  } catch (error) {
    console.error("Auto-save error:", error);
    // Revert optimistic update on error
    if (previousRecord) {
      attendanceByStudentId.set(String(studentId), previousRecord);
    } else {
      attendanceByStudentId.delete(String(studentId));
    }
    renderChecklistTable(searchVal);
    updateSummaryCounts();
    setSaveIndicator("error", "Save Failed");
    showToast(`Failed to save attendance for ${student.fullName}.`, "error");
  }
}

async function handleMarkAllPresent() {
  if (assignedStudents.length === 0) return;
  const dateStr = document.getElementById("attendance-date-picker")?.value || getLocalDateString();

  setSaveIndicator("saving", "Saving all...");
  try {
    await Promise.all(
      assignedStudents.map((student) =>
        saveAttendanceRecord({
          studentId: student.studentId,
          studentName: student.fullName,
          teacherUid: currentSession.user.uid,
          teacherEmployeeId: currentSession.profile.employeeId || "",
          teacherName: currentSession.profile.name || "",
          department: student.department || currentSession.profile.department || "",
          date: dateStr,
          status: ATTENDANCE_STATUS.PRESENT,
          updatedBy: currentSession.user.uid,
          updatedByName: currentSession.profile.name || "",
          updatedByEmail: currentSession.profile.email || currentSession.user.email || ""
        }).then((saved) => {
          attendanceByStudentId.set(String(student.studentId), saved);
        })
      )
    );

    const searchVal = document.getElementById("attendance-search-input")?.value || "";
    renderChecklistTable(searchVal);
    updateSummaryCounts();
    setSaveIndicator("saved", "All Saved");
    showToast(`Marked all ${assignedStudents.length} students Present for ${dateStr}.`, "success");
  } catch (error) {
    console.error("Bulk mark present failed:", error);
    setSaveIndicator("error", "Save Failed");
    showToast("Error marking all students present.", "error");
  }
}

onDomReady(async () => {
  initSidebarToggle();

  const datePicker = document.getElementById("attendance-date-picker");
  const todayStr = getLocalDateString();
  if (datePicker) {
    datePicker.value = todayStr;
  }

  currentSession = await requireAuth("teacher");
  if (!currentSession) return;

  const teacherNameEl = document.getElementById("attendance-teacher-name");
  if (teacherNameEl) {
    teacherNameEl.textContent = currentSession.profile.name || currentSession.user.email;
  }

  try {
    assignedStudents = await getStudentsByTeacher(currentSession.user.uid, currentSession.profile.employeeId || '');
    await loadAttendanceForDate(datePicker.value);
  } catch (error) {
    console.error("Checklist initialization failed:", error);
    showToast("Unable to load assigned students.", "error");
  }

  datePicker?.addEventListener("change", (e) => {
    if (e.target.value) {
      loadAttendanceForDate(e.target.value);
    }
  });

  document.getElementById("attendance-search-input")?.addEventListener("input", (e) => {
    renderChecklistTable(e.target.value);
  });

  document.getElementById("attendance-checklist-tbody")?.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;

    const studentId = target.dataset.studentId;
    const status = target.dataset.status;
    if (!studentId || !status) return;

    // Enforce exactly one selected status per student (clicking an already active box keeps it selected)
    if (!target.checked) {
      target.checked = true;
      return;
    }

    handleStatusSelection(studentId, status);
  });

  document.getElementById("mark-all-present-btn")?.addEventListener("click", handleMarkAllPresent);
});
