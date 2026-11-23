/**
 * Phase 2 — Centralized Firestore Database Service
 * Single data-access layer for teachers, students, and attendance records.
 * Supports Staff (Admin/Teacher) and Self-Registered Student accounts.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { makeAttendanceDocId } from "./utils.js";

export const COLLECTIONS = Object.freeze({
  TEACHERS: "teachers",
  STUDENTS: "students",
  ATTENDANCE: "attendance"
});

export const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: "present",
  ABSENT: "absent",
  EXCUSED: "excused"
});

const VALID_STATUSES = new Set(Object.values(ATTENDANCE_STATUS));

/**
 * Retrieves an authenticated staff profile (admin or teacher) by Firebase Auth UID,
 * falling back to a pre-provisioned lowercase email match and binding the UID on first sign-in.
 */
export async function resolveAndBindStaffProfile(uid, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!uid || !normalizedEmail) return null;

  const uidRef = doc(db, COLLECTIONS.TEACHERS, uid);
  const uidSnap = await getDoc(uidRef);
  if (uidSnap.exists()) {
    return { docId: uidSnap.id, ...uidSnap.data() };
  }

  const emailQuery = query(
    collection(db, COLLECTIONS.TEACHERS),
    where("email", "==", normalizedEmail)
  );
  const emailSnap = await getDocs(emailQuery);
  if (emailSnap.empty) {
    return null;
  }

  const preDoc = emailSnap.docs[0];
  const preData = preDoc.data();

  if (preData.active !== true) {
    return { docId: preDoc.id, ...preData };
  }

  const boundProfile = {
    uid,
    employeeId: String(preData.employeeId || preDoc.id).trim(),
    name: String(preData.name || "").trim(),
    email: normalizedEmail,
    role: preData.role === "admin" ? "admin" : "teacher",
    department: String(preData.department || "").trim(),
    active: true
  };

  await setDoc(uidRef, boundProfile);

  if (preDoc.id !== uid) {
    try {
      await updateDoc(doc(db, COLLECTIONS.TEACHERS, preDoc.id), { uid });
    } catch (err) {
      console.warn("Non-critical warning updating pre-provisioned teacher doc:", err);
    }
  }

  if (boundProfile.employeeId) {
    try {
      const studentsQ = query(
        collection(db, COLLECTIONS.STUDENTS),
        where("teacherEmployeeId", "==", boundProfile.employeeId)
      );
      const studentsSnap = await getDocs(studentsQ);
      if (!studentsSnap.empty) {
        const batch = writeBatch(db);
        studentsSnap.forEach((studentDoc) => {
          if (studentDoc.data().teacherUid !== uid) {
            batch.update(studentDoc.ref, { teacherUid: uid });
          }
        });
        await batch.commit();
      }
    } catch (err) {
      console.warn("Student UID linking skipped or already linked:", err);
    }
  }

  return { docId: uid, ...boundProfile };
}

/**
 * Finds a student record linked to an authenticated Google user's UID or email.
 */
export async function getStudentProfileByAuth(uid, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!uid) return null;

  const byUidQ = query(collection(db, COLLECTIONS.STUDENTS), where("uid", "==", uid));
  const uidSnap = await getDocs(byUidQ);
  if (!uidSnap.empty) {
    const d = uidSnap.docs[0];
    return { docId: d.id, ...d.data() };
  }

  if (normalizedEmail) {
    const byEmailQ = query(collection(db, COLLECTIONS.STUDENTS), where("email", "==", normalizedEmail));
    const emailSnap = await getDocs(byEmailQ);
    if (!emailSnap.empty) {
      const d = emailSnap.docs[0];
      return { docId: d.id, ...d.data() };
    }
  }

  return null;
}

/**
 * Creates or updates a self-registered student's profile at students/{studentId}.
 * Prevents overwriting another student's existing ID.
 */
export async function saveSelfRegisteredStudent({
  uid,
  email,
  studentId,
  fullName,
  department,
  teacherUid,
  teacherEmployeeId,
  teacherName
}) {
  const cleanStudentId = String(studentId || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!uid || !cleanStudentId || !fullName || !department) {
    throw new Error("Student ID, Full Name, and Department are required.");
  }

  const studentRef = doc(db, COLLECTIONS.STUDENTS, cleanStudentId);
  const existingSnap = await getDoc(studentRef);

  if (existingSnap.exists()) {
    const existing = existingSnap.data();
    if (existing.uid && existing.uid !== uid) {
      throw new Error(`Student ID "${cleanStudentId}" is already registered to another Google account.`);
    }
    if (existing.email && existing.email !== normalizedEmail && !existing.uid) {
      throw new Error(`Student ID "${cleanStudentId}" belongs to a different pre-registered email.`);
    }
  }

  const payload = {
    uid,
    email: normalizedEmail,
    studentId: cleanStudentId,
    fullName: String(fullName).trim(),
    department: String(department).trim(),
    teacherUid: String(teacherUid || "").trim(),
    teacherEmployeeId: String(teacherEmployeeId || "").trim(),
    teacherName: String(teacherName || "").trim(),
    active: true,
    updatedAt: serverTimestamp()
  };

  await setDoc(studentRef, payload, { merge: true });
  return { docId: cleanStudentId, ...payload };
}

/**
 * Lists active teachers (non-admin) so students can select their instructor during registration.
 */
export async function getActiveTeachersList() {
  const q = query(
    collection(db, COLLECTIONS.TEACHERS),
    where("active", "==", true)
  );
  const snapshot = await getDocs(q);
  const byKey = new Map();

  snapshot.forEach((docSnap) => {
    const data = { docId: docSnap.id, ...docSnap.data() };
    if (data.role !== "teacher") return;
    const key = String(data.email || docSnap.id).toLowerCase();
    const existing = byKey.get(key);
    if (!existing || (data.uid && data.docId === data.uid)) {
      byKey.set(key, data);
    }
  });

  return Array.from(byKey.values()).sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""))
  );
}

/**
 * Retrieves attendance records for a specific studentId (for the student self-service portal).
 */
export async function getAttendanceByStudentId(studentId) {
  if (!studentId) return [];
  const q = query(
    collection(db, COLLECTIONS.ATTENDANCE),
    where("studentId", "==", String(studentId).trim())
  );
  const snapshot = await getDocs(q);
  const records = [];
  snapshot.forEach((docSnap) => {
    records.push({ docId: docSnap.id, ...docSnap.data() });
  });
  return records.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * Retrieves all active students assigned to a specific teacher's UID (or employeeId fallback).
 */
export async function getStudentsByTeacher(teacherUid, teacherEmployeeId = "") {
  if (!teacherUid) return [];
  const byId = new Map();

  const uidQ = query(
    collection(db, COLLECTIONS.STUDENTS),
    where("teacherUid", "==", teacherUid)
  );
  const uidSnap = await getDocs(uidQ);
  uidSnap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.active !== false) {
      byId.set(docSnap.id, { docId: docSnap.id, ...data });
    }
  });

  if (teacherEmployeeId) {
    const empQ = query(
      collection(db, COLLECTIONS.STUDENTS),
      where("teacherEmployeeId", "==", teacherEmployeeId)
    );
    const empSnap = await getDocs(empQ);
    empSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.active !== false && !byId.has(docSnap.id)) {
        byId.set(docSnap.id, { docId: docSnap.id, ...data });
      }
    });
  }

  return Array.from(byId.values()).sort((a, b) =>
    String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true })
  );
}

/**
 * Saves or updates a single daily attendance record using deterministic ID {YYYY-MM-DD}_{studentId}.
 */
export async function saveAttendanceRecord({
  studentId,
  studentName,
  teacherUid,
  teacherEmployeeId = "",
  teacherName = "",
  department = "",
  date,
  status,
  updatedBy,
  updatedByName = "",
  updatedByEmail = ""
}) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid attendance status: ${status}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new Error(`Invalid date format (expected YYYY-MM-DD): ${date}`);
  }
  if (!studentId || !teacherUid || !updatedBy) {
    throw new Error("Missing required fields (studentId, teacherUid, updatedBy).");
  }

  const cleanStudentId = String(studentId).trim();
  const docId = makeAttendanceDocId(date, cleanStudentId);
  const recordRef = doc(db, COLLECTIONS.ATTENDANCE, docId);

  const payload = {
    studentId: cleanStudentId,
    studentName: String(studentName || "").trim(),
    teacherUid: String(teacherUid).trim(),
    teacherEmployeeId: String(teacherEmployeeId || "").trim(),
    teacherName: String(teacherName || "").trim(),
    department: String(department || "").trim(),
    date: String(date).trim(),
    status,
    updatedAt: serverTimestamp(),
    updatedBy: String(updatedBy).trim(),
    updatedByName: String(updatedByName || "").trim(),
    updatedByEmail: String(updatedByEmail || "").trim()
  };

  await setDoc(recordRef, payload, { merge: true });
  return { docId, ...payload };
}

/**
 * Retrieves attendance records for a specific teacher on a specific YYYY-MM-DD date.
 */
export async function getAttendanceByTeacherAndDate(teacherUid, dateStr) {
  const resultMap = new Map();
  if (!teacherUid || !dateStr) return resultMap;

  const q = query(
    collection(db, COLLECTIONS.ATTENDANCE),
    where("teacherUid", "==", teacherUid),
    where("date", "==", dateStr)
  );
  const snapshot = await getDocs(q);
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    resultMap.set(String(data.studentId), { docId: docSnap.id, ...data });
  });
  return resultMap;
}

/**
 * Retrieves attendance history for a teacher (all dates or filtered by a single date).
 */
export async function getAttendanceHistoryForTeacher(teacherUid, dateFilter = "") {
  if (!teacherUid) return [];

  const constraints = [where("teacherUid", "==", teacherUid)];
  if (dateFilter) {
    constraints.push(where("date", "==", dateFilter));
  }

  const q = query(collection(db, COLLECTIONS.ATTENDANCE), ...constraints);
  const snapshot = await getDocs(q);
  const records = [];
  snapshot.forEach((docSnap) => {
    records.push({ docId: docSnap.id, ...docSnap.data() });
  });

  return records.sort((a, b) => {
    const dateCmp = String(b.date).localeCompare(String(a.date));
    if (dateCmp !== 0) return dateCmp;
    return String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true });
  });
}

/**
 * Updates the status of an existing attendance document and logs audit metadata.
 */
export async function updateExistingAttendanceStatus(docId, newStatus, editor) {
  if (!VALID_STATUSES.has(newStatus)) {
    throw new Error(`Invalid attendance status: ${newStatus}`);
  }
  if (!docId || !editor?.uid) {
    throw new Error("Document ID and authenticated editor UID are required.");
  }

  const recordRef = doc(db, COLLECTIONS.ATTENDANCE, docId);
  await updateDoc(recordRef, {
    status: newStatus,
    updatedAt: serverTimestamp(),
    updatedBy: editor.uid,
    updatedByName: editor.name || "",
    updatedByEmail: editor.email || ""
  });
}

/* ============================================================================
   ADMINISTRATOR QUERIES & BULK IMPORT HELPERS
   ============================================================================ */

export async function getAllTeachers() {
  const snapshot = await getDocs(collection(db, COLLECTIONS.TEACHERS));
  const byKey = new Map();

  snapshot.forEach((docSnap) => {
    const data = { docId: docSnap.id, ...docSnap.data() };
    const key = String(data.email || docSnap.id).toLowerCase();
    const existing = byKey.get(key);
    if (!existing || (data.uid && data.docId === data.uid)) {
      byKey.set(key, data);
    }
  });

  return Array.from(byKey.values()).sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""))
  );
}

export async function getAllStudents() {
  const snapshot = await getDocs(collection(db, COLLECTIONS.STUDENTS));
  const students = [];
  snapshot.forEach((docSnap) => {
    students.push({ docId: docSnap.id, ...docSnap.data() });
  });
  return students.sort((a, b) =>
    String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true })
  );
}

export async function getAllAttendanceRecords(dateFilter = "") {
  const baseRef = collection(db, COLLECTIONS.ATTENDANCE);
  const q = dateFilter ? query(baseRef, where("date", "==", dateFilter)) : baseRef;
  const snapshot = await getDocs(q);
  const records = [];
  snapshot.forEach((docSnap) => {
    records.push({ docId: docSnap.id, ...docSnap.data() });
  });
  return records.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export async function upsertTeacherRecord(teacherData) {
  const employeeId = String(teacherData.employeeId).trim();
  const email = String(teacherData.email).trim().toLowerCase();
  const targetDocId = teacherData.uid ? String(teacherData.uid).trim() : employeeId;

  const payload = {
    uid: teacherData.uid || null,
    employeeId,
    name: String(teacherData.name).trim(),
    email,
    role: teacherData.role === "admin" ? "admin" : "teacher",
    department: String(teacherData.department).trim(),
    active: teacherData.active !== false
  };

  await setDoc(doc(db, COLLECTIONS.TEACHERS, targetDocId), payload, { merge: true });
  return { docId: targetDocId, ...payload };
}

export async function bulkImportTeachers(rows) {
  const CHUNK_SIZE = 450;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const slice = rows.slice(i, i + CHUNK_SIZE);
    for (const row of slice) {
      const targetId = row.existingDocId || row.employeeId;
      const ref = doc(db, COLLECTIONS.TEACHERS, targetId);
      batch.set(
        ref,
        {
          uid: row.uid || null,
          employeeId: row.employeeId,
          name: row.name,
          email: row.email.toLowerCase(),
          role: row.role || "teacher",
          department: row.department,
          active: true
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

export async function bulkImportStudents(rows) {
  const CHUNK_SIZE = 450;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const slice = rows.slice(i, i + CHUNK_SIZE);
    for (const row of slice) {
      const ref = doc(db, COLLECTIONS.STUDENTS, row.studentId);
      batch.set(
        ref,
        {
          studentId: row.studentId,
          fullName: row.fullName,
          teacherEmployeeId: row.teacherEmployeeId,
          teacherUid: row.teacherUid || "",
          department: row.department,
          active: true
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

