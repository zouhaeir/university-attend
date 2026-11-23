/**
 * Student Portal Controller
 * Allows any authenticated Google user to register/update their student profile
 * (Student ID, Full Name, Department, Assigned Instructor) and view their attendance history.
 */
import { requireAuth } from "./auth.js";
import {
  getActiveTeachersList,
  saveSelfRegisteredStudent,
  getAttendanceByStudentId,
  ATTENDANCE_STATUS
} from "./db.js";
import {
  initSidebarToggle,
  formatTimestamp,
  escapeHtml,
  renderStatusBadge,
  showToast
} from "./utils.js";

let currentSession = null;
let teachersList = [];

function populateTeachersDropdown(selectedUid = "", selectedEmpId = "") {
  const select = document.getElementById("stu-teacher-select");
  if (!select) return;

  select.innerHTML =
    `<option value="">Select your instructor...</option>` +
    teachersList
      .map((t) => {
        const valueKey = t.uid || t.employeeId;
        const label = `${t.name} — ${t.department || "General"} (${t.employeeId})`;
        return `<option value="${escapeHtml(valueKey)}">${escapeHtml(label)}</option>`;
      })
      .join("");

  if (selectedUid && teachersList.some((t) => t.uid === selectedUid)) {
    select.value = selectedUid;
  } else if (selectedEmpId) {
    const match = teachersList.find((t) => t.employeeId === selectedEmpId);
    if (match) select.value = match.uid || match.employeeId;
  }
}

async function loadStudentAttendance(studentId) {
  const tbody = document.getElementById("student-attendance-tbody");
  if (!studentId) return;

  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Loading attendance records...</td></tr>`;

  try {
    const records = await getAttendanceByStudentId(studentId);
    let present = 0;
    let absent = 0;
    let excused = 0;

    records.forEach((rec) => {
      if (rec.status === ATTENDANCE_STATUS.PRESENT) present += 1;
      else if (rec.status === ATTENDANCE_STATUS.ABSENT) absent += 1;
      else if (rec.status === ATTENDANCE_STATUS.EXCUSED) excused += 1;
    });

    document.getElementById("stu-stat-total").textContent = String(records.length);
    document.getElementById("stu-stat-present").textContent = String(present);
    document.getElementById("stu-stat-absent").textContent = String(absent);
    document.getElementById("stu-stat-excused").textContent = String(excused);

    if (records.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">No attendance has been recorded for your Student ID yet.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = records
      .map(
        (rec) => `
        <tr>
          <td><strong>${escapeHtml(rec.date)}</strong></td>
          <td>${escapeHtml(rec.department || "—")}</td>
          <td>${escapeHtml(rec.teacherName || rec.teacherEmployeeId || "—")}</td>
          <td>${renderStatusBadge(rec.status)}</td>
          <td class="text-xs">${escapeHtml(formatTimestamp(rec.updatedAt))}</td>
        </tr>
      `
      )
      .join("");
  } catch (error) {
    console.error("Error loading student attendance:", error);
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Unable to load attendance records.</td></tr>`;
  }
}

function applyProfileToUI(profile, user) {
  const emailEl = document.getElementById("student-google-email");
  const sidebarName = document.getElementById("sidebar-student-name");
  const sidebarId = document.getElementById("sidebar-student-id");
  const badge = document.getElementById("student-reg-badge");

  const idInput = document.getElementById("stu-id-input");
  const nameInput = document.getElementById("stu-fullname-input");
  const deptInput = document.getElementById("stu-dept-input");

  if (emailEl) emailEl.textContent = user.email || "";
  if (sidebarName) sidebarName.textContent = profile.fullName || user.displayName || "Student";
  if (nameInput) nameInput.value = profile.fullName || user.displayName || "";
  if (deptInput && profile.department) deptInput.value = profile.department;

  if (profile.studentId) {
    if (idInput) {
      idInput.value = profile.studentId;
      idInput.readOnly = true;
    }
    if (sidebarId) sidebarId.textContent = `ID: ${profile.studentId}`;
    if (badge) {
      badge.className = "badge badge-success";
      badge.textContent = "Registered Student";
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initSidebarToggle();

  currentSession = await requireAuth("student");
  if (!currentSession) return;

  const { user, profile } = currentSession;
  applyProfileToUI(profile, user);

  try {
    teachersList = await getActiveTeachersList();
    populateTeachersDropdown(profile.teacherUid || "", profile.teacherEmployeeId || "");
  } catch (error) {
    console.error("Failed to load teachers list:", error);
    showToast("Could not load instructors list. Check Firestore rules.", "error");
  }

  if (profile.studentId) {
    await loadStudentAttendance(profile.studentId);
  }

  document.getElementById("student-registration-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const saveBtn = document.getElementById("save-student-profile-btn");
    const studentId = document.getElementById("stu-id-input").value.trim();
    const fullName = document.getElementById("stu-fullname-input").value.trim();
    const department = document.getElementById("stu-dept-input").value.trim();
    const selectedTeacherKey = document.getElementById("stu-teacher-select").value;

    const matchedTeacher = teachersList.find(
      (t) => t.uid === selectedTeacherKey || t.employeeId === selectedTeacherKey
    );

    if (!matchedTeacher) {
      showToast("Please select an assigned instructor from the dropdown.", "error");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      const savedProfile = await saveSelfRegisteredStudent({
        uid: user.uid,
        email: user.email,
        studentId,
        fullName,
        department,
        teacherUid: matchedTeacher.uid || "",
        teacherEmployeeId: matchedTeacher.employeeId || "",
        teacherName: matchedTeacher.name || ""
      });

      currentSession.profile = savedProfile;
      applyProfileToUI(savedProfile, user);
      showToast("Student profile saved successfully!", "success");
      await loadStudentAttendance(savedProfile.studentId);
    } catch (error) {
      console.error("Failed to save student registration:", error);
      showToast(error.message || "Could not save your student registration.", "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Student Information";
    }
  });
});
