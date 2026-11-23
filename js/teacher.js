/**
 * Phase 4 — Teacher Dashboard Controller
 * Displays authenticated teacher profile, assigned students roster, and today's attendance summary.
 */
import { requireAuth } from "./auth.js";
import { getStudentsByTeacher, getAttendanceByTeacherAndDate, ATTENDANCE_STATUS } from "./db.js";
import {
  initSidebarToggle,
  getLocalDateString,
  formatDisplayDate,
  escapeHtml,
  renderStatusBadge,
  showToast,
  onDomReady
} from "./utils.js";

onDomReady(async () => {
  initSidebarToggle();

  const todayStr = getLocalDateString();
  const dateLabel = document.getElementById("current-date-label");
  if (dateLabel) {
    dateLabel.textContent = formatDisplayDate(todayStr);
  }

  const session = await requireAuth("teacher");
  if (!session) return;

  const { user, profile } = session;

  // Populate teacher profile banner
  document.getElementById("teacher-name").textContent = profile.name || user.displayName || "Instructor";
  document.getElementById("teacher-email").textContent = profile.email || user.email || "—";
  document.getElementById("teacher-department").textContent = profile.department || "Unassigned";
  document.getElementById("teacher-employee-id").textContent = profile.employeeId || "—";

  try {
    const [students, todayAttendanceMap] = await Promise.all([
      getStudentsByTeacher(user.uid, profile.employeeId || ''),
      getAttendanceByTeacherAndDate(user.uid, todayStr)
    ]);

    let presentCount = 0;
    let absentCount = 0;
    let excusedCount = 0;

    students.forEach((student) => {
      const rec = todayAttendanceMap.get(String(student.studentId));
      if (!rec) return;
      if (rec.status === ATTENDANCE_STATUS.PRESENT) presentCount += 1;
      else if (rec.status === ATTENDANCE_STATUS.ABSENT) absentCount += 1;
      else if (rec.status === ATTENDANCE_STATUS.EXCUSED) excusedCount += 1;
    });

    document.getElementById("stat-total-students").textContent = String(students.length);
    document.getElementById("stat-present-today").textContent = String(presentCount);
    document.getElementById("stat-absent-today").textContent = String(absentCount);
    document.getElementById("stat-excused-today").textContent = String(excusedCount);

    const tbody = document.getElementById("teacher-students-tbody");
    if (students.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="empty-state">
            No students are currently assigned to your account. Contact your administrator if this is unexpected.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = students
      .map((student) => {
        const record = todayAttendanceMap.get(String(student.studentId));
        const status = record ? record.status : null;
        return `
          <tr>
            <td><strong>${escapeHtml(student.studentId)}</strong></td>
            <td>${escapeHtml(student.fullName)}</td>
            <td>${escapeHtml(student.department || profile.department)}</td>
            <td>${renderStatusBadge(status)}</td>
          </tr>
        `;
      })
      .join("");
  } catch (error) {
    console.error("Failed to load teacher dashboard:", error);
    showToast("Could not load dashboard data. Please check your connection.", "error");
  }
});
