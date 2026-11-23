/**
 * Phases 7 & 8 — Administrator Dashboard & SheetJS Excel Import/Export Controller
 * Manages system-wide KPIs, teachers & students directories, attendance audit logs,
 * validated Excel bulk imports, and formatted Excel report exports.
 */
import { requireAuth } from "./auth.js";
import {
  getAllTeachers,
  getAllStudents,
  getAllAttendanceRecords,
  upsertTeacherRecord,
  bulkImportTeachers,
  bulkImportStudents,
  ATTENDANCE_STATUS
} from "./db.js";
import {
  initSidebarToggle,
  getLocalDateString,
  formatTimestamp,
  escapeHtml,
  renderStatusBadge,
  showToast
} from "./utils.js";

let currentSession = null;
let allTeachers = [];
let allStudents = [];
let allAttendance = [];
let sortDateAsc = false;
let stagedImport = { type: "teachers", validRows: [] };

/* ============================================================================
   PHASE 7: ADMINISTRATOR DASHBOARD & FILTERING
   ============================================================================ */

function populateDropdownFilters() {
  const deptSelect = document.getElementById("admin-filter-dept");
  const teacherSelect = document.getElementById("admin-filter-teacher");

  const departments = new Set();
  allTeachers.forEach((t) => t.department && departments.add(t.department));
  allStudents.forEach((s) => s.department && departments.add(s.department));

  const currentDept = deptSelect.value;
  deptSelect.innerHTML = `<option value="all">All Departments</option>` +
    Array.from(departments)
      .sort()
      .map((dept) => `<option value="${escapeHtml(dept)}">${escapeHtml(dept)}</option>`)
      .join("");
  if (Array.from(departments).includes(currentDept)) deptSelect.value = currentDept;

  const currentTeacher = teacherSelect.value;
  teacherSelect.innerHTML = `<option value="all">All Teachers</option>` +
    allTeachers
      .filter((t) => t.role !== "admin")
      .map(
        (t) =>
          `<option value="${escapeHtml(t.uid || t.employeeId)}">${escapeHtml(t.name)} (${escapeHtml(t.employeeId)})</option>`
      )
      .join("");
  teacherSelect.value = currentTeacher || "all";
}

function getTeacherLookupMap() {
  const map = new Map();
  allTeachers.forEach((t) => {
    if (t.uid) map.set(String(t.uid), t);
    if (t.employeeId) map.set(String(t.employeeId), t);
  });
  return map;
}

function getFilteredRecords() {
  const deptFilter = document.getElementById("admin-filter-dept")?.value || "all";
  const teacherFilter = document.getElementById("admin-filter-teacher")?.value || "all";
  const statusFilter = document.getElementById("admin-filter-status")?.value || "all";
  const searchTerm = (document.getElementById("admin-search-input")?.value || "").trim().toLowerCase();

  const teacherMap = getTeacherLookupMap();

  const filtered = allAttendance.filter((rec) => {
    const teacherObj = teacherMap.get(String(rec.teacherUid)) || teacherMap.get(String(rec.teacherEmployeeId));
    const resolvedDept = rec.department || teacherObj?.department || "";

    if (deptFilter !== "all" && resolvedDept !== deptFilter) return false;
    if (
      teacherFilter !== "all" &&
      String(rec.teacherUid) !== teacherFilter &&
      String(rec.teacherEmployeeId) !== teacherFilter
    ) {
      return false;
    }
    if (statusFilter !== "all" && rec.status !== statusFilter) return false;

    if (searchTerm) {
      const teacherName = (rec.teacherName || teacherObj?.name || "").toLowerCase();
      const studentName = String(rec.studentName || "").toLowerCase();
      const studentId = String(rec.studentId || "").toLowerCase();
      if (!teacherName.includes(searchTerm) && !studentName.includes(searchTerm) && !studentId.includes(searchTerm)) {
        return false;
      }
    }
    return true;
  });

  return filtered.sort((a, b) => {
    const cmp = String(a.date).localeCompare(String(b.date));
    return sortDateAsc ? cmp : -cmp;
  });
}

function renderKPIs(filteredRecords) {
  const activeTeachersCount = allTeachers.filter((t) => t.active !== false && t.role !== "admin").length;
  const activeStudentsCount = allStudents.filter((s) => s.active !== false).length;

  let present = 0;
  let absent = 0;
  let excused = 0;

  filteredRecords.forEach((rec) => {
    if (rec.status === ATTENDANCE_STATUS.PRESENT) present += 1;
    else if (rec.status === ATTENDANCE_STATUS.ABSENT) absent += 1;
    else if (rec.status === ATTENDANCE_STATUS.EXCUSED) excused += 1;
  });

  const selectedDate = document.getElementById("admin-date-selector")?.value || "";
  const completionPct =
    selectedDate && activeStudentsCount > 0
      ? Math.min(100, Math.round((filteredRecords.length / activeStudentsCount) * 100))
      : activeStudentsCount > 0 && filteredRecords.length > 0
      ? 100
      : 0;

  document.getElementById("admin-stat-teachers").textContent = String(activeTeachersCount);
  document.getElementById("admin-stat-students").textContent = String(activeStudentsCount);
  document.getElementById("admin-stat-present").textContent = String(present);
  document.getElementById("admin-stat-absent").textContent = String(absent);
  document.getElementById("admin-stat-excused").textContent = String(excused);
  document.getElementById("admin-stat-completion").textContent = `${completionPct}%`;
}

function renderAttendanceTable(records) {
  const tbody = document.getElementById("admin-records-tbody");
  const countEl = document.getElementById("admin-records-count");
  if (countEl) countEl.textContent = `${records.length} record(s)`;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No attendance records match the current filters.</td></tr>`;
    return;
  }

  const teacherMap = getTeacherLookupMap();

  tbody.innerHTML = records
    .map((rec) => {
      const teacherObj = teacherMap.get(String(rec.teacherUid)) || teacherMap.get(String(rec.teacherEmployeeId));
      const teacherDisplay = rec.teacherName || teacherObj?.name || rec.teacherEmployeeId || rec.teacherUid || "—";
      const deptDisplay = rec.department || teacherObj?.department || "—";
      const editorDisplay = rec.updatedByName || rec.updatedByEmail || rec.updatedBy || "—";

      return `
        <tr>
          <td><strong>${escapeHtml(rec.date)}</strong></td>
          <td>${escapeHtml(rec.studentId)}</td>
          <td>${escapeHtml(rec.studentName)}</td>
          <td>${escapeHtml(deptDisplay)}</td>
          <td>${escapeHtml(teacherDisplay)}</td>
          <td>${renderStatusBadge(rec.status)}</td>
          <td class="text-xs">${escapeHtml(formatTimestamp(rec.updatedAt))}</td>
          <td class="text-xs">${escapeHtml(editorDisplay)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderTeachersDirectory() {
  const tbody = document.getElementById("admin-teachers-tbody");
  const countEl = document.getElementById("admin-teachers-count");
  const deptFilter = document.getElementById("admin-filter-dept")?.value || "all";
  const searchTerm = (document.getElementById("admin-search-input")?.value || "").trim().toLowerCase();

  const filtered = allTeachers.filter((t) => {
    if (deptFilter !== "all" && t.department !== deptFilter) return false;
    if (searchTerm) {
      const hay = `${t.employeeId} ${t.name} ${t.email} ${t.department}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    return true;
  });

  if (countEl) countEl.textContent = `${filtered.length} staff member(s)`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No teachers found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((t) => {
      const uidBadge = t.uid
        ? `<span class="badge badge-success" title="${escapeHtml(t.uid)}">Linked</span>`
        : `<span class="badge badge-warning">Awaiting First Login</span>`;
      const activeBadge =
        t.active !== false
          ? `<span class="badge badge-info">Active</span>`
          : `<span class="badge badge-danger">Inactive</span>`;

      return `
        <tr>
          <td><strong>${escapeHtml(t.employeeId || "—")}</strong></td>
          <td>${escapeHtml(t.name)}</td>
          <td>${escapeHtml(t.email)}</td>
          <td>${escapeHtml(t.department || "—")}</td>
          <td><span class="badge badge-neutral">${escapeHtml(t.role || "teacher")}</span></td>
          <td>${uidBadge}</td>
          <td>${activeBadge}</td>
        </tr>
      `;
    })
    .join("");
}

function renderStudentsDirectory() {
  const tbody = document.getElementById("admin-students-tbody");
  const countEl = document.getElementById("admin-students-count");
  const deptFilter = document.getElementById("admin-filter-dept")?.value || "all";
  const teacherFilter = document.getElementById("admin-filter-teacher")?.value || "all";
  const searchTerm = (document.getElementById("admin-search-input")?.value || "").trim().toLowerCase();

  const teacherMap = getTeacherLookupMap();

  const filtered = allStudents.filter((s) => {
    if (deptFilter !== "all" && s.department !== deptFilter) return false;
    if (
      teacherFilter !== "all" &&
      String(s.teacherUid) !== teacherFilter &&
      String(s.teacherEmployeeId) !== teacherFilter
    ) {
      return false;
    }
    if (searchTerm) {
      const hay = `${s.studentId} ${s.fullName} ${s.department} ${s.teacherEmployeeId}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    return true;
  });

  if (countEl) countEl.textContent = `${filtered.length} student(s)`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No students found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((s) => {
      const teacherObj = teacherMap.get(String(s.teacherUid)) || teacherMap.get(String(s.teacherEmployeeId));
      const teacherName = teacherObj ? teacherObj.name : "Unassigned";
      const statusBadge =
        s.active !== false
          ? `<span class="badge badge-success">Active</span>`
          : `<span class="badge badge-danger">Inactive</span>`;

      return `
        <tr>
          <td><strong>${escapeHtml(s.studentId)}</strong></td>
          <td>${escapeHtml(s.fullName)}</td>
          <td>${escapeHtml(s.department || "—")}</td>
          <td>${escapeHtml(s.teacherEmployeeId || "—")}</td>
          <td>${escapeHtml(teacherName)}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    })
    .join("");
}

function refreshAllViews() {
  const filteredAttendance = getFilteredRecords();
  renderKPIs(filteredAttendance);
  renderAttendanceTable(filteredAttendance);
  renderTeachersDirectory();
  renderStudentsDirectory();
}

async function loadAdminData() {
  const dateFilter = document.getElementById("admin-date-selector")?.value || "";
  try {
    const [teachers, students, attendance] = await Promise.all([
      getAllTeachers(),
      getAllStudents(),
      getAllAttendanceRecords(dateFilter)
    ]);
    allTeachers = teachers;
    allStudents = students;
    allAttendance = attendance;
    populateDropdownFilters();
    refreshAllViews();
  } catch (error) {
    console.error("Failed to load admin data:", error);
    showToast("Error loading administrator datasets from Firestore.", "error");
  }
}

/* ============================================================================
   PHASE 8: EXCEL IMPORT & EXPORT (SheetJS / XLSX)
   ============================================================================ */

function ensureSheetJS() {
  if (typeof window.XLSX === "undefined") {
    showToast("SheetJS (XLSX) library failed to load. Check internet connectivity.", "error");
    return false;
  }
  return true;
}

function normalizeColumnKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function downloadExcelWorkbook(rows, sheetName, filename) {
  if (!ensureSheetJS()) return;
  const worksheet = window.XLSX.utils.json_to_sheet(rows);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  window.XLSX.writeFile(workbook, filename);
}

function handleExcelFileSelection(file) {
  if (!file || !ensureSheetJS()) return;

  const importType = document.getElementById("excel-import-type").value;
  const allowOverwrite = document.getElementById("excel-overwrite-checkbox").checked;
  const errorsBox = document.getElementById("excel-validation-errors");
  const previewContainer = document.getElementById("excel-preview-container");

  errorsBox.classList.add("hidden");
  previewContainer.classList.add("hidden");

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const workbook = window.XLSX.read(evt.target.result, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = window.XLSX.utils.sheet_to_json(firstSheet, { defval: "" });

      if (rawRows.length === 0) {
        errorsBox.textContent = "The uploaded spreadsheet is empty.";
        errorsBox.classList.remove("hidden");
        return;
      }

      const errors = [];
      const validRows = [];

      if (importType === "teachers") {
        const seenIds = new Set();
        const seenEmails = new Set();
        const existingByEmpId = new Map(allTeachers.map((t) => [String(t.employeeId).toLowerCase(), t]));
        const existingByEmail = new Map(allTeachers.map((t) => [String(t.email).toLowerCase(), t]));

        rawRows.forEach((raw, idx) => {
          const rowNum = idx + 2;
          const mapped = {};
          Object.entries(raw).forEach(([k, v]) => {
            mapped[normalizeColumnKey(k)] = String(v).trim();
          });

          const employeeId = mapped.teacherid || mapped.id || "";
          const name = mapped.teachername || mapped.name || mapped.fullname || "";
          const email = (mapped.email || "").toLowerCase();
          const department = mapped.department || "";

          if (!employeeId || !name || !email || !department) {
            errors.push(`Row ${rowNum}: Missing required column (Teacher ID, Teacher Name, Email, Department).`);
            return;
          }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            errors.push(`Row ${rowNum}: Invalid email format "${email}".`);
            return;
          }
          if (seenIds.has(employeeId.toLowerCase()) || seenEmails.has(email)) {
            errors.push(`Row ${rowNum}: Duplicate Teacher ID or Email within uploaded file (${employeeId} / ${email}).`);
            return;
          }
          seenIds.add(employeeId.toLowerCase());
          seenEmails.add(email);

          const existing = existingByEmpId.get(employeeId.toLowerCase()) || existingByEmail.get(email);
          if (existing && !allowOverwrite) {
            errors.push(
              `Row ${rowNum}: Teacher "${employeeId}" (${email}) already exists. Check "Overwrite existing records" to update.`
            );
            return;
          }

          validRows.push({
            employeeId,
            name,
            email,
            department,
            role: existing?.role || "teacher",
            uid: existing?.uid || null,
            existingDocId: existing?.docId || null,
            actionLabel: existing ? "Update Existing" : "Create New"
          });
        });

        renderImportPreview("teachers", validRows, errors);
      } else {
        // Students import validation
        const seenStudentIds = new Set();
        const existingStudents = new Map(allStudents.map((s) => [String(s.studentId).toLowerCase(), s]));
        const teacherByEmpId = new Map(allTeachers.map((t) => [String(t.employeeId).toLowerCase(), t]));

        rawRows.forEach((raw, idx) => {
          const rowNum = idx + 2;
          const mapped = {};
          Object.entries(raw).forEach(([k, v]) => {
            mapped[normalizeColumnKey(k)] = String(v).trim();
          });

          const studentId = mapped.studentid || mapped.id || "";
          const fullName = mapped.studentname || mapped.fullname || mapped.name || "";
          const teacherEmployeeId = mapped.teacherid || "";
          const department = mapped.department || "";

          if (!studentId || !fullName || !teacherEmployeeId || !department) {
            errors.push(`Row ${rowNum}: Missing required column (Student ID, Student Name, Teacher ID, Department).`);
            return;
          }
          if (seenStudentIds.has(studentId.toLowerCase())) {
            errors.push(`Row ${rowNum}: Duplicate Student ID "${studentId}" in uploaded file.`);
            return;
          }
          seenStudentIds.add(studentId.toLowerCase());

          const matchedTeacher = teacherByEmpId.get(teacherEmployeeId.toLowerCase());
          if (!matchedTeacher) {
            errors.push(
              `Row ${rowNum}: Assigned Teacher ID "${teacherEmployeeId}" does not exist in Firestore. Import teachers first.`
            );
            return;
          }

          const existingStudent = existingStudents.get(studentId.toLowerCase());
          if (existingStudent && !allowOverwrite) {
            errors.push(
              `Row ${rowNum}: Student ID "${studentId}" already exists. Check "Overwrite existing records" to update.`
            );
            return;
          }

          validRows.push({
            studentId,
            fullName,
            teacherEmployeeId: matchedTeacher.employeeId,
            teacherUid: matchedTeacher.uid || "",
            teacherName: matchedTeacher.name,
            department,
            actionLabel: existingStudent ? "Update Existing" : "Create New"
          });
        });

        renderImportPreview("students", validRows, errors);
      }
    } catch (err) {
      console.error("Excel parse error:", err);
      errorsBox.textContent = `Could not parse file: ${err.message}`;
      errorsBox.classList.remove("hidden");
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderImportPreview(type, validRows, errors) {
  const errorsBox = document.getElementById("excel-validation-errors");
  const previewContainer = document.getElementById("excel-preview-container");
  const summaryEl = document.getElementById("excel-preview-summary");
  const thead = document.getElementById("excel-preview-thead");
  const tbody = document.getElementById("excel-preview-tbody");
  const confirmBtn = document.getElementById("confirm-excel-import-btn");

  if (errors.length > 0) {
    errorsBox.innerHTML =
      `<strong>Validation Issues (${errors.length}):</strong><ul>` +
      errors.slice(0, 10).map((e) => `<li>${escapeHtml(e)}</li>`).join("") +
      (errors.length > 10 ? `<li>...and ${errors.length - 10} more error(s).</li>` : "") +
      `</ul>`;
    errorsBox.classList.remove("hidden");
  }

  stagedImport = { type, validRows };
  summaryEl.textContent = `${validRows.length} valid ${type} row(s) ready to import`;
  confirmBtn.disabled = validRows.length === 0;

  if (type === "teachers") {
    thead.innerHTML = `<tr><th>Teacher ID</th><th>Name</th><th>Email</th><th>Department</th><th>Action</th></tr>`;
    tbody.innerHTML = validRows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.employeeId)}</td>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.email)}</td>
          <td>${escapeHtml(r.department)}</td>
          <td><span class="badge badge-info">${escapeHtml(r.actionLabel)}</span></td>
        </tr>
      `
      )
      .join("");
  } else {
    thead.innerHTML = `<tr><th>Student ID</th><th>Student Name</th><th>Teacher</th><th>Department</th><th>Action</th></tr>`;
    tbody.innerHTML = validRows
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.studentId)}</td>
          <td>${escapeHtml(r.fullName)}</td>
          <td>${escapeHtml(r.teacherName)} (${escapeHtml(r.teacherEmployeeId)})</td>
          <td>${escapeHtml(r.department)}</td>
          <td><span class="badge badge-info">${escapeHtml(r.actionLabel)}</span></td>
        </tr>
      `
      )
      .join("");
  }

  previewContainer.classList.remove("hidden");
}

async function executeStagedImport() {
  if (stagedImport.validRows.length === 0) return;

  const confirmBtn = document.getElementById("confirm-excel-import-btn");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Importing...";

  try {
    if (stagedImport.type === "teachers") {
      await bulkImportTeachers(stagedImport.validRows);
    } else {
      await bulkImportStudents(stagedImport.validRows);
    }

    showToast(`Successfully imported ${stagedImport.validRows.length} ${stagedImport.type} record(s).`, "success");
    document.getElementById("excel-preview-container").classList.add("hidden");
    document.getElementById("excel-file-input").value = "";
    stagedImport = { type: stagedImport.type, validRows: [] };
    await loadAdminData();
  } catch (error) {
    console.error("Bulk import failed:", error);
    showToast(`Import failed: ${error.message}`, "error");
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Confirm & Import to Firestore";
  }
}

function formatRecordsForExcel(records) {
  const teacherMap = getTeacherLookupMap();
  return records.map((rec) => {
    const teacherObj = teacherMap.get(String(rec.teacherUid)) || teacherMap.get(String(rec.teacherEmployeeId));
    return {
      Date: rec.date,
      "Student ID": rec.studentId,
      "Student Name": rec.studentName,
      Department: rec.department || teacherObj?.department || "",
      "Teacher ID": rec.teacherEmployeeId || teacherObj?.employeeId || "",
      "Teacher Name": rec.teacherName || teacherObj?.name || "",
      Status: String(rec.status || "").toUpperCase(),
      "Last Modified": formatTimestamp(rec.updatedAt),
      "Modified By": rec.updatedByName || rec.updatedByEmail || rec.updatedBy || ""
    };
  });
}

/* ============================================================================
   INITIALIZATION & EVENT BINDINGS
   ============================================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  initSidebarToggle();

  const dateSelector = document.getElementById("admin-date-selector");
  if (dateSelector) {
    dateSelector.value = getLocalDateString();
  }

  currentSession = await requireAuth("admin");
  if (!currentSession) return;

  await loadAdminData();

  dateSelector?.addEventListener("change", loadAdminData);

  document.getElementById("admin-all-dates-btn")?.addEventListener("click", () => {
    if (dateSelector) dateSelector.value = "";
    loadAdminData();
  });

  document.getElementById("admin-filter-dept")?.addEventListener("change", refreshAllViews);
  document.getElementById("admin-filter-teacher")?.addEventListener("change", refreshAllViews);
  document.getElementById("admin-filter-status")?.addEventListener("change", refreshAllViews);
  document.getElementById("admin-search-input")?.addEventListener("input", refreshAllViews);

  document.getElementById("sort-date-btn")?.addEventListener("click", (e) => {
    sortDateAsc = !sortDateAsc;
    e.target.innerHTML = sortDateAsc ? "Sort: Date &uarr;" : "Sort: Date &darr;";
    refreshAllViews();
  });

  // Single Teacher Creation Toggle & Submit
  document.getElementById("toggle-add-teacher-btn")?.addEventListener("click", () => {
    document.getElementById("add-teacher-form")?.classList.toggle("hidden");
  });

  document.getElementById("add-teacher-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const employeeId = document.getElementById("new-teacher-id").value.trim();
    const name = document.getElementById("new-teacher-name").value.trim();
    const email = document.getElementById("new-teacher-email").value.trim().toLowerCase();
    const department = document.getElementById("new-teacher-dept").value.trim();
    const role = document.getElementById("new-teacher-role").value;

    try {
      await upsertTeacherRecord({ employeeId, name, email, department, role, active: true });
      showToast(`Saved ${role} account for ${name}.`, "success");
      e.target.reset();
      e.target.classList.add("hidden");
      await loadAdminData();
    } catch (error) {
      console.error("Failed to add staff member:", error);
      showToast(`Error saving user: ${error.message}`, "error");
    }
  });

  // Excel Template Downloads
  document.getElementById("download-teacher-template-btn")?.addEventListener("click", () => {
    downloadExcelWorkbook(
      [
        {
          "Teacher ID": "T-101",
          "Teacher Name": "Dr. Ahmed Ali",
          Email: "ahmed.ali@university.edu",
          Department: "English Language"
        }
      ],
      "Teachers",
      "teachers_import_template.xlsx"
    );
  });

  document.getElementById("download-student-template-btn")?.addEventListener("click", () => {
    downloadExcelWorkbook(
      [
        {
          "Student ID": "2026001",
          "Student Name": "Omar Hassan",
          "Teacher ID": "T-101",
          Department: "English Language"
        }
      ],
      "Students",
      "students_import_template.xlsx"
    );
  });

  // Excel File Upload & Import Confirmation
  document.getElementById("excel-file-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleExcelFileSelection(file);
  });

  document.getElementById("excel-import-type")?.addEventListener("change", () => {
    const file = document.getElementById("excel-file-input")?.files?.[0];
    if (file) handleExcelFileSelection(file);
  });

  document.getElementById("excel-overwrite-checkbox")?.addEventListener("change", () => {
    const file = document.getElementById("excel-file-input")?.files?.[0];
    if (file) handleExcelFileSelection(file);
  });

  document.getElementById("confirm-excel-import-btn")?.addEventListener("click", executeStagedImport);

  // Excel Report Exports
  document.getElementById("admin-export-btn")?.addEventListener("click", () => {
    const rows = formatRecordsForExcel(getFilteredRecords());
    if (rows.length === 0) {
      showToast("No filtered attendance records to export.", "error");
      return;
    }
    downloadExcelWorkbook(rows, "Filtered Attendance", `attendance_report_${getLocalDateString()}.xlsx`);
  });

  document.getElementById("export-daily-btn")?.addEventListener("click", async () => {
    const selectedDate = document.getElementById("admin-date-selector")?.value || getLocalDateString();
    const dailyRecords = await getAllAttendanceRecords(selectedDate);
    if (dailyRecords.length === 0) {
      showToast(`No attendance records found for ${selectedDate}.`, "error");
      return;
    }
    downloadExcelWorkbook(formatRecordsForExcel(dailyRecords), `Daily_${selectedDate}`, `daily_attendance_${selectedDate}.xlsx`);
  });

  document.getElementById("export-teacher-btn")?.addEventListener("click", async () => {
    const teacherFilter = document.getElementById("admin-filter-teacher")?.value || "all";
    if (teacherFilter === "all") {
      showToast("Select a specific Teacher from the filter bar first.", "error");
      return;
    }
    const allRecords = await getAllAttendanceRecords("");
    const teacherRecords = allRecords.filter(
      (r) => String(r.teacherUid) === teacherFilter || String(r.teacherEmployeeId) === teacherFilter
    );
    if (teacherRecords.length === 0) {
      showToast("No attendance records found for the selected teacher.", "error");
      return;
    }
    downloadExcelWorkbook(formatRecordsForExcel(teacherRecords), "Teacher Attendance", `teacher_attendance_${teacherFilter}.xlsx`);
  });

  document.getElementById("export-dept-btn")?.addEventListener("click", async () => {
    const deptFilter = document.getElementById("admin-filter-dept")?.value || "all";
    if (deptFilter === "all") {
      showToast("Select a specific Department from the filter bar first.", "error");
      return;
    }
    const allRecords = await getAllAttendanceRecords("");
    const deptRecords = allRecords.filter((r) => r.department === deptFilter);
    if (deptRecords.length === 0) {
      showToast(`No attendance records found for ${deptFilter}.`, "error");
      return;
    }
    downloadExcelWorkbook(
      formatRecordsForExcel(deptRecords),
      "Department Attendance",
      `department_attendance_${deptFilter.replace(/\s+/g, "_")}.xlsx`
    );
  });

  document.getElementById("export-student-btn")?.addEventListener("click", async () => {
    const targetStudentId = document.getElementById("export-student-id-input")?.value.trim();
    if (!targetStudentId) {
      showToast("Enter a Student ID to export their individual attendance history.", "error");
      return;
    }
    const allRecords = await getAllAttendanceRecords("");
    const studentRecords = allRecords
      .filter((r) => String(r.studentId).toLowerCase() === targetStudentId.toLowerCase())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    if (studentRecords.length === 0) {
      showToast(`No attendance records found for Student ID "${targetStudentId}".`, "error");
      return;
    }
    downloadExcelWorkbook(
      formatRecordsForExcel(studentRecords),
      `Student_${targetStudentId}`,
      `student_history_${targetStudentId}.xlsx`
    );
  });
});
